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
# NOTE: SSL mode must be set to "Full" in the Cloudflare dashboard.
# This cannot be managed via Terraform without Zone Settings:Edit permission.
# Dashboard: https://dash.cloudflare.com/ → elimelt.com → SSL/TLS → Overview

# =============================================================================
# Cloudflare Tunnel
# =============================================================================
#
# The tunnel was created via CLI. We reference it as a data source to avoid
# Terraform trying to recreate it (which would break the existing connection).
#
# Tunnel ID: ecc58535-4890-4667-b78a-9d00e1a5034c

variable "tunnel_id" {
  description = "Existing tunnel ID created via cloudflared CLI"
  type        = string
  default     = "ecc58535-4890-4667-b78a-9d00e1a5034c"
}

# Reference to the existing tunnel (read-only)
data "cloudflare_zero_trust_tunnel_cloudflared" "homelab" {
  account_id = var.cloudflare_account_id
  name       = "homelab"
}

# Tunnel configuration (ingress rules)
resource "cloudflare_zero_trust_tunnel_cloudflared_config" "homelab" {
  account_id = var.cloudflare_account_id
  tunnel_id  = var.tunnel_id

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
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  comment = "Uptime Kuma status page"
}

resource "cloudflare_record" "api" {
  zone_id = data.cloudflare_zone.main.id
  name    = "api"
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  comment = "Public API"
}

# =============================================================================
# Outputs
# =============================================================================

output "tunnel_id" {
  value       = var.tunnel_id
  description = "Tunnel ID"
}

output "tunnel_cname" {
  value       = "${var.tunnel_id}.cfargotunnel.com"
  description = "CNAME target for tunnel DNS records"
}
