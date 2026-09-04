import { describe, expect, it, vi } from "vitest";
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

const { serializeRoom } = await import("../src/persistence/serialize");
const { restoreRoomFromEnvelope } = await import("../src/persistence/restore");
const { roomEnvelopeSchema } = await import("../src/persistence/schema");
const { GameEngine } = await import("@masoi/game-engine");

/**
 * Phòng đang giữa một đêm, Sát Nhân ĐÃ chốt mục tiêu.
 *
 * Vai gán tay và state dựng thẳng: bài test này nói về việc lựa chọn đêm có
 * sống qua một lần lưu/khôi phục hay không, nên bàn cờ phải là hằng số chứ
 * không phải kết quả của một lần xáo bài.
 */
function roomMidNight(code = "SKIL1"): Room {
  const room: Room = {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "IN_GAME",
    members: Array.from({ length: 6 }, (_, i) => ({
      playerId: `p${i + 1}`,
      name: `Người ${i + 1}`,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: i >= 3,
      avatarUrl: null,
    })),
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, serialKiller: true },
    engine: null,
    chatLog: [],
    createdAt: 1_000,
    gameId: "g1",
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };

  const engine = GameEngine.create(
    room.members.map((m) => ({ id: m.playerId, name: m.name, isBot: m.isBot })),
    room.config,
    1_000,
  );
  engine.state.players[0].role = "WEREWOLF";
  engine.state.players[1].role = "SERIAL_KILLER";
  for (const player of engine.state.players.slice(2)) player.role = "VILLAGER";

  engine.setPhase("NIGHT", 30_000, 1_000);
  engine.submitNightAction("p2", "SERIAL_KILL", "p4");
  engine.submitNightAction("p1", "KILL", "p5");

  room.engine = engine;
  return room;
}

describe("Sát Nhân - lưu và khôi phục lựa chọn đêm", () => {
  it("envelope mang mục tiêu đã chốt và vẫn hợp lệ với schema", () => {
    const envelope = serializeRoom(roomMidNight("SKILA"), 1);
    const parsed = roomEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) console.error(parsed.error.issues);

    expect(parsed.success).toBe(true);
    expect(envelope.room.engineState!.night.serialKillerTarget).toBe("p4");
    expect(envelope.room.engineState!.night.serialKillerSkipped).toBe(false);
    expect(envelope.room.config.serialKiller).toBe(true);
  });

  it("khôi phục xong thì nhát dao vẫn tới nơi", () => {
    const room = roomMidNight("SKILB");
    const restored = restoreRoomFromEnvelope(serializeRoom(room, 2));

    expect(restored.engine!.state.night.serialKillerTarget).toBe("p4");
    restored.engine!.lockWolves(() => 0);
    restored.engine!.resolveNight(5_000, () => 0);

    // Khôi phục KHÔNG được làm mất một hành động đã gửi: người chơi đã bấm, và
    // họ không có cách nào biết rằng server vừa khởi động lại.
    expect(restored.engine!.player("p4")!.alive).toBe(false);
    expect(
      restored.engine!.state.nightHistory.at(-1)!.deaths.find((d) => d.player.id === "p4")!.cause,
    ).toBe("serial_killer");
  });

  it("quyết định BỎ QUA cũng sống qua khôi phục, không hoá thành 'chưa quyết'", () => {
    const room = roomMidNight("SKILC");
    room.engine!.submitNightAction("p2", "SKIP", null);
    const restored = restoreRoomFromEnvelope(serializeRoom(room, 3));

    expect(restored.engine!.state.night.serialKillerSkipped).toBe(true);
    // Và nó vẫn là quyết định CUỐI: engine từ chối một mục tiêu gửi sau đó.
    expect(() => restored.engine!.submitNightAction("p2", "SERIAL_KILL", "p4")).toThrow();
  });

  it("snapshot ghi TRƯỚC bản này đọc lên thành 'chưa ra tay', không phải phòng hỏng", () => {
    /*
     * Đây là ca đắt nhất của mọi trường thêm sau: mọi ván đang chạy lúc deploy
     * đều mang một envelope thiếu ba trường này, và một schema bắt buộc sẽ đẩy
     * tất cả vào `quarantine` - tức giết sạch chúng ngay giây đầu tiên.
     */
    const envelope = serializeRoom(roomMidNight("SKILD"), 4);
    const night = envelope.room.engineState!.night as {
      serialKillerTarget?: unknown;
      serialKillerSkipped?: unknown;
    };
    delete night.serialKillerTarget;
    delete night.serialKillerSkipped;
    delete (envelope.room.config as { serialKiller?: unknown }).serialKiller;

    const parsed = roomEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);

    const restored = restoreRoomFromEnvelope(parsed.success ? parsed.data : envelope);
    expect(restored.engine!.state.night.serialKillerTarget).toBeNull();
    expect(restored.engine!.state.night.serialKillerSkipped).toBe(false);
    expect(restored.engine!.state.config.serialKiller).toBe(false);
  });

  it("ván MỚI trong cùng phòng xoá sạch trạng thái Sát Nhân của ván trước", () => {
    const room = roomMidNight("SKILE");
    expect(room.engine!.state.night.serialKillerTarget).toBe("p4");

    // `GameEngine.create` là đường duy nhất một ván mới được dựng; nó không đọc
    // lại state cũ ở đâu cả.
    room.engine = GameEngine.create(
      room.members.map((m) => ({ id: m.playerId, name: m.name, isBot: m.isBot })),
      room.config,
      9_000,
    );

    expect(room.engine.state.night.serialKillerTarget).toBeNull();
    expect(room.engine.state.night.serialKillerSkipped).toBe(false);
    expect(room.engine.state.winner).toBeNull();
    expect(room.engine.personalWins()).toEqual([]);
  });
});

describe("schema nhận đúng bốn kết cục", () => {
  const withWinner = (winner: string) => {
    const envelope = serializeRoom(roomMidNight("SKILF"), 5);
    (envelope.room.engineState as { winner: unknown }).winner = winner;
    (envelope.room.engineState as { phase: string }).phase = "GAME_OVER";
    return roomEnvelopeSchema.safeParse(envelope);
  };

  it("lưu và đọc lại được cả serial_killer lẫn draw", () => {
    for (const winner of ["wolves", "village", "serial_killer", "draw"]) {
      expect(withWinner(winner).success, winner).toBe(true);
    }
  });

  it("từ chối một kết cục không có thật", () => {
    // `winner` là kết quả cuối cùng của cả ván, nên nó nằm ở nhóm dữ liệu mang
    // quyết định - kiểm chặt, không phải kiểm cấu trúc.
    expect(withWinner("KHÔNG_CÓ_THẬT").success).toBe(false);
  });
});

describe("nước đi đêm của BOT sống qua khôi phục", () => {
  it("schema nhận SERIAL_KILL trong previousNightActions", async () => {
    const { botBrainStateSchema } = await import("../src/persistence/schema");
    const { createBotBrainState, createBotPersonality, createSeededRng } = await import(
      "@masoi/game-engine"
    );

    const state = createBotBrainState(
      "p2",
      createBotPersonality(createSeededRng("sk")),
      ["p1", "p2", "p3"],
    );
    state.previousNightActions.push({ round: 1, action: "SERIAL_KILL", targetId: "p4" });
    /*
     * `HOLY_WATER` đi cùng: nó bị bỏ sót khỏi danh sách này từ đầu (danh sách
     * giữ một tên chưa từng tồn tại là "PRIEST_BLESS"), nên một phòng có Linh
     * Mục BOT đã ném Nước thánh sẽ trượt schema lúc khôi phục.
     */
    state.previousNightActions.push({ round: 2, action: "HOLY_WATER", targetId: "p3" });

    expect(botBrainStateSchema.safeParse(state).success).toBe(true);
  });
});
