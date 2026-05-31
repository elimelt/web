# Terraform Variables
# ====================
# Copy terraform.tfvars.example to terraform.tfvars and fill in values

variable "services" {
  description = "Map of services to expose via tunnel"
  type = map(object({
    subdomain = string
    service   = string
    comment   = optional(string, "")
  }))
  default = {
    status = {
      subdomain = "status"
      service   = "http://caddy:80"
      comment   = "Uptime Kuma status page"
    }
    api = {
      subdomain = "api"
      service   = "http://caddy:80"
      comment   = "Public API"
    }
  }
}
