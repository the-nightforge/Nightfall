#!/usr/bin/env bash
#
# 05-verify.sh — Post-deploy verification for the single-instance backend.
#
# Single instance backend only. Run ON THE VPS (after 03 + 04) as root or
# deploy — whoever runs it needs `docker` access plus read access to
# /opt/masoi/.env (PORT). The nginx/ufw checks need root (or sudo).
#
# Idempotent: read-only, safe to re-run. Exits non-zero on the FIRST failed
# check with a clear message (set -euo pipefail + die()).
#
# What it checks:
#   1. postgres + redis containers are healthy (docker compose ps)
#   2. server is exactly ONE running container (single instance, never --scale)
#   3. GET http://127.0.0.1:$PORT/api/health reports {"ok":true,"db":true}
#   4. nginx -t passes
#   5. ufw allows 22/80/443 and does NOT expose 5432/6379
#   6. OPTIONAL: when API_DOMAIN is set (env or $1), the public
#      https://$API_DOMAIN/api/health also reports {"ok":true,"db":true}
#
# Usage (on the VPS):
#   /opt/masoi/app/ops/vps/05-verify.sh [API_DOMAIN]
#   API_DOMAIN=api.example.com /opt/masoi/app/ops/vps/05-verify.sh
#
set -euo pipefail

APP_DIR="/opt/masoi/app"
ENV_FILE="/opt/masoi/.env"
API_DOMAIN="${1:-${API_DOMAIN:-}}"

log() { echo "[05-verify] $*"; }
pass() { echo "[05-verify] PASS: $*"; }
die() { echo "[05-verify] FAIL: $*" >&2; exit 1; }

# Wrapper so every compose call uses both files (same pair as 03-deploy.sh).
dc() {
  docker compose -f docker-compose.yml -f ops/vps/docker-compose.prod.yml "$@"
}

[ -d "${APP_DIR}/.git" ] || die "${APP_DIR} is not a git checkout — clone the repo there first (see README §03)."
command -v docker >/dev/null 2>&1 || die "docker not found — run 02-docker.sh first."
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing — run 02-docker.sh first."
command -v curl >/dev/null 2>&1 || die "curl not found — apt install curl."

cd "${APP_DIR}"

# PORT comes from the production env file when present (same source the
# compose mapping interpolates); default 4100 matches docker-compose.prod.yml.
if [ -f "${ENV_FILE}" ]; then
  set -a
  # shellcheck disable=SC1090
  . "${ENV_FILE}"
  set +a
fi
: "${PORT:=4100}"

log "Checking containers (project: ${APP_DIR})..."

# postgres + redis must both report health "healthy". `dc ps --format json`
# prints one JSON object per line (older plugin versions) or a JSON array —
# either way grepping the per-service output for '"health":"healthy"' works.
for svc in postgres redis; do
  dc ps "${svc}" >/dev/null 2>&1 || die "'${svc}' container not found — run 03-deploy.sh first. (docker compose ps ${svc})"
  if dc ps --format json "${svc}" 2>/dev/null | grep -q '"health":"healthy"'; then
    pass "'${svc}' is healthy."
  else
    dc ps "${svc}" || true
    die "'${svc}' is not healthy. Inspect with: docker compose -f docker-compose.yml -f ops/vps/docker-compose.prod.yml logs --tail=50 ${svc}"
  fi
done

# Single instance: exactly one `server` container, and it must be running.
server_count="$(dc ps -q server 2>/dev/null | wc -l | tr -d ' ')"
[ "${server_count}" = "1" ] || {
  dc ps server || true
  die "expected exactly 1 server container, found ${server_count} — single instance only, never --scale."
}
server_state="$(dc ps server --format '{{.State}}' 2>/dev/null | head -n 1)"
[ "${server_state}" = "running" ] || {
  dc ps server || true
  die "server container is not running (state: '${server_state:-unknown}'). Check: dc logs --tail=100 server"
}
pass "server is a single running container."

HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
log "Checking local health at ${HEALTH_URL}..."
BODY="$(curl -fsS --max-time 10 "${HEALTH_URL}" 2>/dev/null)" \
  || die "curl failed for ${HEALTH_URL} — is the backend up? (PORT=${PORT}; check /opt/masoi/.env matches the compose mapping)"
printf '%s' "${BODY}" | grep -q '"ok":true' \
  || die "health body missing \"ok\":true — got: ${BODY}"
printf '%s' "${BODY}" | grep -q '"db":true' \
  || die "health body missing \"db\":true — got: ${BODY}"
pass "local health ok (ok:true, db:true): ${BODY}"

command -v nginx >/dev/null 2>&1 || die "nginx not found — run 04-nginx.sh first."
log "Testing nginx config..."
nginx -t || die "'nginx -t' failed — fix /etc/nginx/sites-available/masoi-api, then reload."
pass "nginx config valid."

command -v ufw >/dev/null 2>&1 || die "ufw not found — run 01-hardening.sh first."
log "Checking firewall..."
UFW_OUT="$(ufw status 2>/dev/null)" || die "'ufw status' failed — run as root (or with sudo)."
for port in 22 80 443; do
  printf '%s' "${UFW_OUT}" | grep -qE "^${port}(/tcp)?\\s+.*ALLOW" \
    || die "ufw does not ALLOW port ${port}. Expected 22/80/443 open. (ufw status output above.)"
done
if printf '%s' "${UFW_OUT}" | grep -qE '5432|6379'; then
  echo "${UFW_OUT}" >&2
  die "ufw exposes a database port (5432/6379 found in 'ufw status') — Postgres/Redis must stay private."
fi
pass "ufw allows 22/80/443 and hides 5432/6379."

if [ -n "${API_DOMAIN}" ]; then
  PUBLIC_URL="https://${API_DOMAIN}/api/health"
  log "Checking public health at ${PUBLIC_URL}..."
  PBODY="$(curl -fsS --max-time 15 "${PUBLIC_URL}" 2>/dev/null)" \
    || die "curl failed for ${PUBLIC_URL} — DNS/certbot/nginx? (dig ${API_DOMAIN}; nginx -t; journalctl -u nginx)"
  printf '%s' "${PBODY}" | grep -q '"ok":true' \
    || die "public health body missing \"ok\":true — got: ${PBODY}"
  printf '%s' "${PBODY}" | grep -q '"db":true' \
    || die "public health body missing \"db\":true — got: ${PBODY}"
  pass "public health ok (ok:true, db:true): ${PBODY}"
else
  log "Skipping public HTTPS check (API_DOMAIN unset). Pass a domain to include it: ./05-verify.sh api.example.com"
fi

log "All checks passed."
