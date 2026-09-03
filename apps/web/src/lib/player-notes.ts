"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Sổ nghi ngờ của riêng người xem.
 *
 * Chỉ sống trong trình duyệt của chính họ: không snapshot, không socket, không
 * server. Đây là ghi chú cá nhân - gửi nó đi thì nó thành một kênh rò thông tin
 * mới, và một cái dấu "chắc chắn là Sói" lọt sang máy người khác là hỏng ván.
 *
 * Có mặt vì bàn 15 người giấu vai người chết tới tận `GAME_OVER`: người chơi
 * phải nhớ toàn bộ ai khai gì, ai bầu ai, qua sáu bảy vòng, bằng đầu. Ba cái
 * dấu không thay được việc suy luận, chúng chỉ thay cuốn sổ tay mà người chơi
 * nghiêm túc nào cũng đang tự mở bên cạnh.
 */
export const NOTE_MARKS = ["sus", "watch", "clear"] as const;
export type NoteMark = (typeof NOTE_MARKS)[number];

export const NOTE_META: Record<NoteMark, { icon: string; label: string }> = {
  sus: { icon: "🔪", label: "Nghi là Sói" },
  watch: { icon: "👁", label: "Còn để ý" },
  clear: { icon: "🛡", label: "Tin là Dân" },
};

export type PlayerNotes = Readonly<Record<string, NoteMark>>;

const EMPTY: PlayerNotes = Object.freeze({});

/**
 * Cache theo phòng, và nó BẮT BUỘC phải có.
 *
 * `useSyncExternalStore` so sánh snapshot bằng `Object.is` và render lại khi
 * lệch. Đọc thẳng localStorage rồi `JSON.parse` ở mỗi lần gọi sẽ trả về một đối
 * tượng MỚI mỗi lần, nên nó lệch vĩnh viễn với chính nó và React lặp vô hạn.
 */
const cache = new Map<string, PlayerNotes>();
const listeners = new Set<() => void>();

function storageKey(code: string): string {
  return `masoi:notes:${code}`;
}

export function readNotes(code: string): PlayerNotes {
  const cached = cache.get(code);
  if (cached) return cached;

  let parsed: PlayerNotes = EMPTY;
  try {
    const raw = window.localStorage.getItem(storageKey(code));
    if (raw) {
      const data: unknown = JSON.parse(raw);
      if (data && typeof data === "object") {
        // Lọc lại từng giá trị: dữ liệu này người dùng sửa được bằng devtools,
        // và một `mark` lạ sẽ tra ra undefined trong NOTE_META rồi làm chết cả
        // hàng đang render.
        const clean: Record<string, NoteMark> = {};
        for (const [id, mark] of Object.entries(data as Record<string, unknown>)) {
          if (NOTE_MARKS.includes(mark as NoteMark)) clean[id] = mark as NoteMark;
        }
        parsed = clean;
      }
    }
  } catch {
    // Chế độ riêng tư hoặc trình duyệt chặn site data: chơi tiếp không ghi chú
    // còn hơn là không vào được phòng.
  }
  cache.set(code, parsed);
  return parsed;
}

function writeNotes(code: string, next: PlayerNotes): void {
  cache.set(code, next);
  try {
    window.localStorage.setItem(storageKey(code), JSON.stringify(next));
  } catch {
    /* hết quota hoặc bị chặn: dấu vẫn sống trong phiên này, chỉ không lưu lại */
  }
  for (const listener of listeners) listener();
}

/**
 * Đẩy một ghế sang dấu kế tiếp; hết vòng thì gỡ dấu hẳn.
 *
 * Tách khỏi hook vì đây là toàn bộ phần có thể sai - vòng quay, việc lọc dữ
 * liệu bẩn, việc ghi xuống đĩa - còn hook chỉ là đầu nối sang React. Hàm thuần
 * thì test gọi thẳng được, không phải dựng một cây React chỉ để bấm một nút.
 */
export function cycleNote(code: string, playerId: string): void {
  const current = readNotes(code);
  const at = NOTE_MARKS.indexOf(current[playerId] as NoteMark);
  // indexOf trả -1 khi chưa có dấu, nên +1 rơi đúng vào dấu đầu tiên.
  const mark = NOTE_MARKS[at + 1];

  const next = { ...current };
  if (mark === undefined) delete next[playerId];
  else next[playerId] = mark;
  writeNotes(code, next);
}

export function clearNotes(code: string): void {
  writeNotes(code, EMPTY);
}

export function usePlayerNotes(code: string): {
  notes: PlayerNotes;
  cycle: (playerId: string) => void;
  clearAll: () => void;
} {
  const notes = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => readNotes(code),
    // Server render không có localStorage, và trả về EMPTY ở đó là đúng: ghi
    // chú là của một trình duyệt cụ thể, HTML dựng sẵn không được mang theo nó.
    () => EMPTY,
  );

  const cycle = useCallback((playerId: string) => cycleNote(code, playerId), [code]);
  const clearAll = useCallback(() => clearNotes(code), [code]);

  return { notes, cycle, clearAll };
}
