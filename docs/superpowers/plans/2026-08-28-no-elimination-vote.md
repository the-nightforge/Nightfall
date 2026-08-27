# No-Elimination Vote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm lựa chọn `Không treo ai` như một ứng viên chính thức trong pha bỏ phiếu, với snapshot và UI phân biệt rõ chưa vote với đã vote không treo.

**Architecture:** Engine lưu `null` như một phiếu không treo và dùng key vắng mặt/`undefined` cho chưa vote. Engine là nguồn luật duy nhất cho tally/resolve; shared snapshot thêm `hasVoted` và `noEliminationVoteCount`, còn Socket.IO/UI chỉ truyền lựa chọn nullable.

**Tech Stack:** TypeScript, Vitest, Zod, Socket.IO, React/Next.js, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-28-no-elimination-vote-design.md`

## Global Constraints

- `null` trong `GameState.votes` nghĩa là phiếu `Không treo ai`; key vắng mặt nghĩa là chưa vote.
- Chỉ người còn sống được vote và mỗi người chỉ gửi được một phiếu.
- Player chỉ bị loại khi đứng đầu duy nhất và có nhiều phiếu hơn lựa chọn không treo.
- Không treo đứng đầu hoặc hòa cao nhất đều không loại ai.
- Phiếu không treo phải làm `allAliveVoted()` hoàn thành để timer có thể kết thúc sớm.
- Bot tiếp tục vote player như hiện tại; không mở rộng AI prompt.
- Không thêm dependency, Prisma migration hoặc thay đổi luật Skip thảo luận.
- Mọi production behavior phải có test RED trước implementation.

---

## File map

- `packages/game-engine/src/types.ts`: mở rộng kiểu state phiếu nullable.
- `packages/game-engine/src/engine.ts`: validate một phiếu/người, tally, resolve, snapshot engine.
- `packages/game-engine/tests/engine.test.ts`: luật không treo, hòa, khóa đổi phiếu, kết thúc sớm.
- `packages/shared/src/schemas.ts`: payload vote chấp nhận `targetId: null`.
- `packages/shared/src/snapshot.ts`: thêm `hasVoted` và `noEliminationVoteCount`.
- `apps/server/src/rooms/snapshot.ts`: chuyển hai field engine sang RoomSnapshot/lobby defaults.
- `apps/server/tests/no-elimination-vote-contract.test.ts`: schema nullable nghiêm ngặt.
- `apps/server/tests/no-elimination-vote-snapshot.test.ts`: snapshot phân biệt chưa vote/đã vote null và tally riêng.
- Các fixture `RoomSnapshot` trong test bot và `apps/server/scripts/bot-probe.ts`: thêm defaults mới.
- `apps/server/scripts/e2e.ts`: dùng `hasVoted`, không dùng truthiness của `myVote`.
- `apps/web/src/components/DayViews.tsx`: nút `Không treo ai`, trạng thái đã vote và kết quả chung.
- `apps/web/src/app/room/[code]/page.tsx`: callback vote nullable.

---

### Task 1: Luật engine cho lựa chọn không treo

**Files:**
- Modify: `packages/game-engine/tests/engine.test.ts`
- Modify: `packages/game-engine/src/types.ts`
- Modify: `packages/game-engine/src/engine.ts`

**Interfaces:**
- Produces: `GameState.votes: Record<string, string | null>`; `submitVote(voterId, targetId: string | null)`; `voteTally(): { players; noElimination }`; `PlayerGameView.hasVoted`; `PlayerGameView.noEliminationVoteCount`.
- Consumes: phase/player/alive validation hiện có.

- [ ] **Step 1: Viết engine tests thất bại**

Thêm vào nhóm `Bỏ phiếu`:

```ts
it("tính phiếu không treo là một phiếu đã hoàn thành", () => {
  const e = makeEngine(6);
  toVoting(e);
  for (const player of e.state.players) e.submitVote(player.id, null);

  expect(e.allAliveVoted()).toBe(true);
  expect(e.voteTally()).toEqual({ players: {}, noElimination: 6 });
  expect(e.resolveVote()).toBeNull();
  expect(e.state.players.every((player) => player.alive)).toBe(true);
});

it("loại player chỉ khi player cao nhất duy nhất và hơn không treo", () => {
  const e = makeEngine(6);
  toVoting(e);
  e.submitVote("p1", "p3");
  e.submitVote("p2", "p3");
  e.submitVote("p3", "p3");
  e.submitVote("p4", null);
  e.submitVote("p5", null);
  e.submitVote("p6", "p1");

  expect(e.resolveVote()?.playerId).toBe("p3");
});

it("không loại ai khi không treo cao nhất hoặc hòa cao nhất", () => {
  const noEliminationWins = makeEngine(6);
  toVoting(noEliminationWins);
  noEliminationWins.submitVote("p1", null);
  noEliminationWins.submitVote("p2", null);
  noEliminationWins.submitVote("p3", null);
  noEliminationWins.submitVote("p4", "p5");
  noEliminationWins.submitVote("p5", "p5");
  noEliminationWins.submitVote("p6", "p1");
  expect(noEliminationWins.resolveVote()).toBeNull();

  const tied = makeEngine(6);
  toVoting(tied);
  tied.submitVote("p1", null);
  tied.submitVote("p2", null);
  tied.submitVote("p3", "p5");
  tied.submitVote("p4", "p5");
  tied.submitVote("p5", "p1");
  tied.submitVote("p6", "p2");
  expect(tied.resolveVote()).toBeNull();
});

it("không cho người chết vote không treo hoặc người sống đổi phiếu", () => {
  const e = makeEngine(6);
  toVoting(e);
  e.state.players[5].alive = false;
  expect(() => e.submitVote("p6", null)).toThrow(/chết/);

  e.submitVote("p1", null);
  expect(() => e.submitVote("p1", "p2")).toThrow(/đã bỏ phiếu/);
  e.submitVote("p2", "p3");
  expect(() => e.submitVote("p2", null)).toThrow(/đã bỏ phiếu/);
});

it("snapshot phân biệt chưa vote và đã chọn không treo", () => {
  const e = makeEngine(6);
  toVoting(e);
  expect(e.snapshotFor("p1")).toMatchObject({ hasVoted: false, myVote: null, noEliminationVoteCount: 0 });

  e.submitVote("p1", null);
  expect(e.snapshotFor("p1")).toMatchObject({ hasVoted: true, myVote: null, noEliminationVoteCount: 1 });
  expect(e.snapshotFor("p2")).toMatchObject({ hasVoted: false, myVote: null, noEliminationVoteCount: 1 });
});
```

- [ ] **Step 2: Chạy engine test để xác nhận RED**

Run: `npm run test --workspace @masoi/game-engine`

Expected: FAIL vì `submitVote` chưa nhận null, `voteTally` chưa trả tally tách biệt và snapshot chưa có field mới.

- [ ] **Step 3: Mở rộng state và chặn đổi phiếu**

Trong `types.ts`:

```ts
votes: Record<string, string | null>;
```

Trong `submitVote`:

```ts
submitVote(voterId: string, targetId: string | null): void {
  const st = this.state;
  if (st.phase !== "VOTING") throw new GameError("Chỉ được bỏ phiếu trong pha bỏ phiếu");
  const voter = this.mustPlayer(voterId);
  if (!voter.alive) throw new GameError("Người chết không được bỏ phiếu");
  if (st.votes[voterId] !== undefined) throw new GameError("Bạn đã bỏ phiếu");
  if (targetId !== null) {
    const target = this.player(targetId);
    if (!target) throw new GameError("Mục tiêu không tồn tại");
    if (!target.alive) throw new GameError("Không thể bỏ phiếu cho người đã chết");
  }
  st.votes[voterId] = targetId;
}
```

- [ ] **Step 4: Triển khai tally và resolve tối thiểu**

```ts
voteTally(): { players: Record<string, number>; noElimination: number } {
  const players: Record<string, number> = {};
  let noElimination = 0;
  for (const targetId of Object.values(this.state.votes)) {
    if (targetId === null) noElimination += 1;
    else players[targetId] = (players[targetId] ?? 0) + 1;
  }
  return { players, noElimination };
}
```

Trong `resolveVote`, thay phần chọn leader bằng:

```ts
const tally = this.voteTally();
type VoteCandidate =
  | { type: "PLAYER"; targetId: string; count: number }
  | { type: "NO_ELIMINATION"; count: number };
const candidates: VoteCandidate[] = Object.entries(tally.players).map(
  ([targetId, count]) => ({ type: "PLAYER", targetId, count }),
);
if (tally.noElimination > 0) {
  candidates.push({ type: "NO_ELIMINATION", count: tally.noElimination });
}
candidates.sort((left, right) => right.count - left.count);

const leader = candidates[0];
const secondCount = candidates[1]?.count ?? -1;
const uniqueLeader = leader !== undefined && leader.count > secondCount;
let eliminated: PublicDeath | null = null;

if (uniqueLeader && leader.type === "PLAYER") {
  const player = this.player(leader.targetId);
  if (player?.alive) {
    player.alive = false;
    eliminated = { playerId: player.id, name: player.name };
  }
}

st.lastEliminated = eliminated;
if (eliminated) st.log.push(`Dân làng đã loại ${eliminated.name}.`);
else if (uniqueLeader && leader.type === "NO_ELIMINATION") {
  st.log.push("Dân làng quyết định không treo ai.");
} else st.log.push("Hoà phiếu, không ai bị loại.");
```

- [ ] **Step 5: Thêm field snapshot engine**

Trong `PlayerGameView`:

```ts
hasVoted: boolean;
noEliminationVoteCount: number;
```

Trong `snapshotFor`:

```ts
const hasVoted = !!viewer?.alive && st.votes[viewerId] !== undefined;
const showVoteCounts = st.phase === "VOTING" || revealAll;
// player voteCount đọc tally.players[p.id]
hasVoted,
myVote: hasVoted ? st.votes[viewerId] ?? null : null,
noEliminationVoteCount: showVoteCounts ? tally.noElimination : 0,
```

- [ ] **Step 6: Chạy engine tests và build engine**

Run: `npm run test --workspace @masoi/game-engine`

Expected: PASS toàn bộ engine tests, gồm các test mới.

Run: `npm run build --workspace @masoi/game-engine`

Expected: PASS.

- [ ] **Step 7: Commit engine**

```bash
git add packages/game-engine/src/types.ts packages/game-engine/src/engine.ts packages/game-engine/tests/engine.test.ts
git commit -m "feat: support no-elimination votes in engine"
```

---

### Task 2: Shared contract và server snapshot

**Files:**
- Create: `apps/server/tests/no-elimination-vote-contract.test.ts`
- Create: `apps/server/tests/no-elimination-vote-snapshot.test.ts`
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
- Modify: `apps/server/scripts/bot-probe.ts`

**Interfaces:**
- Consumes: engine fields từ Task 1.
- Produces: nullable `votePayload`; `RoomSnapshot.hasVoted`; `RoomSnapshot.noEliminationVoteCount`.

- [ ] **Step 1: Viết schema test RED**

```ts
import { describe, expect, it } from "vitest";
import { votePayload } from "@masoi/shared";

describe("no-elimination vote contract", () => {
  it("nhận player id hoặc null nhưng giữ payload nghiêm ngặt", () => {
    expect(votePayload.parse({ targetId: "player-id" })).toEqual({ targetId: "player-id" });
    expect(votePayload.parse({ targetId: null })).toEqual({ targetId: null });
    expect(votePayload.safeParse({}).success).toBe(false);
    expect(votePayload.safeParse({ targetId: "" }).success).toBe(false);
    expect(votePayload.safeParse({ targetId: null, extra: true }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Viết server snapshot test RED**

Dựng room thật ở `VOTING`, gọi `engine.submitVote("a", null)`, rồi assert:

```ts
expect(buildSnapshot(room, "a")).toMatchObject({
  hasVoted: true,
  myVote: null,
  noEliminationVoteCount: 1,
});
expect(buildSnapshot(room, "b")).toMatchObject({
  hasVoted: false,
  myVote: null,
  noEliminationVoteCount: 1,
});
expect(buildSnapshot(room, "a").players.every((player) => player.voteCount === 0)).toBe(true);
```

- [ ] **Step 3: Chạy hai test để xác nhận RED**

Run: `npm run test --workspace @masoi/server -- no-elimination-vote-contract.test.ts no-elimination-vote-snapshot.test.ts`

Expected: FAIL vì schema chưa nullable và RoomSnapshot chưa có field.

- [ ] **Step 4: Mở rộng shared schema/snapshot và mapping server**

```ts
export const votePayload = z.object({ targetId: z.string().min(1).nullable() }).strict();
```

Trong `RoomSnapshot` thêm:

```ts
hasVoted: boolean;
noEliminationVoteCount: number;
```

Trong `buildSnapshot`:

```ts
hasVoted: gameView?.hasVoted ?? false,
myVote: gameView?.myVote ?? null,
noEliminationVoteCount: gameView?.noEliminationVoteCount ?? 0,
```

- [ ] **Step 5: Cập nhật fixture và bot probe**

Trong mỗi object literal `RoomSnapshot` đã liệt kê, thêm:

```ts
hasVoted: false,
noEliminationVoteCount: 0,
```

- [ ] **Step 6: Chạy test, shared build và server typecheck**

Run: `npm run test --workspace @masoi/server -- no-elimination-vote-contract.test.ts no-elimination-vote-snapshot.test.ts`

Expected: PASS.

Run: `npm run build --workspace @masoi/shared`

Expected: PASS.

Run: `npm run lint --workspace @masoi/server`

Expected: PASS.

- [ ] **Step 7: Commit shared/server contract**

```bash
git add packages/shared/src/schemas.ts packages/shared/src/snapshot.ts apps/server/src/rooms/snapshot.ts apps/server/tests/no-elimination-vote-contract.test.ts apps/server/tests/no-elimination-vote-snapshot.test.ts apps/server/tests/random-brain.test.ts apps/server/tests/bot-vote.test.ts apps/server/tests/bot-targets.test.ts apps/server/tests/bot-prompt.test.ts apps/server/tests/openai-compat-brain.test.ts apps/server/tests/gemini-brain.test.ts apps/server/tests/fallback-brain.test.ts apps/server/scripts/bot-probe.ts
git commit -m "feat: expose no-elimination vote state"
```

---

### Task 3: Frontend và E2E nullable vote

**Files:**
- Modify: `apps/web/src/components/DayViews.tsx`
- Modify: `apps/web/src/app/room/[code]/page.tsx`
- Modify: `apps/server/scripts/e2e.ts`

**Interfaces:**
- Consumes: `RoomSnapshot.hasVoted`, `myVote`, `noEliminationVoteCount`; nullable `votePayload`.
- Produces: `DayView.onVote(targetId: string | null)` và nút `Không treo ai`.

- [ ] **Step 1: Tạo typecheck RED tại `DayView` call site**

Đổi callback page thành chữ ký rõ ràng trước khi đổi Props:

```tsx
onVote={(targetId: string | null) => room.emit("game:vote", { targetId })}
```

Run: `npm run lint --workspace @masoi/web`

Expected: FAIL vì `DayView` hiện chỉ nhận callback `(targetId: string) => void`.

- [ ] **Step 2: Đổi UI sang `hasVoted` và thêm nút**

Trong Props:

```ts
onVote: (targetId: string | null) => void;
```

Trong card voting:

```tsx
{snapshot.hasVoted && !dead && (
  <p className="mb-2 text-sm text-emerald-300">
    {myVote
      ? `Bạn đã bỏ phiếu cho ${snapshot.players.find((player) => player.id === myVote)?.name}.`
      : "Bạn đã chọn không treo ai."}
    {" Đang chờ người khác..."}
  </p>
)}
```

Đổi `selectable` và khối nút từ `!myVote` sang `!snapshot.hasVoted`. Sau nút xác nhận player, thêm:

```tsx
<button
  className="btn-secondary mt-2 w-full"
  onClick={() => onVote(null)}
>
  Không treo ai ({snapshot.noEliminationVoteCount} phiếu)
</button>
```

Nút chỉ render cho người sống chưa vote. Với người chết/đã vote, hiển thị dòng tiến độ `Không treo ai: x phiếu` nhưng không có thao tác.

Trong `EliminationView`, đổi fallback thành:

```tsx
<p className="mt-1 font-semibold text-white">Không ai bị loại hôm nay.</p>
```

- [ ] **Step 3: Sửa E2E phân biệt phiếu null**

Trong `apps/server/scripts/e2e.ts`, đổi:

```ts
if (s?.phase !== "VOTING" || !s.you?.alive || s.hasVoted) continue;
```

- [ ] **Step 4: Chạy web/server typecheck và web build**

Run: `npm run lint --workspace @masoi/web`

Expected: PASS.

Run: `npm run lint --workspace @masoi/server`

Expected: PASS.

Run: `npm run build --workspace @masoi/web`

Expected: PASS.

- [ ] **Step 5: Commit UI/E2E**

```bash
git add apps/web/src/components/DayViews.tsx apps/web/src/app/room/[code]/page.tsx apps/server/scripts/e2e.ts
git commit -m "feat: add no-elimination voting control"
```

---

### Task 4: Verification, review và push main

**Files:**
- Modify: `docs/superpowers/specs/2026-08-28-no-elimination-vote-design.md`
- Create: `docs/superpowers/plans/2026-08-28-no-elimination-vote.md`

**Interfaces:**
- Consumes: toàn bộ Tasks 1-3.
- Produces: repository đã kiểm thử, review và đồng bộ `origin/main`.

- [ ] **Step 1: Chạy verification toàn repository**

Run: `npm run test --workspace @masoi/game-engine`

Expected: PASS.

Run: `npm run test --workspace @masoi/server`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

Run: `npm run build`

Expected: PASS shared, engine, server và web.

Run: `git diff --check`

Expected: exit 0, không có lỗi whitespace.

- [ ] **Step 2: Code review theo spec**

Reviewer phải kiểm tra đặc biệt:

- `null` không bị `??` biến thành “chưa vote” khi tính `hasVoted`.
- `allAliveVoted()` dùng `!== undefined`, không dùng truthiness.
- Không treo được tính cạnh player trong resolve, không bị bỏ như abstention.
- Engine chặn phiếu thứ hai ở cả hai hướng.
- Bot không vô tình submit `null` từ nghĩa “chưa quyết định”.
- UI khóa bằng `hasVoted` và hiển thị đúng message.

- [ ] **Step 3: Commit tài liệu**

```bash
git add docs/superpowers/specs/2026-08-28-no-elimination-vote-design.md docs/superpowers/plans/2026-08-28-no-elimination-vote.md
git commit -m "docs: document no-elimination voting"
```

- [ ] **Step 4: Xác nhận sạch và push**

Run: `git status --short --branch`

Expected: `main` sạch và ahead `origin/main` bằng các commit của feature.

Run: `git push origin main`

Expected: `origin/main` tiến tới HEAD mới.
