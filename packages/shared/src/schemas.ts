import { z } from "zod";
import {
  DEAD_MESSAGE_MAX_LENGTH,
  LAST_LETTER_MAX_LENGTH,
  MAX_PLAYERS_PER_ROOM,
  MIN_PLAYERS_TO_START,
  type RoomConfig,
} from "./phases";

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
    traitor: bool.optional(),
    apprenticeSeer: bool.optional(),
    detective: bool.optional(),
    guardianAngel: bool.optional(),
    priest: bool.optional(),
    mayor: bool.optional(),
    jester: bool.optional(),
    serialKiller: bool.optional(),
    executioner: bool.optional(),
    mode: roomModeSchema.optional(),
    voice: bool.optional(),
    lastLetter: bool.optional(),
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
    (config.mayor ? 1 : 0) +
    // Thằng Hề chiếm một ghế như mọi vai đặc biệt khác, dù nó không thuộc phe
    // làng: chỗ này đếm GHẾ ĐÃ BỊ LẤY, không đếm sức mạnh của phe nào.
    (config.jester ? 1 : 0) +
    // Sát Nhân cũng vậy, và cũng chỉ một lá: cấu hình là boolean nên "tối đa 1"
    // là tính chất của kiểu dữ liệu, không phải một phép kiểm tra ai đó phải
    // nhớ viết.
    (config.serialKiller ? 1 : 0) +
    // Kẻ Báo Thù cũng vậy, và cũng chỉ một lá.
    (config.executioner ? 1 : 0);
  /*
   * Kẻ Phản Bội chiếm một GHẾ nhưng KHÔNG vào `wolfCount`, và cả hai vế đều cố ý.
   *
   * Ghế: nó là một lá trong bộ bài như mọi lá khác, nên nó phải nằm trong
   * `totalRoles` để phép kiểm "phải còn chỗ cho Dân Làng" đếm đúng.
   *
   * KHÔNG vào `wolfCount`: con số đó gác luật "Sói phải ít hơn phe làng", và
   * luật đó mô hình hoá SỨC SÁT THƯƠNG BAN ĐÊM - bao nhiêu người chết mỗi đêm.
   * Kẻ Phản Bội không giết ai, nên đếm nó vào đây sẽ chặn những bộ bài hoàn
   * toàn chơi được. Phép đếm thế cân bằng lúc KẾT THÚC ván thì lại tính nó, và
   * đó là `checkWin` - hai câu hỏi khác nhau, hai phép đếm khác nhau.
   */
  const traitorSeats = config.traitor ? 1 : 0;
  const wolfCount = config.werewolves + (config.wolfCub ? 1 : 0);
  const totalRoles = wolfCount + specials + traitorSeats;
  if (totalRoles > playerCount) {
    return "Tổng số vai trò đặc biệt vượt quá số người chơi";
  }
  if (totalRoles === playerCount) {
    return "Phải còn chỗ cho Dân Làng";
  }
  // `playerCount - wolfCount` là "số người KHÔNG phải Sói", nên cả hai vai trung
  // lập đều được tính vào đó - đúng bằng cách `checkWin` đếm thế cân bằng của
  // bầy Sói. Hai phép đếm khác nhau ở đây sẽ cho phép mở một ván mà Sói đã
  // thắng từ đêm đầu.
  if (wolfCount >= playerCount - wolfCount) {
    return "Số Ma Sói phải ít hơn phe làng";
  }
  /*
   * KHÔNG có phép kiểm tra riêng nào cho "Kẻ Báo Thù phải có mục tiêu", và đó
   * là một kết luận chứ không phải một chỗ bỏ sót.
   *
   * Vai đó cần ít nhất một người PHE DÂN trên bàn. Hai dòng luật ngay trên đã
   * bảo đảm điều đó mạnh hơn mọi phép đếm thêm: `totalRoles === playerCount` bị
   * từ chối, nên luôn còn ít nhất một ghế được Dân Làng lấp - và Dân Làng thì
   * thuộc phe Dân. Thêm một `if` ở đây là thêm một nhánh không có đầu vào nào
   * chạm tới được, tức một nhánh không ai kiểm chứng được là còn đúng.
   *
   * Hàng rào thật nằm ở `GameEngine.create`, chỗ bốc mục tiêu: nó ném khi
   * không có ứng viên nào. Đó là nơi đúng, vì nó gác cả những lối vào KHÔNG đi
   * qua hàm này - harness self-play và test dựng cấu hình thẳng bằng code.
   */
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
  // Hành động RIÊNG của Sát Nhân, không dùng chung "KILL" với bầy Sói: một mã
  // duy nhất cho hai kỹ năng sẽ buộc engine phân giải theo vai người gửi, và
  // đó đúng là chỗ để một phiếu cắn của Sói đi nhầm vào ô của Sát Nhân.
  "SERIAL_KILL",
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
export const voiceTokenPayload = z.object({}).strict();
export const voiceReadyPayload = z.object({}).strict();
export const dayOfTruthClaimPayload = z.object({ role: z.string().min(1).nullable() }).strict();

/**
 * Lời nhắn của Tiếng Vọng Người Chết.
 *
 * Trần dùng chung hằng số với engine: hai con số rời nhau thì tầng lỏng hơn
 * mới là luật thật, và ở đây tầng lỏng hơn sẽ đẩy engine tới chỗ từ chối - tức
 * người chơi mất trắng lượt duy nhất của cả ván.
 */
export const deadMessagePayload = z
  .object({ text: z.string().trim().min(1).max(DEAD_MESSAGE_MAX_LENGTH) })
  .strict();
/**
 * Chỉ còn nhận null, tức là "xoá ảnh". Ảnh đi lên qua PUT /api/players/me/avatar.
 *
 * Không xoá hẳn sự kiện vì Vercel còn phục vụ bản client đã cache: client cũ
 * bấm "Xóa" vẫn phải chạy được, còn client cũ bấm "Lưu" thì phải nhận lỗi rõ
 * ràng thay vì im lặng hỏng.
 */
/**
 * Lưu / xoá Phong thư sau cùng.
 *
 * `null` là một lệnh THẬT ("xoá lá thư đang có"), không phải một payload thiếu -
 * đúng cùng cách `votePayload` phân biệt "không treo ai" với "phiếu trống". Vì
 * vậy union phải tường minh chứ không dùng `.optional()`: một trường vắng mặt
 * và một lệnh xoá không được đi chung một nhánh.
 *
 * Trim đứng TRƯỚC min/max nên trần được đo trên nội dung thật; một lá thư gồm
 * toàn khoảng trắng bị từ chối ở đây chứ không tới được server.
 */
export const lastLetterSetPayload = z
  .object({
    text: z.string().trim().min(1).max(LAST_LETTER_MAX_LENGTH).nullable(),
  })
  .strict();

export const updateAvatarPayload = z.object({ avatarUrl: z.null() }).strict();
export const chatSendPayload = z.object({ text: z.string().trim().min(1).max(300) }).strict();

export const addBotPayload = z.object({}).strict();

export const socketAuthSchema = z.object({
  playerId: z.string().min(8),
  token: z.string().min(16),
});
