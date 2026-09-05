import type { RoomSnapshot } from "@masoi/shared";

/**
 * Hành động CHÍNH mà người xem đang có ở pha này, nếu có.
 *
 * Tồn tại cho tấm trượt chat trên điện thoại: khi nó mở, cả khu chơi bị che
 * và bị `inert`, nên người đang gõ không thấy nút "Bỏ phiếu" vừa hiện ra. Dải
 * pha trong tấm trượt đọc hàm này để biết có gì đang chờ họ và dẫn thẳng tới
 * đó. Chỉ trả về khi CHÍNH người xem còn thao tác được - người chết, người đã
 * bỏ phiếu phán quyết, hay bị cáo trong pha phán quyết thì không có nút nào
 * để mà dẫn tới.
 *
 * THUẦN: chỉ đọc snapshot, không đoán luật. Mọi điều kiện đều là cờ do server
 * tính sẵn (`canVote`, `canAct`, `alive`), cùng những cờ mà panel tương ứng
 * dùng để hiện nút, nên hai bên không lệch nhau.
 */
export interface PhaseAction {
  kind: "VOTE" | "TRIAL" | "HUNTER" | "NIGHT";
  /** Nhãn nút, đã ở dạng mệnh lệnh ngắn. */
  label: string;
  /**
   * Chưa làm gì thì `true`; đã bỏ phiếu và chỉ còn quyền đổi thì `false`. Dùng
   * để nút đổi màu, không đổi hành vi.
   */
  urgent: boolean;
}

export function phaseActionFor(snapshot: RoomSnapshot | null): PhaseAction | null {
  if (!snapshot || !snapshot.you) return null;
  switch (snapshot.phase) {
    case "VOTING":
      if (!snapshot.you.alive) return null;
      return snapshot.hasVoted
        ? { kind: "VOTE", label: "Xem hoặc đổi phiếu", urgent: false }
        : { kind: "VOTE", label: "Bỏ phiếu ngay", urgent: true };
    case "FINAL_VOTE":
      // `canVote` đã gói "còn sống, không phải bị cáo, chưa bỏ phiếu".
      return snapshot.trial?.canVote
        ? { kind: "TRIAL", label: "Treo hay Tha", urgent: true }
        : null;
    case "HUNTER_SHOT":
      return snapshot.hunterShot?.canAct && !snapshot.hunterShot.resolved
        ? { kind: "HUNTER", label: "Chọn mục tiêu bắn", urgent: true }
        : null;
    case "NIGHT":
      return snapshot.night?.canAct && !snapshot.night.acted
        ? { kind: "NIGHT", label: "Hành động đêm", urgent: true }
        : null;
    default:
      return null;
  }
}

/**
 * Thuộc tính đánh dấu KHU thao tác chính của pha, để tấm trượt cuộn tới và
 * đặt focus. Một tên duy nhất cho mọi pha: tấm trượt không cần biết pha nào
 * dùng panel nào, và panel không cần biết tấm trượt tồn tại.
 */
export const PHASE_ACTION_ATTR = "data-phase-action";

/** Cuộn tới và đặt focus vào khu thao tác chính. `false` khi trang không có. */
export function jumpToPhaseAction(doc: Document = document): boolean {
  const target = doc.querySelector<HTMLElement>(`[${PHASE_ACTION_ATTR}]`);
  if (!target) return false;
  target.scrollIntoView({ block: "start", behavior: "smooth" });
  // preventScroll: scrollIntoView ở trên đã đặt khung nhìn; focus() không được
  // kéo nó đi chỗ khác.
  target.focus({ preventScroll: true });
  return true;
}
