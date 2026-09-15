import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { clearBotSession } from "../src/bots/session-registry";
import { followHumanWolfVote, scheduleNightBots } from "../src/game/bot-scheduler";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

/**
 * Bầy Sói có người thật: bot Sói THEO phiếu của người, và nói một câu trong
 * hang để người có thông tin mà quyết.
 *
 * Trước đây bot bỏ phiếu ở 10-30% đêm, phiếu chốt 800ms sau khi cả bầy đã bỏ,
 * nên một Sói người đứng cạnh hai Sói bot thua 1-2 ở mọi đêm.
 */

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

const NIGHT_MS = 30_000;

interface Seat {
  id: string;
  role: GameState["players"][number]["role"];
  human?: boolean;
  /** Người đã rớt đủ lâu để máy cầm ghế. */
  dropped?: boolean;
}

function room(seats: Seat[], night: Partial<GameState["night"]> = {}, state: Partial<GameState> = {}): Room {
  const players = seats.map((seat) => ({
    id: seat.id,
    name: seat.id.toUpperCase(),
    role: seat.role,
    alive: true,
    isBot: !seat.human,
  }));
  // `structuredClone`, không spread: hai scaffold chứa object/mảng lồng nhau
  // (`wolfVotes`, `log`, ...) mà engine GHI vào. Spread nông thì phiếu của ca
  // trước nằm sẵn trong ca sau.
  const gameState: GameState = {
    ...structuredClone(GAME_STATE_SCAFFOLD),
    phase: "NIGHT",
    round: 1,
    phaseStartedAt: 0,
    phaseEndsAt: NIGHT_MS,
    players,
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 2, seer: true, guard: false, witch: false },
    night: { ...structuredClone(NIGHT_SCAFFOLD), ...night },
    ...state,
  };
  return {
    ...ROOM_SCAFFOLD,
    code: "PACK1",
    hostId: seats[0]!.id,
    status: "IN_GAME",
    members: seats.map((seat) => ({
      playerId: seat.id,
      name: seat.id.toUpperCase(),
      ready: true,
      connected: !seat.dropped,
      ...(seat.dropped ? { disconnectedAt: -60_000 } : {}),
      isBot: !seat.human,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(gameState),
    chatLog: [],
    createdAt: 0,
  };
}

const VILLAGE: Seat[] = [
  { id: "seer", role: "SEER" },
  { id: "v1", role: "VILLAGER" },
  { id: "v2", role: "VILLAGER" },
  { id: "v3", role: "VILLAGER" },
];

const MIXED_PACK: Seat[] = [{ id: "bot", role: "WEREWOLF" }, { id: "human", role: "WEREWOLF", human: true }, ...VILLAGE];

const votes = (r: Room) => r.engine!.state.night.wolfVotes;
const den = (r: Room) => r.chatLog.filter((message) => message.channel === "wolves" && message.playerId === "bot");

function humanVotes(r: Room, humanId: string, targetId: string | null): void {
  r.engine!.submitNightAction(humanId, targetId === null ? "SKIP" : "KILL", targetId);
  followHumanWolfVote(r);
}

describe("bầy Sói có người thật", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    clearBotSession("PACK1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("người bỏ X thì bot bỏ lại đúng X và nói trong hang", () => {
    const r = room(MIXED_PACK);
    scheduleNightBots(r);
    humanVotes(r, "human", "v1");
    expect(votes(r).bot).toBe("v1");
    expect(den(r).some((message) => message.text.includes("V1"))).toBe(true);
  });

  it("bot chưa bỏ phiếu ở mốc sớm, nhưng đã gợi ý một mục tiêu trong hang", async () => {
    const r = room(MIXED_PACK);
    scheduleNightBots(r);
    await vi.advanceTimersByTimeAsync(NIGHT_MS * 0.4);
    expect(votes(r).bot).toBeUndefined();
    expect(den(r)).toHaveLength(1);
  });

  it("người không bỏ thì tới mốc muộn bot tự bỏ; người bỏ sau đó thì bot đổi theo", async () => {
    const r = room(MIXED_PACK);
    scheduleNightBots(r);
    await vi.advanceTimersByTimeAsync(NIGHT_MS * 0.9);
    const own = votes(r).bot;
    expect(own).toBeDefined();

    const other = ["v1", "v2", "v3"].find((id) => id !== own)!;
    humanVotes(r, "human", other);
    expect(votes(r).bot).toBe(other);
  });

  it("mốc muộn tới sau khi bot đã theo người thì không ghi đè bằng lựa chọn riêng", async () => {
    const r = room(MIXED_PACK);
    scheduleNightBots(r);
    humanVotes(r, "human", "v3");
    await vi.advanceTimersByTimeAsync(NIGHT_MS);
    expect(votes(r).bot).toBe("v3");
  });

  it("người chọn không cắn thì bot cũng bỏ qua", () => {
    const r = room(MIXED_PACK);
    scheduleNightBots(r);
    humanVotes(r, "human", null);
    expect(votes(r).bot).toBeNull();
  });

  it("hai Sói người bất đồng thì bot giữ lựa chọn riêng", async () => {
    const r = room([
      { id: "bot", role: "WEREWOLF" },
      { id: "human", role: "WEREWOLF", human: true },
      { id: "human2", role: "WEREWOLF", human: true },
      ...VILLAGE,
    ]);
    scheduleNightBots(r);
    humanVotes(r, "human", "v1");
    humanVotes(r, "human2", "v2");
    // Người thứ nhất bỏ trước nên bot đã theo v1; bất đồng xảy ra SAU đó thì
    // bot không đổi nữa - không đứng về phía ai.
    expect(votes(r).bot).toBe("v1");
  });

  it("bầy toàn bot: bỏ phiếu ở mốc sớm như cũ và không nói gì", async () => {
    const r = room([{ id: "bot", role: "WEREWOLF" }, { id: "bot2", role: "WEREWOLF" }, ...VILLAGE]);
    scheduleNightBots(r);
    await vi.advanceTimersByTimeAsync(NIGHT_MS * 0.4);
    expect(votes(r).bot).toBeDefined();
    expect(r.chatLog).toEqual([]);
  });

  it("ghế người đã rớt (máy cầm) không tính là người", async () => {
    const r = room([{ id: "bot", role: "WEREWOLF" }, { id: "human", role: "WEREWOLF", human: true, dropped: true }, ...VILLAGE]);
    scheduleNightBots(r);
    await vi.advanceTimersByTimeAsync(NIGHT_MS * 0.4);
    expect(votes(r).bot).toBeDefined();
    expect(r.chatLog).toEqual([]);
  });

  it("Đêm Tĩnh Lặng: vẫn theo phiếu nhưng không nói", () => {
    const r = room(MIXED_PACK, {}, {
      activeEvent: { id: "SILENT_NIGHT", name: "", description: "", targetPhase: "NIGHT", beneficiary: "neutral", power: 1, round: 1 },
    });
    scheduleNightBots(r);
    humanVotes(r, "human", "v2");
    expect(votes(r).bot).toBe("v2");
    expect(r.chatLog).toEqual([]);
  });

  it("đêm Sói Con nổi giận: bot theo phiếu chính mà không xoá mục tiêu phụ", () => {
    const r = room(MIXED_PACK, { wolfCubRageTonight: true });
    scheduleNightBots(r);
    r.engine!.submitNightAction("human", "KILL", "v1", "v2");
    followHumanWolfVote(r);
    expect(votes(r).bot).toBe("v1");
    expect(r.engine!.state.night.wolfSecondaryTarget).toBe("v2");
  });
});
