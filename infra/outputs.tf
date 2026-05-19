output "lambda_function_arn" {
  description = "ARN of the Lambda function"
  value       = aws_lambda_function.petzi_feed.arn
}

output "s3_bucket_name" {
  description = "Name of the S3 bucket"
  value       = aws_s3_bucket.petzi_feed.id
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = aws_s3_bucket.petzi_feed.arn
}

output "iam_role_arn" {
  description = "ARN of the Lambda IAM role"
  value       = aws_iam_role.petzi_feed_lambda.arn
}

output "eventbridge_rule_arn" {
  description = "ARN of the EventBridge rule"
  value       = aws_cloudwatch_event_rule.petzi_feed_daily.arn
}

output "deploy_role_arn" {
  description = "ARN of the GitHub Actions deploy role — set as AWS_ROLE_ARN secret in GitHub"
  value       = aws_iam_role.petzi_feed_deploy.arn
}
