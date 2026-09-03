import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ROOM_CONFIG,
  ROLE_META,
  UNMEASURED_EXECUTIONER_WARNING,
  generateWarnings,
} from "@masoi/shared";
import { balanceCopy } from "./balance-copy";
import { roleLabel } from "./cursed";
import { CONFIG_KEY, NEUTRAL_ROLES, deckCounts, isPresetDeck } from "./lobby-summary";
import { PRESET_DECKS } from "./balance";
import { ROLE_ICON_PATHS } from "./role-art";
import { roleGoal } from "./role-goal";

/**
 * Phần giao diện của Kẻ Báo Thù không cần DOM.
 *
 * Bộ bài, câu chữ mục tiêu, nhãn vai đã đổi và cảnh báo cân bằng - bốn thứ hay
 * bị bỏ quên nhất khi thêm một vai, vì cả bốn đều là bảng tra và không có gì
 * nổ khi thiếu một dòng.
 */

describe("bộ bài ở sảnh chờ", () => {
  it("Kẻ Báo Thù nằm ở nhóm TRUNG LẬP, không phải nhóm Dân Làng", () => {
    assert.ok(NEUTRAL_ROLES.includes("EXECUTIONER"));
  });

  it("có khoá cấu hình để bật/tắt", () => {
    assert.equal(CONFIG_KEY.EXECUTIONER, "executioner");
  });

  it("chiếm một ghế, tức bớt một Dân Làng", () => {
    const off = deckCounts(DEFAULT_ROOM_CONFIG, 8);
    const on = deckCounts({ ...DEFAULT_ROOM_CONFIG, executioner: true }, 8);

    assert.equal(on.specials, off.specials + 1);
    assert.equal(on.villagers, off.villagers - 1);
    assert.equal(on.wolves, off.wolves);
  });

  it("bật lên là rời khỏi preset chuẩn", () => {
    const preset = PRESET_DECKS[9];
    assert.equal(isPresetDeck(preset, 9), true);
    assert.equal(isPresetDeck({ ...preset, executioner: true }, 9), false);
  });

  it("có biểu tượng riêng, không dùng chung với hai vai trung lập kia", () => {
    const icon = ROLE_ICON_PATHS.EXECUTIONER;
    assert.ok(typeof icon === "string" && icon.length > 0);
    assert.notEqual(icon, ROLE_ICON_PATHS.JESTER);
    assert.notEqual(icon, ROLE_ICON_PATHS.SERIAL_KILLER);
  });
});

describe("mục tiêu của vai, nói theo điều kiện thắng thật", () => {
  it("nói đủ ba vế: treo cổ, còn sống, và không cần tự tay kết tội", () => {
    const goal = roleGoal("EXECUTIONER");
    assert.match(goal, /treo cổ/);
    assert.match(goal, /còn sống/);
    assert.match(goal, /không cần chính bạn đề cử hay bỏ phiếu kết tội/);
  });

  it("nói cả đường hoá Thằng Hề", () => {
    // Thiếu vế này thì một người chơi mất mục tiêu sẽ tưởng mình vừa mất trắng
    // cả ván, trong khi luật vừa trao cho họ một ván thứ hai.
    assert.match(roleGoal("EXECUTIONER"), /Thằng Hề/);
  });

  it("KHÔNG dùng chung câu với hai vai trung lập kia", () => {
    assert.notEqual(roleGoal("EXECUTIONER"), roleGoal("JESTER"));
    assert.notEqual(roleGoal("EXECUTIONER"), roleGoal("SERIAL_KILLER"));
  });

  it("mô tả kỹ năng nói rõ không có hành động đêm", () => {
    assert.match(ROLE_META.EXECUTIONER.description, /không có hành động/i);
  });
});

describe("nhãn vai của người đã đổi vai", () => {
  it("kể lại được cả hai đầu câu chuyện", () => {
    assert.equal(
      roleLabel({ role: "JESTER", executionerTurned: true }),
      "Kẻ Báo Thù (đã hoá Thằng Hề)",
    );
  });

  it("người chưa đổi vai đọc ra tên vai bình thường", () => {
    assert.equal(roleLabel({ role: "EXECUTIONER" }), "Kẻ Báo Thù");
    assert.equal(roleLabel({ role: "JESTER" }), "Thằng Hề");
  });

  it("không đụng tới nhãn của Kẻ Nguyền Rủa", () => {
    assert.equal(
      roleLabel({ role: "WEREWOLF", cursedTurned: true }),
      "Kẻ Nguyền Rủa (đã hoá Ma Sói)",
    );
  });
});

describe("cảnh báo cân bằng nói rõ giới hạn, không bảo host đi sửa", () => {
  const preset = PRESET_DECKS[9];

  it("dịch cảnh báo thành một câu giải thích, KHÔNG thành một lời khuyên chỉnh bài", () => {
    const copy = balanceCopy(generateWarnings({ ...preset, executioner: true }, 9), 9);

    assert.ok(copy.advice.some((line) => /Kẻ Báo Thù/.test(line)));
    // Bộ bài này không lệch, nên không được có câu bảo bật/tắt thêm vai nào.
    assert.ok(!copy.advice.some((line) => /Hãy (bật|thêm|tắt|chỉnh)/.test(line)));
  });

  it("khi đó là cảnh báo DUY NHẤT thì tiêu đề nói 'ngoài thang đo'", () => {
    const copy = balanceCopy(generateWarnings({ ...preset, executioner: true }, 9), 9);

    assert.equal(copy.headline, "Bộ bài có vai ngoài thang đo");
    assert.equal(copy.blocksStart, false);
  });

  it("giữ nguyên bản kỹ thuật của engine để tra cứu", () => {
    const copy = balanceCopy(generateWarnings({ ...preset, executioner: true }, 9), 9);
    assert.ok(copy.technical.includes(UNMEASURED_EXECUTIONER_WARNING));
  });

  it("bộ bài không bật vai này thì không có câu nào của nó", () => {
    const copy = balanceCopy(generateWarnings(preset, 9), 9);
    assert.ok(!copy.advice.some((line) => /Kẻ Báo Thù/.test(line)));
  });
});
