#!/usr/bin/env bash
# Purge Cloudflare's edge cache for one hostname after publishing a site.
#
# Usage: infra/sites/purge-cache.sh <hostname>
#
# Reads CLOUDFLARE_API_TOKEN from the environment, or from $CLOUDFLARE_ENV_FILE
# (the deploy checkout's infra/.env). The token needs Zone → Cache Purge.
set -euo pipefail

host="${1:?hostname required}"
zone_name="${CLOUDFLARE_ZONE:-elimelt.com}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -n "${CLOUDFLARE_ENV_FILE:-}" ]]; then
  CLOUDFLARE_API_TOKEN="$(sed -n 's/^CLOUDFLARE_API_TOKEN=//p' "$CLOUDFLARE_ENV_FILE" | tr -d "\"'")"
fi
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is not set}"

api() {
  curl -fsS --retry 3 -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" "$@"
}

zone_id="$(api "https://api.cloudflare.com/client/v4/zones?name=${zone_name}" \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["result"][0]["id"])')"

api -X POST "https://api.cloudflare.com/client/v4/zones/${zone_id}/purge_cache" \
  --data "{\"hosts\":[\"${host}\"]}" \
  | python3 -c 'import json, sys; sys.exit(0 if json.load(sys.stdin)["success"] else 1)'
echo "Purged Cloudflare cache for ${host}"
