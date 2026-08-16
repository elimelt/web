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

    ingress_rule {
      hostname = "transcribe.${var.domain}"
      service  = "http://caddy:80"
    }

    ingress_rule {
      hostname = "llm.${var.domain}"
      service  = "http://caddy:80"
    }

    ingress_rule {
      hostname = "inbox.${var.domain}"
      service  = "http://caddy:80"
    }

    ingress_rule {
      hostname = "inbox-api.${var.domain}"
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

resource "cloudflare_record" "transcribe" {
  zone_id = data.cloudflare_zone.main.id
  name    = "transcribe"
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  comment = "Speaches - Whisper transcription API"
}

resource "cloudflare_record" "llm" {
  zone_id = data.cloudflare_zone.main.id
  name    = "llm"
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  comment = "Ollama - Local LLM API"
}

# =============================================================================
# DNS Records for GitHub Pages
# =============================================================================

# GitHub Pages IPs
locals {
  github_pages_ips = [
    "185.199.108.153",
    "185.199.109.153",
    "185.199.110.153",
    "185.199.111.153",
  ]
}

# Apex domain (elimelt.com)
resource "cloudflare_record" "apex" {
  for_each = toset(local.github_pages_ips)
  zone_id  = data.cloudflare_zone.main.id
  name     = var.domain
  type     = "A"
  content  = each.value
  proxied  = true
  comment  = "GitHub Pages"
}

# www subdomain
resource "cloudflare_record" "www" {
  zone_id = data.cloudflare_zone.main.id
  name    = "www"
  type    = "CNAME"
  content = "elimelt.github.io"
  proxied = true
  comment = "GitHub Pages"
}

# notes subdomain
resource "cloudflare_record" "notes" {
  for_each = toset(local.github_pages_ips)
  zone_id  = data.cloudflare_zone.main.id
  name     = "notes"
  type     = "A"
  content  = each.value
  proxied  = true
  comment  = "GitHub Pages - Notes app"
}

# music subdomain
resource "cloudflare_record" "music" {
  zone_id = data.cloudflare_zone.main.id
  name    = "music"
  type    = "CNAME"
  content = "elimelt.github.io"
  proxied = true
  comment = "GitHub Pages - Music app"
}

# spa-template subdomain
resource "cloudflare_record" "spa_template" {
  for_each = toset(local.github_pages_ips)
  zone_id  = data.cloudflare_zone.main.id
  name     = "spa-template"
  type     = "A"
  content  = each.value
  proxied  = true
  comment  = "GitHub Pages - SPA template"
}

# capture subdomain
resource "cloudflare_record" "capture" {
  for_each = toset(local.github_pages_ips)
  zone_id  = data.cloudflare_zone.main.id
  name     = "capture"
  type     = "A"
  content  = each.value
  proxied  = true
  comment  = "GitHub Pages - Capture app"
}

# inbox subdomain
resource "cloudflare_record" "inbox" {
  zone_id = data.cloudflare_zone.main.id
  name    = "inbox"
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  comment = "Inbox app frontend"
}

# inbox-api subdomain
resource "cloudflare_record" "inbox_api" {
  zone_id = data.cloudflare_zone.main.id
  name    = "inbox-api"
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  comment = "Inbox API backend"
}

# =============================================================================
# DNS Records for Other Services
# =============================================================================

# Auth service on AWS
resource "cloudflare_record" "auth" {
  zone_id = data.cloudflare_zone.main.id
  name    = "auth"
  type    = "A"
  content = "54.185.38.121"
  proxied = true
  comment = "AWS EC2 - Auth service"
}

# =============================================================================
# Rate Limiting
# =============================================================================
# NOTE: Rate limiting requires additional API token permissions.
# To enable via Terraform, add these permissions to your API token:
#   - Zone > WAF > Edit
#   - Zone > Zone Settings > Edit
#
# Alternatively, configure manually in Cloudflare Dashboard:
#   Security > WAF > Rate limiting rules
#   - transcribe.elimelt.com: 30 req/min per IP
#   - llm.elimelt.com: 20 req/min per IP
#
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
