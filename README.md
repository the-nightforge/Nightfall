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
│   ├── web/          # Next.js 16 + React 19 + Tailwind (App Router)
│   └── server/       # Express + Socket.IO + Prisma + Redis
├── packages/
│   ├── game-engine/  # Luật chơi thuần (không phụ thuộc IO) + Vitest
│   └── shared/       # Types, Zod schemas, hằng số dùng chung
└── docker-compose.yml # PostgreSQL + Redis
```

**Nguyên tắc bảo mật:** server là nguồn dữ liệu duy nhất. Vai trò bí mật được lọc trong `game-engine.snapshotFor(viewerId)` trước khi gửi xuống client. Mọi socket payload đều validate bằng Zod. Chat bí mật (Sói / người chết) chỉ emit tới đúng người có quyền xem.

## Yêu cầu

- Node.js >= 20.19
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

Kiến trúc triển khai: **Vercel (web) → Render (server) → Neon (PostgreSQL) + Upstash (Redis)**. Backend chỉ chạy **một instance** vì trạng thái ván đang chơi được giữ trong RAM.

Bản đang chạy:

- Frontend: <https://ma-soi-online-nu.vercel.app>
- Backend health: <https://ma-soi-server-xzhv.onrender.com/api/health>

`/api/health` trả về `version` (7 ký tự đầu của commit đang chạy, lấy từ
`RENDER_GIT_COMMIT`) và `startedAt`. Đối chiếu `version` với `git rev-parse --short HEAD`
để biết Render đã build commit mới hay chưa; chạy ngoài môi trường deploy thì
`version` là `dev`.

### 1. Neon PostgreSQL

1. Tạo project và database PostgreSQL trên Neon.
2. Mở phần connection details, chọn pooled connection và sao chép chuỗi kết nối.
3. Chuỗi này sẽ được lưu dưới tên `DATABASE_URL` trong Render; không đưa vào Git hoặc Vercel.

### 2. Upstash Redis

1. Tạo Redis database cùng khu vực gần backend nhất có thể.
2. Sao chép TLS connection string bắt đầu bằng `rediss://`.
3. Chuỗi này sẽ được lưu dưới tên `REDIS_URL` trong Render; không đưa vào Git.

### 3. Render backend

1. Tạo **Web Service** từ repository GitHub này, chọn môi trường Docker, nhánh `main` và Dockerfile `Dockerfile.server`.
2. Dùng một instance và đặt Health Check Path là `/api/health`. Render tự cấp biến `PORT`, không cần tạo thủ công.
3. Thêm các biến môi trường:

```text
DATABASE_URL=<Neon pooled connection string>
REDIS_URL=<Upstash rediss:// connection string>
NODE_ENV=production
CORS_ORIGIN=https://YOUR-PROJECT.vercel.app
BOT_AI_ENABLED=true

# Voice chat (tuỳ chọn). Bỏ trống cả ba thì voice tắt và mọi thứ chạy như cũ;
# điền một nửa thì server ném lỗi lúc khởi động thay vì âm thầm tắt.
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
LIVEKIT_ENV=prod

# Chuỗi nhà cung cấp cho bot, thử lần lượt từ trên xuống.
# Thiếu bất kỳ mảnh nào của một chặng thì chặng đó bị bỏ qua.
# Không chặng nào cấu hình được thì bot chơi ngẫu nhiên và không chat.
BOT_AI_BASE_URL=<endpoint OpenAI-compatible, kèm /v1>
BOT_AI_API_KEY=<key của endpoint đó>
BOT_AI_MODEL=gemini-3.7-flash
OPENAI_API_KEY=<key OpenAI>
OPENAI_MODEL=gpt-5.6-luna
GEMINI_API_KEY=<API key Google AI Studio, dạng AIza...>
GEMINI_MODEL=gemini-3.5-flash-lite
```

Mỗi chặng có hạn nghỉ riêng sau khi bị 429, nên hết quota ở một nhà cung cấp không làm treo các nhà cung cấp còn lại. Trần `BOT_AI_MAX_CALLS_PER_GAME` thì dùng chung cho cả chuỗi vì nó nói về chi phí của một ván.

Không phải endpoint OpenAI-compatible nào cũng thực sự cài đặt `response_format`: có nơi nhận rồi bỏ qua và trả văn xuôi. Chặng `BOT_AI_*` vì thế mô tả JSON ngay trong lời nhắc rồi parse khoan dung, còn chặng OpenAI dùng `json_schema` strict.

`BOT_AI_ENABLED` là công tắc tắt nhanh: đặt `false` để toàn bộ bot quay lại chọn ngẫu nhiên ngay lập tức mà không cần deploy lại hay đổi `GEMINI_API_KEY`. Mặc định bật khi đã có key.

Server ưu tiên biến `PORT` do Render cấp và dùng cổng `4000` khi chạy container cục bộ. Lần khởi động container sẽ chạy `prisma migrate deploy` trước khi mở server. Ghi lại HTTPS origin của backend, ví dụ `https://ma-soi-server-xzhv.onrender.com`.

### 4. Vercel frontend

1. Import cùng repository vào Vercel và giữ Root Directory là thư mục gốc repository; file `vercel.json` đã chứa lệnh build monorepo.
2. Thêm biến môi trường `NEXT_PUBLIC_SERVER_URL` bằng chính xác HTTPS origin của Render, không có dấu `/` cuối.
3. Deploy frontend và ghi lại origin Vercel.
4. Quay lại Render, đổi `CORS_ORIGIN` thành origin Vercel chính xác rồi redeploy backend.

### 5. Kiểm tra sau triển khai

- Mở `https://<backend>/api/health`; trạng thái đầy đủ là HTTP 200 với `{ "ok": true, "db": true, "redis": true }`.
- Nếu PostgreSQL lỗi, endpoint trả HTTP 503. Nếu chỉ Redis tạm lỗi, endpoint vẫn trả HTTP 200 với `redis: false` vì server còn có thể phục vụ phòng đang nằm trong RAM.
- Mở frontend Vercel, tạo người chơi và phòng mới, thêm bot rồi xác nhận Socket.IO kết nối được.
- Không lưu `DATABASE_URL`, `REDIS_URL` hoặc token người chơi trong file được commit.

Các gói miễn phí có giới hạn tài nguyên và có thể thay đổi. Render Free có thể tạm ngủ khi không hoạt động nên lần truy cập đầu tiên có thể khởi động chậm. Đây là cấu hình phù hợp cho MVP dùng thử, không phải tải production lớn. Nếu backend restart giữa trận, phòng được đưa về lobby an toàn thay vì khôi phục timer/hành động dang dở.

## Scripts

| Lệnh | Mô tả |
|---|---|
| `npm run dev:server` | Server dev (tsx watch, cổng 4100) |
| `npm run dev:web` | Next.js dev (cổng 3000) |
| `npm test` | Toàn bộ test: engine (Vitest) + server (Vitest) + web (node:test). Tự build `shared`/`engine` trước qua `pretest` |
| `npm test --workspace @masoi/server` | Chỉ test backend. Cần `npm run build:deps` trước nếu `dist/` chưa có |
| `npm run lint` | Typecheck toàn bộ; tự build `shared`/`engine` trước qua `prelint` |
| `npm run build` | Build shared → engine → server → web |
| `npm run build:deps` | Chỉ build `shared` → `engine`, đủ cho test/lint |
| `npm run db:generate` | Prisma generate client |
| `npm run db:migrate` | Prisma migrate deploy |
| `npm run test:e2e` | E2E smoke test qua Socket.IO; cần server local và hiện chưa dùng làm release gate cho tới khi luồng sẵn sàng được tự động hoá |
| `npm run bot:probe` | Gọi Gemini một lần với ván giả để kiểm tra key và prompt (cần `GEMINI_API_KEY`) |
| `npm run voice:probe` | Gọi LiveKit thật một lượt: kiểm credential, bộ grant của token, và cách nhận dạng lỗi (cần `LIVEKIT_*`) |

`@masoi/shared` và `@masoi/game-engine` trỏ `main`/`types` vào `dist/`, mà `dist/` nằm trong `.gitignore`. Vì thế trên một bản clone sạch, hai package đó chưa tồn tại dưới dạng mà workspace khác import được, và bất kỳ lệnh nào chạy thẳng vào một workspace (`npm test --workspace @masoi/server`) sẽ đỏ hàng loạt với `has no exported member` — lỗi build artifact, không phải lỗi code. `npm test` và `npm run lint` ở thư mục gốc tự lo việc này; chạy thẳng workspace thì cần `npm run build:deps` trước.

## REST API

| Method | Path | Body | Response | Mô tả |
|---|---|---|---|---|
| POST | `/api/players` | `{ nickname }` | `{ playerId, token, nickname }` | Đăng ký người chơi khách. Token giữ ở client (localStorage), server chỉ lưu SHA-256 |
| GET | `/api/health` | - | `{ ok, db, redis }` | Kiểm tra PostgreSQL và Redis; trả 503 khi PostgreSQL lỗi, Redis lỗi được báo bằng `redis: false` |

## Socket.IO events

Kết nối: `io(SERVER_URL, { auth: { playerId, token } })`.

### Client → Server

| Event | Payload (Zod validated) | Quyền |
|---|---|---|
| `room:create` | `{}` | - |
| `room:join` | `{ code: string(5) }` | Biệt danh không trùng; phải rời phòng cũ; người mới không thể vào trận đang chạy |
| `room:leave` | `{}` | Thành viên |
| `room:set-ready` | `{ ready: boolean }` | Thành viên, ngoài trận |
| `room:kick` | `{ targetId }` | Chủ phòng, trước khi bắt đầu |
| `room:update-config` | `{ config: RoomConfig }` | Chủ phòng, ngoài trận |
| `room:add-bot` | `{}` | Chủ phòng, ngoài trận |
| `room:start` | `{}` | Chủ phòng; cần ≥6 người, config hợp lệ và mọi khách thật đã sẵn sàng |
| `room:reset` | `{}` | Chủ phòng, sau GAME_OVER → về phòng chờ |
| `game:action` | `{ type: KILL\|SEE\|GUARD\|HEAL\|POISON, targetId?: string\|null }` | Đúng vai trò, còn sống, đang NIGHT |
| `game:vote` | `{ targetId }` | Còn sống, đang VOTING |
| `chat:send` | `{ text: string(≤300) }` | Server tự chọn kênh theo phase/trạng thái; rate limit 5 tin/5s |
| `voice:token` | `{}` | Thành viên (không phải bot), phòng đã bật voice, server có LiveKit; rate limit 5 lần/10s |
| `voice:ready` | `{}` | Báo đã vào room LiveKit xong, để server cấp quyền theo pha hiện tại |

### Server → Client

| Event | Payload | Ghi chú |
|---|---|---|
| `room:snapshot` | `RoomSnapshot` | Snapshot cá nhân hoá cho từng người nhận |
| `chat:new` | `ChatMessage` | Chỉ gửi tới người có quyền xem kênh đó |
| `voice:token` | `{ url, token, roomName }` | Token join LiveKit. Dùng server event chứ không dùng ack vì helper `handler` trong `ws.ts` chỉ nhận một tham số |
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
- **Đổi phiếu được tới hết hạn**: phiếu đề cử ban ngày sửa lại bao nhiêu lần cũng được, chỉ lựa chọn cuối cùng được tính. Vì thế pha bỏ phiếu **không** kết thúc sớm dù mọi người đã bỏ phiếu — kết thúc sớm sẽ khoá phiếu ngay lúc người cuối cùng bấm.
- **Danh tính phiếu công khai sau khi vòng đề cử chốt**: trong lúc đang bỏ phiếu chỉ thấy số đếm, chốt xong mới thấy ai bỏ cho ai và ai đã đổi phiếu lúc nào. Phiếu Treo/Tha ở phiên toà cũng được công khai sau khi tuyên án.
- **Vai của người chết vẫn ẩn tới `GAME_OVER`**: chết không lật bài, kể cả với người đang sống lẫn với BOT.
- Sói thắng khi số Sói ≥ số phe làng còn sống; làng thắng khi hết Sói.
- Server giữ trọn thời gian ban đêm đã cấu hình để mọi vai trò có cơ hội hành động.

## Voice chat (LiveKit)

Tắt mặc định. Chủ phòng bật bằng công tắc trong phòng chờ, và công tắc chỉ hiện
khi server đã có `LIVEKIT_*`.

**Chỉ có ban ngày.** Phe Sói ban đêm và người chết vẫn bàn bằng chữ. Đây là quyết
định gốc chứ không phải hạn chế tạm thời: ban ngày không có kênh nào mang thông
tin bí mật (ai chết, ai bị cáo đều công khai), nên "ai được nói" không hé lộ vai
của ai. Nhờ vậy mỗi phòng chỉ cần **một** room LiveKit và không có bề mặt rò rỉ
qua tầng signaling.

| Pha | Ai được nói |
|---|---|
| `LOBBY`, `GAME_OVER` | tất cả |
| `DAY_DISCUSSION`, `VOTING`, `FINAL_VOTE`, `NIGHT_RESULT`, `ELIMINATION` | người còn sống |
| `DEFENSE` | chỉ bị cáo |
| `NIGHT`, `ROLE_REVEAL`, `HUNTER_SHOT` | không ai |

Người chết luôn **nghe** được, nhưng không nói được cho tới `GAME_OVER`.

Hai điều quan trọng nếu bạn sửa phần này:

1. **Token không bao giờ mang quyền nói.** Mọi token ký ra đều có
   `canPublish: false`; quyền nói chỉ đến từ `updateParticipant` sau khi đã vào
   room. Nhờ vậy dán lại một token cũ sau khi chết cũng không lấy lại được
   quyền. Đừng "tối ưu" bằng cách ký sẵn quyền vào token.
2. **`canPublishData` mặc định là `true` ở LiveKit.** Adapter đóng nó tường minh.
   Bỏ dòng đó là mở lại một kênh dữ liệu không ai gác, đi vòng qua `resolveChat`.

Thiết kế đầy đủ: `docs/superpowers/specs/2026-08-30-voice-chat-design.md`.
Kiểm tra cấu hình thật: `npm run voice:probe`.

## Reconnect

Client lưu `{ playerId, token, roomCode }` trong localStorage. Khi mất mạng/tải lại:
socket reconnect với cùng auth → server xác thực token (SHA-256 lookup), tìm phòng qua Redis `player-room:{id}`, đánh dấu `connected`, gửi lại snapshot phù hợp quyền.

## Hạn chế hiện tại (MVP)

- Single-instance server: trạng thái phòng chính nằm trong RAM, Redis là bản sao phục vụ khôi phục phòng (phòng đang giữa trận khi restart sẽ được trả về LOBBY an toàn).
- Voice chat **chỉ có ban ngày**; phe Sói ban đêm và người chết vẫn nhắn bằng chữ. Chưa có video, chưa có lịch sử ván chi tiết trong UI.
- **Toàn bộ** quyết định của BOT — hành động đêm, đề cử, phiếu Treo/Tha, phát bắn Thợ Săn — do decision engine deterministic có memory/belief/chiến lược theo vai quyết định, tái lập được từ seed. LLM **chỉ** diễn đạt lời nói: `BotBrain` không còn chữ ký nào trả về một nước đi. Thiếu `GEMINI_API_KEY` hay hết quota chỉ làm BOT nói bằng câu mẫu, không đổi một nước đi nào.
- BOT chưa biết tự nhận vai trong chat, nên phe làng chưa truyền được thông tin của Tiên Tri cho nhau; đo bằng harness thì phe làng thắng khoảng 17% (xem `docs/bot-ai-phase-2-verification.md`).
- `BotBrainState` không được lưu: server restart giữa ván thì BOT mất trí nhớ của ván đó.
- Chưa có persistence cho chat/khôi phục trận dở sau khi server chết giữa chừng.
- Rate limit chống spam dựa trên bộ nhớ đơn giản.
