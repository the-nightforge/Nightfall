# VPS ops — backend-only deploy (single instance)

Target: `160.191.244.11`, Ubuntu 24.04. Backend only (`NODE_ENV=production`,
`TRUST_PROXY=1` behind Nginx, `CORS_ORIGIN` = exact Vercel origin).
No public Postgres/Redis. Replace `masoi_dev_password` with a strong
production password (never commit it).

## 01 — Hardening (`01-hardening.sh`)

Idempotent: safe to re-run. Run as **root**:

```bash
scp ops/vps/01-hardening.sh root@160.191.244.11:/root/
ssh root@160.191.244.11 'chmod +x /root/01-hardening.sh; /root/01-hardening.sh'
```

It does: `apt update+upgrade`, timezone UTC, create `deploy` user (if
missing), UFW allow 22/80/443 + enable, install+enable fail2ban +
unattended-upgrades, optional 2G `/swapfile` when RAM < 2 GB and no swap.

### Manual step 1 — SSH key (REQUIRED before sshd hardening)

From your workstation (do NOT skip):

```bash
# generate once if needed
ssh-keygen -t ed25519 -C "deploy@ma-soi"
# copy to deploy user (enter deploy/root password when prompted)
ssh-copy-id deploy@160.191.244.11
# verify passwordless login works
ssh deploy@160.191.244.11 "whoami"
```

PowerShell alternative (no `ssh-copy-id`):

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh deploy@160.191.244.11 "mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys"
```

### Manual step 2 — sshd hardening guidance (do NOT lock yourself out)

1. SSH in as root (keep this session OPEN the whole time).
2. Confirm key login works in a **second terminal**: `ssh deploy@160.191.244.11`.
3. Only then, edit `/etc/ssh/sshd_config` on the VPS:
   - Set `PermitRootLogin prohibit-password` (keys only for root; password
     auth for root disabled).
   - Optionally set `PasswordAuthentication no` ONLY after key login is
     proven for `deploy` — otherwise you can lock yourself out.
   - Keep `PubkeyAuthentication yes`.
4. Validate + reload:
   ```bash
   sshd -t && systemctl reload sshd
   ```
5. **Test a NEW session** (`ssh deploy@160.191.244.11`) BEFORE closing the
   original root session. If the new session fails, fix config from the
   still-open root session.

> WARNING: closing your last working root session before testing key login
> can permanently lock you out of the VPS. Always test a new session first.

## 02 — Docker Engine (`02-docker.sh`)

Idempotent: safe to re-run. Run as **root**, after `01`:

```bash
scp ops/vps/02-docker.sh root@160.191.244.11:/root/
ssh root@160.191.244.11 'chmod +x /root/02-docker.sh; /root/02-docker.sh'
```

It does: add Docker's official apt repo for Ubuntu 24.04 (noble) with
keyring `/etc/apt/keyrings/docker.asc`, install `docker-ce`,
`docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`,
`docker-compose-plugin` (never the distro-packaged Docker; official repo
only),
`systemctl enable --now docker`, verify with
`docker --version && docker compose version`, and add `deploy` to the
`docker` group (if the user exists).

Afterwards `deploy` must log out and back in (or run `newgrp docker`)
before running `docker` without `sudo`.

## 03 — Production env + deploy (`03-deploy.sh`, `docker-compose.prod.yml`)

Idempotent: safe to re-run. Run **on the VPS** as `root` or `deploy`
(after `01` + `02`):

```bash
# one-time: checkout + env file
sudo mkdir -p /opt/masoi
sudo git clone <repo-url> --branch chore/vps-backend /opt/masoi/app
sudo cp /opt/masoi/app/ops/vps/.env.production.example /opt/masoi/.env
sudo chmod 600 /opt/masoi/.env
sudo nano /opt/masoi/.env   # replace EVERY REPLACE_ME (see below)

# every deploy (pulls, rebuilds server with GIT_COMMIT, restarts, health-checks)
/opt/masoi/app/ops/vps/03-deploy.sh
```

What it needs in `/opt/masoi/.env` (all from `.env.production.example`):

- `POSTGRES_PASSWORD` — strong random (`openssl rand -base64 32`); the
  same password must appear inside `DATABASE_URL`. The script refuses to
  deploy if `masoi_dev_password` is still present.
- `DATABASE_URL=postgresql://masoi:<STRONG>@postgres:5432/masoi?schema=public`
  (`postgres` = compose service DNS, NOT localhost).
- `REDIS_URL=redis://redis:6379`, `PORT=4100`, `NODE_ENV=production`,
  `CORS_ORIGIN=https://<your-app>.vercel.app` (exact origin, never `*` —
  the server throws at startup otherwise), `TRUST_PROXY=1` (behind Nginx).
- Optional sections (BOT/LiveKit/object-storage) stay commented/empty =
  disabled. Half-filled LiveKit or object-storage config makes the server
  FAIL at startup (fail-fast by design, same as dev).

What the prod compose file does
(`docker compose -f docker-compose.yml -f ops/vps/docker-compose.prod.yml`):

- `postgres` (`postgres:16-alpine`) + `redis` (`redis:7-alpine`): published
  ports CLEARED (`ports: !reset []` — plain `ports: []` would merge with the
  base dev mappings under multi-file merge and leave them reachable).
  Named volumes `masoi_pgdata` / `masoi_redisdata`.
- `server`: builds `Dockerfile.server`, exactly ONE container
  (`container_name` + `deploy.replicas: 1`, never `--scale`),
  `restart: unless-stopped`, `env_file: /opt/masoi/.env`, starts only after
  postgres AND redis are healthy. No `command:` — inherits the image CMD
  (`prisma migrate deploy` + `node`), so schema migrations run on every deploy.
- `minio`/`minio-init` (avatars): OFF by default (`avatars` profile). Plain
  `up` never starts them.
- Health: `GET /api/health` → `{ok:true, db:true}` when live (the script
  polls `http://127.0.0.1:$PORT/api/health` until both are true).

PORT note: the app listens on `$PORT` (`apps/server/src/config.ts`: `PORT`
wins over `SERVER_PORT`, default `4000`); production sets `PORT=4100`.
`Dockerfile.server`'s `EXPOSE 4000` is a stale no-op default (EXPOSE never
publishes) and is ignored at runtime — the compose mapping
`127.0.0.1:${PORT:-4100}:${PORT:-4100}` deliberately uses the same `$PORT`
on both sides. Nginx (later step) proxies `80/443 -> 127.0.0.1:4100`.

## 04 — Nginx + HTTPS (`04-nginx.sh`, `nginx-masoi-api.conf.template`)

Idempotent: safe to re-run. Run as **root**, after `03` (the backend must
already answer locally):

```bash
scp ops/vps/04-nginx.sh ops/vps/nginx-masoi-api.conf.template root@160.191.244.11:/root/
ssh root@160.191.244.11 'chmod +x /root/04-nginx.sh; API_DOMAIN=api.example.com EMAIL=ops@example.com PORT=4100 /root/04-nginx.sh'
```

First, create the DNS record (do this BEFORE running the script — certbot's
HTTP challenge must reach the VPS under the requested name):

- `A` record `api -> 160.191.244.11` (replace `api.example.com` with your
  real `API_DOMAIN` everywhere; the repo contains no real domain or email).
- Wait for propagation: `nslookup api.example.com` should return
  `160.191.244.11` before you run certbot.

What the script does: installs `nginx`, `certbot`,
`python3-certbot-nginx` (if missing) and enables nginx; renders the template
to `/etc/nginx/sites-available/masoi-api` with `server_name=$API_DOMAIN`
and `proxy_pass http://127.0.0.1:$PORT` (default `4100`, must match the
`PORT` in `/opt/masoi/.env`) including WebSocket `Upgrade`/`Connection`
headers, `X-Forwarded-Proto`, `client_max_body_size 5m`, and a long
`proxy_read_timeout 86400s` on `/socket.io/`; enables the site, runs
`nginx -t`, reloads; then runs
`certbot --nginx --non-interactive --agree-tos --redirect -m $EMAIL -d $API_DOMAIN`
only when `/etc/letsencrypt/live/$API_DOMAIN` does not exist yet (renewals
afterwards run via the certbot systemd timer).

No-domain checkpoint (DNS not ready yet, or no domain at all): verify the
backend directly on the box — the compose mapping binds loopback only, so
run this **on the VPS**, not from your workstation:

```bash
ssh root@160.191.244.11 'curl -fsS http://127.0.0.1:4100/api/health'
# expect {"ok":true,"db":true,...}
```

After DNS + script, verify from anywhere:

```bash
curl -fsS https://api.example.com/api/health
```

Validation note: `bash -n` passes on this workstation; `nginx -t` can only
meaningfully run on the VPS (no nginx here), so the script itself runs
`nginx -t` before every reload. Re-runs never clobber certbot's TLS blocks:
once the vhost contains `managed by Certbot`, the script keeps it (unless
the domain changed).

## 05 — Verify + end-to-end checklist + backups (`05-verify.sh`, `backup-cron.sh`)

`05-verify.sh` is read-only: run **on the VPS** as `root` or `deploy` after
`03` (+ `04` once Nginx exists):

```bash
/opt/masoi/app/ops/vps/05-verify.sh [API_DOMAIN]
# e.g. API_DOMAIN=api.example.com /opt/masoi/app/ops/vps/05-verify.sh
```

It checks: `postgres`/`redis` healthy, exactly ONE running `server`
container, local `GET http://127.0.0.1:$PORT/api/health` reports
`{"ok":true,"db":true}`, `nginx -t` passes, UFW allows 22/80/443 and hides
5432/6379 — plus the public `https://$API_DOMAIN/api/health` when a domain
is given. First failure exits non-zero with a `FAIL:` message.

End-to-end checklist (frontend on Vercel, backend on this VPS):

1. Vercel env: `NEXT_PUBLIC_SERVER_URL=https://api.example.com` with NO
   trailing slash (a trailing `/` breaks API/socket URL joining).
2. Open the app, create a room, add 8 bots, press Start — the game should
   deal roles and advance past Night 1 without errors.
3. WSS check: with the page open, the socket must stay on `wss://`
   (browser devtools → Network → WS → `socket.io` frames flowing); if it
   falls back to polling-only or drops, re-check the `/socket.io/`
   `Upgrade`/`Connection` headers and `proxy_read_timeout` in the vhost.
4. Re-run `05-verify.sh` with the domain — local AND public health green.

Nightly backups (`backup-cron.sh`): logical `pg_dump` (gzip) of the `masoi`
database to `/opt/masoi/backup-YYYY-MM-DD.sql.gz` (`chmod 600`), pruning
files older than 7 days. Live data lives in the `masoi_pgdata` docker
volume — the dump is portable SQL, not a volume snapshot; Redis
(ephemeral) and avatars (external object storage) are intentionally not
included. Install:

```bash
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/masoi/app/ops/vps/backup-cron.sh") | crontab -
crontab -l | grep backup-cron
```

Restore (on the VPS, `masoi-postgres` running):

```bash
gunzip -c /opt/masoi/backup-YYYY-MM-DD.sql.gz \
  | docker exec -i masoi-postgres psql -U masoi -d masoi
```
