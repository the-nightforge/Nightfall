import { isPowerRole, isRole, roleTeam, type Role } from "@masoi/shared";
import { incomingHostilityOf } from "../analysis/social-analysis";
import { profileStrength, type BotBrainState } from "../types";
import type { RoleBelief, RoleBeliefInput } from "./role-belief";
import { projectRoleBeliefs } from "./role-belief";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { getWolfProbability } from "./role-belief";

/**
 * Khép tiêu chí §40-#5 của spec CONTINUE: MỘT BẢNG ĐÁNH GIÁ phân biệt các chiều
 * (§9) thay vì trộn mọi thứ vào một score.
 *
 * Các chiều đã tồn tại rải rác trong codebase — audit ghi chúng ở khắp nơi mà
 * không có nơi nào đọc chung:
 *
 * - `suspicion` / `trust`: scalar 0..100, giữ nguyên thang vì decision đang đọc
 *   trực tiếp (BotBrainState.suspicion/trust).
 * - `wolfProbability`: P(wolf-team) từ projection PR 1 (`role-belief.ts`) —
 *   monotone với suspicion nhưng đã chuẩn hoá theo composition và ghim certain.
 * - `threat`: "đáng chặn lại tới mức nào", đọc qua ĐÚNG công thức mà bầy Sói
 *   dùng để chọn mục tiêu cắn — `wolfThreatScore` (trust×w + influence×w −
 *   suspicion×w). Cùng một thang cho mọi viewer: một người được tin + lái được
 *   dư luận + chưa ai nghi là nguy hiểm với làng, BẤT KỂ họ là ai.
 * - `credibility`: "lời nói đáng tin tới mức nào", đọc từ hồ sơ TRONG VÁN
 *   (`PlayerProfile.bluffRate/accuracy`) đúng công thức P1.1 của
 *   `claim-credibility` (accuracy − bluffRate × profileStrength) — KHÔNG chạm
 *   suspicion: một người đáng nghi vẫn có thể nói đúng, và ngược lại.
 * - `influence`: ai lái được dư luận, đo bằng incomingHostility (cùng nghĩa mà
 *   `werewolf.ts` đã dùng — người được cả bàn nhìn vào để react).
 * - `cooperationValue`: hợp tác được tới đâu — trust của chính bot (người tin
 *   thì muốn đi cùng) + support incoming (người khác cũng bênh, tức phe làng
 *   chấp nhận).
 * - `survivalImportance`: mất người này thì làng thiệt bao nhiêu — (1−P(Sói))
 *   nhân với giá trị vai: khai vai quyền lực chưa bị bác (isPowerRole claim
 *   còn trong `claims`), hoặc seer-pin sạch, hoặc trust riêng.
 *
 * §9 của spec: "B can be more likely a wolf while A is the better immediate
 * target" — với bảng này: wolfProbability(B) > wolfProbability(A) trong khi
 * threat(A) > threat(B), mỗi số một câu chuyện.
 *
 * Thuần, tất định, không RNG. Không state mới; chỉ gồm người SỐNG.
 */

export interface PlayerAssessment {
  playerId: string;
  /** Scalar gốc 0..100 — giữ thang vì decision đang đọc trực tiếp. */
  suspicion: number;
  /** Scalar gốc 0..100. */
  trust: number;
  /** P(thuộc phe Sói) từ projection PR 1 — 0..1. */
  wolfProbability: number;
  /** Nguy hiểm nếu để sống — 0..1 (công thức threat của bầy, /100). */
  threat: number;
  /** Lời nói đáng tin — 0..1, chỉ từ hồ sơ, không từ suspicion. */
  credibility: number;
  /** Lái được dư luận — 0..1. */
  influence: number;
  /** Hợp tác được tới đâu — 0..1. */
  cooperationValue: number;
  /** Mất người này thì làng thiệt — 0..1. */
  survivalImportance: number;
}

export interface AssessmentInput extends RoleBeliefInput {
  roleBeliefs?: Record<string, RoleBelief>;
  weights?: BotWeights;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Trung bình support của mọi cạnh đi VÀO một người. */
function incomingSupportOf(state: BotBrainState, targetId: string): number {
  let total = 0;
  let count = 0;
  for (const [key, edge] of Object.entries(state.relationships)) {
    if (!key.endsWith(`->${targetId}`)) continue;
    total += edge.support;
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

/**
 * "Lời người này nói đáng tin tới mức nào", `0..1`, CHỈ từ hồ sơ trong ván.
 *
 * `export` vì `speech-planner` cần đúng con số này khi cân xem một câu hỏi có
 * đáng đáp không (COMMUNICATION §13 "Importance"). Một bản sao công thức ở đó
 * sẽ trôi lệch, và khi nó trôi thì hai tầng cùng nói "uy tín" mà ý hai thứ khác
 * nhau.
 */
export function credibilityOf(
  state: BotBrainState,
  playerId: string,
  weights: BotWeights,
): number {
  const profile = state.profiles[playerId];
  // Hồ sơ rỗng = người chưa để lại mẫu: trung lập 0.5, không kết luận.
  const accuracy = profile?.accuracy ?? 0.5;
  const bluff =
    (profile?.bluffRate ?? 0) *
    (profile ? profileStrength(profile, weights.claim.profilePriorStrength) : 0);
  return clampUnit(accuracy - bluff);
}

function survivalImportanceOf(
  input: AssessmentInput,
  playerId: string,
  wolfProbability: number,
): number {
  const { state } = input;
  // Người của làng còn sống là tiền đề; Sói lộ (P≈1) không có gì để "giữ".
  const innocence = 1 - wolfProbability;

  // Vai quyền lực đã khai và chưa bị bác vẫn đáng giữ hơn một tuyên bố trống.
  const powerClaim = state.claims.some(
    (claim) =>
      claim.actorId === playerId &&
      (claim.type === "ROLE_CLAIM" || claim.type === "COUNTER_CLAIM") &&
      typeof claim.data.role === "string" &&
      isRole(claim.data.role) &&
      isPowerRole(claim.data.role),
  );
  // Hoặc Tiên Tri đã soi sạch cho chính bot này.
  const seerCleared = state.knownInformation.seerResults.some(
    (memory) => memory.targetId === playerId && memory.data.isWolf === false,
  );

  const trustShare = (state.trust[playerId]?.score ?? 0) / 100;
  const roleValue = powerClaim || seerCleared ? 1 : 0.5 + 0.5 * trustShare;
  return clampUnit(innocence * roleValue);
}

export function assessPlayer(playerId: string, input: AssessmentInput): PlayerAssessment {
  const weights = input.weights ?? DEFAULT_BOT_WEIGHTS;
  const roleBeliefs = input.roleBeliefs ?? projectRoleBeliefs(input);

  const suspicion = input.state.suspicion[playerId]?.score ?? 0;
  const trust = input.state.trust[playerId]?.score ?? 0;
  const wolfProbability = getWolfProbability(roleBeliefs, playerId);

  // Công thức threat của bầy, chuẩn hoá /100 — cùng một thang cho mọi viewer.
  const tuning = weights.roleThresholds;
  const threat = clampUnit(
    (tuning.wolfThreatBase +
      trust * tuning.wolfTrustWeight +
      incomingHostilityOf(input.state, playerId) * tuning.wolfHostilityWeight -
      suspicion * tuning.wolfSuspicionDiscount) /
      100,
  );

  return {
    playerId,
    suspicion,
    trust,
    wolfProbability,
    threat,
    credibility: credibilityOf(input.state, playerId, weights),
    influence: clampUnit(incomingHostilityOf(input.state, playerId)),
    cooperationValue: clampUnit(
      0.5 * (trust / 100) + 0.5 * incomingSupportOf(input.state, playerId),
    ),
    survivalImportance: survivalImportanceOf(input, playerId, wolfProbability),
  };
}

/** MỌI người sống, theo thứ tự id ổn định. */
export function assessPlayers(input: AssessmentInput): Record<string, PlayerAssessment> {
  const aliveIds = input.knowledge.players
    .filter((player) => player.alive)
    .map((player) => player.id)
    .sort();
  const out: Record<string, PlayerAssessment> = {};
  for (const playerId of aliveIds) {
    out[playerId] = assessPlayer(playerId, input);
  }
  return out;
}
