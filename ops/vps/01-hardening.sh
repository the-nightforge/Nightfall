#!/usr/bin/env bash
#
# 01-hardening.sh — Base hardening + OS updates for VPS 160.191.244.11 (Ubuntu 24.04).
#
# Single instance backend only. Run as root on a fresh Ubuntu 24.04 host.
# Idempotent: safe to re-run. Exits non-zero on any error (set -euo pipefail).
#
# What it does:
#   1. apt update + upgrade (non-interactive)
#   2. Set timezone to UTC
#   3. Create `deploy` user (if missing) with sudo + bash
#   4. UFW: allow 22/80/443, then enable (non-interactive)
#   5. Install + enable fail2ban and unattended-upgrades
#   6. Optional 2G /swapfile if total RAM < 2GB AND no swap active AND no /swapfile
#
# What it does NOT do (manual steps — see ops/vps/README.md):
#   - Copy your SSH public key (ssh-copy-id)
#   - Harden sshd_config (PermitRootLogin). Do that AFTER key login works,
#     and always test a NEW session before closing the root session.
#
# Usage:
#   scp ops/vps/01-hardening.sh root@160.191.244.11:/root/
#   ssh root@160.191.244.11 'chmod +x /root/01-hardening.sh; /root/01-hardening.sh'
#
set -euo pipefail

DEPLOY_USER="deploy"
TIMEZONE="UTC"
SWAPFILE="/swapfile"
SWAP_SIZE_MB=2048

log() { echo "[01-hardening] $*"; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: run as root (e.g. sudo ./01-hardening.sh)" >&2
    exit 1
  fi
}

apt_update_upgrade() {
  log "apt update + upgrade..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
  # Keep the package set tidy on re-runs; harmless if nothing to remove.
  apt-get autoremove -y || true
}

set_timezone() {
  log "Setting timezone to ${TIMEZONE}..."
  if command -v timedatectl >/dev/null 2>&1; then
    timedatectl set-timezone "${TIMEZONE}" || true
  else
    ln -sf "/usr/share/zoneinfo/${TIMEZONE}" /etc/localtime
    echo "${TIMEZONE}" > /etc/timezone
  fi
  # Idempotent NTP: install only if missing, enable if systemd present.
  if ! dpkg -s systemd-timesyncd >/dev/null 2>&1; then
    apt-get install -y systemd-timesyncd || true
  fi
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now systemd-timesyncd 2>/dev/null || true
  fi
}

create_deploy_user() {
  if id "${DEPLOY_USER}" >/dev/null 2>&1; then
    log "User '${DEPLOY_USER}' already exists — skipping creation."
  else
    log "Creating user '${DEPLOY_USER}'..."
    useradd -m -s /bin/bash "${DEPLOY_USER}"
  fi
  # Ensure sudo exists and deploy has passwordless-restricted sudo via group.
  if ! dpkg -s sudo >/dev/null 2>&1; then
    apt-get install -y sudo
  fi
  if ! id -nG "${DEPLOY_USER}" | tr ' ' '\n' | grep -qx sudo; then
    usermod -aG sudo "${DEPLOY_USER}"
  fi
  chmod 755 "/home/${DEPLOY_USER}" || true
  mkdir -p "/home/${DEPLOY_USER}/.ssh"
  chmod 700 "/home/${DEPLOY_USER}/.ssh"
  touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
}

configure_ufw() {
  if ! command -v ufw >/dev/null 2>&1; then
    log "Installing ufw..."
    apt-get install -y ufw
  fi
  # Idempotent rule adds: `ufw allow` is a no-op duplicate guard via `ufw status`.
  for rule in "22/tcp" "80/tcp" "443/tcp"; do
    if ufw status numbered 2>/dev/null | grep -q "${rule}"; then
      log "UFW rule ${rule} already present — skipping."
    else
      log "UFW allowing ${rule}..."
      ufw allow "${rule}"
    fi
  done
  # NOTE: no public Postgres/Redis — ports 5432/6379 are intentionally NOT opened.
  if ufw status 2>/dev/null | grep -q "Status: active"; then
    log "UFW already enabled — skipping enable."
  else
    log "Enabling UFW (non-interactive)..."
    ufw --force enable
  fi
  ufw status verbose || true
}

install_security_services() {
  log "Installing fail2ban + unattended-upgrades (if missing)..."
  for pkg in fail2ban unattended-upgrades; do
    if dpkg -s "${pkg}" >/dev/null 2>&1; then
      log "${pkg} already installed — skipping."
    else
      apt-get install -y "${pkg}"
    fi
  done
  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now fail2ban 2>/dev/null || service fail2ban start || true
    systemctl enable --now unattended-upgrades 2>/dev/null || true
  else
    service fail2ban start || true
  fi
  # Ensure automatic security updates config exists (package ships a default;
  # only write ours if the conf.d file is absent so re-runs never clobber).
  if [ ! -f /etc/apt/apt.conf.d/51-unattended-upgrades-local ]; then
    cat > /etc/apt/apt.conf.d/51-unattended-upgrades-local <<'EOF'
Unattended-Upgrade::Automatic-Reboot "false";
EOF
  fi
  log "fail2ban + unattended-upgrades enabled."
}

maybe_create_swap() {
  # Skip if any swap already active.
  if [ -n "$(swapon --show=NAME --noheadings 2>/dev/null || true)" ]; then
    log "Swap already active — skipping swap creation."
    return 0
  fi
  if [ -f "${SWAPFILE}" ]; then
    log "${SWAPFILE} already exists but is inactive — enabling."
    chmod 600 "${SWAPFILE}"
    swapon "${SWAPFILE}" || true
    grep -q "${SWAPFILE}" /etc/fstab 2>/dev/null || echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab
    return 0
  fi
  mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  mem_mb="$((mem_kb / 1024))"
  log "Total RAM: ${mem_mb} MB."
  if [ "${mem_mb}" -ge 2048 ]; then
    log "RAM >= 2GB — skipping swap creation."
    return 0
  fi
  log "RAM < 2GB and no swap — creating 2G ${SWAPFILE}..."
  fallocate -l "${SWAP_SIZE_MB}M" "${SWAPFILE}" || dd if=/dev/zero of="${SWAPFILE}" bs=1M count="${SWAP_SIZE_MB}" status=progress
  chmod 600 "${SWAPFILE}"
  mkswap "${SWAPFILE}"
  swapon "${SWAPFILE}"
  grep -q "${SWAPFILE}" /etc/fstab 2>/dev/null || echo "${SWAPFILE} none swap sw 0 0" >> /etc/fstab
  log "Swap created and enabled."
}

main() {
  require_root
  apt_update_upgrade
  set_timezone
  create_deploy_user
  configure_ufw
  install_security_services
  maybe_create_swap
  log "Done. Next: copy SSH key + sshd hardening per ops/vps/README.md."
}

main "$@"
