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
 * Phòng đang giữa ván, có sẵn một Thằng Hề ĐÃ bị treo.
 *
 * Vai gán tay và state dựng thẳng: bài test này nói về việc sổ thành tích có
 * sống qua một lần lưu/khôi phục hay không, nên bàn cờ phải là hằng số chứ
 * không phải kết quả của một lần xáo bài.
 */
function roomWithJesterWin(code = "JEST1"): Room {
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
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, jester: true },
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
  engine.state.players[1].role = "JESTER";
  for (const player of engine.state.players.slice(2)) player.role = "VILLAGER";

  engine.state.phase = "DAY_DISCUSSION";
  engine.state.round = 2;
  engine.setPhase("VOTING", 30_000, 1_000);
  for (const voter of engine.alivePlayers()) {
    if (voter.id !== "p2") engine.submitVote(voter.id, "p2", 2_000);
  }
  engine.resolveNomination(25_000, 3_000);
  engine.beginFinalVote(20_000, 3_000);
  for (const voter of engine.finalVoters()) engine.submitFinalVote(voter.id, true);
  engine.resolveFinalVote(4_000);

  room.engine = engine;
  return room;
}

describe("Thằng Hề - lưu và khôi phục", () => {
  it("envelope mang sổ thành tích và vẫn hợp lệ với schema", () => {
    const room = roomWithJesterWin("JESTA");
    const envelope = serializeRoom(room, 1);
    const parsed = roomEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) console.error(parsed.error.issues);

    expect(parsed.success).toBe(true);
    expect(envelope.room.engineState!.personalWins).toEqual([
      { playerId: "p2", name: "Người 2", role: "JESTER", condition: "JESTER_LYNCHED", round: 2 },
    ]);
  });

  it("khôi phục xong thì thành tích còn nguyên, không mất và không nhân đôi", () => {
    const room = roomWithJesterWin("JESTB");
    const restored = restoreRoomFromEnvelope(serializeRoom(room, 2));

    expect(restored.engine!.personalWins()).toEqual(room.engine!.personalWins());
  });

  it("snapshot ghi TRƯỚC bản này đọc lên thành sổ rỗng, không phải phòng hỏng", () => {
    /*
     * Đây là ca đắt nhất của mọi trường thêm sau: mọi ván đang chạy lúc deploy
     * đều mang một envelope thiếu trường này, và một schema bắt buộc sẽ đẩy tất
     * cả vào `quarantine` - tức giết sạch chúng ngay giây đầu tiên.
     */
    const room = roomWithJesterWin("JESTC");
    const envelope = serializeRoom(room, 3);
    delete (envelope.room.engineState as { personalWins?: unknown }).personalWins;
    delete (envelope.room.config as { jester?: unknown }).jester;

    const parsed = roomEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);

    const restored = restoreRoomFromEnvelope(parsed.success ? parsed.data : envelope);
    expect(restored.engine!.personalWins()).toEqual([]);
    expect(restored.engine!.state.config.jester).toBe(false);
  });

  it("schema từ chối một điều kiện thắng không có thật", () => {
    // Sổ này là kết quả CUỐI CÙNG của một người chơi, nên nó nằm ở nhóm dữ
    // liệu mang quyết định - kiểm chặt, không phải kiểm cấu trúc.
    const room = roomWithJesterWin("JESTD");
    const envelope = serializeRoom(room, 4);
    (envelope.room.engineState!.personalWins as Array<{ condition: string }>)[0].condition =
      "KHÔNG_CÓ_THẬT";

    expect(roomEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });
});
