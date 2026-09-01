# Khôi phục ván đang chơi sau khi backend restart

Ngày: 2026-09-01
Nhánh: `feat/game-state-recovery`

## Vấn đề

`loadRoomFromRedis` cố tình hạ mọi phòng `IN_GAME` về `LOBBY`
(`apps/server/src/rooms/store.ts`). Restart giữa ván là mất trắng: vai, phiếu,
lịch sử đêm, trạng thái bot đều biến mất dù engine vốn deterministic và
`GameState` vốn đã là plain object đang được ghi vào Redis.

Mục tiêu: sau restart, người chơi reconnect vào cùng room code trở lại đúng
vòng, đúng pha, đúng danh sách sống/chết, đúng phiếu, đúng lịch sử, đúng bot,
đúng đồng hồ - và không có side effect nào chạy hai lần.

Ngoài phạm vi: multi-instance, matchmaking, voice persistence (người chơi lấy
token LiveKit mới khi reconnect).

## Phương án đã chọn

**Engine snapshot có version** (phương án A), thay vì event log (B) hoặc lai
snapshot + delta (C).

B bị loại vì engine hiện *chưa* deterministic đủ để replay: `lockWolves`,
`resolveNight`, `assignRoles` mặc định lấy `Math.random`, và `Date.now()` được
gọi ngay tại chỗ. Muốn replay đúng thì phải tiêm RNG toàn ván và ghi `now` vào
từng lệnh - một refactor xuyên engine không mua thêm gì cho một server một
instance. C bị loại vì ta đã ghi write-through theo *từng mutation*, nên phần
delta không cứu được gì mà lại phải nuôi hai cơ chế.

Phần giá trị nhất của B được giữ lại ở dạng rẻ: `opSeq` và **phase token** để
chặn double-advance.

## Kiến trúc

Module mới `apps/server/src/persistence/`:

| File | Trách nhiệm |
|---|---|
| `schema.ts` | Zod cho envelope + `GameState` + `BotBrainState`; hằng `PERSISTENCE_VERSION` |
| `serialize.ts` | `Room` (RAM) → envelope thuần dữ liệu |
| `restore.ts` | envelope → `Room` + `BotSession`, phân loại kết quả |
| `redis-store.ts` | đọc/ghi/quarantine/xoá key, phân biệt "mất kết nối" với "không có" |

Module mới `apps/server/src/game/steps.ts`: sổ đăng ký bước chuyển pha + arm
timer + CAS token + resume.

`store.ts` giữ nguyên vai trò "sổ phòng trong RAM"; nó gọi sang
`persistence/` chứ không tự serialize nữa.

### Envelope

```ts
interface RoomEnvelopeV1 {
  persistenceVersion: 1;
  savedAt: number;
  opSeq: number;          // tăng mỗi lần ghi
  room: PersistedRoom;
}
```

`PersistedRoom` gồm:

- meta phòng: `code`, `hostId`, `status`, `config`, `createdAt`, `members`
- `chatLog` (đã bị chặn 100 tin ở `pushChat`, nên kích thước có trần)
- `engineState`: `GameState` nguyên trạng
- `gameId: string | null`, `resultWritten: boolean`
- `pendingStep: PendingStep | null` - bước chuyển pha đang chờ
- `phaseSeq: number` - thành phần thứ ba của phase token
- `botSession: { seed, brains: Record<botId, {state, lastDecayRound}>, cursors: Record<channelKey, number> }`
- `governorCalls: number` - ngân sách AI đã tiêu của phòng
- `discussionSkipVotes: string[]`
- `discussionRun: { round, phaseEndsAt, total, spoken, lastAt, lastSpokenAt, messageDepths, replyCounts } | null`

`pendingEndFinalVote` KHÔNG được persist: nó chỉ là cờ chống hẹn giờ trùng cho
một timer 800ms không còn tồn tại sau restart, và `false` là giá trị đúng.

### Vì sao `discussionRun` phải có mặt

`discussion-scheduler.ts` sinh id tin nhắn bot theo công thức tất định
`bot-chat:${round}:${total}`. Nếu restart giữa `DAY_DISCUSSION` mà bộ đếm
`total` về 0, phiên mới sẽ phát ra id **trùng** với tin đã có trong
`chatLog` - đúng loại lỗi mà `judgeChainPosition` và `replyTo` bám vào. Bộ đếm
`spoken`/`lastSpokenAt` cũng phải sống sót, nếu không restart tự cấp lại hạn
mức nói cho cả bầy bot trong cùng một vòng.

### Phase token và CAS

```ts
type PhaseToken = `${number}:${GamePhase}:${number}`; // round:phase:phaseSeq
```

`phaseSeq` tăng mỗi lần arm một bước mới. Mọi lời gọi chuyển pha đi qua:

```ts
armStep(room, step, delayMs)   // bump phaseSeq, ghi pendingStep, setRoomTimer
runStep(room, step)            // no-op nếu token của step != token hiện tại
```

Điều này chặn cả ba nguồn double-advance: timer cũ còn sót sau khi state đã
đổi, timer vừa được arm lại lúc restore chồng lên timer cũ, và catch-up
deadline chạy song song với timer thường. `phaseStartedAt` một mình không đủ vì
đêm có hai chặng (`lockWolves` rồi `endNight`) dùng chung một `phaseStartedAt`.

`PendingStep` là dữ liệu, không phải closure:

```ts
type PendingStep =
  | { name: "beginNight" }
  | { name: "lockWolves" }
  | { name: "endNight" }
  | { name: "beginVoting" }
  | { name: "endVoting" }
  | { name: "beginFinalVote" }
  | { name: "endFinalVote" }
  | { name: "afterDeathResult"; source: "night" | "vote" }
  | { name: "timeoutHunterShot" }
  | { name: "finishHunterShot" };
```

Kèm `token` và `runAt` (mốc tuyệt đối). Nhờ vậy restore không phải suy diễn
"pha này thì bước kế tiếp là gì" - nó đọc thẳng.

`opSeq` tăng mỗi lần ghi và được kiểm khi ghi: một lần ghi mang `opSeq` nhỏ hơn
bản đang nằm trong Redis bị bỏ qua (compare-and-set qua script Lua nhỏ). Với
một instance đây là lưới chắn cho các lời ghi bất đồng bộ về muộn.

### RNG khôi phục được

`createSeededRng` là PRNG dựa trên bộ đếm cộng dồn, nên vị trí trong dòng số
chỉ là *số lần đã gọi*:

```ts
export interface SeededRng { (): number; readonly cursor: number }
export function createSeededRng(seed: string, cursor = 0): SeededRng
```

Tua nhanh bằng công thức đóng (`base + cursor * K | 0`), O(1). `BotSession` lưu
cursor của từng kênh; restore dựng lại đúng vị trí. Đây là điều kiện để "bot
không đổi quyết định chỉ vì restart".

`BotRuntime` nhận thêm `options.state` và `options.lastDecayRound`; khi có
`state` thì constructor **không** gọi `createBotPersonality` (lời gọi đó tiêu
một số của RNG, gọi lại sẽ làm lệch cursor). `style` vẫn được dẫn xuất từ
`state.personality` nên không cần persist.

## Đường ghi

Một chốt duy nhất: `persistRoom(room)` (giữ tên, đổi ruột) →
`serializeRoom` → `redis-store.save`. TTL 6h, refresh mỗi lần ghi; sau
`GAME_OVER` rút còn 1h.

Ghi là **best-effort tại runtime**: Redis lỗi thì log có cấu trúc rồi thôi, ván
vẫn chạy trên RAM. Đây là hành vi hiện có và được giữ nguyên có chủ đích.

## Đường đọc và resume

`loadRoomFromRedis(code)` trả về kết quả có phân loại thay vì `Room | null`:

```ts
type LoadResult =
  | { status: "ok"; room: Room }
  | { status: "missing" }
  | { status: "unavailable" }   // Redis không truy cập được
  | { status: "corrupt"; reason: string };
```

- `unavailable`: **không** tạo phòng mới, **không** xoá mapping
  `player-room:{id}`. Người chơi nhận lỗi rõ: "Máy chủ chưa đọc được dữ liệu
  phòng, thử lại sau ít giây."
- `corrupt` (JSON hỏng, sai version, zod fail): key được đổi tên sang
  `room:{code}:quarantine:{savedAt}` với TTL 24h, log
  `{event:"snapshot.invalid", code, version, opSeq, issues}`, và người chơi
  nhận thông báo rõ ràng - không đoán, không im lặng reset. Thông báo đi qua
  `SERVER_EVENTS.ERROR` (kênh web đã hiển thị sẵn), nên không phải nới hợp đồng
  `RoomSnapshot` chỉ để nói một câu.

`findRoomOf` và `reconnectPlayer` phải phân biệt `unavailable` với `missing`:
hiện tại cả hai đều xoá `player-room:{id}` khi không đọc được, tức một lần
Redis chớp mắt là người chơi mất luôn đường về phòng.
- `ok`: dựng `Room` + `BotSession`, rồi `resumeRoom`.

### `resumeRoom`

1. `status === "LOBBY"` hoặc `phase === "GAME_OVER"`: không arm timer. Với
   `GAME_OVER`, nếu `resultWritten === false` thì ghi `GameResult` một lần
   (idempotent theo `gameId`).
2. Có `pendingStep`: `remaining = pendingStep.runAt - now`.
   - **Pha cần thao tác** (`NIGHT`, `DAY_DISCUSSION`, `VOTING`, `DEFENSE`,
     `FINAL_VOTE`, `HUNTER_SHOT`): `wait = max(remaining, 10_000)`. Khi
     `remaining >= 10s` thì `phaseEndsAt` **không đổi**; chỉ trong trường hợp
     suy biến (còn <10s hoặc đã quá hạn) engine mới được dời hạn chót tới
     `now + 10s` để người vừa reconnect không bị cắt lượt ngay lập tức.
   - **Pha tự động** (`ROLE_REVEAL`, `NIGHT_RESULT`, `ELIMINATION`,
     `CHECK_WIN`): quá hạn thì chạy bước đó **ngay và đúng một lần**; chưa quá
     hạn thì arm đúng `remaining`.
3. Arm lại scheduler bot theo cửa sổ CÒN LẠI (`scheduleNightBots`,
   `runDiscussionScheduler` với `discussionRun` đã khôi phục,
   `scheduleVoteBots`, `scheduleFinalVoteBots`, `scheduleHunterBot`).
4. Arm lại `scheduleAbandonedRoomCheck`.

Tối đa **một** bước được chạy do quá hạn cho mỗi lần resume; sau đó ván chạy
tiếp bằng đồng hồ thật.

## Không chạy hai lần

Chết, phiếu, độc, phát súng Thợ Săn đều nằm *trong* `GameState`, và snapshot
luôn là trạng thái **sau** transition. Khôi phục state không thể phát lại
chúng; `runStep` + phase token chặn nốt việc một transition được gọi hai lần.

Chỗ duy nhất có side effect ngoài engine là ghi `GameResult`:

- Migration thêm `GameResult.gameId String? @unique`. Dữ liệu cũ để `NULL`
  (Postgres cho phép nhiều `NULL` trong unique index).
- `startGame` sinh `gameId = randomUUID()`.
- `onGameOver` ghi với `gameId`, bắt lỗi `P2002` và coi là thành công, rồi đặt
  `resultWritten = true` và persist.
- Restore ở `GAME_OVER` với `resultWritten === false` sẽ ghi bù - phủ luôn ca
  "chết trước khi kịp ghi". Ca "chết sau khi ghi nhưng trước khi kịp lưu
  snapshot" được unique index chặn.

## Rò rỉ vai trò

Payload persistence không bao giờ đi lên dây. Ràng buộc được giữ bằng ba thứ:
type persistence chỉ sống trong `apps/server/src/persistence/`, hàm phát cho
client vẫn chỉ là `buildSnapshot(room, viewerId)`, và một test khẳng định
snapshot của một Dân Làng sau restore không chứa vai của người khác, kể cả
`deadCanSpeakChosenId`.

## Độ sâu validation

Zod strict ở phần **mang quyết định**: envelope, version, `opSeq`, member,
config, `phase`, `round`, `phaseEndsAt`, `players`, `votes`, `night`, `trial`,
`hunterReaction`, `pendingStep`, cursor RNG, và khung của `BotBrainState`.

Cấu trúc (không đào sâu từng lá) ở phần **hiển thị/lịch sử**: `nightHistory`,
`dayVoteHistory`, `eventHistory`, `hunterShots`, `reasons` của belief. Một
entry lịch sử méo không thể làm hỏng máy trạng thái, và một zod mirror đầy đủ
cho chúng sẽ trôi lệch khỏi type nhanh hơn là bắt được lỗi.

Chống trôi lệch bằng cách kiểm tra gán hai chiều ở mức type
(`GameState` ↔ `z.infer<typeof gameStateSchema>`,
`BotBrainState` ↔ `z.infer<typeof botBrainStateSchema>`), nên `npm run lint`
(tsc --noEmit) hỏng ngay khi ai đó thêm field vào engine mà quên schema.

## TTL và dọn dẹp

- Ghi: `EX 6h`. `GAME_OVER`: `EX 1h`. `removeRoom`/`resetToLobby`: `DEL`.
- Quarantine: `EX 24h`, không bao giờ được nạp lại.
- Phòng trong RAM mà key đã hết hạn sẽ bị dọn ở lần truy cập kế tiếp.

## Kiểm thử

Unit:
- round-trip schema; từ chối `persistenceVersion` lạ; từ chối JSON hỏng.
- `createSeededRng(seed, n)` khớp đúng lần gọi thứ `n+1` của dòng gốc.
- `armStep`/`runStep`: token cũ bị bỏ qua.

Resume theo từng pha (bảng): NIGHT (chặng Sói và chặng Phù Thuỷ),
DAY_DISCUSSION, VOTING đã có người đổi phiếu, DEFENSE, FINAL_VOTE,
HUNTER_SHOT, deadline đã quá, GAME_OVER trước và sau khi ghi `GameResult`.

Integration `restart-recovery.test.ts`: dựng ván thật qua `machine.ts` với
redis giả trong RAM → serialize → `vi.resetModules()` để xoá sạch mọi Map cấp
module (mô phỏng chết process) → restore → chơi tiếp; khẳng định không pha nào
và không side effect nào chạy hai lần.

Determinism bot: transcript "không restart" và "restart giữa chừng" phải trùng
nhau về quyết định.

E2E: `npm run test:e2e` thêm kịch bản recovery.

## Giới hạn đã biết (ghi vào README/vận hành)

- Một instance. Không có khoá phân tán; hai process cùng chạy trên cùng room
  code sẽ tranh nhau, `opSeq` CAS chỉ giảm nhẹ chứ không giải quyết.
- Redis chết *trong lúc* process chết ⇒ mất ván. Persistence là best-effort
  theo đúng quyết định vận hành.
- Phòng chỉ resume khi có người truy cập (lazy). Ván chỉ còn bot đứng yên tới
  khi có người quay lại, hoặc tới khi TTL hết.
- Lời thoại LLM không được replay; sau restore bot nói câu mới, chỉ *quyết
  định* là tất định.
