import type { QuestionOutcome, SelfPlayEvent, SpeechBlockReason } from "./selfplay";

/**
 * Sổ câu hỏi nhắm thẳng vào một người: người bị hỏi có đọc ra không, có được
 * lượt không, có bị phòng chặn không, và cuối cùng có đáp không.
 *
 * Tách khỏi closure của `runSelfPlay` để phòng thật đo được CÙNG một thứ bằng
 * CÙNG một luật (`docs/superpowers/specs/2026-09-10-production-bot-metrics-design.md`).
 * Chuyển nguyên, không đổi điều kiện hay thứ tự: ảnh vàng của self-play giữ
 * từng bit.
 *
 * Trạng thái là dữ liệu thuần - không `Map`, không closure - để server lưu được
 * vào envelope và khôi phục sau restart. Mảng giữ thứ tự chèn, đúng thứ tự mà
 * `Map` cũ duyệt, và thứ tự đó quyết định thứ tự các `QUESTION_OUTCOME`.
 *
 * THUẦN: không RNG, không đồng hồ, chỉ đọc những gì chỗ gọi truyền vào.
 */

export interface PendingQuestion {
  messageId: string;
  askerId: string;
  targetId: string;
  round: number;
  /** `null`: người được hỏi CHƯA quan sát chat nào có câu này. */
  recognized: boolean | null;
  /** Số lượt người được hỏi được nói SAU khi câu đã hiện trong chat. */
  turns: number;
  blocked: SpeechBlockReason | null;
  answered: boolean;
  spokeOther: boolean;
  /** Chỉ phòng thật đặt cờ này: người hỏi là người thật. */
  humanAsker?: true;
}

export interface QuestionLedgerState {
  open: PendingQuestion[];
}

export type QuestionOutcomeEvent = Extract<SelfPlayEvent, { kind: "QUESTION_OUTCOME" }>;

export function createQuestionLedger(): QuestionLedgerState {
  return { open: [] };
}

export function openQuestion(
  state: QuestionLedgerState,
  question: { messageId: string; askerId: string; targetId: string; round: number; humanAsker?: boolean },
): void {
  const fresh: PendingQuestion = {
    messageId: question.messageId,
    askerId: question.askerId,
    targetId: question.targetId,
    round: question.round,
    recognized: null,
    turns: 0,
    blocked: null,
    answered: false,
    spokeOther: false,
    ...(question.humanAsker ? { humanAsker: true as const } : {}),
  };
  // `Map.set` trên khoá đã có thì thay giá trị mà giữ vị trí. Làm y hệt.
  const index = state.open.findIndex((item) => item.messageId === question.messageId);
  if (index === -1) state.open.push(fresh);
  else state.open[index] = fresh;
}

/** Sau mỗi `observe`: parser của người được hỏi có nhận ra câu hỏi không. */
export function markObserved(
  state: QuestionLedgerState,
  targetId: string,
  visibleChat: readonly { id: string }[],
  memories: readonly { sourceId: string; targetId?: string }[],
): void {
  for (const question of state.open) {
    if (question.targetId !== targetId || question.recognized !== null) continue;
    if (!visibleChat.some((m) => m.id === question.messageId)) continue;
    question.recognized = memories.some(
      (memory) => memory.sourceId === question.messageId && memory.targetId === targetId,
    );
  }
}

/** Trước mỗi lượt nói: người được hỏi có thêm một cơ hội đáp. */
export function markSpeechTurn(
  state: QuestionLedgerState,
  targetId: string,
  isInChat: (messageId: string) => boolean,
): void {
  for (const question of state.open) {
    if (question.targetId === targetId && isInChat(question.messageId)) question.turns += 1;
  }
}

/** Câu đáp bị PHÒNG chặn (hạn mức, chuỗi, số phản hồi). */
export function markBlocked(
  state: QuestionLedgerState,
  replyToMessageId: string | undefined,
  speakerId: string,
  reason: SpeechBlockReason,
): void {
  if (!replyToMessageId) return;
  const asked = state.open.find((item) => item.messageId === replyToMessageId);
  if (asked && asked.targetId === speakerId) asked.blocked = reason;
}

/**
 * Sau khi người được hỏi phát một câu: câu đó ĐÁP câu hỏi, hay là chuyện khác?
 * Chỉ tính khi câu hỏi đã hiện trong chat - nói trước khi thấy câu hỏi không
 * phải là "chọn nói việc khác".
 */
export function markSpoke(
  state: QuestionLedgerState,
  speakerId: string,
  replyToMessageId: string | undefined,
  isInChat: (messageId: string) => boolean,
): void {
  for (const question of state.open) {
    if (question.targetId !== speakerId || !isInChat(question.messageId)) continue;
    if (replyToMessageId === question.messageId) question.answered = true;
    else question.spokeOther = true;
  }
}

/** Chốt số phận mọi câu hỏi đang mở rồi làm rỗng sổ. Xem `QuestionOutcome`. */
export function settleQuestions(state: QuestionLedgerState): QuestionOutcomeEvent[] {
  const events = state.open.map((question): QuestionOutcomeEvent => {
    let outcome: QuestionOutcome;
    if (question.answered) outcome = "ANSWERED";
    else if (question.blocked !== null) outcome = "BLOCKED_ROOM";
    else if (question.recognized === null) outcome = "UNDETERMINED";
    else if (!question.recognized) outcome = "NOT_PARSED";
    else if (question.turns === 0) outcome = "NO_TURN";
    else outcome = question.spokeOther ? "DECLINED_SPOKE_OTHER" : "DECLINED_SILENT";
    // Thứ tự khoá phải đúng như literal cũ trong `runSelfPlay`: ảnh vàng băm
    // `JSON.stringify` của sự kiện.
    return {
      kind: "QUESTION_OUTCOME",
      round: question.round,
      messageId: question.messageId,
      askerId: question.askerId,
      targetId: question.targetId,
      outcome,
      ...(question.humanAsker ? { humanAsker: true as const } : {}),
    };
  });
  state.open = [];
  return events;
}
