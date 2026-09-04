import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_PLAYERS_PER_ROOM } from "@masoi/shared";
import { AVATAR_IDS, AVATAR_PATHS } from "./avatar-art";
import { assignAvatars, breathOffsetFor, tintFor } from "./avatar";

const ids = (count: number) => Array.from({ length: count }, (_, i) => `player-${i}`);

describe("assignAvatars", () => {
  it("không ai trùng hình chừng nào còn đủ hình", () => {
    // Trần là SỐ HÌNH, không phải `MAX_PLAYERS_PER_ROOM`. Hai con số này trùng
    // nhau tới khi trần phòng lên 20 (2026-09-04) trong khi `AVATAR_IDS` vẫn
    // là 16 hình. Khẳng định tính duy nhất theo trần phòng khi đó không còn là
    // một phép kiểm - nó là một điều bất khả.
    const table = assignAvatars(ids(AVATAR_IDS.length));
    const used = Object.values(table);
    assert.equal(used.length, AVATAR_IDS.length);
    assert.equal(new Set(used).size, AVATAR_IDS.length);
  });

  it("phòng đông hơn số hình thì cấp trùng, không bỏ trống ô nào", () => {
    // Đường lui này vốn đã có trong `assignAvatars` và có chú thích ở đó; từ
    // khi trần phòng lên 20 nó là đường đi THẬT của bốn ghế cuối, nên nó cần
    // một phép kiểm thay vì một lời hứa trong bình luận.
    const table = assignAvatars(ids(MAX_PLAYERS_PER_ROOM));
    const used = Object.values(table);
    assert.equal(used.length, MAX_PLAYERS_PER_ROOM);
    assert.equal(new Set(used).size, Math.min(MAX_PLAYERS_PER_ROOM, AVATAR_IDS.length));
    for (const id of used) assert.ok(AVATAR_IDS.includes(id));
  });

  it("thứ tự mảng không đổi kết quả: người vào sau không làm ai đổi mặt", () => {
    const before = assignAvatars(["c", "a", "b"]);
    const after = assignAvatars(["b", "d", "a", "c"]);
    for (const id of ["a", "b", "c"]) {
      assert.equal(after[id], before[id], id);
    }
  });

  it("cùng một tập id luôn ra cùng một bảng, nên mọi máy thấy giống nhau", () => {
    assert.deepEqual(assignAvatars(ids(9)), assignAvatars(ids(9)));
  });

  it("hình được gán đều nằm trong bộ đã khai báo", () => {
    for (const avatar of Object.values(assignAvatars(ids(12)))) {
      assert.ok(AVATAR_IDS.includes(avatar), avatar);
    }
  });

  it("bảng rỗng khi chưa có ai", () => {
    assert.deepEqual(assignAvatars([]), {});
  });
});

describe("avatar art", () => {
  it("mỗi id đều có path và không id nào thừa", () => {
    assert.deepEqual(Object.keys(AVATAR_PATHS).sort(), [...AVATAR_IDS].sort());
  });

  it("đủ hình cho phần lớn một phòng đầy", () => {
    // KHÔNG còn là `>= MAX_PLAYERS_PER_ROOM`: trần phòng lên 20 mà bộ hình vẫn
    // 16. Ngưỡng 16 ở đây khoá lại chính bộ hình hiện có, để một lần "dọn dẹp"
    // không lặng lẽ rút nó xuống - và bốn ghế chênh lệch đã có phép kiểm riêng
    // ở `assignAvatars`. Bổ sung hình vào `avatar-art.ts` thì nâng số này lên
    // và trả phép kiểm trùng hình kia về đúng ngưỡng mới.
    assert.ok(AVATAR_IDS.length >= 16);
  });

  it("đã bỏ ô nền đen của bản gốc, chỉ còn hình", () => {
    for (const [id, d] of Object.entries(AVATAR_PATHS)) {
      assert.notEqual(d, "M0 0h512v512H0z", id);
      assert.ok(d.length > 100, id);
    }
  });
});

describe("tintFor", () => {
  it("cùng một người luôn ra cùng sắc nền", () => {
    assert.equal(tintFor("player-3"), tintFor("player-3"));
  });

  it("không phải ai cũng chung một sắc nền", () => {
    assert.ok(new Set(ids(12).map(tintFor)).size > 1);
  });
});

describe("breathOffsetFor", () => {
  it("luôn nằm trong 0..1 vì CSS nhân thẳng với một chu kỳ", () => {
    for (const id of ids(MAX_PLAYERS_PER_ROOM)) {
      const offset = breathOffsetFor(id);
      assert.ok(offset >= 0 && offset < 1, `${id}: ${offset}`);
    }
  });

  it("cùng id luôn ra cùng nhịp, nên nhịp thở không nhảy khi render lại", () => {
    assert.equal(breathOffsetFor("player-3"), breathOffsetFor("player-3"));
  });

  it("cả phòng đầy không ai trùng nhịp: trùng là thấy rõ hai ô phập phồng y hệt", () => {
    const offsets = ids(MAX_PLAYERS_PER_ROOM).map(breathOffsetFor);
    assert.equal(new Set(offsets).size, MAX_PLAYERS_PER_ROOM);
  });

  it("trải đều chứ không dồn một góc chu kỳ", () => {
    const offsets = ids(MAX_PLAYERS_PER_ROOM).map(breathOffsetFor);
    assert.ok(Math.min(...offsets) < 0.35, `min ${Math.min(...offsets)}`);
    assert.ok(Math.max(...offsets) > 0.65, `max ${Math.max(...offsets)}`);
  });
});
