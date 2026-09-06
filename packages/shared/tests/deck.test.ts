import { describe, expect, it } from "vitest";
import { DECK_KEYS, applyDeck, sameDeck } from "../src/deck";
import { PRESET_DECKS } from "../src/balance";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "../src/phases";

/**
 * Phần BỘ BÀI của cấu hình phòng, tách khỏi phần luật chơi.
 *
 * Hai người dùng thật của ranh giới này:
 *
 *   - Server chỉ được chấm cân bằng và kiểm cỡ bàn khi BỘ BÀI đổi. Host gạt
 *     một add-on hay đổi giây thảo luận không làm bộ bài lệch thêm chút nào,
 *     nên không có lý do gì để một bộ bài đang lệch khoá luôn cả những công
 *     tắc ấy.
 *   - Nút "Áp dụng đội hình chuẩn" ở sảnh chờ chỉ được thay BỘ BÀI. Preset
 *     mang sẵn `mode: "ranked"` và bộ giây mặc định, nên đổ nguyên preset đè
 *     lên cấu hình là âm thầm kéo phòng Chaos về Ranked, tắt voice và tắt
 *     Phong thư sau cùng - đúng những thứ host vừa chỉnh một phút trước.
 */
describe("DECK_KEYS", () => {
  it("chứa số Sói, số Dân Làng và mọi công tắc vai, nhưng không chứa chế độ, giây hay add-on", () => {
    for (const key of ["werewolves", "villagers", "seer", "wolfCub", "traitor", "jester", "serialKiller", "executioner"]) {
      expect(DECK_KEYS, key).toContain(key);
    }
    for (const key of ["mode", "voice", "lastLetter", "nightSeconds", "discussionSeconds", "voteSeconds", "defenseSeconds", "finalVoteSeconds"]) {
      expect(DECK_KEYS, key).not.toContain(key);
    }
  });
});

describe("sameDeck", () => {
  it("bỏ qua chế độ, add-on và thời gian", () => {
    const a: RoomConfig = { ...DEFAULT_ROOM_CONFIG, mode: "ranked" };
    const b: RoomConfig = { ...a, mode: "chaos", lastLetter: true, voice: true, discussionSeconds: 120 };
    expect(sameDeck(a, b)).toBe(true);
  });

  it("thấy khác khi một lá đổi", () => {
    expect(sameDeck(DEFAULT_ROOM_CONFIG, { ...DEFAULT_ROOM_CONFIG, hunter: true })).toBe(false);
    expect(sameDeck(DEFAULT_ROOM_CONFIG, { ...DEFAULT_ROOM_CONFIG, werewolves: 3 })).toBe(false);
    expect(sameDeck(DEFAULT_ROOM_CONFIG, { ...DEFAULT_ROOM_CONFIG, villagers: 5 })).toBe(false);
  });

  it("coi cờ vắng mặt và cờ false là một - cấu hình cũ không có trường jester", () => {
    const old = { ...DEFAULT_ROOM_CONFIG };
    delete (old as Partial<RoomConfig>).jester;
    expect(sameDeck(old, { ...DEFAULT_ROOM_CONFIG, jester: false })).toBe(true);
  });
});

describe("applyDeck", () => {
  it("giữ chế độ, add-on và thời gian của phòng, chỉ thay bộ bài", () => {
    const room: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      mode: "chaos",
      lastLetter: true,
      voice: true,
      discussionSeconds: 120,
      jester: true,
      werewolves: 4,
    };
    const next = applyDeck(room, PRESET_DECKS[8]);
    expect(next.mode).toBe("chaos");
    expect(next.lastLetter).toBe(true);
    expect(next.voice).toBe(true);
    expect(next.discussionSeconds).toBe(120);
    expect(sameDeck(next, PRESET_DECKS[8])).toBe(true);
    expect(next.jester).toBe(false);
    expect(next.werewolves).toBe(PRESET_DECKS[8].werewolves);
    expect(next.villagers).toBe(PRESET_DECKS[8].villagers);
  });

  it("không đụng vào hai đầu vào", () => {
    const room: RoomConfig = { ...DEFAULT_ROOM_CONFIG, mode: "chaos" };
    const preset = { ...PRESET_DECKS[8] };
    applyDeck(room, preset);
    expect(room).toEqual({ ...DEFAULT_ROOM_CONFIG, mode: "chaos" });
    expect(preset).toEqual(PRESET_DECKS[8]);
  });
});
