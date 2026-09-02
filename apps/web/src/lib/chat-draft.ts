/**
 * Một dòng chat có gửi được không.
 *
 * Luật này trước đây nằm hai chỗ trong `ChatBox`: `disabled={!text.trim()}` ở
 * cái nút, và `const t = text.trim(); if (!t) return;` trong `submit`. Hai bản
 * chép tay của cùng một luật, mà `submit` còn chạy được bằng phím Enter - tức
 * là đường không đi qua cái nút. Sửa một bên mà quên bên kia thì hoặc nút sáng
 * cho một câu không gửi được, hoặc Enter gửi đi một câu mà nút đang từ chối.
 *
 * Tách ra đây để cả hai đường dùng chung đúng một câu trả lời, và để bộ test
 * `tsx --test src/lib/*.test.ts` phủ được - `ChatBox` là .tsx nên không có test
 * hồi quy nào chạm tới.
 */

/**
 * `String.prototype.trim` cắt theo WhiteSpace của spec, nên nó dọn cả khoảng
 * trắng không ngắt (U+00A0) mà bàn phím điện thoại hay chèn, lẫn xuống dòng
 * dán từ nơi khác. Đúng thứ ta cần: một tin nhắn toàn khoảng trắng là một tin
 * nhắn rỗng.
 */
export function canSendMessage(draft: string): boolean {
  return draft.trim().length > 0;
}
