import { resetBotBudget } from "../bots";
import { clearBotSession } from "../bots/session-registry";

/**
 * Cờ chặn hẹn giờ kết thúc sớm cho vòng bỏ phiếu xác nhận. Không có cờ này thì
 * mỗi lá phiếu về muộn lại hẹn thêm một mốc kết thúc 800ms nữa.
 */
export const pendingEndFinalVote = new Map<string, boolean>();

/**
 * Dọn toàn bộ state bot của một phòng: cờ final-vote, session nhận thức và ngân
 * sách governor. Gọi khi phòng bị xoá hẳn khỏi bộ nhớ (removeRoom) để tránh rò
 * rỉ - không dọn thì các Map này tích luỹ một entry cho mỗi phòng bị bỏ hoang
 * trong suốt vòng đời process.
 *
 * Tách riêng khỏi machine.ts (thay vì để store.ts import thẳng machine.ts) vì
 * machine.ts đã import store.ts để dùng clearRoomTimers/persistRoom/setRoomTimer;
 * import ngược lại sẽ tạo vòng. File này không import store.ts nên store.ts và
 * machine.ts cùng import được nó mà không có cạnh nào quay lại nhau.
 */
export function cleanupRoomBotState(code: string): void {
  pendingEndFinalVote.delete(code);
  clearBotSession(code);
  resetBotBudget(code);
}
