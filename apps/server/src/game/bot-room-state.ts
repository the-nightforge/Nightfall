import { resetBotBudget } from "../bots";

/** Phiếu bot đã định trong pha thảo luận, dùng lại ở pha bỏ phiếu. */
export const pendingVote = new Map<string, Map<string, string>>();

/** Cờ đang chờ mốc kết thúc bỏ phiếu sớm (mọi người còn sống đã bỏ phiếu). */
export const pendingEndVote = new Map<string, boolean>();

/**
 * Dọn toàn bộ state bot của một phòng: phiếu đã định, cờ chờ kết thúc bỏ phiếu
 * sớm, và ngân sách governor. Gọi khi phòng bị xoá hẳn khỏi bộ nhớ (removeRoom)
 * để tránh rò rỉ - không dọn thì các Map này tích luỹ một entry cho mỗi phòng
 * bị bỏ hoang trong suốt vòng đời process.
 *
 * Tách riêng khỏi machine.ts (thay vì để store.ts import thẳng machine.ts) vì
 * machine.ts đã import store.ts để dùng clearRoomTimers/persistRoom/setRoomTimer;
 * import ngược lại sẽ tạo vòng. File này không import store.ts nên store.ts và
 * machine.ts cùng import được nó mà không có cạnh nào quay lại nhau.
 */
export function cleanupRoomBotState(code: string): void {
  pendingVote.delete(code);
  pendingEndVote.delete(code);
  resetBotBudget(code);
}
