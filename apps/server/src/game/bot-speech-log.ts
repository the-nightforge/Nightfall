import {
  analyzeChat,
  createQuestionLedger,
  markBlocked,
  markObserved,
  markSpeechTurn,
  markSpoke,
  openQuestion,
  settleQuestions,
  speechSemanticFingerprint,
  speechShapeFingerprint,
  speechTextFingerprint,
  type BotSpeechIntention,
  type QuestionLedgerState,
  type SelfPlayEvent,
  type SpeechBlockReason,
} from "@masoi/game-engine";
import type { Room } from "../rooms/store";
import { MAX_ARCHIVED_MESSAGES } from "./match-chat";

/**
 * Sổ lời nói của bot trong một ván THẬT, ghi đúng hình dạng sự kiện của
 * self-play để lúc hết ván `collectMetrics` đo nó bằng đúng một định nghĩa
 * (`docs/superpowers/specs/2026-09-10-production-bot-metrics-design.md`).
 *
 * Mọi móc ở đây đều đi qua `record`: không có sổ thì không làm gì, và móc nào
 * ném thì bị nuốt rồi ĐẾM vào `recorderErrors`. Một lỗi của bộ ghi không bao giờ
 * được làm mất một câu nói - nhưng cũng không được im lặng, nếu không một bộ
 * ghi gãy sẽ trông y hệt một ván không ai hỏi ai.
 */

export type BotSpeechLogEvent = Extract<
  SelfPlayEvent,
  { kind: "SPEECH" | "SPEECH_BLOCKED" | "QUESTION_OUTCOME" }
>;

/**
 * Trên server, câu hỏi chỉ được mở SAU `pushChat`, nên nó luôn đã nằm trong
 * chat. `chatHas` của self-play tồn tại vì ở đó câu mới vào chat chung sau cả
 * lượt; ở đây điều kiện đó luôn đúng.
 */
const IN_CHAT = (): boolean => true;

export function startBotSpeechLog(room: Room): void {
  room.speechLog = [];
  room.questionLedger = createQuestionLedger();
  room.botSpeechLogTruncated = false;
  room.recorderErrors = 0;
}

export function discardBotSpeechLog(room: Room): void {
  room.speechLog = null;
  room.questionLedger = null;
  room.botSpeechLogTruncated = false;
  room.recorderErrors = 0;
}

function record(
  room: Room,
  write: (log: BotSpeechLogEvent[], ledger: QuestionLedgerState) => void,
): void {
  if (!room.speechLog || !room.questionLedger) return;
  try {
    write(room.speechLog, room.questionLedger);
  } catch {
    room.recorderErrors = (room.recorderErrors ?? 0) + 1;
  }
}

function push(room: Room, log: BotSpeechLogEvent[], event: BotSpeechLogEvent): void {
  if (log.length >= MAX_ARCHIVED_MESSAGES) {
    room.botSpeechLogTruncated = true;
    return;
  }
  log.push(event);
}

function isBot(room: Room, playerId: string): boolean {
  return room.members.find((member) => member.playerId === playerId)?.isBot === true;
}

/** Sau mỗi `runtime.observe` của một bot. */
export function noteBotObserved(
  room: Room,
  botId: string,
  visibleChat: readonly { id: string }[],
  memories: readonly { sourceId: string; targetId?: string }[],
): void {
  record(room, (_log, ledger) => markObserved(ledger, botId, visibleChat, memories));
}

/** Trước lượt nói của một bot - CHỈ ở pha thảo luận, như self-play. */
export function noteBotSpeechTurn(room: Room, botId: string): void {
  record(room, (_log, ledger) => markSpeechTurn(ledger, botId, IN_CHAT));
}

/** Ý định đã chốt mà phòng không cho phát. */
export function noteBotBlocked(
  room: Room,
  botId: string,
  round: number,
  speech: BotSpeechIntention,
  reason: SpeechBlockReason,
): void {
  record(room, (log, ledger) => {
    push(room, log, {
      kind: "SPEECH_BLOCKED",
      round,
      actorId: botId,
      speech: speech.kind,
      replyToMessageId: speech.replyToMessageId ?? null,
      reason,
    });
    markBlocked(ledger, speech.replyToMessageId, botId, reason);
  });
}

/** Sau khi câu của bot đã nằm trong chat (`pushChat`). */
export function noteBotSpoke(
  room: Room,
  line: {
    botId: string;
    round: number;
    messageId: string;
    text: string;
    speech: BotSpeechIntention;
    chainDepth: number;
    fromTemplate: boolean;
  },
): void {
  record(room, (log, ledger) => {
    const { speech } = line;
    const names = (room.engine?.state.players ?? []).map((player) => player.name);
    push(room, log, {
      kind: "SPEECH",
      round: line.round,
      actorId: line.botId,
      messageId: line.messageId,
      speech: speech.kind,
      targetId: speech.targetId ?? null,
      replyToMessageId: speech.replyToMessageId ?? null,
      chainDepth: line.chainDepth,
      tone: speech.tone,
      topic: speech.topic ?? null,
      text: line.text,
      textFingerprint: speechTextFingerprint(line.text),
      shapeFingerprint: speechShapeFingerprint(line.text, names),
      semanticFingerprint: speechSemanticFingerprint(speech),
      evidenceSourceIds: speech.evidence.map((item) => item.sourceId),
      fromTemplate: line.fromTemplate,
      claimedRole: speech.claimedRole ?? null,
    });
    markSpoke(ledger, line.botId, speech.replyToMessageId, IN_CHAT);
    // Chỉ mở khi người bị hỏi là BOT: người thật không có `BotRuntime` để
    // `markObserved` đọc, nên câu hỏi nhắm vào họ luôn chốt `UNDETERMINED` và
    // làm bẩn bảng của bot. Self-play toàn bot nên luật này không đổi gì ở đó.
    if (
      (speech.kind === "QUESTION" || speech.kind === "ASK_EVIDENCE") &&
      speech.targetId !== undefined &&
      speech.targetId !== line.botId &&
      isBot(room, speech.targetId)
    ) {
      openQuestion(ledger, {
        messageId: line.messageId,
        askerId: line.botId,
        targetId: speech.targetId,
        round: line.round,
      });
    }
  });
}

/** Sau khi câu của một NGƯỜI THẬT đã nằm trong chat. */
export function noteHumanChat(
  room: Room,
  message: { id: string; playerId: string; text: string; at: number },
  channel: string,
): void {
  record(room, (_log, ledger) => {
    const engine = room.engine;
    if (!engine || channel !== "day") return;
    if (engine.state.phase !== "DAY_DISCUSSION" && engine.state.phase !== "DEFENSE") return;
    if (isBot(room, message.playerId)) return;

    const players = engine.state.players.map((player) => ({
      id: player.id,
      name: player.name,
      alive: player.alive,
    }));
    const memories = analyzeChat(
      [{ id: message.id, actorId: message.playerId, text: message.text, at: message.at }],
      players,
    );
    // Đúng MỘT câu hỏi cho mỗi câu chat: sổ khoá theo `messageId`, như self-play.
    // Một câu gọi hai bot thì bot đầu tiên parser đọc ra được giữ.
    const asked = memories.find(
      (memory) =>
        memory.type === "DIRECT_QUESTION" &&
        memory.targetId !== undefined &&
        players.find((player) => player.id === memory.targetId)?.alive === true &&
        isBot(room, memory.targetId),
    );
    if (!asked?.targetId) return;
    openQuestion(ledger, {
      messageId: message.id,
      askerId: message.playerId,
      targetId: asked.targetId,
      round: engine.state.round,
      humanAsker: true,
    });
  });
}

/**
 * Chốt câu hỏi của ngày. Chỉ hai chỗ gọi: `endVoting` ngay trước
 * `resolveNomination` (đúng vị trí chốt của self-play), và `beginNight` khi pha
 * đang rời là `DAY_DISCUSSION` (ngày không có bỏ phiếu).
 */
export function settleBotQuestions(room: Room): void {
  record(room, (log, ledger) => {
    for (const event of settleQuestions(ledger)) push(room, log, event);
  });
}
