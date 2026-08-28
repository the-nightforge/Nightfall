import type { BeliefEntry, BotBrainState, BotMemory, BotPersonality } from "../types";

/**
 * Trần cho kho pinned. Role claim, counter-claim và Seer result bị giới hạn bởi
 * số người chơi thật (tối đa 15 người), nên trần này chỉ là chốt chặn cuối để
 * một parser lỗi không thể làm state phình vô hạn.
 */
const PINNED_LIMIT = 60;

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
    memories: [],
    relationships: {},
    currentTheory: null,
    currentTargets: [],
    confidence: 0,
    previousVotes: [],
    speechMemory: [],
    seenEventIds: [],
  };
}

/**
 * Ghi một memory đã cấu trúc. Không nhận raw chat: caller (analyzer) chịu trách
 * nhiệm rút gọn nội dung thành `data` tối thiểu trước khi tới đây.
 */
export function remember(state: BotBrainState, memory: BotMemory): void {
  const key = memoryKey(memory);
  if (state.memories.some((existing) => memoryKey(existing) === key)) return;

  // Copy để state không giữ tham chiếu tới object của caller: analyzer tái sử
  // dụng object của nó sẽ âm thầm viết lại lịch sử đã ghi.
  const stored: BotMemory = { ...memory, data: { ...memory.data } };
  state.memories.push(stored);

  if (!state.seenEventIds.includes(stored.sourceId)) {
    state.seenEventIds.push(stored.sourceId);
  }

  if (stored.type === "ROLE_CLAIM" || stored.type === "COUNTER_CLAIM") {
    state.claims.push(stored);
    if (state.claims.length > PINNED_LIMIT) state.claims.splice(0, state.claims.length - PINNED_LIMIT);
  }

  if (stored.type === "SEER_RESULT") {
    state.knownInformation.seerResults.push(stored);
    const seerResults = state.knownInformation.seerResults;
    if (seerResults.length > PINNED_LIMIT) seerResults.splice(0, seerResults.length - PINNED_LIMIT);
  }
}
