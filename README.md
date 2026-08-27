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

## Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run dev:server` | Server dev (tsx watch, cổng 4100) |
| `npm run dev:web` | Next.js dev (cổng 3000) |
| `npm run test` | Unit test game engine (Vitest, 24 tests) |
| `npm run lint` | Typecheck toàn bộ |
| `npm run build` | Build shared → engine → server → web |
| `npm run db:generate` | Prisma generate client |
| `npm run db:migrate` | Prisma migrate deploy |
| `npx tsx apps/server/scripts/e2e.ts` | E2E smoke test: 6 người chơi thật qua Socket.IO chơi trọn ván |

## REST API

| Method | Path | Body | Response | Mô tả |
|---|---|---|---|---|
| POST | `/api/players` | `{ nickname }` | `{ playerId, token, nickname }` | Đăng ký người chơi khách. Token giữ ở client (localStorage), server chỉ lưu SHA-256 |
| GET | `/api/health` | - | `{ ok, db }` | Kiểm tra server + DB |

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
- Server tự chuyển pha khi hết giờ hoặc mọi hành động bắt buộc hoàn tất.

## Reconnect

Client lưu `{ playerId, token, roomCode }` trong localStorage. Khi mất mạng/tải lại:
socket reconnect với cùng auth → server xác thực token (SHA-256 lookup), tìm phòng qua Redis `player-room:{id}`, đánh dấu `connected`, gửi lại snapshot phù hợp quyền.

## Hạn chế hiện tại (MVP)

- Single-instance server: trạng thái phòng chính nằm trong RAM, Redis là bản sao phục vụ khôi phục phòng (phòng đang giữa trận khi restart sẽ được trả về LOBBY an toàn).
- Chưa có voice/video, chưa có lịch sử ván chi tiết trong UI.
- Bot hành động ngẫu nhiên, chưa có AI.
- Chưa có persistence cho chat/khôi phục trận dở sau khi server chết giữa chừng.
- Rate limit chống spam dựa trên bộ nhớ đơn giản.
