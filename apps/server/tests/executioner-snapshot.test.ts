import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { buildSnapshot } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

/**
 * Ranh giới của Kẻ Báo Thù ở tầng SNAPSHOT.
 *
 * Engine đã có bộ test riêng cho `snapshotFor`; đây là tầng thứ hai và nó kiểm
 * một câu khác: cái mà `buildSnapshot` thật sự đẩy lên dây có mang thêm gì
 * không. Hai tầng vì đã có tiền lệ - `buildSnapshot` lắp thêm avatar, chat,
 * voice và thư, và mỗi trường lắp thêm là một cơ hội để một bí mật đi nhờ.
 */

const OTHERS = ["wolf", "target", "seer", "witch", "villager"];

function executionerRoom(over: Partial<GameState> = {}): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: "DAY_DISCUSSION",
    round: 2,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: false },
      { id: "target", name: "Mục Tiêu", role: "VILLAGER", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
      { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, executioner: true },
    night: { ...NIGHT_SCAFFOLD },
    executionerTargets: { exec: "target" },
    ...over,
  };

  return {
    ...ROOM_SCAFFOLD,
    code: "EXSNP",
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

describe("Snapshot của Kẻ Báo Thù", () => {
  it("chính chủ thấy đủ nhiệm vụ của mình", () => {
    const view = buildSnapshot(executionerRoom(), "exec");

    expect(view.you?.role).toBe("EXECUTIONER");
    expect(view.executioner).toEqual({
      target: { id: "target", name: "Mục Tiêu", alive: true },
      won: false,
      turnedJester: false,
    });
  });

  it("không ai khác thấy nhiệm vụ, kể cả chính mục tiêu", () => {
    const room = executionerRoom();
    for (const viewer of OTHERS) {
      const view = buildSnapshot(room, viewer);
      expect(view.executioner, viewer).toBeNull();
      expect(view.players.find((p) => p.id === "exec")?.role, viewer).toBeUndefined();
      /*
       * Quét cả chuỗi chứ không chỉ trường đã biết: một đường rò mới sẽ đi qua
       * một trường mà bài test này chưa nghe tên. `EXECUTIONER` là tên vai và
       * `executionerTargets` là tên bảng nhiệm vụ - cả hai không được xuất hiện
       * ở đâu trong payload của người ngoài.
       */
      expect(JSON.stringify(view), viewer).not.toContain("EXECUTIONER");
      expect(JSON.stringify(view), viewer).not.toContain("executionerTargets");
    }
  });

  it("khán giả đã chết cũng không thấy gì thêm", () => {
    const room = executionerRoom();
    room.engine!.state.players.find((p) => p.id === "seer")!.alive = false;

    const view = buildSnapshot(room, "seer");
    expect(view.executioner).toBeNull();
    expect(JSON.stringify(view)).not.toContain("EXECUTIONER");
  });

  it("sau khi chuyển vai, chỉ chính chủ biết - và biết ngay lập tức", () => {
    const room = executionerRoom();
    room.engine!.state.players.find((p) => p.id === "target")!.alive = false;
    room.engine!.settleExecutioner();

    const mine = buildSnapshot(room, "exec");
    expect(mine.you?.role).toBe("JESTER");
    expect(mine.you?.executionerTurned).toBe(true);
    expect(mine.executioner?.turnedJester).toBe(true);

    for (const viewer of OTHERS) {
      const view = buildSnapshot(room, viewer);
      expect(view.players.find((p) => p.id === "exec")?.role, viewer).toBeUndefined();
      expect(
        view.players.find((p) => p.id === "exec")?.executionerTurned,
        viewer,
      ).toBeUndefined();
    }
  });

  it("ở GAME_OVER thì cờ chuyển vai công khai cùng toàn bộ vai", () => {
    const room = executionerRoom();
    room.engine!.state.players.find((p) => p.id === "target")!.alive = false;
    room.engine!.settleExecutioner();
    room.engine!.finishGame("wolves");

    const view = buildSnapshot(room, "villager");
    const exec = view.players.find((p) => p.id === "exec")!;
    expect(exec.role).toBe("JESTER");
    expect(exec.executionerTurned).toBe(true);
    // Nhưng mục tiêu thì KHÔNG mở ra: nó chỉ có nghĩa với đúng một người.
    expect(view.executioner).toBeNull();
  });

  it("thắng cá nhân chỉ đi tới chính người đó trước GAME_OVER", () => {
    const room = executionerRoom();
    const engine = room.engine!;
    engine.setPhase("VOTING", 30_000, 0);
    for (const voter of engine.alivePlayers()) {
      if (voter.id !== "target") engine.submitVote(voter.id, "target", 10_000);
    }
    engine.resolveNomination(25_000, 30_000);
    engine.beginFinalVote(20_000);
    for (const voter of engine.finalVoters()) engine.submitFinalVote(voter.id, true);
    engine.resolveFinalVote();

    expect(buildSnapshot(room, "exec").personalWins).toHaveLength(1);
    expect(buildSnapshot(room, "exec").executioner?.won).toBe(true);
    for (const viewer of OTHERS) {
      expect(buildSnapshot(room, viewer).personalWins, viewer).toEqual([]);
    }
  });

  it("log công khai của snapshot không nhắc tới nhiệm vụ", () => {
    const room = executionerRoom();
    room.engine!.state.players.find((p) => p.id === "target")!.alive = false;
    room.engine!.settleExecutioner();

    for (const viewer of [...OTHERS, "exec"]) {
      expect(buildSnapshot(room, viewer).log.join("\n"), viewer).not.toMatch(/Kẻ Báo Thù/);
    }
  });

  it("phòng KHÔNG bật vai này thì không ai có khối nhiệm vụ", () => {
    const room = executionerRoom({
      config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1 },
      executionerTargets: {},
      players: [
        { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
        { id: "exec", name: "Không phải", role: "VILLAGER", alive: true, isBot: false },
        { id: "target", name: "Mục Tiêu", role: "VILLAGER", alive: true, isBot: false },
        { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
        { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
        { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      ],
    });

    for (const viewer of [...OTHERS, "exec"]) {
      expect(buildSnapshot(room, viewer).executioner, viewer).toBeNull();
    }
  });
});
