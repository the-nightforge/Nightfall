export const PHASES = [
  "LOBBY",
  "ROLE_REVEAL",
  "NIGHT",
  "NIGHT_RESULT",
  "DAY_DISCUSSION",
  // VOTING giữ nguyên tên nhưng đổi nghĩa: nó ĐỀ CỬ bị cáo chứ không còn giết
  // ai. Mọi cái chết ban ngày đi qua FINAL_VOTE.
  "VOTING",
  "DEFENSE",
  "FINAL_VOTE",
  "ELIMINATION",
  "HUNTER_SHOT",
  "CHECK_WIN",
  "GAME_OVER",
] as const;

export type Phase = (typeof PHASES)[number];
export type GamePhase = Exclude<Phase, "LOBBY">;

export type Winner = "wolves" | "village" | null;

/** Cấu hình số lượng vai trò do chủ phòng đặt. Dân Làng tự động lấp chỗ còn lại. */
export interface RoomConfig {
  werewolves: number;
  seer: boolean;
  guard: boolean;
  witch: boolean;
  hunter: boolean;
  cursed: boolean;
  /** giây */
  nightSeconds: number;
  discussionSeconds: number;
  /** Vòng bỏ phiếu sơ bộ - chỉ chọn ra bị cáo, không loại ai. */
  voteSeconds: number;
  /** Cửa sổ bị cáo tự bào chữa. */
  defenseSeconds: number;
  /**
   * Vòng bỏ phiếu Treo/Tha. Cận dưới 15 giây là bắt buộc: chuỗi não bot mất tới
   * 13 giây ở trường hợp xấu nhất, cửa sổ ngắn hơn thì mọi bot đều rơi về
   * đường lui cục bộ.
   */
  finalVoteSeconds: number;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: false,
  cursed: false,
  nightSeconds: 30,
  // Hạ từ 90 khi thêm phiên toà: vote sơ bộ giờ đã đóng vai trò vòng thảo luận
  // thứ hai, giữ 90 thì một ngày kéo dài gần ba phút.
  discussionSeconds: 60,
  voteSeconds: 30,
  defenseSeconds: 25,
  finalVoteSeconds: 20,
};

export const MIN_PLAYERS_TO_START = 6;
export const MAX_PLAYERS_PER_ROOM = 15;

export const CHAT_CHANNELS = ["lobby", "day", "wolves", "dead"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
