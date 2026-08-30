import type {
  BotBrainState,
  BotDecisionContext,
  BotNightIntention,
  BotRng,
} from "../types";
import type { Role } from "@masoi/shared";
import { incomingHostilityOf } from "../analysis/social-analysis";
import { MAX_BELIEF_SCORE } from "../belief/evidence";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { sumTerms, type TraceTerm } from "../trace/trace";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

/** Vai có thể lật ngược ván đấu nếu sống thêm một đêm. */
const POWER_ROLES = new Set(["SEER", "WITCH", "GUARD", "HUNTER"]);

/**
 * Sói chọn nạn nhân theo mức NGUY HIỂM với phe Sói, không theo mức đáng ngờ.
 *
 * Đây là chỗ dễ sai nhất khi tái dùng lõi ban ngày: `suspicion` đo "ai giống
 * Sói", mà Sói thì đã biết ai là Sói rồi. Cắn người đang bị cả làng nghi là
 * lãng phí gấp đôi - làng sẽ tự treo người đó vào hôm sau, còn Sói thì mất một
 * đêm để giết một người vô hại với mình.
 */
function threatScore(
  state: BotBrainState,
  context: BotDecisionContext,
  targetId: string,
  weights: BotWeights,
): { score: number; reason: string } {
  const tuning = weights.roleThresholds;
  const claim = state.claims.find(
    (memory) =>
      memory.actorId === targetId &&
      memory.type === "ROLE_CLAIM" &&
      POWER_ROLES.has(String(memory.data.role)),
  );
  if (claim) {
    return {
      score: tuning.wolfClaimedPowerScore,
      reason: `tự nhận là ${String(claim.data.role)} nên phải chết trước`,
    };
  }

  // Người nói nhiều và được người khác đi theo là người lái được cuộc bỏ phiếu.
  const influence = incomingHostilityOf(state, targetId);
  const suspicion = state.suspicion[targetId]?.score ?? 0;
  const trust = state.trust[targetId]?.score ?? 0;

  return {
    // Trừ suspicion: làng đang nghi sẵn thì để làng tự xử.
    score:
      tuning.wolfThreatBase +
      trust * tuning.wolfTrustWeight +
      influence * tuning.wolfHostilityWeight -
      suspicion * tuning.wolfSuspicionDiscount,
    reason: "được làng tin nên nguy hiểm với phe Sói",
  };
}

/**
 * `role` là tham số vì Sói Con dùng ĐÚNG chiến lược này: nó cắn cùng bầy, và
 * cơ chế "chết thì bầy được cắn hai" nằm ở engine chứ không ở lựa chọn của nó.
 * Truyền vai vào thay vì hard-code giữ cho `strategyFor(r).role === r` luôn đúng.
 */
export function werewolfStrategy(
  role: Role = "WEREWOLF",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  return {
    role,

    decideNight(context, state, rng, probe): BotNightIntention | null {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("KILL")) {
        probe?.fallback("không có lượt cắn nào đang mở");
        return null;
      }

      const allies = new Set(
        Object.entries(context.knowledge.knownRoles)
          .filter(([, role]) => role === "WEREWOLF")
          .map(([id]) => id),
      );

      // Lọc đồng bọn lần nữa dù engine đã lọc. Hai lớp là có chủ đích: engine
      // bảo vệ luật, còn lớp này bảo vệ chiến thuật khỏi một thay đổi ở engine.
      const candidates = night.legalTargets.KILL.filter((id) => !allies.has(id));
      if (candidates.length === 0) {
        probe?.fallback("không còn mục tiêu nào ngoài bầy Sói");
        return null;
      }

      const scored = candidates
        .map((targetId) => {
          const { score, reason } = threatScore(state, context, targetId, weights);
          const terms: TraceTerm[] = [
            { name: "threat", value: score },
            { name: "jitter", value: (rng() - 0.5) * weights.confidence.jitterSpan },
          ];
          const total = sumTerms(terms);
          probe?.candidate({ targetId, score: total, terms, evidenceIds: [] });
          return { targetId, score: total, reason };
        })
        // Tie-break theo id để hai lần chạy cùng seed không đảo thứ tự.
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      const winner = scored[0];
      // Cuộc Săn Đẫm Máu và Sói Con phẫn nộ cùng mở một mục tiêu phụ; engine đã
      // gộp cả hai vào `bonusSecondTargetFor`, nên ở đây chỉ còn một điều kiện.
      // `scored` đã lọc đồng bọn nên con thứ hai cũng an toàn theo luật.
      const runnerUp =
        night.bonusSecondTargetFor === "KILL" ? (scored[1]?.targetId ?? null) : null;

      return {
        kind: "NIGHT_ACTION",
        action: "KILL",
        targetId: winner.targetId,
        secondaryTargetId: runnerUp,
        confidence: Math.min(1, Math.max(0, winner.score / MAX_BELIEF_SCORE)),
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            winner.targetId,
            winner.reason,
            0,
            weights,
          ),
        ],
      };
    },

    voteBias(context) {
      const bias: Record<string, number> = {};
      for (const [playerId, role] of Object.entries(context.knowledge.knownRoles)) {
        if (playerId === context.knowledge.botId) continue;
        if (role === "WEREWOLF") bias[playerId] = weights.teammateProtection.voteBiasPenalty;
      }
      return bias;
    },
  };
}
