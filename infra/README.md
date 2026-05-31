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
- Cloudflare account with domain
- `cloudflared` CLI installed

### Setup

1. **Start services:**
   ```bash
   cd infra
   cp .env.example .env
   # Edit .env with your secrets
   docker-compose up -d
   ```

2. **Configure Cloudflare Tunnel** (first time only):
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create homelab
   cloudflared tunnel route dns homelab status.elimelt.com
   cloudflared tunnel route dns homelab api.elimelt.com
   ```

3. **Create local config** (`cloudflared-config.yml`):
   ```yaml
   tunnel: <YOUR_TUNNEL_ID>
   credentials-file: ~/.cloudflared/<YOUR_TUNNEL_ID>.json

   ingress:
     - hostname: status.elimelt.com
       service: http://localhost:8080
     - hostname: api.elimelt.com
       service: http://localhost:8080
     - service: http_status:404
   ```

4. **Run the tunnel:**
   ```bash
   cloudflared tunnel --config cloudflared-config.yml run homelab
   ```

## Adding a New Service

1. **Add DNS route:**
   ```bash
   cloudflared tunnel route dns homelab myservice.elimelt.com
   ```

2. **Add to cloudflared-config.yml:**
   ```yaml
   - hostname: myservice.elimelt.com
     service: http://localhost:8080
   ```

3. **Add to Caddyfile:**
   ```
   @myservice host myservice.elimelt.com
   handle @myservice {
       reverse_proxy mycontainer:port
   }
   ```

4. **Reload:**
   ```bash
   docker exec caddy caddy reload --config /etc/caddy/Caddyfile
   # Restart cloudflared or send SIGHUP
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
