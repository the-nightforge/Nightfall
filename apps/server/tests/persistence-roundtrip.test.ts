import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: { gameResult: { create: async () => undefined } } }));

const { startGame } = await import("../src/game/machine");
const { runPendingStep } = await import("../src/game/steps");
const { serializeRoom } = await import("../src/persistence/serialize");
const { restoreRoomFromEnvelope } = await import("../src/persistence/restore");
const { roomEnvelopeSchema } = await import("../src/persistence/schema");
const { botSessionFor, clearBotSession } = await import("../src/bots/session-registry");
const { botBudgetUsed, resetBotBudget } = await import("../src/bots");
const { discussionSkipVotes } = await import("../src/game/discussion-skip");
const { startBotSpeechLog } = await import("../src/game/bot-speech-log");
const { openQuestion } = await import("@masoi/game-engine");

function lobby(code = "ROUND"): Room {
  return {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "LOBBY",
    members: Array.from({ length: 8 }, (_, i) => ({
      playerId: `p${i + 1}`,
      name: `Người ${i + 1}`,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: i >= 4,
      avatarUrl: null,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: null,
    chatLog: [],
    createdAt: 1_000,
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

/** Đưa phòng vào giữa đêm, có sẵn brain bot và một ít state phụ. */
function nightRoom(code = "ROUND"): Room {
  const room = lobby(code);
  clearBotSession(code);
  resetBotBudget(code);
  startGame(room);
  runPendingStep(room, room.pendingStep!); // ROLE_REVEAL -> NIGHT

  const bot = room.members.find((m) => m.isBot)!;
  botSessionFor(room).runtimeFor(bot.playerId).state.suspicion["p1"]!.score = 23;
  botSessionFor(room).rngFor(bot.playerId, "vote-schedule")();
  discussionSkipVotes.set(code, new Set(["p1"]));

  return room;
}

beforeEach(() => {
  discussionSkipVotes.clear();
});

describe("round-trip snapshot phòng", () => {
  it("envelope sinh ra hợp lệ với schema", () => {
    const room = nightRoom("RTA01");
    const parsed = roomEnvelopeSchema.safeParse(serializeRoom(room, 1));
    if (!parsed.success) console.error(parsed.error.issues);
    expect(parsed.success).toBe(true);
  });

  it("giữ nguyên vòng, pha, hạn chót và vai của từng người", () => {
    const room = nightRoom("RTA02");
    const before = room.engine!.getState();

    const restored = restoreRoomFromEnvelope(serializeRoom(room, 3));
    const after = restored.engine!.getState();

    expect(after.phase).toBe(before.phase);
    expect(after.round).toBe(before.round);
    expect(after.phaseEndsAt).toBe(before.phaseEndsAt);
    expect(after.players).toEqual(before.players);
  });

  it("giữ nguyên phiếu cắn của Sói và các lượt đã dùng", () => {
    const room = nightRoom("RTA03");
    const wolf = room.engine!.state.players.find((p) => p.role === "WEREWOLF")!;
    const victim = room.engine!.state.players.find((p) => p.role !== "WEREWOLF")!;
    room.engine!.submitNightAction(wolf.id, "KILL", victim.id);

    const restored = restoreRoomFromEnvelope(serializeRoom(room, 4));

    expect(restored.engine!.state.night.wolfVotes).toEqual({ [wolf.id]: victim.id });
  });

  it("giữ nguyên bước chờ và số thứ tự pha", () => {
    const room = nightRoom("RTA04");

    const restored = restoreRoomFromEnvelope(serializeRoom(room, 5));

    expect(restored.pendingStep).toEqual(room.pendingStep);
    expect(restored.phaseSeq).toBe(room.phaseSeq);
    expect(restored.gameId).toBe(room.gameId);
  });

  it("khôi phục brain của bot và con trỏ RNG", () => {
    const room = nightRoom("RTA05");
    const bot = room.members.find((m) => m.isBot)!;
    const envelope = serializeRoom(room, 6);

    clearBotSession(room.code);
    const restored = restoreRoomFromEnvelope(envelope);

    expect(botSessionFor(restored).runtimeFor(bot.playerId).state.suspicion["p1"]!.score).toBe(23);
    expect(envelope.room.botSession!.cursors[`${bot.playerId}:vote-schedule`]).toBe(1);
  });

  it("khôi phục ngân sách AI đã tiêu", () => {
    const room = nightRoom("RTA06");
    const envelope = serializeRoom(room, 7);
    envelope.room.governorCalls = 9;

    restoreRoomFromEnvelope(envelope);

    expect(botBudgetUsed(room.code)).toBe(9);
  });

  it("khôi phục phiếu bỏ qua thảo luận", () => {
    const room = nightRoom("RTA07");
    const envelope = serializeRoom(room, 8);

    discussionSkipVotes.clear();
    restoreRoomFromEnvelope(envelope);

    expect([...(discussionSkipVotes.get(room.code) ?? [])]).toEqual(["p1"]);
  });

  it("mọi người được coi là đang mất kết nối cho tới khi họ nối lại", () => {
    const room = nightRoom("RTA08");

    const restored = restoreRoomFromEnvelope(serializeRoom(room, 9));

    expect(restored.members.every((m) => !m.connected)).toBe(true);
    expect(restored.members.every((m) => typeof m.disconnectedAt === "number")).toBe(true);
  });

  it("phòng ở sảnh chờ không kéo theo engine hay session bot", () => {
    const room = lobby("RTA09");

    const envelope = serializeRoom(room, 1);
    const restored = restoreRoomFromEnvelope(envelope);

    expect(envelope.room.engineState).toBeNull();
    expect(restored.engine).toBeNull();
    expect(restored.status).toBe("LOBBY");
  });
});

describe("sổ lời nói của bot qua restart", () => {
  it("sổ, câu hỏi đang mở, cờ trần và số lỗi sống qua serialize → schema → restore", () => {
    const room = nightRoom("LOGRT");
    startBotSpeechLog(room);
    room.speechLog!.push({
      kind: "SPEECH_BLOCKED",
      round: 1,
      actorId: "p5",
      speech: "REPLY",
      replyToMessageId: "m1",
      reason: "CHAIN_DEPTH",
    });
    openQuestion(room.questionLedger!, {
      messageId: "m1",
      askerId: "p6",
      targetId: "p5",
      round: 1,
      humanAsker: true,
    });
    room.recorderErrors = 2;

    const envelope = roomEnvelopeSchema.parse(JSON.parse(JSON.stringify(serializeRoom(room, 7))));
    const restored = restoreRoomFromEnvelope(envelope);

    expect(restored.speechLog).toEqual(room.speechLog);
    expect(restored.questionLedger).toEqual(room.questionLedger);
    expect(restored.botSpeechLogTruncated).toBe(false);
    expect(restored.recorderErrors).toBe(2);
  });

  it("envelope ghi trước khi có sổ đọc lên thành null, KHÔNG phải [] — ván đó không được đo", () => {
    const room = nightRoom("LOGOLD");
    const raw = JSON.parse(JSON.stringify(serializeRoom(room, 8)));
    for (const key of ["speechLog", "questionLedger", "botSpeechLogTruncated", "recorderErrors"]) {
      delete raw.room[key];
    }
    const restored = restoreRoomFromEnvelope(roomEnvelopeSchema.parse(raw));
    expect(restored.speechLog).toBeNull();
    expect(restored.questionLedger).toBeNull();
  });
});
