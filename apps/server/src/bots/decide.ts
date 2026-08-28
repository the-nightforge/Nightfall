import { z } from "zod";
import type { RoomSnapshot } from "@masoi/shared";
import type { Attempt, DaySpeechDecision, DefenseDecision } from "./types";
import { decided, failed } from "./types";

/**
 * `.strict()` là hàng rào cuối: kể cả khi prompt bị sửa sai và model trả về
 * `voteTargetId`, schema từ chối thẳng thay vì âm thầm bỏ qua trường đó.
 */
export const daySpeechSchema = z
  .object({
    think: z.string(),
    chat: z.string(),
  })
  .strict();

export const defenseSchema = z.object({
  think: z.string(),
  defense: z.string(),
});

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

export function interpretDefense(
  view: RoomSnapshot,
  raw: unknown,
  chatMaxLength: number,
  log: LogOutcome,
): Attempt<DefenseDecision> {
  const parsed = defenseSchema.safeParse(raw);
  if (!parsed.success) {
    log("bad_shape");
    return failed();
  }

  // Im lặng KHÔNG phải một lời bào chữa hợp lệ: đó là thứ đường lui tạo ra, và
  // nếu nó chiếm nhánh thành công thì chuỗi dự phòng không bao giờ được gọi.
  const defense = parsed.data.defense.trim();
  if (defense.length === 0) {
    log("bad_shape");
    return failed();
  }

  void view;
  log("ok");
  return decided({ chat: defense.slice(0, chatMaxLength) });
}
