import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { clearBotSession } from "../src/bots/session-registry";
import { scheduleNightBots } from "../src/game/machine";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

/**
 * Sau Phase 2, KHÔNG quyết định game action nào được đi qua provider.
 *
 * Spy dưới đây tồn tại để chứng minh điều ngược lại: nếu một lời gọi lọt tới nó
 * thì đã có một nước đi do LLM quyết, và test phải đỏ.
 */
const brainControl = vi.hoisted(() => ({
  renderDaySpeech: vi.fn(),
}));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: {} }));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({
      name: "speech-only",
      renderDaySpeech: brainControl.renderDaySpeech,
    }),
  };
});

function nightRoom(): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: 30_000,
    phaseStartedAt: 0,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: true },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: true },
      { id: "guard", name: "Bảo Vệ", role: "GUARD", alive: true, isBot: true },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, seer: true, guard: true, witch: false },
    winner: null,
    night: {
      ...NIGHT_SCAFFOLD,
      wolfVotes: {},
      killTarget: null,
      wolvesLocked: false,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    voteMutations: [],
    dayVoteHistory: [],
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    lastTrial: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };

  return {
    ...ROOM_SCAFFOLD,
    code: "NIGHT1",
    hostId: "wolf",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: true,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("scheduleNightBots · deterministic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    brainControl.renderDaySpeech.mockReset();
    // Session sống ở một map cấp module theo mã phòng. Mọi fixture ở đây dùng
    // chung mã "NIGHT1", nên không dọn thì luồng RNG của test trước chảy tiếp
    // sang test sau và "cùng seed cho cùng kết quả" không còn kiểm được gì.
    clearBotSession("NIGHT1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nộp hành động đêm mà KHÔNG gọi nhà cung cấp nào", async () => {
    const room = nightRoom();

    scheduleNightBots(room);
    // Dừng lại ĐÚNG lúc mọi lượt đêm đã nộp. Nộp xong là đêm tự khép sớm, và
    // pha ngày ngay sau đó gọi nhà cung cấp một cách hoàn toàn hợp lệ - chạy
    // quá mốc này là đo nhầm pha khác.
    for (let tick = 0; tick < 20 && !room.engine!.allNightActionsDone(); tick++) {
      await vi.advanceTimersByTimeAsync(1_000);
    }

    expect(room.engine!.allNightActionsDone()).toBe(true);
    expect(brainControl.renderDaySpeech).not.toHaveBeenCalled();
  });

  it("Sói bỏ phiếu cắn một người ngoài phe Sói", async () => {
    const room = nightRoom();

    scheduleNightBots(room);
    await vi.advanceTimersByTimeAsync(20_000);

    const target = room.engine!.state.night.wolfVotes.wolf;
    expect(target).toBeDefined();
    expect(["seer", "guard", "villager"]).toContain(target);
  });

  it("Tiên Tri soi một người khác chính mình", async () => {
    const room = nightRoom();

    scheduleNightBots(room);
    await vi.advanceTimersByTimeAsync(20_000);

    const result = room.engine!.state.night.seerResults.seer;
    expect(result).toBeDefined();
    expect(result.targetId).not.toBe("seer");
  });

  it("Bảo Vệ đỡ một người còn sống", async () => {
    const room = nightRoom();

    scheduleNightBots(room);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(room.engine!.state.night.guardTarget).not.toBeNull();
  });

  it("Dân Làng không hành động gì", async () => {
    const room = nightRoom();

    scheduleNightBots(room);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(room.engine!.state.night.wolfVotes.villager).toBeUndefined();
    expect(room.engine!.state.night.seerResults.villager).toBeUndefined();
  });

  it("cùng phòng và cùng thời điểm tạo cho cùng kết quả đêm", async () => {
    const run = async () => {
      const room = nightRoom();
      clearBotSession(room.code);
      scheduleNightBots(room);
      await vi.advanceTimersByTimeAsync(20_000);
      return {
        kill: room.engine!.state.night.wolfVotes.wolf,
        see: room.engine!.state.night.seerResults.seer?.targetId,
        guard: room.engine!.state.night.guardTarget,
      };
    };

    // Session được gieo từ `${room.code}:${room.createdAt}`, cả hai đều cố định.
    expect(await run()).toEqual(await run());
  });

  it("bỏ qua khi pha đã đổi, không nộp hành động muộn", async () => {
    const room = nightRoom();

    scheduleNightBots(room);
    room.engine!.setPhase("DAY_DISCUSSION", 60_000);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(room.engine!.state.night.wolfVotes).toEqual({});
  });
});

describe("BotBrain contract", () => {
  it("không còn method nào trả về nước đi", async () => {
    const { RandomBrain } = await import("../src/bots/random-brain");
    const brain = new RandomBrain();

    // Ba method này là toàn bộ đường mà provider từng dùng để quyết định
    // gameplay. Chúng phải biến mất, không phải bị bỏ trống.
    expect("decideNight" in brain).toBe(false);
    expect("decideHunterShot" in brain).toBe(false);
    expect("decideFinalVote" in brain).toBe(false);
    expect("decideDay" in brain).toBe(false);
  });
});
