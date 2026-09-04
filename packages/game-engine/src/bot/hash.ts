/**
 * FNV-1a 32-bit. KHÔNG phải RNG: cùng đầu vào, cùng đầu ra, mãi mãi.
 *
 * Một định nghĩa dùng chung cho cả bốn chỗ cần băm tất định - hạt của
 * `createSeededRng`, chỉ số mẫu câu, vân tay ngữ nghĩa, và ghế bluff của bầy
 * Sói. Trước đây mỗi chỗ chép một bản; bốn bản chép tay của cùng một hàm là
 * bốn cơ hội để chúng lệch nhau, và một hàm băm lệch đi thì mọi thứ dựng trên
 * nó - dòng số của cả ván - không còn tái lập được.
 *
 * Dùng nó ở đâu cũng KHÔNG tiêu một giá trị nào của chuỗi RNG, nên nó an toàn
 * cho cả khôi phục theo con trỏ lẫn chạy lại theo seed.
 */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}
