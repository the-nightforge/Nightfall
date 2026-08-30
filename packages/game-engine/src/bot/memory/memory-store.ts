import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BeliefEntry, BotBrainState, BotMemory, BotPersonality } from "../types";

/**
 * Ba loại này LUÔN là pinned fact, bất kể caller truyền gì. Ghim theo type chứ
 * không tin vào cờ của caller: kho mirror (`claims`, `seerResults`) và bước
 * prune cùng dựa trên một tiêu chí, nên hai bên không thể lệch nhau.
 */
const PINNED_TYPES = new Set<BotMemory["type"]>(["ROLE_CLAIM", "COUNTER_CLAIM", "SEER_RESULT"]);

/**
 * Hai memory là một khi cùng loại, cùng nguồn, cùng người làm và cùng mục tiêu.
 * Dùng source ID trong khoá là điều bắt buộc: nó khiến việc dựng lại context
 * nhiều lần trong cùng một pha không thể nhân đôi một sự kiện.
 */
export function memoryKey(memory: BotMemory): string {
  return `${memory.type}:${memory.sourceId}:${memory.actorId}:${memory.targetId ?? ""}`;
}

/**
 * Điểm khởi đầu là 0 chứ không phải 50: thang 0–100 ở đây đo lượng bằng chứng
 * đã tích luỹ, không phải xác suất một người là Sói. Người chưa làm gì thì
 * không có bằng chứng nào, nên mọi người lạ đều trung lập như nhau.
 */
function neutralBelief(): BeliefEntry {
  return { score: 0, reasons: [], lastUpdatedRound: 0 };
}

export function createBotBrainState(
  playerId: string,
  personality: BotPersonality,
  playerIds: readonly string[],
): BotBrainState {
  const suspicion: Record<string, BeliefEntry> = {};
  const trust: Record<string, BeliefEntry> = {};
  for (const id of playerIds) {
    // BOT không nghi ngờ chính mình: một entry cho self sẽ được decision layer
    // chấm điểm như mọi người khác và có thể khiến BOT tự đề cử mình.
    if (id === playerId) continue;
    suspicion[id] = neutralBelief();
    trust[id] = neutralBelief();
  }

  return {
    playerId,
    personality,
    suspicion,
    trust,
    knownInformation: { knownRoles: {}, seerResults: [] },
    claims: [],
    myClaim: null,
    memories: [],
    relationships: {},
    currentTheory: null,
    currentTargets: [],
    confidence: 0,
    previousVotes: [],
    previousNightActions: [],
    speechMemory: [],
    speechSequence: 0,
    repliedMessageIds: [],
    seenEventIds: [],
    appliedClaimEvidenceIds: [],
  };
}

/**
 * Ghi một memory đã cấu trúc. Không nhận raw chat: caller (analyzer) chịu trách
 * nhiệm rút gọn nội dung thành `data` tối thiểu trước khi tới đây.
 */
export function remember(
  state: BotBrainState,
  memory: BotMemory,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): void {
  const key = memoryKey(memory);
  if (state.memories.some((existing) => memoryKey(existing) === key)) return;

  // Copy để state không giữ tham chiếu tới object của caller: analyzer tái sử
  // dụng object của nó sẽ âm thầm viết lại lịch sử đã ghi.
  const stored: BotMemory = {
    ...memory,
    pinned: memory.pinned || PINNED_TYPES.has(memory.type),
    data: { ...memory.data },
  };
  state.memories.push(stored);

  if (!state.seenEventIds.includes(stored.sourceId)) {
    state.seenEventIds.push(stored.sourceId);
    if (state.seenEventIds.length > weights.limits.seenEvents) state.seenEventIds.shift();
  }

  if (stored.type === "ROLE_CLAIM" || stored.type === "COUNTER_CLAIM") {
    state.claims.push(stored);
  }
  if (stored.type === "SEER_RESULT") {
    state.knownInformation.seerResults.push(stored);
  }

  enforcePinnedBudget(state, weights.limits.pinned);
}

/**
 * Giữ tổng số pinned fact trong trần, và giữ ba kho (memories, claims,
 * seerResults) nói cùng một câu chuyện.
 *
 * Với tối đa 15 người thì số claim/soi hợp lệ không bao giờ chạm trần này; trần
 * chỉ tồn tại để một người chơi spam "tôi là dân" không thể chiếm hết ngân sách
 * memory của BOT. Bỏ cái CŨ nhất, vì cái mới nhất là cái đang được tranh luận.
 */
function enforcePinnedBudget(state: BotBrainState, limit: number): void {
  const pinned = state.memories.filter((memory) => memory.pinned);
  if (pinned.length <= limit) return;

  const evicted = new Set(pinned.slice(0, pinned.length - limit));
  state.memories = state.memories.filter((memory) => !evicted.has(memory));
  state.claims = state.claims.filter((memory) => !evicted.has(memory));
  state.knownInformation.seerResults = state.knownInformation.seerResults.filter(
    (memory) => !evicted.has(memory),
  );
}
