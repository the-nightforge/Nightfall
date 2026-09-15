#!/usr/bin/env bash
# Backup Postgres hằng đêm. Cài vào cron của root:
#   0 3 * * * /opt/masoi/app/deploy/backup.sh >> /var/log/masoi-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/masoi/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

out="$BACKUP_DIR/masoi-$(date +%F-%H%M).sql.gz"

# pg_dump ghi ra stdout; nếu nó fail thì pipefail làm cả lệnh fail, không để lại
# file .gz rỗng mà tưởng là backup thành công.
docker exec masoi-postgres pg_dump -U masoi masoi | gzip > "$out"

# Dump rỗng hoặc gần rỗng = hỏng. gzip của file rỗng vẫn ~20 byte.
size=$(stat -c '%s' "$out")
if (( size < 1024 )); then
    echo "LỖI: backup chỉ $size byte, nhiều khả năng hỏng: $out" >&2
    exit 1
fi

echo "$(date -Is) backup OK: $out ($size byte)"

find "$BACKUP_DIR" -name 'masoi-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
