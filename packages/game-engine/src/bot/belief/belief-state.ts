import type { BeliefEntry, BotBrainState, BotEvidence, BotPersonality } from "../types";
import { clampBeliefScore, clampConfidence, validateEvidence } from "./evidence";

/** Số lý do gần nhất được giữ cho mỗi belief entry. */
const REASON_LIMIT = 12;

function neutralBelief(): BeliefEntry {
  return { score: 0, reasons: [], lastUpdatedRound: 0 };
}

/**
 * Người bướng bỉnh đổi ý chậm hơn. Inertia nằm trong `[0.4625, 0.755]` với dải
 * personality hiện tại, nên nó luôn làm chậm chứ không bao giờ đảo dấu một
 * update.
 */
export function beliefInertia(personality: BotPersonality): number {
  return 0.35 + personality.stubbornness * 0.45;
}

function updateBelief(
  entries: Record<string, BeliefEntry>,
  evidence: BotEvidence,
  personality: BotPersonality,
): void {
  const entry = entries[evidence.actorId] ?? neutralBelief();
  const inertia = beliefInertia(personality);
  const delta = evidence.weight * clampConfidence(evidence.confidence) * (1 - inertia * 0.5);

  entry.score = clampBeliefScore(entry.score + delta);
  entry.reasons = [
    ...entry.reasons.filter((reason) => reason.id !== evidence.id),
    { ...evidence },
  ].slice(-REASON_LIMIT);
  entry.lastUpdatedRound = evidence.round;

  entries[evidence.actorId] = entry;
}

/**
 * Áp một bằng chứng lên suspicion của người đã thực hiện hành vi.
 *
 * Nguồn được kiểm tra trước khi chạm vào belief: một evidence hỏng phải dừng ở
 * biên chứ không được để lại nửa cập nhật.
 */
export function applyEvidence(state: BotBrainState, evidence: BotEvidence): void {
  validateEvidence(evidence, state.seenEventIds);
  // BOT không tự nghi chính mình; self-knowledge nằm ở knownInformation.
  if (evidence.actorId === state.playerId) return;
  updateBelief(state.suspicion, evidence, state.personality);
}

/**
 * Trust là một accumulator riêng, KHÔNG phải `100 - suspicion`. Một người vừa
 * đáng ngờ vừa đáng tin là trạng thái có thật khi bằng chứng mâu thuẫn, và gộp
 * hai khái niệm sẽ xoá mất chính sự mâu thuẫn đó.
 */
export function applyTrustEvidence(state: BotBrainState, evidence: BotEvidence): void {
  validateEvidence(evidence, state.seenEventIds);
  if (evidence.actorId === state.playerId) return;
  updateBelief(state.trust, evidence, state.personality);
}
