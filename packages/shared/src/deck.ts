import type { RoomConfig } from "./phases";

/**
 * Ranh giới giữa BỘ BÀI và LUẬT CHƠI trong `RoomConfig`.
 *
 * `RoomConfig` là một object phẳng chứa hai loại thứ khác hẳn nhau: những lá
 * bài (số Sói, số Dân Làng, mười mấy công tắc vai) và những luật quanh bàn
 * (Ranked/Chaos, voice, Phong thư sau cùng, giây của từng pha). Cân bằng và cỡ
 * bàn chỉ phụ thuộc vào loại thứ nhất; loại thứ hai đổi bao nhiêu cũng không
 * làm một bộ bài lệch thêm hay bớt đi.
 *
 * Hai chỗ cần ranh giới này và cùng từng sai vì thiếu nó:
 *
 *   - `RoomService.updateConfig` chấm cân bằng và kiểm cỡ bàn cho MỌI lượt đổi
 *     cấu hình. Hệ quả: phòng 10 người áp preset 10, người thứ 11 vào, bộ bài
 *     thành lệch - và từ đó host gạt Phong thư, đổi giây thảo luận hay bật
 *     voice đều bị từ chối bằng BALANCE_UNSTABLE, trong khi lỗi đó hiện ở cột
 *     chính chứ không ở lớp phủ thiết lập đang mở. Công tắc "không ăn".
 *   - Nút "Áp dụng đội hình chuẩn" gửi nguyên `PRESET_DECKS[n]` làm cấu hình
 *     mới. Preset mang `mode: "ranked"` và bộ giây gốc, nên bấm nó là phòng
 *     Chaos về Ranked, voice tắt (kèm xoá phòng LiveKit), Phong thư tắt.
 *
 * Danh sách khoá này là NGUỒN DUY NHẤT cho câu hỏi "trường nào thuộc bộ bài":
 * thêm một vai mới thì thêm vào đây, và test `deck.test.ts` giữ cho các trường
 * luật chơi không lọt vào.
 */
export const DECK_KEYS = [
  "werewolves",
  "villagers",
  "seer",
  "guard",
  "witch",
  "hunter",
  "cursed",
  "wolfCub",
  "traitor",
  "apprenticeSeer",
  "detective",
  "tracker",
  "sorcerer",
  "mayor",
  "elder",
  "doppelganger",
  "jester",
  "serialKiller",
  "executioner",
] as const satisfies readonly (keyof RoomConfig)[];

export type DeckKey = (typeof DECK_KEYS)[number];

/**
 * Hai cấu hình có cùng BỘ BÀI không - bỏ qua chế độ, add-on và thời gian.
 *
 * Cờ vắng mặt và cờ `false` là một: mọi công tắc vai thêm sau đều optional để
 * cấu hình ghi trước đó không trượt schema, nên `jester: undefined` của một
 * phòng cũ phải khớp `jester: false` của preset.
 */
export function sameDeck(a: RoomConfig, b: RoomConfig): boolean {
  for (const key of DECK_KEYS) {
    if ((a[key] ?? false) !== (b[key] ?? false)) return false;
  }
  return true;
}

/**
 * Cấu hình `base` với bộ bài thay bằng bộ bài của `deck`; mọi trường luật chơi
 * của `base` giữ nguyên. Không đụng vào hai đầu vào.
 *
 * Khoá mà `deck` không có thì bị GỠ khỏi kết quả chứ không giữ lại từ `base`:
 * một preset không nhắc tới Kẻ Phản Bội nghĩa là bộ bài đó không có Kẻ Phản
 * Bội, không phải "tuỳ phòng".
 */
export function applyDeck(base: RoomConfig, deck: RoomConfig): RoomConfig {
  const next: RoomConfig = { ...base };
  for (const key of DECK_KEYS) {
    if (deck[key] === undefined) {
      delete next[key];
    } else {
      // Cùng khoá hai bên nên kiểu khớp; TS không suy được qua vòng lặp.
      (next as Record<DeckKey, RoomConfig[DeckKey]>)[key] = deck[key];
    }
  }
  return next;
}
