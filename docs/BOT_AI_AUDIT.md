# BOT AI AUDIT — Ma Sói Online

> Phase 0 của `docs/BOT_AI_UPGRADE.md`: audit kiến trúc bot hiện tại **trước khi sửa code**.
> Mọi tên file / symbol / con số dưới đây đọc trực tiếp từ repo (nhánh `feat/gameplay`,
> working tree tại thời điểm audit; gốc so sánh `main` = `ae94179` như Phase 1 đã ghi).
> Môi trường khi audit: **engine 4.660 test PASS (82 file), server 1.095 test PASS (132 file),
> `npm run lint` XANH cả 4 workspace** (sau khi vá 1 lỗi typecheck có sẵn, không liên quan bot,
> ở `apps/server/tests/helpers/night.ts` — thiếu `trackerTargets/trackerResults` theo
> `NightState` mới; chi tiết ở §Risks).

---

## 1. Current architecture

Kiến trúc thực tế **không phải** trạng thái "cần nâng cấp" mà spec §0 mô tả. Toàn bộ
pipeline mục tiêu của spec đã tồn tại, được xây qua 7 phase có verification docs:

```text
GameEngine (packages/game-engine/src/engine.ts)
    │  botKnowledgeFor(botId)  ← điểm lọc DUY NHẤT
    ▼
Observation Builder  (bot/knowledge.ts::buildBotKnowledgeView + engine.ts helpers)
    │  BotKnowledgeView (deep-copied, không giữ tham chiếu live)
    ▼
Event Memory         (bot/memory/memory-store.ts, memory-decay.ts)
    │  BotMemory (20 loại) + seenEventIds + budgets
    ▼
Belief Engine        (bot/belief/belief-state.ts, evidence.ts, player-profile.ts, private-info.ts)
    │  suspicion/trust per player (BeliefEntry 0..100) + PlayerProfile + SocialEdge
    ▼
Analysis             (bot/analysis/: vote-analysis, social-analysis, claim-credibility,
    │                 coalition, chat-analysis, verdict-review)
    ▼
Candidate Generator  (legalVoteChoices / legalActions / legalTargets do ENGINE tính;
    │                 triggers.ts cho speech; strategy.ts cho night)
    ▼
Strategic Scorer     (TraceTerm[] + sumTerms trong vote-decision và từng role file;
    │                 tên-term, tie-break score desc + id asc, confidence)
    ▼
Role Policy          (bot/roles/registry.ts → strategyFor(role); passiveStrategy fallback)
    ▼
Selected Action      (BotVoteIntention / BotNightIntention / BotFinalVoteIntention / ...)
    │                           │
    ▼                           ▼
Game Engine               LLM Dialogue (verbalize only — apps/server/src/bots/)
```

Hai tầng tách bạch rõ:

- **Lõi tất định** `packages/game-engine/src/bot/**` — không có LLM, không `Date.now`,
  không `Math.random`, không nhận `GameState`/`Room`. Nhận
  `BotDecisionContext = { knowledge, visibleChat, balanceScore?, pendingLastStand? }`.
- **Tầng server** `apps/server/src/bots/**` — schedule bot theo pha, gọi LLM
  **chỉ để diễn đạt lời thoại**, render template fallback tất định.

Server pull-based (scheduler), không có event bus: `machine.ts` gọi
`runtime.observe(context)` trước mỗi checkpoint quyết định
(`scheduleNightBots`, `scheduleDayBots` → `discussion-scheduler`,
`scheduleVoteBots`, `scheduleFinalVoteBots`, `scheduleDefenseBot`,
`scheduleHunterBot`, `scheduleDayOfTruthBots`, `scheduleLastLetterBots`,
dead-can-speak ghost whisper).

## 2. Relevant files

### Lõi bot (packages/game-engine)

| Vùng | File |
| --- | --- |
| Runtime não bot | `src/bot/BotRuntime.ts` (~1.337 dòng; `observe`, `decideVote`, `decideSpeech`, `decideNight`, `decideFinalVote`, `decideRoleClaim`, `decideGhostWhisper`, `decideLastLetter`, `decideHunterShot`, `decideDefense`, `serialize`) |
| Types | `src/bot/types.ts` (`BotKnowledgeView`, `NightKnowledge`, `BotMemory`, `BotEvidence`, `BotSpeechIntention`, `BotPersonality`, `BotBrainState`, `assertSpeechScope`…) |
| Knowledge filter | `src/bot/knowledge.ts` (`buildBotKnowledgeView`, `countHumansAlive`, `isHumanTable`, `isThinVillage`); filter gốc ở `engine.ts::botKnowledgeFor` (dòng ~2732) + `botNightKnowledgeFor` (~2884), `botHunterShotKnowledgeFor` (~3062), `legalVoteChoicesFor` (~3114) |
| Memory | `src/bot/memory/memory-store.ts` (`remember`, dedup key, `PINNED_TYPES`), `memory-decay.ts` (`decayAndPrune`, budgets) |
| Belief | `src/bot/belief/belief-state.ts` (`applyEvidence`, `applyTrustEvidence`, `decayBeliefs`, `beliefInertia`), `evidence.ts` (`validateEvidence` — anti-fabrication fence), `player-profile.ts`, `private-info.ts` (`applyPrivateInformation`: pin thay vì accumulate cho sự thật engine-cấp) |
| Analysis | `src/bot/analysis/vote-analysis.ts` (BANDWAGON/LATE_SWITCH/TIE_BREAK/SAVE_VOTE/VOTE_ALIGNMENT), `social-analysis.ts` (`SocialEdge`, `possibleWolfPairScore`, `incomingHostilityOf`), `claim-credibility.ts` (S1/S2/S3, pure, bị cấm import knownRoles), `coalition.ts` (`detectCoalitions`, `isolationScore`), `chat-analysis.ts` (parser tiếng Việt ~700 dòng → ACCUSE/DEFEND/ROLE_CLAIM/COUNTER_CLAIM/DIRECT_ADDRESS/DIRECT_QUESTION), `verdict-review.ts` (VERDICT_HIT/MISS, gated `revealRoleOnDeath`) |
| Decision | `src/bot/decision/vote-decision.ts` (`selectVote`, threshold/hysteresis, abstain gates), `claim-decision.ts` (`decideRoleClaim`, `decideChatClaim`, `wolfBluffSeat`), `defense-decision.ts`, `trial-decision.ts` (`decideFinalVote` mặc định guilty, `decideHunterShot`), `ghost-decision.ts`, `last-letter-decision.ts`, `defense-scheduler.ts` |
| Role strategies | `src/bot/roles/strategy.ts` (`BotRoleStrategy { decideNight; voteBias }`), `registry.ts` (`strategyFor`, fallback `passiveStrategy`), `werewolf.ts` (threatScore, fakeFight), `seer.ts` (`informationValue`), `guard.ts`, `witch.ts` (heal/poison thresholds), `detective.ts`, `tracker.ts`, `sorcerer.ts`, `serial-killer.ts`, `jester.ts`, `executioner.ts`, `traitor.ts`, `uncertainty.ts` |
| Personality | `src/bot/personality/personality.ts` (7 traits), `speech-style.ts` (`deriveSpeechStyle` — bề mặt duy nhất LLM thấy) |
| Conversation | `src/bot/conversation/speech-planner.ts` (`planSpeech`), `triggers.ts` (8 trigger kinds), `templates.ts` (`SPEECH_TEMPLATES`, `renderSpeechTemplate` tất định qua fnv1a32), `fingerprint.ts`, `chain-limits.ts`, `speech-memory.ts` |
| RNG/Hash | `src/bot/rng.ts` (`createSeededRng` additive-counter, seek O(1) theo cursor), `src/bot/hash.ts` (`fnv1a32`) |
| Weights | `src/bot/config/weights.ts` (~2.236 dòng, `BotWeights` + `BOT_WEIGHTS_V1..V19`, `DEFAULT_BOT_WEIGHTS = BOT_WEIGHTS_V18`), `config/presets.ts` (`weightsPreset(version)`) |
| Self-play | `src/bot/evaluation/selfplay.ts` (chạy engine thật, record replay được), `invariants.ts` (16 invariant gồm ROLE_LEAK, SEER_RESULT_SCOPE, WOLF_ALLY_SCOPE, SPEECH_SCOPE, REPLAY_DIVERGENCE…), `metrics.ts`, `report.ts` (`runBatch`, `verifyReplay`), `human-chat.ts` + `human-chat-corpus.ts`, `casual-tone.ts` |
| Trace | `src/bot/trace/trace.ts` (`BotDecisionTrace`, Σterms===score, trace ⊆ knowledge), `trace-jsonl.ts`, `trace-view.ts` |

### Tầng server (apps/server)

| Vùng | File |
| --- | --- |
| Brain interface | `src/bots/types.ts` — `BotBrain` **chỉ còn 1 method**: `renderDaySpeech(request: SpeechRequest): Promise<Attempt<DaySpeechDecision>>`; `DaySpeechDecision = { chat: string \| null }` |
| Provider chain | `src/bots/index.ts` (`chooseBrain`: OpenAiCompat → OpenAI → Gemini → FallbackBrain; disabled → `randomBrain` trả silence), `openai-compat-brain.ts`, `gemini-brain.ts`, `fallback-brain.ts`, `random-brain.ts`, `decide.ts` (`daySpeechSchema = z.object({think, chat}).strict()`), |
| Context | `src/bots/context.ts` (`buildBotDecisionContext` — chỉ nối `botKnowledgeFor` + `visibleChatLog`, có test cấm đọc `state.players`/`.role`) |
| Prompt | `src/bots/prompt.ts` (`buildDaySpeechPrompt` — không vai, không target ngoài target đã khoá, chat bọc `<chat_data>` untrusted) |
| Render | `src/bots/speech-renderer.ts` (`renderBotSpeech`: 3 gate `echoesRecentOwnLine`/`repeatsRecentOpening`/`claimSurvivesRoundTrip` → retry → template fallback), `speech-stats.ts` |
| Governor | `src/bots/governor.ts` (`BotGovernor` ngân sách gọi theo room, `Cooldown` 429) |
| Session | `src/bots/session-registry.ts` (`BotSession`, seed `${room.code}:${gameId}`, RNG theo channel, serialize/restore qua restart) |
| Schedule | `src/game/machine.ts` (`scheduleNightBots` ~L816, `scheduleDayBots` ~L960, `scheduleVoteBots` ~L1258, `scheduleFinalVoteBots` ~L1124, `scheduleDefenseBot` ~L977, hunter/day-of-truth/last-letter/ghost), `src/game/discussion-scheduler.ts` |
| CLI | `scripts/selfplay.ts` (`--seed --games --players --max-rounds --weights --preset --events --no-speech --defense --humans --verify-replay --out --traces`), `scripts/role-power.ts`, `scripts/reveal-ab.ts`, `scripts/trace-view.ts`, `scripts/bot-probe.ts` (stale — vẫn build `SpeechRequest` kiểu cũ với trường `personalityStyle` đã xoá; không typecheck vì tsconfig chỉ gồm `src`) |
| Config | `src/config.ts` (`BOT_AI_ENABLED` mặc định bật, `BOT_AI_MAX_CALLS_PER_GAME`=180, `BOT_AI_*`, `OPENAI_*`, `GEMINI_*`, `CHAT_MAX_LENGTH`=300) |

### Tests

- `packages/game-engine/tests/bot-*.test.ts` (~45 file) + `selfplay-*.test.ts`,
  `phase-1-invariants.test.ts` — belief, memory, role strategies, speech, trace,
  invariants, replay determinism.
- `apps/server/tests/bot-*.test.ts` + `claim-integrity`, `deterministic-vote-scheduling`,
  `restart-bot-determinism`, `hunter-bot`, `day-of-truth-bot`, `last-letter-bot`,
  `trial-bot`, `jester-defense`… — ranh giới prompt/knowledge, renderer gates,
  scheduling, persistence.

## 3. Current decision flow

Lấy lượt vote ban ngày làm mẫu (các quyết định khác cùng pattern):

1. Scheduler server tới checkpoint (12%/52%/84% khung vote — Phase 1; thảo luận có
   ngân sách tin nhắn/bot/vòng) → `buildBotDecisionContext(room, botId)`.
2. `runtime.observe(context)` — pipeline ingest có thứ tự và gate once-per-round:
   `ingestDeaths → ingestSeerResult → ingestRoleClaims → ingestRecaps →
   ingestVerdictReviews → ingestChat → ingestClaimVerdicts → ingestDefenseReview →
   claimEvidence (dedup `appliedClaimEvidenceIds`) → decay once-per-round
   (`decayAndPrune`, `decayBeliefs`, recordAggression) → `applyPrivateInformation`
   → `adaptToDeaths`.
3. `runtime.decideVote(context)` → `selectVote`: candidates từ
   `knowledge.legalVoteChoices` (engine-cấp) → scoring bằng named terms
   (`belief, evidenceConfidence, hostility, pairPressure, trustDamping, roleBias,
   isolation, teammateProtection, bussingJoin, fakeFight, jitter`) → tie-break
   `score desc, id asc` → gates (voteThreshold, hysteresis, abstain) →
   `BotVoteIntention { choice, confidence, evidence }`.
4. Night: `runtime.decideNight` → `strategyFor(selfRole).decideNight(...)` (13 vai có
   strategy riêng, fallback passive) → intention → `engine.submitNightAction`.
5. Lời thoại: `decideSpeech` → `planSpeech` (triggers → candidate kinds theo
   personality → RNG roll responseProbability → initiative ladder) →
   `judgeChainPosition` (room chain limits) → `renderBotSpeech` (LLM **diễn đạt**,
   zod strict `{think, chat}`, 3 gates, fallback template tất định).
6. Trace (tắt mặc định): `beginTracedDecision` ghi candidates/terms/belief/knowledge
   snapshot; bất biến Σterms === score.

## 4. Current information available to bot

Chỉ qua `BotKnowledgeView` (đã lọc, deep-copied):

- Công khai: roster (`id/name/alive/isBot`), phase/round, `neutralRolesInPlay` (deck
  công khai), `publicVoteHistory` (mutation-level), `currentVoteCounts`, `hasVoted`,
  `myVote`, `legalVoteChoices`, `lastNightDeaths`, `activeEventId`,
  `dayOfTruthClaims`, `trialAccusedId`, `trialDefense`, `revealRoleOnDeath`,
  `obituaryRevealedId`.
- Riêng theo vai (engine cấp): `selfRole`; `knownRoles` (chỉ vai mình + đồng bọn Sói
  khi viewer là Sói; vai người chết KHÔNG mở), `seerResult` (kèm `team`),
  `sorcererResult` (seer-line), `trackerResult`, `executionerTargetId`,
  `NightKnowledge` (`legalActions/legalTargets/wolfTarget/guardPrevious/healUsed/
  poisonUsed/wolvesLocked/bonusSecondTargetFor`), `hunterShot.legalTargets`.
- `visibleChat`: `BotChatObservation { id, actorId, text, at }` per-viewer từ server.
- Đường vào DUY NHẤT: `engine.botKnowledgeFor(botId)`; `context.ts` có test cấm đọc
  thẳng engine state. Self-play có auditor GroundTruth tách bạch (runner không leak).

## 5. Current memory model

- `BotMemory { id, sourceId, round, phase, type, actorId, targetId?, importance,
  pinned, data }` — 20 loại (`VOTE_CAST, VOTE_CHANGED, LATE_VOTE, NOMINATED,
  FINAL_JUDGMENT, PLAYER_DIED, ROLE_CLAIM, COUNTER_CLAIM, ACCUSE, DEFEND,
  SEER_RESULT, BOT_SPOKE, DIRECT_ADDRESS, DIRECT_QUESTION, ALLY_LOST,
  ROUND_SUMMARY, AVOIDANCE, DEFENSE_QUALITY`).
- Dedup `type:sourceId:actorId:targetId`; pin bắt buộc `ROLE_CLAIM/COUNTER_CLAIM/
  SEER_RESULT`; budget `weights.limits.memory/pinned/seenEvents` (FIFO).
- Decay: unpinned `importance *= memoryDecayPerRound^age`; belief decay
  `beliefDecayPerRound` (0.85) với `PERMANENT_KINDS` miễn (SEER_RESULT_*,
  KNOWN_ALLY, PROVEN_FALSE_CLAIM); profile nguội chậm; social edges decay.
- Speech memory cấu trúc (`BotSpeechRecord` + vân tay text/semantic + opening),
  `speechSequence` thay `Date.now`; `repliedMessageIds`, `appliedClaimEvidenceIds`
  chống double-apply.
- Persistence: `BotRuntime.serialize()` + RNG cursors per channel; restore qua
  restart (`restart-bot-determinism.test.ts`).

## 6. Current belief model

- Per player: `suspicion`/`trust` là **hai bộ tích luỹ độc lập** (`BeliefEntry {
  score 0..100, reasons[] (cap), lastUpdatedRound }`), KHÔNG phải xác suất role
  normalize (spec §6 dùng ví dụ P(role); repo dùng score cumulative + evidence
  reasons + decay — thoả tinh thần "cumulative evidence, không tuyệt đối").
- Evidence: `BotEvidence { kind, sourceId, actorId, weight, confidence, round,
  summary }` — 15 kind công khai + 4 kind riêng (SEER_RESULT_WOLF/CLEAR,
  PROVEN_FALSE_CLAIM, KNOWN_ALLY); `validateEvidence` ném nếu `sourceId` chưa từng
  quan sát (anti-fabrication).
- Profiles: `PlayerProfile { bluffRate, aggroRate, accuracy, samples }` — "nhớ con
  người, không chỉ sự kiện", `profileStrength = samples/(samples+prior)`.
- Social: `SocialEdge { support, hostility, voteAlignment, samples }` per cặp;
  `possibleWolfPairScore`, `detectCoalitions` (tín hiệu, không kết luận vai),
  `isolationScore`.
- Private info injection: pin thay vì accumulate (idempotent dưới observe lặp);
  seer neutral-result phân biệt theo deck có SERIAL_KILLER hay không; tracker
  active/idle là evidence decayable; wolf ally pin KNOWN_ALLY (gated `roleTeam`).

## 7. Current role strategies

`BotRoleStrategy { role, decideNight(context, state, rng, probe?), voteBias(...) }`,
registry + `passiveStrategy` fallback — đúng shape spec §9:

| Vai | Night | Day/voteBias |
| --- | --- | --- |
| Werewolf (+Cub, Alpha) | `threatScore`: giết claim power role trước, else `trust + incomingHostility − suspicion` (nguy hiểm cho Sói, không phải nghi ngờ); second-kill event-driven | −bias đồng bọn; `fakeFightTarget` hash-scheduled rounds 1–2; bussing theo deceptionSkill |
| Seer (+Apprentice) | soi mục tiêu `informationValue` (đỉnh giữa thang, không phải max suspicion) | human-table: giữ kết quả; claim khi giữ kết quả Sói |
| Guard | most-trusted, tránh lặp target (engine cũng lọc `guardPrevious`) | — |
| Witch | SKIP mặc định; heal khi victim là mình hoặc `trust ≥ witchHealTrust`; poison cần `suspicion ≥ witchPoisonThreshold` + trust-veto | — |
| Detective | hai người least-certain (information value) | — |
| Tracker | TRACK most suspicious + hostility | — |
| Sorcerer | ưu tiên claimed seer-line > trusted > suspicious; voteBias đẩy vote vào seer-line đã soi | — |
| Serial Killer | giết most-trusted (làng không treo), tránh blocked kill, tránh người đang tấn công mình | bandwagon |
| Jester | passive | contrarian: tìm án treo, không tự vote |
| Executioner | passive | bias mục tiêu nhiệm vụ (không tạo evidence vai) |
| Traitor | passive | né top suspect (thường là Sói), nhắm most-trusted |

## 8. Current LLM responsibilities

**Verbalization-only, đã được kiến trúc khoá chặt:**

- `BotBrain` interface chỉ có `renderDaySpeech` — không có method nào trả nước đi.
- Output schema zod `.strict()` `{think, chat}` — trường `voteTargetId` bị từ chối.
- `SpeechRequest` không chứa RoomSnapshot/vai/danh sách target hợp lệ; prompt không
  có vai (kể cả vai mình), không có tên ngoài target đã khoá, chat bọc untrusted
  `<chat_data>`; defense prompt chỉ số phiếu công khai.
- Gates sau LLM: anti-parroting (fingerprint), anti-opening-repeat,
  `claimSurvivesRoundTrip` (re-parse text, claim phải khớp type+role+target lõi đã
  quyết) — vi phạm → retry 1 lần → template tất định.
- LLM path: day discussion, defense, ghost whisper. Last letter **cố tình** không
  qua LLM. Governor budget theo room (180 mặc định) + cooldown 429.
- `BOT_AI_ENABLED=false` → RandomBrain (silent) → template speech; gameplay không đổi.

## 9. Current weaknesses

Đúng nghĩa "điểm yếu còn lại" sau 7 phase — không lặp lại những gì đã được giải quyết:

1. **Không có long-term look-ahead**: scorer là myopic (utility ngay + risk term
   nội sinh), chưa có "action → predicted outcome → next phase risk" như spec §12.
   `StrategicPlanner` abstraction chưa tồn tại tách rời. **→ Đã đắp (M5 seam +
   M6 look-ahead v1):** `lookAheadVotePlanner` cộng số hạng `futureRisk`
   (mislynch risk = P(vô tội) x áp lực sĩ số + khan hiếm bằng chứng) vào bảng
   điểm phiếu nhánh làng, sau seam của M5; weights v20, KHÔNG mặc định.
   Bench 2×1.000 ván (`--seed m6-bench{,2} --preset`): làng thắng 51,2% →
   51,4% (nhiễu), villageVoteAccuracy 44,66% → 45,75% (+1,1 điểm, z≈2,45),
   0 vi phạm; replay `--verify-replay` 30 ván 0 divergence. Giữ v18 làm default
   theo cùng kỷ luật v19 — tổng 4.000 ván chưa đủ để kết luận nâng default.
2. ~~**Role strategies trùng lặp pattern**~~ **Đã tách (M4):**
   `roles/night-scoring.ts::rankNightTargets` dùng chung cho 7 vai đêm
   (seer, detective, guard, sorcerer, werewolf, tracker, serial-killer) — giữ
   nguyên thứ tự term, lệ rút RNG jitter, scale sau tổng của Sát Nhân và
   tie-break `score desc, id asc`. Equivalence chứng minh bằng suite pin đủ
   4.657 test + self-play 30 ván `--verify-replay` 0 divergence. (Phù Thuỷ
   không dùng pattern này — nó chấm ngưỡng, không xếp hạng.)
3. **Wolf coordination ẩn định qua hash**: `fakeFightTarget`/`wolfBluffSeat` dựa vào
   mọi Sói tự tính cùng đáp số từ public state + hash — không có pack channel; đủ
   tốt nhưng mong manh nếu knowledge view diverge (đã handle dead-wolf, vẫn là điểm
   cần document).
4. ~~**`decideDefenseClaim` legacy** trên BotRuntime (đã thay bởi `decideDefense`)
   vẫn exported — dead code có nguy cơ bị gọi nhầm.~~ **Đã xoá (M1).**
5. ~~**Cap-interaction trong memory**~~ **Đã chốt bằng characterization test + guard
   (M2):** `tests/bot-marker-eviction.test.ts` tái hiện tràn `seenEventIds`; phát
   hiện và vá crash thật (`ingestRecaps` ném `validateEvidence` khi đọc lại recap
   đã mất nguồn) — guard bỏ qua mảnh mất nguồn, mirror đúng pattern của
   `ingestVerdictReviews`. Đường tracker tự lành (`ensureSource` đăng ký lại) và
   được test pin.
6. ~~**`scripts/bot-probe.ts` stale**~~ **Đã sửa (M3):** dựng `SpeechRequest` đúng
   hình dạng hiện tại (personality → `deriveSpeechStyle` thật, đủ
   `players/defense/seq/round/...`), typecheck riêng và smoke-run PASS.
7. **Không có "P(role)" dạng xác suất** như spec §6 minh hoạ: score 0..100 +
   evidence là đủ dùng nhưng nếu muốn so benchmark với spec (belief JSON mẫu) thì
   cần một lớp projection (không bắt buộc, chỉ là khác biệt biểu diễn).

## 10. Recommended extension points

1. **StrategicPlanner abstraction** (spec §12): `interface StrategicPlanner {
   evaluate(candidate, context): ActionEvaluation }` — bọc quanh scorer hiện có,
   thêm look-ahead 1 bước (predicted outcome → next-phase risk). Điểm cắm tự nhiên:
   trước khi tie-break trong `selectVote`/role night strategies.
2. **Shared night-scoring helper**: trích pattern TraceTerm+jitter+tie-break chung
   cho role files (giảm trùng lặp, giữ term names per-role).
3. **`PolicyModel` seam** (spec §27): **Đã cắm (M7)** — `bot/policy/policy-model.ts`;
   `HeuristicPolicyModel` hiện hành, model RL sau này cắm qua tham số `policy` của
   `selectVote` mà không đổi BotRuntime/engine call sites.
4. **Belief → probability projection**: hàm thuần chuyển
   `suspicion/trust/evidence` → `P(role)` theo deck composition (chỉ khi cần cho
   benchmark/debug; không bắt buộc cho gameplay).
5. **Cleanup nhỏ**: xoá `decideDefenseClaim`, sửa/capture test cho `bot-probe.ts`,
   thêm test chốt marker-eviction trong ván dài.
6. **Docs**: mô tả kiến trúc hiện tại (chính file này) + cập nhật README docs bot.

## 11. Risks

- **Điểm yếu #5 (marker eviction)** và **#3 (wolf hash coordination)** là hai nơi
  dễ vỡ nhất khi mở rộng — phải có characterization test trước khi đụng.
- Engine + bot core rất nhiều test pin behavior (4.660 test). Mọi refactor
  "extract shared helper" phải giữ nguyên semantics hoặc đi kèm rebaseline metrics
  self-play (self-play metrics rất nhạy: Phase 6 chỉ +1–2 điểm trong nhiễu ±3).
- **Đã vá 1 lỗi lint có sẵn** trong audit này:
  `apps/server/tests/helpers/night.ts` thiếu `trackerTargets/trackerResults` theo
  `NightState` (danh sách trường NightState nở dần theo vai mới — helper scaffold
  chép tay đã trôi). Fix: thêm 2 trường `{}` vào scaffold. Không đụng runtime.
- Weights v19 tồn tại nhưng **không** mặc định (đã bench thua 12.3 điểm); đừng
  "nâng version" như một bước refactor.
- Self-play `--humans n` vẫn là bot đội cờ `isBot:false` — không đọc nhầm là số
  người thật (Phase 6/7 đã cảnh báo).
- Windows/PowerShell: script self-play dùng `tsx`; chạy qua `npm run selfplay`.

## 12. Đối chiếu acceptance criteria (spec §30)

| Tiêu chí | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Memory theo event | Đã có | `BotMemory` 20 loại, `memory-store`, budgets |
| Belief per player | Đã có | `suspicion/trust: Record<string, BeliefEntry>` + profiles |
| Belief update sau event | Đã có | pipeline `observe()` + evidence kinds + decay |
| Assessment riêng từng player | Đã có | BeliefEntry + PlayerProfile + SocialEdge |
| Generate nhiều candidate | Đã có | legal choices (engine) + triggers + role night candidates |
| Score candidate thay vì rule đơn | Đã có | `TraceTerm[]` + sumTerms, named terms |
| Strategy khác nhau theo role | Đã có | `roles/registry.ts`, 13 vai, passive fallback |
| LLM không tự quyết action | Đã có | `BotBrain.renderDaySpeech` duy nhất; zod strict; gates |
| Personality hoạt động | Đã có | 7 traits vào threshold/inertia/deception + speech style |
| Không hidden leakage | Đã có | `botKnowledgeFor` filter duy nhất; 16 invariant; test cấm đọc state |
| Unit tests | Đã có | engine 4.660 / server 1.095 PASS |
| Simulation | Đã có | `runSelfPlay`/`runBatch` + CLI `npm run selfplay` |
| Benchmark V1 vs V2 | Đã có | weights V1..V19 presets + `--weights` + role-power sweep |
| Không phá game engine | Đã có | engine không import bot runtime; test import-graph |
| Existing tests pass | Đã có | chạy lại trong audit: 4.660 + 1.095 PASS, lint XANH |
| Docs kiến trúc mới | **File này** + 7 phase verification docs | `docs/bot-ai-phase-*-verification.md` |

## 12b. Ma trận characterization tests (spec §19 → suite hiện có)

Bước 2 của spec ("tạo characterization tests cho bot hiện tại") **đã được đáp ứng
bởi suite hiện hành** — viết thêm là nhân bản. Ánh xạ từng nhóm test spec §19:

| Nhóm spec §19 | Test hiện có |
| --- | --- |
| Belief: claim / counter-claim / confirmed role / vote evidence / death evidence | `bot-memory-belief.test.ts`, `bot-belief-decay.test.ts`, `bot-claim-credibility.test.ts`, `bot-claim-decision.test.ts`, `bot-events.test.ts`, `verdict-review.test.ts` |
| Strategy: wolf kill / villager vote / seer inspection / guardian protection | `bot-role-strategy.test.ts`, `bot-night-strategies.test.ts`, `bot-vote-stickiness.test.ts`, `bot-strategy-quality.test.ts`, `tracker-strategy.test.ts` |
| Information leakage: villager không thấy wolf / seer không thấy wolf chat | `bot-knowledge.test.ts`, `phase-1-invariants.test.ts`, `selfplay-invariants.test.ts` (ROLE_LEAK, SEER_RESULT_SCOPE, WOLF_ALLY_SCOPE, SPEECH_SCOPE), server: `bot-context.test.ts`, `bot-prompt.test.ts` |
| Determinism: same seed → same result | `bot-runtime.test.ts`, `bot-rng-cursor.test.ts`, `bot-rng-personality.test.ts`, `bot-runtime-restore.test.ts`, server: `restart-bot-determinism.test.ts`, selfplay `--verify-replay` (REPLAY_DIVERGENCE) |
| Regression: behavior cũ còn pass | toàn bộ suite (4.660 + 1.095, chạy lại trong audit) |

**Kết luận Phase 0:** Spec `BOT_AI_UPGRADE.md` đã được hiện thực gần như trọn vẹn
qua 7 phase. Khoảng trống còn lại có giá trị: (1) StrategicPlanner look-ahead
(spec §12), (2) PolicyModel seam (§27), (3) dọn nợ nhỏ (legacy method, stale
script, marker-eviction test). Đề xuất: không "rebuild bot" — chỉ implement các
khoảng trống này theo đúng nguyên tắc bước nhỏ + test của spec.

## 13. Migration plan đề xuất (dựa trên code thật)

Spec §29 yêu cầu migration theo bước nhỏ, có test, backward-compatible. Vì
feature surface đã có, plan chỉ gồm các bước đắp khoảng trống:

| Bước | Nội dung | File đụng | Test |
| --- | --- | --- | --- |
| M1 | **XONG** — xoá `decideDefenseClaim` legacy khỏi `BotRuntime` (0 call site production; nhánh claim-in-defense đã có characterization ở `jester-defense-decision.test.ts`) | `BotRuntime.ts` | suite engine + server xanh |
| M2 | **XONG** — `tests/bot-marker-eviction.test.ts` (RED: crash `1:nomination:3`) + guard skip-mất-nguồn trong `ingestRecaps` (GREEN); test pin thêm đường tracker tự lành | `BotRuntime.ts`, test mới | suite xanh (engine 83 file / 4.657) |
| M3 | **XONG** — viết lại `scripts/bot-probe.ts` cho khớp `SpeechRequest`; typecheck riêng + smoke-run PASS | `scripts/bot-probe.ts` | tsc scripts/bot-probe.ts |
| M4 | **XONG** — `roles/night-scoring.ts::rankNightTargets` thay khung map→jitter→sum→probe→sort ở 7 vai đêm; semantics giữ nguyên từng bit | `roles/*.ts` (7 file), file mới | suite 4.657 + selfplay `--seed m4-replay --games 30 --preset --verify-replay` 0 divergence |
| M5 | **XONG** — seam `StrategicPlanner` (spec §12/§27): `bot/planning/planner.ts` (`ActionEvaluation`, `StrategyContext<Frame>`, `StrategicPlanner`, `immediateUtilityPlanner`); scorer phiếu tách thành `scoreVoteCandidate` + `deriveVoteScoringFrame`, `selectVote` đi qua planner. Zero behavior change — 2 test mới chứng minh planner cho cùng `{score, terms}` với probe của `selectVote` cùng seed | `planning/planner.ts` (mới), `decision/vote-decision.ts` | suite 84 file / 4.659 + selfplay `--seed m5-replay --games 30 --preset --verify-replay` 0 divergence |
| M6 | **XONG** — look-ahead v1: nhóm `lookAhead` optional trong `BotWeights` (`mislynchPressureScale/mislynchScarcityScale/wolfMislynchGain`), `voteFutureRisk` + `lookAheadVotePlanner` bọc planner của M5, preset `20.0.0` (default vẫn v18). 5 test mới (`bot-lookahead.test.ts`) | `config/weights.ts`, `config/presets.ts`, `decision/vote-decision.ts`, test mới | suite 85 file / 4.664 + replay 30 ván 0 divergence + bench 2×1.000 (v18 vs v20: WR nhiễu, voteAccuracy +1,1 điểm) |
| M7 | **XONG** — seam `PolicyModel` (spec §27): `bot/policy/policy-model.ts` (`PolicyModel.selectAction` nhận bảng điểm đã chấm, trả targetId hoặc null = chủ động bỏ; `heuristicPolicyModel` = argmax + tie-break id, fallback text giữ nguyên để trace byte-identical). `selectVote` nhận tham số `policy` optional — BotRuntime giữ API cũ. Module export từ index cho RL model tương lai | `policy/policy-model.ts` (mới), `decision/vote-decision.ts`, `index.ts` | 4 test mới (`bot-policy.test.ts`); suite 86 file / 4.668 + replay 30 ván 0 divergence |

M1–M3 là dọn nợ an toàn (làm trước, mỗi bước một commit). M4–M7 là mở rộng;
M6/M7 chỉ forward khi benchmark thoả điều kiện trong spec §21.

Sau mỗi bước: `npm test` (4 workspace), `npm run lint`, self-play batch nhỏ
(≥200 ván) nếu đụng decision code.
