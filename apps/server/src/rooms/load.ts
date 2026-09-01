import { resumeRoom } from "../game/resume";
import { loadRoomSnapshot, type RoomLoadOutcome } from "./store";

/**
 * Nạp phòng rồi đưa nó trở lại trạng thái đang chạy.
 *
 * Tách khỏi `store.ts` để `store.ts` không phải import `machine.ts`: chiều phụ
 * thuộc đó sẽ khép một vòng giữa hai module lớn nhất của server. Ở đây chỉ có
 * ba dòng, và đây là chốt DUY NHẤT mà một phòng ngủ trong Redis được đánh thức.
 *
 * Đánh thức theo kiểu LAZY - lúc có người truy cập - chứ không quét toàn bộ
 * lúc khởi động: ngay sau restart chưa có ai kết nối, nên đánh thức sớm chỉ
 * làm bot đánh nhau trong một căn phòng không người xem và tiêu ngân sách AI
 * cho một ván có thể không ai quay lại.
 */
export async function loadAndResumeRoom(code: string): Promise<RoomLoadOutcome> {
  const result = await loadRoomSnapshot(code);
  if (result.status === "ok") resumeRoom(result.room);
  return result;
}
