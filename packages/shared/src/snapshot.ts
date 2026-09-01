import type { Phase, RoomConfig, Winner } from "./phases";
import type { Role } from "./roles";
import type { GameEventId } from "./events";

export interface BalanceWarningView {
  score: number;
  warnings: string[];
  blocking: boolean;
  villagePower: number;
  wolfPower: number;
}

export interface GameEventView {
  id: GameEventId;
  name: string;
  description: string;
  /** Kết quả công khai phát sinh khi event kích hoạt, nếu event có kết quả động. */
  announcement?: string;
  targetPhase: "NIGHT" | "DAY";
  round: number;
  beneficiary: "wolves" | "village" | "neutral";
  power: number;
}

/** Snapshot người chơi mà client được nhìn thấy (đã làm sạch thông tin bí mật). */
export interface PlayerView {
  id: string;
  name: string;
  alive: boolean;
  isBot: boolean;
  /** Ảnh đại diện custom base64, ưu tiên hơn avatar hash */
  avatarUrl?: string | null;
  /*
   * Vai trò của người này, chỉ khi người NHẬN snapshot được phép biết.
   *
   * Đúng hai trường hợp, gác ở `snapshotFor` trong game-engine:
   *   - ván đã kết thúc (GAME_OVER): lộ hết cho mọi người;
   *   - người nhận là Sói CÒN SỐNG, và người này cũng thuộc phe Sói.
   *
   * Chú thích cũ ghi "hoặc viewer đã chết" - sai. Người chết KHÔNG nhận được
   * vai trò của ai cả (kể cả Sói đã chết cũng mất quyền nhìn đồng bọn), và
   * engine có test khoá đúng điều đó. Một chú thích rộng hơn code là lời mời
   * người sửa sau nới code ra cho "khớp tài liệu".
   */
  role?: Role;
  /**
   * Người này vốn là Kẻ Nguyền Rủa và đã bị Sói cắn hoá Sói. Chỉ đi kèm khi
   * `role` được phép lộ hoàn toàn (hết ván / viewer đã chết): đồng bọn Sói chỉ
   * thấy `role` là WEREWOLF chứ không biết gốc nguyền rủa.
   */
  cursedTurned?: boolean;
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
  /** Mục tiêu phụ của Sói (nếu Sói Con chết vòng trước hoặc do Event Cuộc săn đẫm máu) */
  wolfSecondaryTarget?: string | null;
  /** Với Sói: số phiếu cắn theo từng mục tiêu */
  wolfVoteCounts?: Record<string, number>;
  /** Với Sói: số phiếu "không cắn" và tổng số Sói còn sống cần bầu */
  wolfSkipVotes?: number;
  wolfVotesRequired?: number;
  /** Với Sói: phiếu của chính viewer; null là đã chọn "không cắn" */
  myWolfVote?: string | null;
  /** Với Bảo Vệ: mục tiêu đêm trước, không được đỡ lại */
  guardPrevious?: string | null;
  /** Với Thiên Thần Hộ Mệnh: số lượt khiên còn lại (tối đa 2) */
  guardianAngelCharges?: number;
  /** Với Thiên Thần Hộ Mệnh: mục tiêu đêm trước, không được đỡ lại */
  guardianAngelPrevious?: string | null;
  /** Với Tiên Tri: kết quả soi gần nhất */
  seerResult?: {
    targetId: string;
    targetName: string;
    isWolf?: boolean;
    secondaryTargetId?: string;
    secondaryTargetName?: string;
    secondaryIsWolf?: boolean;
    unknown?: boolean;
  } | null;
  /** Với Tiên Tri Tập Sự: cờ đánh dấu đã thức tỉnh thừa kế kỹ năng soi */
  apprenticeAwakened?: boolean;
  /** Với Thám Tử: kết quả kiểm tra 2 mục tiêu */
  detectiveResult?: {
    target1: { id: string; name: string };
    target2: { id: string; name: string };
    sameTeam?: boolean;
    unknown?: boolean;
  } | null;
  /** Với Linh Mục: cờ đánh dấu đã dùng bình Nước thánh chưa */
  priestHolyWaterUsed?: boolean;
  /** Với Linh Mục: kết quả dùng Nước thánh gần nhất */
  priestResult?: { target: { id: string; name: string }; isWolf: boolean } | null;
  /** Với Phù Thủy */
  healUsed?: boolean;
  poisonUsed?: boolean;
  /** Sói Con vừa chết vòng trước -> bầy Sói đêm nay được cắn 2 mục tiêu */
  wolfCubRageTonight?: boolean;
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

export interface PublicVoteChoiceChoice {
  type: "PLAYER";
  targetId: string;
}

export type PublicVoteChoice =
  | { type: "PLAYER"; targetId: string }
  | { type: "NO_ELIMINATION" };

export interface VoteMutation {
  id: string;
  round: number;
  voterId: string;
  previousChoice: PublicVoteChoice | null;
  choice: PublicVoteChoice;
  castAt: number;
  phaseStartedAt: number;
  phaseEndsAt: number;
  sequence: number;
}

export type NominationRecap =
  | { kind: "TRIAL"; accusedId: string }
  | { kind: "NONE"; reason: "no-elimination" | "tie" | "no-votes" };

export interface FinalJudgmentRecap {
  ballots: Array<{ voterId: string; guilty: boolean }>;
  guilty: number;
  innocent: number;
  abstain: number;
  lynched: boolean;
}

export interface DayVoteRecap {
  round: number;
  mutations: VoteMutation[];
  finalBallots: Array<{ voterId: string; choice: PublicVoteChoice }>;
  nomination: NominationRecap;
  finalJudgment: FinalJudgmentRecap | null;
}

/** Phiên toà đang diễn ra; chỉ có dữ liệu trong DEFENSE và FINAL_VOTE. */
export interface TrialView {
  accusedId: string;
  accusedName: string;
  /** Chỉ có nghĩa trong FINAL_VOTE. */
  guiltyVotes: number;
  innocentVotes: number;
  /** Số phiếu Treo tối thiểu để kết án, để UI khỏi tự tính lại ngưỡng. */
  guiltyRequired: number;
  /** Viewer còn sống, không phải bị cáo, và chưa bỏ phiếu. */
  canVote: boolean;
  hasVoted: boolean;
  /**
   * Lá phiếu của viewer. null nghĩa là CHƯA bỏ, không phải phiếu Tha - mọi chỗ
   * kiểm tra "đã bỏ phiếu chưa" phải đọc hasVoted chứ không dùng truthiness.
   */
  myVote: boolean | null;
  /** Chỉ đúng trong DEFENSE, và chỉ với bị cáo. */
  canSpeak: boolean;
}

/** Kết quả một phiên toà đã xử xong; cần để phân biệt "được tha" với "hoà phiếu". */
export interface TrialRecap {
  accused: RecapPlayer;
  guilty: number;
  innocent: number;
  abstain: number;
  lynched: boolean;
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
    /** Mục tiêu soi thứ 2 khi có sự kiện Màn Sương Tan; vắng mặt ở đêm thường. */
    secondaryTarget?: RecapPlayer;
    secondaryIsWolf?: boolean;
  }>;
  witch: {
    usedHeal: boolean;
    healedTarget: RecapPlayer | null;
    poisonTarget: RecapPlayer | null;
  };
  deaths: Array<{
    player: RecapPlayer;
    cause: "wolf" | "poison" | "priest" | "priest_backfire";
  }>;
  /**
   * Kẻ Nguyền Rủa đã bị nguyền và hoá Sói trong đêm này; null khi không có.
   * Không bắt buộc vì lịch sử đêm lưu từ trước khi có role này thiếu trường đó.
   */
  cursedTurned?: RecapPlayer | null;
  /**
   * Các trường dưới đây thuộc vai trò mở rộng (Thiên Thần Hộ Mệnh, Thám Tử,
   * Linh Mục, Sói Con), thêm sau bản gốc nên không bắt buộc - lịch sử đêm cũ
   * không có role này thì thiếu trường tương ứng.
   */
  guardianAngelTarget?: RecapPlayer | null;
  detectiveChecks?: Array<{
    detective: RecapPlayer;
    target1: RecapPlayer;
    target2: RecapPlayer;
    sameTeam: boolean;
  }>;
  priest?: {
    priest: RecapPlayer;
    target: RecapPlayer;
    isWolf: boolean;
  } | null;
  /** Mục tiêu cắn thứ 2 khi bầy Sói cắn kép (Sói Con phẫn nộ / event Cuộc Săn Đẫm Máu). */
  wolfSecondaryTarget?: RecapPlayer | null;
}

/** Snapshot toàn bộ trạng thái phòng + trận đấu dành cho MỘT người chơi cụ thể. */
export interface RoomSnapshot {
  code: string;
  hostId: string | null;
  phase: Phase;
  config: RoomConfig;
  round: number;
  /** Sự kiện đang hoạt động tại round / phase hiện tại */
  activeEvent?: GameEventView | null;
  /** Cờ đánh dấu Tiên Tri Tập Sự đã thức tỉnh */
  apprenticeAwakened?: boolean;
  /** epoch ms - client đếm ngược từ đây */
  phaseEndsAt: number | null;
  /**
   * epoch ms của SERVER lúc dựng snapshot này.
   *
   * phaseEndsAt cũng là giờ server, nên client trừ thẳng vào Date.now() của
   * máy mình là sai đúng bằng độ lệch đồng hồ máy đó. Trên điện thoại không bật
   * giờ tự động, lệch vài chục giây là chuyện thường. Có mốc này thì client tự
   * ước lượng được độ lệch thay vì tin đồng hồ máy.
   */
  serverNow: number;
  you: {
    id: string;
    name: string;
    ready: boolean;
    connected: boolean;
    avatarUrl?: string | null;
    role?: Role;
    alive: boolean;
    /** Chính viewer là Kẻ Nguyền Rủa đã hoá Sói. Không gửi cho ai khác. */
    cursedTurned?: boolean;
  } | null;
  players: PlayerView[];
  night: NightActionView | null;
  hunterShot: HunterShotView | null;
  /** Phiên toà đang diễn ra; chỉ có dữ liệu trong DEFENSE và FINAL_VOTE. */
  trial: TrialView | null;
  /** Phiên toà vừa xử xong; chỉ có dữ liệu ở ELIMINATION, CHECK_WIN, GAME_OVER. */
  lastTrial: TrialRecap | null;
  /**
   * Viewer đã gửi phiếu chưa. Cần cờ riêng vì myVote === null vừa có thể là
   * chưa vote, vừa có thể là đã chọn "Không treo ai".
   */
  hasVoted: boolean;
  /** id người viewer đã bỏ phiếu; null khi chưa vote hoặc chọn không treo ai */
  myVote: string | null;
  /** Số phiếu "Không treo ai"; tách khỏi PlayerView.voteCount */
  noEliminationVoteCount: number;
  /**
   * Ai đang bỏ phiếu cho ai, ngay trong lúc phiếu còn mở. Chỉ có dữ liệu ở pha
   * VOTING; từ DEFENSE trở đi vòng đã chốt và nằm trong dayVoteHistory.
   *
   * Vòng đề cử là vòng TRANH LUẬN, nên hành vi bỏ phiếu phải công khai đúng lúc
   * còn cãi được: ai châm ngòi, ai hùa theo, ai rút phiếu khi gió đổi. Vòng
   * phán quyết Treo/Tha thì ngược lại - nó nằm trong FinalJudgmentRecap và chỉ
   * lộ khi công bố, để không thành cuộc đua ai bấm sau cùng.
   *
   * Không bắt buộc vì web và server deploy rời nhau: client mới chạy với server
   * cũ thì trường này undefined, chỗ đọc phải chịu được điều đó.
   */
  openBallots?: Array<{ voterId: string; choice: PublicVoteChoice }>;
  /** Đồng thuận kết thúc thảo luận sớm; chỉ có trong DAY_DISCUSSION. */
  discussionSkip: DiscussionSkipView | null;
  votesRevealed: boolean;
  /** Lịch sử phiếu ban ngày đã chốt; không bao giờ chứa danh tính phiếu đang mở. */
  dayVoteHistory: DayVoteRecap[];
  /** Toàn bộ diễn biến đêm; chỉ có dữ liệu ở GAME_OVER. */
  nightHistory: NightRecap[];
  hunterShots: HunterShotRecap[];
  lastNightDeaths: { playerId: string; name: string }[];
  lastEliminated: { playerId: string; name: string } | null;
  winner: Winner;
  chatLog: ChatMessage[];
  log: string[];
  /** Cảnh báo cân bằng lobby; null khi chưa tính hoặc cân bằng. */
  balanceWarning?: BalanceWarningView | null;
  /** Claim Ngày Sự Thật: playerId -> role claim hoặc null là không tiết lộ */
  dayOfTruthClaims?: Record<string, string | null>;
  /** Tử Thủ: nạn nhân đang được hoãn chết tới hết ngày sau */
  pendingLastStandVictim?: { playerId: string; name: string } | null;
  /**
   * Lượt nói của Tiếng Vọng Người Chết, tính riêng cho người nhận snapshot này.
   *
   * CHỈ có `canAct`. Cố tình không mang `chosenId`: người xem đã biết mình có
   * phải linh hồn được chọn hay không qua chính cờ này, còn ai khác biết là
   * hỏng sự kiện. Optional vì web và server deploy rời nhau.
   */
  deadCanSpeak?: { canAct: boolean } | null;
  /**
   * Trạng thái voice cho riêng người nhận snapshot này.
   *
   * Optional vì web và server deploy rời nhau: client mới chạy với server cũ
   * phải không vỡ.
   */
  voice?: VoiceView;
}

export interface VoiceView {
  /**
   * Máy chủ CÓ cấu hình LiveKit. Độc lập với việc phòng đã bật hay chưa.
   *
   * Tách khỏi `enabled` vì công tắc trong phòng chờ cần đúng tín hiệu này: dùng
   * `enabled` sẽ thành vòng luẩn quẩn - công tắc chỉ hiện khi voice đã bật, mà
   * voice chỉ bật được bằng công tắc.
   */
  available: boolean;
  /** `available` VÀ phòng đã bật voice. */
  enabled: boolean;
  /**
   * Người này có được nói ở pha hiện tại không.
   *
   * Dùng cho ĐÚNG HAI việc: tắt mic tức thì khi bị thu quyền, và vẽ UI. KHÔNG
   * bao giờ dùng để mở mic - token không mang sẵn quyền nói, nên việc mở mic
   * phải đợi sự kiện đổi quyền từ chính LiveKit.
   */
  canPublish: boolean;
  roomName: string;
}

export interface ChatMessage {
  id: string;
  channel: string;
  playerId: string;
  playerName: string;
  text: string;
  at: number;
}

/**
 * Một ván đã kết thúc, đọc lại từ lịch sử.
 *
 * Ván đã xong nên không còn bí mật nào để lọc: toàn bộ vai được trả về đúng
 * như màn kết thúc đã hiện. Đây là lý do lịch sử KHÔNG đi qua `buildSnapshot`.
 */
export interface MatchHistoryPlayer {
  id?: string;
  name: string;
  role: Role;
  alive: boolean;
}

export interface MatchHistoryEntry {
  roomCode: string;
  winner: Winner | "unknown";
  rounds: number;
  durationSec: number;
  /** epoch ms */
  endedAt: number;
  /** Vai của chính người đang hỏi; null với ván cũ chưa lưu id người chơi. */
  myRole: Role | null;
  mySurvived: boolean | null;
  players: MatchHistoryPlayer[];
  /**
   * Hồ sơ vụ án chốt lúc ván kết thúc; null với ván ghi trước khi có cột này.
   *
   * Kiểu để lỏng ở `unknown` chứ không phải `CaseFile`: đây là JSON đọc từ DB,
   * do một phiên bản server nào đó ghi ra, nên tin nó đúng hình dạng hiện tại
   * là tự chuốc lấy lỗi lúc chạy. Phía dùng phải tự kiểm rồi mới ép kiểu.
   */
  caseFile: unknown;
}
