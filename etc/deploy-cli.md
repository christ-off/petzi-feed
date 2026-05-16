# Deploy — CLI Commands

One-time setup to create the S3 bucket, IAM role, EventBridge rule, and Lambda function.
After that, only GitHub Actions handles deploys (code updates).

## Configurable values

```bash
# Change these for a different venue
BUCKET=my-petzi-feed
PETZI_ORGANISER_URL=https://www.petzi.ch/fr/organiser/143/

# Usually no need to change below
AWS_ACCOUNT_ID=YOUR_ACCOUNT_ID
S3_KEY=petzi-feed/atom.xml
FEED_URL="https://${BUCKET}.s3.eu-west-1.amazonaws.com/${S3_KEY}"
```

## 1. Create S3 bucket

```bash
aws s3api create-bucket --bucket "$BUCKET" --region eu-west-1
aws s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket "$BUCKET" \
  --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"
```

## 2. S3 bucket policy — public read

```bash
aws s3api put-bucket-policy --bucket "$BUCKET" --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicRead",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::'"$BUCKET"'/*"
  }]
}'
```

## 3. IAM role for Lambda

```bash
# Trust policy
cat > lambda-trust.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
EOF

aws iam create-role \
  --role-name petzi-feed-lambda-role \
  --assume-role-policy-document file://lambda-trust.json

# Attach policy
cat > lambda-policy.json <<'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::${BUCKET}/*"
    },
    {
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "*"
    }
  ]
}
EOF

aws iam put-role-policy \
  --role-name petzi-feed-lambda-role \
  --policy-name petzi-feed-lambda-policy \
  --policy-document file://lambda-policy.json
```

## 4. Create Lambda function

```bash
cd .github/workflows/tmp || mkdir -p .github/workflows/tmp && cd .github/workflows/tmp

rm -f function.zip
zip -r function.zip src/ node_modules/ package.json

aws lambda create-function \
  --function-name petzi-feed \
  --runtime nodejs22.x \
  --role arn:aws:iam::${AWS_ACCOUNT_ID}:role/petzi-feed-lambda-role \
  --handler src/handler.handler \
  --zip-file fileb://function.zip \
  --timeout 60 \
  --memory-size 256 \
  --environment "Variables={S3_BUCKET=${BUCKET},S3_KEY=${S3_KEY},FEED_URL=${FEED_URL},PETZI_ORGANISER_URL=${PETZI_ORGANISER_URL}}"

cd ../../../..
rm -rf .github/workflows/tmp
```

## 5. EventBridge rule — daily at 7:00

```bash
aws events put-rule \
  --name petzi-feed-daily \
  --schedule-expression "cron(0 7 * * ? *)" \
  --state ENABLED

aws events put-targets \
  --rule petzi-feed-daily \
  --targets "Id=1,Arn=arn:aws:lambda:eu-west-1:${AWS_ACCOUNT_ID}:function:petzi-feed"
```

## 6. Grant EventBridge permission to invoke Lambda

```bash
aws lambda add-permission \
  --function-name petzi-feed \
  --statement-id eventbridge-permission \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:eu-west-1:${AWS_ACCOUNT_ID}:rule/petzi-feed-daily
```
