/**
 * Nhắc tên trong chat bằng "@".
 *
 * Bàn 8 đến 20 người, tên có dấu, gõ trên điện thoại: "Hoàng Anh" mất sáu
 * lần chạm và một lần đổi bàn phím. Gõ "@ho" rồi chọn thì còn ba. Và với bot,
 * "@An" đọc ra vẫn là "An" - parser của chúng bỏ mọi ký tự không phải chữ
 * trước khi so tên - nên phía server không cần biết tính năng này tồn tại.
 *
 * Thuần: nhận chuỗi và vị trí con trỏ, trả chuỗi và vị trí con trỏ. Popover
 * và bàn phím là việc của component.
 */

/** Đoạn "@query" đang gõ dở: `start` là chỉ số của "@", `end` là con trỏ. */
export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

/**
 * Có đang gõ một cái tên sau "@" không, tính từ con trỏ ngược về trước.
 *
 * "@" phải đứng đầu chuỗi hoặc sau khoảng trắng - "a@b" là địa chỉ, không
 * phải nhắc tên. Gặp khoảng trắng trước khi gặp "@" nghĩa là đã gõ xong.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(upto[at - 1]!)) return null;
  const query = upto.slice(at + 1);
  if (/\s/.test(query)) return null;
  return { start: at, end: caret, query };
}

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/** Hạ chữ thường, bỏ dấu: cùng phép so tên mà parser của bot dùng. */
export function foldName(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "").replace(/đ/g, "d");
}

/** Tên khớp theo ĐẦU TỪ, không dấu, không phân biệt hoa thường. Giữ thứ tự vào. */
export function mentionCandidates(query: string, names: string[], limit = 5): string[] {
  const q = foldName(query.trim());
  const hits = q
    ? names.filter((name) =>
        foldName(name)
          .split(/\s+/)
          .some((word) => word.startsWith(q)),
      )
    : names;
  return hits.slice(0, limit);
}

/**
 * Thay đoạn "@query" bằng "@Tên " và đặt con trỏ sau dấu cách. null khi vượt
 * trần ký tự - cùng cách `insertEmoji` từ chối, để ô nhập không bao giờ dài
 * hơn thứ server nhận.
 */
export function applyMention(
  text: string,
  q: MentionQuery,
  name: string,
  maxLength = 300,
): { text: string; caret: number } | null {
  const head = `${text.slice(0, q.start)}@${name} `;
  const next = head + text.slice(q.end).replace(/^\s/, "");
  if (next.length > maxLength) return null;
  return { text: next, caret: head.length };
}

/**
 * Tin nhắn này có gọi đúng người tên `name` không.
 *
 * Hai dạng, và chỉ hai: "@Tên" ở bất kỳ đâu, hoặc tên đứng ĐẦU câu. Tên nằm
 * giữa câu không tính - "tôi thấy An hơi im" nói VỀ An chứ không nói VỚI An,
 * và tô sáng cả những câu đó thì tô sáng mất nghĩa. Bot không gõ "@" nhưng
 * hay mở câu bằng tên ("An nghĩ sao?"), nên dạng thứ hai là để nghe được bot.
 */
export function mentionsName(text: string, name: string): boolean {
  const folded = foldName(text);
  const target = foldName(name);
  if (!target) return false;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // \p{L} thay cho \b: \b của JS coi chữ có dấu là ranh giới từ, nên "@Anh"
  // sẽ khớp "an" nếu dùng \b.
  const after = "(?![\\p{L}\\p{N}])";
  return (
    new RegExp(`(^|\\s)@${escaped}${after}`, "u").test(folded) ||
    new RegExp(`^${escaped}${after}`, "u").test(folded)
  );
}
