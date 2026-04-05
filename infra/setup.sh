#!/bin/bash
set -e

echo "DevStack Setup"
echo ""

command -v docker >/dev/null 2>&1 || { echo "Error: docker required"; exit 1; }
command -v docker-compose >/dev/null 2>&1 || command -v docker compose >/dev/null 2>&1 || { echo "Error: docker-compose required"; exit 1; }

[ ! -f .env ] && cp .env.example .env && echo "Created .env"
[ ! -f traefik-config.yml ] && cp traefik-config.yml.example traefik-config.yml && echo "Created traefik-config.yml"

mkdir -p certs logs homepage jupyter/{config,workspace} tailscale/state code-server/config grafana/{datasources,dashboards}
echo "Created directories"
echo ""

NEEDS_CONFIG=false

if grep -q "tskey-auth-\.\.\." .env 2>/dev/null; then
    echo "Configure TAILSCALE_AUTHKEY (https://login.tailscale.com/admin/settings/keys)"
    NEEDS_CONFIG=true
fi

if grep -q "tail12345.ts.net" .env 2>/dev/null; then
    echo "Update TAILSCALE_DOMAIN"
    NEEDS_CONFIG=true
fi

if grep -q '\$\$2y\$\$05\$\$\.\.\.' .env 2>/dev/null; then
    echo "Configure BASIC_AUTH_USERS"
    NEEDS_CONFIG=true
fi

if grep -q "CHANGE_ME" .env 2>/dev/null; then
    echo "Update database passwords in .env"
    NEEDS_CONFIG=true
fi

if grep -q "your-domain.tail12345.ts.net" traefik-config.yml 2>/dev/null; then
    echo "Update certificate paths in traefik-config.yml"
    NEEDS_CONFIG=true
fi

echo ""
if [ "$NEEDS_CONFIG" = true ]; then
    echo "Configuration required:"
    echo "1. Edit .env"
    echo "2. Get certificates: tailscale cert <domain>"
    echo "3. Copy certificates to ./certs/"
    echo "4. Update traefik-config.yml"
    echo "5. Run: docker-compose up -d"
else
    echo "Configuration complete"
    echo "Start: docker-compose up -d"
    echo "Logs: docker-compose logs -f"
fi
echo ""

