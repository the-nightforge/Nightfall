# Thiết kế triển khai Ma Sói Online bản dùng thử

## Mục tiêu

Đưa MVP Ma Sói Online từ môi trường local lên Internet mà không cần VPS, sử dụng các gói miễn phí phù hợp cho thử nghiệm. Mã nguồn được lưu trong repository GitHub private và tự động triển khai từ nhánh `main`.

## Phạm vi

- Frontend Next.js triển khai trên Vercel.
- Backend Express và Socket.IO triển khai trên Northflank Developer Sandbox.
- PostgreSQL sử dụng Neon Free.
- Redis sử dụng Upstash Free.
- Sửa các lỗi gameplay và bảo mật ảnh hưởng trực tiếp đến việc phát hành public.
- Bổ sung cấu hình build, health check, biến môi trường và tài liệu triển khai.
- Khởi tạo Git, tạo repository GitHub private `ma-soi-online` và đẩy nhánh `main`.

Không nằm trong phạm vi:

- Khôi phục chính xác ván đang chơi sau khi backend restart.
- Scale backend thành nhiều instance.
- Voice chat, video chat, matchmaking hoặc hệ thống xếp hạng.
- Cam kết SLA hoặc vận hành production thương mại.

## Kiến trúc

```text
Người chơi
    |
    | HTTPS
    v
Vercel - Next.js frontend
    |
    | HTTPS + Socket.IO
    v
Northflank - Express/Socket.IO server (1 instance)
    |                         |
    | PostgreSQL              | Redis/TLS
    v                         v
Neon Free                 Upstash Free
```

Frontend và backend tiếp tục dùng chung monorepo. Northflank chạy một backend instance để phù hợp với mô hình trạng thái phòng trong RAM hiện tại. Redis lưu ánh xạ phiên/phòng và bản sao phòng phục vụ reconnect. PostgreSQL lưu danh tính khách, room record và game result.

## Luồng triển khai

1. Khởi tạo repository GitHub private `ma-soi-online` và đẩy mã nguồn đã kiểm thử.
2. Tạo Neon PostgreSQL và lấy `DATABASE_URL` dạng pooled connection khi phù hợp.
3. Tạo Upstash Redis và lấy `REDIS_URL` dùng TLS.
4. Deploy backend Northflank từ GitHub để lấy domain `code.run`.
5. Deploy frontend Vercel với `NEXT_PUBLIC_SERVER_URL` trỏ đến backend.
6. Cập nhật `CORS_ORIGIN` của backend bằng domain Vercel chính xác.
7. Xác minh health check, kết nối Socket.IO và luồng tạo phòng.

Mọi secret chỉ được đặt trong dashboard của dịch vụ. `.env`, token, mật khẩu và connection string thật không được commit.

## Cấu hình backend

Backend phải:

- Ưu tiên biến `PORT` do Northflank cung cấp, sau đó mới dùng `SERVER_PORT` cho local.
- Bind HTTP server trên `0.0.0.0`.
- Cho phép CORS từ danh sách origin cấu hình qua `CORS_ORIGIN`.
- Cung cấp health check tại `/api/health`.
- Chạy Prisma generate/build trong build stage.
- Chạy migration deploy trước khi khởi động phiên bản phát hành.
- Xử lý `SIGTERM` để đóng Socket.IO, HTTP server, Prisma và Redis gọn gàng.

Dockerfile backend được build từ root monorepo để truy cập `packages/shared` và `packages/game-engine`. Runtime chỉ khởi động `@masoi/server`.

## Cấu hình frontend

Frontend được build từ monorepo và nhận backend URL qua `NEXT_PUBLIC_SERVER_URL`. URL này phải là HTTPS để Socket.IO tự sử dụng kết nối bảo mật trên Internet.

Vercel chỉ giữ frontend. Không chuyển game engine server-side hoặc trạng thái phòng sang Vercel Functions trong giai đoạn này.

## Sửa lỗi bắt buộc trước khi public

### Phân quyền chat

Snapshot chỉ chứa các tin nhắn mà viewer có quyền đọc:

- Lobby và game over: chat phòng công khai.
- Ban ngày: chat làng cho người sống.
- Ban đêm: chat Sói chỉ cho Sói còn sống.
- Người chết: chat người chết chỉ cho người chết.

Không dựa vào việc lọc ở client. Server lọc cả sự kiện realtime lẫn lịch sử trong snapshot.

### Hành động ban đêm

- Sửa kiểm tra `nightOrder` để Bảo Vệ với thứ tự `0` vẫn có giao diện hành động.
- Không kết thúc đêm sớm chỉ vì tất cả Sói đã chọn. MVP chờ hết `nightSeconds`, bảo đảm Tiên Tri, Bảo Vệ và Phù Thủy có đủ thời gian.
- Hợp nhất danh sách tử vong theo `playerId` để một người không bị tính hai lần trong cùng đêm.

### Thành viên phòng

- Một người chỉ được thuộc một phòng tại một thời điểm.
- Khi tạo hoặc tham gia phòng mới, server từ chối nếu người chơi chưa rời phòng hiện tại.
- Không cho thành viên mới tham gia phòng đang `IN_GAME`; chưa triển khai spectator mode.
- Chỉ bắt đầu khi mọi người chơi thật, trừ chủ phòng, đã sẵn sàng. Bot luôn sẵn sàng.

### Reconnect

Khi socket kết nối lại, server:

1. Kiểm tra phòng trong RAM.
2. Nếu không có, đọc `player-room:{playerId}` từ Redis.
3. Load phòng từ Redis nếu còn tồn tại.
4. Đánh dấu thành viên connected và gửi snapshot đã lọc quyền.

Nếu backend restart giữa trận, phòng được đưa về lobby như hành vi MVP hiện tại. Không cố khôi phục timer hoặc hành động đang dở.

## Xử lý lỗi và giới hạn dịch vụ miễn phí

- Lỗi Neon hoặc Upstash phải được log ở mức đủ chẩn đoán nhưng không chứa token, vai trò hoặc payload bí mật.
- Redis tạm lỗi không làm process crash; gameplay một instance tiếp tục bằng RAM, nhưng reconnect sau restart có thể mất.
- Nếu đạt quota miễn phí, giao diện cần hiển thị lỗi kết nối thay vì treo vô hạn.
- Northflank Sandbox, Neon Free và Upstash Free chỉ dùng cho thử nghiệm/MVP, không được mô tả là hạ tầng production có SLA.

## Kiểm thử

### Tự động

- Unit test game engine hiện có phải tiếp tục đạt.
- Thêm test không tính trùng tử vong.
- Thêm test lọc chat theo viewer/channel.
- Thêm test quy tắc thành viên phòng có thể tách thành helper thuần nếu service hiện tại khó cô lập.
- Chạy typecheck toàn monorepo.
- Chạy production build frontend và backend.

### Smoke test

- `/api/health` trả `ok: true` và `db: true` trên backend public.
- Frontend public tải không có lỗi console nghiêm trọng.
- Tạo danh tính khách và phòng thành công.
- Thêm bot đủ sáu người, chuyển qua `ROLE_REVEAL` và `NIGHT`.
- Một client không nhận chat Sói/người chết trái quyền.
- Reconnect cùng token nhận lại snapshot phòng.

## Tiêu chí hoàn thành

- Không còn lỗi P0/P1 đã liệt kê trong phạm vi thiết kế.
- Unit test, typecheck và production build đều đạt.
- GitHub repository private không chứa secret.
- Backend Northflank và frontend Vercel có URL HTTPS hoạt động.
- Frontend kết nối được Socket.IO tới backend public.
- README mô tả đầy đủ cách chạy local, biến môi trường, quy trình deploy và giới hạn gói miễn phí.

