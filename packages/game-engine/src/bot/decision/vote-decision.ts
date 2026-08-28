import type { PublicVoteChoice } from "@masoi/shared";
import { isolationScore } from "../analysis/coalition";
import { incomingHostilityOf, possibleWolfPairScore } from "../analysis/social-analysis";
import { MAX_BELIEF_SCORE } from "../belief/evidence";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { strategyFor } from "../roles/registry";
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

/** Khoảng cách tối thiểu để bỏ mục tiêu đang bầu và chuyển sang người khác. */
export function voteHysteresis(
  personality: BotPersonality,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): number {
  return (
    weights.confidence.hysteresisBase +
    personality.stubbornness * weights.confidence.hysteresisStubbornSpan
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
): BotVoteIntention {
  const knowledge = context.knowledge;
  const personality = state.personality;
  const selfIsWolf =
    knowledge.knownRoles[state.playerId] === "WEREWOLF" ||
    knowledge.knownRoles[state.playerId] === "WOLF_CUB";
  const threshold = voteThreshold(personality, weights);

  // Hiểu biết riêng của vai, do chính strategy của vai đó cấp. Tách khỏi vòng
  // lặp chấm điểm để `selectVote` không phải biết vai nào tồn tại.
  const bias = strategyFor(knowledge.selfRole, weights).voteBias(context, state);
  const aliveIds = knowledge.players.filter((p) => p.alive).map((p) => p.id);

  const scored: ScoredTarget[] = [];
  for (const targetId of candidatesFor(knowledge, state.playerId, aliveIds)) {
    // Engine cho phép tự bầu mình, nhưng một BOT tự đề cử mình là hành vi vô
    // nghĩa; luật vẫn được báo cáo trung thực ở knowledge view.
    if (targetId === state.playerId) continue;

    const belief = state.suspicion[targetId];
    const reasons = belief?.reasons ?? [];
    const topConfidence = reasons.reduce((max, item) => Math.max(max, item.confidence), 0);

    // Điểm được cộng theo TỪNG SỐ HẠNG chứ không phải một biểu thức dài. Thứ tự
    // cộng giữ nguyên nên kết quả giống hệt từng bit (xem `sumTerms`), nhưng giờ
    // mỗi đóng góp có tên - và đó là toàn bộ nội dung của một lời giải thích.
    const terms: TraceTerm[] = [
      { name: "belief", value: belief?.score ?? 0 },
      {
        name: "evidenceConfidence",
        value: topConfidence * weights.suspicion.evidenceConfidenceBonus,
      },
      {
        name: "hostility",
        value: incomingHostilityOf(state, targetId) * weights.suspicion.hostilityBonus,
      },
      {
        name: "pairPressure",
        value: pairPressure(state, targetId, weights) * weights.suspicion.pairBonus,
      },
      {
        name: "trustDamping",
        value: -((state.trust[targetId]?.score ?? 0) * weights.trust.damping),
      },
      { name: "roleBias", value: bias[targetId] ?? 0 },
      // Người bị cả làng dồn vào mà không ai bênh thì dễ bị treo; đó vừa là tín
      // hiệu (có thể họ đã lộ), vừa là cái bẫy (đám đông có khi đang sai).
      // Trọng số nhỏ có chủ đích: nó không được tự mình đẩy ai qua ngưỡng.
      {
        name: "isolation",
        value: isolationScore(state, targetId, aliveIds) * weights.suspicion.isolationBonus,
      },
    ];

    const targetRole = knowledge.knownRoles[targetId];
    const targetIsWolf = targetRole === "WEREWOLF" || targetRole === "WOLF_CUB";
    if (selfIsWolf && targetIsWolf) {
      terms.push({
        name: "teammateProtection",
        value: -(
          weights.teammateProtection.penaltyBase +
          personality.loyalty * weights.teammateProtection.loyaltySpan
        ),
      });
    }

    terms.push({ name: "jitter", value: (rng() - 0.5) * weights.confidence.jitterSpan });

    const score = sumTerms(terms);
    const evidence = reasons.slice(-weights.limits.intentionEvidence);

    if (probe) {
      probe.candidate({
        targetId,
        score,
        terms,
        evidenceIds: evidence.map((item) => item.id),
      });
    }

    scored.push({ targetId, score, evidence, topConfidence });
  }

  // Sắp xếp có tie-break theo id để hai lần chạy giống hệt nhau không phụ thuộc
  // thứ tự chèn của bảng belief.
  scored.sort((left, right) =>
    right.score === left.score
      ? left.targetId.localeCompare(right.targetId)
      : right.score - left.score,
  );

  const best = scored[0];
  if (!best) {
    probe?.fallback("không có ứng viên hợp lệ nào để chấm điểm");
    return noEliminationIntention(1);
  }

  let winner = best;
  const myVote = knowledge.myVote;
  if (myVote && myVote.type === "PLAYER") {
    const current = scored.find((item) => item.targetId === myVote.targetId);
    const currentQualifies =
      current !== undefined && current.evidence.length > 0 && current.score >= threshold;
    if (
      currentQualifies &&
      winner.targetId !== current.targetId &&
      winner.score < current.score + voteHysteresis(personality, weights)
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

  if (abstainHelpsMyTeam && (winner.score < threshold || winner.evidence.length === 0)) {
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
