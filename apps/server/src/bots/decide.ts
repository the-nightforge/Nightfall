import { z } from "zod";
import type { RoomSnapshot } from "@masoi/shared";
import type {
  Attempt,
  DayDecision,
  HunterShotDecision,
  NightDecision,
  PlannedVote,
} from "./types";
import { decided, failed, nothingToDo } from "./types";
import {
  NO_ELIMINATION_VOTE,
  legalHunterTargets,
  legalNightTargets,
  legalVoteTargets,
  soloNightAction,
  witchActions,
} from "./targets";

export const nightSchema = z.object({
  think: z.string(),
  action: z.enum(["HEAL", "POISON", "SKIP"]).optional(),
  targetId: z.string().nullable().optional(),
});

export const daySchema = z.object({
  think: z.string(),
  chat: z.string(),
  voteTargetId: z.string().nullable().optional(),
});

export const hunterSchema = z.object({
  think: z.string(),
  targetId: z.string().nullable().optional(),
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

  const action = soloNightAction(view.you?.role);
  if (!action) {
    log("skip");
    return nothingToDo();
  }
  const target = parsed.data.targetId ?? null;
  if (!target || !legalNightTargets(view, action).includes(target)) {
    log("illegal_target");
    return failed();
  }
  log("ok");
  return decided({ action, targetId: target });
}

export function interpretDay(
  view: RoomSnapshot,
  raw: unknown,
  chatMaxLength: number,
  log: LogOutcome,
): Attempt<DayDecision> {
  const parsed = daySchema.safeParse(raw);
  if (!parsed.success) {
    log("bad_shape");
    return failed();
  }

  // Phiếu ngoài danh sách hợp lệ bị bỏ, nhưng lời thoại vẫn dùng được: đây là
  // một lượt nói thành công, không phải lượt hỏng cần nhà cung cấp khác nói lại.
  const choice = parsed.data.voteTargetId ?? null;
  const vote: PlannedVote | null =
    choice === NO_ELIMINATION_VOTE
      ? { type: "NO_ELIMINATION" }
      : choice && legalVoteTargets(view).includes(choice)
        ? { type: "PLAYER", targetId: choice }
        : null;

  log("ok");
  return decided({ chat: parsed.data.chat.slice(0, chatMaxLength), vote });
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
