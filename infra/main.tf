# --- S3 Bucket ---

resource "aws_s3_bucket" "petzi_feed" {
  bucket = var.s3_bucket_name

  tags = {
    Name = var.s3_bucket_name
  }
}

resource "aws_s3_bucket_versioning" "petzi_feed" {
  bucket = aws_s3_bucket.petzi_feed.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "petzi_feed" {
  bucket = aws_s3_bucket.petzi_feed.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "petzi_feed" {
  bucket     = aws_s3_bucket.petzi_feed.id
  depends_on = [aws_s3_bucket_public_access_block.petzi_feed]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicRead"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.petzi_feed.arn}/*"
    }]
  })
}

resource "aws_s3_bucket_server_side_encryption_configuration" "petzi_feed" {
  bucket = aws_s3_bucket.petzi_feed.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

# --- IAM Role for Lambda ---

resource "aws_iam_role" "petzi_feed_lambda" {
  name = "${var.lambda_function_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "petzi_feed_lambda" {
  name = "${var.lambda_function_name}-lambda-policy"
  role = aws_iam_role.petzi_feed_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.petzi_feed.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

# --- GitHub Actions OIDC Deploy Role ---

data "aws_caller_identity" "current" {}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

resource "aws_iam_role" "petzi_feed_deploy" {
  name = "${var.lambda_function_name}-deploy-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.github.arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "petzi_feed_deploy" {
  name = "${var.lambda_function_name}-deploy-policy"
  role = aws_iam_role.petzi_feed_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration"]
        Resource = "arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${var.lambda_function_name}"
      }
    ]
  })
}

# --- Lambda Function ---

resource "null_resource" "package" {
  triggers = {
    src_hash     = sha256(join("", [for f in sort(fileset("${path.module}/../src", "**/*.js")) : filesha256("${path.module}/../src/${f}")]))
    package_json = filemd5("${path.module}/../package.json")
  }

  provisioner "local-exec" {
    command = <<-EOT
      set -e
      npm ci --omit=dev --prefix "${path.module}/.."
      mkdir -p "${path.module}/../build"
      cd "${path.module}/.."
      zip -qr build/function.zip src/ node_modules/ package.json --exclude "*.DS_Store"
    EOT
  }
}

resource "aws_lambda_function" "petzi_feed" {
  function_name    = var.lambda_function_name
  role             = aws_iam_role.petzi_feed_lambda.arn
  handler          = "handler.handler"
  runtime          = "nodejs22.x"
  memory_size      = var.lambda_memory_size
  timeout          = var.lambda_timeout
  filename         = "${path.module}/../build/function.zip"
  source_code_hash = null_resource.package.triggers.src_hash

  depends_on = [null_resource.package]

  environment {
    variables = {
      S3_BUCKET    = var.s3_bucket_name
      FEEDS_CONFIG = var.feeds_config
    }
  }
}

# --- EventBridge Rule ---

resource "aws_cloudwatch_event_rule" "petzi_feed_daily" {
  name                = "${var.lambda_function_name}-daily"
  schedule_expression = "cron(0 7 * * ? *)"
}

resource "aws_cloudwatch_event_target" "petzi_feed_daily" {
  rule      = aws_cloudwatch_event_rule.petzi_feed_daily.name
  target_id = "Lambda"
  arn       = aws_lambda_function.petzi_feed.arn
}

# --- Lambda Permission for EventBridge ---

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "eventbridge-permission"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.petzi_feed.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.petzi_feed_daily.arn
}
