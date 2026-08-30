import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, MIN_PLAYERS_TO_START, type RoomConfig } from "@masoi/shared";
import { PRESET_DECKS } from "./balance";
import { deckCounts, isPresetDeck, startBlock } from "./lobby-summary";

/**
 * Bộ bài trắng: DEFAULT_ROOM_CONFIG đã bật sẵn Tiên Tri, Bảo Vệ và Phù Thuỷ,
 * nên dựng test từ nó thì mỗi phép đếm đều cõng thêm ba vai không ai khai báo.
 */
function config(patch: Partial<RoomConfig> = {}): RoomConfig {
  return {
    ...DEFAULT_ROOM_CONFIG,
    werewolves: 1,
    seer: false,
    guard: false,
    witch: false,
    hunter: false,
    cursed: false,
    wolfCub: false,
    apprenticeSeer: false,
    detective: false,
    guardianAngel: false,
    priest: false,
    mayor: false,
    ...patch,
  };
}

describe("deckCounts", () => {
  it("Dân Làng lấp phần còn lại", () => {
    const counts = deckCounts(config({ werewolves: 2, seer: true, witch: true }), 8);
    assert.deepEqual(counts, { wolves: 2, specials: 2, villagers: 4 });
  });

  it("Sói Con tính vào phe Sói chứ không phải vào chức năng của làng", () => {
    const counts = deckCounts(config({ werewolves: 2, wolfCub: true, seer: true }), 9);
    assert.equal(counts.wolves, 3);
    assert.equal(counts.specials, 1);
    assert.equal(counts.villagers, 5);
  });

  it("bài nhiều hơn người thì số Dân Làng dừng ở 0, không xuống âm", () => {
    const counts = deckCounts(
      config({ werewolves: 4, seer: true, witch: true, guard: true, hunter: true }),
      3,
    );
    assert.equal(counts.villagers, 0);
  });
});

describe("isPresetDeck", () => {
  it("đúng preset chuẩn thì nhận ra", () => {
    assert.equal(isPresetDeck(PRESET_DECKS[8], 8), true);
  });

  it("bật thêm một vai là đã rời preset", () => {
    assert.equal(isPresetDeck({ ...PRESET_DECKS[8], mayor: true }, 8), false);
  });

  it("đổi giây thảo luận không phải đổi bộ bài", () => {
    assert.equal(isPresetDeck({ ...PRESET_DECKS[8], discussionSeconds: 90 }, 8), true);
  });

  it("chế độ Ranked/Chaos không nằm trong bộ bài", () => {
    assert.equal(isPresetDeck({ ...PRESET_DECKS[8], mode: "chaos" }, 8), true);
  });

  it("số người không có preset thì không có gì để khớp", () => {
    assert.equal(isPresetDeck(PRESET_DECKS[8], 3), false);
  });
});

describe("startBlock", () => {
  it("thiếu người là lý do đầu tiên: cân bằng chưa có nghĩa gì khi bàn chưa đủ", () => {
    const block = startBlock({
      playerCount: MIN_PLAYERS_TO_START - 2,
      configError: "Cấu hình sai",
      unreadyNames: ["Khải"],
    });
    assert.deepEqual(block, { kind: "need-players", missing: 2 });
  });

  it("đủ người rồi thì tới lỗi cấu hình", () => {
    const block = startBlock({
      playerCount: MIN_PLAYERS_TO_START,
      configError: "Quá nhiều Sói",
      unreadyNames: ["Khải"],
    });
    assert.deepEqual(block, { kind: "config", message: "Quá nhiều Sói" });
  });

  it("cuối cùng mới tới người chưa sẵn sàng", () => {
    const block = startBlock({
      playerCount: MIN_PLAYERS_TO_START,
      configError: null,
      unreadyNames: ["Khải", "Linh"],
    });
    assert.deepEqual(block, { kind: "unready", names: ["Khải", "Linh"] });
  });

  it("không còn gì chặn thì trả null", () => {
    assert.equal(
      startBlock({ playerCount: MIN_PLAYERS_TO_START, configError: null, unreadyNames: [] }),
      null,
    );
  });
});
