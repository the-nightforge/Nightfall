# VPS Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa backend ma-soi-online lên VPS 160.191.244.11 (Ubuntu 24.04) chạy production single-instance.

**Architecture:** Docker Engine + infra Postgres/Redis via compose + backend image từ Dockerfile.server (1 replica) + Nginx reverse proxy HTTPS/WSS.

**Tech Stack:** Ubuntu 24.04, Docker Engine + Compose v2, Postgres 16-alpine, Redis 7-alpine, Node 20.19 (trong image), Nginx + Certbot.

**Spec:** `docs/superpowers/specs/2026-09-14-vps-backend-design.md`

## Global Constraints

- Single instance backend only — không scale replicas.
- `TRUST_PROXY=1` khi sau Nginx, `CORS_ORIGIN` là origin Vercel exact, không `*` ở production.
- `NODE_ENV=production`, health `GET /api/health` phải `{ok:true, db:true}`.
- Không expose Postgres/Redis ra Internet — bind 127.0.0.1 hoặc không publish.
- Thay toàn bộ password `masoi_dev_password` bằng pw mạnh production.

---

### Task 1: Hardening + update Ubuntu

**Files:**
- Modify: `/etc/ssh/sshd_config`
- Modify: UFW rules (via CLI)

**Interfaces:**
- Consumes: SSH root @160.191.244.11
- Produces: VPS updated, user deploy + firewall active

- [ ] **Step 1: Update hệ thống (361 gói đang pending)**

```bash
apt update && apt upgrade -y && apt autoremove -y
timedatectl set-timezone UTC
```

Run: trên VPS root. Expected: không lỗi, `lsb_release -a` vẫn Ubuntu 24.04.

- [ ] **Step 2: Tạo user deploy + SSH key**

```bash
adduser deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
# copy pubkey local lên:
# từ máy local: ssh-copy-id deploy@160.191.244.11
```

- [ ] **Step 3: UFW + fail2ban**

```bash
apt install -y ufw fail2ban unattended-upgrades
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
systemctl enable --now fail2ban
```

- [ ] **Step 4: Swap nếu RAM nhỏ (check `free -h`, nếu <2GB)**

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Task 2: Cài Docker Engine

**Files:**
- Create: `/opt/masoi/` workdir

- [ ] **Step 1: Cài Docker official**

```bash
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo $VERSION_CODENAME) stable" > /etc/apt/sources.list.d/docker.list
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker --version && docker compose version
systemctl enable --now docker
usermod -aG docker deploy
```

- [ ] **Step 2: Tạo thư mục deploy**

```bash
mkdir -p /opt/masoi && chown deploy:deploy /opt/masoi
```

### Task 3: Đưa code + chạy infra Postgres/Redis

**Files:**
- Create: `/opt/masoi/.env` (600)
- Modify: reuse `docker-compose.yml` từ repo

- [ ] **Step 1: Clone code (trên VPS, user deploy)**

```bash
sudo -u deploy bash
cd /opt/masoi
git clone <your-repo-url> app
cd app
git log --oneline -3
```

- [ ] **Step 2: Tạo .env production**

```bash
cat > /opt/masoi/.env <<'EOF'
POSTGRES_PASSWORD=<pw-manh-32-ky-tu>
DATABASE_URL=postgresql://masoi:<pw-manh-32-ky-tu>@postgres:5432/masoi?schema=public
REDIS_URL=redis://redis:6379
PORT=4100
NODE_ENV=production
CORS_ORIGIN=https://<ten-app>.vercel.app
TRUST_PROXY=1
EOF
chmod 600 /opt/masoi/.env
```

Lưu ý: `DATABASE_URL` dùng hostname `postgres` (docker network), không phải localhost. `CORS_ORIGIN` điền origin Vercel exact.

- [ ] **Step 3: Chạy infra**

```bash
cd /opt/masoi/app
docker compose up -d postgres redis
docker compose ps
docker compose logs postgres --tail 20
```

Expected: `masoi-postgres` healthy (`pg_isready -U masoi`).

- [ ] **Step 4: Build + chạy backend (1 replica)**

```bash
docker build -f Dockerfile.server --build-arg GIT_COMMIT=$(git rev-parse HEAD) -t masoi-server:$(git rev-parse --short HEAD) .
docker run -d --name masoi-server --restart unless-stopped \
  --network $(basename $(pwd))_default \
  -p 127.0.0.1:4100:4000 \
  --env-file /opt/masoi/.env \
  masoi-server:$(git rev-parse --short HEAD)
docker logs masoi-server --tail 100
curl -f http://127.0.0.1:4100/api/health
```

Nếu network name khác, dùng `docker network ls` và `docker compose` service thay vì `docker run` thủ công. Ưu tiên tạo `docker-compose.prod.yml` gộp server + infra nếu muốn `compose up -d` một lệnh.

### Task 4: Nginx + HTTPS (khi có domain)

- [ ] **Step 1: Cài Nginx + Certbot**

```bash
apt install -y nginx certbot python3-certbot-nginx
```

- [ ] **Step 2: Vhost cho api domain**

```nginx
# /etc/nginx/sites-available/masoi-api
server {
  listen 80;
  server_name api.<domain-cua-ban>;

  client_max_body_size 5m;

  location / {
    proxy_pass http://127.0.0.1:4100;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
ln -s /etc/nginx/sites-available/masoi-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d api.<domain-cua-ban>
```

- [ ] **Step 3: Test tạm khi chưa có domain**

```bash
curl -f http://160.191.244.11:4100/api/health || curl -f http://127.0.0.1:4100/api/health
```

Chưa domain thì Vercel chưa gọi được HTTPS — đây chỉ là checkpoint.

### Task 5: Verify production

- [ ] **Step 1: Health + version**

```bash
curl -s https://api.<domain>/api/health
# expect {"ok":true,"db":true,"redis":true}
```

- [ ] **Step 2: Vercel env**

```
NEXT_PUBLIC_SERVER_URL=https://api.<domain> (không trailing slash)
```

Redeploy web, mở web -> tạo phòng -> +bot đủ 8 -> start -> socket WSS connects.

- [ ] **Step 3: Backup cron**

```bash
docker exec masoi-postgres pg_dump -U masoi masoi | gzip > /opt/masoi/backup-$(date +%F).sql.gz
```

## Self-Review

- Spec coverage: hardening, Docker, infra, backend single-instance, Nginx/WSS, health, backup — đủ task.
- Placeholder scan: không TBD, lệnh cụ thể, chỉ còn `<pw>`, `<domain>`, `<repo-url>` là input của user.
- Type consistency: PORT 4100 map 127.0.0.1:4100->4000 khớp Dockerfile EXPOSE 4000 + .env PORT.
