import { persistRoom, setRoomTimer, type Room } from "../rooms/store";
import type { PendingStep, PendingStepName } from "./pending-step";

export type StepHandler = (room: Room, step: PendingStep) => void;

/**
 * Bảng xử lý được ĐĂNG KÝ chứ không import thẳng.
 *
 * `machine.ts` đã import file này để hẹn bước; import ngược lại sẽ tạo vòng.
 * Cùng cách gỡ vòng mà `bot-room-state.ts` đang dùng, chỉ khác chiều: ở đây
 * chiều phụ thuộc bị đảo bằng một lần đăng ký lúc nạp module.
 */
let handlers: Record<PendingStepName, StepHandler> | null = null;

export function registerStepHandlers(next: Record<PendingStepName, StepHandler>): void {
  handlers = next;
}

/**
 * Danh tính của tình thế hiện tại.
 *
 * `phaseSeq` là thành phần bắt buộc chứ không phải phần thêm: một pha `NIGHT`
 * có hai chặng (`lockWolves` rồi `endNight`) dùng chung vòng, pha và cả
 * `phaseStartedAt`, nên nếu thiếu số thứ tự thì một `lockWolves` về muộn vẫn
 * mang token hợp lệ và được chạy lần thứ hai.
 */
export function phaseToken(room: Room): string {
  const state = room.engine?.state;
  if (!state) return `lobby:${room.phaseSeq}`;
  return `${state.round}:${state.phase}:${room.phaseSeq}`;
}

/**
 * Hẹn bước chuyển pha kế tiếp.
 *
 * Ghi `pendingStep` vào phòng TRƯỚC khi hẹn giờ: `pendingStep` mới là thứ sống
 * sót qua restart, còn `setTimeout` chỉ là cách chạy nó trong process này.
 * Mỗi lần hẹn đều tăng `phaseSeq`, nên mọi bước đã hẹn trước đó lập tức hết
 * hiệu lực - kể cả khi nó vẫn nằm trong hàng đợi của Node.
 *
 * Tự lưu snapshot NGAY tại đây, không nhờ `sync()` của chỗ gọi: vài handler
 * (`endNight`, `endVoting`, `endFinalVote`, `submitHunterShot`) gọi `sync()`
 * rồi mới hẹn bước, nên bản lưu cuối cùng của chúng mang `pendingStep: null` -
 * và một process mới sẽ không biết ván đang chờ điều gì. Đặt lời lưu ở đây
 * biến "bước chờ luôn nằm trong snapshot" thành một tính chất của chính hàm
 * hẹn, thay vì một quy ước mà mọi chỗ gọi phải nhớ.
 */
export function armStep(
  room: Room,
  step: { name: PendingStepName; source?: "night" | "vote" },
  delayMs: number,
): void {
  room.phaseSeq += 1;
  const pending: PendingStep = {
    name: step.name,
    source: step.source,
    token: phaseToken(room),
    runAt: Date.now() + delayMs,
  };
  room.pendingStep = pending;

  setRoomTimer(room.code, () => runPendingStep(room, pending), delayMs);
  void persistRoom(room);
}

/**
 * Bỏ bước đang chờ. Dùng khi ván kết thúc hoặc phòng về sảnh chờ: `phaseSeq`
 * vẫn tăng, nên một bước cũ còn nằm trong hàng đợi không thể hồi sinh ván.
 */
export function clearPendingStep(room: Room): void {
  room.phaseSeq += 1;
  room.pendingStep = null;
}

/**
 * Cửa DUY NHẤT để một bước chuyển pha thật sự chạy.
 *
 * Ba nguồn có thể cùng gọi tới đây cho một bước: hẹn giờ bình thường, hẹn giờ
 * vừa được dựng lại sau restart, và lượt catch-up khi hạn chót đã trôi qua.
 * Phép so token là compare-and-set chốt lại cả ba: chỉ bước mang token của
 * tình thế HIỆN TẠI được chạy, và chạy xong là token đổi ngay.
 */
export function runPendingStep(room: Room, step: PendingStep): void {
  if (!room.engine) return;
  if (step.token !== phaseToken(room)) return;

  // Tiêu thụ token TRƯỚC khi gọi handler: handler sẽ hẹn bước kế tiếp, và nếu
  // nó ném giữa chừng thì bước vừa chạy cũng không được phép chạy lại.
  room.phaseSeq += 1;
  room.pendingStep = null;

  if (!handlers) {
    throw new Error("Chưa đăng ký bảng xử lý bước chuyển pha");
  }
  handlers[step.name](room, step);
}
