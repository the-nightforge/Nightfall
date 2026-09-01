import { describe, expect, it } from "vitest";
import { GameEngine } from "@masoi/game-engine";
import { buildCaseFile, DEFAULT_ROOM_CONFIG, roleTeam } from "@masoi/shared";
import { buildSnapshot } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

const NAMES = ["An", "Bình", "Cường", "Dung", "Én", "Phúc"];

/** Phòng thật với engine thật: vai do `GameEngine.create` chia, không bịa state. */
function realRoom(): Room {
  const players = NAMES.map((name, index) => ({ id: `p${index}`, name, isBot: false }));
  return {
    ...ROOM_SCAFFOLD,
    code: "CASE1",
    hostId: "p0",
    status: "IN_GAME",
    members: players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: GameEngine.create(players, { ...DEFAULT_ROOM_CONFIG }),
    chatLog: [],
    createdAt: 0,
  };
}

/** Một người phe làng, để phép thử "không lộ vai" không rơi vào tầm nhìn của Sói. */
function villagerViewer(room: Room): string {
  const villager = room.engine!.getState().players.find((p) => roleTeam(p.role) === "village");
  return villager!.id;
}

describe("hợp đồng hồ sơ vụ án", () => {
  it("không có hồ sơ trong lúc ván đang chạy", () => {
    const room = realRoom();
    const viewer = villagerViewer(room);
    expect(buildCaseFile(buildSnapshot(room, viewer))).toBeNull();
  });

  it("không lộ vai người khác trước khi ván kết thúc", () => {
    const room = realRoom();
    const viewer = villagerViewer(room);
    const others = buildSnapshot(room, viewer).players.filter((p) => p.id !== viewer);
    for (const player of others) expect(player.role).toBeUndefined();
  });

  it("ván kết thúc thì dựng được hồ sơ với đủ roster", () => {
    const room = realRoom();
    const viewer = villagerViewer(room);
    room.engine!.finishGame("village");

    const file = buildCaseFile(buildSnapshot(room, viewer));
    expect(file).not.toBeNull();
    expect(file!.cast).toHaveLength(NAMES.length);
    expect(file!.winner).toBe("village");
    expect(file!.highlights.length).toBeGreaterThanOrEqual(1);
  });

  it("mọi người trong phòng dựng ra CÙNG một hồ sơ", () => {
    const room = realRoom();
    room.engine!.finishGame("wolves");

    const files = room.members.map((member) => buildCaseFile(buildSnapshot(room, member.playerId)));
    const first = JSON.stringify(files[0]);
    for (const file of files) expect(JSON.stringify(file)).toBe(first);
  });

  it("nối lại ở GAME_OVER vẫn ra đúng hồ sơ cũ", () => {
    const room = realRoom();
    const viewer = villagerViewer(room);
    room.engine!.finishGame("village");

    // Hai lần dựng snapshot cách nhau đúng như một lần reconnect: `serverNow`
    // khác nhau, mọi thứ còn lại giữ nguyên.
    const before = buildCaseFile(buildSnapshot(room, viewer));
    const after = buildCaseFile(buildSnapshot(room, viewer));
    expect(after!.caseId).toBe(before!.caseId);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it("hồ sơ KHÔNG được truyền qua snapshot - không thêm byte nào lên dây", () => {
    const room = realRoom();
    room.engine!.finishGame("village");
    const snapshot = buildSnapshot(room, villagerViewer(room));

    expect(Object.keys(snapshot)).not.toContain("caseFile");
    const wire = JSON.stringify(snapshot);
    expect(wire).not.toContain("caseId");
    expect(wire).not.toContain("highlights");
  });

  it("hồ sơ không mang mã phòng ra ngoài", () => {
    const room = realRoom();
    room.engine!.finishGame("village");
    const file = buildCaseFile(buildSnapshot(room, villagerViewer(room)));
    expect(JSON.stringify(file)).not.toContain("CASE1");
  });
});
