import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

// Bộ bài tối thiểu 6 người (giới hạn cứng của `buildRoleDeck`), rồi ép vai
// vào đúng ghế cần cho test thay vì phụ thuộc phép chia bài ngẫu nhiên.
const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 1,
  seer: true,
  guard: false,
  witch: false,
  hunter: false,
  cursed: false,
  tracker: true,
  villagers: 3,
};

function trackerGame() {
  const engine = GameEngine.create(
    [
      { id: "t1", name: "Theo Doi", isBot: false },
      { id: "w1", name: "Soi", isBot: false },
      { id: "s1", name: "Tien Tri", isBot: false },
      { id: "v1", name: "Dan", isBot: false },
      { id: "v2", name: "Dan 2", isBot: false },
      { id: "v3", name: "Dan 3", isBot: false },
    ],
    CONFIG,
  );
  // Ép vai để test tất định thay vì phụ thuộc phép chia bài.
  engine.state.players[0].role = "TRACKER";
  engine.state.players[1].role = "WEREWOLF";
  engine.state.players[2].role = "SEER";
  engine.state.players[3].role = "VILLAGER";
  engine.state.players[4].role = "VILLAGER";
  engine.state.players[5].role = "VILLAGER";
  engine.startNight(30_000);
  return engine;
}

describe("luật của lượt TRACK", () => {
  it("ghi lại mục tiêu hợp lệ", () => {
    const engine = trackerGame();
    engine.submitNightAction("t1", "TRACK", "w1");
    expect(engine.state.night.trackerTargets.t1).toBe("w1");
  });

  it("không được tự theo dõi", () => {
    const engine = trackerGame();
    expect(() => engine.submitNightAction("t1", "TRACK", "t1")).toThrow(/chính mình/);
  });

  it("không được theo dõi người đã chết", () => {
    const engine = trackerGame();
    engine.state.players[1].alive = false;
    expect(() => engine.submitNightAction("t1", "TRACK", "w1")).toThrow();
  });

  it("CHO PHÉP theo dõi lại cùng một người hai đêm liền", () => {
    // Khác Bảo Vệ có chủ ý: câu trả lời đổi theo từng đêm nên lặp là chiến
    // thuật thật, không phải nước trội.
    const engine = trackerGame();
    engine.submitNightAction("t1", "TRACK", "w1");
    engine.resolveNight(Date.now(), () => 0);
    engine.startNight(30_000);
    expect(() => engine.submitNightAction("t1", "TRACK", "w1")).not.toThrow();
  });

  it("chỉ Kẻ Theo Dõi mới được dùng", () => {
    const engine = trackerGame();
    expect(() => engine.submitNightAction("v1", "TRACK", "w1")).toThrow(/Kẻ Theo Dõi/);
  });
});
