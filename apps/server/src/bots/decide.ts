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
): Attempt<DaySpeechDecision> {
  const parsed = daySpeechSchema.safeParse(raw);
  if (!parsed.success) {
    log("bad_shape");
    return failed();
  }

  // Không parse mục tiêu từ output. Kể cả khi model viết tên người khác trong
  // câu, quyết định gameplay vẫn là cái lõi deterministic đã chốt.
  const chat = parsed.data.chat.trim();
  log("ok");
  return decided({ chat: chat.length === 0 ? null : chat.slice(0, chatMaxLength) });
}
