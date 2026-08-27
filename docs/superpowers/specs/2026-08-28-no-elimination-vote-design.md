# Lựa chọn không treo ai khi bỏ phiếu

Ngày: 2026-08-28

## Mục tiêu

Trong pha `VOTING`, thêm lựa chọn chính thức `Không treo ai`. Lựa chọn này được tính như một ứng viên trong kết quả bỏ phiếu: nếu có số phiếu cao nhất, hoặc hòa ở vị trí cao nhất, không người chơi nào bị loại.

## Luật đã thống nhất

- Chỉ người còn sống được vote, giữ nguyên luật hiện tại.
- Mỗi người chọn đúng một trong hai dạng: một người chơi còn sống hoặc `Không treo ai`.
- Sau khi gửi phiếu thì không đổi, giống UI hiện tại.
- Phiếu `Không treo ai` được tính là đã vote, nên `allAliveVoted()` vẫn có thể kết thúc pha sớm.
- Một người bị loại chỉ khi người đó có số phiếu cao nhất duy nhất và cao hơn số phiếu `Không treo ai`.
- Nếu `Không treo ai` cao nhất, hoặc bất kỳ lựa chọn nào hòa ở vị trí cao nhất, không ai bị loại.
- Bot vẫn chọn người như hiện tại; chưa cho AI chủ động chọn `Không treo ai`.

Ví dụ với 6 người còn sống:

| Phiếu | Kết quả |
|---|---|
| Không treo 3, A 2, B 1 | Không ai bị loại |
| A 3, Không treo 2, B 1 | A bị loại |
| A 2, Không treo 2, B 2 | Hòa, không ai bị loại |
| A 1, Không treo 5 | Không ai bị loại |

## Các phương án biểu diễn state

### 1. Chuỗi sentinel — không chọn

Lưu một id giả như `__NO_ELIMINATION__` trong `votes: Record<string, string>`. Ít thay đổi kiểu nhưng làm id giả rò qua engine/client và buộc mọi nơi dùng target id phải nhớ loại nó.

### 2. Object union cho từng phiếu — không chọn

Lưu `{ type: "PLAYER", targetId } | { type: "NO_ELIMINATION" }`. Rõ nghĩa nhất nhưng tạo thay đổi lớn ở serialization, bot, snapshot và toàn bộ test cho một lựa chọn đơn giản.

### 3. `null` là không treo, `undefined` là chưa vote — chọn

Đổi state thành `votes: Record<string, string | null>`:

- Không có key / giá trị `undefined`: chưa vote.
- Chuỗi id: vote một người.
- `null`: vote `Không treo ai`.

Thêm cờ `hasVoted` vào snapshot để client phân biệt `myVote === null` là chưa vote hay đã chọn không treo. Đây là biểu diễn nhỏ nhất vẫn có type rõ ràng và serialize JSON tự nhiên.

## Engine

### State và API

Trong `packages/game-engine/src/types.ts`:

```ts
votes: Record<string, string | null>;
```

Trong `GameEngine`:

```ts
submitVote(voterId: string, targetId: string | null): void;
```

Khi `targetId === null`, engine vẫn kiểm tra phase và voter còn sống, sau đó lưu `st.votes[voterId] = null`; không chạy validate mục tiêu.

Engine từ chối nếu `st.votes[voterId] !== undefined`, kể cả phiếu cũ là `null`. UI hiện đã khóa sau lần gửi đầu tiên; kiểm tra server biến luật “không đổi phiếu” thành ràng buộc thật thay vì chỉ dựa vào client.

`allAliveVoted()` tiếp tục dùng kiểm tra `st.votes[playerId] !== undefined`, vì `null` là một phiếu hợp lệ.

### Tally và resolve

`voteTally()` trả cấu trúc tách biệt:

```ts
{
  players: Record<string, number>;
  noElimination: number;
}
```

`resolveVote()` dựng danh sách ứng viên từ tất cả player tally cộng lựa chọn không treo. Chỉ loại người khi ứng viên đứng đầu là player và có số phiếu lớn hơn ứng viên thứ hai. Mọi trường hợp còn lại trả `null`.

Log phân biệt:

- Player thắng: `Dân làng đã loại <tên>.`
- Không treo thắng: `Dân làng quyết định không treo ai.`
- Hòa: `Hoà phiếu, không ai bị loại.`

UI kết quả dùng câu chung `Không ai bị loại hôm nay.` để không phải mở rộng persisted state chỉ nhằm phân biệt hai nhánh đều không có nạn nhân.

## Snapshot dùng chung

Thêm vào `PlayerGameView` và `RoomSnapshot`:

```ts
hasVoted: boolean;
noEliminationVoteCount: number;
```

Giữ `myVote: string | null`:

- `hasVoted === false`, `myVote === null`: chưa vote.
- `hasVoted === true`, `myVote === null`: đã chọn không treo ai.
- `hasVoted === true`, `myVote === "player-id"`: đã chọn người đó.

Với viewer chết hoặc ngoài phòng, `hasVoted` là false và `myVote` là null. `noEliminationVoteCount` hiển thị trong `VOTING` theo cùng chính sách hiện tại đang hiển thị `PlayerView.voteCount`.

Snapshot lobby gán `hasVoted: false`, `noEliminationVoteCount: 0`. Các fixture bot và script thủ công cũng thêm hai giá trị này.

## Socket.IO

Đổi schema:

```ts
votePayload = z.object({ targetId: z.string().min(1).nullable() }).strict();
```

Handler giữ nguyên luồng validate/rate-limit và gọi:

```ts
room.engine.submitVote(playerId, targetId);
```

Client không gửi nhãn hoặc số phiếu; `null` là ý định duy nhất cho không treo.

## Giao diện

Trong card bỏ phiếu:

- Nút chọn người và xác nhận `Bỏ phiếu` giữ nguyên.
- Thêm nút secondary `Không treo ai (x phiếu)` khi người sống chưa vote.
- Bấm nút gửi `onVote(null)` ngay, cùng hành vi khóa phiếu như khi xác nhận một người.
- Sau khi vote người: `Bạn đã bỏ phiếu cho <tên>.`
- Sau khi chọn không treo: `Bạn đã chọn không treo ai.`
- Điều kiện khóa dùng `snapshot.hasVoted`, không dùng truthiness của `myVote`.
- Người chết chỉ thấy tiến độ, không thấy nút thao tác.
- Ở pha kết quả, `lastEliminated === null` hiển thị `Không ai bị loại hôm nay.` thay vì luôn khẳng định hòa phiếu.

Prop đổi thành:

```ts
onVote: (targetId: string | null) => void;
```

## Bot và E2E

- `legalVoteTargets` và AI schema vẫn chỉ trả player id hoặc `null` với nghĩa chưa quyết định; fallback hiện tại tiếp tục chọn một player hợp lệ.
- `scheduleVoteBots` chỉ submit khi có target string, nên bot không tự vote không treo.
- E2E phải dùng `snapshot.hasVoted` thay cho `snapshot.myVote` để nhận biết người đã vote, vì `myVote === null` có hai nghĩa.

## Tương thích và persistence

- Game state cũ chỉ chứa string trong `votes`, là tập con hợp lệ của kiểu mới.
- Không thay đổi Prisma schema và không cần migration.
- Room đang chơi không được phục hồi qua restart theo cơ chế hiện tại; persisted compatibility không tạo thêm nhánh phục hồi.
- Socket payload cũ `{ targetId: "id" }` vẫn hợp lệ.

## Kiểm thử

Viết test trước implementation cho:

- `submitVote(id, null)` được tính là đã vote nhưng không cộng cho player.
- Người chết không được vote không treo.
- Người đã gửi một phiếu không thể đổi từ player sang không treo hoặc ngược lại.
- Tất cả chọn không treo làm `allAliveVoted()` true và không ai bị loại.
- Không treo cao nhất thì không ai bị loại.
- Player cao nhất duy nhất và cao hơn không treo thì bị loại.
- Hòa player với không treo thì không ai bị loại.
- Snapshot phân biệt chưa vote và đã vote không treo bằng `hasVoted`.
- `noEliminationVoteCount` đúng và không làm tăng `PlayerView.voteCount`.
- Schema chấp nhận `targetId: null` nhưng vẫn từ chối thiếu field, chuỗi rỗng và field thừa.
- `maybeEndVotingEarly` chấp nhận phiếu không treo như phiếu hoàn thành.
- Web/server/shared typecheck và production build.

## Ngoài phạm vi

- Không cho đổi hoặc rút phiếu sau khi gửi.
- Không thêm cấu hình bật/tắt lựa chọn không treo.
- Không thay đổi AI prompt để bot cân nhắc không treo.
- Không đổi luật đồng thuận `Skip thảo luận` vừa triển khai.
