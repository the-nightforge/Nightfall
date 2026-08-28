import { clampConfidence, validateEvidence } from "../belief/evidence";
import type { BotBrainState, BotEvidence, SocialEdge } from "../types";

/** Số lý do gần nhất giữ lại trên mỗi cạnh. */
const EDGE_REASON_LIMIT = 8;

/**
 * Một evidence "nặng" cỡ 20 điểm suspicion là đủ để kéo một cạnh xã hội từ 0
 * lên kịch trần. Cạnh chỉ đo cường độ quan hệ trong `[0, 1]`, không đo tội.
 */
const EDGE_STEP_DIVISOR = 20;

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Cạnh có hướng: "from đã làm gì đó với to". */
export function socialEdgeKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`;
}

function emptyEdge(): SocialEdge {
  return {
    support: 0,
    hostility: 0,
    voteAlignment: 0,
    samples: 0,
    reasons: [],
    lastUpdatedRound: 0,
  };
}

/**
 * Cập nhật social graph từ một bằng chứng đã có nguồn.
 *
 * Graph chỉ gợi ý mức độ phối hợp; nó không bao giờ ghi role. Đó là lý do hàm
 * này không chạm vào `knownInformation`.
 */
export function applySocialEvidence(state: BotBrainState, evidence: BotEvidence): void {
  validateEvidence(evidence, state.seenEventIds);
  // Một cạnh cần hai đầu. Bằng chứng không có target (ví dụ phiếu không treo)
  // vẫn có ý nghĩa cho suspicion nhưng không mô tả được quan hệ nào.
  if (!evidence.targetId || evidence.targetId === evidence.actorId) return;

  const key = socialEdgeKey(evidence.actorId, evidence.targetId);
  const edge = state.relationships[key] ?? emptyEdge();
  const step = clampUnit(
    (Math.abs(evidence.weight) * clampConfidence(evidence.confidence)) / EDGE_STEP_DIVISOR,
  );

  switch (evidence.kind) {
    case "VOTE_ALIGNMENT":
    case "BANDWAGON":
      edge.voteAlignment = clampUnit(edge.voteAlignment + step);
      break;
    case "DEFEND":
    case "SAVE_VOTE":
      edge.support = clampUnit(edge.support + step);
      break;
    case "ACCUSE":
    case "COUNTER_CLAIM":
    case "LATE_SWITCH":
    case "TIE_BREAK":
      edge.hostility = clampUnit(edge.hostility + step);
      break;
    case "ROLE_CLAIM":
      // Tự nhận vai không nói gì về quan hệ với người khác; chỉ ghi nhận mẫu.
      break;
  }

  edge.samples += 1;
  edge.lastUpdatedRound = evidence.round;
  edge.reasons = [
    ...edge.reasons.filter((reason) => reason.id !== evidence.id),
    { ...evidence },
  ].slice(-EDGE_REASON_LIMIT);

  state.relationships[key] = edge;
}

/**
 * Score mềm `0–1` cho khả năng hai người đang phối hợp.
 *
 * Đây KHÔNG phải kết luận role. Nó chỉ bổ sung suspicion, và luôn bị nhân với
 * một hệ số tin cậy theo số lần quan sát, nên một lần trùng phiếu duy nhất
 * không thể tạo ra một "cặp Sói".
 */
/**
 * Mức thù địch trung bình mà cả làng hướng VÀO một người.
 *
 * Sống ở đây chứ không ở `vote-decision` vì nó là một phép đo trên social
 * graph, và từ Phase 2 có hai consumer: chấm điểm phiếu ban ngày, và chiến
 * lược đêm của Sói (ai đang lái được dư luận thì nguy hiểm).
 */
export function incomingHostilityOf(state: BotBrainState, targetId: string): number {
  let total = 0;
  let count = 0;
  for (const [key, edge] of Object.entries(state.relationships)) {
    if (!key.endsWith(`->${targetId}`)) continue;
    total += edge.hostility;
    count += 1;
  }
  return count === 0 ? 0 : total / count;
}

export function possibleWolfPairScore(
  state: BotBrainState,
  leftId: string,
  rightId: string,
): number {
  const forward = state.relationships[socialEdgeKey(leftId, rightId)];
  const backward = state.relationships[socialEdgeKey(rightId, leftId)];
  const samples = (forward?.samples ?? 0) + (backward?.samples ?? 0);
  if (samples === 0) return 0;

  const average = (pick: (edge: SocialEdge) => number) =>
    ((forward ? pick(forward) : 0) + (backward ? pick(backward) : 0)) / 2;

  const alignment = average((edge) => edge.voteAlignment);
  const support = average((edge) => edge.support);
  const hostility = average((edge) => edge.hostility);
  // Quan sát càng nhiều thì score càng được phép tiến gần trần; bốn mẫu đầu
  // tiên cố tình bị chiết khấu mạnh.
  const observationWeight = samples / (samples + 4);

  return clampUnit((alignment * 0.6 + support * 0.4 - hostility * 0.5) * observationWeight);
}
