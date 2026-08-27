import type { GamePhase, RoomConfig, Winner } from "@masoi/shared";
import type { Role } from "@masoi/shared";

export interface EnginePlayer {
  id: string;
  name: string;
  role: Role;
  alive: boolean;
  isBot: boolean;
}

export interface NightState {
  /** Mục tiêu Sói chọn chung cho cả bọn */
  killTarget: string | null;
  /** Sói đã hành động trong đêm này */
  actedWolves: string[];
  guardTarget: string | null;
  /** Bảo Vệ đã chọn save nạn nhân đêm nay chưa (Phù Thủy) */
  healTonight: boolean;
  poisonTarget: string | null;
  seerResults: Record<string, { targetId: string; isWolf: boolean }>;
}

export interface DeathInfo {
  playerId: string;
  name: string;
  cause: "wolf" | "poison";
}

export interface PublicDeath {
  playerId: string;
  name: string;
}

export interface GameState {
  phase: GamePhase;
  round: number;
  phaseEndsAt: number | null;
  players: EnginePlayer[];
  config: RoomConfig;
  winner: Winner;
  night: NightState;
  /**
   * Phiếu ban ngày: voterId -> lựa chọn.
   *
   * Ba trạng thái phân biệt bằng chính kiểu dữ liệu, không cần cờ phụ:
   *  - key vắng mặt / undefined: chưa bỏ phiếu
   *  - string: bỏ phiếu cho người chơi đó
   *  - null: chọn "Không treo ai"
   *
   * Vì null là một phiếu hợp lệ, mọi kiểm tra "đã vote chưa" phải so với
   * undefined chứ không được dùng truthiness.
   */
  votes: Record<string, string | null>;
  guardPrevious: string | null;
  healUsed: boolean;
  poisonUsed: boolean;
  lastNightDeaths: PublicDeath[];
  lastEliminated: PublicDeath | null;
  log: string[];
}

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}
