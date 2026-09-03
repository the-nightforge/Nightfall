import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Sổ ghi chú chạy trên `window.localStorage`, nên test dựng một cái giả TRƯỚC
 * khi import module - module đọc `window` ở lần gọi đầu tiên chứ không ở lúc
 * nạp, nhưng dựng sẵn thì không phải phụ thuộc vào chi tiết đó.
 */
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  },
};

// Test gọi thẳng phần thuần. `usePlayerNotes` chỉ bọc ba hàm này lại cho React,
// và một cái vỏ hook thì cần một cây React mới gọi được - trong khi toàn bộ thứ
// có thể sai đều nằm ở đây.
//
// Import tĩnh dù `window` giả được gán ở trên: module chỉ chạm `window` bên
// TRONG các hàm, không lúc nạp. Top-level await thì tsx không dịch được.
import { NOTE_MARKS, clearNotes, cycleNote, readNotes } from "./player-notes";

describe("sổ ghi chú người chơi", () => {
  it("bấm lần lượt đi hết vòng dấu rồi xoá", () => {
    const code = "CYCLE";
    for (const mark of NOTE_MARKS) {
      cycleNote(code, "p2");
      assert.equal(readNotes(code).p2, mark);
    }
    // Hết vòng thì dấu biến mất chứ không quay lại dấu đầu: người chơi phải gỡ
    // được một ghi chú sai mà không phải bấm qua cả vòng lần nữa.
    cycleNote(code, "p2");
    assert.equal(readNotes(code).p2, undefined);
  });

  it("mỗi phòng một sổ riêng", () => {
    cycleNote("ISO_A", "p2");
    assert.equal(readNotes("ISO_B").p2, undefined);
    assert.equal(readNotes("ISO_A").p2, NOTE_MARKS[0]);
  });

  it("bỏ qua dấu lạ đọc lên từ localStorage", () => {
    // Người dùng sửa được localStorage bằng devtools; một `mark` lạ tra ra
    // undefined trong NOTE_META và làm chết cả hàng đang render.
    store.set("masoi:notes:ROOM3", JSON.stringify({ p2: "wolf", p3: "sus" }));
    const notes = readNotes("ROOM3");
    assert.equal(notes.p2, undefined);
    assert.equal(notes.p3, "sus");
  });

  it("trả về CÙNG một đối tượng khi chưa có gì đổi", () => {
    // useSyncExternalStore so snapshot bằng Object.is: một đối tượng mới ở mỗi
    // lần đọc là một vòng render vô hạn.
    const code = "ROOM4";
    assert.equal(readNotes(code), readNotes(code));
  });

  it("xoá hết dấu của phòng", () => {
    const code = "ROOM5";
    cycleNote(code, "p2");
    cycleNote(code, "p3");
    clearNotes(code);
    assert.deepEqual({ ...readNotes(code) }, {});
  });
});
