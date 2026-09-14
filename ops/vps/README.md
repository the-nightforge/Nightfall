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
