import type { Phase, RoomConfig, Winner } from "./phases";
import type { Role } from "./roles";

/** Snapshot người chơi mà client được nhìn thấy (đã làm sạch thông tin bí mật). */
export interface PlayerView {
  id: string;
  name: string;
  alive: boolean;
  isBot: boolean;
  /** Chỉ hiện khi game kết thúc hoặc viewer đã chết */
  role?: Role;
  /** Số phiếu đang có (chỉ trong VOTING) hoặc phiếu cuối (sau bỏ phiếu) */
  voteCount?: number;
  /** Chỉ dùng trong phòng chờ */
  ready?: boolean;
  connected?: boolean;
}

export interface NightActionView {
  canAct: boolean;
  acted: boolean;
  /**
   * Bầy Sói đã chốt phiếu chưa. Trước khi chốt, Sói còn đổi phiếu được và
   * Phù Thuỷ chưa tới lượt; sau khi chốt thì ngược lại.
   */
  wolvesLocked?: boolean;
  /**
   * Nạn nhân bầy Sói đã chốt, chỉ gửi cho Sói và Phù Thuỷ sau khi khoá phiếu.
   * null nghĩa là đêm nay bầy Sói không cắn ai.
   */
  wolfTarget?: string | null;
  /** Với Sói: số phiếu cắn theo từng mục tiêu */
  wolfVoteCounts?: Record<string, number>;
  /** Với Sói: số phiếu "không cắn" và tổng số Sói còn sống cần bầu */
  wolfSkipVotes?: number;
  wolfVotesRequired?: number;
  /** Với Sói: phiếu của chính viewer; null là đã chọn "không cắn" */
  myWolfVote?: string | null;
  /** Với Bảo Vệ: mục tiêu đêm trước, không được đỡ lại */
  guardPrevious?: string | null;
  /** Với Tiên Tri: kết quả soi gần nhất */
  seerResult?: { targetId: string; targetName: string; isWolf: boolean } | null;
  /** Với Phù Thủy */
  healUsed?: boolean;
  poisonUsed?: boolean;
}

export interface DiscussionSkipView {
  votes: number;
  required: number;
  hasVoted: boolean;
  canVote: boolean;
}

export interface RecapPlayer {
  id: string;
  name: string;
}

export interface HunterShotView {
  hunterId: string;
  hunterName: string;
  canAct: boolean;
  resolved: boolean;
  /** null khi chưa xử lý hoặc khi Thợ Săn chọn không bắn ai. */
  target: RecapPlayer | null;
}

export interface HunterShotRecap {
  round: number;
  hunter: RecapPlayer;
  target: RecapPlayer | null;
  source: "night" | "vote";
}

export interface NightRecap {
  round: number;
  wolfTarget: RecapPlayer | null;
  guardTarget: RecapPlayer | null;
  seerChecks: Array<{
    seer: RecapPlayer;
    target: RecapPlayer;
    isWolf: boolean;
  }>;
  witch: {
    usedHeal: boolean;
    healedTarget: RecapPlayer | null;
    poisonTarget: RecapPlayer | null;
  };
  deaths: Array<{
    player: RecapPlayer;
    cause: "wolf" | "poison";
  }>;
}

/** Snapshot toàn bộ trạng thái phòng + trận đấu dành cho MỘT người chơi cụ thể. */
export interface RoomSnapshot {
  code: string;
  hostId: string | null;
  phase: Phase;
  config: RoomConfig;
  round: number;
  /** epoch ms - client đếm ngược từ đây */
  phaseEndsAt: number | null;
  you: {
    id: string;
    name: string;
    ready: boolean;
    connected: boolean;
    role?: Role;
    alive: boolean;
  } | null;
  players: PlayerView[];
  night: NightActionView | null;
  hunterShot: HunterShotView | null;
  /**
   * Viewer đã gửi phiếu chưa. Cần cờ riêng vì myVote === null vừa có thể là
   * chưa vote, vừa có thể là đã chọn "Không treo ai".
   */
  hasVoted: boolean;
  /** id người viewer đã bỏ phiếu; null khi chưa vote hoặc chọn không treo ai */
  myVote: string | null;
  /** Số phiếu "Không treo ai"; tách khỏi PlayerView.voteCount */
  noEliminationVoteCount: number;
  /** Đồng thuận kết thúc thảo luận sớm; chỉ có trong DAY_DISCUSSION. */
  discussionSkip: DiscussionSkipView | null;
  votesRevealed: boolean;
  /** Toàn bộ diễn biến đêm; chỉ có dữ liệu ở GAME_OVER. */
  nightHistory: NightRecap[];
  hunterShots: HunterShotRecap[];
  lastNightDeaths: { playerId: string; name: string }[];
  lastEliminated: { playerId: string; name: string } | null;
  winner: Winner;
  chatLog: ChatMessage[];
  log: string[];
}

export interface ChatMessage {
  id: string;
  channel: string;
  playerId: string;
  playerName: string;
  text: string;
  at: number;
}
