/**
 * Nhịp cho danh sách hiện ra theo thứ tự.
 *
 * Có trần chứ không phải trễ cố định nhân chỉ số: bàn 15 người với 60ms mỗi ô
 * là 900ms, tức ô cuối cùng hiện ra sau khi mắt đã quét xong cả bàn. Chuyển
 * động lúc đó không còn dẫn dắt nữa mà là bắt chờ.
 */
export const STAGGER_TOTAL_MS = 260;

/** Trễ tối đa giữa hai phần tử liền nhau, cho danh sách ngắn. */
const MAX_GAP_MS = 60;

/**
 * Tính trễ (ms) cho phần tử thứ `index` trong danh sách `count` phần tử.
 *
 * Trần 260ms là tải trọng: không thể chứa 262 giá trị mili-giây khác nhau.
 * Với count >= 262, làm tròn về mili-giây khiến hai phần tử liền nhau có thể
 * vào cùng một khung hình. Trần được giữ luôn; thứ tự tăng nghiêm ngặt chỉ
 * giữ được ở kích cỡ thực tế (count <= 15).
 */
export function staggerDelay(index: number, count: number): number {
  if (index <= 0 || count <= 1) return 0;
  const position = Math.min(index, count - 1);
  // Danh sách ngắn dùng khoảng cố định cho rõ nhịp; danh sách dài bị ép vào
  // trần nên càng đông càng khít, chứ không càng đông càng lâu.
  const gap = Math.min(MAX_GAP_MS, STAGGER_TOTAL_MS / (count - 1));
  return Math.round(position * gap);
}

/**
 * Props cắm thẳng vào `<m.li>`. Trả cả ba mảnh cùng nhau để mọi danh sách
 * trong app dùng chung một nhịp thay vì mỗi chỗ tự chọn số.
 */
export function listItemMotion(index: number, count: number) {
  return {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.24,
      ease: [0.22, 1, 0.36, 1] as const,
      delay: staggerDelay(index, count) / 1000,
    },
  };
}
