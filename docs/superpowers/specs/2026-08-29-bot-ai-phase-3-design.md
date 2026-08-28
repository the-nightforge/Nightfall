# Deterministic BOT AI Phase 3 — Design

**Ngày:** 2026-08-29
**Tiền đề:** `docs/superpowers/specs/2026-08-29-bot-ai-phase-2-design.md`, `docs/bot-ai-phase-2-verification.md`
**Nhánh:** `main` (chứa toàn bộ Phase 1 + Phase 2, HEAD `0e86506`)

---

## 0. Audit Phase 1 và Phase 2 (Bước 1)

Trước khi thiết kế bất cứ thứ gì, mười yêu cầu của Bước 1 được xác minh **bằng code và test đang chạy**, không bằng tài liệu.

| # | Yêu cầu | Bằng chứng | Kết luận |
| --- | --- | --- | --- |
| 1 | Vote đề cử có thể thay đổi | `engine.ts:782-810` `submitVote` ghi `VoteMutation` với `previousChoice`, chỉ no-op khi gửi lại đúng lựa chọn cũ. Test `phase-1-invariants.test.ts:84,100,113` | ĐẠT |
| 2 | Công khai ai vote ai sau khi vòng vote hoàn tất | `resolveNomination` đẩy `DayVoteRecap` vào `dayVoteHistory`; `phase-1-invariants.test.ts:124` (ẩn trong lúc bỏ phiếu), `:135` (lộ ngay sau khi chốt, giống nhau với mọi viewer) | ĐẠT |
| 3 | Vai người chết và người khác ẩn tới `GAME_OVER` | `engine.ts:1211` `revealAll = phase === "GAME_OVER"`; `botKnowledgeFor` (`engine.ts:1368`) **chặt hơn** — không bao giờ reveal, kể cả `GAME_OVER`. Test `:182,:200,:213,:256` | ĐẠT |
| 4 | BOT có deterministic seeded RNG | `bot/rng.ts` FNV-1a + mulberry32. Test `:352` thay `Math.random` toàn cục mà kết quả không đổi | ĐẠT |
| 5 | Memory, belief, suspicion, social evidence | `memory/`, `belief/`, `analysis/social-analysis.ts`, `analysis/coalition.ts` | ĐẠT |
| 6 | Chiến thuật riêng theo role | `roles/` — werewolf, seer, guard, guardian-angel, witch, priest, detective + `passiveStrategy` | ĐẠT |
| 7 | Provider/LLM chỉ viết lời thoại | `BotBrain` (`apps/server/src/bots/types.ts:135`) chỉ còn `decideDefense`. Không call site nào của `decideNight`/`decideFinalVote`/`decideHunterShot` thuộc về provider | ĐẠT |
| 8 | Cùng seed + cùng input → cùng action | `bot-scenario.test.ts:128`, `bot-evaluation.test.ts:27`, `phase-1-invariants.test.ts:330` | ĐẠT |
| 9 | Engine không có I/O | `phase-1-invariants.test.ts:265` quét import của engine và toàn bộ `bot/` | ĐẠT |
| 10 | Engine, server, web test xanh | engine **420**, server **263**, web **78**; `npm run lint` sạch | ĐẠT |

**Kết luận Task 0: không phát hiện lỗi, không cần commit sửa trước Phase 3.**

Ba **nợ kỹ thuật** phát hiện trong lúc audit — không phải bug hôm nay, nhưng là rào cản cho Phase 3, và được xử lý như một phần của Phase 3 chứ không phải hotfix riêng:

- **N1 — Lỗ hổng tất định tiềm ẩn trong harness.** `evaluation/simulate.ts` gọi `engine.resolveNight(now)` với `rng` mặc định là `Math.random` (`engine.ts:623`). Hôm nay vô hại vì harness không bao giờ gọi `startNight`/`startDay`, nên `activeEvent` luôn `null` và nhánh `BLOODY_HUNT` (`engine.ts:669`) không bao giờ chạy. Bật dynamic events lên là mất tất định ngay. Xử lý ở Task 3.
- **N2 — `GameEngine.create` không nhận rng.** `assignRoles` dùng `Math.random`, nên harness phải `sort()` rồi xáo lại bằng seeded rng (`simulate.ts:84-93`). Đây là một cách vòng, và nó khiến "cấu hình role" của một ván mô phỏng không phải là thứ engine thật sẽ tạo ra. Xử lý ở Task 3.
- **N3 — Trọng số rải rác.** 27 file trong `bot/` chứa ~70 hằng số điều chỉnh, ba bảng weight song song không đồng bộ (`vote-analysis.WEIGHTS`, `chat-analysis.IMPORTANCE`, literal vị trí trong `BotRuntime.ingestChat`), và ít nhất 6 magic number bị nhân bản (`±3` jitter ở 6 chỗ, `MOST_INFORMATIVE_SUSPICION = 50` khai báo hai lần, `/100` thay cho `MAX_BELIEF_SCORE` ở 5 chỗ, `0.8` late-vote ở hai chỗ). `deceptionSkill` được sinh ra nhưng **không file nào đọc** — một trait chết. Đây chính là mục 5 của Phase 3.

---

## 1. Vì sao có Phase 3

Sau Phase 2, BOT chơi được trọn ván và không rò rỉ thông tin. Nhưng ba câu hỏi vẫn không trả lời được:

1. **BOT chơi có tốt không?** Harness Phase 2 chỉ đo win-rate theo phe trên 30 ván. Nó không biết Dân có bỏ phiếu trúng Sói hay không, không biết Sói có tự bán đồng đội hay không, không biết BOT có lặp đi lặp lại một câu hay không.
2. **Vì sao BOT chọn nước này?** Không có trace. Khi một ván trông sai, cách duy nhất để hiểu là đọc lại toàn bộ `BotBrainState` bằng debugger.
3. **Chỉnh cái gì để cân bằng?** Muốn giảm win-rate của Sói 5%, phải sửa hằng số nào, trong file nào, và sửa xong có làm hỏng vai khác không? Với N3 ở trên, câu trả lời hiện tại là "không biết".

Phase 3 biến ba câu hỏi đó thành ba thứ đo được: **self-play**, **trace**, **weights tập trung**.

**Không làm ở Phase 3:** difficulty level (yêu cầu rõ ràng), học online, persistence brain state qua restart, thay đổi luật chơi, thay đổi UI.

---

## 2. Giả định

Người dùng yêu cầu tự chọn phương án an toàn và ghi lại. Đây là toàn bộ:

- **G1 — Ranh giới "runner nằm ngoài engine".** Nhân mô phỏng (thuần, không I/O, không `Date.now`, không `fs`) ở lại `packages/game-engine/src/bot/evaluation/`, vì test của engine phải chạy được nó. **Runner** — parse tham số, ghi file, đọc commit SHA, đo thời gian tường — nằm ở `apps/server/scripts/selfplay.ts`. Đây là đúng ranh giới Phase 1 đã dựng: engine thuần, `apps/server` giữ I/O. Không có `fs`, `process` hay `child_process` nào lọt vào `packages/game-engine`.
- **G2 — Mặc định phải giữ nguyên hành vi.** Task 1 (weights tập trung) là **refactor thuần**: `DEFAULT_BOT_WEIGHTS` phải cho ra đúng từng bit hành vi hôm nay. Bằng chứng: 420 test engine hiện có phải xanh **mà không sửa một dòng nào**, cộng thêm một golden-replay test. Mọi thay đổi giá trị chỉ xảy ra ở Task 8, có lý do và có số liệu.
- **G3 — Trace không phải là snapshot.** Trace là công cụ debug offline. Nó **không** đi qua websocket, **không** vào `RoomSnapshot`, và mặc định **tắt** (`undefined` sink → không cấp phát object nào). Bật ở test và self-play.
- **G4 — Trace chỉ chứa thứ BOT đã được phép biết.** Ràng buộc không phải "trace không chứa role" — Sói có quyền biết đồng bọn, và trace của nó phải giải thích được vì sao nó không bầu đồng bọn. Ràng buộc đúng là: **trace ⊆ knowledge view của chính bot đó**. Test khẳng định điều này chứ không khẳng định câu yếu hơn.
- **G5 — "Turn" là một vòng ngày-đêm.** Giới hạn là `MAX_ROUNDS`. Chạm trần là **vi phạm** được báo cáo kèm seed, không phải một kết thúc bình thường.
- **G6 — Self-play không gọi provider.** Lời thoại trong mô phỏng do một template thuần, tất định sinh ra từ `BotSpeechIntention`. Không mạng, không LLM. Template này chỉ sống trong `evaluation/`; nó không thay thế `speech-renderer` của server.
- **G7 — Batch "đủ lớn" = 300 ván.** Test suite chỉ chạy smoke batch (≤30 ván, < 2s). Batch lớn chạy qua CLI, không nằm trong `npm test`. 300 ván là con số vừa đủ để một khác biệt win-rate 10 điểm phần trăm không phải nhiễu, và vẫn xong trong vài giây trên máy phát triển.
- **G8 — Report lớn không commit.** CLI ghi vào `reports/` (đã thêm vào `.gitignore`). Chỉ một fixture nhỏ (`docs/fixtures/selfplay-sample.json`, ≤ 20 KB, 12 ván) được track để pin schema.
- **G9 — "Evidence hết hạn".** Một evidence là *stale* khi `currentRound - evidence.round > 3` **và** kind của nó không nằm trong `PERMANENT_KINDS` (`SEER_RESULT_*`, `KNOWN_ALLY`). Dùng evidence stale không phải lỗi — trí nhớ dài là hợp lý — nhưng tỉ lệ cao nghĩa là decay không hoạt động. Nó là **metric**, không phải invariant.
- **G10 — Tất định là tính chất của batch, không chỉ của ván.** Cùng `(seedBase, gameCount, config, weightsVersion)` phải cho ra cùng report **trừ trường timing**. Timing bị loại khỏi mọi so sánh tất định.

---

## 3. Kiến trúc

```
packages/game-engine/src/bot/
  config/
    weights.ts        NEW  BotWeights, DEFAULT_BOT_WEIGHTS, resolveWeights, validateWeights
    presets.ts        NEW  bảng phiên bản: v1 (Phase 2 nguyên trạng), v2 (đã hiệu chỉnh)
  trace/
    trace.ts          NEW  BotDecisionTrace, BotTraceSink, createTraceCollector
  evaluation/
    simulate.ts       (mở rộng: seeded toàn phần, events, speech, trace, turn limit)
    metrics.ts        NEW  12 chỉ số bắt buộc
    invariants.ts     NEW  10 kiểm tra + InvariantViolation có đủ dữ liệu replay
    report.ts         NEW  builder THUẦN cho SelfPlayReport (không I/O)
  ...                 (các file Phase 2 giữ nguyên, chỉ nhận thêm `weights`)

apps/server/scripts/
  selfplay.ts         NEW  CLI: --seed --games --players --config --out --weights --trace
```

**Luật phụ thuộc mới, cộng thêm vào luật Phase 2:**

- `config/weights.ts` không import gì ngoài `types.ts`. Nó là lá của đồ thị phụ thuộc.
- `trace/trace.ts` không import module quyết định nào — quyết định import trace, không ngược lại.
- `evaluation/` được import `engine.ts`; **không file nào khác trong `bot/` được phép**.
- `packages/game-engine` tiếp tục không có `fs`/`process`/`net`. Test `phase-1-invariants.test.ts:265` được mở rộng để phủ luôn thư mục mới.

---

## 4. Weights tập trung (mục 5 của yêu cầu)

### 4.1 Hình dạng

```ts
export interface BotWeights {
  /** Semver. Đổi giá trị bất kỳ là phải đổi version. */
  readonly version: string;

  /** Bằng chứng công khai → suspicion. Thay cho vote-analysis.WEIGHTS. */
  readonly evidence: Record<PublicEvidenceKind, { weight: number; confidence: number }>;

  /** Thông tin riêng của vai. Độ lớn tuyệt đối, cố tình áp đảo mọi thứ khác. */
  readonly privateInfo: { seerWolf: number; seerClear: number; knownAlly: number };

  readonly suspicion: {
    evidenceConfidenceBonus: number;
    hostilityBonus: number;
    pairBonus: number;
    isolationBonus: number;
  };
  readonly trust: { damping: number };
  readonly voteHistory: { lateSwitchRatio: number; minBandwagonLead: number };
  readonly social: {
    edgeStepDivisor: number;
    priorStrength: number;
    alignmentMix: number; supportMix: number; hostilityMix: number;
    minCohesion: number;
  };
  readonly recency: {
    beliefDecayPerRound: number;
    memoryDecayPerRound: number;
    staleAfterRounds: number;
  };
  readonly selfPreservation: { guardSelfHostilityThreshold: number; guardSelfBonus: number };
  readonly teammateProtection: { voteBiasPenalty: number; base: number; loyaltySpan: number };
  /** Sói dám lộ tới đâu. `bussingSuspicionFloor` là mức bằng chứng mà trên đó
   *  hy sinh đồng đội rẻ hơn bảo vệ nó. */
  readonly deceptionRisk: {
    bussingSuspicionFloor: number;
    bussingDeceptionScale: number;
    abstainPressureCeiling: number;
  };
  readonly aggression: { thresholdBase: number; aggressivenessSpan: number; riskSpan: number };
  readonly confidence: {
    hysteresisBase: number; hysteresisStubbornSpan: number;
    hunterMargin: number; spareTrustMargin: number;
    jitterSpan: number;
  };
  readonly roleThresholds: {
    witchHealTrust: number; witchPoisonSuspicion: number; witchPoisonTrustVeto: number;
    priestSuspicion: number; priestTrustVeto: number;
    guardianAngelWorthACharge: number; guardianAngelHostilityBonus: number;
    seerMostInformativeSuspicion: number;
    wolfThreatBase: number; wolfTrustWeight: number;
    wolfHostilityWeight: number; wolfSuspicionDiscount: number;
  };
}
```

`validateWeights` từ chối: `NaN`, `Infinity`, xác suất/tỉ lệ ngoài `[0,1]`, `version` rỗng. Nó chạy trong constructor của `BotRuntime` — một cấu hình hỏng phải đỏ ngay tại điểm cấu hình, không phải đỏ ở vòng 7 của ván thứ 214.

### 4.2 Cách luồn qua hệ thống

`BotRuntimeOptions` nhận thêm `weights?: BotWeights` (mặc định `DEFAULT_BOT_WEIGHTS`). `BotRuntime` truyền xuống `selectVote`, `trial-decision`, `strategyFor(...).decideNight/voteBias`, `applyEvidence`, `decayBeliefs`, `analyzeVoteRecap`.

`BotRoleStrategy` đổi chữ ký: thêm tham số `weights` sau `rng`. Đây là breaking change trong package, không phải ở API công khai của server — server chỉ dùng `BotRuntime`.

**Không tạo singleton toàn cục và không có setter.** Weights là dữ liệu đọc-chỉ được inject; một biến module có thể ghi được sẽ biến hai ván chạy song song trong cùng process thành một nguồn không tất định.

### 4.3 Phiên bản

`presets.ts` giữ một bảng `Record<string, BotWeights>`:

- `"1.0.0"` — đúng bằng hành vi Phase 2. Đóng băng vĩnh viễn; nó là mốc so sánh.
- `"2.x.y"` — kết quả hiệu chỉnh ở Task 8.

`DEFAULT_BOT_WEIGHTS` trỏ tới preset đang dùng cho production. Report ghi lại `version` để một con số win-rate luôn truy được về đúng cấu hình sinh ra nó.

---

## 5. Self-play simulation (mục 1)

### 5.1 Đầu vào

```ts
export interface SelfPlayInput {
  seed: string;
  playerCount?: number;          // mặc định 8
  config?: Partial<RoomConfig>;
  weights?: BotWeights;
  maxRounds?: number;            // mặc định MAX_ROUNDS = 20
  /** Bật dynamic events. Mặc định false để giữ nguyên hành vi harness Phase 2. */
  events?: boolean;
  /** Thu trace của mọi quyết định. Tốn bộ nhớ; mặc định tắt. */
  trace?: boolean;
  /** Cho BOT nói và nghe nhau. Mặc định BẬT ở Phase 3. */
  speech?: boolean;
}
```

### 5.2 Tất định toàn phần

Xử lý N1 và N2:

- `GameEngine.create(players, config, now, rng?)` — thêm tham số `rng` tuỳ chọn ở cuối, chuyển thẳng vào `assignRoles`. Mặc định `Math.random` nên mọi call site hiện có không đổi hành vi. Đây **không** phải thay đổi luật; nó chỉ mở một đường inject đã có sẵn ở tầng dưới.
- Harness bỏ hack `sort()` + reshuffle, gọi `create(..., createSeededRng(seed + ":setup"))`.
- Mọi lối vào có tham số `rng` được truyền rng đã gieo: `startNight`, `startDay`, `lockWolves`, `resolveNight`.
- `now` là bộ đếm đơn điệu bắt đầu từ 0, không phải `Date.now()`.
- Mỗi BOT có rng riêng `seed:{playerId}`; mỗi vòng có rng riêng cho engine `seed:engine:{round}`. Rng của BOT và của engine không bao giờ chung stream — nếu chung, thêm một quyết định của BOT sẽ đổi cả kết quả xáo bài của engine.

### 5.3 Nói và nghe

Khi `speech: true`, sau khi chốt phiếu, mỗi BOT gọi `decideSpeech`, và ý định được render bằng template thuần thành một `BotChatObservation` mà **mọi BOT còn sống đều thấy ở lần `observe` kế tiếp**. Điều này lần đầu tiên cho `chat-analysis` chạy trong self-play, mở ra đường `ROLE_CLAIM`/`COUNTER_CLAIM`/`ACCUSE`/`DEFEND`.

Template render **không** thêm thông tin: nó chỉ nêu `kind` và `targetId` mà lõi đã quyết. Không có LLM, không mạng.

### 5.4 Turn limit và replay

- Vượt `maxRounds` → ghi vi phạm `ROUND_LIMIT`, dừng ván, **không** ném.
- Mỗi ván trả về `SelfPlayGame` đủ để replay độc lập: `seed`, `playerCount`, `config`, `weightsVersion`, `maxRounds`, `events`, `speech`.
- `replaySeed(record)` chạy lại đúng ván đó một mình, không cần batch. CLI in ra lệnh replay cho mỗi seed thất bại.
- **Runner không có quyền hạn engine.** Nó không đọc `engine.state.players[].role` để quyết định điều gì; chỗ duy nhất được đọc sự thật là `invariants.ts`, và chỉ để *so sánh*, không bao giờ để đưa lại cho BOT.

---

## 6. Evaluation metrics (mục 2)

`metrics.ts` gom từ nhiều ván. Mười hai chỉ số bắt buộc:

| Chỉ số | Định nghĩa vận hành |
| --- | --- |
| `winRate.village` / `winRate.wolves` | số ván thắng / tổng ván kết thúc |
| `winRateByRole[role]` | số ván mà một người mang vai đó ở **phe thắng** / số ván có vai đó |
| `averageRounds` | trung bình `rounds` trên ván kết thúc |
| `villageVoteAccuracy` | phiếu cuối cùng trong vòng của một người **phe làng** nhắm vào một Sói thật / tổng phiếu như vậy có nhắm người |
| `wolfSelfSabotage` | phiếu hoặc ACCUSE của Sói nhắm vào đồng bọn còn sống / tổng phiếu + ACCUSE của Sói |
| `voteChangeRate` | số `VoteMutation` có `previousChoice !== null` / tổng mutation |
| `consensus` | trung bình theo vòng của `phiếu cho ứng viên dẫn đầu / số người bỏ phiếu` |
| `coalitionCohesion` | trung bình `cohesion` của mọi coalition `detectCoalitions` tìm được, đo ở cuối mỗi vòng |
| `staleEvidenceRate` | evidence gắn vào intention có `round` cũ hơn `staleAfterRounds` và không thuộc `PERMANENT_KINDS` / tổng evidence gắn vào intention (G9) |
| `knowledgeBoundaryViolations` | đếm từ `invariants.ts`; **phải bằng 0** |
| `fallbackActions` | nước đi bị engine từ chối + lượt bỏ trống vì không có mục tiêu hợp lệ |
| `speechRepetitionRate` | ý định phát ngôn có `(kind, targetId)` trùng lần nói liền trước của cùng BOT / tổng lần nói |
| `roundLimitRate` | ván chạm `maxRounds` / tổng ván |

Mọi chỉ số là **tỉ lệ có mẫu số hiện rõ** trong report — một tỉ lệ không có mẫu số là một con số không kiểm chứng được. Mẫu số 0 cho ra `null`, không phải `0` và không phải `NaN`.

Tất định: cùng batch → cùng metrics từng bit. Có test riêng.

---

## 7. Invariant / security audit (mục 3)

`invariants.ts` chạy **trong lúc** mô phỏng, tại các checkpoint pha.

```ts
export type InvariantId =
  | "ROLE_LEAK"            // BOT biết vai người khác ngoài luật
  | "DEAD_ROLE_REVEALED"   // vai người chết lộ trước GAME_OVER
  | "WOLF_ALLY_SCOPE"      // Sói biết đồng bọn sai luật (chết / không phải Sói)
  | "SEER_RESULT_SCOPE"    // Tiên Tri thấy kết quả không phải của mình
  | "ACTION_BY_DEAD"       // hành động gửi cho / bởi người chết
  | "DEAD_TARGET"          // nhắm người chết khi luật không cho
  | "FUTURE_EVIDENCE"      // evidence có round > round hiện tại
  | "SPEECH_CHANGED_ACTION"// render lời thoại làm đổi action
  | "NUMERIC_SANITY"       // NaN / Infinity / xác suất ngoài [0,1]
  | "REPLAY_DIVERGENCE"    // cùng seed ra khác nhau
  | "ROUND_LIMIT";

export interface InvariantViolation {
  id: InvariantId;
  seed: string;
  config: SelfPlayGameConfig;   // đủ để dựng lại ván
  round: number;
  phase: Phase;
  playerId: string | null;
  expected: string;
  actual: string;
  /** Chuỗi sự kiện TỐI THIỂU dẫn tới vi phạm, không phải toàn bộ log. */
  events: string[];
}
```

Ghi chú thiết kế:

- **`SPEECH_CHANGED_ACTION`** được kiểm bằng cách chụp `BotVoteIntention`/`BotNightIntention` trước khi render lời thoại, render, rồi so lại. Hàm render không nhận tham chiếu ghi được nào tới intention.
- **`FUTURE_EVIDENCE`** bắt cả một lớp bug tinh vi: một evidence mang `round` tương lai sẽ được miễn decay vĩnh viễn (`age = max(0, round - lastUpdated)` kẹp ở 0).
- **`REPLAY_DIVERGENCE`** chỉ chạy ở chế độ `--verify-replay`; chạy hai lần mọi ván trong batch lớn là lãng phí gấp đôi thời gian.
- Vi phạm **không ném**. Ném sẽ dừng batch ở ván đầu tiên và giấu mất 299 ván còn lại. Chúng được gom, đếm, và làm đỏ test ở tầng khẳng định.

---

## 8. BOT explanation trace (mục 4)

```ts
export interface BotDecisionTrace {
  botId: string;
  round: number;
  phase: Phase;
  decision: "VOTE" | "NIGHT" | "FINAL_VOTE" | "HUNTER_SHOT" | "SPEECH";
  chosen: { targetId: string | null; label: string };
  candidates: Array<{
    targetId: string;
    score: number;
    /** Từng số hạng và đóng góp của nó. Tổng phải bằng `score`. */
    terms: Array<{ name: string; value: number }>;
    evidenceIds: string[];
  }>;
  beliefBefore: Record<string, { suspicion: number; trust: number }>;
  beliefAfter: Record<string, { suspicion: number; trust: number }>;
  personality: BotPersonality;
  /** Mọi lần rút RNG trong quyết định này, theo thứ tự. */
  rngDraws: number[];
  fallbackReason: string | null;
  /** Ảnh chụp knowledge ĐÃ LỌC — đúng bằng thứ bot được thấy, không hơn. */
  knowledgeSnapshot: {
    aliveIds: string[];
    legalChoices: string[];
    knownRoles: Record<string, Role>;
    seerResult: { targetId: string; isWolf: boolean } | null;
  };
}

export interface BotTraceSink { record(trace: BotDecisionTrace): void; }
```

- `terms` phải cộng lại đúng bằng `score` — có test. Một trace giải thích sai còn tệ hơn không có trace.
- `rngDraws` được thu bằng cách bọc rng của bot trong một proxy chỉ khi trace bật. Tắt trace thì không có wrapper, không có chi phí.
- **Ranh giới (G4):** `knownRoles` trong trace là **bản sao của `knowledge.knownRoles`**, thứ engine đã lọc. Test khẳng định `trace.knowledgeSnapshot.knownRoles` là tập con của `knowledge.knownRoles`, và với BOT phe làng nó chỉ chứa đúng vai của chính nó.
- Production: `BotRuntime` không nhận sink → mọi đường trace là `if (!this.trace) ...` sớm.

---

## 9. Strategy quality tests (mục 6)

Mười scenario, mỗi cái tất định và có tiêu chí chấp nhận đo được. Chúng dựng `BotBrainState` + `BotKnowledgeView` trực tiếp, không chạy trọn ván — một test hành vi phải hỏng vì đúng lý do nó kiểm.

| # | Hành vi | Tiêu chí chấp nhận |
| --- | --- | --- |
| 1 | Dân ưu tiên người có chuỗi vote đáng ngờ | Trong hai ứng viên suspicion bằng nhau, người có `LATE_SWITCH` + `SAVE_VOTE` được chọn |
| 2 | Sói tránh bảo vệ đồng đội quá lộ liễu | Sói **không** DEFEND và không đẩy phiếu ra khỏi đồng đội khi đồng đội đang bị nghi nặng; nó chỉ không bầu đồng đội |
| 3 | Sói hy sinh đồng đội khi bằng chứng quá mạnh | Khi đồng đội ở suspicion ≥ `bussingSuspicionFloor` và phiếu của Sói không cứu được, Sói bầu đồng đội thay vì bầu bừa người khác |
| 4 | Tiên Tri dùng kết quả soi mà không lộ quá sớm | Vòng 1: bầu đúng Sói đã soi trúng, nhưng `decideSpeech` trả `QUESTION`/`WITHHOLD` chứ không `ACCUSE` kèm evidence `SEER_RESULT_WOLF` |
| 5 | Bảo Vệ cân bằng giữa mục tiêu mạnh và pattern lặp | Không bao giờ chọn `guardPrevious`; qua 4 đêm chọn ≥ 3 mục tiêu khác nhau |
| 6 | Thợ Săn bắn theo belief cuối cùng | Bắn người suspicion cao nhất **nếu** vượt `threshold + hunterMargin`; dưới ngưỡng thì `targetId === null` |
| 7 | BOT đổi chiến thuật khi đồng đội chết | Sau `ALLY_LOST`, ngưỡng vote hiệu dụng của Sói tăng và nó ít ACCUSE hơn |
| 8 | BOT không lặp một luận điểm vô hạn | Cùng evidence hai vòng liền → lần hai là `QUESTION`, không phải `ACCUSE` lặp lại |
| 9 | BOT đổi phiếu khi có bằng chứng mới mạnh hơn | Thêm `SEER_RESULT_WOLF` cho người khác → phiếu chuyển ngay |
| 10 | BOT không đổi phiếu vì nhiễu nhỏ | Chênh lệch điểm nhỏ hơn `voteHysteresis` → giữ nguyên phiếu cũ |

Scenario 3 (bussing) là **hành vi mới**: Phase 2 ghi rõ "bussing thuộc Phase 3". Nó dùng `deceptionSkill` — trait chết được nhắc ở N3 — làm hệ số: Sói có `deceptionSkill` cao mới dám bán đồng đội.

---

## 10. Reports (mục 7)

`report.ts` là builder **thuần**: nhận kết quả batch, trả object. Không `fs`, không `Date`.

```ts
export interface SelfPlayReport {
  schemaVersion: 1;
  weightsVersion: string;
  seedBase: string;
  seedRange: { first: string; last: string };
  games: number;
  config: SelfPlayGameConfig;
  metrics: SelfPlayMetrics;
  metricsByTeam: Record<"village" | "wolves", TeamMetrics>;
  metricsByRole: Record<string, RoleMetrics>;
  violations: InvariantViolation[];
  failedSeeds: Array<{ seed: string; reason: string; replay: string }>;
  timing: { totalMs: number; msPerGame: number } | null;  // null ở nhân thuần
  commit: string | null;                                   // CLI điền
}
```

`timing` và `commit` do CLI bơm vào **sau** khi builder chạy, nên nhân thuần vẫn tất định (G10). `commit` lấy bằng `git rev-parse HEAD` trong `apps/server/scripts/selfplay.ts` — không có Git I/O nào chạm vào engine.

CLI in thêm bản tóm tắt người đọc được và, với mỗi seed hỏng, đúng một dòng lệnh copy-paste được để replay.

---

## 11. Ranh giới bảo mật — bất biến xuyên Phase 3

Toàn bộ 8 bất biến của Phase 2 tiếp tục có hiệu lực, cộng thêm:

9. Trace không bao giờ chứa nhiều hơn knowledge view của chính bot đó.
10. `packages/game-engine` không import `fs`, `process`, `child_process`, `net`.
11. Không `Math.random` trong đường quyết định của BOT — mở rộng để phủ luôn `config/`, `trace/`, `evaluation/`.
12. Weights là dữ liệu đọc-chỉ được inject; không singleton ghi được.
13. Provider không có API nào trả về mục tiêu hay nước đi; `BotBrain` chỉ còn `decideDefense`.
14. Runner self-play không đưa sự thật (vai thật) vào bất kỳ `BotDecisionContext` nào.

---

## 12. Tiêu chí hoàn thành

- Spec, plan, ledger trong repo.
- Mỗi task một commit riêng, một report riêng trong `.superpowers/sdd/2026-08-29-bot-ai-phase-3/`.
- `npm test`, `npm run lint`, `npm run build` xanh trên toàn monorepo.
- Self-play smoke batch trong test suite; batch 300 ván qua CLI với số liệu thật trong `docs/bot-ai-phase-3-verification.md`.
- `knowledgeBoundaryViolations === 0` trên batch lớn.
- Mọi hằng số điều chỉnh có thể truy về `BotWeights`; test khẳng định điều đó.
- Trace bật/tắt được, và test khẳng định ranh giới G4.
- 10 scenario chất lượng chiến thuật xanh.
- `git diff --check` sạch.
