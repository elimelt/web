# Homelab Infrastructure

## Architecture

```
Internet → Cloudflare Tunnel → Caddy (reverse proxy) → Docker services
                                    ↓
                            status.elimelt.com → Uptime Kuma
                            api.elimelt.com    → Public API
```

## Quick Start

### Prerequisites

- Docker + docker-compose
- Terraform (for Cloudflare config)
- Cloudflare account with domain

### Initial Setup

1. **Configure Cloudflare (Terraform):**
   ```bash
   cd infra/terraform
   cp terraform.tfvars.example terraform.tfvars
   # Edit terraform.tfvars with your Cloudflare account ID

   export CLOUDFLARE_API_TOKEN="your-api-token"
   terraform init
   terraform apply

   # Get the tunnel token for Docker
   terraform output -raw tunnel_token
   ```

2. **Configure Docker:**
   ```bash
   cd infra
   cp .env.example .env
   cp Caddyfile.example Caddyfile

   # Add tunnel token from step 1
   echo "CLOUDFLARE_TUNNEL_TOKEN=<token>" >> .env

   docker-compose up -d
   ```

## Adding a New Service

1. **Add to Terraform** (`terraform/main.tf`):
   ```hcl
   # In cloudflare_tunnel_config.homelab.config:
   ingress_rule {
     hostname = "myservice.${var.domain}"
     service  = "http://caddy:80"
   }

   # Add DNS record:
   resource "cloudflare_record" "myservice" {
     zone_id = data.cloudflare_zone.main.id
     name    = "myservice"
     type    = "CNAME"
     content = "${cloudflare_tunnel.homelab.id}.cfargotunnel.com"
     proxied = true
   }
   ```

2. **Apply Terraform:**
   ```bash
   cd terraform && terraform apply
   ```

3. **Add to Caddyfile:**
   ```
   @myservice host myservice.elimelt.com
   handle @myservice {
       reverse_proxy mycontainer:port
   }
   ```

4. **Reload Caddy:**
   ```bash
   docker exec caddy caddy reload --config /etc/caddy/Caddyfile
   ```

## Common Commands

```bash
docker-compose logs -f [service]
docker-compose restart [service]
docker-compose down
docker exec -it postgres psql -U devuser -d devdb
docker exec -it redis redis-cli
```

---

## Detailed Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              INTERNET                                       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  CLOUDFLARE TUNNEL                                                          │
│  Handles TLS termination for *.elimelt.com                                  │
│  Routes: status.elimelt.com, api.elimelt.com → localhost:8080               │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  DOCKER: Caddy (reverse proxy)                                              │
│  Listens on: :80 (HTTP only - Cloudflare handles TLS)                       │
│                                                                             │
│    status.elimelt.com ──▶ uptime-kuma:3001                                  │
│    api.elimelt.com    ──▶ public-api:80 ──┬──▶ Redis (pub/sub, cache)       │
│                                           └──▶ Postgres (DB)                │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  INTERNAL SERVICES (not publicly exposed)                                   │
│                                                                             │
│    Internal API ──┬──▶ AI Agents ──▶ chat channels via Redis pub/sub        │
│                   ├──▶ Python Sandbox (code execution)                      │
│                   └──▶ Notes Sync (GitHub → Postgres)                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Port | Purpose |
|---------|------|---------|
| caddy | 80, 8080 | Reverse proxy (routes by hostname) |
| public-api | 10000 | Public API for elimelt.com |
| internal-api | - | AI agents, admin, notes sync |
| redis | 6379 | Pub/sub, caching |
| postgres | 5432 | Persistent storage (pgvector) |
| uptime-kuma | 3001 | Status monitoring |

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
POSTGRES_PASSWORD=changeme
AUGMENT_API_TOKEN=xxx          # optional: enables AI agents
GEMINI_API_KEY=xxx             # optional: enables Gemini agent
GITHUB_TOKEN=xxx               # optional: enables notes sync
```
