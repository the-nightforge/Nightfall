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

describe("kết quả theo dõi ở bình minh", () => {
  it("Sói bỏ phiếu cắn đọc ra ĐÃ ra tay", () => {
    const engine = trackerGame();
    engine.submitNightAction("t1", "TRACK", "w1");
    engine.submitNightAction("w1", "KILL", "v1");
    engine.resolveNight(Date.now(), () => 0);
    expect(engine.state.night.trackerResults.t1).toEqual({ targetId: "w1", acted: true });
  });

  it("Dân Làng không có lượt đêm đọc ra KHÔNG ra tay", () => {
    const engine = trackerGame();
    engine.submitNightAction("t1", "TRACK", "v1");
    engine.submitNightAction("w1", "KILL", "s1");
    engine.resolveNight(Date.now(), () => 0);
    expect(engine.state.night.trackerResults.t1.acted).toBe(false);
  });

  it("Tiên Tri có soi cũng đọc ra ĐÃ ra tay - đây là manh mối, không phải bằng chứng", () => {
    const engine = trackerGame();
    engine.submitNightAction("t1", "TRACK", "s1");
    engine.submitNightAction("s1", "SEE", "w1");
    engine.submitNightAction("w1", "KILL", "v1");
    engine.resolveNight(Date.now(), () => 0);
    expect(engine.state.night.trackerResults.t1.acted).toBe(true);
  });

  it("Sói bỏ phiếu KHÔNG CẮN đọc ra không ra tay", () => {
    // Nước gỡ có thật của phe Sói; xem cảnh báo "trần" ở mục 7 của spec.
    // Bỏ phiếu không cắn đi qua "SKIP", không phải "KILL" với target null.
    const engine = trackerGame();
    engine.submitNightAction("t1", "TRACK", "w1");
    engine.submitNightAction("w1", "SKIP", null);
    engine.resolveNight(Date.now(), () => 0);
    expect(engine.state.night.trackerResults.t1.acted).toBe(false);
  });

  it("mục tiêu chết ngay đêm đó vẫn báo thật", () => {
    // Kẻ Theo Dõi canh người đó suốt đêm; kết quả không phụ thuộc việc họ
    // sống tới sáng.
    const engine = trackerGame();
    engine.state.players[3].role = "WITCH";
    engine.submitNightAction("t1", "TRACK", "w1");
    engine.submitNightAction("w1", "KILL", "s1");
    // Phù Thuỷ chỉ hành động sau khi bầy Sói đã khoá phiếu.
    engine.lockWolves(() => 0);
    engine.submitNightAction("v1", "POISON", "w1");
    engine.resolveNight(Date.now(), () => 0);
    expect(engine.state.players[1].alive).toBe(false);
    expect(engine.state.night.trackerResults.t1.acted).toBe(true);
  });

  it("Thiên Thần Hộ Mệnh có bảo vệ cũng đọc ra ĐÃ ra tay", () => {
    // GUARDIAN_ANGEL không nộp vào bất kỳ `Record` chung nào (khác Sói, Tiên
    // Tri, ...) - `didActTonight` phải tra riêng `guardianAngelTarget` qua
    // ánh xạ vai, giống hệt cách `nightInfo` đọc "acted" cho chính người này.
    const engine = trackerGame();
    engine.state.players[3].role = "GUARDIAN_ANGEL";
    engine.submitNightAction("t1", "TRACK", "v1");
    engine.submitNightAction("v1", "GUARDIAN_PROTECT", "v2");
    engine.submitNightAction("w1", "KILL", "s1");
    engine.resolveNight(Date.now(), () => 0);
    expect(engine.state.night.trackerResults.t1).toEqual({ targetId: "v1", acted: true });
  });
});

describe("kết quả theo dõi là riêng tư", () => {
  it("chỉ chủ nhân thấy kết quả của mình", () => {
    const engine = trackerGame();
    engine.submitNightAction("t1", "TRACK", "w1");
    engine.submitNightAction("w1", "KILL", "v1");
    engine.resolveNight(Date.now(), () => 0);

    expect(engine.snapshotFor("t1").trackerResult).toEqual({ targetId: "w1", acted: true });
    expect(engine.snapshotFor("s1").trackerResult).toBeNull();
    expect(engine.snapshotFor("w1").trackerResult).toBeNull();
  });

  it("BOT đọc được kết quả của chính nó", () => {
    const engine = trackerGame();
    engine.submitNightAction("t1", "TRACK", "w1");
    engine.submitNightAction("w1", "KILL", "v1");
    engine.resolveNight(Date.now(), () => 0);

    expect(engine.botKnowledgeFor("t1").trackerResult?.acted).toBe(true);
    expect(engine.botKnowledgeFor("s1").trackerResult).toBeNull();
  });
});
