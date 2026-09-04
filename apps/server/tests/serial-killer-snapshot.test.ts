import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, gameActionPayload } from "@masoi/shared";
import { buildSnapshot, resolveChat } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

function killerRoom(over: Partial<GameState> = {}): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: "NIGHT",
    round: 2,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "killer", name: "Sát", role: "SERIAL_KILLER", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
      { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
      { id: "guard", name: "Bảo Vệ", role: "GUARD", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, serialKiller: true },
    night: { ...NIGHT_SCAFFOLD, serialKillerTarget: "villager", serialKillerSkipped: false },
    ...over,
  };

  return {
    ...ROOM_SCAFFOLD,
    code: "SKSNP",
    hostId: "villager",
    status: "IN_GAME",
    members: state.players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: state.config,
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("Snapshot của Sát Nhân", () => {
  it("không lộ vai và không lộ mục tiêu cho bất kỳ ai khác", () => {
    const room = killerRoom();
    for (const viewer of ["wolf", "villager", "seer", "witch", "guard"]) {
      const view = buildSnapshot(room, viewer);
      expect(view.players.find((p) => p.id === "killer")?.role, viewer).toBeUndefined();
      expect(view.night?.serialKillerTarget, viewer).toBeUndefined();
      /*
       * Kể cả chính NẠN NHÂN cũng không được biết: một cảnh báo "đêm nay bạn
       * đang bị nhắm" là thứ phá hỏng toàn bộ vai này, và nó không có ở đâu
       * trong snapshot - kiểm cả chuỗi để không một trường mới nào lọt qua.
       */
      expect(JSON.stringify(view), viewer).not.toContain("SERIAL_KILLER");
      expect(JSON.stringify(view.night ?? {}), viewer).not.toContain("killer");
    }
  });

  it("chính Sát Nhân thấy đủ lượt của mình", () => {
    const view = buildSnapshot(killerRoom(), "killer");

    expect(view.you?.role).toBe("SERIAL_KILLER");
    expect(view.night?.canAct).toBe(true);
    expect(view.night?.acted).toBe(true);
    expect(view.night?.serialKillerTarget).toBe("villager");
    expect(view.night?.serialKillerSkipped).toBe(false);
    // KHÔNG được thấy nạn nhân của bầy Sói: nó không phải đồng bọn của ai.
    expect(view.night?.wolfTarget).toBeNull();
  });

  it("ban đêm Sát Nhân KHÔNG vào được kênh chat của bầy Sói", () => {
    const room = killerRoom();
    const killer = resolveChat(room, "killer");
    const villager = resolveChat(room, "villager");

    expect(killer.ok).toBe(false);
    /*
     * ĐÚNG một câu từ chối với Dân Làng, không phải một câu riêng.
     *
     * Một thông điệp khác đi - dù chỉ khác một chữ - là một kênh phụ để đoán
     * vai: người chơi thử gửi một câu vào ban đêm rồi đọc lỗi trả về.
     */
    expect(killer).toEqual(villager);
  });

  it("Sói không thấy Sát Nhân trong danh sách đồng bọn", () => {
    const view = buildSnapshot(killerRoom(), "wolf");
    const revealed = view.players.filter((p) => p.role !== undefined).map((p) => p.id);
    expect(revealed).toEqual([]);
  });

  it("ở GAME_OVER thì vai lộ hết như mọi vai khác", () => {
    const room = killerRoom({ phase: "GAME_OVER", winner: "serial_killer" });
    const view = buildSnapshot(room, "villager");

    expect(view.players.find((p) => p.id === "killer")?.role).toBe("SERIAL_KILLER");
    expect(view.winner).toBe("serial_killer");
  });

  it("kết cục HOÀ đi tới client nguyên vẹn", () => {
    const room = killerRoom({ phase: "GAME_OVER", winner: "draw" });
    expect(buildSnapshot(room, "villager").winner).toBe("draw");
  });
});

describe("biên socket nhận hành động của Sát Nhân", () => {
  it("schema payload chấp nhận SERIAL_KILL kèm mục tiêu", () => {
    const parsed = gameActionPayload.safeParse({ type: "SERIAL_KILL", targetId: "villager" });
    expect(parsed.success).toBe(true);
  });

  it("vẫn từ chối một loại hành động không có thật", () => {
    // `.strict()` + enum là hàng rào đầu tiên; engine là hàng rào cuối.
    expect(gameActionPayload.safeParse({ type: "STAB", targetId: "villager" }).success).toBe(
      false,
    );
  });
});
