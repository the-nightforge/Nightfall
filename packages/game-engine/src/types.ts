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
  /** Lưu lượng bình phương theo đêm/ngày: voterId -> targetId */
  votes: Record<string, string>;
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
