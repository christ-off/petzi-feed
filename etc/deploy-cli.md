# Deploy — Terraform

Use Terraform to provision and manage all AWS infrastructure in the `infra/` directory.

## Prerequisites

Terraform uses the default AWS CLI credentials. Add this alias to `~/.zshrc` once:

```bash
alias aws-refresh='unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_CREDENTIAL_EXPIRATION && aws login && eval "$(aws configure export-credentials --format env)"'
```

Then run `aws-refresh` before any Terraform or AWS CLI work. Without unsetting first, re-running `export-credentials` silently re-exports the already-expired credentials from the environment instead of reading the fresh login cache.

## First-time setup

```bash
cd infra
terraform init
terraform apply
```

This creates:
- **S3 bucket** (`my-petzi-feed`) with versioning suspended, encryption, and public read
- **CloudFront distribution** with OAC, serving feeds via `https://<domain>/feeds/pont-rouge-atom.xml`
- **IAM role** for the Lambda with S3 PutObject + CloudWatch Logs permissions
- **Lambda function** (`petzi-feed`), zipped from `src/`
- **EventBridge rule** (`petzi-feed-daily`), runs daily at 07:00 UTC
- **Lambda permission** for EventBridge to invoke the function

## Trigger the Lambda manually

The Lambda runs daily at 07:00 UTC. To populate the feed immediately after deploy:

```bash
aws lambda invoke --function-name petzi-feed /tmp/out.json && cat /tmp/out.json
```

## CloudFront feed URL

After apply, the feed is available at:

```bash
terraform output -raw cloudfront_feed_url
```

Distribution is restricted to North America and Europe.

## Updating the Lambda code

Just run `terraform apply` — it automatically zips `src/` and updates the function.

## Changing FEEDS_CONFIG

```bash
terraform apply -var="feeds_config=[{\"organiserUrl\":\"...\",\"s3Key\":\"...\"}]"
```

Or edit `variables.tf` / create `terraform.tfvars`.

## Destroy

```bash
terraform destroy
```
