# Deploy — Terraform

Use Terraform to provision and manage all AWS infrastructure in a single declarative file.

## Prerequisites

Terraform uses the default AWS CLI credentials. If your credentials come from a login tool (Leapp, aws-vault, etc.), export them before each session:

```bash
eval "$(aws configure export-credentials --format env)"
```

> **Note:** credentials from a login tool expire during long sessions. If any AWS command fails with a credentials error, re-export before retrying:
> ```bash
> eval "$(aws configure export-credentials --format env)"
> ```

## First-time setup

```bash
cd infra
terraform init
terraform apply
```

This creates:
- **S3 bucket** (`my-petzi-feed`) with versioning, encryption, and public read
- **IAM role** for the Lambda with S3 PutObject + CloudWatch Logs permissions
- **Lambda function** (`petzi-feed`), zipped from `src/`
- **EventBridge rule** (`petzi-feed-daily`), runs daily at 07:00 UTC
- **Lambda permission** for EventBridge to invoke the function

## Trigger the Lambda manually

The Lambda runs daily at 07:00 UTC. To populate the feed immediately after deploy:

```bash
aws lambda invoke --function-name petzi-feed /tmp/out.json && cat /tmp/out.json
```

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
