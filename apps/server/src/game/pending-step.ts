/**
 * Bước chuyển pha đang chờ, ở dạng DỮ LIỆU chứ không phải closure.
 *
 * Tồn tại vì một `setTimeout` không sống sót qua việc process chết: sau khi
 * khởi động lại, thứ duy nhất còn nói được "ván này đang chờ điều gì" là một
 * bản ghi tuần tự hoá được. Nhờ nó, `resumeRoom` đọc thẳng bước kế tiếp thay
 * vì phải suy diễn từ pha - suy diễn sẽ sai ngay ở đêm, nơi một pha `NIGHT` có
 * hai chặng (`lockWolves` rồi `endNight`) không phân biệt được từ bên ngoài.
 *
 * File riêng, không import gì, cùng lý do với `bot-room-state.ts`: `store.ts`
 * và `steps.ts` đều cần kiểu này mà `steps.ts` lại import `store.ts`.
 */
export type PendingStepName =
  | "beginNight"
  | "lockWolves"
  | "endNight"
  | "beginVoting"
  | "endVoting"
  | "beginFinalVote"
  | "endFinalVote"
  | "afterDeathResult"
  | "timeoutHunterShot"
  | "finishHunterShot";

export interface PendingStep {
  name: PendingStepName;
  /**
   * `round:phase:phaseSeq` tại lúc bước được hẹn. Một bước mang token đã cũ là
   * một bước của tình thế không còn tồn tại, và chạy nó chính là "chuyển pha
   * hai lần" mà toàn bộ thiết kế này phải ngăn.
   */
  token: string;
  /** Mốc TUYỆT ĐỐI, không phải khoảng chờ: chỉ mốc tuyệt đối mới lưu được. */
  runAt: number;
  /** Chỉ có nghĩa với `afterDeathResult`: cái chết đến từ đêm hay từ phiên toà. */
  source?: "night" | "vote";
}
