/**
 * Câu chữ cho khối hành động của phe Sói.
 *
 * Cùng lý do với `discussion-skip-copy`: nhãn nút cắn có sáu trạng thái (chưa
 * chọn / đã chọn một / đã chọn hai / đang gửi / đã chốt phiếu / đã chốt phiếu
 * kép) và viết chúng bằng toán tử ba ngôi lồng nhau trong JSX là cách chắc chắn
 * nhất để một trạng thái nói sai mà không ai biết - web không có test cho
 * component, chỉ có test cho lib.
 *
 * KHÔNG chứa luật: hoà phiếu, bốc ngẫu nhiên, ai được chọn ai không, tất cả vẫn
 * ở engine. Đây thuần là ánh xạ trạng thái -> chữ.
 */

export interface WolfBiteLabelInput {
  /** Tên mục tiêu chính đang trỏ tới; null khi chưa chọn ai. */
  targetName: string | null;
  /** Tên mục tiêu phụ (Phẫn nộ Sói Con / Cuộc Săn Đẫm Máu); null khi không có. */
  secondaryName?: string | null;
  /** Phiếu vừa gửi, đang chờ snapshot xác nhận. */
  sending?: boolean;
  /** Phiếu ĐÃ nằm trên bàn và đang trỏ đúng vào mục tiêu hiện tại. */
  alreadyCast?: boolean;
}

/** Nhãn nút cắn chính. */
export function wolfBiteLabel({
  targetName,
  secondaryName = null,
  sending = false,
  alreadyCast = false,
}: WolfBiteLabelInput): string {
  if (sending) return "Đang gửi phiếu…";
  // Chưa có mục tiêu thì nút phải nói VIỆC CẦN LÀM, không phải tên một hành
  // động chưa bấm được. "Bầu cắn mục tiêu" trên một nút xám đọc ra như một nút
  // hỏng; "Chọn một người để cắn" chỉ thẳng xuống lưới ngay bên trên.
  if (!targetName) return "Chọn một người để cắn";
  const both = secondaryName ? `${targetName} và ${secondaryName}` : targetName;
  return alreadyCast ? `Đã bầu chọn ${both}` : `Bầu chọn ${both}`;
}

/** Nhãn nút "không cắn". */
export function wolfSkipLabel({
  sending = false,
  alreadyCast = false,
}: { sending?: boolean; alreadyCast?: boolean } = {}): string {
  if (sending) return "Đang gửi phiếu…";
  return alreadyCast ? "Đã bầu không cắn đêm nay" : "Không cắn đêm nay";
}

/**
 * Dòng tiến độ trên bảng phiếu: "2/3 Sói đã bỏ phiếu".
 *
 * Viết hoa "Sói" vì đây là tên phe, không phải con vật - cùng quy ước với
 * "Ma Sói" và "phe Sói" ở mọi chỗ khác trong trận.
 */
export function wolfTallyProgress(cast: number, required: number): string {
  return `${cast}/${required} Sói đã bỏ phiếu`;
}

/** Câu thay cho bảng phiếu khi chưa ai bầu. */
export const WOLF_TALLY_EMPTY = "Chưa có Sói nào bỏ phiếu";
