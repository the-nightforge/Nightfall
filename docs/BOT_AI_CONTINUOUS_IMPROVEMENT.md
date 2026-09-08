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
