import type { Phase, RoomConfig, Winner } from "./phases";
import type { Role, Team } from "./roles";
import type { GameEventId } from "./events";

/**
 * Điều kiện thắng CÁ NHÂN đã đạt được, tách hẳn khỏi `Winner`.
 *
 * Hai đại lượng khác nhau và phải ở hai trường khác nhau: `Winner` là phe
 * thắng chung và nó KẾT THÚC ván, còn một thắng lợi cá nhân chỉ được ghi nhận
 * rồi ván chạy tiếp. Nhét Thằng Hề vào `Winner` sẽ vừa cắt ngang ván vừa buộc
 * mọi chỗ đọc `winner` phải xử lý một giá trị không phải phe nào.
 *
 * Tập ĐÓNG, và cố ý không có "điều kiện chung của phe trung lập": vai trung lập
 * tiếp theo sẽ có luật thắng của riêng nó, không mặc định dùng lại luật này.
 */
export const PERSONAL_WIN_CONDITIONS = [
  "JESTER_LYNCHED",
  /**
   * Kẻ Báo Thù đã CÒN SỐNG vào đúng lúc mục tiêu của nó bị treo cổ.
   *
   * Một điều kiện RIÊNG chứ không dùng lại `JESTER_LYNCHED`: hai luật nói về
   * hai cái chết khác nhau (mình bị treo / người khác bị treo), và một điều
   * kiện dùng chung sẽ khiến bảng nhãn, lịch sử trận và mọi phép đếm gộp hai
   * thành tích trái ngược nhau làm một.
   */
  "EXECUTIONER_TARGET_LYNCHED",
] as const;
export type PersonalWinCondition = (typeof PERSONAL_WIN_CONDITIONS)[number];

/**
 * Điều kiện này có phải một điều kiện mà bản build HIỆN TẠI hiểu không.
 *
 * Cùng lý do với `isRole`: dữ liệu đọc lên từ cột Json của một ván cũ mang hình
 * dạng của bản build đã ghi nó, và tra một chuỗi lạ vào bảng nhãn sẽ ra
 * undefined ngay giữa lúc render lịch sử.
 */
export function isPersonalWinCondition(value: unknown): value is PersonalWinCondition {
  return (
    typeof value === "string" &&
    (PERSONAL_WIN_CONDITIONS as readonly string[]).includes(value)
  );
}

export const PERSONAL_WIN_LABELS: Record<PersonalWinCondition, string> = {
  JESTER_LYNCHED: "Thằng Hề - bị treo cổ",
  EXECUTIONER_TARGET_LYNCHED: "Kẻ Báo Thù - mục tiêu bị treo cổ",
};

/** Một thắng lợi cá nhân đã ghi nhận, đúng một lần cho mỗi người trong ván. */
export interface PersonalWin {
  playerId: string;
  name: string;
  role: Role;
  condition: PersonalWinCondition;
  /** Vòng mà điều kiện được thoả. */
  round: number;
}

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
  /**
   * Người này vốn là Kẻ Báo Thù và đã hoá Thằng Hề vì mục tiêu chết bởi một
   * nguồn khác. Chỉ đi kèm khi `role` được phép lộ hoàn toàn - trước
   * `GAME_OVER` không ai ngoài chính họ được biết chuyện đổi vai này.
   */
  executionerTurned?: boolean;
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
    /**
     * Phe đọc ra được của mục tiêu.
     *
     * Thêm cạnh `isWolf` chứ không thay nó: kỹ năng vốn chỉ trả lời "có phải
     * Sói không", và một vai TRUNG LẬP làm câu trả lời nhị phân đó nói dối -
     * "không phải Sói" bị đọc thành "người của làng". Trường này nói đúng thứ
     * Tiên Tri thấy: `neutral` là "Phe trung lập", không kèm vai cụ thể.
     *
     * Optional vì web và server deploy rời nhau: client mới chạy với server cũ
     * thì không có trường này và phải rơi về `isWolf`.
     */
    team?: Team;
    isWolf: boolean;
    secondaryTargetId?: string;
    secondaryTargetName?: string;
    secondaryTeam?: Team;
    secondaryIsWolf?: boolean;
  } | null;
  /** Với Tiên Tri Tập Sự: cờ đánh dấu đã thức tỉnh thừa kế kỹ năng soi */
  apprenticeAwakened?: boolean;
  /** Với Thám Tử: kết quả kiểm tra 2 mục tiêu */
  detectiveResult?: {
    target1: { id: string; name: string };
    target2: { id: string; name: string };
    sameTeam: boolean;
  } | null;
  /**
   * Với Bà Đồng: vai thật của người đã chết mà cô ta gọi hồn đêm nay.
   *
   * Mang thẳng `role` chứ không phải `team` như Tiên Tri: đây là điểm khác biệt
   * của lá bài. Đổi lại nó chỉ với tới người ĐÃ CHẾT, nên nó không chỉ ra được
   * mối nguy nào đang còn sống - nó kiểm chứng lời khai ngược.
   */
  mediumResult?: { target: { id: string; name: string }; role: Role } | null;
  /** Với Linh Mục: cờ đánh dấu đã dùng bình Nước thánh chưa */
  priestHolyWaterUsed?: boolean;
  /** Với Linh Mục: kết quả dùng Nước thánh gần nhất */
  priestResult?: { target: { id: string; name: string }; isWolf: boolean } | null;
  /**
   * Với Sát Nhân: mục tiêu đã chốt cho đêm nay, `null` là chưa chọn hoặc đã bỏ
   * qua. CHỈ đi vào snapshot của chính Sát Nhân - không ai khác được biết đêm
   * nay ai đang bị nhắm, kể cả nạn nhân.
   */
  serialKillerTarget?: string | null;
  /** Với Sát Nhân: đã chủ động bỏ qua đêm nay. */
  serialKillerSkipped?: boolean;
  /** Với Phù Thủy */
  healUsed?: boolean;
  poisonUsed?: boolean;
  /** Sói Con vừa chết vòng trước -> bầy Sói đêm nay được cắn 2 mục tiêu */
  wolfCubRageTonight?: boolean;
}

/**
 * Nhiệm vụ RIÊNG của Kẻ Báo Thù, tính cho đúng một người.
 *
 * Không bao giờ có mặt trong snapshot của ai khác, kể cả khán giả đã chết và
 * kể cả ở `GAME_OVER`: mục tiêu là một sự thật chỉ chủ nhân nó được biết trong
 * ván, và phần tổng kết sau ván đã có `personalWins` cùng `executionerTurned`
 * nói đủ mà không cần một đường thứ hai.
 *
 * KHÔNG mang vai của mục tiêu - Kẻ Báo Thù chỉ biết DANH TÍNH người đó, không
 * biết họ cầm lá gì.
 */
export interface ExecutionerView {
  /**
   * Người phải bị treo cổ. Đứng yên cả ván, kể cả khi họ đổi vai (Kẻ Nguyền
   * Rủa hoá Sói) hoặc đã chết.
   */
  target: { id: string; name: string; alive: boolean } | null;
  /** Điều kiện đã hoàn thành: mục tiêu bị treo trong lúc mình còn sống. */
  won: boolean;
  /**
   * Đã hoá Thằng Hề vì mục tiêu chết bởi một nguồn KHÔNG phải treo cổ.
   *
   * Khi cờ này bật, `you.role` đã là `JESTER` và luật của Hề áp dụng từ đó -
   * trường này chỉ để màn hình giải thích được VÌ SAO thẻ vai vừa đổi.
   */
  turnedJester: boolean;
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
    /** Phe đọc ra được; vắng mặt ở lịch sử đêm ghi trước khi có vai trung lập. */
    team?: Team;
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
    cause: "wolf" | "poison" | "priest" | "priest_backfire" | "serial_killer";
  }>;
  /**
   * Mục tiêu Sát Nhân đã ra tay đêm đó; `null` khi không có hoặc khi ván không
   * bật vai này. Trường RIÊNG chứ không gộp vào `wolfTarget`: hai đòn khác
   * nguồn, và gộp chúng sẽ khiến bản tường thuật kể một cú đâm thành một nhát
   * cắn. Vắng mặt ở lịch sử đêm ghi trước bản này.
   */
  serialKillerTarget?: RecapPlayer | null;
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
    /** Chính viewer là Kẻ Báo Thù đã hoá Thằng Hề. Không gửi cho ai khác. */
    executionerTurned?: boolean;
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
  /**
   * Thắng lợi CÁ NHÂN đã ghi nhận trong ván này.
   *
   * Lọc theo người nhận, đúng như mọi trường bí mật khác: trước `GAME_OVER`
   * người xem chỉ thấy mục của CHÍNH mình. Phát cả danh sách ra sớm sẽ lộ vai
   * của người vừa bị treo, trong khi luật của phòng là cái chết không tiết lộ
   * gì cho tới lúc lật bài.
   *
   * Optional vì web và server deploy rời nhau.
   */
  personalWins?: PersonalWin[];
  /**
   * Nhiệm vụ của Kẻ Báo Thù, đã tính riêng cho người nhận snapshot này.
   *
   * `null` với mọi người khác và với mọi ván không bật vai này. Optional vì web
   * và server deploy rời nhau.
   */
  executioner?: ExecutionerView | null;
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
   * Phong thư sau cùng, đã tính riêng cho người nhận snapshot này.
   *
   * `null` khi add-on tắt. Optional vì web và server deploy rời nhau.
   */
  lastLetter?: LastLetterView | null;
  /**
   * Trạng thái voice cho riêng người nhận snapshot này.
   *
   * Optional vì web và server deploy rời nhau: client mới chạy với server cũ
   * phải không vỡ.
   */
  voice?: VoiceView;
}

/**
 * Bản nháp thư của CHÍNH người nhận snapshot.
 *
 * `text` chỉ khác `null` trong snapshot của chủ nhân lá thư. Đây không phải một
 * quy ước hiển thị mà là hợp đồng ở dây: nếu draft đi xuống mọi trình duyệt rồi
 * mới lọc bằng React thì bất kỳ ai mở tab devtools cũng đọc được thư của cả
 * phòng, và tính năng này mất sạch ý nghĩa.
 */
export interface LastLetterDraftView {
  /** Nội dung nháp; `null` là chưa viết hoặc đã xoá. */
  text: string | null;
  /** Vòng lá thư được cập nhật lần cuối; `null` khi chưa có nháp. */
  updatedRound: number | null;
  /** Người xem có được sửa NGAY BÂY GIỜ không. Server tính, web không tự suy. */
  canEdit: boolean;
}

/**
 * Một lá thư ĐÃ MỞ. Từ lúc mở ra nó là dữ liệu công khai, ai cũng thấy như nhau.
 *
 * Cố ý KHÔNG có `role`: một lá thư mở ra giữa ván mà kèm vai người viết thì nó
 * không còn là lời nhắn, nó là một lần lật bài. Kiểu dữ liệu là chỗ chặn điều
 * đó, không phải một quy ước mà mỗi component phải nhớ.
 */
export interface OpenedLastLetter {
  /** Ổn định theo tác giả: mỗi người đúng một lá thư cả ván. */
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  /** Vòng bản cuối được niêm phong. */
  sealedRound: number;
  /** Vòng lá thư được mở, tức vòng tác giả chết. */
  openedRound: number;
  /** epoch ms lúc mở; dùng để xếp hàng đợi hiển thị theo đúng thứ tự. */
  openedAt: number;
}

export interface LastLetterView {
  /** Add-on đang bật cho phòng này. */
  enabled: boolean;
  /**
   * Thư của chính người xem. Snapshot của người khác luôn mang `text: null` -
   * không có trường nào ở đây tiết lộ AI đang có thư.
   */
  mine: LastLetterDraftView;
  /** Các lá thư đã mở, xếp theo thứ tự mở. Công khai cho mọi người xem. */
  opened: OpenedLastLetter[];
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
  /**
   * Thắng lợi cá nhân của người này trong ván đó; vắng mặt là không có.
   *
   * Chỉ mang điều kiện và vòng: id, tên và vai đã nằm ngay trên cùng object.
   * Optional vì ván ghi trước bản này không có trường đó - và đó chính là cách
   * lịch sử cũ vẫn đọc được.
   */
  personalWin?: { condition: PersonalWinCondition; round: number };
}

export interface MatchHistoryEntry {
  /**
   * Khoá của ván trong lịch sử. Là thứ DUY NHẤT để hỏi tiếp về ván đó - hôm nay
   * là log chat, `GET /players/me/matches/:id/chat`.
   *
   * OPTIONAL vì cùng lý do với `myPersonalWin` bên dưới: web và server deploy
   * RỜI NHAU, nên một client mới nói chuyện với server cũ nhận payload không có
   * trường này. Chỗ dùng phải kiểm trước khi gọi tiếp, chứ không được ghép một
   * URL có chữ `undefined` trong đó.
   */
  id?: string;
  roomCode: string;
  winner: Winner | "unknown";
  rounds: number;
  durationSec: number;
  /** epoch ms */
  endedAt: number;
  /** Vai của chính người đang hỏi; null với ván cũ chưa lưu id người chơi. */
  myRole: Role | null;
  mySurvived: boolean | null;
  /**
   * Thắng lợi cá nhân của chính người đang hỏi; `null` khi không có.
   *
   * Trường riêng chứ không bắt giao diện tự dò trong `players`: `players`
   * không mang id người xem, đúng như `myRole`/`mySurvived` đã phải tồn tại vì
   * lý do đó. Cũng `null` với ván cũ chưa lưu id người chơi.
   *
   * OPTIONAL, và đó là một sự thật về triển khai chứ không phải một chỗ nới
   * lỏng: web và server deploy RỜI NHAU, nên một client mới nói chuyện với
   * server cũ sẽ nhận payload KHÔNG CÓ trường này. Khai nó là `| null` thôi là
   * nói dối về hình dạng dữ liệu thật, và lời nói dối đó đã sinh ra đúng một
   * lỗi: `myPersonalWin !== null` đọc `undefined` thành "có thắng cá nhân", tức
   * một ván thua hiện ra là "Thắng" ở màn lịch sử.
   *
   * Mọi chỗ đọc phải so bằng `!= null` (bắt cả hai) hoặc đọc bản đã chuẩn hoá ở
   * biên - xem `fetchMatchHistory` bên web.
   */
  myPersonalWin?: { condition: PersonalWinCondition; round: number } | null;
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

/**
 * Một dòng chat đọc lại từ một ván đã kết thúc.
 *
 * Ván đã xong nên không còn kênh nào phải giấu: hang Sói và kênh người chết đều
 * trả về nguyên vẹn, đúng như `visibleChatLog` đã mở toàn bộ log ở GAME_OVER.
 * Phần gác cửa duy nhất là "người hỏi có mặt trong ván đó không".
 */
export interface MatchChatEntry {
  /** Thứ tự trong ván, đánh từ 0. Đã sắp sẵn khi trả về. */
  seq: number;
  /** `lobby` | `day` | `wolves` | `dead`. Để lỏng ở string: ván cũ do một bản
   * server nào đó ghi ra, và một kênh lạ không được làm hỏng cả trang. */
  channel: string;
  actorId: string;
  actorName: string;
  text: string;
  round: number;
  phase: string;
  /** epoch ms, mốc gõ thật. */
  at: number;
}
