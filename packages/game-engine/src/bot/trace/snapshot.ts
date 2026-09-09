import { assessPlayers } from "../belief/player-assessment";
import type { BotWeights } from "../config/weights";
import { informationValue } from "../roles/uncertainty";
import { powerRoleClaimOf } from "../roles/wolf-team-plan";
import type { BotBrainState, BotKnowledgeView } from "../types";
import type { BeliefSnapshot, TraceKnowledgeSnapshot } from "./trace";

/**
 * Hai ảnh chụp mà trace ghi và observation lúc chơi dùng CHUNG.
 *
 * Tách khỏi `BotRuntime` để `buildLiveObservation` gọi được cùng code: cách
 * duy nhất chắc chắn vector lúc chơi == vector lúc train là không có hai bản.
 * Nội dung hai hàm là NGUYÊN VĂN code đã nằm trong `BotRuntime`; không một
 * phép tính nào đổi trong lần di chuyển này.
 */

/**
 * Ảnh chụp knowledge cho trace.
 *
 * Mọi trường là bản SAO của `BotKnowledgeView`, thứ engine đã lọc theo quyền của
 * chính bot. Không trường nào được dựng lại từ nguồn khác, nên ràng buộc
 * "trace ⊆ knowledge view" đúng theo kiến trúc chứ không theo kỷ luật: không có
 * chỗ nào ở đây để một bí mật lọt vào, kể cả khi ai đó muốn.
 */
export function snapshotKnowledge(knowledge: BotKnowledgeView): TraceKnowledgeSnapshot {
  return {
    aliveIds: knowledge.players.filter((player) => player.alive).map((player) => player.id),
    legalChoices: knowledge.legalVoteChoices.map((choice) =>
      choice.type === "PLAYER" ? choice.targetId : "NO_ELIMINATION",
    ),
    // Cùng nguồn `BotKnowledgeView` như mọi trường khác ở đây, nên ranh giới
    // "trace ⊆ knowledge view" không đổi: đây là tập hợp lệ engine đã cấp cho
    // đúng bot này, không phải một bảng dựng lại từ luật.
    nightLegalTargets: knowledge.night
      ? Object.fromEntries(
          Object.entries(knowledge.night.legalTargets).map(([action, targets]) => [
            action,
            [...targets],
          ]),
        )
      : null,
    hunterLegalTargets: knowledge.hunterShot ? [...knowledge.hunterShot.legalTargets] : null,
    knownRoles: { ...knowledge.knownRoles },
    seerResult: knowledge.seerResult
      ? { targetId: knowledge.seerResult.targetId, isWolf: knowledge.seerResult.isWolf }
      : null,
    // Phần còn lại của view mà tầng train cần: vẫn là bản sao nguyên trạng, và
    // engine đã quyết định vai này thấy gì (Phù Thuỷ thấy nạn nhân sau khi bầy
    // khoá, Bảo Vệ thấy người đêm trước, ai cũng thấy phiếu và người chết).
    nightWolfTarget: knowledge.night ? knowledge.night.wolfTarget : null,
    nightLegalActions: knowledge.night ? [...knowledge.night.legalActions] : null,
    healUsed: knowledge.night?.healUsed ?? false,
    poisonUsed: knowledge.night?.poisonUsed ?? false,
    guardPrevious: knowledge.night ? knowledge.night.guardPrevious : null,
    lastNightDeaths: knowledge.lastNightDeaths.map((death) => death.playerId),
    voteCounts: {
      players: { ...knowledge.currentVoteCounts.players },
      noElimination: knowledge.currentVoteCounts.noElimination,
    },
    trialAccusedId: knowledge.trialAccusedId,
  };
}

export function snapshotBelief(
  state: BotBrainState,
  knowledge: BotKnowledgeView,
  weights: BotWeights,
): BeliefSnapshot {
  const snapshot: BeliefSnapshot = {};
  // Cùng hàm mà scorer dùng, cùng state, cùng weights: ảnh chụp là ĐÚNG đầu
  // vào của quyết định, không phải một bản tính lại gần đúng. Chỉ chạy khi có
  // trace, nên production không trả chi phí này.
  const assessments = assessPlayers({
    knowledge,
    state,
    weights,
    roleComposition: knowledge.roleComposition,
  });
  const guardedBefore = new Set(
    state.previousNightActions
      .filter((entry) => entry.action === "GUARD" && entry.targetId !== null)
      .map((entry) => entry.targetId as string),
  );
  for (const id of Object.keys(state.suspicion).sort()) {
    const assessment = assessments[id];
    const suspicion = state.suspicion[id]?.score ?? 0;
    snapshot[id] = {
      suspicion,
      trust: state.trust[id]?.score ?? 0,
      // Cùng hàm/predicate mà seer.ts, detective.ts, guard.ts và
      // wolf-team-plan.ts dùng — không chép công thức lần hai.
      informationValue: informationValue(suspicion, weights),
      claimedPowerRole: powerRoleClaimOf(state, id) !== undefined,
      guardedBefore: guardedBefore.has(id),
      ...(assessment
        ? {
            wolfProbability: assessment.wolfProbability,
            threat: assessment.threat,
            credibility: assessment.credibility,
            influence: assessment.influence,
          }
        : {}),
    };
  }
  return snapshot;
}
