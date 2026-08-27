import { z } from "zod";
import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START, type RoomConfig } from "./phases";

export const nicknameSchema = z
  .string()
  .trim()
  .min(2, "Biệt danh tối thiểu 2 ký tự")
  .max(20, "Biệt danh tối đa 20 ký tự")
  .regex(/^[\p{L}\p{N} _.-]+$/u, "Biệt danh chỉ gồm chữ, số, dấu cách, dấu chấm, gạch nối");

export const roomCodeSchema = z.string().trim().toUpperCase().length(5);

const bool = z.boolean();

export const roomConfigSchema = z
  .object({
    werewolves: z.number().int().min(1).max(4),
    seer: bool,
    guard: bool,
    witch: bool,
    nightSeconds: z.number().int().min(15).max(120),
    discussionSeconds: z.number().int().min(30).max(300),
    voteSeconds: z.number().int().min(15).max(120),
  })
  .strict();

/**
 * Kiểm tra cấu hình vai trò hợp lệ với số lượng người chơi.
 * Lưu ý: hàm này KHÔNG phải dữ liệu bí mật, dùng chung client/server.
 */
export function validateRoomConfig(config: RoomConfig, playerCount: number): string | null {
  if (playerCount < MIN_PLAYERS_TO_START) {
    return `Cần ít nhất ${MIN_PLAYERS_TO_START} người để bắt đầu`;
  }
  if (playerCount > MAX_PLAYERS_PER_ROOM) {
    return `Tối đa ${MAX_PLAYERS_PER_ROOM} người mỗi phòng`;
  }
  const specials =
    (config.seer ? 1 : 0) + (config.guard ? 1 : 0) + (config.witch ? 1 : 0);
  const totalRoles = config.werewolves + specials;
  if (totalRoles > playerCount) {
    return "Tổng số vai trò đặc biệt vượt quá số người chơi";
  }
  if (totalRoles === playerCount) {
    return "Phải còn chỗ cho Dân Làng";
  }
  if (config.werewolves >= playerCount - config.werewolves) {
    return "Số Ma Sói phải ít hơn phe làng";
  }
  return null;
}

// ---- Socket payload schemas ----

export const createRoomPayload = z.object({}).strict();
export const joinRoomPayload = z.object({ code: roomCodeSchema }).strict();
export const setReadyPayload = z.object({ ready: z.boolean() }).strict();
export const kickPayload = z.object({ targetId: z.string().min(1) }).strict();
export const updateConfigPayload = z.object({ config: roomConfigSchema }).strict();
export const startGamePayload = z.object({}).strict();
export const resetGamePayload = z.object({}).strict();

export const nightActionTypeSchema = z.enum(["KILL", "SEE", "GUARD", "HEAL", "POISON"]);
export const gameActionPayload = z
  .object({
    type: nightActionTypeSchema,
    targetId: z.string().min(1).nullable().optional(),
  })
  .strict();

// targetId null nghĩa là "Không treo ai" - một lựa chọn có chủ đích, không phải
// phiếu trống. Vẫn strict và vẫn chặn chuỗi rỗng: chỉ nới đúng chỗ null.
export const votePayload = z.object({ targetId: z.string().min(1).nullable() }).strict();
export const skipDiscussionPayload = z.object({ skip: z.boolean() }).strict();
export const chatSendPayload = z.object({ text: z.string().trim().min(1).max(300) }).strict();

export const addBotPayload = z.object({}).strict();

export const socketAuthSchema = z.object({
  playerId: z.string().min(8),
  token: z.string().min(16),
});
