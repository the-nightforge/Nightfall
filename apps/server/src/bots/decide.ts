import { z } from "zod";
import type { RoomSnapshot } from "@masoi/shared";
import type {
  Attempt,
  DaySpeechDecision,
  DefenseDecision,
  FinalVoteDecision,
  HunterShotDecision,
  NightDecision,
} from "./types";
import { decided, failed, nothingToDo } from "./types";
import {
  legalHunterTargets,
  legalNightTargets,
  soloNightAction,
  witchActions,
} from "./targets";

export const nightSchema = z.object({
  think: z.string(),
  action: z.enum(["HEAL", "POISON", "SKIP"]).optional(),
  targetId: z.string().nullable().optional(),
  secondaryTargetId: z.string().nullable().optional(),
});

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

export const hunterSchema = z.object({
  think: z.string(),
  targetId: z.string().nullable().optional(),
});

export const defenseSchema = z.object({
  think: z.string(),
  defense: z.string(),
});

// guilty bắt buộc và phải đúng kiểu boolean: xem interpretFinalVote.
export const finalVoteSchema = z.object({
  think: z.string(),
  guilty: z.boolean(),
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
 * Diễn giải JSON thô thành quyết định đêm, dùng chung cho mọi nhà cung cấp.
 *
 * Tách khỏi tầng transport có chủ đích: đây là nơi đặt các cổng kiểm tra tính
 * hợp lệ, và nhân đôi chúng cho từng nhà cung cấp là cách chắc chắn nhất để hai
 * bản trôi lệch nhau rồi một bên hở.
 */
export function interpretNight(
  view: RoomSnapshot,
  raw: unknown,
  log: LogOutcome,
): Attempt<NightDecision> {
  const parsed = nightSchema.safeParse(raw);
  if (!parsed.success) {
    log("bad_shape");
    return failed();
  }

  if (view.you?.role === "WITCH") {
    const action = parsed.data.action;
    // Cổng hợp lệ thứ hai: xác nhận hành động Phù Thuỷ chọn còn dùng được
    // (bình đã dùng thì engine sẽ từ chối) — không tin riêng Zod.
    if (!action || !witchActions(view).includes(action)) {
      log("illegal_target");
      return failed();
    }
    if (action === "HEAL") {
      log("ok");
      return decided({ action: "HEAL", targetId: null });
    }
    if (action !== "POISON") {
      // SKIP là lựa chọn có chủ đích, không phải lỗi: không được kéo sang não khác hỏi lại.
      log("skip");
      return nothingToDo();
    }
    const target = parsed.data.targetId ?? null;
    if (!target || !legalNightTargets(view, "POISON").includes(target)) {
      log("illegal_target");
      return failed();
    }
    log("ok");
    return decided({ action: "POISON", targetId: target });
  }

  const action = soloNightAction(view.you?.role, view);
  if (!action) {
    log("skip");
    return nothingToDo();
  }

  if (action === "DETECTIVE_CHECK") {
    const target1 = parsed.data.targetId ?? null;
    const target2 = parsed.data.secondaryTargetId ?? null;
    const legal = legalNightTargets(view, "DETECTIVE_CHECK");
    if (!target1 || !target2 || target1 === target2 || !legal.includes(target1) || !legal.includes(target2)) {
      log("illegal_target");
      return failed();
    }
    log("ok");
    return decided({ action: "DETECTIVE_CHECK", targetId: target1, secondaryTargetId: target2 });
  }

  const target = parsed.data.targetId ?? null;
  if (!target || !legalNightTargets(view, action).includes(target)) {
    log("illegal_target");
    return failed();
  }
  log("ok");
  return decided({ action, targetId: target });
}

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

export function interpretFinalVote(
  view: RoomSnapshot,
  raw: unknown,
  log: LogOutcome,
): Attempt<FinalVoteDecision> {
  const parsed = finalVoteSchema.safeParse(raw);
  // Thiếu guilty hoặc guilty không phải boolean là lượt HỎNG, không được ép về
  // false: làm thế sẽ biến một lời gọi lỗi thành một phiếu Tha thật, và chuỗi
  // dự phòng không bao giờ chạy.
  if (!parsed.success) {
    log("bad_shape");
    return failed();
  }

  void view;
  log("ok");
  return decided({ guilty: parsed.data.guilty });
}

export function interpretHunterShot(
  view: RoomSnapshot,
  raw: unknown,
  log: LogOutcome,
): Attempt<HunterShotDecision> {
  const parsed = hunterSchema.safeParse(raw);
  if (!parsed.success) {
    log("bad_shape");
    return failed();
  }

  const targetId = parsed.data.targetId ?? null;
  if (targetId === null) {
    log("skip");
    return decided({ targetId: null });
  }
  if (!legalHunterTargets(view).includes(targetId)) {
    log("illegal_target");
    return failed();
  }

  log("ok");
  return decided({ targetId });
}
