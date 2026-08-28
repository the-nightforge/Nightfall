import type { GamePhase, NightRecap, RoomConfig, Winner } from "@masoi/shared";
import type { Role } from "@masoi/shared";

export interface EnginePlayer {
  id: string;
  name: string;
  role: Role;
  alive: boolean;
  isBot: boolean;
}

export interface NightState {
  /**
   * Phiếu cắn của từng Sói: wolfId -> mục tiêu, null nghĩa là "không cắn".
   *
   * Ba trạng thái phân biệt bằng chính kiểu dữ liệu như votes ban ngày:
   * key vắng mặt = chưa bầu, string = bầu người đó, null = chọn không cắn.
   */
  wolfVotes: Record<string, string | null>;
  /** Mục tiêu đã chốt sau khi khoá phiếu Sói; null nghĩa là đêm nay không cắn */
  killTarget: string | null;
  /**
   * Phiếu Sói đã khoá chưa. Trước khi khoá, Sói còn đổi được phiếu và
   * Phù Thuỷ chưa được biết nạn nhân; sau khi khoá thì ngược lại.
   */
  wolvesLocked: boolean;
  guardTarget: string | null;
/** Phù Thuỷ đã quyết định dùng bình cứu cho nạn nhân đêm nay chưa */
  healTonight: boolean;
  poisonTarget: string | null;
  /** Phù Thủy đã chủ động bỏ qua cả hai bình trong đêm này */
  witchSkipped: boolean;
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
  nightHistory: NightRecap[];
  lastEliminated: PublicDeath | null;
  log: string[];
}

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}
