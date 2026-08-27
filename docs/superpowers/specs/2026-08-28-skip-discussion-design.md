# Đồng thuận bỏ qua thảo luận

Ngày: 2026-08-28

## Mục tiêu

Trong pha `DAY_DISCUSSION`, cho phép người chơi thật còn sống cùng đồng thuận kết thúc thảo luận sớm và chuyển sang `VOTING`. Tính năng dùng được cả trong phòng toàn người thật lẫn phòng có bot.

## Quy tắc sản phẩm

- Chỉ người thật còn sống được bỏ phiếu skip.
- Bot và người đã chết không được tính vào tổng số cần đồng ý.
- Người thật đang mất kết nối vẫn được tính. Điều này tránh việc một người cố ý ngắt kết nối để hạ ngưỡng đồng thuận.
- Khi tất cả người thật còn sống đồng ý, server chuyển phòng sang `VOTING` ngay.
- Nếu chưa đủ đồng thuận, timer thảo luận hiện tại tiếp tục chạy và tự chuyển pha như bình thường khi hết giờ.
- Người chơi có thể rút phiếu skip trước khi đạt đồng thuận.
- Phiếu skip tồn tại qua reconnect vì gắn với `playerId`, nhưng không được lưu lâu dài vào database.
- Phiếu được xoá khi bắt đầu một pha thảo luận mới, chuyển sang bỏ phiếu, reset phòng, bắt đầu ván mới hoặc xoá phòng khỏi bộ nhớ.

Ví dụ: phòng có 3 người thật còn sống và 5 bot sẽ hiển thị `Skip thảo luận (2/3)`. Nếu chỉ còn 1 người thật còn sống, người đó bấm skip thì phòng chuyển pha ngay.

## Các phương án đã cân nhắc

### 1. Client tự đếm phiếu

Mỗi trình duyệt phát trạng thái của mình rồi frontend quyết định khi nào chuyển pha. Cách này ít code server nhưng không đáng tin cậy: client có thể bị sửa, hai người bấm đồng thời dễ lệch trạng thái và reconnect không biết phiếu hiện tại.

### 2. Bot cũng tham gia bỏ phiếu skip

Bot tự chọn đồng ý hoặc từ chối bằng AI. Cách này tạo thêm request, làm kết quả khó đoán và khiến người thật không thực sự kiểm soát được thời lượng thảo luận.

### 3. Server quản lý đồng thuận của người thật — chọn

Server giữ tập `playerId` đã đồng ý, tự kiểm tra điều kiện và phát snapshot cá nhân hoá. Đây là cùng mô hình server-authoritative đang dùng cho bỏ phiếu treo cổ, hoạt động ổn định khi bấm đồng thời và reconnect, đồng thời không tốn thêm lượt gọi AI.

## Giao thức dùng chung

Thêm client event `GAME_SKIP_DISCUSSION` với tên dây `game:skip-discussion` vào `packages/shared/src/events.ts`.

Payload được Zod kiểm tra trong `packages/shared/src/schemas.ts`:

```ts
{ skip: boolean }
```

`true` là đồng ý bỏ qua, `false` là rút phiếu.

Thêm trường cá nhân hoá vào `RoomSnapshot`:

```ts
discussionSkip: {
  votes: number;
  required: number;
  hasVoted: boolean;
  canVote: boolean;
} | null;
```

Trường này chỉ khác `null` trong `DAY_DISCUSSION` khi có ít nhất một người thật còn sống. `votes` và `required` là số công khai; `hasVoted` và `canVote` được tính theo người đang xem snapshot. Người chết có thể thấy tiến độ nhưng không thấy nút thao tác.

## Trạng thái server

Thêm `discussionSkipVotes: Map<string, Set<string>>` vào module trạng thái tạm theo phòng. Khoá ngoài là mã phòng, tập bên trong chứa `playerId` của người đã đồng ý.

Không đưa state này vào `GameEngine`: skip thảo luận là điều phối pha và kết nối phòng, không phải luật vai trò. Không lưu vào Prisma/Redis vì đây là phiếu ngắn hạn. Cơ chế phục hồi hiện tại đưa phòng đang chơi về `LOBBY` khi server khởi động lại, nên không có pha thảo luận nào cần khôi phục phiếu skip.

Mỗi lần đọc hoặc ghi, server tính lại tập người đủ điều kiện từ dữ liệu hiện tại:

1. Thuộc `room.members`.
2. `isBot === false`.
3. Snapshot engine của người đó cho biết `alive === true`.

`connected` không nằm trong điều kiện. Các id không còn hợp lệ bị loại khỏi tập phiếu trước khi đếm.

## Luồng xử lý

1. Client bấm nút và gửi `{ skip: !hasVoted }`.
2. Socket handler validate payload và áp dụng rate limit riêng cho thao tác này.
3. Server kiểm tra người gửi đang ở phòng, trận đang chạy, pha là `DAY_DISCUSSION`, là người thật và còn sống.
4. Server thêm hoặc xoá `playerId` trong tập phiếu. Gửi lại cùng một trạng thái không gây tác dụng phụ.
5. Server tính `votes` và `required` từ state chuẩn hoá.
6. Nếu `required > 0` và `votes === required`, server huỷ timer thảo luận và gọi đúng luồng `beginVoting(room)` hiện có.
7. Nếu chưa đủ, server broadcast snapshot mới để mọi client cập nhật tiến độ.

Node xử lý callback Socket.IO tuần tự trên event loop. Lần bấm đạt ngưỡng sẽ đổi pha và xoá timer; thao tác đến sau bị chặn vì phase không còn là `DAY_DISCUSSION`. `beginVoting` vẫn là điểm duy nhất thiết lập timer bỏ phiếu và gọi bot bỏ phiếu, tránh tạo hai luồng chuyển pha khác nhau.

## Giao diện

Trong `DayView`:

- Khi đang thảo luận và `discussionSkip.canVote` là true, hiển thị nút `Skip thảo luận (x/y)`.
- Khi `hasVoted` là true, đổi trạng thái trực quan và nhãn thành `Huỷ skip (x/y)`.
- Khi người xem không được bấm nhưng `discussionSkip` tồn tại, chỉ hiển thị tiến độ đồng thuận.
- Snapshot tiếp theo là nguồn sự thật. Nếu người chơi bấm lặp trước khi snapshot về, client vẫn gửi cùng một giá trị nên thao tác server có tính idempotent và không vô tình rút phiếu.
- Giữ timer thảo luận hiện có trên màn hình. Skip không làm thay đổi timer cho đến khi server thực sự chuyển pha.

Trang phòng chỉ truyền callback mới xuống `DayView`; component không tự đếm hoặc quyết định chuyển pha.

## Reconnect và vòng đời

- Reconnect bằng cùng `playerId` nhận `hasVoted: true` nếu đã bấm trước đó.
- Disconnect chỉ cập nhật `connected`; không xoá phiếu và không giảm `required`.
- `beginDiscussion` tạo tập phiếu rỗng cho ngày mới.
- `beginVoting` xoá tập phiếu trước khi broadcast snapshot pha mới.
- `startGame`, `resetToLobby` và cleanup khi xoá phòng cũng xoá state để không rò rỉ giữa các ván hoặc tích luỹ bộ nhớ.
- Nếu thành viên rời phòng theo một luồng hợp lệ trong lúc chơi, server hoàn tất các mutation trong bộ nhớ và chuẩn hoá eligibility trước lần `await` I/O đầu tiên. Nếu số phiếu còn lại đã bằng ngưỡng mới, phòng chuyển sang `VOTING` ngay thay vì có cửa sổ tạm thời hiển thị `x/x` nhưng vẫn chờ timer.
- Callback AI thảo luận đã bắt đầu trước khi skip phải kiểm tra lại đúng engine, vòng, phase và `phaseEndsAt` sau `await`; kết quả muộn bị bỏ hoàn toàn, không được ghi phiếu dự kiến hoặc phát chat sang pha sau.

## Lỗi và bảo mật

- Payload sai schema, thao tác ngoài `DAY_DISCUSSION`, bot, người chết hoặc người không thuộc phòng đều bị từ chối bằng lỗi phòng chuẩn.
- Client không gửi số phiếu hay tổng số cần thiết; server tự tính cả hai.
- Event có rate limit để tránh spam broadcast.
- Không ghi tên hoặc nội dung bí mật vào state skip; chỉ lưu `playerId` tạm thời.
- Bot không gọi AI và không tự gửi event skip.

## Kiểm thử

Viết test trước phần triển khai cho các trường hợp:

- Snapshot trong `DAY_DISCUSSION` trả đúng `votes`, `required`, `hasVoted`, `canVote`.
- Bot và người chết bị loại khỏi `required`.
- Người mất kết nối vẫn nằm trong `required` và phiếu cũ vẫn còn khi reconnect.
- Một người bấm hai lần cùng giá trị không làm sai số phiếu.
- Rút phiếu làm giảm tiến độ.
- Chưa đủ phiếu không đổi pha.
- Phiếu cuối cùng chuyển ngay sang `VOTING` và timer thảo luận bị huỷ.
- Event đến sau khi chuyển pha bị từ chối và không tạo timer thứ hai.
- Phòng có bot vẫn dùng được nhưng bot không được tính.
- Sang ngày mới, reset và bắt đầu ván mới đều có tập phiếu rỗng.
- Cleanup phòng xoá entry khỏi map trạng thái tạm.
- Người chưa đồng ý rời phòng làm tiến độ từ `2/3` thành `2/2` thì phòng chuyển ngay sang `VOTING`.
- Request AI bot đang chờ khi đạt đồng thuận không được ghi chat hoặc phiếu dự kiến sau khi chuyển pha.
- Typecheck/build frontend xác nhận callback và kiểu snapshot mới được nối đúng.

## Ngoài phạm vi

- Không cho chủ phòng đặt phần trăm đồng thuận khác 100%.
- Không cho bot tự quyết định skip.
- Không thay đổi thời lượng thảo luận hoặc bỏ phiếu trong cấu hình phòng.
- Không thay đổi luật bỏ phiếu treo cổ hiện tại.
