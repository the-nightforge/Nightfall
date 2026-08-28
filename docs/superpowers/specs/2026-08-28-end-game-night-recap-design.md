# Tổng kết diễn biến các đêm khi ván kết thúc

Ngày: 2026-08-28

## Mục tiêu

Khi một ván Ma Sói chuyển sang `GAME_OVER`, hiển thị lại đầy đủ diễn biến của từng đêm trong chính ván đó. Lịch sử chỉ tồn tại trong vòng đời của ván hiện tại, không được mang sang ván kế tiếp và không được công khai trước khi ván kết thúc.

## Phạm vi đã thống nhất

- Ghi lại các hành động và kết quả của mỗi đêm trong ván hiện tại.
- Tại màn hình kết thúc, hiển thị lần lượt `Đêm 1`, `Đêm 2`, ... theo thứ tự thời gian.
- Mỗi đêm cho biết Sói chọn ai, Bảo Vệ bảo vệ ai, Tiên Tri soi ai và kết quả, Phù Thủy có cứu/đầu độc ai hay không, và kết quả người chết.
- Khi bắt đầu ván mới hoặc trở về phòng chờ, lịch sử ván trước không còn xuất hiện.
- Không xây dựng kho lưu trữ các ván cũ, trang lịch sử trận đấu, hoặc nút kết thúc ván thủ công.
- Không dùng AI để viết phần tổng kết; giao diện dựng nội dung từ dữ liệu engine để bảo đảm chính xác.

## Phương án được chọn

Thêm một mảng lịch sử có cấu trúc vào `GameState` và chụp lại trạng thái hành động ngay trong `resolveNight()`.

Không ghép lại diễn biến từ `log`: log hiện chỉ giữ câu tổng quát và không đủ dữ liệu để biết mục tiêu của từng vai. Không dùng văn bản do AI tạo vì có thể sai khác với kết quả thật, phát sinh chi phí và làm tính năng phụ thuộc dịch vụ bên ngoài.

## Mô hình dữ liệu

Thêm kiểu dùng chung cho một đêm đã xử lý. Dữ liệu dùng id để giữ quan hệ ổn định và kèm tên để bản ghi vẫn tự mô tả:

```ts
interface NightRecap {
  round: number;
  wolfTarget: RecapPlayer | null;
  guardTarget: RecapPlayer | null;
  seerChecks: Array<{
    seer: RecapPlayer;
    target: RecapPlayer;
    isWolf: boolean;
  }>;
  witch: {
    usedHeal: boolean;
    healedTarget: RecapPlayer | null;
    poisonTarget: RecapPlayer | null;
  };
  deaths: Array<{
    player: RecapPlayer;
    cause: "wolf" | "poison";
  }>;
}

interface RecapPlayer {
  id: string;
  name: string;
}
```

`GameState` có thêm `nightHistory: NightRecap[]`, được khởi tạo rỗng trong `GameEngine.create()`.

`healedTarget` là mục tiêu Sói của đêm đó khi Phù Thủy đã dùng bình cứu hợp lệ. Nếu không có mục tiêu Sói nhưng hành động cứu vẫn được gửi, ghi `usedHeal: true` và `healedTarget: null`; giao diện diễn đạt là đã dùng bình cứu nhưng không có nạn nhân để cứu.

Các hành động được ghi đúng như đã xảy ra, kể cả khi không thay đổi kết quả. Ví dụ nếu Bảo Vệ và Phù Thủy cùng bảo vệ/cứu mục tiêu của Sói, recap hiển thị cả hai hành động thay vì suy đoán riêng hành động nào là nguyên nhân duy nhất khiến mục tiêu sống sót.

## Ghi lịch sử trong engine

Trong `resolveNight()`:

1. Xử lý tử vong theo luật hiện tại, không thay đổi thứ tự hoặc luật chơi.
2. Trước khi chuyển sang `NIGHT_RESULT`, tạo một `NightRecap` từ `state.night`, danh sách người chơi và danh sách tử vong vừa tính.
3. Thêm đúng một bản ghi vào `state.nightHistory` cho mỗi lần xử lý đêm thành công.

Không thêm bản ghi khi gọi sai phase và `resolveNight()` ném lỗi. Việc chuyển sang đêm tiếp theo chỉ reset `state.night`; không xóa `nightHistory`.

Một game engine mới luôn có `nightHistory: []`, nên luồng chơi lại vốn tạo ván mới sẽ tự xóa recap cũ. Nếu nhận state cũ chưa có field này, constructor/view phải dùng giá trị mặc định rỗng để tránh lỗi trong quá trình triển khai hoặc khi đọc dữ liệu cũ.

## Quyền riêng tư và snapshot

Thêm `nightHistory: NightRecap[]` vào snapshot dùng chung, nhưng áp dụng quy tắc:

- `phase === "GAME_OVER"`: trả toàn bộ lịch sử đêm.
- Mọi phase khác, kể cả người chơi đã chết: trả `[]`.
- Snapshot phòng chờ: trả `[]`.

Quy tắc này nghiêm ngặt hơn cơ chế công bố vai trò cho người đã chết. Người chết có thể biết vai trò hiện tại nhưng không được nhận toàn bộ mục tiêu bí mật của Bảo Vệ, Tiên Tri hoặc Phù Thủy trước khi ván kết thúc.

## Giao diện kết thúc

Trong `GameOverView`, thêm card `Diễn biến các đêm` sau danh sách vai trò:

- Các đêm hiển thị từ cũ đến mới.
- Mỗi đêm là một khối riêng có tiêu đề `Đêm N`.
- Các dòng hành động chỉ dùng dữ liệu thật:
  - `Sói chọn cắn <tên>` hoặc `Sói không chọn được mục tiêu`.
  - `Bảo Vệ bảo vệ <tên>` hoặc `Bảo Vệ không hành động`.
  - Mỗi kết quả soi: `Tiên Tri <tên> soi <tên>: Ma Sói/Không phải Ma Sói`.
  - `Phù Thủy dùng bình cứu cho <tên>`, `Phù Thủy đã dùng bình cứu nhưng không có nạn nhân`, hoặc `Phù Thủy không dùng bình cứu`.
  - `Phù Thủy đầu độc <tên>` hoặc `Phù Thủy không dùng bình độc`.
  - Kết quả: danh sách người chết kèm nguyên nhân, hoặc `Không ai chết trong đêm này`.
- Nếu ván kết thúc trước khi có đêm nào được xử lý, hiển thị `Ván đấu kết thúc trước khi có diễn biến ban đêm.`
- Giao diện không thêm nút hoặc luồng điều hướng mới; các nút chơi lại/rời phòng giữ nguyên.

Nội dung được trình bày dạng timeline/card gọn trên màn hình nhỏ. Không cần animation hoặc thư viện UI mới.

## Dòng dữ liệu

```text
Hành động ban đêm
        |
        v
resolveNight() -> NightRecap -> GameState.nightHistory
                                      |
                      chỉ GAME_OVER   v
                               RoomSnapshot
                                      |
                                      v
                              GameOverView
```

## Tương thích và persistence

- Không thay đổi Prisma schema và không cần migration cơ sở dữ liệu.
- Lịch sử nằm cùng state của game engine và có cùng vòng đời với ván hiện tại.
- Không lưu recap vào chat log, tránh trộn dữ liệu bí mật với các kênh chat.
- Không thay đổi luật phân vai, hành động ban đêm, tính tử vong hoặc điều kiện thắng.

## Kiểm thử

Viết test trước implementation cho các trường hợp:

- Engine khởi tạo với lịch sử rỗng.
- Mỗi lần `resolveNight()` thành công thêm đúng một bản ghi theo đúng số đêm.
- Recap ghi đúng mục tiêu của Sói và Bảo Vệ.
- Recap ghi tất cả kết quả soi và giá trị `isWolf`.
- Recap ghi đúng việc dùng bình cứu, mục tiêu được cứu, bình độc và nguyên nhân tử vong.
- Một người chỉ xuất hiện một lần trong danh sách chết nếu nhiều nguyên nhân cùng nhắm tới họ, nhất quán với luật hiện tại.
- Đêm không có người chết vẫn có bản ghi và danh sách `deaths` rỗng.
- Snapshot luôn trả lịch sử rỗng trước `GAME_OVER`, kể cả cho người đã chết.
- Snapshot trả toàn bộ lịch sử khi `GAME_OVER`.
- Snapshot lobby trả lịch sử rỗng.
- Ván mới có lịch sử rỗng, không mang dữ liệu từ ván trước.
- Typecheck và production build của shared, engine, server và web thành công.

## Ngoài phạm vi

- Lịch sử các pha ban ngày, chat và chi tiết từng lá phiếu.
- Lưu hoặc tra cứu những ván đã kết thúc trước đó.
- Xuất recap thành ảnh, PDF hoặc đường dẫn chia sẻ.
- Tạo lời kể bằng Gemini/OpenAI.
- Thêm nút buộc kết thúc ván.
