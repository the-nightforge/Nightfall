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
  /** Với Sói: mục tiêu hiện tại cả bọn đã chọn */
  wolfTarget?: string | null;
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
