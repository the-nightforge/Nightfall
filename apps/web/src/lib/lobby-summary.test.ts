import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ROOM_CONFIG,
  MIN_PLAYERS_TO_START,
  generateWarnings,
  validateRoomConfig,
  type RoomConfig,
} from "@masoi/shared";
import { PRESET_DECKS } from "./balance";
import {
  deckCounts,
  deckStage,
  isPresetDeck,
  startBlock,
  type StartBlockInput,
} from "./lobby-summary";

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

  it("Thằng Hề chiếm một ghế: bớt một Dân Làng chứ không thêm một Dân Làng", () => {
    /*
     * `specials` ở đây đếm GHẾ ĐÃ BỊ LẤY, không đếm sức mạnh của phe nào - nên
     * một vai trung lập vẫn phải vào đó. Bỏ sót nó sẽ hiện ra một con số Dân
     * Làng nhiều hơn thực tế đúng một người, ngay ở màn host xếp bài.
     */
    const withJester = deckCounts(config({ werewolves: 2, seer: true, jester: true }), 8);
    const without = deckCounts(config({ werewolves: 2, seer: true }), 8);

    assert.equal(withJester.wolves, without.wolves);
    assert.equal(withJester.specials, without.specials + 1);
    assert.equal(withJester.villagers, without.villagers - 1);
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

  it("bật Thằng Hề là rời khỏi preset chuẩn", () => {
    // Không preset nào chứa vai trung lập, nên nhãn "Preset chuẩn" phải tắt
    // ngay khi host bật nó lên.
    assert.equal(isPresetDeck({ ...PRESET_DECKS[8], jester: true }, 8), false);
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

/**
 * Mặc định của một phòng KHÔNG bị chặn bởi thứ gì.
 *
 * Mỗi test chỉ khai đúng cái nó đang nói tới; thiếu helper này thì thêm một
 * đầu vào cho `startBlock` là phải sửa lại tay từng test, và cái sửa tay đó
 * chính là chỗ một luật chặn bị bỏ quên.
 */
function blockInput(patch: Partial<StartBlockInput> = {}): StartBlockInput {
  return {
    playerCount: MIN_PLAYERS_TO_START,
    configError: null,
    balanceBlocking: false,
    mode: "ranked",
    unreadyNames: [],
    ...patch,
  };
}

describe("startBlock", () => {
  it("thiếu người là lý do đầu tiên: cân bằng chưa có nghĩa gì khi bàn chưa đủ", () => {
    const block = startBlock(
      blockInput({
        playerCount: MIN_PLAYERS_TO_START - 2,
        configError: "Cấu hình sai",
        balanceBlocking: true,
        unreadyNames: ["Khải"],
      }),
    );
    assert.deepEqual(block, { kind: "need-players", missing: 2 });
  });

  it("đủ người rồi thì tới lỗi cấu hình", () => {
    const block = startBlock(blockInput({ configError: "Quá nhiều Sói", unreadyNames: ["Khải"] }));
    assert.deepEqual(block, { kind: "config", message: "Quá nhiều Sói" });
  });

  it("cuối cùng mới tới người chưa sẵn sàng", () => {
    const block = startBlock(blockInput({ unreadyNames: ["Khải", "Linh"] }));
    assert.deepEqual(block, { kind: "unready", names: ["Khải", "Linh"] });
  });

  it("không còn gì chặn thì trả null", () => {
    assert.equal(startBlock(blockInput()), null);
  });

  /*
   * Server từ chối `room:start` với BALANCE_UNSTABLE khi đội hình mất cân bằng
   * VÀ phòng đang ở Ranked (apps/server/src/rooms/service.ts). Trước đây client
   * không biết luật này, nên nút vẫn sáng và người bấm nhận về một dòng lỗi đỏ.
   */
  describe("cân bằng chặn Ranked", () => {
    it("Ranked + mất cân bằng thì chặn", () => {
      assert.deepEqual(startBlock(blockInput({ balanceBlocking: true })), { kind: "balance" });
    });

    it("Chaos + mất cân bằng thì KHÔNG chặn - server cũng cho qua", () => {
      assert.equal(startBlock(blockInput({ balanceBlocking: true, mode: "chaos" })), null);
    });

    it("cân bằng đứng TRƯỚC lỗi cấu hình, đúng thứ tự server kiểm", () => {
      assert.deepEqual(
        startBlock(blockInput({ balanceBlocking: true, configError: "Quá nhiều Sói" })),
        { kind: "balance" },
      );
    });

    it("cân bằng đứng trước cả người chưa sẵn sàng", () => {
      assert.deepEqual(
        startBlock(blockInput({ balanceBlocking: true, unreadyNames: ["Khải"] })),
        { kind: "balance" },
      );
    });

    it("Chaos vẫn dừng lại ở lỗi cấu hình", () => {
      assert.deepEqual(
        startBlock(blockInput({ balanceBlocking: true, mode: "chaos", configError: "Quá nhiều Sói" })),
        { kind: "config", message: "Quá nhiều Sói" },
      );
    });
  });

  /*
   * Hồi quy cho đúng cái phòng đã bắt gặp: host chốt preset ở một cỡ phòng,
   * thêm một người vào, và bộ bài cũ ở bàn mới rơi ra ngoài ngưỡng 40-60 nên
   * `blocking`. `validateRoomConfig` không thấy gì sai (nó chỉ đếm bài so với
   * người), nên bản cũ để nút sáng.
   *
   * Cặp số đổi từ (preset 7, bàn 8) sang (preset 9, bàn 10) vì preset 6 và 7 đã
   * gỡ khi `MIN_PLAYERS_TO_START` lên 8. Chiều lệch cũng đảo theo: ca cũ chấm
   * 33.5 (nghiêng về Sói), ca này chấm 62 (nghiêng về làng). Điều test khẳng
   * định không đổi - Ranked chặn, Chaos cho qua - và nó không phụ thuộc chiều.
   */
  it("preset 9 người dùng ở phòng 10 người: Ranked chặn, Chaos cho qua", () => {
    const config = PRESET_DECKS[9];
    const balance = generateWarnings(config, 10);
    assert.equal(balance.blocking, true, "tiền đề: engine phải coi đây là mất cân bằng");
    assert.equal(validateRoomConfig(config, 10), null, "tiền đề: cấu hình không có lỗi nào khác");

    const shared = { playerCount: 10, configError: validateRoomConfig(config, 10), unreadyNames: [] };
    assert.deepEqual(
      startBlock({ ...shared, balanceBlocking: balance.blocking, mode: "ranked" }),
      { kind: "balance" },
    );
    assert.equal(
      startBlock({ ...shared, balanceBlocking: balance.blocking, mode: "chaos" }),
      null,
    );
  });
});

/*
 * Phòng 1 người từng hiện cùng lúc: "Cần thêm 5 người nữa để bắt đầu", "Bộ bài
 * cho 1 người", một thanh cân bằng chấm 58 điểm, và một câu bảo "Bạn vẫn chơi
 * được". Chấm cân bằng cho một bàn chưa đủ người là chấm một thứ không tồn tại.
 */
describe("deckStage", () => {
  it("dưới mốc bắt đầu thì KHÔNG chấm cân bằng", () => {
    for (let count = 0; count < MIN_PLAYERS_TO_START; count += 1) {
      assert.equal(deckStage(count).rated, false, `phòng ${count} người vẫn bị chấm`);
    }
  });

  it("đủ mốc bắt đầu là chấm lại ngay", () => {
    assert.equal(deckStage(MIN_PLAYERS_TO_START).rated, true);
    assert.equal(deckStage(MIN_PLAYERS_TO_START + 1).rated, true);
  });

  it("chưa đủ người thì có câu giải thích thay cho thanh cân bằng", () => {
    const stage = deckStage(1);
    assert.ok(stage.pending);
    assert.match(stage.pending!, new RegExp(String(MIN_PLAYERS_TO_START)));
  });

  it("đủ người rồi thì không còn câu chờ nào", () => {
    assert.equal(deckStage(MIN_PLAYERS_TO_START).pending, null);
  });

  it('không gọi cấu hình là "bộ bài cho N người" khi N chưa đủ để chia bài', () => {
    for (let count = 0; count < MIN_PLAYERS_TO_START; count += 1) {
      assert.ok(
        !new RegExp(`Bộ bài cho ${count} người`).test(deckStage(count).summary),
        `phòng ${count} người vẫn tự nhận là một bộ bài`,
      );
    }
  });

  it("đủ người thì tóm tắt nói rõ bộ bài dành cho bao nhiêu người", () => {
    assert.match(deckStage(8).summary, /8 người/);
  });
});
