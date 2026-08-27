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
  /** Với Tiên Tri: kết quả soi gần nhất */
  seerResult?: { targetId: string; targetName: string; isWolf: boolean } | null;
  /** Với Phù Thủy */
  healUsed?: boolean;
  poisonUsed?: boolean;
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
  /** id người viewer đã bỏ phiếu (trong VOTING) */
  myVote: string | null;
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
