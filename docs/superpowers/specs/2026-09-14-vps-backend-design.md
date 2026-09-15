# VPS Backend Design — ma-soi-online (160.191.244.11)

Date: 2026-09-14
Status: Approved — Option A (Docker backend + infra + Nginx)
Scope: Backend only on VPS Ubuntu 24.04. Web stays on Vercel.

## 1. Architecture

```
Vercel (web, NEXT_PUBLIC_SERVER_URL=https://api.<domain>)
 -> HTTPS/WSS
 -> Nginx on VPS (80/443, Certbot)
 -> 127.0.0.1:4100 (masoi-server, 1 replica only)
 -> masoi-postgres:5432 + masoi-redis:6379 (docker network, not exposed publicly)
```

Constraints from repo:
- Single instance only (room state in RAM, Redis is recovery copy).
- `Dockerfile.server` exposes 4000, CMD runs `prisma migrate deploy` then `node apps/server/dist/index.js`.
- Health: `GET /api/health` must return `{ok:true, db:true, redis:true}`.
- `TRUST_PROXY=1` behind Nginx. `CORS_ORIGIN=https://<vercel-app>.vercel.app`.
- Node >=20.19. Infra versions: `postgres:16-alpine`, `redis:7-alpine`.

## 2. Hardening (Ubuntu 24.04 LTS)

- `apt update && apt upgrade -y` (361 pending on 2026-09-14 screenshot).
- Create sudo non-root user + SSH key, disable root password login (`PermitRootLogin prohibit-password` or `no` after key works).
- UFW: allow 22, 80, 443; deny others. Docker bypass note: bind infra ports to 127.0.0.1 or don't publish PG/Redis publicly.
- fail2ban (sshd), timezone UTC, unattended-upgrades, swap file if RAM <2GB.

## 3. Components

1. Docker Engine + Compose plugin (official repo, not distro docker.io).
2. Infra compose: postgres + redis (reuse `docker-compose.yml`, override passwords + bind to 127.0.0.1:5433/6380 for admin, or no published ports). MinIO optional — default OFF (leave `OBJECT_STORAGE_*` empty) unless avatars needed.
3. Backend container: built from `Dockerfile.server` with `--build-arg GIT_COMMIT`. Env file `/opt/masoi/.env` (600):
   `DATABASE_URL=postgresql://masoi:<strong-pw>@postgres:5432/masoi?schema=public`
   `REDIS_URL=redis://redis:6379`
   `PORT=4100`, `NODE_ENV=production`, `CORS_ORIGIN`, `TRUST_PROXY=1`, bot/LiveKit keys as needed.
4. Nginx reverse proxy with WebSocket upgrade for Socket.IO, `client_max_body_size 5m` (avatar upload), rate-limit basic on `/api/players`.

## 4. Data flow / Deploy

- Deploy: `git pull && docker build -f Dockerfile.server -t masoi-server:<sha> . && docker compose up -d`.
- Migration auto-runs in container entrypoint.
- Verify: `curl localhost:4100/api/health`, then `https://api.<domain>/api/health`.
- Backup: nightly `pg_dump` + volume backup for `masoi_pgdata`, Redis AOF persisted.

## 5. Error handling

- Redis down: health `200 degraded`, don't restart-loop (Render behavior preserved).
- Postgres down: `503`, container restart.
- Invalid Redis snapshot: quarantine key 24h, log `snapshot.invalid` (see `docs/operations-recovery.md`).

## 6. Testing / Acceptance

- `curl -f http://127.0.0.1:4100/api/health`
- Create room from Vercel web -> add 8 bots -> start match, socket connects via WSS.
- `docker logs masoi-server --tail 100` shows no Zod/TRUST_PROXY errors.

## Open (defaults if unanswered)

- Domain: temp IP:port works for test, but production needs `api.<domain>` + Certbot (Vercel HTTPS -> HTTP IP will fail CORS/mixed-content).
- MinIO: default OFF.
