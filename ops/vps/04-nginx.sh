#!/usr/bin/env bash
#
# 04-nginx.sh — Nginx reverse proxy + HTTPS (certbot) for the ma-soi backend.
#
# Single instance backend only. Run as root on the VPS (after 01 + 02 + 03).
# Idempotent: safe to re-run. Exits non-zero on any error (set -euo pipefail).
#
# What it does:
#   1. Install nginx, certbot, python3-certbot-nginx (if missing), enable nginx
#   2. Render ops/vps/nginx-masoi-api.conf.template to
#      /etc/nginx/sites-available/masoi-api with:
#        server_name = $API_DOMAIN, proxy_pass http://127.0.0.1:$PORT
#        (PORT defaults to 4100), WebSocket Upgrade/Connection headers,
#        X-Forwarded-Proto, client_max_body_size 5m
#   3. Symlink sites-enabled/masoi-api, `nginx -t`, reload nginx
#   4. Run `certbot --nginx` once — skipped when
#      /etc/letsencrypt/live/$API_DOMAIN already exists
#
# What it does NOT do:
#   - DNS (create the A record first — see ops/vps/README.md §04)
#   - Backend deploy (03), frontend deploy (Vercel)
#
# Usage (no domains or emails are stored in this repo — pass them at runtime):
#   scp ops/vps/04-nginx.sh ops/vps/nginx-masoi-api.conf.template root@160.191.244.11:/root/
#   ssh root@160.191.244.11 'chmod +x /root/04-nginx.sh; API_DOMAIN=api.example.com EMAIL=ops@example.com PORT=4100 /root/04-nginx.sh'
# Or with positional args:
#   ssh root@160.191.244.11 '/root/04-nginx.sh api.example.com ops@example.com [4100]'
#
set -euo pipefail

API_DOMAIN="${1:-${API_DOMAIN:-}}"
EMAIL="${2:-${EMAIL:-}}"
PORT="${3:-${PORT:-4100}}"

SITE_NAME="masoi-api"
TEMPLATE_CANDIDATES=()
VHOST_DEST="/etc/nginx/sites-available/${SITE_NAME}"
VHOST_LINK="/etc/nginx/sites-enabled/${SITE_NAME}"

log() { echo "[04-nginx] $*"; }
die() { echo "[04-nginx] ERROR: $*" >&2; exit 1; }

[ -n "${API_DOMAIN}" ] || die "API_DOMAIN is required (env or \$1), e.g. API_DOMAIN=api.example.com."
# Minimal sanity check: a bare hostname, not a URL or wildcard.
case "${API_DOMAIN}" in
  *[!A-Za-z0-9.-]* | *..* | .* | *.) die "API_DOMAIN '${API_DOMAIN}' is not a plain hostname." ;;
esac

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "run as root (e.g. sudo ./04-nginx.sh)."
  fi
}

find_template() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  TEMPLATE_CANDIDATES=(
    "${script_dir}/nginx-masoi-api.conf.template"
    "/root/nginx-masoi-api.conf.template"
    "/opt/masoi/app/ops/vps/nginx-masoi-api.conf.template"
  )
  local cand
  for cand in "${TEMPLATE_CANDIDATES[@]}"; do
    if [ -f "${cand}" ]; then
      printf '%s' "${cand}"
      return 0
    fi
  done
  die "nginx template not found. Looked in: ${TEMPLATE_CANDIDATES[*]} — copy nginx-masoi-api.conf.template next to this script."
}

install_packages() {
  log "Installing nginx + certbot (if missing)..."
  export DEBIAN_FRONTEND=noninteractive
  local missing=()
  local pkg
  for pkg in nginx certbot python3-certbot-nginx; do
    if dpkg -s "${pkg}" >/dev/null 2>&1; then
      log "${pkg} already installed — skipping."
    else
      missing+=("${pkg}")
    fi
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    apt-get update -y
    apt-get install -y "${missing[@]}"
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now nginx
  else
    service nginx start || true
  fi
}

render_vhost() {
  local template="$1"
  local rendered
  rendered="$(mktemp)"
  # Substitute ONLY our two placeholders so Nginx $variables ($host,
  # $remote_addr, ...) survive rendering.
  if command -v envsubst >/dev/null 2>&1; then
    API_DOMAIN="${API_DOMAIN}" PORT="${PORT}" envsubst '$API_DOMAIN $PORT' < "${template}" > "${rendered}"
  else
    sed -e "s|\${API_DOMAIN}|${API_DOMAIN}|g" -e "s|\${PORT}|${PORT}|g" "${template}" > "${rendered}"
  fi
  printf '%s' "${rendered}"
}

install_vhost() {
  local template="$1"
  local rendered
  rendered="$(render_vhost "${template}")"
  # Never clobber certbot's TLS blocks on re-runs: once certbot has edited
  # the vhost ("managed by Certbot"), keep it unless the domain changed.
  if [ -f "${VHOST_DEST}" ] && grep -q "managed by Certbot" "${VHOST_DEST}"; then
    if grep -q "server_name.*${API_DOMAIN}" "${VHOST_DEST}"; then
      log "${VHOST_DEST} already managed by Certbot for ${API_DOMAIN} — keeping TLS blocks."
      rm -f "${rendered}"
      return 0
    fi
    log "Domain changed (vhost is for another host) — re-rendering fresh template."
  fi
  if [ -f "${VHOST_DEST}" ] && cmp -s "${rendered}" "${VHOST_DEST}"; then
    log "${VHOST_DEST} already up to date — skipping write."
  else
    log "Writing ${VHOST_DEST} (server_name=${API_DOMAIN}, backend=127.0.0.1:${PORT})..."
    cp "${rendered}" "${VHOST_DEST}"
    chmod 644 "${VHOST_DEST}"
  fi
  rm -f "${rendered}"
  if [ ! -L "${VHOST_LINK}" ]; then
    log "Enabling site ${SITE_NAME}..."
    ln -sf "${VHOST_DEST}" "${VHOST_LINK}"
  else
    log "Site ${SITE_NAME} already enabled — skipping."
  fi
}

test_and_reload() {
  log "Testing nginx config..."
  nginx -t
  log "Reloading nginx..."
  if command -v systemctl >/dev/null 2>&1; then
    systemctl reload nginx
  else
    service nginx reload
  fi
}

obtain_cert() {
  local live_dir="/etc/letsencrypt/live/${API_DOMAIN}"
  if [ -d "${live_dir}" ]; then
    log "Certificate for ${API_DOMAIN} already exists (${live_dir}) — skipping certbot."
    log "Renewals run via the certbot systemd timer; verify with: systemctl list-timers | grep -i certbot"
    return 0
  fi
  [ -n "${EMAIL}" ] || die "No certificate for ${API_DOMAIN} yet — EMAIL is required for first issuance (env or \$2)."
  log "Obtaining Let's Encrypt certificate for ${API_DOMAIN}..."
  certbot --nginx --non-interactive --agree-tos --redirect -m "${EMAIL}" -d "${API_DOMAIN}"
  log "Certificate issued. Verify: curl -fsS https://${API_DOMAIN}/api/health"
}

main() {
  require_root
  local template
  template="$(find_template)"
  log "Using template ${template}."
  install_packages
  install_vhost "${template}"
  test_and_reload
  obtain_cert
  log "Done. Backend should now answer at https://${API_DOMAIN}/api/health"
  log " (TRUST_PROXY=1 + exact CORS_ORIGIN were already set in step 03)."
}

main "$@"
