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
#   CLOUDFLARE_API_TOKEN - API token with Zone:Edit, Tunnel:Edit, Pages:Edit permissions

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

    ingress_rule {
      hostname = "static.${var.domain}"
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

# =============================================================================
# Static sites on Cloudflare Pages
# =============================================================================
# .github/workflows/{web,notes,blog}-deploy.yml upload builds to these projects with
# wrangler (direct upload, no Git integration).

resource "cloudflare_pages_project" "web" {
  account_id        = var.cloudflare_account_id
  name              = "elimelt"
  production_branch = "main"
}

resource "cloudflare_pages_project" "notes" {
  account_id        = var.cloudflare_account_id
  name              = "elimelt-notes"
  production_branch = "main"
}

resource "cloudflare_pages_project" "blog" {
  account_id        = var.cloudflare_account_id
  name              = "elimelt-blog"
  production_branch = "main"
}

resource "cloudflare_pages_domain" "web" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.web.name
  domain       = var.domain
}

resource "cloudflare_pages_domain" "notes" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.notes.name
  domain       = "notes.${var.domain}"
}

resource "cloudflare_pages_domain" "blog" {
  account_id   = var.cloudflare_account_id
  project_name = cloudflare_pages_project.blog.name
  domain       = "blog.${var.domain}"
}

# Apex domain (elimelt.com); Cloudflare flattens the CNAME at the apex.
resource "cloudflare_record" "apex" {
  zone_id = data.cloudflare_zone.main.id
  name    = var.domain
  type    = "CNAME"
  content = cloudflare_pages_project.web.subdomain
  proxied = true
  comment = "Astro site (Cloudflare Pages)"
}

# Never reaches Pages: cloudflare_ruleset.www_redirect answers first.
resource "cloudflare_record" "www" {
  zone_id = data.cloudflare_zone.main.id
  name    = "www"
  type    = "CNAME"
  content = cloudflare_pages_project.web.subdomain
  proxied = true
  comment = "Redirects to apex"
}

resource "cloudflare_record" "notes" {
  zone_id = data.cloudflare_zone.main.id
  name    = "notes"
  type    = "CNAME"
  content = cloudflare_pages_project.notes.subdomain
  proxied = true
  comment = "Quartz notes (Cloudflare Pages)"
}

resource "cloudflare_record" "blog" {
  zone_id = data.cloudflare_zone.main.id
  name    = "blog"
  type    = "CNAME"
  content = cloudflare_pages_project.blog.subdomain
  proxied = true
  comment = "Astro blog (Cloudflare Pages)"
}

resource "cloudflare_ruleset" "www_redirect" {
  zone_id = data.cloudflare_zone.main.id
  name    = "Redirects"
  kind    = "zone"
  phase   = "http_request_dynamic_redirect"

  rules {
    description = "www.elimelt.com to elimelt.com"
    expression  = "(http.host eq \"www.${var.domain}\")"
    action      = "redirect"
    enabled     = true

    action_parameters {
      from_value {
        status_code           = 301
        preserve_query_string = true
        target_url {
          expression = "concat(\"https://${var.domain}\", http.request.uri.path)"
        }
      }
    }
  }
}

# =============================================================================
# More DNS Records for Tunnel
# =============================================================================

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

# static subdomain
resource "cloudflare_record" "static" {
  zone_id = data.cloudflare_zone.main.id
  name    = "static"
  type    = "CNAME"
  content = "${var.tunnel_id}.cfargotunnel.com"
  proxied = true
  comment = "Static file server"
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
# tech.sex Zone
# =============================================================================
# Separate zone, same Cloudflare account. Serves the tech.sex landing page
# from GitHub Pages (repo: elimelt/tech.sex).

data "cloudflare_zone" "tech_sex" {
  name = "tech.sex"
}

resource "cloudflare_record" "tech_sex_apex" {
  for_each = toset(local.github_pages_ips)
  zone_id  = data.cloudflare_zone.tech_sex.id
  name     = "tech.sex"
  type     = "A"
  content  = each.value
  proxied  = true
  comment  = "GitHub Pages - tech.sex landing page"
}

resource "cloudflare_record" "tech_sex_www" {
  zone_id = data.cloudflare_zone.tech_sex.id
  name    = "www"
  type    = "CNAME"
  content = "elimelt.github.io"
  proxied = true
  comment = "GitHub Pages - tech.sex landing page"
}

# =============================================================================
# CAA Records
# =============================================================================
# Only these CAs may issue for our zones. letsencrypt.org covers Caddy's ACME
# certs; pki.goog and ssl.com are the other CAs Cloudflare uses for edge certs.

locals {
  caa_issuers = ["letsencrypt.org", "pki.goog", "ssl.com"]
  caa_zones = {
    main     = data.cloudflare_zone.main
    tech_sex = data.cloudflare_zone.tech_sex
  }
  caa_records = {
    for pair in setproduct(keys(local.caa_zones), local.caa_issuers) :
    "${pair[0]}-${pair[1]}" => { zone = pair[0], issuer = pair[1] }
  }
}

resource "cloudflare_record" "caa" {
  for_each = local.caa_records
  zone_id  = local.caa_zones[each.value.zone].id
  # The zone apex by its full name; Cloudflare stores "@" that way, so "@"
  # here would force a replacement on every import.
  name    = local.caa_zones[each.value.zone].name
  type    = "CAA"
  comment = "Restrict certificate issuance"

  data {
    flags = 0
    tag   = "issue"
    value = each.value.issuer
  }
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
