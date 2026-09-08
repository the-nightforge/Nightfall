import { roleTeam, type Role } from "@masoi/shared";
import { incomingHostilityOf } from "../analysis/social-analysis";
import type { BotBrainState, BotKnowledgeView } from "../types";
import type { BotWeights } from "../config/weights";
import { DEFAULT_BOT_WEIGHTS } from "../config/weights";
import { fnv1a32 } from "../hash";
import { wolfBluffSeat } from "../decision/claim-decision";

/**
 * PR 5 của BOT_AI_CONTINUE_UPGRADE (§14-§17): WOLF TEAM PLANNER.
 *
 * §14 đòi "Only wolves may see team-private planning" — nhưng kiến trúc thật
 * của lõi này KHÔNG có kênh truyền tin giữa các BotRuntime. Câu trả lời đã có
 * từ Phase 3 (`fakeFightTarget`, `wolfBluffSeat`): một kế hoạch THUẦN mà mọi
 * con Sói tự tính ra CÙNG ĐÁP ÁN từ đúng dữ liệu cả bầy cùng thấy:
 *
 *   - roster bầy qua `knownRoles` (engine chỉ cấp cho viewer là Sói);
 *   - phiếu công khai (`currentVoteCounts`), social graph công khai;
 *   - hash FNV làm "đồng hồ chốt ghế" thay vì chat.
 *
 * Nhờ tính thuần, "team-private" được bảo đảm về KIẾN TRÚC: non-wolf gọi hàm
 * này nhận plan RỖNG, vì nó không có roster trong `knownRoles` để tính từ.
 * Không có đường nào đưa plan vào một knowledge view khác — nó không sống ở
 * state nào cả, chỉ tồn tại trong lúc strategy đang quyết.
 *
 * §15 "không ép mọi con Sói hành động giống nhau": plan là KHUNG chung (mọi
 * con đọc cùng một đáp án cho cùng một câu hỏi), còn hành vi cá thể — jitter,
 * personality, voteBias riêng của từng con — vẫn nằm ở `werewolfStrategy`.
 *
 * §17 distancing/sacrifice: các slot là ĐỀ XUẤT cho consumer; scorer của
 * consumer (bussing, fake fight, defense) vẫn phải tự cân tradeoff của mình.
 * Plan không ép ai bầu đồng bọn — nó chỉ nói "ai đang cần được đối xử đúng
 * cách" theo dữ liệu hiện có.
 */

export interface WolfTeamPlan {
  /** Mục tiêu cắn chính: threat cao nhất với bầy (KHÔNG đồng bọn). */
  primaryKillTarget: string | null;
  /** Phương án dự phòng khi primary không hợp lệ ở lượt nộp. */
  backupKillTarget: string | null;
  /**
   * Đồng bọn dẫn dắt bàn ngày: không bị làng công kích (incomingHostility thấp
   * nhất) — người có credibility để nói mà không bị soi.
   */
  discussionLeader: string | null;
  /**
   * Động viên cho slot khai láo: ghế hash từ `wolfBluffSeat`, tất định theo
   * (roster, round) — cùng cơ chế đã pin ở Phase 3.
   */
  claimant: string | null;
  /**
   * Đồng bọn đang bị dồn phiếu (lãnh đạo bảng phiếu công khai). Consumer có
   * thể chọn buông (bussing) hoặc cứu — plan chỉ chỉ mặt.
   */
  sacrificeCandidate: string | null;
  /** ĐỒNG BỌN còn sống khác (trừ sacrifice) — ứng viên giữ khoảng cách. */
  distancingPlayers: string[];
}

export interface WolfTeamPlanInput {
  knowledge: BotKnowledgeView;
  state: BotBrainState;
  weights?: BotWeights;
}

/** Vai thuộc bầy mà `knownRoles` của một con Sói còn sống liệt kê. */
function isPackRole(role: Role | undefined): boolean {
  return role === "WEREWOLF" || role === "WOLF_CUB";
}

/** Vai có thể lật ngược ván đấu nếu sống thêm một đêm. */
const POWER_ROLES = new Set(["SEER", "WITCH", "GUARD", "HUNTER"]);

/**
 * Threat của một mục tiêu cắn với bầy Sói — NGUỒN DUY NHẤT cho cả plan lẫn
 * `werewolfStrategy.decideNight` (PR 5b gộp về đây).
 *
 * Người đang tự nhận vai quyền lực là mục tiêu phải chết trước; người còn lại
 * chấm theo mức NGUY HIỂM với phe Sói (được làng tin + lái được dư luận),
 * TRỪ phần bị nghi (làng đang nghi sẵn thì để làng tự treo — mỗi đêm cắn người
 * vô hại với mình là một đêm lãng phí).
 */
export function wolfThreatScore(
  state: BotBrainState,
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

  const influence = incomingHostilityOf(state, targetId);
  const suspicion = state.suspicion[targetId]?.score ?? 0;
  const trust = state.trust[targetId]?.score ?? 0;

  return {
    score:
      tuning.wolfThreatBase +
      trust * tuning.wolfTrustWeight +
      influence * tuning.wolfHostilityWeight -
      suspicion * tuning.wolfSuspicionDiscount,
    reason: "được làng tin nên nguy hiểm với phe Sói",
  };
}

export function planWolfTeam(input: WolfTeamPlanInput): WolfTeamPlan {
  const empty: WolfTeamPlan = {
    primaryKillTarget: null,
    backupKillTarget: null,
    discussionLeader: null,
    claimant: null,
    sacrificeCandidate: null,
    distancingPlayers: [],
  };

  const knowledge = input.knowledge;
  const state = input.state;
  const weights = input.weights ?? DEFAULT_BOT_WEIGHTS;

  // §14 cổng duy nhất: viewer phải tự thấy mình trong pack roster. Non-wolf
  // không có pack trong knownRoles → plan rỗng, mọi slot null.
  const selfRole = knowledge.knownRoles[knowledge.botId];
  if (!isPackRole(selfRole)) return empty;

  const alive = new Set(
    knowledge.players.filter((player) => player.alive).map((player) => player.id),
  );
  const roster = Object.entries(knowledge.knownRoles)
    .filter(([, role]) => isPackRole(role))
    .map(([id]) => id)
    .sort();
  const pack = roster.filter((id) => alive.has(id));
  if (pack.length === 0) return empty;

  const round = knowledge.round;

  // --- Kill targets: threat qua nguồn duy nhất `wolfThreatScore` ---
  const threats = knowledge.night?.legalTargets.KILL ?? [];
  const candidates = threats.filter((id) => !roster.includes(id));
  const ranked = candidates
    .map((targetId) => ({ targetId, threat: wolfThreatScore(state, targetId, weights).score }))
    .sort((left, right) => right.threat - left.threat || left.targetId.localeCompare(right.targetId));

  // --- Leader: đồng bọn ít bị làng công kích nhất, hoà thì hash chốt ---
  // KHÔNG loại chính mình: leader phải tính từ TOÀN pack trên dữ liệu shared —
  // mỗi con thấy cùng một người, bằng ngược lại là bầy tự lệch nhau.
  const leaderRanked = pack
    .map((id) => ({ id, hostility: incomingHostilityOf(state, id) }))
    .sort((left, right) => left.hostility - right.hostility || left.id.localeCompare(right.id));
  const bestHostility = leaderRanked[0]?.hostility ?? 0;
  const leaderTie = leaderRanked.filter((item) => item.hostility === bestHostility);
  const discussionLeader =
    leaderTie.length === 1
      ? (leaderTie[0]?.id ?? null)
      : (leaderTie[fnv1a32(`wolf-leader|${roster.join(",")}|${round}`) % leaderTie.length]
          ?.id ?? null);

  // --- Claimant: ghế hash của Phase 3, tái dùng nguyên cơ chế ---
  const claimant = wolfBluffSeat(pack, roster, round);

  // --- Sacrifice & distancing: ai đang bị dồn phiếu công khai ---
  const votes = knowledge.currentVoteCounts.players;
  const pressured = pack
    .map((id) => ({ id, votes: votes[id] ?? 0 }))
    .filter((item) => item.votes > 0)
    .sort((left, right) => right.votes - left.votes || left.id.localeCompare(right.id));
  const sacrificeCandidate = pressured[0]?.id ?? null;
  // §17: distancing chỉ có nghĩa khi có một người CẦN được giữ khoảng cách.
  // Không ai bị dồn → không cần diễn → rỗng.
  const distancingPlayers =
    sacrificeCandidate === null
      ? []
      : pack.filter((id) => id !== sacrificeCandidate).sort();

  return {
    primaryKillTarget: ranked[0]?.targetId ?? null,
    backupKillTarget: ranked[1]?.targetId ?? null,
    discussionLeader,
    claimant,
    sacrificeCandidate,
    distancingPlayers,
  };
}
