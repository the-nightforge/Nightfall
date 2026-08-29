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

export const roomModeSchema = z.enum(["ranked", "chaos"]);

export const roomConfigSchema = z
  .object({
    werewolves: z.number().int().min(1).max(4),
    seer: bool,
    guard: bool,
    witch: bool,
    hunter: bool,
    cursed: bool,
    wolfCub: bool.optional(),
    apprenticeSeer: bool.optional(),
    detective: bool.optional(),
    guardianAngel: bool.optional(),
    priest: bool.optional(),
    mayor: bool.optional(),
    mode: roomModeSchema.optional(),
    nightSeconds: z.number().int().min(15).max(120),
    discussionSeconds: z.number().int().min(30).max(300),
    voteSeconds: z.number().int().min(15).max(120),
    defenseSeconds: z.number().int().min(10).max(60),
    // Cận dưới 15 chứ không phải 10: chuỗi não bot mất tới 13s ở trường hợp xấu
    // nhất, nên cửa sổ 10s chỉ bày ra một lựa chọn chắc chắn hỏng.
    finalVoteSeconds: z.number().int().min(15).max(60),
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
    (config.seer ? 1 : 0) +
    (config.guard ? 1 : 0) +
    (config.witch ? 1 : 0) +
    (config.hunter ? 1 : 0) +
    (config.cursed ? 1 : 0) +
    (config.apprenticeSeer ? 1 : 0) +
    (config.detective ? 1 : 0) +
    (config.guardianAngel ? 1 : 0) +
    (config.priest ? 1 : 0) +
    (config.mayor ? 1 : 0);
  const wolfCount = config.werewolves + (config.wolfCub ? 1 : 0);
  const totalRoles = wolfCount + specials;
  if (totalRoles > playerCount) {
    return "Tổng số vai trò đặc biệt vượt quá số người chơi";
  }
  if (totalRoles === playerCount) {
    return "Phải còn chỗ cho Dân Làng";
  }
  if (wolfCount >= playerCount - wolfCount) {
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

export const nightActionTypeSchema = z.enum([
  "KILL",
  "SEE",
  "GUARD",
  "HEAL",
  "POISON",
  "SKIP",
  "DETECTIVE_CHECK",
  "GUARDIAN_PROTECT",
  "HOLY_WATER",
]);
export const gameActionPayload = z
  .object({
    type: nightActionTypeSchema,
    targetId: z.string().min(1).nullable().optional(),
    targetId1: z.string().min(1).nullable().optional(),
    targetId2: z.string().min(1).nullable().optional(),
  })
  .strict();

// targetId null nghĩa là "Không treo ai" - một lựa chọn có chủ đích, không phải
// phiếu trống. Vẫn strict và vẫn chặn chuỗi rỗng: chỉ nới đúng chỗ null.
export const votePayload = z.object({ targetId: z.string().min(1).nullable() }).strict();

// Phiếu xác nhận là nhị phân thật: true là Treo, false là Tha. Không gộp vào
// votePayload - một schema nhận cả id nullable lẫn boolean sẽ phải phân giải
// theo phase ở server, đúng chỗ để lọt một phiếu gửi nhầm pha.
export const finalVotePayload = z.object({ guilty: z.boolean() }).strict();
export const hunterShotPayload = z.object({ targetId: z.string().min(1).nullable() }).strict();
export const skipDiscussionPayload = z.object({ skip: z.boolean() }).strict();
export const dayOfTruthClaimPayload = z.object({ role: z.string().min(1).nullable() }).strict();
export const chatSendPayload = z.object({ text: z.string().trim().min(1).max(300) }).strict();

export const addBotPayload = z.object({}).strict();

export const socketAuthSchema = z.object({
  playerId: z.string().min(8),
  token: z.string().min(16),
});
