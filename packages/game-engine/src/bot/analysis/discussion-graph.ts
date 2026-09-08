import type { BotKnowledgeView, BotMemory } from "../types";

/**
 * PR 4 của BOT_AI_CONTINUE_UPGRADE (§13): discussion graph — bức tranh ÁP LỰC
 * mỗi vòng được dựng lại từ memory có cấu trúc mà `analyzeChat` đã ghi.
 *
 * §13 yêu cầu track: ai khởi xướng áp lực, ai tham gia, ai bênh, ai im. Phần
 * đổi lập trường / theo đám đông bằng phiếu đã có chủ riêng —
 * `LATE_SWITCH`/`BANDWAGON` của `vote-analysis` cho phiếu, `VOTE_CHANGED` của
 * memory cho đổi ý. Phần THIẾU là áp lực bằng LỜI nói, và đó là episode ở đây:
 *
 *   round 2, target c: a tố trước (initiator) → b tham gia → e bênh → me im
 *
 * Dùng cho hai câu hỏi:
 * 1. Đám đông đang dồn vào ai, có bao nhiêu người đứng sau (độ rộng) —
 *    consumer của planner (isolation đã đo được một phần bằng phiếu).
 * 2. AI CÙNG TỐ / CÙNG BÊNH MỘT NGƯỜI — tín hiệu liên minh cho
 *    `pair-assessment` (§34 "shared targets"), với sự chiết khấu cốt lõi của
 *    §13: chỉ hai đứa cùng tố mạnh hơn cả bàn cùng tố, vì đám đông đông là
 *    hành vi bình thường còn cặp đôi là hành vi của bầy.
 *
 * Tất định: mọi danh sách sort theo id; episode sort theo (round, target).
 * Thuần: đọc memory, không đụng state, không RNG.
 */

/** Một đợt áp lực quanh MỘT mục tiêu trong MỘT vòng. */
export interface PressureEpisode {
  round: number;
  targetId: string;
  /** Người tố ĐẦU TIÊN trong vòng (theo thứ tự sourceId). */
  initiatorId: string;
  /** Mọi người tố target, gồm initiator, sort theo id. */
  accuserIds: string[];
  /** Mọi người bênh target (có thể trùng accuser), sort theo id. */
  defenderIds: string[];
  /**
   * Người SỐNG không hành động gì quanh target vòng này (không tố, không bênh,
   * không phải target). Người chết không nằm ở đây — im lặng của một người
   * chết không phải một lựa chọn.
   */
  silentIds: string[];
}

export interface DiscussionGraph {
  episodes: PressureEpisode[];
}

export function buildDiscussionGraph(
  input: { knowledge: BotKnowledgeView; state: { memories: readonly BotMemory[] } },
): DiscussionGraph {
  // Gom theo (round, target). SourceId là định danh tất định
  // (`bot-chat:{round}:{total}`), nên sort theo sourceId là thứ tự phát.
  const episodes = new Map<string, {
    round: number;
    targetId: string;
    accusers: Map<string, string>;
    defenders: Set<string>;
  }>();

  for (const memory of input.state.memories) {
    const isAccuse = memory.type === "ACCUSE";
    const isDefend = memory.type === "DEFEND";
    if ((!isAccuse && !isDefend) || !memory.targetId) continue;
    if (memory.targetId === memory.actorId) continue;

    const key = `${memory.round}:${memory.targetId}`;
    let episode = episodes.get(key);
    if (!episode) {
      episode = {
        round: memory.round,
        targetId: memory.targetId,
        accusers: new Map(),
        defenders: new Set(),
      };
      episodes.set(key, episode);
    }
    if (isAccuse) episode.accusers.set(memory.actorId, memory.sourceId);
    if (isDefend) episode.defenders.add(memory.actorId);
  }

  const aliveIds = new Set(
    input.knowledge.players.filter((player) => player.alive).map((player) => player.id),
  );

  const sorted = [...episodes.values()].sort(
    (left, right) =>
      left.round - right.round || left.targetId.localeCompare(right.targetId),
  );

  return {
    episodes: sorted.map((episode) => {
      const accuserIds = [...episode.accusers.keys()].sort();
      const defenderIds = [...episode.defenders].sort();
      const involved = new Set([episode.targetId, ...accuserIds, ...defenderIds]);
      const silentIds = [...aliveIds]
        .filter((id) => !involved.has(id))
        .sort();
      return {
        round: episode.round,
        targetId: episode.targetId,
        // Chỉ có bênh, không ai tố: đợt đó không có "khởi xướng tố" — nhưng
        // initiator vẫn phải là một người thật, nên fall về defender đầu.
        initiatorId:
          accuserIds.length > 0 ? initiatorOf(episode.accusers) : (defenderIds[0] ?? ""),
        accuserIds,
        defenderIds,
        silentIds,
      };
    }),
  };
}

/** id có sourceId nhỏ nhất — chính là người mở màn đợt áp lực. */
function initiatorOf(accusers: Map<string, string>): string {
  let bestId = "";
  let bestSource = "";
  for (const [actorId, sourceId] of accusers) {
    if (bestSource === "" || sourceId.localeCompare(bestSource) < 0) {
      bestId = actorId;
      bestSource = sourceId;
    }
  }
  return bestId;
}
