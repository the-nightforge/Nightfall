import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_PLAYERS_PER_ROOM } from "@masoi/shared";
import { AVATAR_IDS, AVATAR_PATHS } from "./avatar-art";
import { assignAvatars, tintFor } from "./avatar";

const ids = (count: number) => Array.from({ length: count }, (_, i) => `player-${i}`);

describe("assignAvatars", () => {
  it("phòng đầy vẫn không ai trùng hình", () => {
    const table = assignAvatars(ids(MAX_PLAYERS_PER_ROOM));
    const used = Object.values(table);
    assert.equal(used.length, MAX_PLAYERS_PER_ROOM);
    assert.equal(new Set(used).size, MAX_PLAYERS_PER_ROOM);
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

  it("đủ hình cho một phòng đầy", () => {
    assert.ok(AVATAR_IDS.length >= MAX_PLAYERS_PER_ROOM);
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
