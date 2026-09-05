import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BeliefEntry, BotBrainState, BotEvidence, BotPersonality } from "../types";
import { clampBeliefScore, clampConfidence, validateEvidence } from "./evidence";
import { decayProfiles } from "./player-profile";

function neutralBelief(): BeliefEntry {
  return { score: 0, reasons: [], lastUpdatedRound: 0 };
}

/**
 * Người bướng bỉnh đổi ý chậm hơn. Inertia nằm trong `[0.4625, 0.755]` với dải
 * personality mặc định, nên nó luôn làm chậm chứ không bao giờ đảo dấu một
 * update.
 */
export function beliefInertia(
  personality: BotPersonality,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): number {
  return (
    weights.suspicion.inertiaBase +
    personality.stubbornness * weights.suspicion.inertiaStubbornSpan
  );
}

function updateBelief(
  entries: Record<string, BeliefEntry>,
  evidence: BotEvidence,
  personality: BotPersonality,
  weights: BotWeights,
): void {
  const entry = entries[evidence.actorId] ?? neutralBelief();
  const inertia = beliefInertia(personality, weights);
  const delta =
    evidence.weight *
    clampConfidence(evidence.confidence) *
    (1 - inertia * weights.suspicion.inertiaScale);

  entry.score = clampBeliefScore(entry.score + delta);
  entry.reasons = [
    ...entry.reasons.filter((reason) => reason.id !== evidence.id),
    { ...evidence },
  ].slice(-weights.limits.beliefReasons);
  entry.lastUpdatedRound = evidence.round;

  entries[evidence.actorId] = entry;
}

/**
 * Áp một bằng chứng lên suspicion của người đã thực hiện hành vi.
 *
 * Nguồn được kiểm tra trước khi chạm vào belief: một evidence hỏng phải dừng ở
 * biên chứ không được để lại nửa cập nhật.
 */
export function applyEvidence(
  state: BotBrainState,
  evidence: BotEvidence,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): void {
  validateEvidence(evidence, state.seenEventIds);
  // BOT không tự nghi chính mình; self-knowledge nằm ở knownInformation.
  if (evidence.actorId === state.playerId) return;
  updateBelief(state.suspicion, evidence, state.personality, weights);
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
export function applyTrustEvidence(
  state: BotBrainState,
  evidence: BotEvidence,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): void {
  validateEvidence(evidence, state.seenEventIds);
  if (evidence.actorId === state.playerId) return;
  updateBelief(
    state.trust,
    { ...evidence, weight: -evidence.weight },
    state.personality,
    weights,
  );
}

/**
 * Mỗi vòng trôi qua, một niềm tin không được củng cố giữ lại 85% sức nặng.
 *
 * Giữ lại như một hằng số đọc-chỉ vì test và tài liệu Phase 2 tham chiếu tới
 * nó; nguồn sự thật giờ là `BotWeights.recency.beliefDecayPerRound`.
 */
export const BELIEF_DECAY_PER_ROUND = DEFAULT_BOT_WEIGHTS.recency.beliefDecayPerRound;

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
  // Lời khai bị chứng minh là dối không nguội đi: bằng chứng phơi nó ra là sự
  // thật do engine cấp, không phải một ấn tượng.
  "PROVEN_FALSE_CLAIM",
]);

function isPermanent(entry: BeliefEntry): boolean {
  return entry.reasons.some((reason) => PERMANENT_KINDS.has(reason.kind));
}

function decayEntry(entry: BeliefEntry, round: number, rate: number): void {
  if (isPermanent(entry)) return;

  const age = Math.max(0, round - entry.lastUpdatedRound);
  if (age === 0) return;

  entry.score = clampBeliefScore(entry.score * rate ** age);
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
export function decayBeliefs(
  state: BotBrainState,
  round: number,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): void {
  const rate = weights.recency.beliefDecayPerRound;
  for (const entry of Object.values(state.suspicion)) decayEntry(entry, round, rate);
  for (const entry of Object.values(state.trust)) decayEntry(entry, round, rate);

  for (const edge of Object.values(state.relationships)) {
    const age = Math.max(0, round - edge.lastUpdatedRound);
    if (age === 0) continue;

    const factor = rate ** age;
    edge.support *= factor;
    edge.hostility *= factor;
    edge.voteAlignment *= factor;
    edge.lastUpdatedRound = round;
  }

  // Hồ sơ người chơi nguội theo tốc độ RIÊNG, chậm hơn: xem
  // `RecencyWeights.profileDecayPerRound`.
  decayProfiles(state, round, weights.recency.profileDecayPerRound);
}
