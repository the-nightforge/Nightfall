import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, GAME_EVENTS } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { clearBotSession } from "../src/bots/session-registry";
import { scheduleDayOfTruthBots } from "../src/game/machine";
import { ROOM_SCAFFOLD } from "./helpers/room";

/**
 * Ngày Sự Thật trong một bàn có BOT.
 *
 * `submitDayOfTruthClaim` trước đây chỉ có đúng một chỗ gọi: handler socket của
 * client người thật. Nên trong phòng nhiều BOT, sự kiện chạy xong mà bảng claim
 * vẫn rỗng - banner hiện lên rồi không có gì xảy ra.
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

const ROLES = ["WEREWOLF", "SEER", "GUARD", "WITCH", "VILLAGER", "VILLAGER"] as const;

function truthRoom(options: { withEvent?: boolean; humanIds?: string[] } = {}): Room {
  const humans = new Set(options.humanIds ?? []);
  const engine = GameEngine.create(
    ROLES.map((_, i) => ({ id: `p${i + 1}`, name: `Người ${i + 1}`, isBot: !humans.has(`p${i + 1}`) })),
    { ...DEFAULT_ROOM_CONFIG, werewolves: 1, mode: "chaos" },
  );
  engine.state.players.forEach((player, i) => {
    player.role = ROLES[i];
    player.isBot = !humans.has(player.id);
  });
  engine.setPhase("DAY_DISCUSSION", 60_000, 0);
  if (options.withEvent !== false) {
    engine.state.activeEvent = { ...GAME_EVENTS.DAY_OF_TRUTH, round: engine.state.round };
  }

  return {
    ...ROOM_SCAFFOLD,
    code: "TRUTH1",
    hostId: "p1",
    status: "IN_GAME",
    members: engine.state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: player.isBot,
    })),
    config: { ...DEFAULT_ROOM_CONFIG, mode: "chaos" },
    engine,
    chatLog: [],
    createdAt: 0,
  };
}

describe("scheduleDayOfTruthBots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearBotSession("TRUTH1");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mọi BOT còn sống đều gửi claim", async () => {
    const room = truthRoom();

    scheduleDayOfTruthBots(room);
    await vi.advanceTimersByTimeAsync(60_000);

    const claims = room.engine!.state.dayOfTruthClaims;
    for (const player of room.engine!.state.players) {
      expect(claims[player.id]).toBeTruthy();
    }
  });

  it("không đụng vào người thật: họ tự bấm lấy", async () => {
    const room = truthRoom({ humanIds: ["p3"] });

    scheduleDayOfTruthBots(room);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(room.engine!.state.dayOfTruthClaims.p3).toBeUndefined();
    expect(room.engine!.state.dayOfTruthClaims.p1).toBeTruthy();
  });

  it("BOT đã chết không claim, vì engine từ chối người chết", async () => {
    const room = truthRoom();
    room.engine!.mustPlayer("p5").alive = false;

    scheduleDayOfTruthBots(room);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(room.engine!.state.dayOfTruthClaims.p5).toBeUndefined();
  });

  it("không có sự kiện thì không ai claim", async () => {
    // `submitDayOfTruthClaim` ném ngoài Ngày Sự Thật; xếp lịch mù sẽ biến mỗi
    // ngày thường thành một chuỗi ngoại lệ bị nuốt.
    const room = truthRoom({ withEvent: false });

    scheduleDayOfTruthBots(room);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(Object.keys(room.engine!.state.dayOfTruthClaims)).toHaveLength(0);
  });

  it("Sói khai Dân Làng chứ không tự tố", async () => {
    const room = truthRoom();

    scheduleDayOfTruthBots(room);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(room.engine!.state.dayOfTruthClaims.p1).toBe("VILLAGER");
  });

  it("kết quả về muộn không lọt sang pha sau", async () => {
    const room = truthRoom();

    scheduleDayOfTruthBots(room);
    room.engine!.setPhase("VOTING", 30_000, 0);
    room.engine!.state.activeEvent = null;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(Object.keys(room.engine!.state.dayOfTruthClaims)).toHaveLength(0);
  });
});
