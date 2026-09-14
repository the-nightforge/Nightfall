#!/usr/bin/env bash
#
# 03-deploy.sh — Build + deploy the single-instance backend on the VPS.
#
# Single instance backend only. Run ON THE VPS (after 01 + 02) as root or
# deploy — whoever runs it needs `docker` access (root, or deploy in the
# docker group + a checkout they can write to).
#
# Idempotent: safe to re-run. Exits non-zero on any error (set -euo pipefail).
#
# Layout on the VPS:
#   /opt/masoi/app  — git checkout of this repo (branch chore/vps-backend)
#   /opt/masoi/.env — production env, chmod 600 (see
#                     ops/vps/.env.production.example)
#
# Usage:
#   /opt/masoi/app/ops/vps/03-deploy.sh
#
# What it does:
#   1. git pull --ff-only in /opt/masoi/app
#   2. Load /opt/masoi/.env (needed for compose interpolation:
#      POSTGRES_PASSWORD, PORT)
#   3. Build `server` with --build-arg GIT_COMMIT=<HEAD> (baked into the
#      image; /api/health reports it as `version`)
#   4. up -d postgres redis, wait healthy, then up -d server (one container)
#   5. Tail server logs, then poll http://127.0.0.1:$PORT/api/health until it
#      reports {"ok":true,"db":true} (or time out with the logs on screen)
#
# What it does NOT do:
#   - Nginx / TLS (later step), MinIO/avatars (OFF by default, `avatars`
#     profile), frontend deploy (Vercel).
#
set -euo pipefail

APP_DIR="/opt/masoi/app"
ENV_FILE="/opt/masoi/.env"
: "${HEALTH_TIMEOUT_S:=120}"

log() { echo "[03-deploy] $*"; }
die() { echo "[03-deploy] ERROR: $*" >&2; exit 1; }

# Wrapper so every compose call uses both files. POSTGRES_PASSWORD / PORT /
# GIT_COMMIT are exported below, which is what the prod file interpolates.
dc() {
  docker compose -f docker-compose.yml -f ops/vps/docker-compose.prod.yml "$@"
}

[ -d "${APP_DIR}/.git" ] || die "${APP_DIR} is not a git checkout — clone the repo there first."
[ -f "${ENV_FILE}" ] || die "${ENV_FILE} missing — copy ops/vps/.env.production.example to ${ENV_FILE}, chmod 600, and fill every REPLACE_ME."
command -v docker >/dev/null 2>&1 || die "docker not found — run 02-docker.sh first."
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing — run 02-docker.sh first."
command -v curl >/dev/null 2>&1 || die "curl not found — apt install curl."

# Never ship the dev credential: the base compose file uses it, and the prod
# override replaces it via ${POSTGRES_PASSWORD} — but only if the operator
# actually replaced it here.
if grep -q "masoi_dev_password" "${ENV_FILE}"; then
  die "${ENV_FILE} still contains masoi_dev_password — replace it with a strong production password."
fi

cd "${APP_DIR}"
log "Pulling latest in ${APP_DIR}..."
git pull --ff-only

# Export the production env for compose interpolation (POSTGRES_PASSWORD is
# referenced as ${POSTGRES_PASSWORD:?} in docker-compose.prod.yml; PORT as
# ${PORT:-4100}). Valid .env lines are simple KEY=value pairs (no spaces
# around `=`, quote values containing spaces or `#`).
set -a
# shellcheck disable=SC1090
. "${ENV_FILE}"
set +a
: "${PORT:=4100}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in ${ENV_FILE}}"

export GIT_COMMIT
GIT_COMMIT="$(git rev-parse HEAD)"
log "HEAD is ${GIT_COMMIT}."

log "Validating compose files..."
dc config >/dev/null

log "Building server (GIT_COMMIT=${GIT_COMMIT})..."
dc build --build-arg "GIT_COMMIT=${GIT_COMMIT}" server

log "Starting postgres + redis..."
dc up -d postgres redis

log "Waiting for postgres + redis health..."
ATTEMPTS=60
i=0
while [ "${i}" -lt "${ATTEMPTS}" ]; do
  healthy="$(dc ps --format json postgres redis 2>/dev/null | grep -c '"health":"healthy"' || true)"
  if [ "${healthy}" -ge 2 ]; then
    break
  fi
  i=$((i + 1))
  sleep 2
done
dc ps postgres redis || true

log "Starting server (single container)..."
dc up -d server

log "Recent server logs:"
dc logs --tail=50 server || true

HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
log "Polling ${HEALTH_URL} (up to ${HEALTH_TIMEOUT_S}s: migrate + boot take a while on first run)..."
deadline=$((SECONDS + HEALTH_TIMEOUT_S))
BODY=""
while [ "${SECONDS}" -lt "${deadline}" ]; do
  if BODY="$(curl -fsS --max-time 5 "${HEALTH_URL}" 2>/dev/null)"; then
    if printf '%s' "${BODY}" | grep -q '"ok":true' \
      && printf '%s' "${BODY}" | grep -q '"db":true'; then
      log "HEALTHY: ${BODY}"
      log "Done. Single-instance backend live; Nginx (later step) proxies 80/443 -> 127.0.0.1:${PORT}."
      exit 0
    fi
    log "Still booting (health not ok yet): ${BODY}"
  fi
  sleep 3
done

log "Health check TIMED OUT. Last body: ${BODY:-<no response>}"
log "Full tail for diagnosis:"
dc logs --tail=100 server || true
die "server did not become healthy at ${HEALTH_URL} within ${HEALTH_TIMEOUT_S}s."
