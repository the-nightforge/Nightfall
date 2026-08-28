import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotBrainState, Coalition } from "../types";
import { possibleWolfPairScore, socialEdgeKey } from "./social-analysis";

function playersIn(state: BotBrainState): string[] {
  const ids = new Set<string>();
  for (const key of Object.keys(state.relationships)) {
    const [from, to] = key.split("->");
    if (from) ids.add(from);
    if (to) ids.add(to);
  }
  // Sắp xếp để mọi bước sau đó không phụ thuộc thứ tự chèn khoá object.
  return [...ids].sort();
}

/**
 * Gom cụm tham lam trên điểm ghép cặp đã có.
 *
 * Bắt đầu từ cặp mạnh nhất rồi nạp thêm người nếu độ gắn kết TRUNG BÌNH với cả
 * nhóm vẫn đủ cao. Tham lam là đủ ở đây: một ván chỉ có dưới 20 người, và mục
 * tiêu là "có tín hiệu để chấm điểm", không phải phân cụm tối ưu.
 *
 * Hoàn toàn tất định - không nhận RNG, và mọi bước đều sắp xếp theo
 * `(score giảm dần, id tăng dần)`.
 *
 * Kết quả là TÍN HIỆU, không phải phán quyết về vai. Không hàm nào ở đây ghi
 * vào `knownInformation.knownRoles`.
 */
export function detectCoalitions(
  state: BotBrainState,
  minCohesion?: number,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): Coalition[] {
  const floor = minCohesion ?? weights.social.minCohesion;
  const players = playersIn(state);
  const pairs: Array<{ left: string; right: string; score: number }> = [];

  for (let i = 0; i < players.length; i += 1) {
    for (let j = i + 1; j < players.length; j += 1) {
      const score = possibleWolfPairScore(state, players[i], players[j], weights);
      if (score >= floor) {
        pairs.push({ left: players[i], right: players[j], score });
      }
    }
  }

  pairs.sort(
    (a, b) =>
      b.score - a.score || a.left.localeCompare(b.left) || a.right.localeCompare(b.right),
  );

  const groups: Coalition[] = [];
  const assigned = new Set<string>();

  for (const seed of pairs) {
    if (assigned.has(seed.left) || assigned.has(seed.right)) continue;

    const members = [seed.left, seed.right];
    for (const candidate of players) {
      if (members.includes(candidate) || assigned.has(candidate)) continue;

      const scores = members.map((member) =>
        possibleWolfPairScore(state, member, candidate, weights),
      );
      const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
      if (average >= floor) members.push(candidate);
    }

    members.sort();
    for (const member of members) assigned.add(member);

    const cohesionScores: number[] = [];
    let samples = 0;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        cohesionScores.push(possibleWolfPairScore(state, members[i], members[j], weights));
        samples +=
          (state.relationships[socialEdgeKey(members[i], members[j])]?.samples ?? 0) +
          (state.relationships[socialEdgeKey(members[j], members[i])]?.samples ?? 0);
      }
    }

    groups.push({
      memberIds: members,
      cohesion:
        cohesionScores.reduce((sum, value) => sum + value, 0) /
        Math.max(1, cohesionScores.length),
      sampleCount: samples,
    });
  }

  return groups;
}

/**
 * Ai đang lái được đám đông.
 *
 * Đo bằng tổng `voteAlignment` ĐI VÀO một người: người mà nhiều người khác bỏ
 * phiếu trùng theo là người dẫn dắt. Đây là in-degree có trọng số, chuẩn hoá
 * theo số cạnh để không thiên vị ván đông người.
 */
export function influenceScore(state: BotBrainState, playerId: string): number {
  let total = 0;
  for (const [key, edge] of Object.entries(state.relationships)) {
    if (!key.endsWith(`->${playerId}`)) continue;
    total += edge.voteAlignment;
  }
  return total;
}

/**
 * Ai đang bị cả làng nhắm mà không ai bênh.
 *
 * Người cô lập là mục tiêu treo dễ nhất - vừa là thông tin cho phe làng (có thể
 * đó là Sói bị lộ), vừa là cảnh báo cho chính bot (đám đông đang dồn vào một
 * người có khi vô tội).
 */
export function isolationScore(
  state: BotBrainState,
  playerId: string,
  alive: readonly string[],
): number {
  let hostility = 0;
  let support = 0;
  for (const [key, edge] of Object.entries(state.relationships)) {
    if (!key.endsWith(`->${playerId}`)) continue;
    hostility += edge.hostility;
    support += edge.support;
  }

  const denominator = Math.max(1, alive.length - 1);
  return (hostility - support) / denominator;
}
