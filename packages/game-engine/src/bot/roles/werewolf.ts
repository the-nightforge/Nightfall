import type {
  BotBrainState,
  BotDecisionContext,
  BotNightIntention,
  BotRng,
} from "../types";
import { incomingHostilityOf } from "../analysis/social-analysis";
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
): { score: number; reason: string } {
  const claim = state.claims.find(
    (memory) =>
      memory.actorId === targetId &&
      memory.type === "ROLE_CLAIM" &&
      POWER_ROLES.has(String(memory.data.role)),
  );
  if (claim) {
    return {
      score: 100,
      reason: `tự nhận là ${String(claim.data.role)} nên phải chết trước`,
    };
  }

  // Người nói nhiều và được người khác đi theo là người lái được cuộc bỏ phiếu.
  const influence = incomingHostilityOf(state, targetId);
  const suspicion = state.suspicion[targetId]?.score ?? 0;
  const trust = state.trust[targetId]?.score ?? 0;

  return {
    // Trừ suspicion: làng đang nghi sẵn thì để làng tự xử.
    score: 40 + trust * 0.4 + influence * 20 - suspicion * 0.35,
    reason: "được làng tin nên nguy hiểm với phe Sói",
  };
}

export function werewolfStrategy(): BotRoleStrategy {
  return {
    role: "WEREWOLF",

    decideNight(context, state, rng): BotNightIntention | null {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("KILL")) return null;

      const allies = new Set(
        Object.entries(context.knowledge.knownRoles)
          .filter(([, role]) => role === "WEREWOLF")
          .map(([id]) => id),
      );

      // Lọc đồng bọn lần nữa dù engine đã lọc. Hai lớp là có chủ đích: engine
      // bảo vệ luật, còn lớp này bảo vệ chiến thuật khỏi một thay đổi ở engine.
      const candidates = night.legalTargets.KILL.filter((id) => !allies.has(id));
      if (candidates.length === 0) return null;

      const scored = candidates
        .map((targetId) => {
          const { score, reason } = threatScore(state, context, targetId);
          return { targetId, score: score + (rng() - 0.5) * 6, reason };
        })
        // Tie-break theo id để hai lần chạy cùng seed không đảo thứ tự.
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      const winner = scored[0];
      return {
        kind: "NIGHT_ACTION",
        action: "KILL",
        targetId: winner.targetId,
        confidence: Math.min(1, Math.max(0, winner.score / 100)),
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            winner.targetId,
            winner.reason,
          ),
        ],
      };
    },

    voteBias(context) {
      const bias: Record<string, number> = {};
      for (const [playerId, role] of Object.entries(context.knowledge.knownRoles)) {
        if (playerId === context.knowledge.botId) continue;
        if (role === "WEREWOLF") bias[playerId] = -100;
      }
      return bias;
    },
  };
}
