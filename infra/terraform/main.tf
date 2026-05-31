# Cloudflare Infrastructure Configuration
# ========================================
# This manages all Cloudflare resources for elimelt.com
#
# Usage:
#   cd infra/terraform
#   terraform init
#   terraform plan
#   terraform apply
#
# Required environment variables:
#   CLOUDFLARE_API_TOKEN - API token with Zone:Edit, Tunnel:Edit permissions

terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

# Variables
variable "cloudflare_account_id" {
  description = "Cloudflare Account ID"
  type        = string
}

variable "domain" {
  description = "Root domain"
  type        = string
  default     = "elimelt.com"
}

# Data source to get zone ID
data "cloudflare_zone" "main" {
  name = var.domain
}

# =============================================================================
# SSL/TLS Settings
# =============================================================================

resource "cloudflare_zone_settings_override" "ssl_settings" {
  zone_id = data.cloudflare_zone.main.id

  settings {
    ssl                      = "full"
    always_use_https         = "on"
    automatic_https_rewrites = "on"
    min_tls_version          = "1.2"
  }
}

# =============================================================================
# Cloudflare Tunnel
# =============================================================================

resource "cloudflare_tunnel" "homelab" {
  account_id = var.cloudflare_account_id
  name       = "homelab"
  secret     = random_id.tunnel_secret.b64_std
}

resource "random_id" "tunnel_secret" {
  byte_length = 32
}

# Tunnel configuration (ingress rules)
resource "cloudflare_tunnel_config" "homelab" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_tunnel.homelab.id

  config {
    ingress_rule {
      hostname = "status.${var.domain}"
      service  = "http://caddy:80"
    }

    ingress_rule {
      hostname = "api.${var.domain}"
      service  = "http://caddy:80"
    }

    # Catch-all rule (required)
    ingress_rule {
      service = "http_status:404"
    }
  }
}

# =============================================================================
# DNS Records for Tunnel
# =============================================================================

resource "cloudflare_record" "status" {
  zone_id = data.cloudflare_zone.main.id
  name    = "status"
  type    = "CNAME"
  content = "${cloudflare_tunnel.homelab.id}.cfargotunnel.com"
  proxied = true
  comment = "Uptime Kuma status page"
}

resource "cloudflare_record" "api" {
  zone_id = data.cloudflare_zone.main.id
  name    = "api"
  type    = "CNAME"
  content = "${cloudflare_tunnel.homelab.id}.cfargotunnel.com"
  proxied = true
  comment = "Public API"
}

# =============================================================================
# Outputs
# =============================================================================

output "tunnel_id" {
  value       = cloudflare_tunnel.homelab.id
  description = "Tunnel ID"
}

output "tunnel_token" {
  value       = cloudflare_tunnel.homelab.tunnel_token
  sensitive   = true
  description = "Tunnel token for CLOUDFLARE_TUNNEL_TOKEN env var"
}

output "tunnel_cname" {
  value       = "${cloudflare_tunnel.homelab.id}.cfargotunnel.com"
  description = "CNAME target for tunnel DNS records"
}
