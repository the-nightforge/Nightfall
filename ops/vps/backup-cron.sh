#!/usr/bin/env bash
#
# backup-cron.sh — Nightly logical backup of the ma-soi Postgres database.
#
# Single instance backend only. Run ON THE VPS as root or deploy (whoever runs
# it needs `docker` access). Idempotent: safe to re-run; each run writes one
# date-stamped file and prunes files older than 7 days.
#
# What it does:
#   1. docker exec masoi-postgres pg_dump -U masoi masoi | gzip >
#      /opt/masoi/backup-$(date +%F).sql.gz   (chmod 600)
#   2. Retention: delete /opt/masoi/backup-*.sql.gz older than 7 days
#      (find -mtime +7 -delete)
#
# Volumes note: live data lives in the `masoi_pgdata` docker volume. This
# script is a LOGICAL dump (portable SQL, good for restore/migration), NOT a
# volume snapshot — it does not back up the volume files themselves, and it
# does not cover redis (ephemeral cache/presence) or uploaded avatars (object
# storage lives outside the VPS by design).
#
# Restore (on the VPS, Postgres container running):
#   gunzip -c /opt/masoi/backup-YYYY-MM-DD.sql.gz \
#     | docker exec -i masoi-postgres psql -U masoi -d masoi
#
# Install as a nightly cron job (02:00 local — the VPS is on UTC):
#   (crontab -l 2>/dev/null; echo "0 2 * * * /opt/masoi/app/ops/vps/backup-cron.sh") | crontab -
# Verify:
#   crontab -l | grep backup-cron; ls -lh /opt/masoi/backup-*.sql.gz
#
set -euo pipefail

BACKUP_DIR="/opt/masoi"
KEEP_DAYS=7

log() { echo "[backup-cron] $*"; }
die() { echo "[backup-cron] ERROR: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker not found — run 02-docker.sh first."
docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "masoi-postgres" \
  || die "masoi-postgres container is not running — run 03-deploy.sh first."

mkdir -p "${BACKUP_DIR}"
STAMP="$(date +%F)"
OUT="${BACKUP_DIR}/backup-${STAMP}.sql.gz"

log "Dumping masoi database to ${OUT}..."
docker exec masoi-postgres pg_dump -U masoi masoi | gzip > "${OUT}.tmp"
chmod 600 "${OUT}.tmp"
mv -f "${OUT}.tmp" "${OUT}"
log "Wrote $(du -h "${OUT}" | cut -f1) to ${OUT}."

log "Pruning backups older than ${KEEP_DAYS} days..."
find "${BACKUP_DIR}" -maxdepth 1 -name 'backup-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete
log "Done. Current backups:"
ls -lh "${BACKUP_DIR}"/backup-*.sql.gz
