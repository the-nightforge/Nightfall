export const PHASES = [
  "LOBBY",
  "ROLE_REVEAL",
  "NIGHT",
  "NIGHT_RESULT",
  "DAY_DISCUSSION",
  "VOTING",
  "ELIMINATION",
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
  /** giây */
  nightSeconds: number;
  discussionSeconds: number;
  voteSeconds: number;
}

export const DEFAULT_ROOM_CONFIG: RoomConfig = {
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  nightSeconds: 30,
  discussionSeconds: 90,
  voteSeconds: 30,
};

export const MIN_PLAYERS_TO_START = 6;
export const MAX_PLAYERS_PER_ROOM = 15;

export const CHAT_CHANNELS = ["lobby", "day", "wolves", "dead"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
