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

compose() {
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# Tag đang chạy, để lùi về nếu bản mới không lên. Rỗng ở lần deploy đầu tiên.
PREV_TAG=$(docker inspect --format '{{.Config.Image}}' masoi-server 2>/dev/null | sed 's/^masoi-server://' || true)

# Lùi về image cũ rồi báo lỗi. Migration đã chạy thì KHÔNG lùi được: code cũ
# phải chạy được trên schema mới, tức là migration phải chỉ-thêm (xem
# deploy/README.md).
rollback_and_fail() {
    echo "LỖI: $1" >&2
    if [[ -n "$PREV_TAG" && "$PREV_TAG" != "$IMAGE_TAG" ]]; then
        echo "==> Lùi về masoi-server/masoi-web:$PREV_TAG" >&2
        IMAGE_TAG="$PREV_TAG" compose up -d --no-build
    fi
    exit 1
}

echo "==> Build image masoi-server + masoi-web:$IMAGE_TAG (commit $GIT_COMMIT)"
# Build CẢ HAI trước khi chờ: build web mất ~10 phút trên VPS 2GB, và khoảng
# đó không được tính vào thời gian ván đang chạy phải đợi.
compose build server web

DRAIN_MAX_SECONDS="${DRAIN_MAX_SECONDS:-900}"
echo "==> Chờ ván đang chạy kết thúc (tối đa ${DRAIN_MAX_SECONDS}s)"
deadline=$((SECONDS + DRAIN_MAX_SECONDS))
while :; do
    active=$(curl -fsS --max-time 5 http://127.0.0.1:4100/api/health 2>/dev/null \
        | grep -o '"activeGames":[0-9]*' | cut -d: -f2 || true)
    # Không đọc được (server cũ chưa có trường này, hoặc đang chết) thì không
    # có gì để chờ.
    if [[ -z "$active" || "$active" == "0" ]]; then
        break
    fi
    if (( SECONDS > deadline )); then
        echo "    hết giờ chờ, còn $active ván - deploy tiếp, ván sẽ được khôi phục từ Redis"
        break
    fi
    echo "    còn $active ván, chờ 30s"
    sleep 30
done

echo "==> Khởi động stack"
compose up -d --no-build || rollback_and_fail "compose up thất bại"

echo "==> Chờ health (tối đa 180s)"
deadline=$((SECONDS + 180))
until curl -fsS http://127.0.0.1:4100/api/health > /dev/null 2>&1; do
    if (( SECONDS > deadline )); then
        docker logs masoi-server --tail 100 >&2 || true
        rollback_and_fail "health check không xanh sau 180s"
    fi
    sleep 5
done

echo "==> Health:"
curl -sS http://127.0.0.1:4100/api/health
echo

# Web khởi động SAU server (depends_on: service_healthy), nên lúc vòng lặp trên
# vừa xanh thì `next start` mới đang bật. Không chờ nó thì `deploy.sh` trả về
# trong khi Nginx vẫn 502 cho mọi request vào `/` - deploy coi như xong mà trang
# chưa lên. Đã gặp thật: CI đỏ ở bước kiểm tra ngoài với curl 502.
echo "==> Chờ web (tối đa 120s)"
deadline=$((SECONDS + 120))
until curl -fsS -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; do
    if (( SECONDS > deadline )); then
        docker logs masoi-web --tail 100 >&2 || true
        rollback_and_fail "web không phục vụ sau 120s"
    fi
    sleep 5
done
echo "    web sẵn sàng"

# `image prune` chỉ dọn image KHÔNG có tag, mà mỗi lần deploy lại gắn một tag
# mới - không có bước dưới thì đĩa VPS đầy dần theo từng lần push. Giữ 3 bản
# mới nhất: bản đang chạy, bản để lùi, và một bản dự phòng.
echo "==> Dọn image cũ (giữ 3 bản mới nhất mỗi loại)"
for repo in masoi-server masoi-web; do
    docker images "$repo" --format '{{.Repository}}:{{.Tag}}' | tail -n +4 | xargs -r docker rmi || true
done
docker image prune -f

echo "==> Deploy xong: masoi-server:$IMAGE_TAG"
