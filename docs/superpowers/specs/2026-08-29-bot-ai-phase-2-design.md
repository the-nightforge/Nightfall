# Deterministic BOT AI Phase 2 — Design

**Ngày:** 2026-08-29
**Tiền đề:** `docs/superpowers/specs/2026-08-28-bot-ai-phase-1-design.md`, `docs/bot-ai-phase-1-verification.md`
**Trạng thái Phase 1:** đã merge vào `main`, audit lại bằng `packages/game-engine/tests/phase-1-invariants.test.ts` (17 test đối kháng, xanh).

---

## 1. Vì sao có Phase 2

Phase 1 đưa **đường ban ngày** ra khỏi tay LLM: phiếu đề cử do lõi deterministic quyết, provider chỉ diễn đạt. Nhưng audit lại `main` cho thấy hai loại khoảng trống.

**Khoảng trống A — provider vẫn quyết định game action.** Ba call site còn sống trong `apps/server/src/game/machine.ts`:

| Call site | Quyết định thật sự là gì |
| --- | --- |
| `botBrain().decideNight(view)` (dòng 416) | Sói cắn ai, Tiên Tri soi ai, Bảo Vệ đỡ ai, Phù Thuỷ dùng bình nào |
| `botBrain().decideHunterShot(view)` (dòng 364) | Thợ Săn bắn ai khi chết |
| `botBrain().decideFinalVote(view)` (dòng 624) | Treo hay Tha ở phiên toà |

Cả ba đều nhận `RoomSnapshot` đầy đủ và trả về một nước đi. `decideDefense` là ngoại lệ hợp lệ: nó sinh lời nói, không sinh nước đi.

**Khoảng trống B — lõi nhận thức nông.** Những thứ đã có contract nhưng chưa có consumer:

- `BotKnowledgeView.selfRole` — không dòng nào đọc. Role chỉ ảnh hưởng quyết định ở đúng hai dòng teammate penalty trong `vote-decision.ts`.
- `seerResult` — được ghi thành memory pinned, nhưng **không tạo suspicion**. Tiên Tri soi trúng Sói rồi vẫn bỏ phiếu như chưa soi.
- `WEIGHTS.ROLE_CLAIM` — khai báo trong bảng weight nhưng không nơi nào sinh evidence loại đó.
- `BeliefEntry.lastUpdatedRound` — được ghi, không ai đọc. Không có decay cho `suspicion`/`trust`/`relationships`; belief chỉ tăng, không bao giờ nguội.
- `currentTheory` — luôn `null`, không có writer.
- `BotPersonality.deceptionSkill` — sinh ra rồi bỏ đó.
- `BotMemoryType.BOT_SPOKE` — variant chết.

Hệ quả gameplay: BOT chơi ban ngày "đúng luật và tái lập được", nhưng ban đêm vẫn là LLM đoán mò, và ban ngày thì không biết dùng thông tin riêng của vai mình.

---

## 2. Mục tiêu Phase 2

1. Chuyển **toàn bộ** quyết định game action sang lõi deterministic. Sau Phase 2 không còn call site nào để provider quyết định nước đi.
2. Nâng lõi nhận thức: belief có decay, thông tin riêng của vai được đưa vào belief, phân tích xã hội lên mức nhóm.
3. Chiến lược riêng theo vai, thay vì một hàm chấm điểm dùng chung cho mọi vai.
4. BOT đổi chiến thuật khi tình thế đổi (đồng đội chết, có claim mới, bị soi trúng).
5. Có harness đo chất lượng BOT qua nhiều ván, thay vì chỉ kiểm invariant trên một ván.

**Không làm ở Phase 2:** difficulty level, persistence `BotBrainState` qua restart, bussing (Sói cố tình bán đồng đội), mô hình ngôn ngữ cho suy luận.

---

## 3. Giả định

Người dùng yêu cầu tự đưa giả định hợp lý và ghi rõ. Đây là toàn bộ:

- **G1.** `RoomSnapshot` vẫn là đầu vào của provider cho `decideDefense` (lời bào chữa). Đây là speech, không phải action, nên nằm ngoài phạm vi "không còn provider quyết định action".
- **G2.** Bí mật vai giữ nguyên luật Phase 1: người chết không lộ vai tới `GAME_OVER`; Sói thấy đồng bọn; Tiên Tri thấy kết quả soi của chính mình. Phase 2 **mở rộng** knowledge view cho ban đêm nhưng không nới lỏng bất kỳ ranh giới nào.
- **G3.** Phù Thuỷ được biết nạn nhân của Sói sau khi bầy Sói khoá phiếu — đây là luật engine đã có (`nightInfoFor`), không phải nới lỏng mới.
- **G4.** Evaluation harness đo **cân bằng và tính hợp lệ**, không tuyên bố "BOT chơi hay". Không có số liệu 1.000 ván; harness chạy trong test suite nên phải xong trong vài giây.
- **G5.** Khi lõi deterministic không quyết được (không có mục tiêu hợp lệ), BOT **bỏ lượt** chứ không rơi về ngẫu nhiên. Bỏ lượt là một nước đi hợp lệ và tái lập được; ngẫu nhiên thì không.
- **G6.** `RandomBrain` được giữ lại cho `decideDefense` và làm đường lui cho lời nói, nhưng bị gỡ khỏi mọi đường quyết định action.
- **G7.** Số vòng trong một ván mô phỏng bị chặn trên (`MAX_ROUNDS = 20`) để harness không treo khi luật bế tắc.

---

## 4. Kiến trúc

Giữ nguyên ranh giới Phase 1: `packages/game-engine` thuần, `apps/server` giữ vòng đời và I/O.

```
packages/game-engine/src/bot/
  types.ts              + BotNightIntention, BotRoleStrategy, Coalition,
                          BotRoundSummary, NightKnowledge
  BotRuntime.ts         + decideNight, decideFinalVote, decideHunterShot,
                          + summarizeRound, adaptToDeaths
  belief/
    belief-state.ts     + decayBeliefs
    private-info.ts     NEW  seerResult/roleClaim -> belief
  analysis/
    coalition.ts        NEW  nhóm >=3, leader, isolation
  decision/
    vote-decision.ts    (mở rộng: bias theo vai)
    night-decision.ts   NEW  chọn mục tiêu đêm từ belief
    trial-decision.ts   NEW  Treo/Tha + phát bắn Thợ Săn
  roles/                NEW
    strategy.ts         interface + registry
    werewolf.ts  seer.ts  guard.ts  witch.ts  hunter.ts  villager.ts
  evaluation/           NEW
    simulate.ts         chạy trọn ván bằng GameEngine thật
    metrics.ts          tổng hợp nhiều ván
```

Luật phụ thuộc không đổi: `roles/` và `decision/` chỉ nhận `BotDecisionContext` + `BotBrainState` + `BotRng`. Không file nào trong `bot/` được nhận `GameState` hay `Room`.

---

## 5. Mở rộng knowledge boundary cho ban đêm

Đây là phần nhạy cảm nhất: thêm thông tin cho BOT mà không mở đường rò rỉ.

```ts
export interface NightKnowledge {
  canAct: boolean;
  /** Hành động vai này được phép làm đêm nay. SKIP luôn hợp lệ với Phù Thuỷ. */
  legalActions: NightActionKind[];
  /** Mục tiêu hợp lệ cho từng hành động, do engine tính. BOT không tự suy luật. */
  legalTargets: Record<NightActionKind, string[]>;
  /** Nạn nhân bầy Sói đã chốt. Chỉ Sói và Phù Thuỷ (sau khi khoá) được thấy. */
  wolfTarget: string | null;
  /** Chỉ Bảo Vệ thấy; null với mọi vai khác. */
  guardPrevious: string | null;
  /** Chỉ Phù Thuỷ thấy. */
  healUsed: boolean;
  poisonUsed: boolean;
  wolvesLocked: boolean;
}
```

`BotKnowledgeView.night: NightKnowledge | null` — `null` khi không phải pha đêm, khi BOT đã chết, hoặc khi vai không có hành động đêm.

**Ràng buộc bắt buộc, có test riêng:**

- Dân Làng ở pha đêm nhận `night === null`. Không có `legalTargets`, không biết ai đang bị nhắm.
- `wolfTarget` chỉ khác `null` với Sói còn sống, hoặc Phù Thuỷ sau khi `wolvesLocked === true`. Đây đúng bằng luật `nightInfoFor` đã có, không nới thêm.
- `guardPrevious` chỉ khác `null` với Bảo Vệ.
- `legalTargets` cho `KILL` không chứa Sói khác — Sói không cắn đồng bọn. Danh sách này do engine dựng, không phải server hay lõi BOT.
- Serialize toàn bộ `NightKnowledge` của một vai không được chứa mã vai của người khác.

Producer duy nhất vẫn là `GameEngine.botKnowledgeFor`. `packages/game-engine/src/bot/knowledge.ts` tiếp tục không nhận `GameState`.

---

## 6. Belief: decay và thông tin riêng

### 6.1 Decay

Belief chỉ tăng là sai về hành vi: một nghi ngờ từ vòng 1 không nên nặng ngang nghi ngờ vừa mới có ở vòng 5, nhất là sau khi người bị nghi đã chứng minh được điều ngược lại.

```ts
export const BELIEF_DECAY_PER_ROUND = 0.85;
export function decayBeliefs(state: BotBrainState, round: number): void;
```

- Áp cho `suspicion`, `trust` và `relationships`.
- `age = max(0, round - entry.lastUpdatedRound)`; `score *= 0.85 ** age`; rồi `lastUpdatedRound = round` để lần sau không nhân lại phần đã nhân.
- **Miễn decay:** entry có ít nhất một reason `kind === "SEER_RESULT_WOLF"`. Kết quả soi là sự thật đã xác lập, không phải ấn tượng; để nó nguội đi là biến Tiên Tri thành vô dụng.
- Gọi trong `BotRuntime.observe`, cùng chỗ và cùng guard `lastDecayRound` với `decayAndPrune`.

### 6.2 Thông tin riêng vào belief

Thêm hai `EvidenceKind`: `SEER_RESULT_WOLF`, `SEER_RESULT_CLEAR`.

```ts
export function applyPrivateInformation(
  state: BotBrainState,
  knowledge: BotKnowledgeView,
): void;
```

- `seerResult.isWolf === true` → suspicion của target lên `MAX_BELIEF_SCORE`, evidence `weight: 100, confidence: 1`, `sourceId = "seer:{targetId}"`.
- `seerResult.isWolf === false` → trust tăng mạnh, suspicion kéo về 0.
- `knownRoles` (đồng bọn Sói) → trust nội bộ, và teammate penalty ở `vote-decision` vẫn giữ.

`ROLE_CLAIM` từ chat cũng được nối vào belief lần đầu:

- Claim một vai quyền lực (`SEER`/`WITCH`/`GUARD`/`HUNTER`) → evidence `ROLE_CLAIM` nhẹ, **hướng trust**, vì claim là thông tin có thể kiểm chứng về sau.
- Hai người claim cùng một vai → cả hai nhận evidence `COUNTER_CLAIM` hướng suspicion. Một trong hai chắc chắn nói dối; lõi không đoán ai, nó chỉ nâng nghi ngờ cả cụm.
- BOT **không bao giờ** ghi `knownInformation.knownRoles` từ claim. Claim là lời nói, không phải sự thật; ghi vào `knownRoles` sẽ làm hỏng đúng ranh giới mà Phase 1 dựng lên.

---

## 7. Phân tích xã hội mức nhóm

`analysis/coalition.ts`:

```ts
export interface Coalition {
  memberIds: string[];      // >= 2, sắp xếp ổn định
  cohesion: number;         // 0..1
  sampleCount: number;
}
export function detectCoalitions(state: BotBrainState, minCohesion?: number): Coalition[];
export function influenceScore(state: BotBrainState, playerId: string): number;
export function isolationScore(state: BotBrainState, playerId: string, alive: readonly string[]): number;
```

- **Coalition:** gom cụm tham lam trên `possibleWolfPairScore` đã có. Bắt đầu từ cặp mạnh nhất, nạp thêm thành viên nếu cohesion trung bình với cả nhóm vẫn `>= minCohesion`. Deterministic: mọi bước đều sắp xếp theo `(score desc, id asc)`, không dùng RNG.
- **Influence:** ai được người khác đi theo. Đo bằng số cạnh `voteAlignment` **đi vào** một người, có trễ pha: chỉ tính khi người kia bỏ phiếu **sau**. `BotRuntime` cần ghi thứ tự đó — `VoteMutation.sequence` đã có sẵn.
- **Isolation:** ai bị cả làng nhắm mà không ai bênh. `incomingHostility - incomingSupport`, chuẩn hoá theo số người còn sống.

Ba chỉ số này là **đầu vào chấm điểm**, không phải kết luận về vai. Không cái nào được ghi vào `knownRoles`.

---

## 8. Chiến lược theo vai

```ts
export interface BotRoleStrategy {
  readonly role: Role;
  /** null = chủ động bỏ lượt. Không bao giờ trả về nước đi bất hợp lệ. */
  decideNight(
    context: BotDecisionContext,
    state: BotBrainState,
    rng: BotRng,
  ): BotNightIntention | null;
  /** Điều chỉnh điểm vote theo hiểu biết riêng của vai. Trả về delta theo playerId. */
  voteBias(context: BotDecisionContext, state: BotBrainState): Record<string, number>;
}
export function strategyFor(role: Role): BotRoleStrategy;
```

`strategyFor` luôn trả về một strategy — vai không có hành động đêm dùng `villagerStrategy` (night trả `null`, bias rỗng). Không có nhánh `undefined` để chỗ gọi phải xử lý.

| Vai | Đêm | Bias ban ngày |
| --- | --- | --- |
| Sói | Cắn người **nguy hiểm nhất cho phe Sói**: ưu tiên người đã claim vai quyền lực, rồi người có influence cao, rồi người ít bị nghi (giết người đang bị nghi là lãng phí). Không bao giờ chọn đồng bọn. | Đẩy phiếu về người **ngoài** phe Sói có suspicion cao sẵn; teammate penalty giữ nguyên. |
| Tiên Tri | Soi người có suspicion **trung bình cao** và chưa soi bao giờ — soi người đã chắc chắn hoặc chắc chắn vô tội là phí lượt. | Suspicion đã được `applyPrivateInformation` đẩy lên max, nên không cần bias thêm. |
| Bảo Vệ | Đỡ người có trust cao nhất còn sống, loại `guardPrevious`. Tự đỡ mình khi bị nhắm nhiều (`incomingHostility` cao nhất). | Không. |
| Phù Thuỷ | Cứu khi nạn nhân là người trust cao và bình cứu còn. Độc khi có người suspicion vượt ngưỡng cao và bình độc còn. Ngược lại SKIP. | Không. |
| Thợ Săn | Không có hành động đêm. Phát bắn khi chết đi qua `trial-decision`. | Không. |
| Dân/Kẻ Nguyền Rủa | Không. | Không. |

Mọi lựa chọn đều lấy từ `knowledge.night.legalTargets` — strategy **không** tự dựng danh sách hợp lệ.

---

## 9. Phiên toà và Thợ Săn

`decision/trial-decision.ts`:

```ts
export function decideFinalVote(context, state, rng): BotFinalVoteIntention;
export function decideHunterShot(context, state, rng): BotHunterShotIntention;
```

- **Treo/Tha:** mặc định **TREO**, trừ khi có lý do tích cực tin bị cáo vô tội (Tiên Tri soi sạch, hoặc đồng đội). Sói **không bao giờ** Treo đồng bọn đã biết.

  > **Sửa sau khi có dữ liệu (Task 9).** Bản đầu của spec này chọn mặc định **THA**, lập luận rằng mặc định Treo biến mỗi phiên toà thành một vụ hành quyết. Harness bác bỏ: phe làng thua **30/30** ván. Nguyên nhân là một vòng lặp chết — không ai bị kết án nên không có lịch sử phiếu, nên nghi ngờ mãi bằng 0, nên không ai bị kết án. Điều bị bỏ sót là tới được phiên toà nghĩa là đa số làng **đã** chỉ vào người đó; tha vì bản thân chưa có bằng chứng riêng là vứt bỏ phán đoán tập thể và tiêu một ngày, trong khi mỗi đêm làng vẫn mất một người.
  >
  > Cùng lý do, `selectVote` chỉ cho **phe Sói** chọn "không treo ai" khi bằng chứng mỏng: nước đó tiêu một ngày của làng và không tốn gì của Sói.
- **Thợ Săn:** bắn người suspicion cao nhất vượt ngưỡng; không ai vượt thì **không bắn**. Bắn bừa lúc chết là cách nhanh nhất để phe làng tự sát.

---

## 10. Thích nghi

`BotRuntime.adaptToDeaths(knowledge)` chạy trong `observe`:

- **Đồng bọn Sói chết** → BOT Sói giảm `loyalty` hiệu dụng trong phiên hiện tại và tăng ưu tiên sống sót: bớt đẩy phiếu lộ liễu, tăng ngưỡng vote.
- **Người BOT tin tưởng chết** → mọi người từng có `hostility` hướng vào nạn nhân bị tăng suspicion nhẹ. Đây là suy luận "ai muốn người đó chết".
- **Người BOT nghi nặng chết mà làng không thắng** → giảm suspicion của những người "cùng phe nghi" với nạn nhân đó; giả thuyết cũ vừa bị bác bỏ.

`summarizeRound(round)` ghi một `BotRoundSummary` vào memory (pinned, importance cao) chứa: ai bị treo, ai chết đêm, giả thuyết đang giữ. Đây cũng là writer đầu tiên cho `currentTheory` — kết thúc tình trạng field luôn `null`.

---

## 11. Evaluation harness

`evaluation/simulate.ts` chạy **trọn một ván** bằng `GameEngine` thật, mọi người chơi là `BotRuntime`:

```ts
export interface SimulationResult {
  seed: string;
  winner: Winner;
  rounds: number;
  events: SimulationEvent[];
  /** Vi phạm invariant phát hiện trong lúc chạy; rỗng là đạt. */
  violations: string[];
}
export function simulateGame(input: SimulationInput): SimulationResult;
export function summarize(results: readonly SimulationResult[]): SimulationMetrics;
```

Invariant kiểm **trong lúc chạy**, không phải sau:

- Không nước đi bất hợp lệ nào bị engine từ chối.
- Không BOT nào biết vai người khác ngoài phần được phép (kiểm bằng cách so `state.knownInformation.knownRoles` với sự thật).
- Cùng seed → cùng `SimulationResult` từng bit.
- Ván kết thúc trong `MAX_ROUNDS`.

`summarize` cho win-rate theo phe, số vòng trung bình, tỉ lệ ván kết thúc đúng hạn. Đây là **số liệu mô tả** để phát hiện hồi quy (ví dụ Sói thắng 100% sau một thay đổi), không phải tuyên bố chất lượng.

---

## 12. Ranh giới bảo mật — bất biến xuyên Phase 2

Mọi thứ dưới đây có test riêng và phải đỏ ngay khi bị vi phạm:

1. Vai người chết ẩn tới `GAME_OVER`.
2. Vai người sống chỉ lộ cho chính họ và cho đồng bọn Sói.
3. `NightKnowledge` không rò vai; Dân Làng không có `night`.
4. Lõi BOT không import I/O.
5. Không `Math.random()` trong `packages/game-engine/src/bot`.
6. Provider không có đường trả về mục tiêu/nước đi cho night, hunter, final vote hay day vote.
7. Lịch sử phiếu công khai và quyền đổi phiếu của Phase 1 giữ nguyên.
8. Cùng seed → cùng quyết định và cùng state cuối.

---

## 13. Tiêu chí hoàn thành

- Spec và plan nằm trong repo.
- Mọi task có commit riêng và report riêng trong `.superpowers/sdd/2026-08-29-bot-ai-phase-2/`.
- `npm test`, `npm run lint`, `npm run build` xanh.
- Có test replay deterministic cùng seed.
- Có test knowledge boundary và role secrecy cho cả đường đêm.
- Có test memory/belief cập nhật qua nhiều vòng, gồm decay.
- Có báo cáo evaluation từ harness với số liệu thật.
- `rg "decideNight|decideHunterShot|decideFinalVote"` trong `apps/server/src` không còn call site quyết định action.
