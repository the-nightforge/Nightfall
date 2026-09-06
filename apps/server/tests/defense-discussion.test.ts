import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameEngine,
  createSeededRng,
  planDefenseSpeakers,
  shouldSpeakInDefense,
} from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type ChatMessage, type Role } from "@masoi/shared";
import type { Attempt, DaySpeechDecision, SpeechRequest } from "../src/bots/types";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

/**
 * Scheduler DEFENSE đa bot (Task 2).
 *
 * Đi qua đường thật như `jester-defense.test.ts`: `endVoting` thật,
 * `BotRuntime` thật, `renderBotSpeech` thật, chỉ nhà cung cấp LLM bị thay
 * bằng bản luôn hỏng để ép rơi về bảng mẫu tất định.
 */

const brainControl = vi.hoisted(() => ({
  requests: [] as SpeechRequest[],
  reply: null as string | null,
}));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({
      name: "test",
      renderDaySpeech: async (request: SpeechRequest): Promise<Attempt<DaySpeechDecision>> => {
        brainControl.requests.push(request);
        if (brainControl.reply === null) return { ok: false };
        return { ok: true, value: { chat: brainControl.reply } };
      },
    }),
  };
});

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));

const broadcast = vi.hoisted(() => ({ chats: [] as ChatMessage[] }));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: (_ids: string[], _event: string, message: ChatMessage) => {
    broadcast.chats.push(message);
  },
}));

vi.mock("../src/db", () => ({ prisma: {} }));

await import("../src/game/machine");
const { armStep, runPendingStep } = await import("../src/game/steps");
const { botSessionFor, clearBotSession, startBotSession } = await import(
  "../src/bots/session-registry"
);
const { buildBotDecisionContext } = await import("../src/bots/context");

/**
 * Phòng đang bỏ phiếu, cả làng dồn phiếu vào p2. p2 là Sói bị cáo (bot),
 * p3 là đồng bọn Sói (bot, phải bênh p2), p4 là Dân (bot), còn lại người thật.
 */
function votingRoom(code: string): Room {
  const players = [
    { id: "p1", name: "Người 1", isBot: false },
    { id: "p2", name: "Bị Cáo", isBot: true },
    { id: "p3", name: "Đồng Bọn", isBot: true },
    { id: "p4", name: "Dân Bot", isBot: true },
    { id: "p5", name: "Người 5", isBot: false },
    { id: "p6", name: "Người 6", isBot: false },
  ];
  const roles: Role[] = ["VILLAGER", "WEREWOLF", "WEREWOLF", "VILLAGER", "VILLAGER", "VILLAGER"];
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 2 };
  const engine = GameEngine.create(players, config, 1_000);
  engine.state.players.forEach((player, index) => {
    player.role = roles[index]!;
  });

  const room: Room = {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "IN_GAME",
    members: players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: p.isBot,
      avatarUrl: null,
    })),
    config,
    engine,
    chatLog: [],
    createdAt: 1_000,
    gameId: "g1",
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };

  clearBotSession(code);
  startBotSession(room);

  engine.state.round = 2;
  engine.setPhase("VOTING", 30_000, 2_000);
  for (const voter of engine.alivePlayers()) {
    if (voter.id !== "p2") engine.submitVote(voter.id, "p2", 3_000);
  }
  return room;
}

/** Chạy đúng bước `endVoting` của machine, tức mở phiên toà thật. */
async function runDefense(room: Room): Promise<void> {
  armStep(room, { name: "endVoting" }, 0);
  runPendingStep(room, room.pendingStep!);
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  brainControl.requests.length = 0;
  brainControl.reply = null;
  broadcast.chats.length = 0;
});

afterEach(() => {
  clearBotSession("DDEF1");
  clearBotSession("DDEF2");
  clearBotSession("DDEF3");
});

describe("scheduler DEFENSE đa bot", () => {
  it("bot khong phai bi cao duoc lich noi trong DEFENSE", async () => {
    const room = votingRoom("DDEF1");
    await runDefense(room);

    // Bị cáo vẫn nói.
    expect(broadcast.chats.some((m) => m.playerId === "p2")).toBe(true);
    // Đồng bọn Sói (tin chắc chắn, confidence 1) bênh bị cáo.
    expect(broadcast.chats.some((m) => m.playerId === "p3")).toBe(true);
  });

  it("moi bot toi da 2 luot trong mot DEFENSE", async () => {
    const room = votingRoom("DDEF2");
    await runDefense(room);

    const counts = new Map<string, number>();
    for (const message of broadcast.chats) {
      counts.set(message.playerId, (counts.get(message.playerId) ?? 0) + 1);
    }
    expect(broadcast.chats.length).toBeGreaterThan(0);
    for (const [playerId, count] of counts) {
      expect(count, `bot ${playerId} noi qua 2 luot`).toBeLessThanOrEqual(2);
    }
  });

  it("bot chua du tin thi im: belief rong cho confidence 0 va cong im", async () => {
    const room = votingRoom("DDEF3");
    await runDefense(room);

    // Session mới: runtime chưa từng observe nên belief trống.
    clearBotSession("DDEF3");
    startBotSession(room);
    const runtime = botSessionFor(room).runtimeFor("p4");
    const context = buildBotDecisionContext(room, "p4");
    const verdict = runtime.decideFinalVote(context);

    expect(verdict.confidence).toBe(0);
    expect(shouldSpeakInDefense(verdict.confidence)).toBe(false);
    expect(shouldSpeakInDefense(1)).toBe(true);
  });
});

describe("planDefenseSpeakers (loi lap lich thuan)", () => {
  it("moi id xuat hien toi da maxPerBot lan, bi cao luon co suat", () => {
    const slots = planDefenseSpeakers(["a", "b", "c"], "b", createSeededRng("seed-1"), 2);
    expect(slots).toHaveLength(6);
    for (const id of ["a", "b", "c"]) {
      expect(slots.filter((s) => s === id)).toHaveLength(2);
    }
  });

  it("xep lich tat dinh voi cung seed", () => {
    const first = planDefenseSpeakers(["a", "b", "c", "d"], "a", createSeededRng("seed-2"), 2);
    const second = planDefenseSpeakers(["a", "b", "c", "d"], "a", createSeededRng("seed-2"), 2);
    expect(first).toEqual(second);
  });
});
