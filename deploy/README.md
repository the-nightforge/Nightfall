# Deploy lên VPS

Toàn bộ app chạy trên một VPS Ubuntu 24.04 (`160.191.244.11`). Không dùng Vercel.

**Đang chạy tại: https://masoionline.duckdns.org**

```
Người chơi ──HTTPS/WSS──> Nginx :443 (Let's Encrypt)
                             ├─ /api/*, /socket.io/*  ──> masoi-server :4100
                             └─ /*                    ──> masoi-web    :3000
                                                              │
                                              masoi-postgres + masoi-redis
                                              (chỉ bind 127.0.0.1)
```

Web và API **cùng một origin**, nên không có CORS giữa hai bên.

## Tệp trong thư mục này

| Tệp | Việc |
|---|---|
| `bootstrap-vps.sh` | Chạy một lần: update, swap, UFW, fail2ban, Docker, Nginx, Certbot |
| `docker-compose.prod.yml` | postgres + redis + server + web |
| `env.production.example` | Mẫu cho `/opt/masoi/.env` |
| `nginx/masoi.conf` | Vhost gộp một origin |
| `nginx/masoi-proxy.conf` | Snippet header proxy dùng chung |
| `deploy.sh` | Pull → build → up → chờ health |
| `backup.sh` | `pg_dump` hằng đêm, giữ 14 ngày |

## Cập nhật thường ngày

```bash
ssh masoi
bash /opt/masoi/app/deploy/deploy.sh
```

Migration Prisma tự chạy trong entrypoint container.

**Lưu ý:** `deploy.sh` build cả `web`. Nếu chỉ sửa backend thì nhanh hơn:

```bash
cd /opt/masoi/app && export IMAGE_TAG=$(git rev-parse --short HEAD)
docker compose -f deploy/docker-compose.prod.yml --env-file /opt/masoi/.env up -d --build server
```

## Dựng lại từ đầu

1. `bash bootstrap-vps.sh` (bằng root)
2. Tạo `/opt/masoi/.env` từ `env.production.example`, `chmod 600`
3. `git clone https://github.com/the-nightforge/Nightfall.git /opt/masoi/app`
4. Nginx:
   ```bash
   cp deploy/nginx/masoi-proxy.conf /etc/nginx/snippets/
   sed 's/THAY_BANG_DOMAIN/masoionline.duckdns.org/' deploy/nginx/masoi.conf \
       > /etc/nginx/sites-available/masoi
   ln -sf /etc/nginx/sites-available/masoi /etc/nginx/sites-enabled/masoi
   rm -f /etc/nginx/sites-enabled/default   # nó cũng khai default_server -> trùng
   nginx -t && systemctl reload nginx
   certbot --nginx -d masoionline.duckdns.org --redirect
   ```
5. `bash deploy/deploy.sh`
6. Cron backup: `0 3 * * * /opt/masoi/app/deploy/backup.sh >> /var/log/masoi-backup.log 2>&1`

## Kiểm tra sau deploy

```bash
docker ps                                            # cả 4 phải healthy
curl -sS https://masoionline.duckdns.org/api/health   # {"ok":true,"db":true,"redis":true}
curl -sS -o /dev/null -w '%{http_code}\n' https://masoionline.duckdns.org/   # 200

# Socket.IO phải lên được WebSocket thật, không rơi về long-polling
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  'https://masoionline.duckdns.org/socket.io/?EIO=4&transport=websocket'   # 101
```

## Những chỗ đã cắn một lần

- **`NEXT_PUBLIC_SERVER_URL` nướng vào bundle lúc build.** Năm chỗ trong
  `apps/web/src` đọc `process.env` trực tiếp, không có fallback same-origin. Đổi
  domain là **phải build lại image web**, sửa env runtime vô ích.
- **`next.config.ts` import `./src/lib/security-headers` lúc CHẠY.** `next start`
  biên dịch config rồi require từ `apps/web`, nên stage runner phải có cả
  `apps/web/src`. Thiếu thì build xanh mà container chết ngay.
- **Tên file learned policy đổi theo commit.** Kiểm tra bằng
  `find apps/server/assets -type f` rồi mới điền `BOT_POLICY_FILE`. Sai đường dẫn
  là server không khởi động (cố ý, để không âm thầm rơi về heuristic).
- **`rm /etc/nginx/sites-enabled/default`.** Nó cũng khai `default_server` nên
  để lại là nginx từ chối load.
- **Build web ngốn RAM.** Trên máy 2GB, `next build` chiếm ~70% RAM và tràn
  ~1GB swap. Chạy được nhưng chậm; nếu vướng thì bật `output: "standalone"`.

## Ràng buộc

- **Chỉ 1 replica server.** Room state nằm trong RAM, Redis chỉ là bản sao phục
  hồi. Hai container là người cùng phòng rơi vào hai tiến trình khác nhau.
- **Postgres/Redis không publish ra Internet.** Compose bind `127.0.0.1`. Đừng
  đổi thành `5433:5432` — Docker tự chọc thủng UFW, không hỏi ai.
- **`CORS_ORIGIN` không được là `*` ở production** — server ném lỗi lúc khởi động.
- **LiveKit và object storage: điền đủ hoặc bỏ trống hoàn toàn.** Điền một nửa
  thì server crash lúc khởi động. Cố ý, không phải bug.
- **Voice chat cần HTTPS.** `getUserMedia` bị chặn trên origin không bảo mật.

Sự cố Redis down / snapshot hỏng: xem `docs/operations-recovery.md`.
