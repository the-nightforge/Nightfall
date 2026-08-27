# Skip Discussion Consensus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm nút bỏ qua thảo luận; khi toàn bộ người thật còn sống đồng ý, server chuyển phòng từ `DAY_DISCUSSION` sang `VOTING` ngay.

**Architecture:** Server giữ tập phiếu skip tạm thời theo mã phòng và là nguồn sự thật duy nhất. Snapshot cá nhân hoá công bố tiến độ cùng quyền bấm của viewer; Socket.IO chỉ nhận ý định bật/tắt phiếu, còn state machine hiện tại vẫn là nơi duy nhất chuyển pha và đặt timer.

**Tech Stack:** TypeScript, Socket.IO, Zod, React/Next.js, Vitest, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-28-skip-discussion-design.md`

## Global Constraints

- Chỉ người thật còn sống được bỏ phiếu skip; bot và người chết không được tính.
- Người thật mất kết nối vẫn nằm trong tổng số cần đồng ý.
- Đồng thuận phải đạt đúng 100%; timer cũ tiếp tục chạy nếu chưa đủ phiếu.
- Người chơi được rút phiếu trước khi phòng chuyển pha.
- Phiếu gắn với `playerId`, tồn tại qua reconnect và bị xoá ở mọi ranh giới vòng đời đã nêu trong spec.
- Client không được tự đếm để quyết định chuyển pha; server tự tính và validate toàn bộ.
- Không thêm dependency và không gọi AI cho tính năng này.
- Viết test thất bại trước mỗi phần implementation.

---

## File map

- `packages/shared/src/events.ts`: khai báo event client mới.
- `packages/shared/src/schemas.ts`: validate payload bật/tắt skip.
- `packages/shared/src/snapshot.ts`: kiểu tiến độ skip cá nhân hoá.
- `apps/server/src/game/discussion-skip.ts`: sở hữu state tạm, tính eligibility, chuẩn hoá phiếu và cập nhật idempotent.
- `apps/server/src/rooms/snapshot.ts`: nối tiến độ skip vào snapshot của từng viewer.
- `apps/server/src/game/machine.ts`: reset state theo vòng đời và chuyển sang voting khi đồng thuận.
- `apps/server/src/ws.ts`: nhận event đã validate/rate-limit rồi chuyển cho machine.
- `apps/server/src/rooms/store.ts`: dọn state khi xoá phòng.
- `apps/web/src/components/DayViews.tsx`: hiển thị tiến độ và nút skip/huỷ skip.
- `apps/web/src/app/room/[code]/page.tsx`: phát event từ callback UI.
- `apps/server/tests/discussion-skip-contract.test.ts`: contract event và schema.
- `apps/server/tests/discussion-skip-state.test.ts`: eligibility, snapshot, idempotency, reconnect và cleanup state.
- `apps/server/tests/discussion-skip-flow.test.ts`: đồng thuận cuối cùng, timer, chuyển pha và chống chuyển pha hai lần.
- Các fixture `RoomSnapshot` trong test bot: thêm `discussionSkip: null` để giữ type contract đầy đủ.

---

### Task 1: Shared event, payload và snapshot contract

**Files:**
- Create: `apps/server/tests/discussion-skip-contract.test.ts`
- Modify: `packages/shared/src/events.ts`
- Modify: `packages/shared/src/schemas.ts`
- Modify: `packages/shared/src/snapshot.ts`
- Modify: `apps/server/src/rooms/snapshot.ts`
- Modify: `apps/server/tests/random-brain.test.ts`
- Modify: `apps/server/tests/bot-vote.test.ts`
- Modify: `apps/server/tests/bot-targets.test.ts`
- Modify: `apps/server/tests/bot-prompt.test.ts`
- Modify: `apps/server/tests/openai-compat-brain.test.ts`
- Modify: `apps/server/tests/gemini-brain.test.ts`
- Modify: `apps/server/tests/fallback-brain.test.ts`

**Interfaces:**
- Produces: `CLIENT_EVENTS.GAME_SKIP_DISCUSSION`, `skipDiscussionPayload`, `DiscussionSkipView`, `RoomSnapshot.discussionSkip`.
- Consumes: shared export barrel tự động xuất các symbol từ `events.ts`, `schemas.ts`, `snapshot.ts`.

- [ ] **Step 1: Viết contract test thất bại**

```ts
import { describe, expect, it } from "vitest";
import { CLIENT_EVENTS, skipDiscussionPayload } from "@masoi/shared";

describe("skip discussion contract", () => {
  it("uses a stable Socket.IO event name", () => {
    expect(CLIENT_EVENTS.GAME_SKIP_DISCUSSION).toBe("game:skip-discussion");
  });

  it("accepts only a strict boolean payload", () => {
    expect(skipDiscussionPayload.parse({ skip: true })).toEqual({ skip: true });
    expect(skipDiscussionPayload.parse({ skip: false })).toEqual({ skip: false });
    expect(skipDiscussionPayload.safeParse({ skip: "true" }).success).toBe(false);
    expect(skipDiscussionPayload.safeParse({ skip: true, votes: 3 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận thất bại vì contract chưa tồn tại**

Run: `npm run test --workspace @masoi/server -- discussion-skip-contract.test.ts`

Expected: FAIL vì `GAME_SKIP_DISCUSSION`/`skipDiscussionPayload` chưa được export.

- [ ] **Step 3: Thêm event, schema và kiểu snapshot tối thiểu**

Trong `events.ts` thêm:

```ts
GAME_SKIP_DISCUSSION: "game:skip-discussion",
```

Trong `schemas.ts` thêm:

```ts
export const skipDiscussionPayload = z.object({ skip: z.boolean() }).strict();
```

Trong `snapshot.ts` thêm:

```ts
export interface DiscussionSkipView {
  votes: number;
  required: number;
  hasVoted: boolean;
  canVote: boolean;
}
```

và trong `RoomSnapshot`:

```ts
discussionSkip: DiscussionSkipView | null;
```

Để giữ production snapshot hợp lệ trong commit contract, thêm giá trị trung gian vào `apps/server/src/rooms/snapshot.ts`:

```ts
discussionSkip: null,
```

Task 2 sẽ thay giá trị trung gian này bằng snapshot đồng thuận thật sau khi module state có test.

- [ ] **Step 4: Cập nhật toàn bộ fixture `RoomSnapshot` hiện có**

Trong mỗi object literal trả về `RoomSnapshot` ở bảy file test bot đã liệt kê, thêm trường ngay sau `myVote`:

```ts
discussionSkip: null,
```

- [ ] **Step 5: Chạy contract test và typecheck shared/server**

Run: `npm run test --workspace @masoi/server -- discussion-skip-contract.test.ts`

Expected: PASS 2 tests.

Run: `npm run build --workspace @masoi/shared`

Expected: PASS.

Run: `npm run lint --workspace @masoi/server`

Expected: PASS; commit contract không để repository ở trạng thái typecheck lỗi.

- [ ] **Step 6: Commit contract**

```bash
git add packages/shared/src/events.ts packages/shared/src/schemas.ts packages/shared/src/snapshot.ts apps/server/src/rooms/snapshot.ts apps/server/tests/discussion-skip-contract.test.ts apps/server/tests/random-brain.test.ts apps/server/tests/bot-vote.test.ts apps/server/tests/bot-targets.test.ts apps/server/tests/bot-prompt.test.ts apps/server/tests/openai-compat-brain.test.ts apps/server/tests/gemini-brain.test.ts apps/server/tests/fallback-brain.test.ts
git commit -m "feat: add skip discussion socket contract"
```

---

### Task 2: State đồng thuận và snapshot cá nhân hoá

**Files:**
- Create: `apps/server/src/game/discussion-skip.ts`
- Create: `apps/server/tests/discussion-skip-state.test.ts`
- Modify: `apps/server/src/rooms/snapshot.ts`

**Interfaces:**
- Consumes: `DiscussionSkipView` từ Task 1 và `Room` từ `rooms/store.ts`.
- Produces: `discussionSkipVotes`, `clearDiscussionSkipVotes(code)`, `getDiscussionSkipView(room, viewerId)`, `updateDiscussionSkipVote(room, playerId, skip)`.

- [ ] **Step 1: Viết state/snapshot tests thất bại**

Dựng `Room` ở pha `DAY_DISCUSSION` bằng `new GameEngine(state)`, trong đó có:

```ts
players: [
  { id: "alice", name: "Alice", role: "VILLAGER", alive: true, isBot: false },
  { id: "bob", name: "Bob", role: "SEER", alive: true, isBot: false },
  { id: "offline", name: "Offline", role: "GUARD", alive: true, isBot: false },
  { id: "dead", name: "Dead", role: "VILLAGER", alive: false, isBot: false },
  { id: "bot", name: "Bot", role: "WEREWOLF", alive: true, isBot: true },
],
```

Đặt `members.offline.connected = false`, sau đó viết các assertions cụ thể:

```ts
expect(getDiscussionSkipView(room, "alice")).toEqual({
  votes: 0,
  required: 3,
  hasVoted: false,
  canVote: true,
});
expect(getDiscussionSkipView(room, "dead")?.canVote).toBe(false);
expect(getDiscussionSkipView(room, "bot")?.canVote).toBe(false);

expect(updateDiscussionSkipVote(room, "alice", true)).toEqual({ ok: true, unanimous: false });
expect(updateDiscussionSkipVote(room, "alice", true)).toEqual({ ok: true, unanimous: false });
expect(getDiscussionSkipView(room, "bob")?.votes).toBe(1);
expect(updateDiscussionSkipVote(room, "alice", false)).toEqual({ ok: true, unanimous: false });
expect(getDiscussionSkipView(room, "alice")?.votes).toBe(0);

expect(updateDiscussionSkipVote(room, "dead", true)).toEqual({
  ok: false,
  error: "Chỉ người chơi còn sống mới được skip thảo luận",
});
expect(updateDiscussionSkipVote(room, "bot", true).ok).toBe(false);
```

Kiểm tra snapshot production:

```ts
updateDiscussionSkipVote(room, "alice", true);
expect(buildSnapshot(room, "alice").discussionSkip?.hasVoted).toBe(true);
expect(buildSnapshot(room, "bob").discussionSkip).toMatchObject({ votes: 1, required: 3, hasVoted: false });
```

Kiểm tra cleanup và pha khác:

```ts
clearDiscussionSkipVotes(room.code);
expect(getDiscussionSkipView(room, "alice")?.votes).toBe(0);
room.engine!.setPhase("VOTING", 30_000);
expect(getDiscussionSkipView(room, "alice")).toBeNull();
```

- [ ] **Step 2: Chạy state test để xác nhận thất bại**

Run: `npm run test --workspace @masoi/server -- discussion-skip-state.test.ts`

Expected: FAIL vì module `game/discussion-skip.ts` chưa tồn tại.

- [ ] **Step 3: Tạo module state thuần, idempotent**

Triển khai các chữ ký:

```ts
import type { DiscussionSkipView } from "@masoi/shared";
import type { Room } from "../rooms/store";

export const discussionSkipVotes = new Map<string, Set<string>>();

export type DiscussionSkipUpdate =
  | { ok: true; unanimous: boolean }
  | { ok: false; error: string };

export function clearDiscussionSkipVotes(code: string): void;
export function getDiscussionSkipView(room: Room, viewerId: string): DiscussionSkipView | null;
export function updateDiscussionSkipVote(
  room: Room,
  playerId: string,
  skip: boolean,
): DiscussionSkipUpdate;
```

Hàm nội bộ `eligibleHumanIds(room)` phải giao danh sách `room.members` với `room.engine.getState().players`, chỉ giữ `!member.isBot && player.alive`; không lọc `connected`. Trước khi đếm, xoá khỏi `Set` mọi id không còn eligible. `updateDiscussionSkipVote` phải kiểm tra phase, membership, bot/dead, dùng `Set.add/delete`, rồi trả `unanimous: eligible.size > 0 && votes.size === eligible.size`.

- [ ] **Step 4: Nối state vào snapshot**

Trong `rooms/snapshot.ts` import `getDiscussionSkipView` và thêm vào object trả về:

```ts
discussionSkip: getDiscussionSkipView(room, viewerId),
```

- [ ] **Step 5: Chạy test và typecheck**

Run: `npm run test --workspace @masoi/server -- discussion-skip-state.test.ts`

Expected: PASS toàn bộ eligibility, idempotency, withdrawal, personalized snapshot và cleanup assertions.

Run: `npm run lint --workspace @masoi/server`

Expected: PASS.

- [ ] **Step 6: Commit state/snapshot**

```bash
git add apps/server/src/game/discussion-skip.ts apps/server/src/rooms/snapshot.ts apps/server/tests/discussion-skip-state.test.ts
git commit -m "feat: track skip discussion consensus"
```

---

### Task 3: State machine, Socket.IO và cleanup vòng đời

**Files:**
- Create: `apps/server/tests/discussion-skip-flow.test.ts`
- Modify: `apps/server/src/game/machine.ts`
- Modify: `apps/server/src/ws.ts`
- Modify: `apps/server/src/rooms/store.ts`
- Modify: `apps/server/tests/game-lifecycle.test.ts`

**Interfaces:**
- Consumes: `updateDiscussionSkipVote`, `clearDiscussionSkipVotes`, `skipDiscussionPayload`, `CLIENT_EVENTS.GAME_SKIP_DISCUSSION`.
- Produces: `submitDiscussionSkip(room, playerId, skip): string | null`; `null` nghĩa là server đã áp dụng, chuỗi là lỗi tiếng Việt để WS bọc bằng `RoomError`.

- [ ] **Step 1: Viết flow test thất bại**

Mock `clearRoomTimers`, `setRoomTimer`, `persistRoom`, `broadcastRoom`, `emitToPlayers`, `prisma` theo pattern trong `game-lifecycle.test.ts`. Dựng phòng `DAY_DISCUSSION` có hai người thật sống và một bot, rồi assert:

```ts
expect(submitDiscussionSkip(room, "human1", true)).toBeNull();
expect(room.engine!.getState().phase).toBe("DAY_DISCUSSION");

expect(submitDiscussionSkip(room, "human2", true)).toBeNull();
expect(room.engine!.getState().phase).toBe("VOTING");
expect(clearRoomTimers).toHaveBeenCalledWith(room.code);
expect(setRoomTimer).toHaveBeenCalledTimes(1);

expect(submitDiscussionSkip(room, "human1", true)).toBe("Chỉ có thể skip trong lúc thảo luận");
expect(setRoomTimer).toHaveBeenCalledTimes(1);
```

Thêm case `human2.connected = false`: vẫn phải cần phiếu của `human2`, và phiếu của bot phải trả lỗi.

- [ ] **Step 2: Chạy flow test để xác nhận thất bại**

Run: `npm run test --workspace @masoi/server -- discussion-skip-flow.test.ts`

Expected: FAIL vì `submitDiscussionSkip` chưa tồn tại.

- [ ] **Step 3: Nối đồng thuận vào machine**

Trong `machine.ts`:

```ts
export function submitDiscussionSkip(room: Room, playerId: string, skip: boolean): string | null {
  const result = updateDiscussionSkipVote(room, playerId, skip);
  if (!result.ok) return result.error;
  if (result.unanimous) beginVoting(room);
  else sync(room);
  return null;
}
```

Thêm `clearDiscussionSkipVotes(room.code)` ở đầu `startGame`, `beginDiscussion`, `beginVoting`, `resetToLobby`. Bảo vệ `beginVoting` khỏi callback timer cũ đã vào queue:

```ts
function beginVoting(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "DAY_DISCUSSION") return;
  clearRoomTimers(room.code);
  clearDiscussionSkipVotes(room.code);
  // phần thiết lập VOTING hiện tại giữ nguyên
}
```

- [ ] **Step 4: Thêm Socket.IO handler**

Import `skipDiscussionPayload` và `submitDiscussionSkip`, sau đó đặt handler cạnh `GAME_VOTE`:

```ts
handler(CLIENT_EVENTS.GAME_SKIP_DISCUSSION, async (payload) => {
  const { skip } = skipDiscussionPayload.parse(payload);
  if (!allowAction(`skip-discussion:${playerId}`, 10, 3_000)) {
    throw new RoomError("Thao tác quá nhanh");
  }
  const roomCode = getRoomSyncByPlayer(playerId);
  if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
  const room = getRoom(roomCode);
  if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");
  const error = submitDiscussionSkip(room, playerId, skip);
  if (error) throw new RoomError(error);
});
```

Không gọi `broadcastRoom`/`persistRoom` lần hai trong handler vì `submitDiscussionSkip` đã đi qua `sync` hoặc `beginVoting -> sync`.

- [ ] **Step 5: Dọn state khi xoá phòng và kiểm tra start/reset**

Trong `rooms/store.ts`, gọi `clearDiscussionSkipVotes(code)` sau `cleanupRoomBotState(code)`.

Trong `game-lifecycle.test.ts`, trước `startGame(room)` đặt:

```ts
discussionSkipVotes.set(room.code, new Set(["p1"]));
```

và assert:

```ts
expect(discussionSkipVotes.has(room.code)).toBe(false);
```

Trong flow test, đặt lại map rồi gọi `resetToLobby(room)` và assert entry biến mất.

- [ ] **Step 6: Chạy test server liên quan rồi toàn bộ server**

Run: `npm run test --workspace @masoi/server -- discussion-skip-contract.test.ts discussion-skip-state.test.ts discussion-skip-flow.test.ts game-lifecycle.test.ts`

Expected: PASS.

Run: `npm run test --workspace @masoi/server`

Expected: PASS toàn bộ suite server.

Run: `npm run lint --workspace @masoi/server`

Expected: PASS.

- [ ] **Step 7: Commit server flow**

```bash
git add apps/server/src/game/machine.ts apps/server/src/ws.ts apps/server/src/rooms/store.ts apps/server/tests/discussion-skip-flow.test.ts apps/server/tests/game-lifecycle.test.ts
git commit -m "feat: advance voting on unanimous discussion skip"
```

---

### Task 4: Nút skip trên frontend và kiểm chứng toàn dự án

**Files:**
- Modify: `apps/web/src/components/DayViews.tsx`
- Modify: `apps/web/src/app/room/[code]/page.tsx`

**Interfaces:**
- Consumes: `RoomSnapshot.discussionSkip`, event dây `game:skip-discussion`.
- Produces: prop `onSkipDiscussion: (skip: boolean) => void` của `DayView`.

- [ ] **Step 1: Tạo lỗi typecheck có chủ đích bằng prop mới tại call site**

Trong `page.tsx`, truyền callback trước khi component nhận prop:

```tsx
<DayView
  snapshot={snapshot}
  onVote={(targetId) => room.emit("game:vote", { targetId })}
  onSkipDiscussion={(skip) => room.emit("game:skip-discussion", { skip })}
/>
```

- [ ] **Step 2: Chạy web typecheck để xác nhận thất bại**

Run: `npm run lint --workspace @masoi/web`

Expected: FAIL vì `DayView` chưa khai báo `onSkipDiscussion`.

- [ ] **Step 3: Triển khai UI tối thiểu trong `DayView`**

Mở rộng props:

```ts
interface Props {
  snapshot: RoomSnapshot;
  onVote: (targetId: string) => void;
  onSkipDiscussion: (skip: boolean) => void;
}
```

Trong card `DAY_DISCUSSION`, sau hướng dẫn chat thêm:

```tsx
{snapshot.discussionSkip && (
  snapshot.discussionSkip.canVote ? (
    <button
      className={snapshot.discussionSkip.hasVoted ? "btn-secondary mt-3 w-full" : "btn-primary mt-3 w-full"}
      onClick={() => onSkipDiscussion(!snapshot.discussionSkip!.hasVoted)}
    >
      {snapshot.discussionSkip.hasVoted ? "Huỷ skip" : "Skip thảo luận"}
      {` (${snapshot.discussionSkip.votes}/${snapshot.discussionSkip.required})`}
    </button>
  ) : (
    <p className="mt-3 text-xs text-mist/60">
      Người chơi còn sống muốn skip: {snapshot.discussionSkip.votes}/{snapshot.discussionSkip.required}
    </p>
  )
)}
```

Giữ nguyên card voting và timer/banner hiện tại; UI không tự chuyển phase.

- [ ] **Step 4: Chạy typecheck/build frontend**

Run: `npm run lint --workspace @masoi/web`

Expected: PASS.

Run: `npm run build --workspace @masoi/web`

Expected: PASS.

- [ ] **Step 5: Chạy verification toàn repository**

Run: `npm run test --workspace @masoi/game-engine`

Expected: PASS.

Run: `npm run test --workspace @masoi/server`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

Run: `npm run build`

Expected: PASS shared, engine, server và web.

Run: `git diff --check`

Expected: không có output và exit code 0.

- [ ] **Step 6: Commit frontend và tài liệu**

```bash
git add apps/web/src/components/DayViews.tsx apps/web/src/app/room/[code]/page.tsx docs/superpowers/specs/2026-08-28-skip-discussion-design.md docs/superpowers/plans/2026-08-28-skip-discussion.md
git commit -m "feat: add skip discussion controls"
```

- [ ] **Step 7: Kiểm tra lịch sử và đẩy `main`**

Run: `git status --short --branch`

Expected: `## main...origin/main [ahead 4]` và không có file chưa commit.

Run: `git push origin main`

Expected: remote `main` tiến tới commit mới nhất và Render có thể auto-deploy theo cấu hình repository hiện tại.

---

### Post-review amendments

Code review trước khi push bổ sung hai regression bắt buộc:

- `apps/server/tests/day-bot-scheduling.test.ts`: dùng deferred promise để chứng minh callback AI bắt đầu trong `DAY_DISCUSSION` bị bỏ nếu resolve sau khi unanimous skip đã chuyển phòng sang `VOTING`.
- `apps/server/tests/discussion-skip-leave.test.ts`: chứng minh khi người chưa đồng ý rời phòng, ngưỡng `2/3` được chuẩn hoá thành `2/2` và chuyển pha ngay.

Implementation tương ứng:

- `scheduleDayBots` lưu token gồm engine instance, `round`, phase và `phaseEndsAt`, rồi kiểm tra lại ngay sau `await botBrain().decideDay(view)` trước khi ghi vote/chat.
- `reconcileDiscussionSkip(room)` được gọi trong `roomService.leave` sau khi cập nhật membership/alive state và trước lần `await` I/O đầu tiên; deferred-Redis test khoá thứ tự này để không lộ snapshot `2/2` còn ở `DAY_DISCUSSION`.
