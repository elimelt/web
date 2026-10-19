#!/usr/bin/env bash
# Safe backend deploy: snapshot -> build -> smoke test -> replace -> health check -> rollback.
#
# Run from anywhere; it operates on the Compose project in infra/ (this script's parent dir).
# Environment:
#   HEALTHCHECK_URL   URL that must return 2xx after the deploy (default https://api.elimelt.com/health)
#   HEALTH_RETRIES    curl retry count (default 12, 5s apart)
#
# Safety properties:
#   * Currently running images are tagged <image>:previous before anything is built.
#   * New images must import their app (smoke test) before any container is replaced; a failure
#     leaves the old containers running.
#   * If replacing containers or the post-deploy health check fails, :previous is retagged and the
#     services are recreated from it with --no-build, and the script exits non-zero.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

SERVICES=(public-api internal-api sandbox-worker python-sandbox)
# service:module pairs that must be importable from the image's WORKDIR (/app).
SMOKE=("public-api:main" "internal-api:main_internal" "sandbox-worker:main_worker")
HEALTHCHECK_URL="${HEALTHCHECK_URL:-https://api.elimelt.com/health}"
HEALTH_RETRIES="${HEALTH_RETRIES:-12}"

log() { printf '==> %s\n' "$*"; }

# Image repository (no tag) that Compose uses for a service: its `image:` if set,
# otherwise Compose's default "<project>-<service>" for built images.
# (`docker compose config --images <svc>` also lists dependencies, in no fixed order.)
image_repo() {
  docker compose config --format json | python3 -c '
import json, sys
config, svc = json.load(sys.stdin), sys.argv[1]
image = config["services"][svc].get("image") or config["name"] + "-" + svc
print(image.rsplit(":", 1)[0] if ":" in image.rsplit("/", 1)[-1] else image)
' "$1"
}

# Tag whatever is running (or, failing that, the current :latest) as :previous.
snapshot() {
  local svc repo cid img
  for svc in "${SERVICES[@]}"; do
    repo="$(image_repo "$svc")"
    cid="$(docker compose ps -aq "$svc" | head -n1)"
    img=""
    if [ -n "$cid" ]; then
      img="$(docker inspect --format '{{.Image}}' "$cid")"
    elif docker image inspect "${repo}:latest" >/dev/null 2>&1; then
      img="${repo}:latest"
    fi
    if [ -n "$img" ]; then
      docker tag "$img" "${repo}:previous"
      log "snapshot ${svc}: ${repo}:previous"
    else
      log "snapshot ${svc}: nothing running yet, no rollback target"
    fi
  done
}

# Point :latest back at :previous for every service that has a snapshot.
restore_tags() {
  local svc repo
  for svc in "${SERVICES[@]}"; do
    repo="$(image_repo "$svc")"
    if docker image inspect "${repo}:previous" >/dev/null 2>&1; then
      docker tag "${repo}:previous" "${repo}:latest"
    fi
  done
}

smoke_test() {
  local pair svc mod
  for pair in "${SMOKE[@]}"; do
    svc="${pair%%:*}"
    mod="${pair#*:}"
    log "smoke test ${svc}: import ${mod}"
    docker compose run --rm --no-deps -T --entrypoint python "$svc" -c "import ${mod}"
  done
}

replace_containers() {
  # Called inside `if !`, where set -e is disabled, so every step needs an explicit `|| return 1`.
  docker compose up -d --no-build "${SERVICES[@]}" || return 1
  docker compose up -d caddy || return 1
  # Read the Caddyfile directly: replacing a bind-mounted file can leave the container on its old inode.
  docker compose exec -T caddy caddy reload --config /dev/stdin --adapter caddyfile < Caddyfile \
    || docker compose restart caddy || return 1
  docker compose ps public-api internal-api caddy || return 1
  log "health check ${HEALTHCHECK_URL}"
  curl --fail --silent --show-error --retry "$HEALTH_RETRIES" --retry-delay 5 --retry-all-errors \
    "$HEALTHCHECK_URL" >/dev/null || return 1
}

rollback() {
  log "ROLLBACK: restoring previous images"
  restore_tags
  docker compose up -d --no-build "${SERVICES[@]}"
  docker compose ps "${SERVICES[@]}" || true
}

snapshot

log "building images"
docker compose build "${SERVICES[@]}"

if ! smoke_test; then
  echo "::error::Smoke test failed; existing containers were left running." >&2
  restore_tags
  exit 1
fi

log "replacing containers"
if ! replace_containers; then
  echo "::error::Deploy or health check failed; rolling back." >&2
  rollback
  echo "::error::Deploy FAILED and was rolled back to the previous images." >&2
  exit 1
fi
log "deploy OK"
