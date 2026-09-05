import type { RoomSnapshot } from "@masoi/shared";
import type { ChatChannelId } from "./chat-channels";

/**
 * Câu nhanh: một hàng chip trên ô nhập, bấm là chèn vào bản nháp.
 *
 * CHÈN, không gửi. Một chip gửi thẳng thì rẻ hơn một lần chạm, nhưng nó biến
 * chat thành một bàn phím sáu phím và bot sẽ đọc được cùng một câu từ ba
 * người trong một vòng. Chèn rồi để người ta sửa vài chữ là đúng mức: đỡ gõ
 * phần mở đầu trên điện thoại, mà câu vẫn là của họ.
 *
 * Tối đa 5 chip mỗi lúc: hàng chip cuộn ngang được, nhưng quá năm thì người
 * ta đọc chip thay vì đọc chat.
 */
export interface QuickPhrase {
  label: string;
  text: string;
  /** Kết thúc bằng "@" để popover nhắc tên mở ngay sau khi chèn. */
  wantsMention?: boolean;
}

const SUSPECT: QuickPhrase = { label: "Nghi @", text: "Nghi @", wantsMention: true };

const DAY: QuickPhrase[] = [
  { label: "Tôi là dân", text: "Tôi là dân" },
  SUSPECT,
  { label: "Ai có thông tin?", text: "Ai có thông tin không?" },
  { label: "Bỏ qua, chưa rõ", text: "Vòng này tôi bỏ qua, chưa rõ ai" },
];

const DEFENSE_ACCUSED: QuickPhrase[] = [
  { label: "Tôi không phải Sói", text: "Tôi không phải Sói" },
  { label: "Đêm qua tôi…", text: "Đêm qua tôi " },
  { label: "Treo tôi là mất dân", text: "Treo tôi là làng mất một dân" },
];

const DEFENSE_OTHERS: QuickPhrase[] = [
  { label: "Khai vai đi", text: "Khai vai đi" },
  SUSPECT,
  { label: "Nghe hợp lý", text: "Nghe hợp lý, tôi tha" },
];

const WOLVES: QuickPhrase[] = [
  { label: "Cắn @", text: "Cắn @", wantsMention: true },
  { label: "Theo mọi người", text: "Theo ý mọi người" },
  { label: "Cẩn thận Bảo Vệ", text: "Cẩn thận Bảo Vệ, đổi mục tiêu" },
];

const DEAD: QuickPhrase[] = [
  { label: "Ai giết tôi?", text: "Ai giết tôi vậy?" },
  SUSPECT,
  { label: "Tiếc quá", text: "Tiếc quá" },
];

export function quickPhrasesFor(
  snapshot: RoomSnapshot | null,
  channel: ChatChannelId | null,
): QuickPhrase[] {
  if (!snapshot || !channel) return [];
  switch (channel) {
    case "lobby":
      return [];
    case "wolves":
      return WOLVES;
    case "dead":
      return DEAD;
    case "day":
      if (snapshot.phase === "DEFENSE") {
        return snapshot.trial?.accusedId === snapshot.you?.id ? DEFENSE_ACCUSED : DEFENSE_OTHERS;
      }
      return DAY;
  }
}

/** Chèn câu vào bản nháp: ô trống thì thay, có chữ thì nối sau một dấu cách. */
export function applyQuickPhrase(
  draft: string,
  text: string,
  maxLength = 300,
): { text: string; caret: number } | null {
  const trimmed = draft.replace(/\s+$/, "");
  const next = trimmed ? `${trimmed} ${text}` : text;
  if (next.length > maxLength) return null;
  return { text: next, caret: next.length };
}

/** Tên để gợi ý sau "@": mọi người trừ mình, người sống trước. */
export function mentionNamesFor(snapshot: RoomSnapshot | null): string[] {
  if (!snapshot) return [];
  const others = snapshot.players.filter((p) => p.id !== snapshot.you?.id);
  return [...others.filter((p) => p.alive), ...others.filter((p) => !p.alive)].map((p) => p.name);
}
