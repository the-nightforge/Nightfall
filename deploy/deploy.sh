#!/usr/bin/env bash
# Build + chạy backend ma-soi-online trên VPS.
# Chạy lại được nhiều lần — dùng cho cả lần deploy đầu lẫn mỗi lần cập nhật.
#
#   bash /opt/masoi/app/deploy/deploy.sh
#
# Migration Prisma tự chạy trong entrypoint của container (Dockerfile.server),
# không cần gọi tay.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/masoi/app}"
ENV_FILE="${ENV_FILE:-/opt/masoi/.env}"
COMPOSE_FILE="$APP_DIR/deploy/docker-compose.prod.yml"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "LỖI: không thấy $ENV_FILE. Tạo từ deploy/env.production.example rồi chmod 600." >&2
    exit 1
fi

# .env chứa secret. 600 hoặc chặt hơn, chủ là root.
perms=$(stat -c '%a' "$ENV_FILE")
if [[ "$perms" != "600" && "$perms" != "400" ]]; then
    echo "LỖI: $ENV_FILE đang chmod $perms, phải là 600." >&2
    exit 1
fi

cd "$APP_DIR"

echo "==> Kéo code mới"
git fetch --all --prune
git pull --ff-only

GIT_COMMIT=$(git rev-parse HEAD)
IMAGE_TAG=$(git rev-parse --short HEAD)
export GIT_COMMIT IMAGE_TAG

echo "==> Build image masoi-server:$IMAGE_TAG (commit $GIT_COMMIT)"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build server

echo "==> Khởi động stack"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d

echo "==> Chờ health (tối đa 180s)"
deadline=$((SECONDS + 180))
until curl -fsS http://127.0.0.1:4100/api/health > /dev/null 2>&1; do
    if (( SECONDS > deadline )); then
        echo "LỖI: health check không xanh sau 180s. Log 100 dòng cuối:" >&2
        docker logs masoi-server --tail 100 >&2
        exit 1
    fi
    sleep 5
done

echo "==> Health:"
curl -sS http://127.0.0.1:4100/api/health
echo

echo "==> Dọn image cũ"
docker image prune -f

echo "==> Deploy xong: masoi-server:$IMAGE_TAG"
