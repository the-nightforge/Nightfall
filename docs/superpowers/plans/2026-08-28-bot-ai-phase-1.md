# Deterministic BOT AI Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay nomination vote ban ngày của BOT bằng lõi deterministic có memory, belief, social graph, seeded RNG và speech-only LLM, đồng thời cho phép đổi phiếu và công khai lịch sử ai vote ai sau khi chốt vòng.

**Architecture:** `GameEngine` tiếp tục giữ authoritative rules và public vote history; `GameEngine.botKnowledgeFor()` tạo view đã lọc cho từng BOT. `packages/game-engine/src/bot` giữ lõi nhận thức/decision thuần, còn `apps/server` giữ vòng đời `BotSession`, timer và provider dùng để diễn đạt `BotSpeechIntention` đã được chốt.

**Tech Stack:** TypeScript 5.5, Vitest 4, Zod 3, Socket.IO 4, Next.js 16/React 19, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-28-bot-ai-phase-1-design.md`

## Global Constraints

- Role người chết bị ẩn với người đang sống tới `GAME_OVER`.
- Không thêm difficulty abstraction, room config hoặc UI chọn độ khó trong Phase 1.
- `packages/game-engine` không được import Redis, Prisma, Socket.IO, Express hoặc provider SDK.
- Nomination vote deterministic không được fallback sang random hoặc để LLM đổi target.
- Night, Hunter, defense và final judgment vẫn đi qua legacy provider tới phase migration tương ứng.
- Mọi randomness trong đường day-BOT đã migrate phải dùng injected RNG; không gọi `Math.random()`.
- Mọi evidence dùng cho belief hoặc speech phải có source event/message ID tồn tại.
- Không lưu raw chat vô hạn trong `BotBrainState`.
- Mỗi task dùng TDD: test đỏ, implementation tối thiểu, test xanh, rồi commit.
- Giữ nguyên timeout, cooldown, governor, snapshot filtering và stale phase/round guards đang hoạt động tốt.
- Baseline trước implementation là 391 test pass: 118 game-engine và 273 server.

---

## File Map

### Shared contracts

- `packages/shared/src/snapshot.ts`: public vote choice/mutation/recap types và trường `dayVoteHistory` trong `RoomSnapshot`.

### Authoritative engine

- `packages/game-engine/src/types.ts`: fields lưu phase start, current vote mutations và public day recaps.
- `packages/game-engine/src/engine.ts`: đổi phiếu, mutation journal, recap nomination/final judgment, `botKnowledgeFor`.
- `packages/game-engine/src/index.ts`: export bot-core public API.
- `packages/game-engine/tests/engine.test.ts`: luật đổi phiếu, recap, visibility và security boundary.

### Deterministic bot core

- `packages/game-engine/src/bot/types.ts`: knowledge, state, memory, evidence, social graph và intention contracts.
- `packages/game-engine/src/bot/rng.ts`: seeded RNG.
- `packages/game-engine/src/bot/personality/personality.ts`: tạo personality cân bằng.
- `packages/game-engine/src/bot/memory/memory-store.ts`: dedupe, pin, decay và prune.
- `packages/game-engine/src/bot/belief/evidence.ts`: validate evidence source và clamp weight.
- `packages/game-engine/src/bot/belief/belief-state.ts`: suspicion/trust updates.
- `packages/game-engine/src/bot/analysis/vote-analysis.ts`: late switch, bandwagon, tie-break, save vote.
- `packages/game-engine/src/bot/analysis/social-analysis.ts`: support/hostility/vote-alignment edges.
- `packages/game-engine/src/bot/analysis/chat-analysis.ts`: parser claim/accuse/defend bảo thủ.
- `packages/game-engine/src/bot/decision/vote-decision.ts`: score legal choices, hysteresis và no-elimination.
- `packages/game-engine/src/bot/BotRuntime.ts`: ingest observations và phối hợp pipeline.
- `packages/game-engine/src/bot/scenario.ts`: multi-seed invariant runner nhỏ.
- `packages/game-engine/tests/bot-*.test.ts`: unit/scenario tests cho bot core.

### Server integration

- `apps/server/src/bots/types.ts`: speech-only provider contract, giữ legacy night/defense/final/Hunter methods.
- `apps/server/src/bots/prompt.ts`: day prompt chỉ nhận structured speech request.
- `apps/server/src/bots/decide.ts`: day schema/interpreter chỉ có `chat`.
- `apps/server/src/bots/gemini-brain.ts`: `renderDaySpeech` transport.
- `apps/server/src/bots/openai-compat-brain.ts`: `renderDaySpeech` transport.
- `apps/server/src/bots/fallback-brain.ts`: forward speech request qua provider chain.
- `apps/server/src/bots/random-brain.ts`: legacy action fallback; không còn quyết định nomination vote.
- `apps/server/src/bots/speech-renderer.ts`: provider-first, template fallback giữ nguyên intention/evidence.
- `apps/server/src/bots/context.ts`: ghép engine knowledge với visible chat.
- `apps/server/src/bots/session-registry.ts`: lifecycle room → BOT runtime và seeded scheduler RNG.
- `apps/server/src/game/bot-room-state.ts`: giữ final-vote scheduling flags và cleanup toàn bộ session.
- `apps/server/src/game/machine.ts`: day discussion/speech và ba vote checkpoints deterministic.
- `apps/server/src/rooms/snapshot.ts`: đưa day recaps ra `RoomSnapshot`.
- `apps/server/src/ws.ts`: cho vote thay đổi; không kết thúc nomination sớm.
- `apps/server/tests/bot-*.test.ts`: context, speech, lifecycle và scheduling tests.

### Web UI

- `apps/web/src/components/DayViews.tsx`: cho đổi vote trong suốt `VOTING`.
- `apps/web/src/components/VoteHistoryPanel.tsx`: hiển thị ai vote ai sau khi nomination đóng.
- `apps/web/src/components/TrialPanel.tsx`: hiển thị recap nomination cạnh bị cáo.
- `apps/web/src/lib/vote-history.ts`: format recap thuần để test.
- `apps/web/src/lib/vote-history.test.ts`: formatter tests.

---

### Task 1: Public Vote Contracts và Reversible Nomination Votes

**Files:**
- Modify: `packages/shared/src/snapshot.ts`
- Modify: `packages/game-engine/src/types.ts`
- Modify: `packages/game-engine/src/engine.ts`
- Test: `packages/game-engine/tests/engine.test.ts`

**Interfaces:**
- Produces: `PublicVoteChoice`, `VoteMutation`, `NominationRecap`, `FinalJudgmentRecap`, `DayVoteRecap`.
- Produces: `GameState.phaseStartedAt`, `GameState.voteMutations`, `GameState.dayVoteHistory`.
- Changes: `GameEngine.submitVote(voterId, targetId, now?)` cho phép thay lựa chọn hiện tại.

- [ ] **Step 1: Viết test đỏ cho vote mutation và current tally**

Thêm vào `packages/game-engine/tests/engine.test.ts`:

```ts
it("cho phép đổi phiếu và chỉ tính lựa chọn mới nhất", () => {
  const e = votingEngine();
  const started = e.state.phaseStartedAt;

  e.submitVote("p1", "p2", started + 1_000);
  e.submitVote("p1", "p3", started + 8_000);

  expect(e.voteTally().players).toEqual({ p3: 1 });
  expect(e.state.voteMutations).toMatchObject([
    { id: "1:nomination:1", voterId: "p1", previousChoice: null, choice: { type: "PLAYER", targetId: "p2" }, sequence: 1 },
    { id: "1:nomination:2", voterId: "p1", previousChoice: { type: "PLAYER", targetId: "p2" }, choice: { type: "PLAYER", targetId: "p3" }, sequence: 2 },
  ]);
});

it("gửi lại cùng lựa chọn là no-op", () => {
  const e = votingEngine();
  e.submitVote("p1", null, 1_000);
  e.submitVote("p1", null, 2_000);
  expect(e.state.voteMutations).toHaveLength(1);
  expect(e.voteTally().noElimination).toBe(1);
});
```

Thêm helper cạnh `makeEngine()` hiện có:

```ts
function votingEngine() {
  const engine = makeEngine();
  engine.setPhase("DAY_DISCUSSION", 60_000, 0);
  engine.setPhase("VOTING", 30_000, 0);
  return engine;
}
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npm test --workspace @masoi/game-engine -- --run -t "cho phép đổi phiếu|gửi lại cùng lựa chọn"`

Expected: FAIL vì `phaseStartedAt`, `voteMutations` chưa tồn tại và lần vote thứ hai đang ném `Bạn đã bỏ phiếu`.

- [ ] **Step 3: Thêm shared vote contracts**

Trong `packages/shared/src/snapshot.ts`, thêm:

```ts
export type PublicVoteChoice =
  | { type: "PLAYER"; targetId: string }
  | { type: "NO_ELIMINATION" };

export interface VoteMutation {
  id: string;
  round: number;
  voterId: string;
  previousChoice: PublicVoteChoice | null;
  choice: PublicVoteChoice;
  castAt: number;
  phaseStartedAt: number;
  phaseEndsAt: number;
  sequence: number;
}

export type NominationRecap =
  | { kind: "TRIAL"; accusedId: string }
  | { kind: "NONE"; reason: "no-elimination" | "tie" | "no-votes" };

export interface FinalJudgmentRecap {
  ballots: Array<{ voterId: string; guilty: boolean }>;
  guilty: number;
  innocent: number;
  abstain: number;
  lynched: boolean;
}

export interface DayVoteRecap {
  round: number;
  mutations: VoteMutation[];
  finalBallots: Array<{ voterId: string; choice: PublicVoteChoice }>;
  nomination: NominationRecap;
  finalJudgment: FinalJudgmentRecap | null;
}
```

- [ ] **Step 4: Thêm state defaults và mutation journal**

Trong `packages/game-engine/src/types.ts`, import shared types và thêm:

```ts
phaseStartedAt: number;
voteMutations: VoteMutation[];
dayVoteHistory: DayVoteRecap[];
```

Trong constructor `GameEngine`, chuẩn hóa state Redis cũ:

```ts
this.state.phaseStartedAt ??= this.state.phaseEndsAt ?? Date.now();
this.state.voteMutations ??= [];
this.state.dayVoteHistory ??= [];
```

Trong `create` và `setPhase`, đặt `phaseStartedAt = now`; khi vào `VOTING`, reset `voteMutations = []`.

Thay `submitVote` bằng logic chuyển đổi choice:

```ts
submitVote(voterId: string, targetId: string | null, now = Date.now()): void {
  // Giữ nguyên phase/alive/target validation hiện tại.
  const previousTarget = this.state.votes[voterId];
  if (previousTarget !== undefined && previousTarget === targetId) return;

  const toChoice = (id: string | null): PublicVoteChoice =>
    id === null ? { type: "NO_ELIMINATION" } : { type: "PLAYER", targetId: id };
  const sequence = this.state.voteMutations.length + 1;
  this.state.voteMutations.push({
    id: `${this.state.round}:nomination:${sequence}`,
    round: this.state.round,
    voterId,
    previousChoice: previousTarget === undefined ? null : toChoice(previousTarget),
    choice: toChoice(targetId),
    castAt: now,
    phaseStartedAt: this.state.phaseStartedAt,
    phaseEndsAt: this.state.phaseEndsAt ?? now,
    sequence,
  });
  this.state.votes[voterId] = targetId;
}
```

- [ ] **Step 5: Chạy test task và toàn bộ engine tests**

Run: `npm test --workspace @masoi/game-engine -- --run`

Expected: 120 test trở lên PASS; test cũ “không được vote hai lần” phải được thay bằng assertion cho no-op/đổi phiếu mới.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/snapshot.ts packages/game-engine/src/types.ts packages/game-engine/src/engine.ts packages/game-engine/tests/engine.test.ts
git commit -m "feat: record reversible nomination votes"
```

---

### Task 2: Public Day Recaps và Final Judgment Ballots

**Files:**
- Modify: `packages/game-engine/src/engine.ts`
- Modify: `packages/shared/src/snapshot.ts`
- Test: `packages/game-engine/tests/engine.test.ts`

**Interfaces:**
- Consumes: `VoteMutation`, `DayVoteRecap` từ Task 1.
- Produces: `PlayerGameView.dayVoteHistory` và `RoomSnapshot.dayVoteHistory` contract.
- Guarantees: current-round identities không xuất hiện trong `VOTING`; recap xuất hiện từ `DEFENSE`/`ELIMINATION` trở đi.

- [ ] **Step 1: Viết test đỏ cho recap và role privacy**

```ts
it("ẩn danh tính phiếu khi đang vote và công khai recap sau khi chốt", () => {
  const e = votingEngine();
  e.submitVote("p1", "p3", 10_000);
  e.submitVote("p2", "p3", 11_000);
  expect(e.snapshotFor("p1").dayVoteHistory).toEqual([]);

  e.resolveNomination(25_000, 30_000);
  const recap = e.snapshotFor("p1").dayVoteHistory.at(-1)!;
  expect(recap.finalBallots).toEqual([
    { voterId: "p1", choice: { type: "PLAYER", targetId: "p3" } },
    { voterId: "p2", choice: { type: "PLAYER", targetId: "p3" } },
  ]);
  expect(JSON.stringify(recap)).not.toContain("WEREWOLF");
  expect(JSON.stringify(recap)).not.toContain("VILLAGER");
});

it("bổ sung danh tính phiếu Treo/Tha sau final judgment", () => {
  const e = trialEngine();
  e.beginFinalVote(20_000, 40_000);
  e.submitFinalVote("p1", true);
  e.submitFinalVote("p2", false);
  e.resolveFinalVote(60_000);
  expect(e.snapshotFor("p1").dayVoteHistory.at(-1)?.finalJudgment?.ballots).toEqual([
    { voterId: "p1", guilty: true },
    { voterId: "p2", guilty: false },
  ]);
});
```

Thêm fixture:

```ts
function trialEngine() {
  const engine = votingEngine();
  engine.submitVote("p1", "p3", 10_000);
  engine.submitVote("p2", "p3", 11_000);
  engine.resolveNomination(25_000, 30_000);
  return engine;
}
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npm test --workspace @masoi/game-engine -- --run -t "công khai recap|danh tính phiếu Treo"`

Expected: FAIL vì snapshot chưa có `dayVoteHistory` và `resolveNomination` chưa tạo recap.

- [ ] **Step 3: Tạo recap ở `resolveNomination`**

Sau khi tính kết quả, dựng final ballots từ current `state.votes` và push đúng một recap:

```ts
const finalBallots = Object.entries(st.votes).map(([voterId, targetId]) => ({
  voterId,
  choice: targetId === null
    ? ({ type: "NO_ELIMINATION" } as const)
    : ({ type: "PLAYER", targetId } as const),
}));

st.dayVoteHistory.push({
  round: st.round,
  mutations: st.voteMutations.map((mutation) => ({ ...mutation })),
  finalBallots,
  nomination: outcome,
  finalJudgment: null,
});
```

Refactor `resolveNomination` để tạo biến `outcome` ở cả nhánh `TRIAL` và `NONE`, push recap trước `return`, nhưng không đổi phase/timer semantics.

- [ ] **Step 4: Gắn final judgment vào recap cùng round**

Trong `resolveFinalVote`, sau khi có tally:

```ts
const recap = [...st.dayVoteHistory].reverse().find((item) => item.round === st.round);
if (recap) {
  recap.finalJudgment = {
    ballots: this.finalVoters().flatMap((voter) => {
      const guilty = trial.finalVotes[voter.id];
      return guilty === undefined ? [] : [{ voterId: voter.id, guilty }];
    }),
    guilty,
    innocent,
    abstain,
    lynched,
  };
}
```

Thêm `dayVoteHistory: DayVoteRecap[]` vào cả `PlayerGameView` trong engine và
`RoomSnapshot` trong shared contract, rồi trả bản deep copy an toàn trong
`snapshotFor`. Vì recap chỉ được tạo sau `resolveNomination`, không cần nhánh
đặc biệt để che current-round mutation.

- [ ] **Step 5: Chạy engine tests và lint engine**

Run: `npm test --workspace @masoi/game-engine -- --run`

Run: `npm run lint --workspace @masoi/game-engine`

Expected: PASS cả hai lệnh.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine/src/engine.ts packages/shared/src/snapshot.ts packages/game-engine/tests/engine.test.ts
git commit -m "feat: publish completed day vote recaps"
```

---

### Task 3: Snapshot và UI Cho Đổi Phiếu/Công Khai Lịch Sử

**Files:**
- Modify: `apps/server/src/rooms/snapshot.ts`
- Modify: `apps/server/src/ws.ts`
- Modify: `apps/server/src/game/machine.ts`
- Modify: `apps/server/src/game/bot-room-state.ts`
- Create: `apps/server/tests/day-vote-history-snapshot.test.ts`
- Create: `apps/web/src/lib/vote-history.ts`
- Create: `apps/web/src/lib/vote-history.test.ts`
- Create: `apps/web/src/components/VoteHistoryPanel.tsx`
- Modify: `apps/web/src/components/DayViews.tsx`
- Modify: `apps/web/src/components/TrialPanel.tsx`

**Interfaces:**
- Consumes: `PlayerGameView.dayVoteHistory` từ Task 2.
- Produces: `RoomSnapshot.dayVoteHistory` cho người thật và BOT.
- Changes: nomination phase không kết thúc sớm ngay khi mọi người có phiếu; người sống được đổi vote tới deadline.

- [ ] **Step 1: Viết server snapshot test đỏ**

Test dựng room ở `VOTING`, submit rồi đổi phiếu, xác nhận `buildSnapshot` chưa lộ history; sau `resolveNomination`, xác nhận cả viewer người và BOT nhận cùng recap, không có role:

```ts
expect(buildSnapshot(room, "human").dayVoteHistory).toEqual([]);
room.engine!.resolveNomination(25_000, 30_000);
expect(buildSnapshot(room, "human").dayVoteHistory).toEqual(
  buildSnapshot(room, "bot").dayVoteHistory,
);
expect(JSON.stringify(buildSnapshot(room, "human").dayVoteHistory)).not.toContain("WEREWOLF");
```

- [ ] **Step 2: Chạy server test để xác nhận đỏ**

Run: `npm test --workspace @masoi/server -- --run apps/server/tests/day-vote-history-snapshot.test.ts`

Expected: FAIL vì `buildSnapshot` chưa map `dayVoteHistory`.

- [ ] **Step 3: Map recap và bỏ early-end nomination**

Trong `buildSnapshot`, thêm:

```ts
dayVoteHistory: gameView?.dayVoteHistory ?? [],
```

Trong `ws.ts`, sau `submitVote` chỉ broadcast/persist; bỏ `maybeEndVotingEarly(room)`. Trong `machine.ts`, không gọi early-end sau phiếu BOT. Xóa `pendingEndVote` và `maybeEndVotingEarly`; giữ `pendingEndFinalVote` vì final judgment chưa cho đổi phiếu trong Phase 1.

- [ ] **Step 4: Viết formatter test đỏ trên web**

Trong `apps/web/src/lib/vote-history.test.ts`:

```ts
test("formats vote changes with player names", () => {
  const lines = formatVoteMutations(recap, new Map([["a", "An"], ["b", "Bình"], ["c", "Chi"]]));
  assert.deepEqual(lines, ["An → Bình", "An: Bình → Chi"]);
});
```

Run: `npm test --workspace @masoi/web`

Expected: FAIL vì `formatVoteMutations` chưa tồn tại.

- [ ] **Step 5: Implement formatter và history component**

`vote-history.ts` chỉ nhận recap + player-name map và trả strings; unknown ID hiển thị `Người chơi đã rời phòng`, không ném lỗi. `VoteHistoryPanel.tsx` render mutation sequence và final `HANG/SPARE` ballots khi có.

Trong `DayViews.tsx`:

- Đặt `selectable={!dead}` thay vì `!dead && !hasVoted`.
- Luôn render nút submit cho người sống.
- Label là `Bỏ phiếu` trước lần đầu, `Đổi phiếu` sau đó.
- Không khóa `PlayerGrid` sau vote.
- Giữ thông báo lựa chọn hiện tại và tổng `NO_ELIMINATION`.

Trong `TrialPanel.tsx`, render `VoteHistoryPanel` với recap mới nhất ngay dưới thẻ bị cáo. Trong `EliminationView`, render cùng panel để thấy final judgment sau khi chốt.

- [ ] **Step 6: Chạy server/web tests và typecheck**

Run: `npm test --workspace @masoi/server -- --run apps/server/tests/day-vote-history-snapshot.test.ts`

Run: `npm test --workspace @masoi/web`

Run: `npm run lint --workspace @masoi/web`

Expected: PASS cả ba lệnh.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/rooms/snapshot.ts apps/server/src/ws.ts apps/server/src/game/machine.ts apps/server/src/game/bot-room-state.ts apps/server/tests/day-vote-history-snapshot.test.ts apps/web/src/lib/vote-history.ts apps/web/src/lib/vote-history.test.ts apps/web/src/components/VoteHistoryPanel.tsx apps/web/src/components/DayViews.tsx apps/web/src/components/TrialPanel.tsx
git commit -m "feat: let players change and inspect day votes"
```

---

### Task 4: Seeded RNG, Personality và Bot Core Contracts

**Files:**
- Create: `packages/game-engine/src/bot/types.ts`
- Create: `packages/game-engine/src/bot/rng.ts`
- Create: `packages/game-engine/src/bot/personality/personality.ts`
- Modify: `packages/game-engine/src/index.ts`
- Create: `packages/game-engine/tests/bot-rng-personality.test.ts`

**Interfaces:**
- Produces: `BotRng = () => number`, `createSeededRng(seed)`, `createBotPersonality(rng)`.
- Produces: `BotBrainState`, `BotDecisionContext`, `BotEvidence`, `BotVoteIntention`, `BotSpeechIntention` contracts used by Tasks 5–12.

- [ ] **Step 1: Viết RNG/personality test đỏ**

```ts
it("replays the same sequence from the same seed", () => {
  const a = createSeededRng("ROOM:bot-a");
  const b = createSeededRng("ROOM:bot-a");
  expect([a(), a(), a()]).toEqual([b(), b(), b()]);
});

it("creates bounded personality values", () => {
  const personality = createBotPersonality(createSeededRng("bot-a"));
  for (const value of Object.values(personality)) {
    expect(value).toBeGreaterThanOrEqual(0.25);
    expect(value).toBeLessThanOrEqual(0.9);
  }
});
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npm test --workspace @masoi/game-engine -- --run packages/game-engine/tests/bot-rng-personality.test.ts`

Expected: FAIL vì module chưa tồn tại.

- [ ] **Step 3: Khai báo bot contracts**

Trong `bot/types.ts`, định nghĩa đầy đủ các union dùng xuyên plan:

```ts
export type BotMemoryType = "VOTE_CAST" | "VOTE_CHANGED" | "LATE_VOTE" |
  "NOMINATED" | "FINAL_JUDGMENT" | "PLAYER_DIED" | "ROLE_CLAIM" |
  "COUNTER_CLAIM" | "ACCUSE" | "DEFEND" | "SEER_RESULT" | "BOT_SPOKE";

export type EvidenceKind = "LATE_SWITCH" | "BANDWAGON" | "TIE_BREAK" |
  "SAVE_VOTE" | "VOTE_ALIGNMENT" | "ROLE_CLAIM" | "COUNTER_CLAIM" |
  "ACCUSE" | "DEFEND";

export interface BotEvidence {
  id: string;
  kind: EvidenceKind;
  sourceId: string;
  actorId: string;
  targetId?: string;
  weight: number;
  confidence: number;
  round: number;
  summary: string;
}

export interface BotVoteIntention {
  kind: "VOTE";
  choice: PublicVoteChoice;
  confidence: number;
  evidence: BotEvidence[];
}

export interface BotSpeechIntention {
  kind: "ACCUSE" | "QUESTION" | "WITHHOLD";
  targetId?: string;
  confidence: number;
  evidence: BotEvidence[];
}

export interface BotPersonality {
  aggressiveness: number;
  talkativeness: number;
  riskTolerance: number;
  deceptionSkill: number;
  analyticalSkill: number;
  loyalty: number;
  stubbornness: number;
}

export interface BeliefEntry {
  score: number;
  reasons: BotEvidence[];
  lastUpdatedRound: number;
}

export interface BotMemory {
  id: string;
  sourceId: string;
  round: number;
  phase: Phase;
  type: BotMemoryType;
  actorId: string;
  targetId?: string;
  importance: number;
  pinned: boolean;
  data: Record<string, unknown>;
}

export interface SocialEdge {
  support: number;
  hostility: number;
  voteAlignment: number;
  samples: number;
  reasons: BotEvidence[];
}

export interface BotPlayerKnowledge {
  id: string;
  name: string;
  alive: boolean;
}

export interface BotKnowledgeView {
  botId: string;
  round: number;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  selfRole: Role;
  players: BotPlayerKnowledge[];
  knownRoles: Record<string, Role>;
  seerResult: { targetId: string; targetName: string; isWolf: boolean } | null;
  publicVoteHistory: DayVoteRecap[];
  currentVoteCounts: { players: Record<string, number>; noElimination: number };
  hasVoted: boolean;
  myVote: PublicVoteChoice | null;
  legalVoteChoices: PublicVoteChoice[];
  lastNightDeaths: Array<{ playerId: string; name: string }>;
}

export interface BotChatObservation {
  id: string;
  actorId: string;
  text: string;
  at: number;
}

export interface BotDecisionContext {
  knowledge: BotKnowledgeView;
  visibleChat: BotChatObservation[];
}

export interface BotBrainState {
  playerId: string;
  personality: BotPersonality;
  suspicion: Record<string, BeliefEntry>;
  trust: Record<string, BeliefEntry>;
  knownInformation: { knownRoles: Record<string, Role>; seerResults: BotMemory[] };
  claims: BotMemory[];
  memories: BotMemory[];
  relationships: Record<string, SocialEdge>;
  currentTheory: { summary: string; evidenceIds: string[] } | null;
  currentTargets: string[];
  confidence: number;
  previousVotes: Array<{ round: number; choice: PublicVoteChoice }>;
  speechMemory: Array<{ sourceIds: string[]; round: number }>;
  seenEventIds: string[];
}
```

Import `Phase`, `Role`, `DayVoteRecap` và `PublicVoteChoice` từ `@masoi/shared`.
Các property names trên được dùng nguyên vẹn trong mọi task sau; server không tạo
bản sao cạnh tranh của các contracts này.

- [ ] **Step 4: Implement seeded RNG và personality**

Dùng FNV-1a 32-bit cho string seed và Mulberry32 cho sequence. `createBotPersonality` gọi RNG đúng bảy lần, map từng giá trị vào `[0.25, 0.9]`, và không dùng global random.

- [ ] **Step 5: Chạy test và engine lint**

Run: `npm test --workspace @masoi/game-engine -- --run packages/game-engine/tests/bot-rng-personality.test.ts`

Run: `npm run lint --workspace @masoi/game-engine`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine/src/bot packages/game-engine/src/index.ts packages/game-engine/tests/bot-rng-personality.test.ts
git commit -m "feat: add seeded bot brain contracts"
```

---

### Task 5: Bot Knowledge Security Boundary

**Files:**
- Modify: `packages/game-engine/src/engine.ts`
- Modify: `packages/game-engine/src/bot/types.ts`
- Create: `packages/game-engine/src/bot/knowledge.ts`
- Create: `packages/game-engine/tests/bot-knowledge.test.ts`

**Interfaces:**
- Consumes: public recap types và bot contracts.
- Produces: `GameEngine.botKnowledgeFor(botId): BotKnowledgeView`.
- Produces: `legalVoteChoicesFor(viewerId)` returning player/no-elimination choices without hidden state.

- [ ] **Step 1: Viết security tests đỏ**

```ts
it("does not expose living or dead hidden roles to a villager", () => {
  const e = knowledgeFixture();
  e.mustPlayer("dead-seer").alive = false;
  const view = e.botKnowledgeFor("villager");
  expect(view.knownRoles).toEqual({ villager: "VILLAGER" });
  expect(JSON.stringify(view)).not.toContain("SEER");
  expect(JSON.stringify(view)).not.toContain("WITCH");
});

it("only exposes known wolf teammates to a living wolf", () => {
  const view = knowledgeFixture().botKnowledgeFor("wolf-a");
  expect(view.knownRoles).toEqual({ "wolf-a": "WEREWOLF", "wolf-b": "WEREWOLF" });
});

it("exposes only the viewer seer result", () => {
  const view = seerFixture().botKnowledgeFor("seer");
  expect(view.seerResult).toEqual({ targetId: "wolf-a", targetName: "Sói A", isWolf: true });
});
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npm test --workspace @masoi/game-engine -- --run packages/game-engine/tests/bot-knowledge.test.ts`

Expected: FAIL vì `botKnowledgeFor` chưa tồn tại.

- [ ] **Step 3: Implement knowledge mapper**

`bot/knowledge.ts` nhận các giá trị đã lọc, không export helper nhận raw state. `GameEngine.botKnowledgeFor` là entry point duy nhất có quyền đọc state và trả:

```ts
{
  botId,
  round: st.round,
  phase: st.phase,
  phaseStartedAt: st.phaseStartedAt,
  phaseEndsAt: st.phaseEndsAt,
  selfRole: viewer.role,
  players: st.players.map(({ id, name, alive }) => ({ id, name, alive })),
  knownRoles,
  seerResult,
  publicVoteHistory: st.dayVoteHistory.map(copyDayVoteRecap),
  currentVoteCounts: this.voteTally(),
  myVote: toPublicVoteChoice(st.votes[viewerId]),
  legalVoteChoices,
  lastNightDeaths: [...st.lastNightDeaths],
}
```

Định nghĩa hai helper thuần trong `knowledge.ts`:

```ts
export function toPublicVoteChoice(targetId: string | null | undefined): PublicVoteChoice | null {
  if (targetId === undefined) return null;
  return targetId === null
    ? { type: "NO_ELIMINATION" }
    : { type: "PLAYER", targetId };
}

export function copyDayVoteRecap(recap: DayVoteRecap): DayVoteRecap {
  return {
    ...recap,
    mutations: recap.mutations.map((mutation) => ({
      ...mutation,
      previousChoice: mutation.previousChoice ? { ...mutation.previousChoice } : null,
      choice: { ...mutation.choice },
    })),
    finalBallots: recap.finalBallots.map((ballot) => ({
      voterId: ballot.voterId,
      choice: { ...ballot.choice },
    })),
    finalJudgment: recap.finalJudgment
      ? {
          ...recap.finalJudgment,
          ballots: recap.finalJudgment.ballots.map((ballot) => ({ ...ballot })),
        }
      : null,
  };
}
```

`knownRoles` chỉ chứa self và known wolf teammates. Không thêm role người chết chỉ vì `alive === false`.

- [ ] **Step 4: Chạy security tests, engine tests và lint**

Run: `npm test --workspace @masoi/game-engine -- --run packages/game-engine/tests/bot-knowledge.test.ts`

Run: `npm test --workspace @masoi/game-engine -- --run`

Run: `npm run lint --workspace @masoi/game-engine`

Expected: PASS cả ba.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/engine.ts packages/game-engine/src/bot/types.ts packages/game-engine/src/bot/knowledge.ts packages/game-engine/tests/bot-knowledge.test.ts
git commit -m "feat: add filtered bot knowledge views"
```

---

### Task 6: Structured Memory và Belief Updates

**Files:**
- Create: `packages/game-engine/src/bot/memory/memory-store.ts`
- Create: `packages/game-engine/src/bot/memory/memory-decay.ts`
- Create: `packages/game-engine/src/bot/belief/evidence.ts`
- Create: `packages/game-engine/src/bot/belief/belief-state.ts`
- Create: `packages/game-engine/tests/bot-memory-belief.test.ts`

**Interfaces:**
- Produces: `createBotBrainState(playerId, personality, playerIds)`.
- Produces: `remember(state, memory)`, `decayAndPrune(state, round, limit?)`.
- Produces: `applyEvidence(state, evidence)` và `validateEvidence(evidence, sourceIds)`.

- [ ] **Step 1: Viết tests đỏ cho dedupe, pin, prune và clamp**

```ts
it("deduplicates memories by source and type", () => {
  remember(state, voteMemory);
  remember(state, voteMemory);
  expect(state.memories).toHaveLength(1);
});

it("keeps pinned facts while pruning low-importance memories", () => {
  for (let i = 0; i < 130; i++) remember(state, memory(i));
  remember(state, { ...seerMemory, pinned: true });
  decayAndPrune(state, 5, 120);
  expect(state.memories.length).toBeLessThanOrEqual(120);
  expect(state.memories).toContainEqual(expect.objectContaining({ type: "SEER_RESULT", pinned: true }));
});

it("rejects evidence without an existing source and clamps suspicion", () => {
  expect(() => applyEvidence(state, missingSourceEvidence)).toThrow("Evidence source không tồn tại");
  state.seenEventIds.push("vote:1");
  applyEvidence(state, { ...strongEvidence, sourceId: "vote:1", weight: 500 });
  expect(state.suspicion.c.score).toBe(100);
});
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npm test --workspace @masoi/game-engine -- --run packages/game-engine/tests/bot-memory-belief.test.ts`

Expected: FAIL vì modules chưa tồn tại.

- [ ] **Step 3: Implement memory store**

Identity key là `${memory.type}:${memory.sourceId}:${memory.actorId}:${memory.targetId ?? ""}`. `remember` không copy raw chat. `decayAndPrune` nhân importance của memory thường với `0.88 ** age`, sắp xếp pinned trước rồi importance giảm dần, và giữ tối đa limit.

- [ ] **Step 4: Implement evidence validation và belief update**

`validateEvidence` yêu cầu `sourceId` nằm trong `seenEventIds` hoặc source IDs của current context. `applyEvidence`:

```ts
const inertia = 0.35 + state.personality.stubbornness * 0.45;
const delta = evidence.weight * evidence.confidence * (1 - inertia * 0.5);
entry.score = clamp(entry.score + delta, 0, 100);
entry.reasons = [...entry.reasons.filter((reason) => reason.id !== evidence.id), evidence].slice(-12);
entry.lastUpdatedRound = evidence.round;
```

Trust dùng evidence weight ngược dấu qua một helper riêng; không suy ra `trust = 100 - suspicion` vì hai khái niệm có thể khác nhau.

- [ ] **Step 5: Chạy test task và engine lint**

Run: `npm test --workspace @masoi/game-engine -- --run packages/game-engine/tests/bot-memory-belief.test.ts`

Run: `npm run lint --workspace @masoi/game-engine`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine/src/bot/memory packages/game-engine/src/bot/belief packages/game-engine/tests/bot-memory-belief.test.ts
git commit -m "feat: add structured bot memory and beliefs"
```

---

### Task 7: Vote, Social và Conservative Chat Analysis

**Files:**
- Create: `packages/game-engine/src/bot/analysis/vote-analysis.ts`
- Create: `packages/game-engine/src/bot/analysis/social-analysis.ts`
- Create: `packages/game-engine/src/bot/analysis/chat-analysis.ts`
- Create: `packages/game-engine/tests/bot-analysis.test.ts`

**Interfaces:**
- Produces: `analyzeVoteRecap(recap, analyticalSkill, rng): BotEvidence[]`.
- Produces: `applySocialEvidence(state, evidence)`.
- Produces: `possibleWolfPairScore(state, leftId, rightId): number` trả score mềm `0–1`.
- Produces: `analyzeChat(messages, players): BotMemory[]`.

- [ ] **Step 1: Viết vote-analysis tests đỏ**

Dựng một recap có tally `A=3, B=3`, rồi C đổi từ D sang B ở 90% thời gian:

```ts
const evidence = analyzeVoteRecap(decisiveLateSwitchRecap(), 1, () => 0);
expect(evidence).toEqual(expect.arrayContaining([
  expect.objectContaining({ kind: "LATE_SWITCH", actorId: "c", targetId: "b" }),
  expect.objectContaining({ kind: "TIE_BREAK", actorId: "c", targetId: "b" }),
]));
expect(evidence.every((item) => item.sourceId.startsWith("2:nomination:"))).toBe(true);
```

Thêm test bandwagon có weight thấp hơn tie-break, save vote và cùng seed/analytical skill thấp bỏ sót cùng candidate.

- [ ] **Step 2: Viết chat/social tests đỏ**

```ts
expect(analyzeChat([
  message("m1", "a", "Tôi là Tiên Tri"),
  message("m2", "b", "Tôi thấy An hơi lạ"),
], players)).toEqual([
  expect.objectContaining({ type: "ROLE_CLAIM", sourceId: "m1", actorId: "a", data: { role: "SEER" } }),
]);
```

Câu `"Tôi thấy An hơi lạ"` bị bỏ vì không phải accuse rõ. Thêm case hai player trùng tên rút gọn để parser bỏ thay vì chọn bừa.

- [ ] **Step 3: Chạy tests để xác nhận đỏ**

Run: `npm test --workspace @masoi/game-engine -- --run packages/game-engine/tests/bot-analysis.test.ts`

Expected: FAIL vì analyzers chưa tồn tại.

- [ ] **Step 4: Implement vote analyzer**

Replay mutations theo sequence với một tally tạm. Trước mỗi mutation, ghi leader/tie; sau mutation, so sánh để tạo:

- `LATE_SWITCH` khi `previousChoice !== null` và elapsed ratio `>= 0.8`.
- `TIE_BREAK` khi mutation biến tie dẫn đầu thành một leader duy nhất.
- `SAVE_VOTE` khi actor rời target đang dẫn và target khác vượt lên.
- `BANDWAGON` khi chọn current unique leader mà không tạo tie-break; weight tối đa 4.
- `VOTE_ALIGNMENT` từ final ballots lặp lại được xử lý trong social analyzer.

Mỗi recap tạo `VOTE_ALIGNMENT` evidence cho từng cặp có cùng final target;
`applySocialEvidence` tăng `samples` qua các round. `possibleWolfPairScore` phối
hợp vote alignment/support nhưng luôn trả score mềm, không ghi known role.

Mỗi candidate đi qua `rng() <= analyticalSkill`; hard facts như source/actor không bao giờ bị biến đổi.

- [ ] **Step 5: Implement chat/social analyzers**

Chat parser dùng danh sách tên normalize Unicode/lowercase và các mẫu explicit:

- `tôi là <role>` → `ROLE_CLAIM`.
- `<name> không thể là <role>, tôi mới là <role>` → `COUNTER_CLAIM`.
- `tôi nghi <name>` / `<name> là sói` → `ACCUSE`.
- `tôi tin <name>` / `đừng treo <name>` → `DEFEND`.

Social edge values clamp `0–1`; mỗi evidence giữ tối đa tám reasons gần nhất.

- [ ] **Step 6: Chạy analysis tests và full engine tests**

Run: `npm test --workspace @masoi/game-engine -- --run packages/game-engine/tests/bot-analysis.test.ts`

Run: `npm test --workspace @masoi/game-engine -- --run`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/game-engine/src/bot/analysis packages/game-engine/tests/bot-analysis.test.ts
git commit -m "feat: analyze bot vote and social evidence"
```

---

### Task 8: Deterministic Vote Decision, BotRuntime và Scenario Runner

**Files:**
- Create: `packages/game-engine/src/bot/decision/vote-decision.ts`
- Create: `packages/game-engine/src/bot/BotRuntime.ts`
- Create: `packages/game-engine/src/bot/scenario.ts`
- Modify: `packages/game-engine/src/index.ts`
- Create: `packages/game-engine/tests/bot-runtime.test.ts`
- Create: `packages/game-engine/tests/bot-scenario.test.ts`

**Interfaces:**
- Produces: `selectVote(context, state, rng): BotVoteIntention`.
- Produces: `new BotRuntime({ playerId, rng, playerIds })`.
- Produces methods: `observe(context)`, `decideVote(context)`, `decideSpeech(context, vote)` và readonly `state`.
- Produces: `runBotScenario(input): BotScenarioResult`.

- [ ] **Step 1: Viết decision tests đỏ**

```ts
it("votes the strongest evidenced target", () => {
  const runtime = runtimeWithEvidence({ b: 62, c: 81 });
  const result = runtime.decideVote(contextWithLegalPlayers("b", "c"));
  expect(result.choice).toEqual({ type: "PLAYER", targetId: "c" });
  expect(result.evidence.every((item) => item.sourceId)).toBe(true);
});

it("chooses no elimination below confidence threshold", () => {
  const runtime = neutralRuntime();
  expect(runtime.decideVote(contextWithLegalPlayers("b", "c")).choice).toEqual({ type: "NO_ELIMINATION" });
});

it("does not switch without enough hysteresis", () => {
  const base = contextWithLegalPlayers("b", "c");
  const context = {
    ...base,
    knowledge: {
      ...base.knowledge,
      hasVoted: true,
      myVote: { type: "PLAYER", targetId: "b" } as const,
    },
  };
  const runtime = runtimeWithEvidence({ b: 70, c: 72 });
  expect(runtime.decideVote(context).choice).toEqual({ type: "PLAYER", targetId: "b" });
});

it("applies a loyalty penalty to a known wolf teammate", () => {
  const context = wolfContext({ knownRoles: { wolf: "WEREWOLF", ally: "WEREWOLF" } });
  expect(runtimeWithEvidence({ ally: 90, villager: 75 }).decideVote(context).choice)
    .toEqual({ type: "PLAYER", targetId: "villager" });
});
```

- [ ] **Step 2: Chạy test để xác nhận đỏ**

Run: `npm test --workspace @masoi/game-engine -- --run packages/game-engine/tests/bot-runtime.test.ts`

Expected: FAIL vì runtime/decision chưa tồn tại.

- [ ] **Step 3: Implement score và hysteresis**

Score mỗi player từ belief score, top evidence confidence, social hostility và jitter `((rng() - 0.5) * 6)`. Trừ teammate penalty `25 + loyalty * 30`. Threshold mặc định `58 - aggressiveness * 6 - riskTolerance * 4`; hysteresis `5 + stubbornness * 8`.

Không dùng một score không có reason làm speech evidence. Nếu target thắng chỉ nhờ jitter nhưng không có evidence, intention có confidence thấp và chọn `NO_ELIMINATION`.

- [ ] **Step 4: Implement BotRuntime pipeline**

`observe` dedupe public recaps/chat IDs, gọi analyzers, remember rồi apply evidence.
Nó chuyển `lastNightDeaths` thành `PLAYER_DIED` với source ID
`night-death:${round}:${playerId}`, chuyển Seer result riêng thành `SEER_RESULT`,
và chuyển nomination/final judgment recap thành memory tương ứng trước khi cập
nhật belief.
Memory `ROLE_CLAIM`, `COUNTER_CLAIM` và `SEER_RESULT` được tạo với `pinned: true`;
các memory còn lại đi qua decay/prune bình thường. `decideSpeech` trả null khi
`rng() > talkativeness`; nếu nói, chọn tối đa ba evidence chưa có trong
`speechMemory`, hoặc `WITHHOLD` khi vote là no-elimination và không có evidence
đủ mạnh.

- [ ] **Step 5: Viết và implement scenario runner**

`runBotScenario` nhận seed, initial contexts và checkpoints, chạy runtime thuần rồi trả decisions + final state. Test 100 seed:

```ts
for (let seed = 0; seed < 100; seed++) {
  const result = runBotScenario(scenario(String(seed)));
  expect(allBeliefsInRange(result.state)).toBe(true);
  expect(result.decisions.every(hasOnlyRealEvidence)).toBe(true);
}
expect(runBotScenario(scenario("same"))).toEqual(runBotScenario(scenario("same")));
```

- [ ] **Step 6: Chạy runtime/scenario/full engine tests**

Run: `npm test --workspace @masoi/game-engine -- --run packages/game-engine/tests/bot-runtime.test.ts packages/game-engine/tests/bot-scenario.test.ts`

Run: `npm test --workspace @masoi/game-engine -- --run`

Run: `npm run lint --workspace @masoi/game-engine`

Expected: PASS cả ba.

- [ ] **Step 7: Commit**

```bash
git add packages/game-engine/src/bot/decision packages/game-engine/src/bot/BotRuntime.ts packages/game-engine/src/bot/scenario.ts packages/game-engine/src/index.ts packages/game-engine/tests/bot-runtime.test.ts packages/game-engine/tests/bot-scenario.test.ts
git commit -m "feat: add deterministic bot vote runtime"
```

---

### Task 9: Server Context Adapter và BotSession Lifecycle

**Files:**
- Create: `apps/server/src/bots/context.ts`
- Create: `apps/server/src/bots/session-registry.ts`
- Modify: `apps/server/src/game/bot-room-state.ts`
- Modify: `apps/server/src/game/machine.ts`
- Modify: `apps/server/src/rooms/store.ts`
- Create: `apps/server/tests/bot-context.test.ts`
- Create: `apps/server/tests/bot-session.test.ts`

**Interfaces:**
- Produces: `buildBotDecisionContext(room, botId): BotDecisionContext`.
- Produces: `startBotSession(room)`, `botSessionFor(room)`, `clearBotSession(roomCode)`.
- `BotSession.runtimeFor(botId)` returns stable runtime; `BotSession.rngFor(botId, channel)` returns stable channel RNG.

- [ ] **Step 1: Viết context security test đỏ**

```ts
it("combines only engine knowledge and visible chat", () => {
  const context = buildBotDecisionContext(secretRoleRoom(), "villager-bot");
  expect(context.visibleChat.map((item) => item.id)).toEqual(["day-1"]);
  expect(JSON.stringify(context)).not.toContain("WITCH");
  expect(context.knowledge.players.map((player) => player.id)).toContain("dead-seer");
  expect(context.knowledge.knownRoles).not.toHaveProperty("dead-seer");
});
```

- [ ] **Step 2: Viết lifecycle test đỏ**

```ts
const first = botSessionFor(room).runtimeFor("bot-a");
expect(botSessionFor(room).runtimeFor("bot-a")).toBe(first);
cleanupRoomBotState(room.code);
expect(botSessionFor(room).runtimeFor("bot-a")).not.toBe(first);
```

- [ ] **Step 3: Chạy tests để xác nhận đỏ**

Run: `npm test --workspace @masoi/server -- --run apps/server/tests/bot-context.test.ts apps/server/tests/bot-session.test.ts`

Expected: FAIL vì adapters chưa tồn tại.

- [ ] **Step 4: Implement context adapter**

Gọi đúng hai nguồn: `room.engine.botKnowledgeFor(botId)` và `visibleChatLog(room, botId)`. Map chat thành `{ id, actorId: playerId, text, at }`; không đọc `room.engine.state.players[].role` trong file này.

- [ ] **Step 5: Implement session registry và lifecycle cleanup**

Seed session bằng `${room.code}:${room.createdAt}`; seed runtime bằng `${sessionSeed}:${botId}:brain`; seed scheduler channels bằng `${sessionSeed}:${botId}:${channel}`. `startGame` gọi `startBotSession`; reset/game over/remove gọi `clearBotSession`. `botSessionFor` lazy-create để test fixture và room legacy không crash.

- [ ] **Step 6: Chạy tests, server lint và leak regression tests**

Run: `npm test --workspace @masoi/server -- --run apps/server/tests/bot-context.test.ts apps/server/tests/bot-session.test.ts apps/server/tests/game-lifecycle.test.ts`

Run: `npm run lint --workspace @masoi/server`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/bots/context.ts apps/server/src/bots/session-registry.ts apps/server/src/game/bot-room-state.ts apps/server/src/game/machine.ts apps/server/src/rooms/store.ts apps/server/tests/bot-context.test.ts apps/server/tests/bot-session.test.ts
git commit -m "feat: manage deterministic bot sessions"
```

---

### Task 10: Speech-Only Provider Contract và Template Fallback

**Files:**
- Modify: `apps/server/src/bots/types.ts`
- Modify: `apps/server/src/bots/prompt.ts`
- Modify: `apps/server/src/bots/decide.ts`
- Modify: `apps/server/src/bots/gemini-brain.ts`
- Modify: `apps/server/src/bots/openai-compat-brain.ts`
- Modify: `apps/server/src/bots/fallback-brain.ts`
- Modify: `apps/server/src/bots/random-brain.ts`
- Create: `apps/server/src/bots/speech-renderer.ts`
- Modify: `apps/server/tests/bot-prompt.test.ts`
- Modify: `apps/server/tests/gemini-brain.test.ts`
- Modify: `apps/server/tests/openai-compat-brain.test.ts`
- Modify: `apps/server/tests/fallback-brain.test.ts`
- Create: `apps/server/tests/bot-speech-renderer.test.ts`

**Interfaces:**
- Produces: `SpeechRequest` và `DaySpeechDecision { chat: string | null }`.
- Changes: `BotBrain.renderDaySpeech(request): Promise<Attempt<DaySpeechDecision>>` thay `decideDay(view)`.
- Produces: `renderBotSpeech(request): Promise<string | null>` với template fallback.

- [ ] **Step 1: Viết prompt/schema tests đỏ**

```ts
const spec = buildDaySpeechPrompt(speechRequest());
expect(spec.schema.properties).toHaveProperty("chat");
expect(spec.schema.properties).not.toHaveProperty("voteTargetId");
expect(spec.user).toContain("vote:late-switch:2");
expect(spec.user).toContain("Không được thêm sự kiện hoặc đổi mục tiêu");
```

Thêm interpreter test: raw response có `voteTargetId` bị Zod `.strict()` từ chối hoặc field bị cấm bởi schema; output type không có target.

- [ ] **Step 2: Viết fallback preservation test đỏ**

```ts
it("keeps the deterministic target when every provider fails", async () => {
  const line = await renderBotSpeech(requestForTarget("c"), failingBrain);
  expect(line).toContain("Chi");
  expect(line).not.toContain("Bình");
});
```

- [ ] **Step 3: Chạy tests để xác nhận đỏ**

Run: `npm test --workspace @masoi/server -- --run apps/server/tests/bot-prompt.test.ts apps/server/tests/bot-speech-renderer.test.ts`

Expected: FAIL vì speech-only APIs chưa tồn tại.

- [ ] **Step 4: Thay day provider contract**

`SpeechRequest` chứa speaker name/style, `BotSpeechIntention`, renderable evidence `{ sourceId, summary }`, target display name và recent speech source IDs. Không chứa `RoomSnapshot`, raw role map hoặc legal targets.

Day Zod schema:

```ts
export const daySpeechSchema = z.object({
  think: z.string(),
  chat: z.string(),
}).strict();
```

Đổi Gemini/OpenAI/Fallback methods sang `renderDaySpeech`. Giữ nguyên methods legacy đêm/Hunter/defense/final vote.

- [ ] **Step 5: Implement safe prompt và template renderer**

Prompt liệt kê duy nhất target/evidence trong request, chỉ thị tối đa hai câu và cấm thêm sự kiện. Template fallback chọn mẫu theo intention nhưng không dùng RNG:

```ts
if (request.intention.kind === "WITHHOLD") return "Hiện tại tôi chưa thấy đủ bằng chứng để treo ai.";
if (request.targetName && request.evidence[0]) {
  return `Tôi đang nghi ${request.targetName} vì ${request.evidence[0].summary}.`;
}
return null;
```

Sau provider response, renderer cắt theo chat max; target/evidence không được parse từ output.

- [ ] **Step 6: Chạy toàn bộ bot provider tests và server lint**

Run: `npm test --workspace @masoi/server -- --run apps/server/tests/bot-prompt.test.ts apps/server/tests/gemini-brain.test.ts apps/server/tests/openai-compat-brain.test.ts apps/server/tests/fallback-brain.test.ts apps/server/tests/bot-speech-renderer.test.ts`

Run: `npm run lint --workspace @masoi/server`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/bots apps/server/tests/bot-prompt.test.ts apps/server/tests/gemini-brain.test.ts apps/server/tests/openai-compat-brain.test.ts apps/server/tests/fallback-brain.test.ts apps/server/tests/bot-speech-renderer.test.ts
git commit -m "refactor: restrict day bot providers to speech"
```

---

### Task 11: Deterministic Discussion và Multi-Checkpoint Vote Scheduling

**Files:**
- Modify: `apps/server/src/game/machine.ts`
- Modify: `apps/server/src/game/bot-room-state.ts`
- Delete or reduce: `apps/server/src/bots/targets.ts` day-only helpers no longer used by scheduler; keep night/Hunter/final helpers.
- Modify: `apps/server/tests/day-bot-scheduling.test.ts`
- Modify: `apps/server/tests/bot-vote.test.ts`
- Create: `apps/server/tests/deterministic-vote-scheduling.test.ts`

**Interfaces:**
- Consumes: `BotSession`, `buildBotDecisionContext`, `BotRuntime`, `renderBotSpeech`.
- Guarantees: discussion uses deterministic intention; VOTING has at most three checkpoints per BOT; no random fallback; stale results do not submit.

- [ ] **Step 1: Viết scheduler tests đỏ**

Test fake timers với seeded room/session:

```ts
it("submits the runtime choice without asking a provider for a target", async () => {
  scheduleVoteBots(room);
  await vi.advanceTimersByTimeAsync(room.config.voteSeconds * 1_000);
  expect(room.engine!.state.voteMutations.length).toBeGreaterThan(0);
  expect(provider.renderDaySpeech).not.toHaveBeenCalled();
});

it("can change once at a later checkpoint and never duplicates the same choice", async () => {
  runtime.decideVote
    .mockReturnValueOnce(vote("b", 0.7))
    .mockReturnValueOnce(vote("c", 0.9))
    .mockReturnValueOnce(vote("c", 0.9));
  scheduleVoteBots(room);
  await vi.runAllTimersAsync();
  expect(room.engine!.state.voteMutations.map((item) => item.choice)).toEqual([
    { type: "PLAYER", targetId: "b" },
    { type: "PLAYER", targetId: "c" },
  ]);
});
```

Giữ regression test “skip discussion bỏ kết quả speech đang chạy”.

- [ ] **Step 2: Chạy scheduler tests để xác nhận đỏ**

Run: `npm test --workspace @masoi/server -- --run apps/server/tests/day-bot-scheduling.test.ts apps/server/tests/deterministic-vote-scheduling.test.ts`

Expected: FAIL vì machine còn dùng provider `decideDay` và `pendingVote`.

- [ ] **Step 3: Chuyển `scheduleDayBots` sang runtime + speech renderer**

Tại callback của từng BOT:

```ts
const session = botSessionFor(room);
const runtime = session.runtimeFor(member.playerId);
const context = buildBotDecisionContext(room, member.playerId);
runtime.observe(context);
const vote = runtime.decideVote(context);
const speech = runtime.decideSpeech(context, vote);
if (!speech) return;
const chat = await renderBotSpeech(toSpeechRequest(member, runtime.state, speech));
```

Giữ engine identity/phase/round/phaseEndsAt checks trước khi push chat. Sau push, gọi `runtime.recordSpeech(speech)` bằng source IDs đã dùng.

- [ ] **Step 4: Chuyển `scheduleVoteBots` sang ba seeded checkpoints**

Với mỗi BOT dùng channel RNG `vote-schedule` để tính ratios:

```ts
const ratios = [0.12 + rng() * 0.12, 0.52 + rng() * 0.08, 0.84 + rng() * 0.08];
```

Ở mỗi timer: dựng context mới, `runtime.observe`, `runtime.decideVote`; convert `PublicVoteChoice` thành engine target `string | null`; submit. Engine no-op cùng choice. Không gọi `randomBrain`, `botBrain` hoặc provider trong path này.

- [ ] **Step 5: Xóa pending day vote state và cập nhật cleanup**

Xóa `pendingVote` map/imports. Giữ `pendingEndFinalVote` cho legacy final judgment. Đổi comments/tests nhắc “planned vote” thành runtime state.

- [ ] **Step 6: Chạy scheduler tests và toàn bộ server tests**

Run: `npm test --workspace @masoi/server -- --run apps/server/tests/day-bot-scheduling.test.ts apps/server/tests/deterministic-vote-scheduling.test.ts apps/server/tests/bot-vote.test.ts`

Run: `npm test --workspace @masoi/server -- --run`

Run: `npm run lint --workspace @masoi/server`

Expected: PASS; server test count lớn hơn baseline 273.

- [ ] **Step 7: Kiểm tra không còn global random trong migrated day path**

Run: `rg -n "Math\.random" apps/server/src/game/machine.ts packages/game-engine/src/bot`

Expected: Không có match trong `packages/game-engine/src/bot`; mọi match còn lại trong `machine.ts` chỉ thuộc night/Hunter/final legacy path. Nếu một match nằm trong `scheduleDayBots` hoặc `scheduleVoteBots`, chuyển nó sang session RNG trước khi commit.

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/game/machine.ts apps/server/src/game/bot-room-state.ts apps/server/src/bots/targets.ts apps/server/tests/day-bot-scheduling.test.ts apps/server/tests/bot-vote.test.ts apps/server/tests/deterministic-vote-scheduling.test.ts
git commit -m "feat: schedule deterministic bot day votes"
```

---

### Task 12: Full Verification, Documentation và Phase 2 Baseline

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-08-28-bot-ai-phase-1-design.md` only if implementation exposes a factual mismatch; keep design decisions unchanged.
- Create: `docs/bot-ai-phase-1-verification.md`

**Interfaces:**
- Produces: documented behavior, commands, test counts và known Phase 2 boundary.
- Does not add: difficulty controls, role strategies hoặc 1.000-game balance claims.

- [ ] **Step 1: Cập nhật README**

Thay hạn chế “BOT dùng Gemini để chọn mục tiêu và thảo luận” bằng mô tả chính xác:

```text
- Ban ngày BOT dùng decision engine deterministic có memory/belief để thảo luận và đề cử; LLM chỉ diễn đạt lời nói. Hành động đêm và các role strategy nâng cao đang được migrate theo phase, với provider fallback hiện tại vẫn hoạt động cho phần chưa migrate.
```

Thêm ghi chú luật: người chơi được đổi nomination vote tới deadline; danh tính vote công khai sau khi chốt; role người chết vẫn ẩn tới cuối ván.

- [ ] **Step 2: Chạy verification đầy đủ từ workspace root**

Run: `npm test --workspace @masoi/game-engine -- --run`

Run: `npm test --workspace @masoi/server -- --run`

Run: `npm test --workspace @masoi/web`

Run: `npm run lint`

Run: `npm run build`

Expected: tất cả PASS. Không dùng số test ước lượng trong báo cáo; ghi đúng số từ output thực tế.

- [ ] **Step 3: Chạy invariant/privacy checks**

Run: `rg -n "Math\.random" packages/game-engine/src/bot`

Expected: không có output.

Run: `rg -n "GameState|Room" packages/game-engine/src/bot/decision packages/game-engine/src/bot/BotRuntime.ts`

Expected: không có decision signature nhận raw `GameState` hoặc server `Room`; occurrences trong comments/type import không được phép che một dependency thật.

Run: `rg -n "voteTargetId" apps/server/src/bots/prompt.ts apps/server/src/bots/decide.ts`

Expected: không có output trong day speech path. Night target fields khác tên và vẫn hợp lệ.

- [ ] **Step 4: Viết verification report bằng số liệu thật**

`docs/bot-ai-phase-1-verification.md` phải ghi:

- Commit range của Phase 1.
- Số test engine/server/web pass.
- Kết quả lint/build.
- Scenario seed count và invariant result.
- Xác nhận role người chết không lộ.
- Xác nhận LLM day schema không có target.
- Phần còn legacy: night, Hunter, defense, final judgment.

- [ ] **Step 5: Kiểm tra secrets và diff**

Run: `git status --short`

Run: `git diff --check`

Run: `git diff -- . ':!package-lock.json'`

Expected: chỉ có README/report hoặc factual spec correction chưa commit; không có `.env`, API key, prompt log hoặc file build output.

- [ ] **Step 6: Commit tài liệu hoàn tất Phase 1**

```bash
git add README.md docs/bot-ai-phase-1-verification.md docs/superpowers/specs/2026-08-28-bot-ai-phase-1-design.md
git commit -m "docs: record bot AI phase one verification"
```

- [ ] **Step 7: Ghi handoff cho Phase 2**

Trong final implementation response, nêu:

- Deterministic day-vote đã hoàn tất.
- Verification commands và số test thật.
- Legacy boundaries còn lại.
- Phase 2 bắt đầu bằng role strategy interface cho night/Hunter; không mở rộng Phase 1 sau khi đã pass acceptance criteria.
