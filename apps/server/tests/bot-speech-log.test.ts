import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { GameEngine, speechShapeFingerprint, type BotSpeechIntention } from "@masoi/game-engine";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

vi.mock("../src/db", () => ({ prisma: {} }));
vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

const log = await import("../src/game/bot-speech-log");
const { MAX_ARCHIVED_MESSAGES } = await import("../src/game/match-chat");

const PLAYERS = [
  { id: "h1", name: "An", isBot: false },
  { id: "h2", name: "Dũng", isBot: false },
  { id: "b1", name: "Bình", isBot: true },
  { id: "b2", name: "Chi", isBot: true },
  { id: "b3", name: "Em", isBot: true },
  { id: "b4", name: "Giang", isBot: true },
];

function room(): Room {
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1 };
  const engine = GameEngine.create(PLAYERS, config, 1_000);
  engine.state.phase = "DAY_DISCUSSION";
  engine.state.round = 2;
  return {
    ...ROOM_SCAFFOLD,
    code: "LOGGR",
    hostId: "h1",
    status: "IN_GAME",
    members: PLAYERS.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: !p.isBot,
      isBot: p.isBot,
    })),
    config,
    engine,
    chatLog: [],
    createdAt: 0,
  };
}

function intention(over: Partial<BotSpeechIntention> = {}): BotSpeechIntention {
  return { kind: "ACCUSE", targetId: "b2", confidence: 0.7, evidence: [], tone: "FIRM", ...over };
}

function spoke(r: Room, over: Partial<Parameters<typeof log.noteBotSpoke>[1]> = {}): void {
  log.noteBotSpoke(r, {
    botId: "b1",
    round: 2,
    messageId: "bot-chat:2:0",
    text: "t nghi Chi",
    speech: intention(),
    chainDepth: 0,
    fromTemplate: false,
    ...over,
  });
}

describe("bot-speech-log — không có sổ thì không làm gì", () => {
  it("phòng đọc từ envelope cũ (sổ null): mọi móc im lặng, không ném", () => {
    const r = room();
    r.speechLog = null;
    r.questionLedger = null;
    spoke(r);
    log.noteHumanChat(r, { id: "m1", playerId: "h1", text: "Bình ơi sao im thế", at: 1 }, "day");
    log.settleBotQuestions(r);
    expect(r.speechLog).toBeNull();
    expect(r.recorderErrors ?? 0).toBe(0);
  });
});

describe("bot-speech-log — câu của bot", () => {
  it("ghi một SPEECH đúng hình dạng self-play", () => {
    const r = room();
    log.startBotSpeechLog(r);
    spoke(r);
    expect(r.speechLog).toHaveLength(1);
    const event = r.speechLog![0]!;
    expect(event).toMatchObject({
      kind: "SPEECH",
      round: 2,
      actorId: "b1",
      messageId: "bot-chat:2:0",
      speech: "ACCUSE",
      targetId: "b2",
      replyToMessageId: null,
      chainDepth: 0,
      tone: "FIRM",
      topic: null,
      text: "t nghi Chi",
      fromTemplate: false,
      claimedRole: null,
    });
    expect(event.kind === "SPEECH" && event.shapeFingerprint).toBe(
      speechShapeFingerprint("t nghi Chi", PLAYERS.map((p) => p.name)),
    );
  });

  it("bot hỏi bot thì mở câu hỏi; bot hỏi người thật thì KHÔNG", () => {
    const r = room();
    log.startBotSpeechLog(r);
    spoke(r, { messageId: "q-bot", speech: intention({ kind: "QUESTION", targetId: "b3" }) });
    spoke(r, { messageId: "q-human", speech: intention({ kind: "QUESTION", targetId: "h1" }) });
    expect(r.questionLedger!.open.map((q) => q.messageId)).toEqual(["q-bot"]);
  });

  it("bị phòng chặn: ghi SPEECH_BLOCKED và đánh dấu câu hỏi đang chờ", () => {
    const r = room();
    log.startBotSpeechLog(r);
    spoke(r, { messageId: "q1", speech: intention({ kind: "QUESTION", targetId: "b3" }) });
    log.noteBotObserved(r, "b3", [{ id: "q1" }], [{ sourceId: "q1", targetId: "b3" }]);
    log.noteBotBlocked(r, "b3", 2, intention({ kind: "REPLY", replyToMessageId: "q1" }), "REPLIES_PER_MESSAGE");
    log.settleBotQuestions(r);
    expect(r.speechLog!.map((e) => e.kind)).toEqual(["SPEECH", "SPEECH_BLOCKED", "QUESTION_OUTCOME"]);
    expect(r.speechLog!.at(-1)).toMatchObject({ outcome: "BLOCKED_ROOM" });
  });
});

describe("bot-speech-log — người thật hỏi bot", () => {
  it("mở câu hỏi có cờ humanAsker; bot đáp thì ANSWERED", () => {
    const r = room();
    log.startBotSpeechLog(r);
    log.noteHumanChat(r, { id: "hq", playerId: "h1", text: "Bình ơi sao im thế", at: 1 }, "day");
    expect(r.questionLedger!.open).toEqual([expect.objectContaining({ messageId: "hq", targetId: "b1", humanAsker: true })]);

    log.noteBotObserved(r, "b1", [{ id: "hq" }], [{ sourceId: "hq", targetId: "b1" }]);
    log.noteBotSpeechTurn(r, "b1");
    spoke(r, { messageId: "ans", speech: intention({ kind: "REPLY", targetId: "h1", replyToMessageId: "hq" }) });
    log.settleBotQuestions(r);
    expect(r.speechLog!.at(-1)).toMatchObject({ kind: "QUESTION_OUTCOME", outcome: "ANSWERED", humanAsker: true });
  });

  it("ngoài pha ngày, ngoài kênh day, hay người hỏi là bot: không mở gì", () => {
    const r = room();
    log.startBotSpeechLog(r);
    log.noteHumanChat(r, { id: "x1", playerId: "h1", text: "Bình ơi sao im thế", at: 1 }, "dead");
    log.noteHumanChat(r, { id: "x2", playerId: "b2", text: "Bình ơi sao im thế", at: 1 }, "day");
    r.engine!.state.phase = "VOTING";
    log.noteHumanChat(r, { id: "x3", playerId: "h1", text: "Bình ơi sao im thế", at: 1 }, "day");
    expect(r.questionLedger!.open).toEqual([]);
  });
});

describe("bot-speech-log — lỗi và trần", () => {
  it("móc ném thì câu nói vẫn đi, lỗi được ĐẾM chứ không nuốt im", () => {
    const r = room();
    log.startBotSpeechLog(r);
    spoke(r, { messageId: "q1", speech: intention({ kind: "QUESTION", targetId: "b3" }) });
    const broken = null as unknown as { sourceId: string }[];
    expect(() => log.noteBotObserved(r, "b3", [{ id: "q1" }], broken)).not.toThrow();
    expect(r.recorderErrors).toBe(1);
  });

  it("chạm trần thì ngừng ghi và đánh dấu truncated", () => {
    const r = room();
    log.startBotSpeechLog(r);
    const filler = { kind: "SPEECH_BLOCKED", round: 1, actorId: "b1", speech: "REPLY", replyToMessageId: null, reason: "CHAIN_DEPTH" } as const;
    r.speechLog = Array.from({ length: MAX_ARCHIVED_MESSAGES }, () => ({ ...filler }));
    spoke(r);
    expect(r.speechLog).toHaveLength(MAX_ARCHIVED_MESSAGES);
    expect(r.botSpeechLogTruncated).toBe(true);
  });

  it("về sảnh thì bỏ sổ", () => {
    const r = room();
    log.startBotSpeechLog(r);
    spoke(r);
    log.discardBotSpeechLog(r);
    expect(r.speechLog).toBeNull();
    expect(r.questionLedger).toBeNull();
  });
});

describe("bot-speech-log — chốt khi rời thảo luận", () => {
  function withOpenQuestion(phase: "DAY_DISCUSSION" | "VOTING" | "DEFENSE"): Room {
    const r = room();
    log.startBotSpeechLog(r);
    log.noteHumanChat(r, { id: "hq", playerId: "h1", text: "Bình ơi sao im thế", at: 1 }, "day");
    r.engine!.state.phase = phase;
    return r;
  }

  it("đang ở thảo luận (ngày không bỏ phiếu): chốt", () => {
    const r = withOpenQuestion("DAY_DISCUSSION");
    log.settleBotQuestionsIfLeavingDiscussion(r);
    expect(r.questionLedger!.open).toEqual([]);
    expect(r.speechLog!.map((e) => e.kind)).toEqual(["QUESTION_OUTCOME"]);
  });

  it("rời phiên xử hay bỏ phiếu: KHÔNG chốt — câu hỏi chờ tới lần chốt hôm sau, như self-play", () => {
    for (const phase of ["VOTING", "DEFENSE"] as const) {
      const r = withOpenQuestion(phase);
      log.settleBotQuestionsIfLeavingDiscussion(r);
      expect(r.questionLedger!.open, phase).toHaveLength(1);
      expect(r.speechLog, phase).toEqual([]);
    }
  });
});
