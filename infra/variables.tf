variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-3"
}

variable "lambda_function_name" {
  description = "Lambda function name"
  type        = string
  default     = "petzi-feed"
}

variable "s3_bucket_name" {
  description = "S3 bucket name for feed storage"
  type        = string
  default     = "my-petzi-feed"
}

variable "lambda_memory_size" {
  description = "Lambda memory size in MB"
  type        = number
  default     = 256
}

variable "lambda_timeout" {
  description = "Lambda timeout in seconds"
  type        = number
  default     = 60
}

variable "feeds_config" {
  description = "JSON array of feed configurations"
  type        = string
  default     = "[{\"organiserUrl\":\"https://www.petzi.ch/fr/organiser/143/\",\"s3Key\":\"feeds/pont-rouge-atom.xml\"}]"
}

variable "feed_url" {
  description = "Public URL of the primary feed (used in Lambda for self-referencing)"
  type        = string
  default     = ""
}

variable "github_repo" {
  description = "GitHub repo allowed to assume the deploy role (format: owner/repo)"
  type        = string
  default     = "christ-off/petzi-feed"
}
