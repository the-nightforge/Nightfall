import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import type { BotBrain } from "../src/bots/types";
import { scheduleNightBots } from "../src/game/machine";

/**
 * machine.ts mang ràng buộc "không lời gọi Gemini nào được phép làm treo hay
 * sập ván" (xem docs/superpowers/specs/2026-08-27-bot-ai-gemini-design.md).
 * Test này dựng một não bot không bao giờ resolve để buộc scheduleNightBots
 * đi hết đường hạn chót cứng, và xác nhận đúng một hành động được nộp - không
 * phải hai (đường "kết quả về sớm" và đường "hạn chót" không được cùng nổ).
 *
 * Không mock rooms/snapshot vì đó là logic thật cần chạy qua GameEngine thật;
 * chỉ mock store/broadcast/db (I/O phụ trợ, không phải thứ đang kiểm) và bots
 * (thay não thật bằng não treo mãi mãi) để không đụng Redis/Prisma thật.
 */

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => {
    setTimeout(fn, ms);
  },
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: {},
}));

const hangingBrain: BotBrain = {
  name: "hanging-forever",
  decideNight: () => new Promise(() => undefined),
  decideDay: () => new Promise(() => undefined),
};

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => hangingBrain,
  };
});

function nightRoom(): Room {
  const state: GameState = {
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: Date.now() + 30_000,
    players: [
      { id: "bot", name: "Bot Tiên Tri", role: "SEER", alive: true, isBot: true },
      { id: "human1", name: "Người 1", role: "VILLAGER", alive: true, isBot: false },
      { id: "human2", name: "Người 2", role: "WEREWOLF", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      killTarget: null,
      actedWolves: [],
      skippedWolves: [],
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    log: [],
  };

  return {
    code: "ABCDE",
    hostId: "human1",
    status: "IN_GAME",
    members: [
      { playerId: "bot", name: "Bot Tiên Tri", ready: true, connected: false, isBot: true },
      { playerId: "human1", name: "Người 1", ready: true, connected: true, isBot: false },
      { playerId: "human2", name: "Người 2", ready: true, connected: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: Date.now(),
  };
}

describe("scheduleNightBots - hạn chót cứng không bao giờ để ván treo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nộp đúng một hành động đêm qua RandomBrain khi não Gemini treo mãi mãi", async () => {
    const room = nightRoom();
    const submitSpy = vi.spyOn(room.engine!, "submitNightAction");

    scheduleNightBots(room);

    // Trần hạn chót là min(8s, nightSeconds*400ms); DEFAULT_ROOM_CONFIG.nightSeconds
    // đủ lớn nên trần luôn đúng 8s. Ngay trước mốc đó chưa có gì được nộp.
    await vi.advanceTimersByTimeAsync(7_999);
    expect(submitSpy).not.toHaveBeenCalled();

    // Qua mốc 8s: đường hạn chót phải tự chốt bằng RandomBrain.
    await vi.advanceTimersByTimeAsync(50);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledWith("bot", "SEE", expect.any(String));

    // Chờ thêm rất lâu: não Gemini vẫn treo, đường "kết quả về sớm" đáng lẽ
    // không bao giờ được unblock - nếu "settled" bị phá, nó cũng sẽ không bao
    // giờ nộp thêm lần hai (promise đó không resolve). Xác nhận vẫn đúng 1 lần.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });
});
