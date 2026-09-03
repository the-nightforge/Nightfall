import type { Role, Team } from "../roles";
import type { Winner } from "../phases";

/**
 * Loại điểm ngoặt. Mỗi loại phải chứng minh được bằng một trường CÓ CẤU TRÚC
 * của snapshot - không có loại nào suy ra từ chuỗi log hay từ chữ trên giao diện.
 */
export type CaseHighlightType =
  | "INNOCENT_LYNCHED"
  | "WOLF_LYNCHED"
  /**
   * Một vai TRUNG LẬP bị treo. Đứng riêng vì nó không phải án oan (làng không
   * mất người của mình) mà cũng không phải "tóm đúng Sói" - nó là lúc kẻ trung
   * lập đạt đúng thứ nó đi tìm.
   */
  | "NEUTRAL_LYNCHED"
  | "HUNTER_MISFIRE"
  | "HUNTER_REVENGE"
  | "CURSED_TURNED"
  | "WOLF_ACQUITTED"
  | "WITCH_SAVE"
  | "PRIEST_BACKFIRE"
  | "BLOODBATH"
  | "WITCH_POISON"
  | "PRIEST_STRIKE"
  | "ANGEL_SAVE"
  | "GUARD_SAVE"
  | "LATE_VOTE_SWING"
  | "SEER_FOUND_WOLF"
  | "LONE_SURVIVOR"
  /** Đường lui khi ván không có điểm ngoặt nào đủ rõ. Không bao giờ đi kèm loại khác. */
  | "QUIET_MATCH";

/** Nguyên nhân chết đã gộp từ ba nguồn: đêm, treo cổ, và phát bắn Thợ Săn. */
export type CaseDeathCause =
  | "wolf"
  | "poison"
  | "priest"
  | "priest_backfire"
  | "lynch"
  | "hunter";

/**
 * Số liệu thô đã chứng minh một điểm ngoặt.
 *
 * Test khẳng định vào đây chứ không vào `description`: sửa câu chữ tiếng Việt
 * không được làm vỡ test logic, và ngược lại một con số sai không được trốn
 * thoát chỉ vì câu văn vẫn đọc xuôi.
 */
export type CaseEvidence =
  | { kind: "lynch"; accusedId: string; guilty: number; innocent: number; abstain: number }
  | { kind: "acquittal"; accusedId: string; guilty: number; innocent: number; abstain: number }
  | { kind: "hunter-shot"; hunterId: string; targetId: string; source: "night" | "vote" }
  | { kind: "cursed-turned"; playerId: string }
  | { kind: "witch-save"; savedId: string }
  | { kind: "witch-poison"; poisonedId: string }
  | { kind: "guard-save"; savedId: string }
  | { kind: "angel-save"; savedId: string }
  | { kind: "priest"; priestId: string; targetId: string; isWolf: boolean }
  | { kind: "bloodbath"; victimIds: string[] }
  | { kind: "seer-check"; seerId: string; targetId: string }
  | { kind: "vote-swing"; voterId: string; accusedId: string; castAt: number; windowEndsAt: number }
  | { kind: "lone-survivor"; playerId: string; team: Team }
  | { kind: "quiet-match"; rounds: number };

export interface CaseFilePlayer {
  id: string;
  name: string;
  /** Vai CUỐI ván. */
  role: Role;
  /**
   * Vai lúc chia bài. Chỉ khác `role` với Kẻ Nguyền Rủa đã hoá Sói - đó là phép
   * ghi đè vai DUY NHẤT trong engine, nên suy ngược lại được chính xác.
   */
  originRole: Role;
  /** Phe CUỐI ván, suy từ `role`. */
  team: Team;
  alive: boolean;
  isBot: boolean;
}

export interface CaseHighlight {
  type: CaseHighlightType;
  round: number;
  phase: "night" | "day";
  title: string;
  description: string;
  /**
   * playerId nội bộ, để giao diện tra ngược sang `cast`.
   *
   * KHÔNG bao giờ được đi vào nội dung chia sẻ: text và ảnh chỉ mang biệt danh.
   */
  participants: string[];
  importance: number;
  evidence: CaseEvidence;
}

/** Một cái chết hoặc một lần đổi phe, đã xếp theo đúng thứ tự xảy ra. */
export interface CaseTimelineEntry {
  round: number;
  phase: "night" | "day";
  kind: "death" | "cursed-turned";
  playerId: string;
  name: string;
  /** Chỉ có với `kind === "death"`. */
  cause?: CaseDeathCause;
}

/**
 * Hồ sơ vụ án của một ván đã kết thúc.
 *
 * Dựng bằng hàm thuần từ snapshot ở GAME_OVER. Cùng một ván luôn cho ra cùng
 * một hồ sơ - không đọc đồng hồ, không random.
 *
 * Cố ý KHÔNG mang `roomCode`: mã phòng chỉ là đầu vào của hash `caseId`, và một
 * mã phòng đã chết nằm trong nội dung chia sẻ là một lời mời gãy.
 */
/**
 * Một Phong thư sau cùng đã mở, lưu lại để xem lại sau trận.
 *
 * KHÔNG có `role`, đúng như `OpenedLastLetter` trên dây - hồ sơ vụ án đã có
 * `cast` mang đủ vai của mọi người, nên nhét vai vào đây chỉ tạo ra một đường
 * thứ hai để cùng một sự thật trôi lệch.
 *
 * Chỉ chứa thư ĐÃ MỞ: thư của người sống tới cuối ván không bao giờ đi vào đây.
 */
export interface CaseLastLetter {
  authorId: string;
  authorName: string;
  text: string;
  sealedRound: number;
  openedRound: number;
}

export interface CaseFile {
  /** Phiên bản schema, để hồ sơ ghi xuống DB sau này còn đọc lại được. */
  version: 1;
  /** Mã hồ sơ ổn định, sinh từ dữ liệu ván. Không phải mã phòng. */
  caseId: string;
  winner: Exclude<Winner, null>;
  rounds: number;
  cast: CaseFilePlayer[];
  /** 1-5 phần tử, đã xếp theo thứ tự thời gian. Đúng 1 khi `fallback`. */
  highlights: CaseHighlight[];
  timeline: CaseTimelineEntry[];
  /** Ván không có điểm ngoặt nào đủ rõ; giao diện đừng hứa "3 điểm ngoặt". */
  fallback: boolean;
  /**
   * Các Phong thư sau cùng đã mở trong ván, theo thứ tự mở.
   *
   * OPTIONAL và có thể vắng mặt hoàn toàn: add-on tắt, hoặc hồ sơ ghi trước khi
   * có tính năng này. Chỗ đọc phải chịu được `undefined` - `version` vẫn là 1 vì
   * mọi hồ sơ cũ vẫn đọc đúng, chỉ là không có mục này.
   */
  lastLetters?: CaseLastLetter[];
}
