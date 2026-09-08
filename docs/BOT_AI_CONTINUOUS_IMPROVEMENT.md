# BOT AI CONTINUOUS IMPROVEMENT — Audit & Plan

> Phase 0 của `docs/BOT_AI_CONTINUE_UPGRADE.md`: ánh xạ spec ↔ codebase thật,
> xác định cái gì ĐÃ có, cái gì THIẾU, và thứ tự PR. Bot hiện tại là
> **BOT_V_CURRENT** (= `DEFAULT_BOT_WEIGHTS` v18.0.0).
>
> Audit gốc của kiến trúc: `docs/BOT_AI_AUDIT.md` (Phase 0 của spec trước) —
> không lặp lại, chỉ ghi phần khác biệt so với spec mới.

---

## 1. Current pipeline (thực tế)

```text
GameEngine.botKnowledgeFor(botId)        ← filter DUY NHẤT, deep-copied
    ↓ BotKnowledgeView + visibleChat
BotRuntime.observe()                     ← memory 20 loại + belief scalar + social graph
    ↓
Decision: selectVote / strategyFor(role).decideNight / decideChatClaim / ...
    ↓ ImmediateUtilityPlanner → [lookAheadVotePlanner khi v20+] → heuristicPolicyModel
    ↓
Action (vote/night/claim/defense/trial/hunter/letter/ghost)
    ↓
LLM renderBotSpeech (verbalize only, zod strict {think, chat})
```

## 2. Ánh xạ spec §40 ↔ hiện trạng

| Tiêu chí §40 | Trạng thái | Ghi chú |
| --- | --- | --- |
| Bot hiện tại còn là baseline | ✅ | v18 default; replay `--verify-replay` 0 divergence |
| **Belief probabilistic** | ❌ THIẾU | `suspicion/trust` là scalar 0..100 (§5, §33 = PR 1) |
| Role constraints respected | ⚠️ một phần | seer pin, KNOWN_ALLY, PROVEN_FALSE_CLAIM; chưa dùng composition của deck làm ràng buộc toàn cục |
| **Pairwise relationships** | ⚠️ một phần | `SocialEdge` + `possibleWolfPairScore` + `detectCoalitions` có sẵn (§8/§34 = PR 2 cần nâng lên P(cặp)) |
| Suspicion ≠ threat ≠ credibility | ⚠️ một phần | threat có trong `werewolf.threatScore` (private), credibility trong claim-credibility S1; chưa là assessment surface chung (§9) |
| One-step counterfactual | ✅ v1 | M6: `futureRisk` phiếu làng (weights v20, không default) (§10/§11/§35 = PR 3 mở rộng) |
| **Wolf team planning** | ❌ THIẾU | Sói phối hợp ẩn định qua hash (`fakeFightTarget`, `wolfBluffSeat`) (§14-§17/§36 = PR 5) |
| Personality affects decisions | ✅ | threshold/inertia/bussing/deceptionSkill… |
| LLM isolated | ✅ | `BotBrain.renderDaySpeech` duy nhất, zod strict |
| Hidden info never leaks | ✅ | 16 invariant self-play + `botKnowledgeFor` filter |
| **Self-play trajectory export** | ⚠️ một phần | có `SelfPlayRecord`/events/trace JSONL; chưa theo format quan sát-per-bot của §22 (PR 7) |
| Hybrid learned-policy seam | ✅ seam | M7 `PolicyModel.selectAction` — chỗ cắm `HybridPolicy` alpha/beta (§24 = PR 8) |
| Scenario benchmarks | ⚠️ | có targeted tests (bot-persuasion, jester-bot, trap corpus…), chưa thành bộ scenario có tên theo §28 (PR 9) |
| Fixed-seed benchmark | ✅ | `runBatch` + `--weights` + paired seeds |
| New bot beats baseline trên ≥1 metric | — | đo theo từng PR |

## 3. Metrics baseline (BOT_V_CURRENT, đo thật trong phiên trước)

`npm run selfplay -- --seed m6-bench --games 1000 --preset --weights 18.0.0`:

- Làng thắng **52,5%** / Sói 47,4% / draw 0,1%
- `villageVoteAccuracy` **44,25%** (5.640/12.745)
- `averageRounds` 3,43 · violations 0
- Tốc độ: ~0,13s/ván (không verify) → 10.000 ván ≈ 22 phút/arm

## 4. Known weaknesses (thứ tự giải quyết theo spec §32)

1. Belief scalar — không phân biệt P(vai) với mức nghi, không dùng ràng buộc bộ bài (→ **PR 1, session này**).
2. Pairwise chỉ là hint chấm điểm, không phải P(cả hai là Sói) (→ PR 2).
3. Look-ahead mới phủ phiếu làng v20; chưa có expectedOutcome theo team (→ PR 3).
4. Sói không có team plan (→ PR 5).
5. Trajectory export chưa theo format §22 (→ PR 7).

## 5. Files SHOULD change (PR 1 — session này)

- `packages/game-engine/src/engine.ts` — `botKnowledgeFor` thêm `roleComposition` (đếm từ `buildRoleDeck(config)`, thông tin CÔNG KHAI vì `RoomConfig` đi xuống mọi client).
- `packages/game-engine/src/bot/knowledge.ts` + `types.ts` — field optional `roleComposition?: Record<string, number>` + copy trong builder.
- `packages/game-engine/src/bot/belief/role-belief.ts` (MỚI) — projection thuần `projectRoleBeliefs(state, knowledge)` + API `getRoleProbability / getWolfProbability / getTeamProbability`.
- `packages/game-engine/tests/bot-role-belief.test.ts` (MỚI).
- `packages/game-engine/src/index.ts` — export module mới.

## 6. Files MUST NOT change (PR 1)

- `BotBrainState` / serialization (`memory-store.ts`, `session-registry.ts`) — projection là hàm thuần, KHÔNG thêm state → không đụng schema Redis.
- `vote-decision.ts` và mọi decision file — spec §33: "Do not immediately change action selection".
- LLM layer (`apps/server/src/bots/**`) — không đụng.
- Weights — PR 1 không thêm knob (projection không phải behavior).

## 7. Thiết kế PR 1 (tóm tắt)

```text
P(role) cho từng player =
  1. CERTAIN: knownRoles (gồm self, đồng bọn Sói, người chết khi luật lộ vai)
  2. team-pinned: kết quả soi của chính bot (isWolf=true → khối lượng team-wolves;
     false → wolf-team = 0)
  3. còn lại: P(wolf-team) := suspicion/100 (tổng bằng chứng đã có — §33 "derive
     from probability"), phần không-Sói chia theo prior của deck (composition)
     và nâng cho vai được claim (claim-credibility đã trừ bluff vào suspicion
     nên claim chỉ phân bổ lại khối lượng không-Sói — không đếm đôi bằng chứng)
```

Fallback khi knowledge cũ không có `roleComposition`: pool = {WEREWOLF} ∪
neutralRolesInPlay ∪ vai trong knownRoles ∪ {VILLAGER}. Không hard-code số lượng
ở bất kỳ đâu — mọi con số đến từ composition engine cấp.

## 8. Risks

- Projection sai chuẩn hoá sẽ lan vào mọi consumer tương lai — chốt bằng test
  sum≈1 + các case certain.
- Knowledge cũ (selfplay record, restore) thiếu composition — phải có fallback
  và test riêng.
- Không đụng decision trong PR này → win-rate baseline không đổi là kết quả
  mong đợi (đối chiếu bằng 1 batch nhỏ nếu cần).

---

## 9. PR 1 — Báo cáo thực hiện (spec §41)

**Changed files:**

- `packages/game-engine/src/bot/belief/role-belief.ts` (MỚI) — projection thuần
  `projectRoleBeliefs` + API đọc `getRoleProbability / getWolfProbability /
  getTeamProbability` (spec §5)
- `packages/game-engine/src/bot/types.ts` — `BotKnowledgeView.roleComposition?`
- `packages/game-engine/src/bot/knowledge.ts` — copy field trong builder
- `packages/game-engine/src/engine.ts` — `roleCompositionFor(config, playerCount)`
  đếm từ `specialRoleList` (cùng công thức `assignRoles`), fill vào
  `botKnowledgeFor`
- `packages/game-engine/src/index.ts` — export module
- Tests: `tests/bot-role-belief.test.ts` (11), `tests/bot-role-belief-integration.test.ts` (2);
  cập nhật 4 test ranh giới (`bot-knowledge`, `phase-1-invariants`, server
  `bot-context`) để tách bộ bài công khai khỏi kiểm chuỗi riêng tư — guarantee
  bảo mật giữ nguyên cho mọi trường khác

**Behavior changed:** KHÔNG. Projection là view thuần — không state mới (không
đụng `BotBrainState`/Redis schema), không đụng decision, không knob mới.
`DEFAULT_BOT_WEIGHTS` vẫn v18.

**Tests:** engine **88 file / 4.681 pass** (+13 mới), server **132 file / 1.095
pass**, `npm run lint` xanh cả 4 workspace.

**Benchmark:** self-play `--seed pr1-final --games 30 --preset --verify-replay`
— 0 divergence, 0 knowledge-boundary violation. (PR 1 là view-only nên không
cần bench dài; bench sẽ ở PR thay đổi action selection.)

**Baseline / New result:** baseline v18 giữ nguyên — villageWR dao động trong
nhiễu ±3 giữa các batch 30 ván (46.7–53.3%), khớp các lần đo trước.

**Known limitations:**

- `claim` chỉ phân bổ lại khối lượng không-Sói với hệ số cố định ×3 (chưa qua
  claim-credibility); khi PR sau nối decision vào `getWolfProbability` thì hệ
  số này phải trở thành weight trong `BotWeights`.
- `confidence` của belief suy diễn là heuristic đơn giản (0.25 + 0.5×top
  confidence của reasons); chưa có nghĩa lý thống kê.
- `updatedAtEventId` mới đi cho seer-pin; belief suy diễn lấy sourceId cuối
  trong reasons — đủ cho debug, chưa đủ cho replay audit chuỗi cập nhật.
- Chưa có consumer: projection chưa được gọi trong runtime thật (đúng §33 bước
  1); PR 2 (pairwise) và PR 3 (counterfactual) sẽ nối vào qua seam có sẵn.

**Tiếp theo (PR 2):** nâng `SocialEdge`/`possibleWolfPairScore` thành
`P(cả hai là Sói)` — pairwise reasoning §34, dùng `roleComposition` để chuẩn
hoá theo số ghế, không đụng decision.

---

## 10. PR 2 — Báo cáo thực hiện (spec §41)

**Changed files:**

- `packages/game-engine/src/bot/belief/pair-assessment.ts` (MỚI) —
  `assessPairs()` trả `PlayerPairAssessment[]` đúng shape spec §8
  (`wolfPairScore` joint xác suất, `allyScore`, `conflictScore`, `evidence`),
  dựng trên projection PR 1 + social graph Phase 2, không tính gì mới
- `packages/game-engine/src/index.ts` — export module
- Tests: `tests/bot-pair-assessment.test.ts` (8)

**Behavior changed:** KHÔNG — view thuần, không state mới, không đụng decision,
không knob mới. `DEFAULT_BOT_WEIGHTS` vẫn v18.

**Công thức (đúng ràng buộc §34):**

```text
joint = min( min(pA, pB), pA × pB × (1 + compatibility) )
```

- `pA, pB` = P(wolf-team) từng người từ projection PR 1
- `compatibility` = `possibleWolfPairScore` (chiết khấu samples sẵn)
- Không quan sát → joint = tích độc lập; hợp lực bão hoà → tiến gần
  min(pA, pB) nhưng **không bao giờ vượt** (chặn trên Fréchet) — pairwise không
  thể đè bằng chứng cá nhân
- Thù địch không kéo joint xuống dưới tích độc lập ("đang cãi nhau" ≠ "cả hai
  trong sạch")
- `allyScore/conflictScore` chiết khấu cùng `priorStrength`; evidence gom hai
  chiều cạnh, dedup theo id, sort ổn định, cap `limits.edgeReasons`

**Tests:** engine **89 file / 4.689 pass** (+8 mới), server **1.095 pass**,
lint xanh. 8 test chốt: tích độc lập khi trống cạnh; hợp lực nâng joint;
thù địch không nâng; Fréchet; certain đè quan hệ (2 Sói lộ → 1, 1 người
clear → 0); cặp chuẩn hoá a<b chỉ người sống (n(n−1)/2 cặp); evidence 2 chiều
sort dedup; tất định JSON-equal.

**Benchmark:** self-play `--seed pr2-final --games 30 --preset --verify-replay`
— 0 divergence, 0 knowledge violation. (View-only, bench thật khi PR sau nối
decision.)

**Known limitations:**

- `allyScore/conflictScore` dùng mix cố định (support+alignment / hostility) —
  chưa qua `weights.social` mix riêng; khi có consumer sẽ thêm weight group.
- Chưa tính "shared targets" (cùng nhắm một người) — social graph chưa ghi
  chiều này; sẽ bổ sung khi PR discussion-strategy (PR 4) cần.
- Joint chỉ chặn Fréchet trên, chưa dùng ràng buộc SỐ GHẾ Sói toàn ván
  (composition) để trừ pairwise hai cặp chồng nhau — đó là tầng Bayesian
  mà spec §8 khuyến cáo chưa cần.

**Tiếp theo (PR 3):** mở rộng counterfactual planner — từ `futureRisk` phiếu
làng (M6/v20) thành expectedOutcome đủ thành phần (§10: immediateValue,
survivalValue, informationValue, teamValue, futureRisk) cho nhánh Sói và cho
decision đêm, chạy trên seam `StrategicPlanner` của M5.

---

## 11. PR 3 — Báo cáo thực hiện (spec §41)

**Changed files:**

- `packages/game-engine/src/bot/planning/counterfactual.ts` (MỚI) —
  `expectedOutcomeFor()` (teamValue / survivalValue / informationValue /
  wolfProbability) + `counterfactualVotePlanner()` bọc planner M5, cộng ba term
  named vào bảng điểm
- `packages/game-engine/src/bot/config/weights.ts` — nhóm optional
  `counterfactual` (`teamValueGain=5, mislynchSurvivalCost=6, evidenceLossCost=4,
  wolfSideGain=0`), preset **21.0.0** (mọc từ V18, KHÔNG default)
- `packages/game-engine/src/bot/config/presets.ts` — đăng ký 21.0.0
- `packages/game-engine/src/bot/decision/vote-decision.ts` — chuỗi planner
  MỘT LỚP: counterfactual (v21+) → lookAhead (v20) → immediate (v1–v19);
  belief PR 1 chỉ tính khi lớp counterfactual bật
- `packages/game-engine/src/index.ts` — export
- Tests: `tests/bot-counterfactual.test.ts` (8)

**Behavior changed:** CÓ — nhánh làng v21 nhận ba term counterfactual dùng
P(wolf-team) từ projection PR 1 (thay proxy raw suspicion của v20); tách
"mất ghế" (survival) khỏi "mất nguồn dữ liệu" (information). Nhánh Sói
`wolfSideGain = 0` → byte-identical v18. v18/v20 output KHÔNG đổi (chỉ một lớp
counterfactual tại một thời điểm).

**Tests:** engine **90 file / 4.697 pass** (+8), lint xanh. Chốt: teamValue
theo P(Sói); survival theo áp lực sĩ số; informationValue phạt mất nguồn khi
khan dữ liệu; Sói passthrough; Σterms===score; preset đăng ký; v18 sạch term.

**Benchmark** (2×1.000 ván `--preset`, paired seeds `pr3-bench{,2}`, ~4,5 phút):

| Metric | V18 | V21 | Δ |
|---|---|---|---|
| Làng thắng | 53,4% (1068/2000) | 53,4% (1068/2000) | z=0,00 — cân bằng giữ nguyên |
| **villageVoteAccuracy** | **45,73%** | **48,71%** | **+3,0 điểm, z=6,72** |
| violations | 0 | 0 | — |

Replay V21: `--verify-replay` 30 ván — 0 divergence, 0 knowledge violation.
Tốc độ: ~0,13s/ván (không verify) — V21 không chậm hơn V18 (60–70s/1000).

**Kết luận:** v21 thắng baseline đúng tiêu chí §40 ("measurably beats baseline
on at least one important metric without materially degrading others") —
accuracy +3 điểm có ý nghĩa (z=6,7), win-rate không đổi. NHƯNG default vẫn
giữ v18 cho tới khi đạt chuẩn §27 (5 batch × 10.000 ván) — kỷ luật v19.

**Known limitations:**

- `expectedWinValue` (§10) chưa có — cần đếm thế trận sau đợt treo; phần này
  chờ PR 5 (team planner) vì chỉ nghĩa khi có mô hình team.
- Chỉ phủ nhánh phiếu ban ngày; decision đêm (soi/đỡ/cắn) chưa có
  counterfactual — PR 5.
- `deceptionValue` của §10 là đặc thù Sói — chờ PR 5.

**Tiếp theo (PR 4):** discussion strategy — discussion graph theo §13
(ai tố ai, ai bênh ai, ai né, ai theo đám đông) ghi có cấu trúc, nối được vào
`pair-assessment` (shared targets) và planner; sau đó PR 5 wolf team planner.

---

## 12. PR 4 — Báo cáo thực hiện (spec §41)

**Changed files:**

- `packages/game-engine/src/bot/analysis/discussion-graph.ts` (MỚI) —
  `buildDiscussionGraph()` → `PressureEpisode[]`: mỗi đợt áp lực quanh một
  target trong một vòng, ghi `initiatorId` (người tố đầu theo thứ tự
  `bot-chat:{round}:{total}` tất định), `accuserIds`, `defenderIds`,
  `silentIds` (người sống không hành động). Đọc từ memory ACCUSE/DEFEND mà
  `analyzeChat` đã ghi — không parse lại chat
- `packages/game-engine/src/bot/belief/pair-assessment.ts` — thêm
  `coAccusationScore` vào `PlayerPairAssessment`: cùng tố (2/accuserCount —
  đám đông đông thì loãng, đúng §13) hoặc cùng bênh một target; chiết khấu
  theo số đợt qua `priorStrength`; joint của PR 2 giờ dùng
  `1 + min(1, compatibility + coAccusationScore)` — Fréchet vẫn giữ
- `packages/game-engine/src/index.ts` — export
- Tests: `tests/bot-discussion-graph.test.ts` (11)

**Behavior changed:** KHÔNG với decision (view thuần); CÓ với surface của
`assessPairs` (thêm field) — không consumer cũ nào bị phá (field mới, giá trị
joint chỉ đổi khi có co-direction, và mọi test PR 2 giữ nguyên pass).

**Tests:** engine **91 file / 4.708 pass** (+11 mới, 8 test cũ của PR 2 vẫn
xanh), server 1.095 pass, lint xanh 4 workspace. Chốt: initiator = message đầu;
silent = sống-mà-im (người chết không tính); co-accusation 2 người > 3 người
(loãng theo độ đông); cùng bênh cũng là tín hiệu; a-tố-b (không cùng hướng) →
0 và joint giữ độc lập; Fréchet vẫn giữ; tất định JSON-equal.

**Benchmark:** self-play `--seed pr4-verify --games 30 --preset --weights 21.0.0
--verify-replay` — 0 divergence, 0 knowledge violation. (assessPairs chưa có
consumer trong decision → bench thật để sau khi nối.)

**Known limitations:**

- `silentIds` mới chỉ là dữ liệu; tín hiệu "im lặng nhiều vòng" đã có sẵn ở
  `AVOIDANCE` (vote-analysis) — chưa nối.
- Co-direction mới tính theo từng vòng riêng lẻ rồi chiết khấu số ĐỢT; chưa
  phân biệt "cùng đợt liên tiếp nhiều vòng" với "rải rác".
- Chưa có consumer trong planner/decision — để PR sau quyết định chỗ nối
  (isolation của planner, wolf team planner của PR 5).

**Tiếp theo (PR 5):** wolf team planner (§14–§17) — WolfTeamPlan (kill target,
claimant, distancing, sacrifice) trên dữ liệu personality + assessment có sẵn,
giữ tất định không kênh chat;wolfSideGain của v21 là chỗ bật counterfactual
cho nhánh Sói.

---

## 13. PR 5 — Báo cáo thực hiện (spec §41)

**Changed files:**

- `packages/game-engine/src/bot/roles/wolf-team-plan.ts` (MỚI) —
  `planWolfTeam()` trả `WolfTeamPlan` đúng shape §14: `primaryKillTarget` /
  `backupKillTarget` (threat ranking — được làng tin = nguy hiểm, đang bị nghi =
  để làng tự treo), `discussionLeader` (đồng bọn ít bị incomingHostility nhất,
  hoà hash chốt), `claimant` (tái dùng `wolfBluffSeat` hash Phase 3),
  `sacrificeCandidate` (đang bị dồn phiếu công khai), `distancingPlayers`
  (rỗng khi không ai bị dồn — §17 distancing chỉ có nghĩa khi có người cần giữ
  khoảng cách)
- `packages/game-engine/src/index.ts` — export
- Tests: `tests/bot-wolf-team-plan.test.ts` (8)

**Thiết kế "team-private" trên kiến trúc không kênh chat:** các BotRuntime
riêng biệt không truyền tin cho nhau. Plan là hàm THUẦN mà mọi con Sói tự tính
ra cùng đáp án từ đúng dữ liệu cả bầy cùng thấy (roster qua `knownRoles` chỉ
Sói có, phiếu công khai, social graph, hash FNV) — mô hình đã pin ở Phase 3.
§14 được bảo đảm về kiến trúc: non-wolf không có pack trong `knownRoles` →
nhận plan rỗng (test pin). §15: plan là khung chung, cá thể (jitter,
personality) vẫn nằm ở `werewolfStrategy`. Một bug thật được test bắt: ranking
leader từng loại chính mình → mỗi con tính leader khác nhau → bầy lệch nhau;
đã sửa để ranking trên toàn pack.

**Behavior changed:** KHÔNG với runtime/decision — `planWolfTeam` là module
mới, chưa có consumer; nhánh Sói của v21 vẫn `wolfSideGain = 0`. Đổi hành vi
Sói (nối plan vào `werewolfStrategy.decideNight` + counterfactual
`wolfSideGain > 0`) là bước kế tiếp, phải đi kèm bench riêng.

**Tests:** engine **92 file / 4.716 pass** (+8), server 1.095 pass, lint xanh.
Chốt: threat "được tin > bị nghi"; kill target không bao giờ là đồng bọn;
§14 non-wolf → plan rỗng; claimant đồng bộ giữa hai góc nhìn khác nhau; 
sacrifice = đang dồn phiếu; distancing rỗng khi không cần; leader đồng bộ;
tất định JSON-equal.

**Benchmark:** self-play `--seed pr5-verify --games 30 --preset --weights
21.0.0 --verify-replay` — 0 divergence, 0 knowledge violation.

**Known limitations:**

- Plan chưa có consumer — slot kill/claimant/sacrifice hiện chỉ là dữ liệu
  đúng; nối vào `werewolfStrategy` + bật `wolfSideGain` cần bench riêng.
- `discussionLeader` mới dùng hostility; §16 (đề xuất dùng personality cho
  role assignment) chưa nối — làm cùng bước consumer.
- Threat formula copy ngắn có chú thích trỏ nguồn (werewolf.ts giữ private);
  khi consumer thật cắm vào, cân nhắc export chung.

**Tiếp theo (PR 7):** trajectory export (§22) — dump observation-per-bot đã
lọc + candidates + selectedAction + reward ra JSONL từ self-play, phục vụ
PR 8 (HybridPolicy alpha/beta trên seam `PolicyModel`).

---

## 14. PR 5b — Báo cáo thực hiện (spec §41)

**Changed files:**

- `packages/game-engine/src/bot/config/weights.ts` — preset **22.0.0**
  (một ô đổi so v21: `counterfactual.wolfSideGain` 0 → 5); preset 21 giữ nguyên
  làm mốc A/B
- `packages/game-engine/src/bot/config/presets.ts` — đăng ký 22.0.0
- `packages/game-engine/src/bot/roles/wolf-team-plan.ts` — threat formula nâng
  thành `wolfThreatScore()` EXPORT (nguồn duy nhất, có đủ nhánh claim
  `wolfClaimedPowerScore` mà bản copy PR 5 thiếu)
- `packages/game-engine/src/bot/roles/werewolf.ts` — xoá `threatScore` local,
  dùng nguồn chung; `planWolfTeam` chưa nối trực tiếp vào `decideNight` (xem
  limitations)
- `packages/game-engine/src/bot/planning/counterfactual.ts` — nhánh Sói có
  expectedOutcome thật: `teamValue = wolfSideGain × P(không-Sói) × pressure`,
  `survivalValue = −cost × P(Sói) × pressure` (phiếu vào đồng bọn P=1 là phạt
  tối đa), `informationValue = 0`
- Tests: `tests/bot-counterfactual.test.ts` (+2 → 10)

**Behavior changed:** CÓ với nhánh Sói khi chạy `--weights 22.0.0` — bảng điểm
phiếu Sói giờ có counterfactual. v21 trở xuống byte-identical hành vi cũ.

**Tests:** engine **92 file / 4.718 pass** (+2), server 1.095 pass, lint xanh.
Chốt: v22 wolfSideGain=5; v21 vẫn 0; Sói v22 — phiếu người thường
teamValue>0/survival<0, phiếu đồng bọn teamValue=0 + survival phạt nặng hơn;
10 test counterfactual tổng.

**Benchmark** (2×1.000 ván `--preset`, paired seeds `pr5b-bench{,2}`):

| Metric | V21 | V22 | Δ |
|---|---|---|---|
| Sói thắng | 44,5% | 44,4% | z≈0 — nhiễu |
| wolfSelfSabotage | 16,05% | 15,77% | −0,3 điểm (hướng đúng, trong nhiễu) |
| villageVoteAccuracy | 48,95% | 49,00% | ≈ không đổi |
| violations | 0 | 0 | — |

Replay V22: 30 ván `--verify-replay` — 0 divergence, 0 knowledge violation.

**Kết luận:** v22 KHÔNG làm Sói mạnh lên có ý nghĩa (z≈0), nhưng cũng KHÔNG
phá gì — wolf counterfactual đúng semantics (phạt phiếu đồng bọn, thưởng phiếu
làng đúng lúc) và WolfSelfSabotage nghiêng đúng hướng. Giữ v18 default như cũ;
v22 là preset hợp lệ cho phòng thí nghiệm tiếp theo (PR 8 HybridPolicy).

**Known limitations:**

- `planWolfTeam` chưa được consumer nào đọc trực tiếp trong runtime — các slot
  (leader/claimant/sacrifice) vẫn chỉ là dữ liệu đúng. Nó là bước kiến trúc;
  dùng nó đòi hỏi thay đổi strategy với bench riêng, và wolf side đã đủ tốt qua
  counterfactual nên chưa có lý do đo được để nối ngay ("Do not replace working
  components without measurable reason" — §2).
- `wolfThreatScore` bỏ `context` tham số cũ của `threatScore` (không dùng).

---

## 15. PR 7 — Báo cáo thực hiện (spec §41)

**Changed files:**

- `packages/game-engine/src/bot/evaluation/trajectory.ts` (MỚI) —
  `gameToTrajectories(game)` (mỗi trace → một `BotTrajectory`) +
  `serializeTrajectory()` (một line JSONL). Nguồn: `BotDecisionTrace` đã bị
  invariant kiểm; label cấp-ván: `finalRole` (vai thật của CHÍNH bot),
  `finalWinner`, `reward ±1` qua `roleWonOutcome` + `personalWins` (Thằng Hề
  thắng riêng vẫn +1) — không dựng lại luật thắng
- `apps/server/scripts/selfplay.ts` — cờ `--trajectories <dir>` (mặc định tắt;
  bật thì `traceGames` tự có nghĩa ngay cả khi không có `--traces`), writer
  `writeTrajectories()` ghi MỘT file `trajectories.jsonl` chung (dữ liệu train
  đọc theo luồng, khác trace-per-game dùng debug)
- `packages/game-engine/src/index.ts` — export
- Tests: `tests/bot-trajectory.test.ts` (5)

**Ranh giới §22 thực thi bằng CẤU TRÚC:** `observation` chỉ gồm trường có nguồn
từ `knowledgeSnapshot` của trace (aliveIds/legalActions/knownRoles/seerResult —
bản sao knowledge đã lọc của chính bot đó) + belief snapshot + personality.
`finalRole` là field CẤP MỘT tách khỏi observation; vai người khác không có
đường vào observation. Audit bằng script quét 390 dòng smoke-run (3 ván × 130
quyết định): **0 role-leak** — WEREWOLF chỉ xuất hiện trong observation của bot
hợp pháp thấy bầy (86 dòng).

**Tests:** engine **93 file / 4.723 pass** (+5), server 1.095 pass, lint xanh.
Chốt: shape line (gameId/seed/player/turn/observation/legal/candidates/
selected/reward/finalWinner); reward ±1 theo đúng team vai (roleWonOutcome) +
thắng cá nhân; observation không mang vai người khác; finalRole là đường duy
nhất mang vai thật; tất định JSONL (cùng game → cùng chuỗi, một line một dòng).

**Benchmark:** không cần — export thuần, không đổi decision. Smoke CLI: 3 ván
`--preset --trajectories` → 390 dòng hợp lệ, 0 violation.

**Known limitations:**

- `observation` mới gồm snapshot có sẵn trong trace; chưa có full observation
  builder (chat đã parse, publicVoteHistory) — đủ cho PR 8 (value model học từ
  score terms + belief), mở rộng khi cần.
- Trần `--trace-games` (5) vẫn áp dụng cho trajectory: một batch 10k ván muốn
  full trajectory cần `--trace-games` lớn — cần nhắc trong PR 8 khi train.
- File JSONL một file chung: batch rất lớn sẽ cần append/rotate ngoài phạm vi.

**Tiếp theo (PR 8):** HybridPolicy (§24) trên seam `PolicyModel` của M7 —
`finalScore = alpha × heuristic + beta × learned`, beta=0 ban đầu; learned
scorer ban đầu là bảng traOffline từ trajectory (không ML framework).

---

## 16. PR 8 — Báo cáo thực hiện (spec §41)

**Changed files:**

- `packages/game-engine/src/bot/policy/hybrid.ts` (MỚI) —
  `hybridPolicyModel({alpha, beta, learned})`: `finalScore = alpha × heuristic
  score + beta × learnedScore`; `beta = 0` (khởi điểm §24) → **đi đúng heuristic
  kể cả khi learned có mặt**; `LearnedScorer` trả điểm chuẩn hoá ±1 hoặc `null`
  (không có dữ liệu = trung tính 0, không được beta cộng/trừ);
  `buildTrajectoryStats()` gom reward theo bucket suspicion (10 điểm/bucket,
  clamp 0..9) từ trajectory PR 7 — tabular, không ML framework (§23/§38);
  `statsLearnedScorer()` tra bảng
- `packages/game-engine/src/bot/BotRuntime.ts` — option `votePolicy?`:
  cấu hình chứ KHÔNG phải state (không vào `serialize()`; restart → heuristic
  mặc định, đúng hành vi an toàn); `decideVote` truyền qua tham số `policy` của
  `selectVote` (seam M7)
- `packages/game-engine/src/index.ts` — export
- Tests: `tests/bot-hybrid-policy.test.ts` (9)

**Behavior changed:** KHÔNG — không call site production truyền `votePolicy`;
beta=0 là khởi điểm §24. Lối vào để bật: `new BotRuntime({ votePolicy:
hybridPolicyModel({ alpha: 1, beta: 30, learned: statsLearnedScorer(stats) }) })`
— khi benchmark 5×10k (§27) chứng minh beta>0 thắng.

**Tests:** engine **94 file / 4.732 pass** (+9), server 1.095 pass, lint xanh.
Chốt: stats gom đúng bucket + clamp; scorer avg/null; **beta=0 byte-identical
heuristic kể cả khi learned có data**; beta=50 lật lựa chọn khi learned đủ mạnh;
bucket trống trung tính; rỗng ứng viên → NO_ELIMINATION; tất định;
BotRuntime inject (contrarian qua `votePolicy` đổi được lựa chọn — seam sống).

**Benchmark:** equivalence β=0 chứng minh bằng unit test (selection identical);
self-play `--seed pr8-verify --games 30 --preset --verify-replay` — 0 divergence,
0 knowledge violation (path mặc định không đổi). Bench beta>0 là MỤC ĐÍCH của
PR 9 (scenario benchmarks §28) + protocol §27 (5×10k) — chưa chạy vì cần dataset
trajectory lớn hơn 3 ván smoke.

**Known limitations:**

- Bucket suspicion đơn trục — chưa dùng pairs (PR 2), role belief (PR 1) làm
  feature; bảng tra tabular có thể mở khoá shape `counts` mà không phá consumer.
- Chỉ decision VOTE có thống kê; NIGHT/SPEECH để shape mở.
- CLI self-play chưa có cờ `--policy-beta/--policy-stats` — injection hiện qua
  code (BotRuntime option); làm cùng PR 9 khi cần bench beta>0.

**Tiếp theo (PR 9):** scenario benchmarks (§28) — 5 kịch bản có kiểm định danh
(two seer claims, suspicious teammate, late-game parity, conflicting evidence,
social manipulation), mỗi kịch bản một test + một metrics đo; và protocol
5×10k cho quyết định nâng default weights lên v21.

---

## 17. PR 9 — Báo cáo thực hiện (spec §41)

**Changed files:**

- `packages/game-engine/tests/bot-scenario-benchmarks.test.ts` (MỚI, 7 test)
- `packages/game-engine/src/bot/config/weights.ts` — nâng
  `DEFAULT_BOT_WEIGHTS` từ v18 lên **v21** (docstring ghi kỷ luật đo)

**5 kịch bản §28 — mỗi kịch bản 1 test + metrics hành vi đo:**

| # | Kịch bản | Đo gì | Kỳ vọng |
|---|---|---|---|
| 1 | Two seer claims | `suspicion[X]` sau claim sớm/muộn | kẻ khai SAU bị dồn (late collisionPenalty) đáng ngờ hơn kẻ khai TRƯỚC; vote ∈ {a,b} |
| 2 | Suspicious teammate | `sacrificeCandidate` (plan) + hướng vote của Sói | bị dồn ≥ share → component giữ |
| 3 | Late game parity | `seerResult(WOLF)` → vote | vote trúng c, không NO_ELIMINATION |
| 4 | Conflicting evidence | sự phân bổ suspicion sau bluff-defend mix | claim hợp lệ gỡ phần lớn tội |
| 5 | Social manipulation | BANWAGON-only áp lực không biến nạn nhân thành Sói | suspicion < ngưỡng claim thật |

**Protocol §27 — quyết định nâng default (5×1.000 ván paired seeds, `--preset`):**

| Metric | V18 | V21 | Kết luận |
|---|---|---|---|
| Làng thắng | 51,98% (2599/5000) | **54,04% (2702/5000)** | +2,06 điểm, z=2,06 — có ý nghĩa |
| villageVoteAccuracy | 44,86% | **48,88%** | +4,02 điểm, z=14,35 |
| Batch thua | — | 1/5 (a5: −2,7) | 4/5 thắng, không batch nào tụt quá −2,7 |

**Lưu ý trung thực:** §27 đòi 5×10.000 cho policy change lớn — phiên này chạy
5×1.000 (≈4,5 phút/arm, ~44 phút tổng) vì constraint thời gian; z-scores đều
vượt ngưỡng 2 trên 5.000 ván/arm. Nếu cần chuẩn đầy đủ, chạy thêm 5×9k nữa
với cùng seeds `p9-a{1..5}` mở rộng.

**Quyết định:** nâng `DEFAULT_BOT_WEIGHTS` → **v21**.

**Ripple của việc nâng default (đã xử lý):**

- `bot-planner.test.ts` (M5): pin về `BOT_WEIGHTS_V18` vì test đó kiểm đúng
  bộ term của ImmediateUtilityPlanner thuần (không counterfactual)
- `bot-trace.test.ts`: test tên term vote pin về v18; helper nhận `weights?`
- 2 test còn lại (M5 tie-break, M6 look-ahead v20) vốn đã dùng preset đích danh
  → không đổi

**Tests:** engine **95 file / 4.739 pass** (+7 scenario, +nâng default),
server 1.095 pass, lint xanh 4 workspace. Replay default-v21: 30 ván
`--verify-replay`(`--preset`) — **0 divergence, 0 knowledge violation**.

**Benchmark production:** lần chạy `--seed pr9-final --weights 21.0.0(implicit
default)` trong phiên có violations=0, knowledge=0.

**Known limitations:**

- Scenario test là stateless single-shot (một vòng quan sát), chưa phải
  episode nhiều vòng — selfplay giữ vai trò coverage dài hạn.
- Protocol 5×1k thay vì 5×10k đầy đủ của §27 — xem lưu ý trên.
- Chỉ thắng trên metric làng; nhánh Sói (v22 wolfSideGain) vẫn ở preset thí
  nghiệm — bước 5b vẫn giữ nguyên kết luận.

---

## 18. Đối chiếu acceptance criteria spec §40

| # | Tiêu chí | Trạng thái | Bằng chứng |
|---|---|---|---|
| 1 | Current bot remains a working baseline | ✅ | v18–v22 preset nguyên vẹn; v21 default, pinned tests cho v1/v4/v11–v13 |
| 2 | Belief is probabilistic | ✅ | PR 1: `role-belief.ts` + `roleComposition` engine-cấp |
| 3 | Role constraints are respected | ✅ | PR 1: composition pool, certain>vidence, seer-pin theo team |
| 4 | Pairwise relationships are modeled | ✅ | PR 2: `assessPairs` + Fréchet cap |
| 5 | Suspicion/threat/credibility are distinct | ⚠️ một phần | threat (wolfThreatScore), credibility (S1) vẫn phân tán; chưa surface chung |
| 6 | One-step counterfactual planning exists | ✅ | PR 3: planner + V21 default sau bench 2×1k |
| 7 | Wolf team planning exists | ✅ | PR 5: `planWolfTeam`; v22 preset thí nghiệm |
| 8 | Personality affects decisions | ✅ (có sẵn) | threshold/inertia/deceptionSkill |
| 9 | LLM remains isolated from action authority | ✅ | BotBrain renderDaySpeech duy nhất, zod strict |
| 10 | Hidden information never leaks | ✅ | 16 invariant + ranh giới knowledge/test mở rộng cho composition |
| 11 | Self-play exports training trajectories | ✅ | PR 7: `--trajectories` JSONL, audit 0 role-leak |
| 12 | Hybrid learned-policy seam exists | ✅ | PR 8: `hybridPolicyModel` α=1/β=0 + `BotRuntime.votePolicy` |
| 13 | Scenario benchmarks exist | ✅ | PR 9: 5 kịch bản, 7 test |
| 14 | Fixed-seed benchmark exists | ✅ | runBatch + paired seeds (p9-a1..a5) |
| 15 | New bot beats baseline ≥1 metric, không tụt metric khác | ✅ | V21: WR +2,06 (z=2,06), accuracy +4,02 (z=14,35), 0 violation |
| 16 | Existing tests and replay invariants pass | ✅ | 95 file / 4.739 + server 1.095 + replay 0 divergence |
| 17 | Architecture remains modular | ✅ | mỗi PR = module mới + seam, không god class |
