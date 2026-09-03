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
 * Phòng đang chơi, có đúng một Kẻ Báo Thù đã được cấp nhiệm vụ.
 *
 * Vai gán tay sau khi `create` chia bài, và nhiệm vụ được ghi đè theo: bài test
 * này nói về việc nhiệm vụ có sống qua một lần lưu/khôi phục hay không, nên bàn
 * cờ phải là hằng số chứ không phải kết quả một lần xáo bài.
 */
function roomInGame(code = "EXP01"): Room {
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
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, executioner: true },
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
  engine.state.players[1].role = "EXECUTIONER";
  for (const player of engine.state.players.slice(2)) player.role = "VILLAGER";
  engine.state.executionerTargets = { p2: "p4" };

  engine.setPhase("DAY_DISCUSSION", 60_000, 1_000);
  room.engine = engine;
  return room;
}

describe("Kẻ Báo Thù - lưu và khôi phục nhiệm vụ", () => {
  it("envelope mang bảng nhiệm vụ và vẫn hợp lệ với schema", () => {
    const envelope = serializeRoom(roomInGame("EXPA"), 1);
    const parsed = roomEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) console.error(parsed.error.issues);

    expect(parsed.success).toBe(true);
    expect(envelope.room.engineState!.executionerTargets).toEqual({ p2: "p4" });
    expect(envelope.room.config.executioner).toBe(true);
  });

  it("khôi phục KHÔNG bốc lại mục tiêu", () => {
    /*
     * Đây là hàng rào quan trọng nhất của tính năng ở tầng này. Một lần bốc lại
     * sau mỗi lần mất mạng nghĩa là người chơi có thể đổi nhiệm vụ bằng cách rút
     * dây mạng - và họ sẽ tìm ra điều đó rất nhanh.
     */
    const room = roomInGame("EXPB");
    const restored = restoreRoomFromEnvelope(serializeRoom(room, 2));

    expect(restored.engine!.executionerTargets()).toEqual({ p2: "p4" });
  });

  it("trạng thái ĐÃ chuyển vai sống qua khôi phục", () => {
    const room = roomInGame("EXPC");
    room.engine!.player("p4")!.alive = false;
    room.engine!.settleExecutioner();
    expect(room.engine!.player("p2")!.role).toBe("JESTER");

    const restored = restoreRoomFromEnvelope(serializeRoom(room, 3));

    expect(restored.engine!.player("p2")!.role).toBe("JESTER");
    expect(restored.engine!.player("p2")!.executionerTurned).toBe(true);
    // Và một lần chốt nữa sau khôi phục không đổi gì thêm.
    restored.engine!.settleExecutioner();
    expect(restored.engine!.player("p2")!.role).toBe("JESTER");
    expect(restored.engine!.personalWins()).toEqual([]);
  });

  it("thắng đã ghi nhận sống qua khôi phục và không bị ghi lại lần hai", () => {
    const room = roomInGame("EXPD");
    const engine = room.engine!;
    engine.setPhase("VOTING", 30_000, 1_000);
    for (const voter of engine.alivePlayers()) {
      if (voter.id !== "p4") engine.submitVote(voter.id, "p4", 2_000);
    }
    engine.resolveNomination(25_000, 3_000);
    engine.beginFinalVote(20_000, 3_000);
    for (const voter of engine.finalVoters()) engine.submitFinalVote(voter.id, true);
    engine.resolveFinalVote(4_000);
    expect(engine.personalWins()).toHaveLength(1);

    const restored = restoreRoomFromEnvelope(serializeRoom(room, 4));

    expect(restored.engine!.personalWins()).toEqual([
      {
        playerId: "p2",
        name: "Người 2",
        role: "EXECUTIONER",
        condition: "EXECUTIONER_TARGET_LYNCHED",
        // Vòng 0: `create` dựng ván ở `ROLE_REVEAL` và fixture này nhảy thẳng
        // sang ngày mà không đi qua một đêm nào, nên bộ đếm vòng chưa tăng.
        round: 0,
      },
    ]);
    restored.engine!.settleExecutioner();
    expect(restored.engine!.personalWins()).toHaveLength(1);
    // Người vừa thắng KHÔNG bị chuyển vai chỉ vì mục tiêu đã chết.
    expect(restored.engine!.player("p2")!.role).toBe("EXECUTIONER");
  });

  it("snapshot ghi TRƯỚC bản này đọc lên thành 'ván không có vai này'", () => {
    /*
     * Ca đắt nhất của mọi trường thêm sau: mọi ván đang chạy lúc deploy đều
     * mang một envelope thiếu các trường này, và một schema bắt buộc sẽ đẩy
     * tất cả vào `quarantine` - tức giết sạch chúng ngay giây đầu tiên.
     */
    const envelope = serializeRoom(roomInGame("EXPE"), 5);
    delete (envelope.room.engineState as { executionerTargets?: unknown })
      .executionerTargets;
    for (const player of envelope.room.engineState!.players) {
      delete (player as { executionerTurned?: unknown }).executionerTurned;
    }
    delete (envelope.room.config as { executioner?: unknown }).executioner;

    const parsed = roomEnvelopeSchema.safeParse(envelope);
    expect(parsed.success).toBe(true);

    const restored = restoreRoomFromEnvelope(parsed.success ? parsed.data : envelope);
    expect(restored.engine!.executionerTargets()).toEqual({});
    expect(restored.engine!.state.config.executioner).toBe(false);
    expect(restored.engine!.player("p2")!.executionerTurned).toBe(false);
  });

  it("schema từ chối một bảng nhiệm vụ méo", () => {
    // Dữ liệu MANG QUYẾT ĐỊNH: một giá trị rác ở đây khiến một người chơi không
    // bao giờ thắng được, hoặc hoá Thằng Hề vào sai lúc.
    const envelope = serializeRoom(roomInGame("EXPF"), 6);
    (envelope.room.engineState as { executionerTargets: unknown }).executionerTargets = {
      p2: 42,
    };

    expect(roomEnvelopeSchema.safeParse(envelope).success).toBe(false);
  });

  it("ván MỚI trong cùng phòng xoá sạch nhiệm vụ, chuyển vai và thắng của ván trước", () => {
    const room = roomInGame("EXPG");
    room.engine!.player("p4")!.alive = false;
    room.engine!.settleExecutioner();
    room.engine!.state.personalWins = [
      {
        playerId: "p2",
        name: "Người 2",
        role: "EXECUTIONER",
        condition: "EXECUTIONER_TARGET_LYNCHED",
        round: 1,
      },
    ];

    // `GameEngine.create` là đường duy nhất một ván mới được dựng; nó không đọc
    // lại state cũ ở đâu cả.
    const next = GameEngine.create(
      room.members.map((m) => ({ id: m.playerId, name: m.name, isBot: m.isBot })),
      room.config,
      9_000,
    );

    expect(next.personalWins()).toEqual([]);
    expect(next.state.players.every((p) => p.executionerTurned === false)).toBe(true);
    // Nhiệm vụ MỚI, và nó phải khác một bảng rỗng: ván này vẫn có Kẻ Báo Thù.
    const targets = next.executionerTargets();
    expect(Object.keys(targets)).toHaveLength(1);
    const [execId, targetId] = Object.entries(targets)[0];
    expect(next.player(execId)!.role).toBe("EXECUTIONER");
    expect(targetId).not.toBe(execId);
  });
});
