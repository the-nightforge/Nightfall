import type {
  DayVoteRecap,
  GameEventView,
  GamePhase,
  HunterShotRecap,
  NightRecap,
  PersonalWin,
  RoomConfig,
  Team,
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
  /**
   * `team` đi CẠNH `isWolf`, không thay nó: `isWolf` vẫn là thứ mọi luật cũ
   * đọc, còn `team` mang câu trả lời đầy đủ để một mục tiêu trung lập không bị
   * báo về là "người của làng". Optional vì state lưu trước bản này không có nó.
   */
  seerResults: Record<
    string,
    {
      targetId: string;
      isWolf: boolean;
      team?: Team;
      secondaryTargetId?: string;
      secondaryIsWolf?: boolean;
      secondaryTeam?: Team;
      unknown?: boolean;
    }
  >;
  priestTarget: string | null;
  /** Linh Mục đã chọn không dùng nước thánh đêm nay */
  priestSkipped: boolean;
  detectiveTargets: { target1: string; target2: string } | null;
  detectiveResults: Record<
    string,
    { target1Id: string; target2Id: string; sameTeam: boolean; unknown?: boolean }
  >;
  priestResults: Record<string, { targetId: string; isWolf: boolean }>;
  /**
   * Mục tiêu Sát Nhân đã chốt cho đêm nay; `null` là chưa chọn hoặc đã bỏ qua.
   *
   * Trạng thái RIÊNG, không dùng chung `wolfVotes` hay `killTarget`: Sát Nhân
   * không bầu với ai và không đi cùng nhịp khoá phiếu của bầy Sói. Dùng chung
   * một ô sẽ khiến `lockWolves` kiểm phiếu của nó, `witchPending` báo cho Phù
   * Thuỷ nạn nhân của nó, và cả hai đều là luật sai.
   *
   * Optional vì snapshot ghi trước bản này không có trường đó; constructor của
   * GameEngine chuẩn hoá về `null` khi nạp lại.
   */
  serialKillerTarget?: string | null;
  /**
   * Sát Nhân đã chủ động bỏ qua đêm nay.
   *
   * Cần một cờ riêng vì `serialKillerTarget === null` mang HAI nghĩa: chưa
   * quyết, và quyết là không giết ai - đúng cặp trạng thái mà `priestSkipped`
   * tồn tại để phân biệt.
   */
  serialKillerSkipped?: boolean;
}

export interface DeathInfo {
  playerId: string;
  name: string;
  /**
   * `serial_killer` là một nguồn RIÊNG, không phải một biến thể của `wolf`.
   *
   * Ba chỗ đọc nguyên nhân theo đúng chữ này và cả ba sẽ sai nếu gộp: Trăng Máu
   * chỉ nạp lại khi bầy Sói không giết được ai, hoá Sói chỉ kích hoạt bằng một
   * nhát cắn hợp lệ, và bản tường thuật kể hai cái chết bằng hai câu khác nhau.
   */
  cause: "wolf" | "poison" | "priest" | "priest_backfire" | "serial_killer";
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
  pendingLastStandVictim: { playerId: string; dieRound: number } | null;
  bloodMoonArmed: boolean;
  bloodMoonUsed: boolean;
  deadCanSpeakUsed: boolean;
  /**
   * Linh hồn được chọn để nói trong Tiếng Vọng Người Chết.
   *
   * BÍ MẬT. Không được xuất hiện ở bất kỳ trường nào của `snapshotFor`, kể cả
   * gián tiếp: cả sự kiện dựa vào việc không ai biết lời nhắn từ đâu ra.
   */
  deadCanSpeakChosenId: string | null;
  howlBonusDay: number | null;
  dayOfTruthClaims: Record<string, string | null>;
  /**
   * Thắng lợi CÁ NHÂN đã ghi nhận trong ván, theo thứ tự xảy ra.
   *
   * Tách hẳn khỏi `winner`: ghi một mục ở đây KHÔNG kết thúc ván và KHÔNG đổi
   * phe thắng chung. Ván chạy tiếp, và mục này sống tới `GAME_OVER` bất kể sau
   * đó Dân hay Sói thắng.
   *
   * Mỗi người tối đa một mục cả ván - `recordPersonalWin` gác điều đó, nên một
   * pha bị chạy lại (khôi phục sau restart, một bước về muộn) không nhân đôi
   * được thành tích.
   *
   * Optional vì state lưu trước bản này không có trường đó; constructor chuẩn
   * hoá về mảng rỗng khi nạp lại.
   */
  personalWins?: PersonalWin[];
}

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GameError";
  }
}
