import type { BotRng } from "./types";

/**
 * Bước cộng dồn của bộ đếm. Tách thành hằng số vì việc TUA NHANH ở dưới phải
 * dùng đúng con số này - hai bản chép tay lệch nhau nghĩa là dòng số khôi phục
 * không còn là dòng số gốc, và không có test nào ngoài đây bắt được.
 */
const STEP = 0x6d2b79f5;

function fnv1a32(seed: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

/**
 * Dòng số đã gieo hạt, có kèm vị trí hiện tại.
 *
 * `cursor` là số lần đã gọi. Nó tồn tại để một ván sống sót qua việc server
 * khởi động lại: lưu một số nguyên là đủ để mở lại đúng dòng số cũ, nên BOT
 * không đổi quyết định chỉ vì process vừa chết.
 */
export interface SeededRng extends BotRng {
  readonly cursor: number;
}

/**
 * PRNG dựa trên bộ đếm cộng dồn: nội trạng sau `n` lần gọi luôn bằng
 * `hạt + n * STEP`, nên tua tới `cursor` là một phép nhân chứ không phải một
 * vòng lặp `cursor` bước. Đó cũng là lý do chọn kiểu PRNG này ngay từ đầu.
 */
export function createSeededRng(seed: string, cursor = 0): SeededRng {
  let calls = cursor;
  // `cursor * STEP` lớn nhất trong thực tế vẫn dưới 2^53 (cursor cỡ nghìn),
  // nên `| 0` cho ra đúng kết quả của `cursor` lần cộng dồn 32-bit.
  let state = (fnv1a32(seed) + cursor * STEP) | 0;

  const rng = (): number => {
    calls += 1;
    state = (state + STEP) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  Object.defineProperty(rng, "cursor", { get: () => calls, enumerable: true });

  return rng as SeededRng;
}
