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
 * Trust là một accumulator RIÊNG, không phải `100 - suspicion`: hai bảng có
 * lịch sử lý do khác nhau, và một người vừa đáng ngờ vừa đáng tin là trạng thái
 * có thật khi bằng chứng mâu thuẫn.
 *
 * Cùng một evidence được áp vào trust với dấu NGƯỢC LẠI suspicion. Nhờ vậy một
 * bằng chứng buộc tội (weight dương) vừa tăng nghi ngờ vừa giảm tin tưởng, còn
 * một bằng chứng gỡ tội (weight âm) làm điều ngược lại - caller chỉ cần chọn
 * đúng dấu một lần, thay vì phải nhớ đảo dấu ở từng chỗ gọi.
 */
export function applyTrustEvidence(state: BotBrainState, evidence: BotEvidence): void {
  validateEvidence(evidence, state.seenEventIds);
  if (evidence.actorId === state.playerId) return;
  updateBelief(state.trust, { ...evidence, weight: -evidence.weight }, state.personality);
}

/** Mỗi vòng trôi qua, một niềm tin không được củng cố giữ lại 85% sức nặng. */
export const BELIEF_DECAY_PER_ROUND = 0.85;

/**
 * Bằng chứng KHÔNG bao giờ nguội đi.
 *
 * Kết quả soi và danh tính đồng đội là sự thật do engine cấp, không phải ấn
 * tượng rút ra từ hành vi. Cho chúng phai theo thời gian sẽ khiến Tiên Tri vô
 * dụng sau vài vòng, và khiến Sói quên mất đồng bọn của chính mình.
 */
const PERMANENT_KINDS = new Set<BotEvidence["kind"]>([
  "SEER_RESULT_WOLF",
  "SEER_RESULT_CLEAR",
  "KNOWN_ALLY",
]);

function isPermanent(entry: BeliefEntry): boolean {
  return entry.reasons.some((reason) => PERMANENT_KINDS.has(reason.kind));
}

function decayEntry(entry: BeliefEntry, round: number): void {
  if (isPermanent(entry)) return;

  const age = Math.max(0, round - entry.lastUpdatedRound);
  if (age === 0) return;

  entry.score = clampBeliefScore(entry.score * BELIEF_DECAY_PER_ROUND ** age);
  // Ghi lại mốc để lần gọi sau không nhân tiếp phần vừa nhân. Không có dòng này
  // thì gọi decay hai lần trong cùng một vòng sẽ nguội gấp đôi, và số vòng bot
  // "quên" một nghi ngờ phụ thuộc vào việc observe được gọi mấy lần.
  entry.lastUpdatedRound = round;
}

/**
 * Làm nguội mọi niềm tin không được củng cố trong các vòng vừa qua.
 *
 * Belief chỉ tăng là sai về hành vi: một nghi ngờ từ vòng 1 sẽ nặng ngang một
 * nghi ngờ vừa có ở vòng 5, kể cả khi người bị nghi đã chứng minh điều ngược
 * lại suốt bốn vòng. Decay là thứ cho phép bot đổi ý.
 */
export function decayBeliefs(state: BotBrainState, round: number): void {
  for (const entry of Object.values(state.suspicion)) decayEntry(entry, round);
  for (const entry of Object.values(state.trust)) decayEntry(entry, round);

  for (const edge of Object.values(state.relationships)) {
    const age = Math.max(0, round - edge.lastUpdatedRound);
    if (age === 0) continue;

    const factor = BELIEF_DECAY_PER_ROUND ** age;
    edge.support *= factor;
    edge.hostility *= factor;
    edge.voteAlignment *= factor;
    edge.lastUpdatedRound = round;
  }
}
