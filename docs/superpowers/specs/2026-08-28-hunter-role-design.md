# Vai trò Thợ Săn

Ngày: 2026-08-28

## Mục tiêu

Thêm vai trò `HUNTER` thuộc phe làng. Khi Thợ Săn chết bởi bất kỳ nguyên nhân nào trong ván hiện tại — Sói cắn, Phù Thuỷ đầu độc hoặc bị treo cổ — người đó có một lượt phản ứng để bắn một người còn sống hoặc chủ động không bắn.

Phát bắn diễn ra trước lần kiểm tra thắng kế tiếp, vì nó có thể thay đổi phe chiến thắng. Tính năng phải hoạt động cho cả người thật và bot, chịu được người chơi mất kết nối rồi kết nối lại trong lúc server vẫn chạy, và xuất hiện trong diễn biến cuối ván.

## Luật đã chốt

- Mỗi ván có tối đa một Thợ Săn.
- Chủ phòng bật hoặc tắt Thợ Săn trong cấu hình; mặc định tắt để không làm thay đổi phòng cũ.
- Thợ Săn được kích hoạt khi chết do `wolf`, `poison` hoặc `vote`.
- Sau màn hình kết quả cái chết, game chuyển sang phase `HUNTER_SHOT` trong 15 giây.
- Thợ Săn chọn đúng một người còn sống để bắn hoặc chọn **Không bắn ai**.
- Không được bắn chính mình hoặc người đã chết.
- Hết thời gian, mất kết nối hoặc không gửi lựa chọn đều được xử lý là không bắn.
- Phát bắn giết mục tiêu ngay lập tức và không thể bị Bảo Vệ hay bình cứu ngăn lại.
- Điều kiện thắng chỉ được kiểm tra sau khi lượt bắn hoàn tất hoặc hết hạn.
- Không có dây chuyền Thợ Săn trong phạm vi tính năng này vì cấu hình chỉ cho tối đa một Thợ Săn.

## Lựa chọn kiến trúc

Thêm phase riêng `HUNTER_SHOT` thay vì nhét hành động vào `NIGHT_RESULT` hoặc `ELIMINATION`.

Phase riêng giúp server có một timer duy nhất, snapshot có quyền hành động rõ ràng, reconnect khôi phục đúng màn hình và engine không phải cho phép một người đã chết gửi hành động đêm/ngày thông thường. Nó cũng giữ `NIGHT_RESULT` và `ELIMINATION` là các phase chỉ đọc như hiện tại.

Không tự chọn mục tiêu ngẫu nhiên cho người thật khi timeout. Timeout là bỏ qua để tránh server quyết định thay một hành động có thể đảo kết quả ván.

## Mô hình dữ liệu

### Role và cấu hình

- Thêm `HUNTER` vào `ROLES` và `ROLE_META`, phe `village`, không có `nightOrder`.
- Thêm `hunter: boolean` vào `RoomConfig`, schema và `DEFAULT_ROOM_CONFIG` với giá trị `false`.
- `buildRoleDeck` thêm đúng một `HUNTER` khi bật và vẫn yêu cầu còn ít nhất một `VILLAGER`.
- Khi đọc room/state cũ không có trường `hunter`, chuẩn hoá về `false` trước khi validate hoặc sử dụng.

### Trạng thái engine

Thêm trạng thái serializable, không dùng callback hoặc closure:

```ts
interface HunterReactionState {
  hunterId: string;
  source: "night" | "vote";
  resolved: boolean;
}
```

`GameState` có `hunterReaction: HunterReactionState | null` và `hunterShots: HunterShotRecap[]`.

```ts
interface HunterShotRecap {
  round: number;
  hunter: RecapPlayer;
  target: RecapPlayer | null;
  source: "night" | "vote";
}
```

`hunterReaction` đủ để client khôi phục đúng màn hình sau reconnect trong cùng process. `source` quyết định luồng tiếp theo sau phát bắn:

- `night` → kiểm tra thắng → `DAY_DISCUSSION` nếu chưa thắng.
- `vote` → kiểm tra thắng → `NIGHT` nếu chưa thắng.

State cũ thiếu hai trường được chuẩn hoá thành `null` và `[]` trong constructor engine.

## Luồng engine

### Phát hiện Thợ Săn chết

`resolveNight()` và `resolveVote()` vẫn là nơi duy nhất thay đổi trạng thái sống/chết theo luật hiện tại. Sau khi tính toàn bộ cái chết của lần resolve, engine kiểm tra người chết có role `HUNTER` hay không. Nếu có, engine tạo `hunterReaction` nhưng vẫn giữ phase kết quả hiện tại để người chơi xem kết quả trước.

Không kiểm tra thắng tại thời điểm này.

Để bảo vệ luật ở tầng engine, `checkWin()` trả về `null` khi còn một `hunterReaction` chưa resolved. Nhờ vậy một lời gọi nhầm từ machine hoặc đường khôi phục timer cũng không thể kết thúc ván trước lượt bắn.

### Mở phase bắn

Sau `RESULT_MS`, machine kiểm tra `engine.hasPendingHunterShot()`:

- Có pending → chuyển sang `HUNTER_SHOT`, đặt `phaseEndsAt = now + 15_000`, broadcast và lên lịch bot/timeout.
- Không có pending → chạy luồng `checkWinOrContinue` hiện tại.

### Gửi phát bắn

Thêm method chuyên biệt:

```ts
submitHunterShot(playerId: string, targetId: string | null): PublicDeath | null
```

Method kiểm tra:

- Phase phải là `HUNTER_SHOT`.
- `playerId` phải đúng bằng `hunterReaction.hunterId`.
- Người gửi có role `HUNTER` và đang chết.
- Reaction chưa resolved.
- Nếu có target: target tồn tại, còn sống và không phải chính Thợ Săn.

`targetId = null` là một lựa chọn bỏ qua hợp lệ. Cả bắn và bỏ qua đều thêm một record vào `hunterShots`, đánh dấu reaction resolved và không cho gửi lần hai.

Nếu có mục tiêu, engine đặt `alive = false`, thêm log công khai và trả về `PublicDeath`. `HunterShotRecap` là nguồn diễn biến riêng thể hiện nguyên nhân phát bắn; không đưa cái chết này vào `nightHistory.deaths` vì nó xảy ra ở phase phản ứng riêng.

### Hoàn tất phase

Người thật gửi lựa chọn hợp lệ hoặc bot quyết xong thì machine lên lịch hoàn tất sau 800 ms để client kịp nhận snapshot. Timeout 15 giây gọi cùng đường bỏ qua `targetId = null`, không tạo nhánh luật riêng.

Sau đó machine xoá timer, chạy `checkWinOrContinue` theo `source` và xoá pending reaction khi rời phase. Kiểm tra thắng sau phát bắn cho phép các trường hợp:

- Thợ Săn bắn Sói cuối cùng → làng thắng.
- Thợ Săn bắn người phe làng khiến Sói đạt thế cân bằng → Sói thắng.

## Socket và snapshot

Thêm payload riêng thay vì tái sử dụng `game:action`, vì người gửi đã chết và đây không phải hành động ban đêm:

```ts
hunterShotPayload = z.object({
  targetId: z.string().min(1).nullable(),
}).strict();
```

Thêm client event `game:hunter-shot`.

`RoomSnapshot` có:

```ts
hunterShot: {
  hunterId: string;
  hunterName: string;
  canAct: boolean;
  resolved: boolean;
} | null;
```

Trong phase `HUNTER_SHOT`, mọi người được biết ai là Thợ Săn vì kỹ năng đã công khai. Chỉ snapshot của đúng Thợ Săn có `canAct: true`; server vẫn validate target thay vì tin client. Không gửi role bí mật khác hoặc state thô qua snapshot.

Reconnect dùng `phase`, `phaseEndsAt` và `hunterShot` từ snapshot để dựng lại đúng màn hình. Server restart vẫn giữ hành vi hiện tại trong `rooms/store.ts`: trận đang chạy được đưa về lobby an toàn; việc khôi phục timer của toàn bộ game sau restart nằm ngoài phạm vi role này.

## Giao diện

### Phòng chờ

Thêm toggle **Thợ Săn** cạnh Tiên Tri, Bảo Vệ và Phù Thuỷ. Validation số role đặc biệt dùng cùng cơ chế hiện có và vẫn chừa ít nhất một ghế Dân Làng.

### Phase `HUNTER_SHOT`

- Người chơi khác thấy: **Thợ Săn đang chọn người để bắn…** và đồng hồ đếm ngược.
- Thợ Săn thấy danh sách người còn sống, nút **Bắn người này** và **Không bắn ai**.
- Nút bắn bị khoá khi chưa chọn mục tiêu hoặc sau khi đã gửi.
- Người chết không xuất hiện như mục tiêu hợp lệ.
- `PhaseBanner` có nhãn **Thợ Săn phản kích**.

Khi phát bắn hoàn tất, snapshot/log công khai tên người bị bắn. Nếu bỏ qua hoặc timeout, hiển thị **Thợ Săn đã không bắn ai**.

## Bot

Mở rộng `BotBrain` bằng method riêng `decideHunterShot(view)`. Không dùng `decideNight`, vì phase và quyền hành động khác nhau.

- `RandomBrain`: chọn ngẫu nhiên một người còn sống khác Thợ Săn hoặc bỏ qua với xác suất nhỏ.
- Các brain AI: prompt chỉ nhận `RoomSnapshot` đã lọc; output là `targetId | null` và được validate bằng danh sách mục tiêu hợp lệ.
- Deadline bot ngắn hơn 15 giây; nếu AI lỗi, timeout hoặc output sai thì `RandomBrain` quyết.
- Machine chỉ nộp tối đa một quyết định; engine là trọng tài cuối.

Việc sửa bot phải được thực hiện trên trạng thái code mới nhất và không được xoá các thay đổi đang có về phiếu cắn của Sói, cửa sổ Phù Thuỷ hoặc fallback AI.

## Diễn biến cuối ván

`hunterShots` chỉ được gửi đầy đủ trong `GAME_OVER`, giống `nightHistory`. Timeline cuối ván thêm mục theo vòng:

- **Thợ Săn A đã bắn B.**
- **Thợ Săn A đã không bắn ai.**

Không mang `hunterShots` sang ván mới; `resetToLobby/startGame` tạo engine mới với mảng rỗng.

## Xử lý lỗi và cạnh tranh timer

- Action sai phase, sai actor, target chết hoặc action thứ hai đều bị engine từ chối.
- Socket handler rate-limit tương tự action game hiện tại và luôn broadcast/persist sau action hợp lệ.
- Timeout và action đến đồng thời cùng đi qua cờ `resolved`; chỉ nhánh đầu tiên được áp dụng.
- `finishHunterShot` kiểm tra phase và reaction trước khi chuyển phase, nên timer cũ không thể kết thúc phase mới.
- Người chơi rời phòng hoặc mất kết nối không chặn ván; timer tự bỏ qua.
- Không gọi `checkWin()` trước khi pending reaction được xử lý.

## Kiểm thử

Viết test trước production code.

### Shared và chia vai

- `HUNTER` có metadata phe làng và mô tả đúng.
- Config bật Thợ Săn thêm đúng một role, tắt thì không thêm.
- Validation vẫn chừa ít nhất một Dân Làng và state/config cũ được chuẩn hoá.

### Engine

- Thợ Săn chết do Sói, độc hoặc vote đều tạo pending reaction.
- Cái chết không phải Thợ Săn không tạo reaction.
- Chưa xử lý reaction thì chưa chốt winner.
- Bắn mục tiêu hợp lệ làm mục tiêu chết và ghi recap.
- Bỏ qua ghi recap với target `null`.
- Từ chối sai phase, sai actor, tự bắn, bắn người chết và gửi hai lần.
- Phát bắn có thể đổi kết quả sang làng thắng hoặc Sói thắng.
- State reaction reset đúng ở ván mới.

### Server/machine

- Sau thời gian hiển thị kết quả, pending reaction mở `HUNTER_SHOT` thay vì kiểm tra thắng ngay.
- Action hợp lệ kết thúc sớm; timeout tự bỏ qua.
- Source `night` tiếp tục sang thảo luận, source `vote` tiếp tục sang đêm.
- Race giữa timeout/action chỉ resolve một lần.
- Bot AI treo hoặc lỗi vẫn được RandomBrain fallback trước deadline.
- Reconnect trong cùng process giữ đúng phase/action; load room sau server restart vẫn về lobby như hiện tại.

### Snapshot và frontend

- Chỉ Thợ Săn pending có `canAct: true`.
- Snapshot không lộ role khác.
- Giao diện người thật bắn, bỏ qua và khoá double-submit đúng.
- Timeline cuối ván hiển thị bắn và bỏ qua.

### Hồi quy

Chạy toàn bộ test engine, server và web; lint và production build. Đặc biệt giữ xanh các test về phiếu cắn Sói, cửa sổ Phù Thuỷ, skip thảo luận, không treo ai, AI fallback và lịch sử đêm.

## Ngoài phạm vi

- Nhiều hơn một Thợ Săn hoặc chuỗi Thợ Săn bắn lẫn nhau.
- Bảo Vệ/Phù Thuỷ chặn phát bắn.
- Thợ Săn bắn trước khi kết quả cái chết được hiển thị.
- Role mới khác, cặp tình nhân hoặc hiệu ứng hồi sinh.
- Thay đổi công thức cân bằng số Sói ngoài validation role hiện có.
- Khôi phục trận đang chạy và timer sau khi server process restart.
