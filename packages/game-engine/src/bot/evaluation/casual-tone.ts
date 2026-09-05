/**
 * Một câu đọc lên có giống người Việt gõ trong phòng game, hay giống văn viết?
 *
 * Tồn tại vì giọng của BOT đã trôi mà không ai thấy. Ván thật với người chơi
 * cho ra những câu như "Mình đang nghi X nhất, ông nói rõ căn cứ đi, đừng né."
 * - đúng ngữ pháp, đúng nội dung, và sai hẳn không khí. Không chỉ số nào trong
 * báo cáo self-play nhìn thấy điều đó: `fromTemplateRate` chỉ nói câu đến từ
 * bảng mẫu hay từ nhà cung cấp, còn các chỉ số lặp thì chỉ đếm trùng nhau.
 *
 * Đây là một cái THƯỚC, không phải một cái cổng. Nó không chặn câu nào cả -
 * một câu trang trọng vẫn phát ra bình thường. Việc của nó là biến "bot nói
 * nghe như máy" từ một cảm giác thành một con số có thể so giữa hai lần chạy.
 *
 * Dùng chung cho cả hai đầu: `metrics.ts` đo câu ĐÃ PHÁT, còn test của
 * `prompt.ts` đo câu gợi ý ta ĐƯA VÀO cho mô hình. Một cái thước duy nhất cho
 * cả đầu vào lẫn đầu ra là điều kiện để hai bên không trôi khỏi nhau.
 */

/**
 * Dấu hiệu teencode. Cố tình NGẮN và chỉ gồm những token mà sự có mặt của
 * chúng gần như luôn nghĩa là người ta đang gõ nhanh, không phải đang viết.
 *
 * KHÔNG có từ lóng của game ("vote", "soi", "treo"): chúng nói về nội dung chứ
 * không nói về giọng, và một câu trang trọng vẫn dùng đủ cả.
 */
export const CASUAL_TOKENS: ReadonlySet<string> = new Set([
  "t", "tui", "tớ", "mn", "ko", "k", "kg", "hok", "hem", "r", "rùi", "j", "z",
  "đc", "dc", "vs", "kk", "kkk", "haha", "hehe", "hihi", "hmm", "hm", "ừ", "ừa",
  "ờ", "ê", "ơ", "à", "ủa", "nè", "vl", "vcl", "ik", "bt", "ms",
]);

/** Mặt cười gõ bằng dấu câu; `plainForm` sẽ xoá sạch nên phải soi trên chuỗi gốc. */
const CASUAL_FACES = ["=))", "=)", ":v", ":))", "^^", "-_-"];

/** Bao nhiêu tiếng thì một câu chat bắt đầu đọc như một đoạn văn. */
export const CASUAL_WORD_LIMIT = 12;

/** Cần bấy nhiêu dấu hiệu trong bốn dấu hiệu thì tính là giọng chat. */
export const CASUAL_SIGNAL_THRESHOLD = 2;

export interface CasualToneSignals {
  /** Không mở đầu bằng chữ hoa. */
  startsLower: boolean;
  /** Không kết thúc bằng dấu chấm. Dấu hỏi và chấm than vẫn là giọng nói. */
  noFinalPeriod: boolean;
  short: boolean;
  hasCasualToken: boolean;
}

export function casualToneSignals(text: string): CasualToneSignals {
  const trimmed = text.trim();
  const first = trimmed[0] ?? "";
  const words = trimmed.split(/\s+/).filter(Boolean);
  const lower = trimmed.toLowerCase();
  const tokens = lower.split(/[^\p{Letter}\p{Number}]+/u).filter(Boolean);

  return {
    // So với chính nó ở dạng thường: chữ cái tiếng Việt có dấu vẫn đúng, còn
    // chữ số và dấu câu thì bằng nhau nên không bị tính là "hoa".
    startsLower: first === first.toLowerCase(),
    noFinalPeriod: !trimmed.endsWith("."),
    short: words.length <= CASUAL_WORD_LIMIT,
    hasCasualToken:
      tokens.some((token) => CASUAL_TOKENS.has(token)) ||
      CASUAL_FACES.some((face) => trimmed.includes(face)),
  };
}

/**
 * Câu này có đọc như chat không.
 *
 * Ngưỡng là HAI trên bốn chứ không phải cả bốn: một câu hoàn toàn hợp lệ vẫn
 * có thể mở đầu bằng tên riêng viết hoa, hoặc dài hơn mười hai tiếng khi nó
 * đang kể lại một chuỗi phiếu. Đòi đủ bốn dấu hiệu sẽ biến cái thước thành một
 * cái khuôn, và mọi BOT sẽ bị chấm điểm theo một giọng duy nhất - đúng cái
 * bệnh mà nó sinh ra để đo.
 */
export function looksCasual(text: string): boolean {
  const signals = casualToneSignals(text);
  const score = Number(signals.startsLower) + Number(signals.noFinalPeriod) +
    Number(signals.short) + Number(signals.hasCasualToken);
  return score >= CASUAL_SIGNAL_THRESHOLD;
}
