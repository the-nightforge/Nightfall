# Phiên toà: biện hộ và bỏ phiếu xác nhận

Ngày: 2026-08-28

## Mục tiêu

Thay vòng bỏ phiếu ban ngày một-lượt-là-chết bằng một phiên toà năm bước:

```
Thảo luận -> Vote sơ bộ -> Người cao phiếu nhất biện hộ -> Vote xác nhận -> Treo / Không treo
```

Lý do: hiện `resolveVote()` giết ngay người dẫn phiếu, nên một làn sóng bandwagon sớm là không thể cứu vãn và người bị nghi oan không có một giây nào để nói. Phiên toà tách "bị nghi" khỏi "bị kết án", cho bị cáo một cửa sổ độc quyền để phản biện, và bắt cả làng cam kết một lần nữa bằng lá phiếu nhị phân.

Tính năng phải chạy đúng cho cả người thật lẫn bot, chịu được mất kết nối giữa chừng, và không làm phình chi phí gọi nhà cung cấp AI.

## Luật đã chốt

### Vote sơ bộ (đề cử)

- Giữ nguyên cách kiểm phiếu hiện tại: mỗi người sống một phiếu, "Không treo ai" là ứng viên ngang hàng chứ không phải phiếu trắng.
- **Dẫn phiếu duy nhất là một người chơi** -> người đó thành bị cáo, vào pha biện hộ.
- **"Không treo ai" thắng** -> không mở phiên toà, hôm nay không ai bị loại, vào đêm.
- **Hoà phiếu** (kể cả hoà giữa một người và "không treo ai") -> không mở phiên toà, không ai bị loại, vào đêm.
- **Không ai bỏ phiếu** -> không mở phiên toà.
- Vote sơ bộ **không giết ai**. Đây là thay đổi ngữ nghĩa lớn nhất của tính năng.

### Biện hộ

- Chỉ bị cáo được nói vào kênh `day`. Mọi người sống khác bị chặn gửi, vẫn đọc được.
- Người chết vẫn chat bình thường trong kênh `dead` và vẫn xem được kênh `day`.
- Số phiếu sơ bộ tiếp tục hiển thị trong suốt pha này — đó chính là thông tin bị cáo phải phản biện.
- Bị cáo mất kết nối thì đồng hồ vẫn chạy hết. Không rút ngắn, không tự bỏ qua: họ có thể vào lại kịp.
- Bị cáo là bot thì bot tự sinh một lời biện hộ.

### Vote xác nhận

- Lá phiếu nhị phân: **Treo** (`guilty`) hoặc **Tha** (`innocent`). Không có lựa chọn thứ ba.
- **Bị cáo không được bỏ phiếu.** Cho họ vote thì họ luôn tự tha, chỉ làm lệch ngưỡng.
- Cử tri hợp lệ = người còn sống trừ bị cáo.
- **Ngưỡng treo: đa số tuyệt đối trên số cử tri hợp lệ**, tính bằng số nguyên: `guilty * 2 > eligible`.
- **Không bỏ phiếu = phiếu trắng = tha.** Chọn ngưỡng theo tổng cử tri chứ không theo số phiếu đã bỏ là có chủ đích: nếu tính theo phiếu đã bỏ, một phòng đang lag treo được người bằng đúng 2 phiếu.
- Hoà hoặc không đạt ngưỡng -> tha. Mọi tình huống không rõ ràng đều nghiêng về không giết.
- Số phiếu Treo/Tha hiển thị trực tiếp trong lúc bỏ, giống pha vote sơ bộ hiện tại.
- Mọi cử tri hợp lệ đã bỏ phiếu thì pha kết thúc sớm sau 800ms, giống `maybeEndVotingEarly`.

### Sau phiên toà

- **Một phiên toà mỗi ngày.** Tha rồi thì vào đêm luôn, không quay lại thảo luận để tố người khác. Không có giới hạn này thì một ngày kéo dài không xác định.
- Treo thành công -> giết bị cáo, kích hoạt Thợ Săn nếu đó là Thợ Săn, rồi `ELIMINATION` như hiện tại.
- Tha -> không ai chết, vẫn qua `ELIMINATION` để cả phòng đọc kết quả.

## Nhịp trận

Ngày hiện tại: 90s thảo luận + 30s vote = 120s.
Ngày sau thay đổi: 60s thảo luận + 30s sơ bộ + 25s biện hộ + 20s xác nhận = 135s.

Hạ `discussionSeconds` mặc định từ 90 xuống 60 là một phần của tính năng, không phải tinh chỉnh rời: vote sơ bộ giờ đã đóng vai trò vòng thảo luận thứ hai, và nút đồng thuận skip thảo luận đang có vẫn cắt được phần thừa.

## Lựa chọn kiến trúc

### Thêm hai phase, giữ nguyên tên `VOTING`

```
DAY_DISCUSSION -> VOTING -> DEFENSE -> FINAL_VOTE -> ELIMINATION
```

`VOTING` đổi ngữ nghĩa (đề cử thay vì kết án) nhưng **giữ nguyên tên**. Đổi tên thành `NOMINATION` sẽ kéo theo `PhaseBanner`, `audio-track`, cổng chat và toàn bộ test đang tham chiếu chuỗi đó, mà không đổi được hành vi nào. Nhãn hiển thị đổi thành "Bỏ phiếu sơ bộ"; hằng số giữ nguyên.

Hai phase mới là phase thật chứ không phải hai chặng bên trong `VOTING`. Lý do giống hệt lúc thêm `HUNTER_SHOT`: mỗi phase một timer duy nhất, snapshot có quyền hành động rõ ràng, reconnect khôi phục đúng màn hình, và cổng chat gắn được vào phase thay vì vào một cờ phụ.

Đêm thì ngược lại — nó vẫn là một pha `NIGHT` chia hai chặng bằng `wolvesLocked` — vì hai chặng đêm không đổi ai được nói với ai. Phiên toà thì có.

### Trạng thái phiên toà là một object nullable

```ts
interface TrialState {
  accusedId: string;
  /** voterId -> true là Treo, false là Tha. Key vắng mặt = chưa bỏ phiếu. */
  finalVotes: Record<string, boolean>;
}

interface TrialRecap {
  accused: RecapPlayer;
  guilty: number;
  innocent: number;
  abstain: number;
  lynched: boolean;
}
```

`GameState` thêm `trial: TrialState | null` và `lastTrial: TrialRecap | null`.

Gói vào một object thay vì hai trường phẳng `accusedId` + `finalVotes` để "đang có phiên toà" là đúng một phép kiểm tra, và để không tồn tại trạng thái nửa vời (có bị cáo mà thiếu bảng phiếu). Đây cũng là hình dạng `hunterReaction` đang dùng.

`finalVotes` dùng `boolean` chứ không phải `string | null` như `votes`: lá phiếu này chỉ có hai giá trị, và cả hai đều là lựa chọn có chủ đích. "Chưa bỏ phiếu" vẫn phân biệt bằng key vắng mặt, giống nguyên tắc đang áp dụng cho `votes` và `wolfVotes`.

### Tách `resolveVote` thành hai

`resolveVote()` hiện tại làm ba việc trong một hàm: kiểm phiếu, giết người, chuyển pha. Tách thành:

```ts
type NominationOutcome =
  | { kind: "TRIAL"; accusedId: string }
  | { kind: "NONE"; reason: "no-elimination" | "tie" | "no-votes" };

resolveNomination(now): NominationOutcome   // KHÔNG giết ai
resolveFinalVote(now): PublicDeath | null   // giết, xếp hàng Thợ Săn
```

`resolveNomination` giữ nguyên toàn bộ logic kiểm phiếu của `resolveVote` (kể cả cách "Không treo ai" thắng được và hoà được), chỉ bỏ đoạn giết. Nhờ vậy hai nhánh `NONE` hành xử y hệt hôm nay và bộ test `no-elimination-vote-*` vẫn mô tả đúng luật.

`queueHunterReaction([eliminated], "vote")` chuyển từ `resolveVote` sang `resolveFinalVote`, và chỉ chạy khi thật sự treo. Ngoài chỗ đó, Thợ Săn không phải sửa gì: `continueAfterDeathResult(room, "vote")` đã xử lý đủ.

### Ngưỡng tính bằng số nguyên

```ts
const eligible = this.alivePlayers().filter((p) => p.id !== trial.accusedId).length;
const lynched = eligible > 0 && guilty * 2 > eligible;
```

Nhân đôi thay vì chia đôi: `guilty > eligible / 2` với `eligible` lẻ đưa số thực vào một phép so sánh mà kết quả quyết định ai sống ai chết. `eligible === 0` là bất khả thi trong ván hợp lệ (game đã kết thúc trước đó), nhưng vẫn chặn để không nhánh nào treo người bằng 0 phiếu.

### Sự kiện socket riêng

Thêm `CLIENT_EVENTS.GAME_FINAL_VOTE = "game:final-vote"` với `finalVotePayload = z.object({ guilty: z.boolean() }).strict()`.

Không tái dùng `game:vote`: payload khác hình dạng (boolean so với id nullable), và nới `votePayload` để nhận cả hai sẽ biến nó thành một union mà server phải phân giải theo phase — đúng loại chỗ để lọt một phiếu gửi nhầm pha.

### Bot: cả lời biện hộ lẫn phiếu xác nhận đều gọi AI

Cả hai quyết định mới đều đi qua chuỗi não thật:

- **Lời biện hộ**: tối đa một lượt mỗi ngày, chỉ khi bị cáo là bot.
- **Phiếu xác nhận**: một lượt cho mỗi bot còn sống khác bị cáo, mỗi ngày.

Đây là điểm khiến phiên toà có ý nghĩa thay vì chỉ là thêm hai màn hình: prompt phiếu xác nhận đọc lời biện hộ vừa phát trong kênh `day`, nên bot thật sự đổi được phiếu sau khi nghe. Không có nó, biện hộ chỉ là một khoảng chờ 25 giây trong phòng đông bot.

Prompt phiếu xác nhận dùng lại `chatBlock(view)` đang có, vốn lấy 20 dòng chat gần nhất — lời biện hộ nằm ngay trong đó vì nó được đẩy vào kênh `day` ở pha trước. Prompt phải chỉ đích danh: đây là lời tự bào chữa của bị cáo, hãy cân nhắc nó cùng với số phiếu sơ bộ đang hiển thị.

### Ngân sách gọi nhà cung cấp

Tính năng này nâng đáng kể số lượt gọi mỗi ván. Ước lượng cho phòng 8 bot chơi 6 vòng:

| Khoản | Lượt |
| --- | --- |
| Hành động đêm (~4 bot có vai đêm) | ~24 |
| Lời thoại ban ngày | ~48 |
| Phiếu xác nhận (mới) | ~48 |
| Lời biện hộ (mới) | ~6 |
| **Tổng** | **~126** |

Mặc định hiện tại là 60, tức governor sẽ ngắt mạch từ giữa ván. Nâng mặc định của `resolveBotAiMaxCallsPerGame` lên **180** để một ván đầy đủ chạy hết mà vẫn còn trần chặn sự cố lặp vô hạn. `BOT_AI_MAX_CALLS_PER_GAME` vẫn là đường tinh chỉnh theo môi trường và cần đặt lại trên Render.

### Hạn chót và đường lui của phiếu xác nhận

Chuỗi não có hạn chót 9s cho nhà cung cấp chính và 4s cho mỗi chặng dự phòng, xấu nhất 13s. Cửa sổ `finalVoteSeconds` vì thế **không được ngắn hơn 15 giây** — dưới mức đó thì gần như mọi lượt gọi đều lỡ hạn và cả phòng bot rơi hết về đường lui.

Xếp lịch theo đúng khuôn `scheduleNightBots`: gọi ngay ở t=0, nộp ở `max(delay, lúc kết quả về)`, và một timer hạn chót cứng nộp thay bằng đường lui. Đường lui là `RandomBrain.decideFinalVote`, suy ra tại chỗ không gọi mạng:

```
Sói mà bị cáo là đồng bọn Sói           -> Tha
Phiếu sơ bộ của mình là "không treo ai" -> Tha
còn lại                                 -> Treo
```

Nhánh "còn lại -> Treo" là lựa chọn cân bằng chứ không phải cho tiện. Nếu đường lui chỉ Treo khi chính bot đó đã đề cử bị cáo, một làng bot rải phiếu sẽ không bao giờ đạt đa số tuyệt đối, không ai bị treo, và Sói thắng bằng bào mòn mỗi khi nhà cung cấp gặp sự cố. Nhánh Sói tha đồng bọn giữ cho đường lui không tự bán phe mình.

## Mô hình dữ liệu

### Cấu hình phòng

```ts
defenseSeconds: number;    // mặc định 25, hợp lệ 10..60
finalVoteSeconds: number;  // mặc định 20, hợp lệ 15..60
discussionSeconds: number; // mặc định đổi 90 -> 60
```

Cận dưới của `finalVoteSeconds` là 15 chứ không phải 10 vì chuỗi não mất tới 13 giây ở trường hợp xấu nhất; xem mục hạn chót ở trên.

Phòng lưu trong Redis từ trước khi có tính năng thiếu hai khoá mới. Chuẩn hoá trong `loadRoomFromRedis` đúng chỗ đang chuẩn hoá `hunter` và `cursed`, vì `roomConfigSchema` là `.strict()` và sẽ từ chối config thiếu trường.

### Snapshot

```ts
interface TrialView {
  accusedId: string;
  accusedName: string;
  /** Chỉ có nghĩa trong FINAL_VOTE. */
  guiltyVotes: number;
  innocentVotes: number;
  /** Số phiếu Treo tối thiểu để kết án, để UI khỏi tự tính lại ngưỡng. */
  guiltyRequired: number;
  /** Viewer còn sống, không phải bị cáo, và chưa bỏ phiếu. */
  canVote: boolean;
  hasVoted: boolean;
  /** null nghĩa là chưa bỏ, không phải phiếu Tha. */
  myVote: boolean | null;
  /** Chỉ trong DEFENSE, và chỉ đúng với bị cáo. */
  canSpeak: boolean;
}
```

`RoomSnapshot` thêm `trial: TrialView | null` và `lastTrial: TrialRecap | null` (chỉ có dữ liệu ở `ELIMINATION` và `CHECK_WIN`).

`votesRevealed` phải bật thêm ở `DEFENSE` và `FINAL_VOTE`, và `showVoteCounts` trong `snapshotFor` mở rộng tương ứng: số phiếu sơ bộ là bối cảnh của cả phiên toà, giấu đi thì biện hộ mất chỗ bám.

### Cổng chat

`resolveChat` thêm nhánh trước nhánh ban ngày chung:

```ts
if (view.phase === "DEFENSE" && senderId !== room.engine.state.trial?.accusedId) {
  return { ok: false, error: "Chỉ người đang biện hộ được nói" };
}
```

Nhánh người chết nằm **trước** nhánh này và giữ nguyên: người chết vẫn chat kênh `dead` trong lúc biện hộ.

`FINAL_VOTE` mở chat như `VOTING`. `visibleChatLog` coi cả `DEFENSE` và `FINAL_VOTE` như các pha ban ngày khác.

## Màn hình kết quả

`ELIMINATION` giờ có bốn kết cục phải phân biệt được, so với ba hôm nay:

1. Treo thành công — hiện vai trò như hiện tại.
2. **Tha** — "Làng đã tha X." kèm tỉ số Treo/Tha. Kết cục mới.
3. "Không treo ai" thắng vòng sơ bộ.
4. Hoà phiếu sơ bộ.

Kết cục 3 và 4 gộp chung một câu như hiện tại. Kết cục 2 cần `lastTrial` mới nói được, vì `lastEliminated === null` không phân biệt được nó với 3 và 4.

## Ngoài phạm vi

- Nhiều phiên toà trong một ngày.
- Giấu số phiếu xác nhận cho tới lúc chốt.
- Cho bị cáo quyền im lặng có chủ đích (hiện tại không nói gì và mất kết nối là một).
