# Hướng dẫn build — web và server

Cài đặt lần đầu và biến môi trường: xem [Quick start trong README](README.md#quick-start).
Deploy lên VPS: xem [deploy/README.md](deploy/README.md).

## TL;DR

```bash
npm run build          # build tất cả: shared -> engine -> server -> web
npm run build:deps     # chỉ shared + engine (bắt buộc trước khi dev)
```

```bash
# Production trên VPS
ssh masoi 'bash /opt/masoi/app/deploy/deploy.sh'
```

---

## 1. Thứ tự build và vì sao nó bắt buộc

Repo là monorepo bốn workspace, phụ thuộc một chiều:

```
packages/shared  ──┐
                   ├──> apps/server
packages/game-engine ──> apps/web
```

`packages/shared/package.json` khai `"main": "dist/index.js"` — tức `apps/server`
và `apps/web` import **kết quả biên dịch**, không phải mã nguồn TypeScript. Nên
`dist/` của hai package kia phải tồn tại trước, nếu không server và web không
resolve nổi `@masoi/shared`.

Đó là lý do có `build:deps`:

```bash
npm run build:deps     # = build:shared && build:engine
```

Script `npm run build` đã gọi đúng thứ tự này rồi. Nhưng **`dev:server` và
`dev:web` thì không** — chúng không có bước `pre`. Chạy `npm run dev:server` trên
repo mới clone sẽ lỗi `Cannot find module '@masoi/shared'`. Chạy `build:deps` một
lần là xong, sau đó `tsx watch` tự theo dõi thay đổi.

| Lệnh | Làm gì |
|---|---|
| `npm run build:shared` | `packages/shared` → `dist/` |
| `npm run build:engine` | `packages/game-engine` → `dist/` |
| `npm run build:server` | `apps/server` → `dist/` (tsc) |
| `npm run build:web` | `apps/web` → `.next/` (next build) |
| `npm run build:deps` | shared + engine |
| `npm run build` | cả bốn, đúng thứ tự |

## 2. Chạy ở máy local

```bash
npm install
npm run build:deps        # BẮT BUỘC trước lần dev đầu tiên
npm run dev:infra         # Postgres :5433, Redis :6380, MinIO :9000
npm run db:migrate        # tạo schema
```

Rồi mở hai terminal:

```bash
npm run dev:server        # tsx watch, cổng 4100
npm run dev:web           # next dev, cổng 3000
```

Cần `.env` ở gốc repo — copy từ `.env.example` là chạy được ngay, nó điền sẵn
giá trị khớp với `docker-compose.yml`.

Sửa `packages/shared` hoặc `packages/game-engine` trong lúc dev thì phải chạy
`npm run build:deps` lại — `tsx watch` chỉ theo dõi `apps/server/src`, không theo
dõi `dist/` của package khác.

### Kiểm tra trước khi commit

```bash
npm run lint       # tsc --noEmit cho cả bốn workspace
npm test           # unit test, tự chạy build:deps trước
npm run test:e2e   # cần dev:infra đang chạy
```

## 3. Build production (Docker image)

Hai image độc lập, cùng build từ gốc repo:

| Image | Dockerfile | Chạy | Cổng |
|---|---|---|---|
| `masoi-server` | `Dockerfile.server` | `node apps/server/dist/index.js` | 4100 |
| `masoi-web` | `Dockerfile.web` | `next start` | 3000 |

Cả hai dùng multi-stage: stage `builder` cài đủ devDependencies để biên dịch,
stage `runner` chỉ nhận kết quả biên dịch cùng `node_modules` đã
`npm prune --omit=dev`.

### Cách thường dùng

```bash
ssh masoi 'bash /opt/masoi/app/deploy/deploy.sh'
```

Script tự làm: `git pull` → build → `up -d` → chờ `/api/health` xanh → dọn image
mồ côi. Health không xanh trong 180 giây thì nó in 100 dòng log cuối rồi thoát
lỗi, không để bạn tưởng đã thành công.

### Chỉ sửa backend — bỏ qua nhánh web

```bash
ssh masoi 'cd /opt/masoi/app && git pull --ff-only \
  && export IMAGE_TAG=$(git rev-parse --short HEAD) \
  && docker compose -f deploy/docker-compose.prod.yml \
     --env-file /opt/masoi/.env up -d --build server'
```

### Build tay một image

```bash
docker build -f Dockerfile.server \
  --build-arg GIT_COMMIT=$(git rev-parse HEAD) \
  -t masoi-server:$(git rev-parse --short HEAD) .

docker build -f Dockerfile.web \
  --build-arg NEXT_PUBLIC_SERVER_URL=https://masoionline.duckdns.org \
  -t masoi-web:$(git rev-parse --short HEAD) .
```

> **`NEXT_PUBLIC_SERVER_URL` là build-arg, không phải biến runtime.** Năm chỗ
> trong `apps/web/src` đọc `process.env.NEXT_PUBLIC_SERVER_URL` trực tiếp và
> không có fallback same-origin, nên Next nướng thẳng giá trị vào bundle lúc
> build. Đổi domain mà chỉ sửa `.env` rồi restart container thì **không có tác
> dụng** — phải build lại image web.

## 4. Cache: khi nào build nặng, khi nào không

Docker băm nội dung file để quyết định dùng lại layer. Layer trong hai Dockerfile
xếp theo thứ tự ít-đổi-trước, nên chi phí phụ thuộc bạn sửa cái gì.

Đo thật trên VPS (2 vCPU / 2 GB RAM), build lại khi code **không đổi**:

| Image | Thời gian | Layer dùng cache |
|---|---|---|
| server | **4 giây** | 27 |
| web | **2 giây** | 27 |

`next build` không chạy lại chút nào. Bảng đầy đủ:

| Bạn sửa | Hậu quả | Thời gian |
|---|---|---|
| Không sửa gì (chỉ đổi tag) | cache hết | vài giây |
| Chỉ `apps/server` | server chạy lại `tsc`; web cache toàn bộ | ~1–2 phút |
| `apps/web` | `next build` chạy lại — chỗ nặng nhất | ~10 phút |
| `packages/shared` hoặc `game-engine` | **cả hai** image build lại | ~10–12 phút |
| `package.json` / `package-lock.json` | `npm ci` chạy lại, kéo theo mọi thứ sau | ~13–15 phút |

Chỉ hai dòng đầu là số đo trực tiếp; còn lại ước lượng từ lần build đầu tiên.

**Đừng chạy `docker system prune -a`.** Nó quét sạch layer cache và lần build sau
quay về 15 phút. `deploy.sh` cố ý chỉ dùng `docker image prune -f` — xoá image mồ
côi, giữ cache.

## 5. Giới hạn RAM

VPS có 2 GB RAM và 4 GB swap. `next build` là thứ duy nhất chạm trần: nó chiếm
khoảng 70% RAM và tràn ~1 GB sang swap. Vẫn xong, chỉ chậm vì đọc ghi swap.

Không có downtime khi build: `docker compose build` không đụng container đang
chạy, site vẫn phục vụ bình thường. Chỉ vài giây cuối lúc `up -d` đổi container
mới có gián đoạn.

Nếu sau này build web thành gánh nặng thật, cách giảm là bật
`output: "standalone"` trong `apps/web/next.config.ts` — image nhẹ hơn hẳn và bớt
áp lực RAM.

## 6. Lỗi đã gặp thật

**`Cannot find module '@masoi/shared'`**
Chưa chạy `npm run build:deps`. Xem mục 1.

**`Cannot find module './src/lib/security-headers'` khi container web khởi động**
Stage `runner` của `Dockerfile.web` thiếu `apps/web/src`. `next.config.ts` import
file này **lúc chạy** chứ không chỉ lúc build — `next start` biên dịch config
thành `next.config.compiled.js` rồi `require` từ thư mục `apps/web`. Build vẫn
xanh, container chết ngay khi khởi động.

**`BOT_POLICY_FILE=... không đọc được: ENOENT`**
Tên file learned policy đổi theo commit. Kiểm tra trước rồi mới điền:

```bash
find apps/server/assets -type f
```

Server **cố ý** không khởi động khi đường dẫn sai, thay vì âm thầm rơi về
heuristic mà không ai hay.

**`required variable PUBLIC_ORIGIN is missing a value`**
`/opt/masoi/.env` thiếu `PUBLIC_ORIGIN`. Nó là origin công khai của trang, dùng
làm build-arg cho image web.

**Web chạy nhưng gọi API về `localhost:4000`**
Image web build thiếu `NEXT_PUBLIC_SERVER_URL` nên rơi về mặc định. Build lại với
đúng build-arg. Kiểm tra giá trị đã nướng vào bundle:

```bash
docker exec masoi-web sh -c "grep -rhoE 'https?://[a-z0-9.:-]+' /app/apps/web/.next/static | sort -u | head"
```

## 7. Kiểm tra sau khi build

```bash
docker ps                                            # cả 4 phải healthy
curl -sS https://masoionline.duckdns.org/api/health   # {"ok":true,"db":true,"redis":true}
curl -sS -o /dev/null -w '%{http_code}\n' https://masoionline.duckdns.org/   # 200
```

Socket.IO phải lên WebSocket thật, không rơi về long-polling — phải trả `101`:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  'https://masoionline.duckdns.org/socket.io/?EIO=4&transport=websocket'
```

`/api/health` trả `version` là commit SHA đang chạy — đối chiếu với
`git rev-parse --short HEAD` để chắc image mới đã lên thật.
