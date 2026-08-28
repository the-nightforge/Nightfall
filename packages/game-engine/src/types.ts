import type {
  DayVoteRecap,
  GameEventView,
  GamePhase,
  HunterShotRecap,
  NightRecap,
  RoomConfig,
  VoteMutation,
  Winner,
} from "@masoi/shared";
import type { Role } from "@masoi/shared";

export interface EnginePlayer {
  id: string;
  name: string;
  role: Role;
  alive: boolean;
  isBot: boolean;
  /**
   * Kẻ Nguyền Rủa đã bị Sói cắn thành công và đổi phe. Khi đó `role` đã được
   * ghi đè thành WEREWOLF - cờ này chỉ giữ lại gốc nguyền rủa để hiển thị cuối
   * ván và để chặn lần chuyển phe thứ hai.
   *
   * Không bắt buộc vì state lưu từ trước khi có role này không có trường đó;
   * constructor của GameEngine chuẩn hoá về false khi nạp lại.
   */
  cursedTurned?: boolean;
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
  /** Mục tiêu cắn thứ 2 của bầy Sói (khi có cắn kép từ Wolf Cub rage) */
  wolfSecondaryTarget: string | null;
  /** Đêm nay bầy Sói có được cắn 2 mục tiêu hay không */
  wolfCubRageTonight: boolean;
  /**
   * Phiếu Sói đã khoá chưa. Trước khi khoá, Sói còn đổi được phiếu và
   * Phù Thuỷ chưa được biết nạn nhân; sau khi khoá thì ngược lại.
   */
  wolvesLocked: boolean;
  guardTarget: string | null;
  guardianAngelTarget: string | null;
  /** Phù Thuỷ đã quyết định dùng bình cứu cho nạn nhân đêm nay chưa */
  healTonight: boolean;
  poisonTarget: string | null;
  /** Phù Thủy đã chủ động bỏ qua cả hai bình trong đêm này */
  witchSkipped: boolean;
  seerResults: Record<string, { targetId: string; isWolf: boolean; secondaryTargetId?: string; secondaryIsWolf?: boolean; unknown?: boolean }>;
  priestTarget: string | null;
  detectiveTargets: { target1: string; target2: string } | null;
  detectiveResults: Record<string, { target1Id: string; target2Id: string; sameTeam: boolean }>;
  priestResults: Record<string, { targetId: string; isWolf: boolean }>;
}

export interface DeathInfo {
  playerId: string;
  name: string;
  cause: "wolf" | "poison" | "priest" | "priest_backfire";
}

export interface PublicDeath {
  playerId: string;
  name: string;
}

export interface HunterReactionState {
  hunterId: string;
  source: "night" | "vote";
  resolved: boolean;
}

/**
 * Phiên toà đang diễn ra: một người đã bị vote sơ bộ đẩy lên, đang biện hộ hoặc
 * đang bị bỏ phiếu Treo/Tha.
 *
 * Gói vào một object nullable thay vì hai trường phẳng để "đang có phiên toà" là
 * đúng một phép kiểm tra, và để không tồn tại trạng thái nửa vời (có bị cáo mà
 * thiếu bảng phiếu). Cùng hình dạng với hunterReaction.
 */
export interface TrialState {
  accusedId: string;
  /**
   * voterId -> true là Treo, false là Tha.
   *
   * boolean chứ không phải string|null như votes: lá phiếu này chỉ có hai giá
   * trị và cả hai đều là lựa chọn có chủ đích. "Chưa bỏ phiếu" vẫn phân biệt
   * bằng key vắng mặt, nên mọi kiểm tra phải so với undefined chứ không dùng
   * truthiness - false là một phiếu Tha hợp lệ.
   */
  finalVotes: Record<string, boolean>;
}

/** Kết quả một phiên toà đã xử xong. */
export interface TrialRecapState {
  accused: { id: string; name: string };
  guilty: number;
  innocent: number;
  abstain: number;
  lynched: boolean;
}

/**
 * Kết quả kiểm phiếu sơ bộ. Vote sơ bộ KHÔNG giết ai: nó chỉ nói có mở phiên
 * toà hay không.
 */
export type NominationOutcome =
  | { kind: "TRIAL"; accusedId: string }
  | { kind: "NONE"; reason: "no-elimination" | "tie" | "no-votes" };

export interface GameState {
  phase: GamePhase;
  round: number;
  phaseEndsAt: number | null;
  phaseStartedAt: number;
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
  voteMutations: VoteMutation[];
  dayVoteHistory: DayVoteRecap[];
  guardPrevious: string | null;
  guardianAngelPrevious: string | null;
  guardianAngelCharges: Record<string, number>;
  priestHolyWaterUsed: Record<string, boolean>;
  apprenticeAwakened: boolean;
  wolfCubRageNextNight: boolean;
  healUsed: boolean;
  poisonUsed: boolean;
  lastNightDeaths: PublicDeath[];
  nightHistory: NightRecap[];
  lastEliminated: PublicDeath | null;
  /** Phiên toà đang diễn ra; null ngoài DEFENSE/FINAL_VOTE. */
  trial: TrialState | null;
  /** Phiên toà vừa xử xong, để màn hình kết quả phân biệt "được tha" với "hoà phiếu". */
  lastTrial: TrialRecapState | null;
  hunterReaction: HunterReactionState | null;
  hunterShots: HunterShotRecap[];
  activeEvent: GameEventView | null;
  eventHistory: GameEventView[];
  log: string[];
}

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}
