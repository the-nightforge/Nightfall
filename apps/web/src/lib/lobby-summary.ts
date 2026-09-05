import type { Role, RoomConfig } from "@masoi/shared";
import { MIN_PLAYERS_TO_START, sameDeck } from "@masoi/shared";
import { PRESET_DECKS } from "./balance";

/**
 * Phần tóm tắt của phòng chờ.
 *
 * Phòng chờ cũ trải hết mọi thứ ra cùng lúc - thanh cân bằng, mười ba thẻ vai,
 * năm ô thời gian, công tắc voice - và trên điện thoại nó dài hơn ba màn hình
 * trong khi câu hỏi duy nhất lúc đó là "bấm được chưa". Module này là phần trả
 * lời đúng câu ấy; phần chi tiết lui vào các mục mở ra được.
 *
 * Thuần tính toán, không React: luật cân bằng và luật chặn bắt đầu KHÔNG đổi
 * chút nào so với bản cũ, chỉ đổi chỗ hiển thị, và test bên cạnh giữ đúng điều
 * đó.
 */

/** Thứ tự hiển thị, không phải thứ tự hành động ban đêm. Dân Làng luôn đứng cuối. */
export const VILLAGE_ROLES: Role[] = [
  "SEER",
  "APPRENTICE_SEER",
  "DETECTIVE",
  "GUARD",
  "GUARDIAN_ANGEL",
  "PRIEST",
  "WITCH",
  "HUNTER",
  "MAYOR",
  "ELDER",
  "MEDIUM",
  "DOPPELGANGER",
  "CURSED",
];

export const WOLF_SPECIAL_ROLES: Role[] = ["WOLF_CUB"];

/**
 * Vai TRUNG LẬP, bày thành nhóm thứ ba trong bộ bài.
 *
 * Không gộp vào `VILLAGE_ROLES` dù chúng cùng "không phải Sói": bộ bài là chỗ
 * host đọc để hiểu ván sắp tới, và xếp Thằng Hề dưới nhãn "Phe Dân Làng" là nói
 * dối ngay ở màn hình quyết định. `deckCounts` vẫn cộng chúng vào `specials` vì
 * chúng chiếm ghế y hệt - hai câu hỏi khác nhau, hai chỗ khác nhau.
 */
export const NEUTRAL_ROLES: Role[] = ["JESTER", "SERIAL_KILLER", "EXECUTIONER"];

/** Khoá cấu hình tương ứng với từng vai bật/tắt được. */
export const CONFIG_KEY: Record<string, keyof RoomConfig> = {
  SEER: "seer",
  APPRENTICE_SEER: "apprenticeSeer",
  DETECTIVE: "detective",
  GUARD: "guard",
  GUARDIAN_ANGEL: "guardianAngel",
  PRIEST: "priest",
  WITCH: "witch",
  HUNTER: "hunter",
  MAYOR: "mayor",
  ELDER: "elder",
  MEDIUM: "medium",
  DOPPELGANGER: "doppelganger",
  CURSED: "cursed",
  WOLF_CUB: "wolfCub",
  JESTER: "jester",
  SERIAL_KILLER: "serialKiller",
  EXECUTIONER: "executioner",
};

export interface DeckCounts {
  wolves: number;
  specials: number;
  villagers: number;
}

/**
 * Bộ bài quy ra ba con số.
 *
 * Đọc thẳng `config.villagers`, đúng như `buildRoleDeck` làm ở engine - đây là
 * bản xem trước, không phải một luật chia bài thứ hai.
 */
export function deckCounts(config: RoomConfig, playerCount: number): DeckCounts {
  // Vai trung lập được cộng vào `specials` vì chúng chiếm ghế đúng như mọi vai
  // đặc biệt khác - `villagers` là phần CÒN LẠI, và bỏ sót chúng ở đây sẽ đếm
  // thừa một Dân Làng không tồn tại.
  const specials = [...VILLAGE_ROLES, ...NEUTRAL_ROLES].filter(
    (role) => config[CONFIG_KEY[role]],
  ).length;
  const wolves = config.werewolves + WOLF_SPECIAL_ROLES.filter((r) => config[CONFIG_KEY[r]]).length;
  // `villagers` do host đặt. Nhánh `??` là đường tương thích cho cấu hình ghi
  // trước khi trường đó tồn tại; xem `RoomConfig.villagers`.
  const villagers = config.villagers ?? Math.max(0, playerCount - wolves - specials);
  return { wolves, specials, villagers };
}

/**
 * Bộ bài hiện tại có đúng bằng preset chuẩn cho số người này không.
 *
 * Chỉ so phần BÀI. Thời gian từng pha và chế độ Ranked/Chaos chỉnh riêng, và
 * host đổi giây thảo luận không có nghĩa là họ đã rời khỏi preset.
 */
export function isPresetDeck(config: RoomConfig, playerCount: number): boolean {
  const preset = PRESET_DECKS[playerCount];
  // `sameDeck` là ranh giới bộ bài / luật chơi của shared - cùng ranh giới mà
  // server dùng để quyết định có chấm lại cân bằng hay không. Số Dân Làng nằm
  // trong đó: hai bộ giống nhau ở mọi lá đặc biệt mà khác số Dân Làng là hai
  // bộ bài khác cỡ.
  return !!preset && sameDeck(preset, config);
}

export type StartBlock =
  | { kind: "need-players"; missing: number }
  | { kind: "balance" }
  | { kind: "config"; message: string }
  | { kind: "unready"; names: string[] }
  | null;

export interface StartBlockInput {
  playerCount: number;
  /** Kết quả `validateRoomConfig`; null là hợp lệ. */
  configError: string | null;
  /**
   * `blocking` của `generateWarnings` - ưu tiên bản server gửi trong snapshot.
   *
   * Chỉ là ĐẦU VÀO: luật cân bằng nằm ở `@masoi/shared` và không có bản thứ hai
   * ở đây.
   */
  balanceBlocking: boolean;
  /** Chaos bỏ qua chặn cân bằng - đúng như server làm. */
  mode: "ranked" | "chaos";
  /** Khách mời người thật chưa bấm sẵn sàng. */
  unreadyNames: string[];
}

/**
 * Lý do ĐANG chặn nút bắt đầu, hoặc null nếu bấm được.
 *
 * Trả về đúng một lý do chứ không phải danh sách: chúng đến theo thứ tự người
 * chơi thực sự gặp phải, và in cả bốn cùng lúc thì ba cái sau chỉ là nhiễu -
 * chưa đủ người thì cân bằng chưa có ý nghĩa gì.
 *
 * Thứ tự BÁM theo `RoomService.start` trong apps/server/src/rooms/service.ts:
 *
 *   1. cân bằng (chỉ khi đã đủ người, và chỉ ở Ranked) -> BALANCE_UNSTABLE
 *   2. validateRoomConfig
 *   3. allRequiredPlayersReady
 *
 * "Chưa đủ người" đứng đầu ở đây vì server gói nó vào `validateRoomConfig`,
 * đồng thời rào chốt cân bằng sau `members.length >= 6` - nên với bàn chưa đủ
 * người, lý do server thực sự trả về cũng chính là lý do thiếu người.
 *
 * Sai khớp ở đây không phải chuyện thẩm mỹ: nút sáng mà server từ chối thì
 * người chơi bấm và nhận về một dòng lỗi đỏ không nói được phải sửa gì.
 */
export function startBlock(input: StartBlockInput): StartBlock {
  const missing = Math.max(0, MIN_PLAYERS_TO_START - input.playerCount);
  if (missing > 0) return { kind: "need-players", missing };
  if (input.balanceBlocking && input.mode === "ranked") return { kind: "balance" };
  if (input.configError) return { kind: "config", message: input.configError };
  if (input.unreadyNames.length > 0) return { kind: "unready", names: input.unreadyNames };
  return null;
}

export interface DeckStage {
  /** Số người đã đủ để việc chấm cân bằng có nghĩa chưa. */
  rated: boolean;
  /** Dòng chữ bên phải tiêu đề thẻ thiết lập. */
  summary: string;
  /** Câu đứng thay thanh cân bằng khi chưa đủ người; null khi đã đủ. */
  pending: string | null;
}

/**
 * Bộ bài đang ở giai đoạn nào của phòng chờ.
 *
 * Dưới `MIN_PLAYERS_TO_START`, mọi con số cân bằng đều là chấm điểm cho một bàn
 * chưa tồn tại: `calculateBalanceScore` vẫn chạy và vẫn trả về một con số, còn
 * `PRESET_DECKS` phủ đúng 8..15 nên nó luôn kèm theo "Không có preset". Phòng 1
 * người vì thế từng hiện cùng lúc "Cần thêm 5 người nữa để bắt đầu", "Bộ bài
 * cho 1 người", một thanh cân bằng 58 điểm, và một câu bảo "Bạn vẫn chơi được".
 *
 * Ở giai đoạn đó cấu hình vẫn là cấu hình - host chỉnh trước được, và chỉnh
 * xong vẫn đúng - nhưng nó chưa phải một BỘ BÀI cho số người hiện tại.
 */
export function deckStage(playerCount: number): DeckStage {
  if (playerCount >= MIN_PLAYERS_TO_START) {
    return { rated: true, summary: `Bộ bài cho ${playerCount} người`, pending: null };
  }
  return {
    rated: false,
    summary: "Đang chờ đủ người để chốt bộ bài",
    pending: `Cân bằng đội hình sẽ được đánh giá khi phòng có đủ ${MIN_PLAYERS_TO_START} người.`,
  };
}
