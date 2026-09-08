import type { PublicVoteChoice } from "@masoi/shared";
import { isolationScore } from "../analysis/coalition";
import { incomingHostilityOf, possibleWolfPairScore } from "../analysis/social-analysis";
import { MAX_BELIEF_SCORE } from "../belief/evidence";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { isHumanTable } from "../knowledge";
import type {
  ActionEvaluation,
  StrategicPlanner,
  StrategyContext,
} from "../planning/planner";
import { immediateUtilityPlanner } from "../planning/planner";
import { counterfactualVotePlanner } from "../planning/counterfactual";
import { projectRoleBeliefs } from "../belief/role-belief";
import type { PolicyModel } from "../policy/policy-model";
import { heuristicPolicyModel } from "../policy/policy-model";
import { strategyFor } from "../roles/registry";
import { fakeFightTarget } from "../roles/werewolf";
import { sumTerms, type DecisionProbe, type TraceTerm } from "../trace/trace";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotPersonality,
  BotRng,
  BotVoteIntention,
} from "../types";

/**
 * Mức cấp bách, 0 khi chưa ai chết và tiến tới 1 khi làng gần hết.
 *
 * Dùng `players` (gồm cả người chết) làm mẫu số nên BOT không cần biết sĩ số
 * ban đầu từ đâu khác.
 */
/**
 * Những người BOT được phép CHẤM ĐIỂM.
 *
 * `legalVoteChoices` trả lời câu hỏi "tôi được nộp lá phiếu nào NGAY BÂY GIỜ",
 * và engine chỉ khác rỗng trong pha `VOTING`. Dùng thẳng nó làm nguồn ứng viên
 * khiến BOT không có ý kiến nào trong pha thảo luận: danh sách rỗng, không ai
 * được chấm điểm, và mọi BOT kết luận "không treo ai" rồi nói đúng một câu
 * "chưa đủ căn cứ" - suốt cả ván.
 *
 * Hai câu hỏi khác nhau nên có hai nguồn khác nhau:
 * - Đang bỏ phiếu: bám ĐÚNG danh sách engine cấp, không được nới.
 * - Ngoài pha đó: không có gì để nộp, nhưng vẫn cần một ý kiến để nói. Chấm
 *   điểm mọi người còn sống là an toàn vì không lá phiếu nào rời khỏi hàm này.
 */
function candidatesFor(
  knowledge: BotDecisionContext["knowledge"],
  selfId: string,
  aliveIds: readonly string[],
): string[] {
  // Phân biệt hai trạng thái KHÁC NHAU, cả hai đều cho ra danh sách người rỗng:
  //   - engine không cấp lựa chọn nào  → chưa tới lượt nộp phiếu (thảo luận)
  //   - engine có cấp nhưng không ai hợp lệ → đang bỏ phiếu và phải bỏ trắng
  // Gộp chúng lại sẽ khiến BOT nêu tên người trong một pha mà luật đã nói là
  // không được chọn ai.
  if (knowledge.legalVoteChoices.length > 0) {
    return knowledge.legalVoteChoices.flatMap((choice) =>
      choice.type === "PLAYER" ? [choice.targetId] : [],
    );
  }

  // Người chết không có ý kiến. `aliveIds` gồm cả chính mình; vòng lặp gọi hàm
  // này đã tự loại `selfId`, nhưng loại sẵn ở đây để danh sách nói đúng nghĩa.
  const self = knowledge.players.find((player) => player.id === selfId);
  if (!self?.alive) return [];

  return aliveIds.filter((id) => id !== selfId);
}

function survivalPressure(knowledge: BotDecisionContext["knowledge"]): number {
  const total = knowledge.players.length;
  if (total === 0) return 0;
  const alive = knowledge.players.filter((player) => player.alive).length;
  return clampUnit(1 - alive / total);
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Cuộc cãi giả dùng `bussingJoinBonus` ở mức này, không dùng trọn.
 *
 * Trọn (120 x voteShare) là để NHẢY LÊN một chuyến xe đang lăn; cãi giả không
 * có chuyến xe nào. 0.3 x 120 = 36: thắng được `trustDamping` (-20) của một
 * đồng bọn bị ghim trust 100 khi bàn còn phẳng, thua một người đang bị cả bàn
 * công kích - đúng như một lời nghi "cho có" giữa hai người chưa ai để ý.
 */
const FAKE_FIGHT_JOIN_SCALE = 0.3;

/**
 * Ngưỡng tối thiểu để dám đề cử ai đó. Người hung hăng và người chịu rủi ro
 * cao hạ ngưỡng này xuống, nhưng không ai xuống dưới ~48 ở cấu hình mặc định.
 */
export function voteThreshold(
  personality: BotPersonality,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): number {
  return (
    weights.aggression.thresholdBase -
    personality.aggressiveness * weights.aggression.aggressivenessSpan -
    personality.riskTolerance * weights.aggression.riskSpan
  );
}

/**
 * Khoảng cách tối thiểu để bỏ mục tiêu đang bầu và chuyển sang người khác.
 *
 * `spokenLines` là số câu mục tiêu ĐANG BẦU đã nói trong vòng này (xem
 * `linesSpokenThisRound`); từ `talkerHysteresisLines` trở lên thì cộng
 * `talkerHysteresisBonus`. Bonus là 0 ở v1..v16 nên caller cũ không đổi gì.
 */
export function voteHysteresis(
  personality: BotPersonality,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
  spokenLines = 0,
  freshlyExculpated = false,
): number {
  // `freshlyExculpated`: mục tiêu vừa có bằng chứng gỡ tội mới trong vòng (xem
  // `hasFreshExculpation`). Khi đó bonus "nói nhiều" bị nhân
  // `talkerHysteresisExculpatedScale` - 1 ở v1..v17, 0 ở v18.
  const talker =
    weights.confidence.talkerHysteresisBonus > 0 &&
    spokenLines >= weights.confidence.talkerHysteresisLines
      ? weights.confidence.talkerHysteresisBonus *
        (freshlyExculpated ? weights.confidence.talkerHysteresisExculpatedScale : 1)
      : 0;
  return (
    weights.confidence.hysteresisBase +
    personality.stubbornness * weights.confidence.hysteresisStubbornSpan +
    talker
  );
}

/** Memory sinh từ một câu chat. Xem `analyzeChat`. */
const CHAT_MEMORY_TYPES: ReadonlySet<BotBrainState["memories"][number]["type"]> = new Set([
  "ACCUSE",
  "DEFEND",
  "ROLE_CLAIM",
  "COUNTER_CLAIM",
  "DIRECT_ADDRESS",
  "DIRECT_QUESTION",
]);

/**
 * Số CÂU một người đã nói trong vòng này, theo những gì bot nghe hiểu được.
 *
 * Đếm theo `sourceId` (message) chứ không theo memory: một câu "Tôi nghi An,
 * đúng không An?" sinh cả ACCUSE lẫn DIRECT_QUESTION và vẫn là một câu.
 * Không thêm state: `visibleChat` không mang số vòng, còn memory thì có, và
 * mọi câu parser hiểu được đều đã thành memory ở `ingestChat`.
 */
export function linesSpokenThisRound(
  state: BotBrainState,
  playerId: string,
  round: number,
): number {
  const messages = new Set<string>();
  for (const memory of state.memories) {
    if (memory.actorId !== playerId || memory.round !== round) continue;
    if (!CHAT_MEMORY_TYPES.has(memory.type)) continue;
    messages.add(memory.sourceId);
  }
  return messages.size;
}

/**
 * Người này vừa nhận được bằng chứng GỠ TỘI mới trong vòng này chưa?
 *
 * "Gỡ tội" = một `reason` weight âm trong `suspicion[playerId]`, sinh ở đúng
 * vòng hiện tại: họ khai một vai quyền lực (`claimant` của claim-credibility),
 * có người công khai bênh (`DEFEND`), hay một tín hiệu khác kéo nghi ngờ xuống.
 * Đọc từ chính bảng belief thay vì đoán lại từ chat: đó là nơi mọi bằng chứng
 * đã đi qua `applyEvidence`, và cũng là lý do duy nhất mà bot "đổi ý" có căn
 * cứ. Ba câu "tôi là dân" không tạo ra reason âm nào, nên không tính.
 */
export function hasFreshExculpation(
  state: BotBrainState,
  playerId: string,
  round: number,
): boolean {
  return (state.suspicion[playerId]?.reasons ?? []).some(
    (reason) => reason.weight < 0 && reason.round === round,
  );
}

/**
 * Social graph chỉ được phép bổ sung suspicion, không kết luận role: điểm cặp
 * đôi được nhân với mức nghi ngờ đã có bằng chứng của người kia, nên một cặp
 * mà cả hai đều sạch sẽ không tự sinh ra nghi ngờ.
 */
function pairPressure(
  state: BotBrainState,
  targetId: string,
  weights: BotWeights,
): number {
  let best = 0;
  for (const otherId of Object.keys(state.suspicion).sort()) {
    if (otherId === targetId) continue;
    const other = state.suspicion[otherId];
    if (!other || other.reasons.length === 0) continue;
    best = Math.max(
      best,
      possibleWolfPairScore(state, targetId, otherId, weights) *
        (other.score / MAX_BELIEF_SCORE),
    );
  }
  return best;
}

interface ScoredTarget {
  targetId: string;
  score: number;
  evidence: BotEvidence[];
  topConfidence: number;
}

function noEliminationIntention(confidence: number): BotVoteIntention {
  return {
    kind: "VOTE",
    choice: { type: "NO_ELIMINATION" },
    confidence: clampUnit(confidence),
    evidence: [],
  };
}

/**
 * Chấm điểm MỘT ứng viên phiếu — scorer mà `ImmediateUtilityPlanner` bọc lại.
 *
 * Tách khỏi vòng lặp của `selectVote` để seam `StrategicPlanner` có một hàm
 * thuần để trỏ vào: cùng một bảng term, cùng lệ rút jitter (MỘT số cho mỗi ứng
 * viên), cùng thứ tự cộng. Hàm KHÔNG quyết định winner, không biết ngưỡng hay
 * hysteresis — mọi thứ sau bảng điểm vẫn thuộc `selectVote`.
 *
 * Các đại lượng dùng chung cả bảng (bias của vai, `fightTarget`, `bussingShare`)
 * được tính sẵn trong `selectVote` rồi bó vào closure: planner không cần biết
 * chúng tồn tại.
 */
/**
 * Khung dữ liệu dùng-chung-cả-bảng mà `scoreVoteCandidate` cần. Tính MỘT lần
 * cho cả lượt chấm (`deriveVoteScoringFrame`) thay vì mỗi ứng viên một lần.
 */
export interface VoteScoringFrame {
  weights: BotWeights;
  aliveIds: string[];
  roleBias: Record<string, number>;
  /** Ứng viên Sói cùng số hạng wolf tương ứng (bussing / cãi giả / bảo vệ). */
  wolfBranches: Map<string, TraceTerm>;
  /** Cãi giả vòng này; cổng "không treo khi bằng chứng mỏng" cần nó. */
  fightTarget: string | null;
}

export function deriveVoteScoringFrame(
  context: BotDecisionContext,
  state: BotBrainState,
  weights: BotWeights,
): VoteScoringFrame {
  const knowledge = context.knowledge;
  const personality = state.personality;
  const selfIsWolf =
    knowledge.knownRoles[state.playerId] === "WEREWOLF" ||
    knowledge.knownRoles[state.playerId] === "WOLF_CUB";

  // Hiểu biết riêng của vai, do chính strategy của vai đó cấp. Tách khỏi vòng
  // lặp chấm điểm để `selectVote` không phải biết vai nào tồn tại.
  const bias = strategyFor(knowledge.selfRole, weights).voteBias(context, state);
  // Đồng bọn mà con Sói này cãi giả vòng này; `null` ở mọi vai khác và ở mọi
  // preset có `fakeFightChance = 0`. Xem `fakeFightTarget` - không rút RNG.
  const fightTarget = selfIsWolf ? fakeFightTarget(context, state, weights) : null;
  // Người thật dồn phiếu nhanh hơn bot, nên Sói phải bán sớm hơn một nhịp.
  // Hai ngưỡng bằng nhau ở v1..v15.
  const bussingShare = isHumanTable(knowledge, weights)
    ? weights.deceptionRisk.bussingVoteShareHuman
    : weights.deceptionRisk.bussingVoteShare;

  const aliveIds = knowledge.players.filter((p) => p.alive).map((p) => p.id);
  const roleBias: Record<string, number> = { ...bias };
  const wolfBranches = new Map<string, TraceTerm>();

  for (const targetId of candidatesFor(knowledge, state.playerId, aliveIds)) {
    if (targetId === state.playerId) continue;

    const targetRole = knowledge.knownRoles[targetId];
    const targetIsWolf = targetRole === "WEREWOLF" || targetRole === "WOLF_CUB";
    if (!(selfIsWolf && targetIsWolf)) continue;

    /**
     * Bảo vệ đồng đội, TRỪ KHI cả làng đã dồn phiếu vào người đó.
     *
     * Đứng ra che một đồng bọn mà đa số đã chỉ vào là hành vi tự tố cáo: nó
     * không cứu được ai - một lá phiếu không lật được đa số - và nó ghép tên
     * mình vào tên người sắp bị treo. Nước rẻ nhất là bỏ phiếu cùng cả làng và
     * giữ lấy vỏ bọc.
     *
     * Đo bằng ÁP LỰC CÔNG KHAI chứ không phải nghi ngờ của chính con Sói:
     * `applyPrivateInformation` ghim suspicion của đồng đội về 0, nên một cổng
     * dựa trên belief riêng không bao giờ mở.
     *
     * `deceptionSkill` là hệ số vì đây là một nước đi CẦN DIỄN: Sói vụng sẽ lộ
     * ra là đang tính toán. Trước Phase 3, trait này được sinh ra rồi không file
     * nào đọc.
     */
    const votesAgainstTarget = knowledge.currentVoteCounts.players[targetId] ?? 0;
    const voteShare = votesAgainstTarget / Math.max(1, aliveIds.length);
    const willBus =
      voteShare >= bussingShare &&
      personality.deceptionSkill * weights.deceptionRisk.bussingDeceptionScale >= 1;
    const willFight = targetId === fightTarget;

    if (willBus) {
      // Nhảy lên chuyến xe đang lăn. Gỡ phạt thôi là chưa đủ: đồng đội có
      // suspicion bằng 0 trong mắt chính con Sói, nên không gì đẩy nó lên
      // đầu bảng. Bussing thật là *bỏ phiếu cùng đa số*.
      wolfBranches.set(targetId, {
        name: "bussingJoin",
        value: voteShare * weights.deceptionRisk.bussingJoinBonus,
      });
    } else if (willFight) {
      // Cãi giả: cùng cơ chế nhưng không có chuyến xe nào, nên chỉ một
      // phần. Xem `FAKE_FIGHT_JOIN_SCALE`.
      wolfBranches.set(targetId, {
        name: "fakeFight",
        value: FAKE_FIGHT_JOIN_SCALE * weights.deceptionRisk.bussingJoinBonus,
      });
    } else {
      wolfBranches.set(targetId, {
        name: "teammateProtection",
        value: -(
          weights.teammateProtection.penaltyBase +
          personality.loyalty * weights.teammateProtection.loyaltySpan
        ),
      });
    }

    // Bỏ luôn bias của vai khi đã quyết hy sinh: `voteBias` của Sói đẩy -100
    // vào mỗi đồng bọn, và một số hạng lớn thế sẽ nuốt chửng mọi thứ khác.
    if (willBus || willFight) roleBias[targetId] = 0;
  }

  return { weights, aliveIds, roleBias, wolfBranches, fightTarget };
}

/**
 * Chấm điểm MỘT ứng viên phiếu — scorer mà `ImmediateUtilityPlanner` bọc lại.
 *
 * Tách khỏi vòng lặp của `selectVote` để seam `StrategicPlanner` có một hàm
 * thuần để trỏ vào: cùng một bảng term, cùng lệ rút jitter (MỘT số cho mỗi ứng
 * viên), cùng thứ tự cộng. Hàm KHÔNG quyết định winner, không biết ngưỡng hay
 * hysteresis — mọi thứ sau bảng điểm vẫn thuộc `selectVote`.
 *
 * `frame` không cấp thì tự suy với trọng số mặc định: đủ cho script và test;
 * `selectVote` cấp frame tính sẵn để dùng đúng weights của lượt gọi.
 */
export function scoreVoteCandidate(
  targetId: string,
  plannerContext: StrategyContext<VoteScoringFrame>,
): ActionEvaluation {
  const { context, state, rng } = plannerContext;
  const frame =
    plannerContext.frame ??
    deriveVoteScoringFrame(context, state, DEFAULT_BOT_WEIGHTS);

  const belief = state.suspicion[targetId];
  const reasons = belief?.reasons ?? [];
  const topConfidence = reasons.reduce((max, item) => Math.max(max, item.confidence), 0);

  const terms: TraceTerm[] = [
    { name: "belief", value: belief?.score ?? 0 },
    {
      name: "evidenceConfidence",
      value: topConfidence * frame.weights.suspicion.evidenceConfidenceBonus,
    },
    {
      name: "hostility",
      value: incomingHostilityOf(state, targetId) * frame.weights.suspicion.hostilityBonus,
    },
    {
      name: "pairPressure",
      value: pairPressure(state, targetId, frame.weights) * frame.weights.suspicion.pairBonus,
    },
    {
      name: "trustDamping",
      value: -((state.trust[targetId]?.score ?? 0) * frame.weights.trust.damping),
    },
    { name: "roleBias", value: frame.roleBias[targetId] ?? 0 },
    {
      name: "isolation",
      value:
        isolationScore(state, targetId, frame.aliveIds) *
        frame.weights.suspicion.isolationBonus,
    },
  ];

  const branch = frame.wolfBranches.get(targetId);
  if (branch) terms.push(branch);

  terms.push({ name: "jitter", value: (rng() - 0.5) * frame.weights.confidence.jitterSpan });

  const score = sumTerms(terms);
  const evidence = reasons.slice(-frame.weights.limits.intentionEvidence);
  return { score, terms, confidence: topConfidence, evidence };
}

/**
 * Look-ahead MỘT BƯỚC cho bảng điểm phiếu (spec BOT_AI_UPGRADE §12).
 *
 * Bảng điểm myopic chỉ trả lời "người này đáng treo ra sao NGAY BÂY GIỜ". Số
 * hạng `futureRisk` trả lời câu kế tiếp: "treo người này, NẾU họ vô tội, pha
 * sau làng trả giá bao nhiêu?". Công thức, thuần và chỉ đọc dữ liệu CÔNG KHAI
 * + belief của chính bot:
 *
 *   futureRisk = −scale x (1 − P(Sói)) x (áp lực sĩ số + khan hiếm bằng chứng)
 *
 * - `1 − P(Sói)`: belief là thang 0..100 tích luỹ bằng chứng, không phải xác
 *   suất; dùng `1 − belief/100` làm proxy heuristic của P(vô tội) — đúng tinh
 *   thần "heuristic Bayesian-like" của spec §6. Ứng viên có kết quả soi ghim
 *   (belief 0 hoặc 100) đã được xử đúng: ghim 100 → phạt 0, ghim 0 → phạt tối
 *   đa, tức làng tự tránh treo nhầm người đã được xác nhận trong sạch.
 * - áp lực sĩ số: dùng lại ĐÚNG `survivalPressure` của cổng abstain — cùng một
 *   phép đo cho cùng một câu hỏi "làng còn bao nhiêu mạng để tiêu".
 * - khan hiếm bằng chứng: trong những người sống khác (trừ mình và ứng viên),
 *   bao nhiêu phần trăm có bảng belief TRỐNG. Làng sắp hết người có dữ liệu
 *   thì một lá phiếu bám jitter càng đắt cho các vòng sau.
 *
 * Sói (WEREWOLF/WOLF_CUB) chỉ nhận thưởng `wolfMislynchGain` — 0 ở v20 — nên
 * bảng điểm Sói không đổi một bit so với v18. Nhánh làng không được phép nhận
 * thưởng (chỉ phạt): "treo nhầm là có lợi" không phải một suy luận mà làng
 * được phép tính.
 */
export function voteFutureRisk(
  targetId: string,
  ctx: StrategyContext<VoteScoringFrame>,
): number {
  const frame = ctx.frame;
  if (!frame) return 0;
  const lookAhead = frame.weights.lookAhead;
  if (!lookAhead) return 0;

  const knowledge = ctx.context.knowledge;
  const selfRole = knowledge.knownRoles[ctx.state.playerId];
  const selfIsWolf = selfRole === "WEREWOLF" || selfRole === "WOLF_CUB";

  const belief = ctx.state.suspicion[targetId]?.score ?? 0;
  const innocentProb = clampUnit(1 - belief / MAX_BELIEF_SCORE);
  const pressure = survivalPressure(knowledge);

  if (selfIsWolf) {
    return lookAhead.wolfMislynchGain * innocentProb * pressure;
  }

  const others = frame.aliveIds.filter(
    (id) => id !== ctx.state.playerId && id !== targetId,
  );
  let bearing = 0;
  for (const id of others) {
    if ((ctx.state.suspicion[id]?.reasons.length ?? 0) > 0) bearing += 1;
  }
  const scarcity = others.length === 0 ? 0 : 1 - bearing / others.length;

  return -(
    innocentProb *
    (lookAhead.mislynchPressureScale * pressure +
      lookAhead.mislynchScarcityScale * scarcity)
  );
}

/**
 * Planner look-ahead: bọc planner immediate-utility và cộng thêm số hạng
 * `futureRisk` vào cuối bảng điểm. Không rút RNG (rủi ro tương lai là một phép
 * suy tất định từ belief hiện có), nên stream RNG của bot giữ nguyên.
 *
 * `risk === 0` (Sói ở v20, hoặc nhóm vắng) trả nguyên evaluation gốc — wrapper
 * không thay gì, kể cả thứ tự term.
 */
export function lookAheadVotePlanner(
  base: StrategicPlanner<VoteScoringFrame>,
): StrategicPlanner<VoteScoringFrame> {
  return {
    name: "look-ahead-v1",
    evaluate(candidate, ctx) {
      const baseEvaluation = base.evaluate(candidate, ctx);
      const risk = voteFutureRisk(candidate, ctx);
      if (risk === 0) return baseEvaluation;
      const terms = [...baseEvaluation.terms, { name: "futureRisk", value: risk }];
      return { ...baseEvaluation, terms, score: sumTerms(terms) };
    },
  };
}

/**
 * Chấm điểm mọi lựa chọn hợp lệ rồi trả về một ý định có bằng chứng thật.
 *
 * Hàm này thuần: cùng context, cùng state và cùng RNG thì cùng kết quả. Nó
 * không bao giờ nhận `GameState` hay `Room`, và không bao giờ bịa ra một mục
 * tiêu không nằm trong `legalVoteChoices` mà engine đã cấp.
 */
export function selectVote(
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
  probe?: DecisionProbe,
  policyParam?: PolicyModel<VoteScoringFrame>,
): BotVoteIntention {
  const knowledge = context.knowledge;
  const personality = state.personality;
  const selfIsWolf =
    knowledge.knownRoles[state.playerId] === "WEREWOLF" ||
    knowledge.knownRoles[state.playerId] === "WOLF_CUB";
  /**
   * Mất đồng đội thì bớt đẩy phiếu lộ liễu.
   *
   * Một con Sói vừa mất bạn mà vẫn hăng hái chỉ mặt người khác là con Sói dễ bị
   * để ý nhất trên bàn: cả làng vừa treo đúng một người, và ai lớn tiếng nhất
   * ngay sau đó sẽ được soi kỹ. Nâng ngưỡng lên tức là im lặng nhiều hơn.
   */
  const lostAlly = state.memories.some((memory) => memory.type === "ALLY_LOST");
  const threshold =
    voteThreshold(personality, weights) +
    (lostAlly && selfIsWolf ? weights.deceptionRisk.allyLostThresholdBonus : 0);

  // Tầng counterfactual, CHỈ MỘT LỚP tại một thời điểm:
  // v21+ (`counterfactual`) thay v20 (`lookAhead`) thay immediate.
  // Bảng belief PR 1 chỉ tính khi lớp counterfactual thật sự bật.
  const basePlanner: StrategicPlanner<VoteScoringFrame> =
    immediateUtilityPlanner(scoreVoteCandidate);
  const frame = deriveVoteScoringFrame(context, state, weights);
  const planner = weights.counterfactual
    ? counterfactualVotePlanner(
        basePlanner,
        projectRoleBeliefs({ knowledge, state, roleComposition: knowledge.roleComposition }),
      )
    : weights.lookAhead
      ? lookAheadVotePlanner(basePlanner)
      : basePlanner;
  const plannerContext: StrategyContext<VoteScoringFrame> = {
    context,
    state,
    rng,
    frame,
  };

  const scored: ScoredTarget[] = candidatesFor(
    knowledge,
    state.playerId,
    knowledge.players.filter((p) => p.alive).map((p) => p.id),
  )
    // Engine cho phép tự bầu mình, nhưng một BOT tự đề cử mình là hành vi vô
    // nghĩa; luật vẫn được báo cáo trung thực ở knowledge view.
    .filter((targetId) => targetId !== state.playerId)
    .map((targetId) => {
    const evaluation = planner.evaluate(targetId, plannerContext);
    if (probe) {
      probe.candidate({
        targetId,
        score: evaluation.score,
        terms: evaluation.terms,
        evidenceIds: evaluation.evidence.map((item) => item.id),
      });
    }
    return {
      targetId,
      score: evaluation.score,
      evidence: evaluation.evidence,
      topConfidence: evaluation.confidence,
    };
  });

  // Sắp xếp có tie-break theo id để hai lần chạy giống hệt nhau không phụ thuộc
  // thứ tự chèn của bảng belief.
  scored.sort((left, right) =>
    right.score === left.score
      ? left.targetId.localeCompare(right.targetId)
      : right.score - left.score,
  );

  // Seam `PolicyModel` (spec §27): mặc định là heuristic argmax — cùng người
  // thắng mà sort phía trên từng chọn. Model khác (RL sau này) cắm qua tham số
  // `policy` mà không đổi call sites; `null` từ model = chủ động không chọn ai.
  const policy = policyParam ?? heuristicPolicyModel<VoteScoringFrame>();
  const decision = policy.selectAction(scored, plannerContext, probe);

  const best = scored[0];
  if (!best) {
    probe?.fallback("không có ứng viên hợp lệ nào để chấm điểm");
    return noEliminationIntention(1);
  }
  if (decision.targetId === null) {
    return noEliminationIntention(1);
  }
  let winner =
    decision.targetId === best.targetId
      ? best
      : (scored.find((item) => item.targetId === decision.targetId) ?? best);
  const myVote = knowledge.myVote;
  if (myVote && myVote.type === "PLAYER") {
    const current = scored.find((item) => item.targetId === myVote.targetId);
    const currentQualifies =
      current !== undefined && current.evidence.length > 0 && current.score >= threshold;
    // Dính hơn trước một người đang nói nhiều: xem `talkerHysteresisBonus`.
    // Trừ khi họ vừa đưa ra được điều gì gỡ tội - xem `hasFreshExculpation`.
    const spoken = linesSpokenThisRound(state, myVote.targetId, knowledge.round);
    const exculpated = hasFreshExculpation(state, myVote.targetId, knowledge.round);
    if (
      currentQualifies &&
      winner.targetId !== current.targetId &&
      winner.score < current.score + voteHysteresis(personality, weights, spoken, exculpated)
    ) {
      winner = current;
    }
  }
  // Một mục tiêu dẫn đầu chỉ nhờ jitter mà không có lý do nào thì không đáng
  // để treo: BOT chọn không treo thay vì bịa một cáo buộc không nguồn.
  //
  // NHƯNG chỉ trong lúc làng còn đủ người để chịu đựng một ngày không treo ai.
  // Xem `survivalPressure`: không treo ai mỗi ngày là thua chắc chắn, nên quy
  // tắc "không có bằng chứng thì không treo" phải nhường chỗ khi làng đã mỏng.
  // "Không treo ai" KHÔNG phải một nước trung lập: nó tiêu một ngày của làng và
  // không tốn gì của Sói, trong khi mỗi đêm làng vẫn mất một người. Treo một
  // người đáng ngờ nhất có xác suất trúng Sói bằng `số Sói / số còn sống`;
  // không treo có xác suất bằng 0.
  //
  // Vì vậy chỉ phe Sói mới được phép chọn nó khi bằng chứng còn mỏng, và cũng
  // chỉ khi làng còn đủ đông để chưa ai thấy sốt ruột.
  const pressure = survivalPressure(knowledge);
  const abstainHelpsMyTeam =
    selfIsWolf && pressure < weights.deceptionRisk.abstainPressureCeiling;

  // Phe làng có cổng RIÊNG và hẹp hơn: chỉ khi ứng viên dẫn đầu không mang nổi
  // một mẩu bằng chứng nào. "Dưới ngưỡng" KHÔNG mở cổng này - xem
  // `villageAbstainPressureCeiling` cho lý do đầy đủ. Nêu tên một người mà
  // bảng belief hoàn toàn trống không phải một nước cờ mỏng, nó là jitter được
  // đọc thành cáo buộc, và nó đầu độc `vote-analysis` của cả bàn.
  const villageAbstains =
    !selfIsWolf &&
    winner.evidence.length === 0 &&
    pressure < weights.aggression.villageAbstainPressureCeiling;

  // Cuộc cãi giả CỐ Ý không có bằng chứng - đồng bọn bị ghim suspicion 0 nên
  // không có lý do nào để mang - và nó phải ra tới lá phiếu, nếu không lời
  // "tôi thấy anh hơi lạ" chưa bao giờ được nói. `fightTarget` chỉ khác null
  // khi đã qua mọi cổng ở `fakeFightTarget`, nên đây không mở đường cho một
  // lá phiếu vô căn cứ nào khác.
  const isFakeFight = winner.targetId === frame.fightTarget;

  if (
    villageAbstains ||
    (abstainHelpsMyTeam &&
      !isFakeFight &&
      (winner.score < threshold || winner.evidence.length === 0))
  ) {
    probe?.fallback(
      winner.evidence.length === 0
        ? `dẫn đầu ${winner.targetId} không có bằng chứng nào và làng còn đủ đông`
        : `điểm cao nhất ${winner.score.toFixed(2)} dưới ngưỡng ${threshold.toFixed(2)}`,
    );
    return noEliminationIntention((threshold - best.score) / Math.max(1, threshold));
  }

  const normalized = clampUnit(
    (winner.score - threshold) / Math.max(1, MAX_BELIEF_SCORE - threshold),
  );
  const choice: PublicVoteChoice = { type: "PLAYER", targetId: winner.targetId };
  return {
    kind: "VOTE",
    choice,
    confidence: clampUnit((normalized + winner.topConfidence) / 2),
    evidence: winner.evidence.map((item) => ({ ...item })),
  };
}
