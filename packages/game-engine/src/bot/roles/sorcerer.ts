import { isRole, roleTeam, type Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { nightEvidence, type BotRoleStrategy } from "./strategy";
import { rankNightTargets } from "./night-scoring";

/** Vai thuộc dòng Tiên Tri mà Sói Pháp Sư đi săn. */
const SEER_LINE: ReadonlySet<string> = new Set(["SEER", "APPRENTICE_SEER"]);

/** Tiền tố nguồn của một lượt soi Pháp Sư đã chốt, để không soi lại. */
export const SORCERER_SIGHTING_SOURCE_PREFIX = "sorcerer:";

/** Mục tiêu đã bị chính con Sói này xác định dòng Tiên Tri. */
export function sightedSeerLineTargets(
  seerResults: ReadonlyArray<{ sourceId: string; targetId?: string }>,
): Set<string> {
  const found = new Set<string>();
  for (const memory of seerResults) {
    if (memory.targetId === undefined) continue;
    if (memory.sourceId.startsWith(SORCERER_SIGHTING_SOURCE_PREFIX)) found.add(memory.targetId);
  }
  return found;
}

/**
 * Sói Pháp Sư soi người CÓ THỂ là dòng Tiên Tri, không phải người đáng ngờ nhất.
 *
 * Thứ tự ưu tiên: người đang claim dòng Tiên Tri (SEER/APPRENTICE_SEER) > người
 * được làng tin (kẻ quan trọng là kẻ được che) > người đáng ngờ. Bỏ qua đồng
 * bọn đã biết và người đã soi rồi. Mỗi đêm đúng một lượt - phiếu cắn của bầy
 * do đồng bọn lo, lượt soi này là giá trị duy nhất lá bài mang lại.
 */
export function sorcererStrategy(
  _role: Role = "SORCERER",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  return {
    role: "SORCERER",

    decideNight(context, state, rng, probe, policy) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("SORCERER_CHECK")) {
        probe?.fallback("không có lượt soi Pháp Sư nào đang mở");
        return null;
      }

      const allies = new Set(
        Object.entries(context.knowledge.knownRoles)
          .filter(([, role]) => roleTeam(role) === "wolves")
          .map(([id]) => id),
      );
      const sighted = sightedSeerLineTargets(state.knownInformation.seerResults);

      const candidates = night.legalTargets.SORCERER_CHECK.filter(
        (id) => !allies.has(id) && !sighted.has(id),
      );
      if (candidates.length === 0) {
        probe?.fallback("không còn ai ngoài bầy Sói và người đã soi để kiểm tra");
        return null;
      }

      const tuning = weights.roleThresholds;
      const ranked = rankNightTargets(candidates, {
        weights,
        rng,
        probe,
        action: "SORCERER_CHECK",
        policy,
        termsFor: (targetId) => {
          const claimedSeerLine = state.claims.some(
            (memory) =>
              memory.actorId === targetId &&
              (memory.type === "ROLE_CLAIM" || memory.type === "COUNTER_CLAIM") &&
              isRole(memory.data.role) && SEER_LINE.has(memory.data.role),
          );
          return [
            {
              name: "seerClaim",
              value: claimedSeerLine ? tuning.wolfClaimedPowerScore : 0,
            },
            { name: "trust", value: state.trust[targetId]?.score ?? 0 },
            { name: "suspicion", value: state.suspicion[targetId]?.score ?? 0 },
          ];
        },
      });

      const winner = ranked[0];
      return {
        kind: "NIGHT_ACTION",
        action: "SORCERER_CHECK",
        targetId: winner.targetId,
        confidence: 0.7,
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            winner.targetId,
            "cần xác định có phải dòng Tiên Tri không",
            0,
            weights,
          ),
        ],
      };
    },

    voteBias(_context, state) {
      const bias: Record<string, number> = {};
      for (const sighting of state.knownInformation.seerResults) {
        if (!sighting.sourceId.startsWith(SORCERER_SIGHTING_SOURCE_PREFIX)) continue;
        if (sighting.data.seerLine !== true || sighting.targetId === undefined) continue;
        // Đối xứng với `werewolfStrategy.voteBias`: ở đó đồng bọn được đẩy
        // phiếu RA (số âm), ở đây kẻ thuộc dòng Tiên Tri bị đẩy phiếu VÀO.
        bias[sighting.targetId] = -weights.teammateProtection.voteBiasPenalty;
      }
      return bias;
    },
  };
}
