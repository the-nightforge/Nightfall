# Ma Sói Online 🐺

Game Ma Sói (Werewolf) online multiplayer theo thời gian thực - MVP bản chat.

- Tạo phòng, tham gia bằng mã phòng 5 ký tự.
- Chơi realtime qua Socket.IO, giao diện tiếng Việt, tối ưu điện thoại.
- Vai trò: **Ma Sói, Dân Làng, Tiên Tri, Bảo Vệ, Phù Thủy** - engine thiết kế dạng registry để thêm vai trò mới dễ dàng.
- Chế độ bot để một người có thể test toàn bộ ván.

## Kiến trúc

```
ma-soi-online/
├── apps/
│   ├── web/          # Next.js 14 + Tailwind (App Router)
│   └── server/       # Express + Socket.IO + Prisma + Redis
├── packages/
│   ├── game-engine/  # Luật chơi thuần (không phụ thuộc IO) + Vitest
│   └── shared/       # Types, Zod schemas, hằng số dùng chung
└── docker-compose.yml # PostgreSQL + Redis
```

**Nguyên tắc bảo mật:** server là nguồn dữ liệu duy nhất. Vai trò bí mật được lọc trong `game-engine.snapshotFor(viewerId)` trước khi gửi xuống client. Mọi socket payload đều validate bằng Zod. Chat bí mật (Sói / người chết) chỉ emit tới đúng người có quyền xem.

## Yêu cầu

- Node.js >= 20
- Docker Desktop (cho PostgreSQL & Redis)

## Cài đặt & chạy local

```powershell
# 1. Cài dependencies
npm install

# 2. Khởi động PostgreSQL + Redis
docker compose up -d

# 3. Cấu hình môi trường
Copy-Item .env.example apps/server/.env     # sửa nếu cần
"NEXT_PUBLIC_SERVER_URL=http://localhost:4100" | Set-Content apps/web/.env.local

# 4. Tạo bảng database
npm run db:migrate

# 5. Chạy server (cổng 4100) và web (cổng 3000) - 2 terminal
npm run dev:server
npm run dev:web
```

Mở http://localhost:3000 → nhập biệt danh → **Tạo phòng mới** → bấm **+ Thêm bot** đủ 6 người → **Bắt đầu trận đấu**.

> Lưu ý: nếu cổng 4000 bị chiếm (WSL...), đổi `SERVER_PORT=4100` trong `apps/server/.env` và `NEXT_PUBLIC_SERVER_URL` tương ứng.

## Triển khai bản dùng thử miễn phí

Kiến trúc triển khai: **Vercel (web) → Northflank (server) → Neon (PostgreSQL) + Upstash (Redis)**. Backend chỉ chạy **một instance** vì trạng thái ván đang chơi được giữ trong RAM.

### 1. Neon PostgreSQL

1. Tạo project và database PostgreSQL trên Neon.
2. Mở phần connection details, chọn pooled connection và sao chép chuỗi kết nối.
3. Chuỗi này sẽ được lưu dưới tên `DATABASE_URL` trong Northflank; không đưa vào Git hoặc Vercel.

### 2. Upstash Redis

1. Tạo Redis database cùng khu vực gần backend nhất có thể.
2. Sao chép TLS connection string bắt đầu bằng `rediss://`.
3. Chuỗi này sẽ được lưu dưới tên `REDIS_URL` trong Northflank; không đưa vào Git.

### 3. Northflank backend

1. Tạo service từ repository GitHub này và chọn build bằng Dockerfile `Dockerfile.server`.
2. Dùng một instance, public HTTP port lấy từ biến `$PORT`, giao thức HTTP/1.1 và health path `/api/health`.
3. Thêm các biến môi trường:

```text
DATABASE_URL=<Neon pooled connection string>
REDIS_URL=<Upstash rediss:// connection string>
NODE_ENV=production
CORS_ORIGIN=https://YOUR-PROJECT.vercel.app
```

Northflank tự cấp `PORT`, không cần tự đặt. Lần khởi động container sẽ chạy `prisma migrate deploy` trước khi mở server. Ghi lại HTTPS domain của backend, ví dụ `https://ma-soi-server-example.code.run`.

### 4. Vercel frontend

1. Import cùng repository vào Vercel và giữ Root Directory là thư mục gốc repository; file `vercel.json` đã chứa lệnh build monorepo.
2. Thêm biến môi trường `NEXT_PUBLIC_SERVER_URL` bằng chính xác HTTPS origin của Northflank, không có dấu `/` cuối.
3. Deploy frontend và ghi lại origin Vercel.
4. Quay lại Northflank, đổi `CORS_ORIGIN` thành origin Vercel chính xác rồi redeploy backend.

### 5. Kiểm tra sau triển khai

- Mở `https://<backend>/api/health`; kết quả tốt là HTTP 200 với `{ "ok": true, "db": true, "redis": true }`.
- Mở frontend Vercel, tạo người chơi và phòng mới, thêm bot rồi xác nhận Socket.IO kết nối được.
- Không lưu `DATABASE_URL`, `REDIS_URL` hoặc token người chơi trong file được commit.

Các gói miễn phí có giới hạn tài nguyên và có thể thay đổi hoặc tạm ngủ. Đây là cấu hình phù hợp cho MVP dùng thử, không phải tải production lớn. Nếu backend restart giữa trận, phòng được đưa về lobby an toàn thay vì khôi phục timer/hành động dang dở.

## Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run dev:server` | Server dev (tsx watch, cổng 4100) |
| `npm run dev:web` | Next.js dev (cổng 3000) |
| `npm run test` | Unit test game engine (Vitest) |
| `npm test --workspace @masoi/server` | Unit test bảo mật và quy tắc backend |
| `npm run lint` | Typecheck toàn bộ |
| `npm run build` | Build shared → engine → server → web |
| `npm run db:generate` | Prisma generate client |
| `npm run db:migrate` | Prisma migrate deploy |
| `npx tsx apps/server/scripts/e2e.ts` | E2E smoke test: 6 người chơi thật qua Socket.IO chơi trọn ván |

## REST API

| Method | Path | Body | Response | Mô tả |
|---|---|---|---|---|
| POST | `/api/players` | `{ nickname }` | `{ playerId, token, nickname }` | Đăng ký người chơi khách. Token giữ ở client (localStorage), server chỉ lưu SHA-256 |
| GET | `/api/health` | - | `{ ok, db, redis }` | Kiểm tra server + PostgreSQL + Redis; trả 503 khi dependency lỗi |

## Socket.IO events

Kết nối: `io(SERVER_URL, { auth: { playerId, token } })`.

### Client → Server

| Event | Payload (Zod validated) | Quyền |
|---|---|---|
| `room:create` | `{}` | - |
| `room:join` | `{ code: string(5) }` | Biệt danh không trùng trong phòng |
| `room:leave` | `{}` | Thành viên |
| `room:set-ready` | `{ ready: boolean }` | Thành viên, ngoài trận |
| `room:kick` | `{ targetId }` | Chủ phòng, trước khi bắt đầu |
| `room:update-config` | `{ config: RoomConfig }` | Chủ phòng, ngoài trận |
| `room:add-bot` | `{}` | Chủ phòng, ngoài trận |
| `room:start` | `{}` | Chủ phòng; cần ≥6 người + config hợp lệ |
| `room:reset` | `{}` | Chủ phòng, sau GAME_OVER → về phòng chờ |
| `game:action` | `{ type: KILL\|SEE\|GUARD\|HEAL\|POISON, targetId?: string\|null }` | Đúng vai trò, còn sống, đang NIGHT |
| `game:vote` | `{ targetId }` | Còn sống, đang VOTING |
| `chat:send` | `{ text: string(≤300) }` | Server tự chọn kênh theo phase/trạng thái; rate limit 5 tin/5s |

### Server → Client

| Event | Payload | Ghi chú |
|---|---|---|
| `room:snapshot` | `RoomSnapshot` | Snapshot cá nhân hoá cho từng người nhận |
| `chat:new` | `ChatMessage` | Chỉ gửi tới người có quyền xem kênh đó |
| `error` | `{ message }` | Lỗi nghiệp vụ tiếng Việt |

### Các pha game

`LOBBY → ROLE_REVEAL → NIGHT → NIGHT_RESULT → CHECK_WIN → DAY_DISCUSSION → VOTING → ELIMINATION → CHECK_WIN → ... → GAME_OVER`

Đồng hồ đếm ngược tính bằng `phaseEndsAt` (epoch ms do server cấp); client chỉ hiển thị.

## Luật MVP

- Sói cắn 1 người mỗi đêm (quyết định chung cả bọn).
- Tiên Tri soi 1 người, chỉ mình Tiên Tri thấy kết quả.
- Bảo Vệ bảo vệ 1 người, không lặp lại mục tiêu đêm liền trước.
- Phù Thủy: 1 bình cứu (cứu nạn nhân của sói) + 1 bình độc, mỗi bình dùng 1 lần cả ván.
- Ban ngày: thảo luận → bỏ phiếu; nhiều phiếu nhất bị loại; **hoà phiếu không ai bị loại**.
- Sói thắng khi số Sói ≥ số phe làng còn sống; làng thắng khi hết Sói.
- Server giữ trọn thời gian ban đêm đã cấu hình để mọi vai trò có cơ hội hành động; pha bỏ phiếu có thể kết thúc sớm khi mọi người còn sống đã bỏ phiếu.

## Reconnect

Client lưu `{ playerId, token, roomCode }` trong localStorage. Khi mất mạng/tải lại:
socket reconnect với cùng auth → server xác thực token (SHA-256 lookup), tìm phòng qua Redis `player-room:{id}`, đánh dấu `connected`, gửi lại snapshot phù hợp quyền.

## Hạn chế hiện tại (MVP)

- Single-instance server: trạng thái phòng chính nằm trong RAM, Redis là bản sao phục vụ khôi phục phòng (phòng đang giữa trận khi restart sẽ được trả về LOBBY an toàn).
- Chưa có voice/video, chưa có lịch sử ván chi tiết trong UI.
- Bot hành động ngẫu nhiên, chưa có AI.
- Chưa có persistence cho chat/khôi phục trận dở sau khi server chết giữa chừng.
- Rate limit chống spam dựa trên bộ nhớ đơn giản.
