import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotBrainState, BotSpeechIntention, BotSpeechRecord } from "../types";
import { openingOf, speechSemanticFingerprint, speechTextFingerprint } from "./fingerprint";

/**
 * Trí nhớ hội thoại của một BOT.
 *
 * Nguyên tắc: **không giữ raw chat**. Những gì lưu lại là loại ý định, mục
 * tiêu, message được phản hồi, tập nguồn bằng chứng, và hai vân tay. Đủ để trả
 * lời câu hỏi "mình nói cái này rồi chưa" mà không biến `BotBrainState` thành
 * một bản sao thứ hai của chat log.
 *
 * THUẦN: mọi hàm ở đây nhận `state` và ghi vào nó, không đọc gì từ bên ngoài.
 */

/**
 * Ghi lại một ý định vừa phát ra.
 *
 * `text` là tuỳ chọn vì lõi deterministic KHÔNG biết câu chữ: nó chốt ý định,
 * còn provider (hoặc bảng mẫu) mới sinh ra chữ. Khi chỗ gọi có văn bản thật thì
 * truyền vào, và bản ghi có thêm vân tay văn bản + cách mở đầu.
 */
export function recordSpeechIntention(
  state: BotBrainState,
  intention: BotSpeechIntention,
  round: number,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
  text?: string,
): BotSpeechRecord {
  const record: BotSpeechRecord = {
    seq: state.speechSequence,
    round,
    kind: intention.kind,
    targetId: intention.targetId ?? null,
    replyToMessageId: intention.replyToMessageId ?? null,
    sourceIds: intention.evidence.map((item) => item.sourceId),
    topic: intention.topic ?? null,
    tone: intention.tone,
    textFingerprint: text === undefined ? null : speechTextFingerprint(text),
    semanticFingerprint: speechSemanticFingerprint(intention),
    opening: text === undefined ? null : openingOf(text),
  };

  state.speechSequence += 1;
  state.speechMemory.push(record);
  while (state.speechMemory.length > weights.conversation.memoryWindow) {
    state.speechMemory.shift();
  }

  return record;
}

/**
 * Ý này đã nói gần đây chưa?
 *
 * Cửa sổ KÉP và cả hai điều kiện phải cùng đúng thì mới tính là "gần đây":
 * trong `semanticCooldownRounds` vòng gần nhất **và** trong
 * `semanticCooldownCount` bản ghi cuối. Đặt cả hai về 0 là tắt hẳn cơ chế, tức
 * quay lại đúng hành vi Phase 3.
 */
export function hasRecentSemantic(
  state: BotBrainState,
  fingerprint: string,
  round: number,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): boolean {
  const { semanticCooldownRounds, semanticCooldownCount } = weights.conversation;
  if (semanticCooldownRounds <= 0 || semanticCooldownCount <= 0) return false;

  return state.speechMemory
    .slice(-semanticCooldownCount)
    .some(
      (record) =>
        record.semanticFingerprint === fingerprint &&
        round - record.round < semanticCooldownRounds,
    );
}

/** Vân tay văn bản của các câu gần nhất, để bảng mẫu tránh chọn lại. */
export function recentTextFingerprints(state: BotBrainState, count: number): string[] {
  return state.speechMemory
    .slice(-count)
    .map((record) => record.textFingerprint)
    .filter((value): value is string => value !== null);
}

/**
 * Bao nhiêu lượt nói gần nhất được xét khi hỏi "mình vừa mở đầu kiểu này rồi".
 *
 * Năm, không phải cả cửa sổ trí nhớ: cách mở đầu là thứ người nghe quên nhanh
 * hơn nội dung. Cấm dài hơn thì một bot ba giọng nói cũng cạn cách mở đầu
 * trước khi hết ngày.
 */
export const RECENT_OPENING_WINDOW = 5;

/** Cách mở đầu gần nhất; đầu vào cho yêu cầu "đừng mở đầu giống lần trước". */
export function recentOpenings(
  state: BotBrainState,
  count: number = RECENT_OPENING_WINDOW,
): string[] {
  return state.speechMemory
    .slice(-count)
    .map((record) => record.opening)
    .filter((value): value is string => value !== null);
}

/**
 * Cách mở đầu này đã dùng trong `RECENT_OPENING_WINDOW` lượt gần nhất chưa?
 *
 * Chỉ bản ghi CÓ văn bản mới tính - lõi ghi ý định trước khi biết câu chữ, và
 * một bản ghi chưa render thì chưa mở đầu bằng gì cả.
 *
 * Lưu ý chỗ đứng: hàm này sống ở tầng TRÍ NHỚ, không ở `planSpeech`. Planner
 * chốt ý định trước khi có câu chữ (nhà cung cấp hoặc bảng mẫu mới sinh ra
 * chữ), nên nó không biết một ý định sẽ mở đầu bằng gì; đoán bằng bảng mẫu thì
 * sai ở production, nơi câu là của nhà cung cấp. Luật "không mở đầu như 5 lượt
 * trước" vì vậy được áp ở đúng hai chỗ có chữ: `renderSpeechTemplate`
 * (`avoidOpenings`) và cổng ở `speech-renderer` phía server.
 */
export function hasRecentOpening(
  state: BotBrainState,
  opening: string,
  count: number = RECENT_OPENING_WINDOW,
): boolean {
  return recentOpenings(state, count).includes(opening);
}

/**
 * Nguồn bằng chứng đã dùng trong `count` lượt nói gần nhất.
 *
 * Cắt theo cửa sổ chứ không trải phẳng cả ván: một danh sách "đừng lặp lại" dài
 * bằng độ dài ván vừa làm prompt phình vừa cấm BOT nhắc lại một luận điểm từ
 * vòng 1 ở vòng 8, lúc nó đã lại đáng nhắc.
 */
export function recentSpeechSourceIds(state: BotBrainState, count: number): string[] {
  const seen = new Set<string>();
  for (const record of state.speechMemory.slice(-count)) {
    for (const sourceId of record.sourceIds) seen.add(sourceId);
  }
  return [...seen];
}

/** Số câu BOT đã nói trong một vòng; đầu vào cho hạn mức mỗi ngày. */
export function speechCountInRound(state: BotBrainState, round: number): number {
  return state.speechMemory.filter((record) => record.round === round).length;
}

export function hasReplied(state: BotBrainState, messageId: string): boolean {
  return state.repliedMessageIds.includes(messageId);
}

/**
 * Đánh dấu đã đáp một câu.
 *
 * Trần rộng hơn `memoryWindow` bốn lần có chủ đích: một message phải nằm trong
 * danh sách này lâu hơn tuổi thọ của một bản ghi phát ngôn, nếu không thì BOT
 * sẽ quên là mình đã đáp rồi và đáp lại lần nữa.
 */
export function markReplied(
  state: BotBrainState,
  messageId: string,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): void {
  if (state.repliedMessageIds.includes(messageId)) return;
  state.repliedMessageIds.push(messageId);
  while (state.repliedMessageIds.length > weights.conversation.memoryWindow * 4) {
    state.repliedMessageIds.shift();
  }
}
