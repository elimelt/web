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
   # infra/Caddyfile is tracked in git. Edit it in place; no copy step is needed.

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

## Backend Auto-Deploy

The backend deploy workflow runs from `.github/workflows/backend-deploy.yml`.

The active deploy target is the existing `elimelt.com` self-hosted runner with labels
`self-hosted`, `Linux`, `X64`, and `blink`. Public pull requests run only on GitHub-hosted
runners; the self-hosted runner is used only by the deploy job after merge/push to `main`.

Required host setup:

1. Keep a dedicated clean deploy clone on the host at `/home/elimelt/repos/web-deploy`.
2. Keep the production Compose env file at `/home/elimelt/repos/web-deploy/infra/.env`.
3. Keep the GitHub `backend` environment variable `BACKEND_DEPLOY_PATH` set to that clone path.
4. Optionally set `BACKEND_HEALTHCHECK_URL`; it defaults to `https://api.elimelt.com/health`.

On pushes to `main` that touch backend files, the workflow runs tests, updates the deploy clone to the pushed commit, rebuilds `public-api`, `internal-api`, and `python-sandbox`, reloads Caddy, and checks the API health endpoint.

Optional Dockerized runner:

This repo also includes a Compose service for a Dockerized self-hosted runner. Start it only if
you want to replace the existing host runner:

```bash
docker compose -f docker-compose.yml -f docker-compose.runner.yml --profile runner up -d github-runner
```

If you use the Dockerized runner, set `BACKEND_DEPLOY_PATH=/deploy/web` in the GitHub `backend`
environment because the host deploy clone is mounted into the runner container there.

## Manually operated (not wired to CI)

These pieces run only when someone starts them by hand:

- `docker-compose.runner.yml` + `github-runner/`: self-hosted GitHub runner.
- `systemd/homelab-backup.service` + `.timer` + `backup.sh`: host backups.
- `terraform/`: DNS and tunnel config.
- `.github/workflows/count-code.yaml`: manual dispatch.

Note: `infra/homepage/` has no in-repo deploy path. Its status is an open question.

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
│    Internal API (127.0.0.1:8080)                                            │
│                   ├──▶ AI Agents ──▶ chat channels via Redis pub/sub        │
│                   ├──▶ Python Sandbox (code execution)                      │
│                   └──▶ Notes Sync (GitHub → Postgres)                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Services

| Service | Port | Purpose |
|---------|------|---------|
| caddy | 80 | Reverse proxy (routes by hostname) |
| public-api | 10000 | Public API for elimelt.com |
| internal-api | 8080 localhost-only | AI agents, admin, notes sync |
| redis | 6379 | Pub/sub, caching |
| postgres | 5432 | Persistent storage (pgvector) |
| uptime-kuma | 3001 | Status monitoring |
| ollama | 11434 | LLM API (llm.elimelt.com) |
| speaches | 8000 | Whisper transcription API (transcribe.elimelt.com) |

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
POSTGRES_PASSWORD=changeme
AUGMENT_API_TOKEN=xxx          # optional: enables AI agents
GEMINI_API_KEY=xxx             # optional: enables Gemini agent
GITHUB_TOKEN=xxx               # optional: enables notes sync
INSTALL_EMBEDDINGS=0           # optional: set to 1 to install local semantic search model deps
```

The default API images do not install `sentence-transformers` or Torch. Notes search still supports
full-text and hybrid fallback; set `INSTALL_EMBEDDINGS=1` only if this host should generate/query
local semantic embeddings.
