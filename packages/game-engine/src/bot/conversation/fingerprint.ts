import type { BotSpeechIntention } from "../types";

/**
 * Vân tay của lời nói: hai câu "khác nhau" ở đâu, và có thật sự khác không.
 *
 * Phase 3 đo lặp bằng cặp `(kind, targetId)`. Với ba mẫu câu cố định, hai BOT
 * cùng chọn `ACCUSE` cho hai người khác nhau sẽ đọc ra hai câu *y hệt nhau về
 * cấu trúc* mà chỉ số báo là "không lặp". Module này đo cái thật sự lặp: văn
 * bản sau chuẩn hoá, và Ý ĐỊNH đứng sau văn bản đó.
 *
 * THUẦN. Không RNG, không thời gian, không weights.
 */

/**
 * Từ đệm chỉ bị bỏ Ở ĐẦU câu.
 *
 * Bỏ ở giữa là một cái bẫy: "tôi không tin thì thôi" và "tôi không tin" sẽ rút
 * về cùng một chuỗi, mà chúng là hai ý khác nhau. Cơ chế chống lặp khi đó sẽ
 * bịt miệng BOT vì một câu nó chưa từng nói.
 */
const LEADING_FILLERS = [
  "ừ",
  "ờ",
  "à",
  "ê",
  "ok",
  "oke",
  "okie",
  "hmm",
  "hm",
  "ừm",
  "khoan",
  "này",
  "thôi",
  "kiểu",
  "thì",
];

/**
 * Chuẩn hoá một câu chat về dạng so sánh được.
 *
 * Bốn bước, theo đúng thứ tự: hạ chữ thường → bỏ ký tự không phải chữ/số → bỏ
 * từ đệm đầu câu → gộp khoảng trắng. GIỮ NGUYÊN dấu tiếng Việt: "sói" và "soi"
 * là hai từ, và gộp chúng lại sẽ làm mọi phép đo lặp nói dối.
 */
export function normalizeSpeechText(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (base.length === 0) return "";

  const tokens = base.split(" ");
  let start = 0;
  // Chỉ bỏ khi CÒN LẠI thứ gì đó. Một câu chỉ gồm "ừ" phải giữ nguyên là "ừ",
  // nếu không thì mọi câu phản ứng ngắn đều rút về rỗng và trùng nhau hết.
  while (start < tokens.length - 1 && LEADING_FILLERS.includes(tokens[start]!)) {
    start += 1;
  }

  return tokens.slice(start).join(" ");
}

/** FNV-1a 32-bit, in ra hex 8 ký tự. Không phải RNG - cùng vào, cùng ra, mãi mãi. */
function fnv1a32Hex(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Vân tay của VĂN BẢN đã phát. Bắt câu giống nhau sau chuẩn hoá. */
export function speechTextFingerprint(text: string): string {
  return fnv1a32Hex(normalizeSpeechText(text));
}

/**
 * Vân tay của Ý ĐỊNH.
 *
 * Phân biệt đúng năm trục: loại ý định, mục tiêu, message được phản hồi, topic,
 * tập bằng chứng. Tập bằng chứng được SẮP XẾP trước khi nối - cùng luận điểm
 * liệt kê theo thứ tự khác vẫn là cùng luận điểm.
 *
 * `tone` cố tình KHÔNG tham gia: nếu nó tham gia thì một BOT lặp mãi một ý chỉ
 * cần đổi giọng là lách được cơ chế chống lặp, và cơ chế đó thành trang trí.
 */
export function speechSemanticFingerprint(intention: BotSpeechIntention): string {
  const sources = intention.evidence.map((item) => item.sourceId).sort();
  return fnv1a32Hex(
    [
      intention.kind,
      intention.targetId ?? "-",
      intention.replyToMessageId ?? "-",
      intention.topic ?? "-",
      sources.join("+"),
    ].join("|"),
  );
}

/**
 * Ba token đầu sau chuẩn hoá; `null` khi câu không còn gì.
 *
 * Đây là thứ phát hiện "mọi câu đều bắt đầu bằng *tôi nghi*" - triệu chứng dễ
 * nhận ra nhất của một bảng mẫu nghèo, mà vân tay toàn câu không bắt được.
 */
export function openingOf(text: string): string | null {
  const normalized = normalizeSpeechText(text);
  if (normalized.length === 0) return null;
  return normalized.split(" ").slice(0, 3).join(" ");
}
