import {
  momentLabel,
  outcomeHeadline,
  outcomeName,
  roundsLabel,
  type CaseFile,
  type MatchOutcome,
} from "@masoi/shared";

/** Trần độ dài mô tả trên thẻ. Dài hơn thì thẻ 9:16 hết chỗ cho điểm ngoặt sau. */
export const CARD_TEXT_MAX = 110;
/** Trần độ dài mỗi dòng điểm ngoặt trong text chia sẻ. */
export const SHARE_TEXT_MAX = 90;

export interface CaseCardLine {
  moment: string;
  title: string;
  text: string;
}

export interface CaseCardModel {
  caseId: string;
  winner: MatchOutcome;
  headline: string;
  subline: string;
  lines: CaseCardLine[];
  cta: string;
  url: string;
  shareTitle: string;
  shareText: string;
}

export interface CaseCardOptions {
  /** Địa chỉ trang chủ để đính vào lời mời. Truyền vào chứ không hardcode. */
  shareOrigin: string;
}

/**
 * Cắt chuỗi theo KÝ TỰ NGƯỜI ĐỌC THẤY, không theo đơn vị UTF-16.
 *
 * `slice` trên chuỗi có emoji hoặc ký tự ngoài BMP sẽ cắt đôi một cặp thay thế
 * và sinh ra ký tự hỏng. Biệt danh trong game này có cả emoji lẫn tiếng Việt có
 * dấu, nên đây không phải trường hợp hiếm.
 */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…`;
}

const CTA = "Chơi Ma Sói online";

/**
 * Model chung cho CẢ bản xem trước lẫn ảnh PNG.
 *
 * Đây là lý do tồn tại của hàm này: hai bộ render đọc cùng một model thì
 * "ảnh khác bản xem trước" trở thành một lỗi không thể xảy ra, thay vì một lỗi
 * phải nhớ đi kiểm mỗi lần sửa câu chữ.
 */
export function buildCaseCardModel(file: CaseFile, options: CaseCardOptions): CaseCardModel {
  /*
   * Nhãn kết cục lấy từ `@masoi/shared`, không dựng lại ở đây.
   *
   * Bản cũ viết `file.winner === "wolves" ? "Ma Sói" : "Dân Làng"` - đúng
   * chừng nào chỉ có hai kết cục, và biến MỌI ván Sát Nhân thắng hay ván hoà
   * thành "Phe Dân Làng thắng" trên đúng tấm ảnh người chơi đem đi khoe.
   */
  const headline = outcomeHeadline(file.winner);
  // `null` chỉ ở ván hoà; câu chia sẻ bên dưới có nhánh riêng cho nó.
  const winnerName = outcomeName(file.winner);
  const subline = `${roundsLabel(file.rounds)} · ${file.cast.length} người chơi`;

  const lines: CaseCardLine[] = file.highlights.map((highlight) => ({
    moment: momentLabel(highlight.round, highlight.phase),
    title: highlight.title,
    text: truncate(highlight.description, CARD_TEXT_MAX),
  }));

  // Ở trạng thái fallback, mô tả mở đầu bằng đúng câu "Phe X thắng sau N ngày"
  // đã nằm ngay dòng trên. Dùng tiêu đề để khỏi nói hai lần cùng một điều.
  const shareLines = file.fallback
    ? file.highlights.map((highlight) => `• ${highlight.title}`)
    : file.highlights.map(
        (highlight) =>
          `• ${momentLabel(highlight.round, highlight.phase)} · ${truncate(highlight.description, SHARE_TEXT_MAX)}`,
      );

  const shareText = [
    `🕯️ Hồ sơ vụ án ${file.caseId}`,
    winnerName === null
      ? `Không ai sống sót sau ${roundsLabel(file.rounds)}.`
      : `${winnerName} thắng sau ${roundsLabel(file.rounds)}.`,
    "",
    ...shareLines,
    "",
    `${CTA}: ${options.shareOrigin}`,
  ].join("\n");

  return {
    caseId: file.caseId,
    winner: file.winner,
    headline,
    subline,
    lines,
    cta: CTA,
    url: options.shareOrigin,
    shareTitle: `Hồ sơ vụ án ${file.caseId}`,
    shareText,
  };
}
