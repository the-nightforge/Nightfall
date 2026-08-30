import { z } from "zod";
import type { Attempt, DaySpeechDecision } from "./types";
import { decided, failed } from "./types";

/**
 * `.strict()` là hàng rào cuối: kể cả khi prompt bị sửa sai và model trả về
 * `voteTargetId`, schema từ chối thẳng thay vì âm thầm bỏ qua trường đó.
 *
 * Dùng chung cho CẢ lượt bào chữa: `buildDaySpeechPrompt` sinh cùng một hình
 * dạng `{ think, chat }` dù `request.defense` có mặt hay không, nên không cần
 * một schema `{ think, defense }` riêng nữa.
 */
export const daySpeechSchema = z
  .object({
    think: z.string(),
    chat: z.string(),
  })
  .strict();

export const DEFAULT_CHAT_MAX = 300;

/**
 * Mã lỗi thô để phân biệt lý do fallback trong log sản xuất. Chỉ dùng để log,
 * không phải phân cấp lỗi — cố tình giữ thô: một chuỗi liệt kê nhỏ là đủ.
 */
export type CallOutcome =
  | "ok"
  | "skip"
  | "429"
  | "timeout"
  | "bad_json"
  | "bad_shape"
  | "illegal_target";

export type LogOutcome = (outcome: CallOutcome, detail?: string) => void;

export interface InterpretDaySpeechOptions {
  /**
   * Ban ngày: chuỗi rỗng là một quyết định hợp lệ — "chủ động không nói gì
   * thêm" — nên nó `decided({ chat: null })` và KHÔNG kéo chuỗi dự phòng đi
   * hỏi nhà cung cấp kế tiếp (`FallbackBrain` dừng ở nhánh `ok: true` đầu
   * tiên, bất kể `value` có `chat` hay không).
   *
   * Lượt bào chữa thì khác: im lặng không phải một lựa chọn hợp lệ, nó là thứ
   * đường lui (bảng mẫu) tạo ra khi không còn ai trả lời được. Nếu chuỗi rỗng
   * ở đây cũng `decided(null)` thì nó chiếm mất nhánh thành công, và
   * `FallbackBrain` không bao giờ thử nhà cung cấp kế tiếp cho một bị cáo -
   * đúng người ít có cơ hội "được hỏi lại" nhất nên KHÔNG được bỏ lỡ nó. Bật
   * cờ này để chuỗi rỗng quay lại là `failed()`, y hệt `interpretDefense` cũ.
   */
  treatEmptyAsFailure?: boolean;
}

/**
 * Diễn giải JSON thô thành lời thoại ban ngày, dùng chung cho mọi nhà cung cấp.
 *
 * Tách khỏi tầng transport có chủ đích: đây là nơi đặt các cổng kiểm tra tính
 * hợp lệ, và nhân đôi chúng cho từng nhà cung cấp là cách chắc chắn nhất để hai
 * bản trôi lệch nhau rồi một bên hở.
 */
export function interpretDaySpeech(
  raw: unknown,
  chatMaxLength: number,
  log: LogOutcome,
  options: InterpretDaySpeechOptions = {},
): Attempt<DaySpeechDecision> {
  const parsed = daySpeechSchema.safeParse(raw);
  if (!parsed.success) {
    log("bad_shape");
    return failed();
  }

  // Không parse mục tiêu từ output. Kể cả khi model viết tên người khác trong
  // câu, quyết định gameplay vẫn là cái lõi deterministic đã chốt.
  const chat = parsed.data.chat.trim();

  if (chat.length === 0) {
    if (options.treatEmptyAsFailure) {
      log("bad_shape");
      return failed();
    }
    log("ok");
    return decided({ chat: null });
  }

  log("ok");
  return decided({ chat: chat.slice(0, chatMaxLength) });
}
