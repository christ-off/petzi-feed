# Terraform — AWS Infrastructure

Provisions the S3 bucket, IAM role, Lambda function, EventBridge rule, and permissions.

## Prerequisites

- Terraform >= 1.5
- AWS CLI configured (credentials, region, profile)
- AWS IAM permissions to create/manage S3, IAM, Lambda, EventBridge

## Quick Start

```bash
cd infra

# Initialize Terraform
terraform init

# Review changes
terraform plan

# Apply infrastructure
terraform apply
```

## Configuration

Edit `variables.tf` or create a `terraform.tfvars` file to override defaults:

```hcl
s3_bucket_name      = "my-petzi-feed"
lambda_function_name = "petzi-feed"
feeds_config        = "[{\"organiserUrl\":\"https://www.petzi.ch/fr/organiser/143/\",\"s3Key\":\"feeds/pont-rouge-atom.xml\"}]"
```

## Updating the Lambda code

The Lambda code is zipped from the `src/` directory during `terraform plan` / `apply`. To update:

```bash
terraform apply
```

No need to manually zip or upload — `archive_file` handles packaging.

## Updating FEEDS_CONFIG

Change the `feeds_config` variable and run:

```bash
terraform apply -var="feeds_config=[{\"organiserUrl\":\"https://www.petzi.ch/fr/organiser/XX/\",\"s3Key\":\"feeds/venue2-atom.xml\"}]"
```

## Variables

| Name | Description | Default |
|---|---|---|
| `aws_region` | AWS region | `eu-west-1` |
| `lambda_function_name` | Lambda function name | `petzi-feed` |
| `s3_bucket_name` | S3 bucket name | `my-petzi-feed` |
| `lambda_memory_size` | Lambda memory in MB | `256` |
| `lambda_timeout` | Lambda timeout in seconds | `60` |
| `feeds_config` | JSON array of feed configurations | See `variables.tf` |

## Outputs

- `lambda_function_arn` — ARN of the Lambda function
- `s3_bucket_name` — Name of the S3 bucket
- `iam_role_arn` — ARN of the IAM role
- `eventbridge_rule_arn` — ARN of the EventBridge rule

## Destroy

```bash
terraform destroy
```

## CI/CD

The GitHub Actions `deploy.yml` workflow still handles code updates (test → zip → upload Lambda). Use Terraform only for initial infrastructure provisioning.

To fully automate with Terraform, add a CI step that runs `terraform apply` when `infra/` changes.
