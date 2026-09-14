#!/usr/bin/env bash
#
# 02-docker.sh — Install Docker Engine from the official Docker repo (Ubuntu 24.04 noble).
#
# Single instance backend only. Run as root AFTER 01-hardening.sh.
# Idempotent: safe to re-run. Exits non-zero on any error (set -euo pipefail).
#
# What it does:
#   1. Install prerequisites: ca-certificates, curl, gnupg (if missing)
#   2. Add Docker's official GPG key to /etc/apt/keyrings/docker.asc
#   3. Add Docker's official apt source (arch + VERSION_CODENAME, signed-by keyring)
#   4. apt update, then install: docker-ce docker-ce-cli containerd.io
#      docker-buildx-plugin docker-compose-plugin
#   5. systemctl enable --now docker
#   6. Verify: `docker --version && docker compose version`
#   7. Add `deploy` to the docker group (if the user exists)
#
# What it does NOT do:
#   - It NEVER installs the distro-packaged Docker from Ubuntu universe
#     (official Docker repo packages only).
#   - It does not deploy containers (later scripts handle compose/nginx/app).
#
# Usage:
#   scp ops/vps/02-docker.sh root@160.191.244.11:/root/
#   ssh root@160.191.244.11 'chmod +x /root/02-docker.sh; /root/02-docker.sh'
#   # deploy must log out + back in (or `newgrp docker`) for group membership.
#
set -euo pipefail

DEPLOY_USER="deploy"
KEYRING="/etc/apt/keyrings/docker.asc"
SOURCE_LIST="/etc/apt/sources.list.d/docker.list"
DOCKER_URL="https://download.docker.com/linux/ubuntu"

log() { echo "[02-docker] $*"; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: run as root (e.g. sudo ./02-docker.sh)" >&2
    exit 1
  fi
}

install_prereqs() {
  log "Installing prerequisites (ca-certificates curl gnupg)..."
  export DEBIAN_FRONTEND=noninteractive
  for pkg in ca-certificates curl gnupg; do
    if dpkg -s "${pkg}" >/dev/null 2>&1; then
      log "${pkg} already installed — skipping."
    else
      apt-get update -y
      apt-get install -y "${pkg}"
    fi
  done
}

add_docker_repo() {
  log "Adding Docker official GPG key + apt source..."
  install -m 0755 -d /etc/apt/keyrings
  if [ -s "${KEYRING}" ]; then
    log "${KEYRING} already present — skipping download."
  else
    curl -fsSL "${DOCKER_URL}/gpg" -o "${KEYRING}"
    log "Downloaded Docker GPG key to ${KEYRING}."
  fi
  chmod a+r "${KEYRING}"
  # shellcheck disable=SC1091
  . /etc/os-release
  arch="$(dpkg --print-architecture)"
  # NOTE: on Ubuntu 24.04 VERSION_CODENAME=noble. Sourced from /etc/os-release
  # so re-runs and rebuilds stay correct without hardcoding.
  expected="deb [arch=${arch} signed-by=${KEYRING}] ${DOCKER_URL} ${VERSION_CODENAME} stable"
  if [ -f "${SOURCE_LIST}" ] && grep -Fxq "${expected}" "${SOURCE_LIST}"; then
    log "${SOURCE_LIST} already correct — skipping."
  else
    echo "${expected}" | tee "${SOURCE_LIST}" > /dev/null
    log "Wrote ${SOURCE_LIST}: ${expected}"
  fi
}

install_docker() {
  log "apt update + install Docker Engine (official repo only, never the distro package)..."
  # Intentionally only the official packages below — never the distro package.
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

enable_docker() {
  log "Enabling + starting docker..."
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker
  else
    service docker start || true
  fi
}

verify_docker() {
  log "Verifying install..."
  docker --version
  docker compose version
}

add_deploy_to_docker_group() {
  if ! id "${DEPLOY_USER}" >/dev/null 2>&1; then
    log "User '${DEPLOY_USER}' missing — skipping docker group add (run 01-hardening.sh first)."
    return 0
  fi
  if id -nG "${DEPLOY_USER}" | tr ' ' '\n' | grep -qx docker; then
    log "User '${DEPLOY_USER}' already in docker group — skipping."
  else
    log "Adding '${DEPLOY_USER}' to docker group..."
    usermod -aG docker "${DEPLOY_USER}"
    log "Added. '${DEPLOY_USER}' must log out/in (or run 'newgrp docker') to pick it up."
  fi
}

main() {
  require_root
  install_prereqs
  add_docker_repo
  install_docker
  enable_docker
  verify_docker
  add_deploy_to_docker_group
  log "Done. Next: log out/in as deploy for docker group, then continue with 03."
}

main "$@"
