import type { DayVoteRecap, Phase, PublicVoteChoice, Role } from "@masoi/shared";

export type BotRng = () => number;

export type BotMemoryType =
  | "VOTE_CAST"
  | "VOTE_CHANGED"
  | "LATE_VOTE"
  | "NOMINATED"
  | "FINAL_JUDGMENT"
  | "PLAYER_DIED"
  | "ROLE_CLAIM"
  | "COUNTER_CLAIM"
  | "ACCUSE"
  | "DEFEND"
  | "SEER_RESULT"
  | "BOT_SPOKE"
  /** Đồng đội Sói đã chết; buộc phải đổi cách chơi phần còn lại của ván. */
  | "ALLY_LOST"
  /** Tóm tắt một vòng, để bot còn nhớ chuyện gì đã xảy ra chứ không chỉ nhớ điểm số. */
  | "ROUND_SUMMARY";

/**
 * Bằng chứng rút ra từ hành vi CÔNG KHAI: lịch sử phiếu và lời nói.
 *
 * Mọi kind ở đây đều có thể sai - đó là suy đoán, và nó nguội đi theo thời gian.
 * Tách riêng khỏi thông tin do engine cấp để bảng weight của vote-analysis chỉ
 * phải khai báo đúng những gì nó thật sự sinh ra.
 */
export type PublicEvidenceKind =
  | "LATE_SWITCH"
  | "BANDWAGON"
  | "TIE_BREAK"
  | "SAVE_VOTE"
  | "VOTE_ALIGNMENT"
  | "ROLE_CLAIM"
  | "COUNTER_CLAIM"
  | "ACCUSE"
  | "DEFEND";

export type EvidenceKind =
  | PublicEvidenceKind
  /**
   * Thông tin riêng của vai, không phải suy đoán từ hành vi công khai.
   *
   * Tách thành kind riêng vì hai lý do: nó được miễn decay (sự thật không nguội
   * đi như ấn tượng), và nó cho phép test khẳng định rằng một niềm tin tuyệt
   * đối chỉ đến từ kết quả soi chứ không bao giờ từ chat hay lịch sử phiếu.
   */
  | "SEER_RESULT_WOLF"
  | "SEER_RESULT_CLEAR"
  /** Đồng đội do engine cấp (Sói thấy Sói), không phải claim ai đó tự nhận. */
  | "KNOWN_ALLY";

export interface BotEvidence {
  id: string;
  kind: EvidenceKind;
  sourceId: string;
  actorId: string;
  targetId?: string;
  weight: number;
  confidence: number;
  round: number;
  summary: string;
}

export interface BotVoteIntention {
  kind: "VOTE";
  choice: PublicVoteChoice;
  confidence: number;
  evidence: BotEvidence[];
}

/**
 * Một nước đi đêm đã chốt.
 *
 * `targetId` là `null` với HEAL (engine không nhận mục tiêu cho bình cứu) và
 * với SKIP. Không dùng `null` để nói "chưa quyết được" - trạng thái đó được
 * biểu diễn bằng chính `BotNightIntention | null` ở chỗ trả về.
 */
export interface BotNightIntention {
  kind: "NIGHT_ACTION";
  action: NightActionKind;
  targetId: string | null;
  /** Chỉ `DETECTIVE_CHECK` dùng (so hai người); các hành động khác để trống. */
  secondaryTargetId?: string | null;
  confidence: number;
  evidence: BotEvidence[];
}

export interface BotSpeechIntention {
  kind: "ACCUSE" | "QUESTION" | "WITHHOLD";
  targetId?: string;
  confidence: number;
  evidence: BotEvidence[];
}

export interface BotPersonality {
  aggressiveness: number;
  talkativeness: number;
  riskTolerance: number;
  deceptionSkill: number;
  analyticalSkill: number;
  loyalty: number;
  stubbornness: number;
}

export interface BeliefEntry {
  score: number;
  reasons: BotEvidence[];
  lastUpdatedRound: number;
}

export interface BotMemory {
  id: string;
  sourceId: string;
  round: number;
  phase: Phase;
  type: BotMemoryType;
  actorId: string;
  targetId?: string;
  importance: number;
  pinned: boolean;
  data: Record<string, unknown>;
}

export interface SocialEdge {
  support: number;
  hostility: number;
  voteAlignment: number;
  samples: number;
  reasons: BotEvidence[];
  /** Vòng cuối cạnh này được củng cố; đầu vào cho decay. */
  lastUpdatedRound: number;
}

/** Hành động đêm engine chấp nhận, đúng bằng union của `submitNightAction`. */
export type NightActionKind =
  | "KILL"
  | "SEE"
  | "GUARD"
  | "HEAL"
  | "POISON"
  | "SKIP"
  | "DETECTIVE_CHECK"
  | "GUARDIAN_PROTECT"
  | "HOLY_WATER";

/**
 * Thông tin ban đêm của ĐÚNG một vai.
 *
 * `null` ở `BotKnowledgeView.night` là trạng thái mặc định và là trạng thái an
 * toàn: ngoài pha đêm, khi bot đã chết, hoặc khi vai không có hành động đêm.
 * Dân Làng không bao giờ nhận object này - biết đêm nay ai đang được cân nhắc
 * đã là một rò rỉ, kể cả khi không kèm vai.
 *
 * Mọi trường ở đây do engine tính. Lõi BOT không được suy lại luật hợp lệ, vì
 * một bản sao luật ở tầng AI là thứ sẽ trôi lệch khỏi luật thật.
 */
export interface NightKnowledge {
  /** Còn lượt hành động đêm nay hay đã dùng rồi. */
  canAct: boolean;
  legalActions: NightActionKind[];
  /** Mục tiêu hợp lệ cho từng hành động được chào. */
  legalTargets: Record<NightActionKind, string[]>;
  /** Nạn nhân bầy Sói đã chốt. Chỉ Sói, và Phù Thuỷ sau khi khoá, được thấy. */
  wolfTarget: string | null;
  /** Chỉ Bảo Vệ thấy. */
  guardPrevious: string | null;
  /** Chỉ Phù Thuỷ thấy; false với mọi vai khác. */
  healUsed: boolean;
  poisonUsed: boolean;
  wolvesLocked: boolean;
}

/**
 * Một nhóm người chơi hành xử như một phe.
 *
 * Là TÍN HIỆU chấm điểm, không phải kết luận về vai: ba người dân cùng tin nhau
 * cũng tạo ra một coalition rất chặt. Vì vậy không chỗ nào được biến nó thành
 * `knownRoles`.
 */
export interface Coalition {
  /** Ít nhất hai người, sắp xếp ổn định để so sánh được. */
  memberIds: string[];
  /** Độ gắn kết trung bình trong nhóm, 0..1. */
  cohesion: number;
  /** Tổng số quan sát đứng sau nhóm này; ít mẫu thì đừng tin nhiều. */
  sampleCount: number;
}

export interface BotPlayerKnowledge {
  id: string;
  name: string;
  alive: boolean;
}

export interface BotKnowledgeView {
  botId: string;
  round: number;
  phase: Phase;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  selfRole: Role;
  players: BotPlayerKnowledge[];
  knownRoles: Record<string, Role>;
  seerResult: { targetId: string; targetName: string; isWolf: boolean } | null;
  /** `null` ngoài pha đêm, khi bot đã chết, hoặc khi vai không hành động đêm. */
  night: NightKnowledge | null;
  /**
   * Ai đang bị đưa ra xử. `null` ngoài `DEFENSE`/`FINAL_VOTE`.
   *
   * Cố tình là field PHẲNG chứ không phải object `trial`: `GameState.trial` chứa
   * `finalVotes`, tức ai đã bỏ phiếu Treo/Tha, và đó là bí mật khi phiên toà
   * còn mở. Một object cùng tên là lời mời để ai đó spread cả cụm vào view.
   */
  trialAccusedId: string | null;
  canFinalVote: boolean;
  /** `null` khi bot không phải Thợ Săn đang có lượt phản kích. */
  hunterShot: { canAct: boolean; legalTargets: string[] } | null;
  publicVoteHistory: DayVoteRecap[];
  currentVoteCounts: { players: Record<string, number>; noElimination: number };
  hasVoted: boolean;
  myVote: PublicVoteChoice | null;
  legalVoteChoices: PublicVoteChoice[];
  lastNightDeaths: Array<{ playerId: string; name: string }>;
}

export interface BotChatObservation {
  id: string;
  actorId: string;
  text: string;
  at: number;
}

export interface BotDecisionContext {
  knowledge: BotKnowledgeView;
  visibleChat: BotChatObservation[];
  /** Active event id currently affecting the game, if any - exposed for bot decision making */
  activeEventId?: string | null;
  /** Balance score 0..100 computed from lobby config and player count */
  balanceScore?: number | null;
  /** Pending LAST_STAND victim if any, carried across rounds */
  pendingLastStand?: { playerId: string; dieRound: number } | null;
}

export interface BotBrainState {
  playerId: string;
  personality: BotPersonality;
  suspicion: Record<string, BeliefEntry>;
  trust: Record<string, BeliefEntry>;
  knownInformation: { knownRoles: Record<string, Role>; seerResults: BotMemory[] };
  claims: BotMemory[];
  memories: BotMemory[];
  relationships: Record<string, SocialEdge>;
  currentTheory: { summary: string; evidenceIds: string[] } | null;
  currentTargets: string[];
  confidence: number;
  previousVotes: Array<{ round: number; choice: PublicVoteChoice }>;
  /**
   * Nước đi đêm BOT đã thật sự chọn.
   *
   * Không suy ra được từ `memories`: memory ghi những gì BOT quan sát được từ
   * bên ngoài, còn đây là những gì chính nó đã làm. Bảo Vệ cần nó để không đỡ
   * cùng một người mọi đêm - một mẫu mà bầy Sói đọc ra sau hai vòng.
   */
  previousNightActions: Array<{
    round: number;
    action: NightActionKind;
    targetId: string | null;
  }>;
  speechMemory: Array<{ sourceIds: string[]; round: number }>;
  seenEventIds: string[];
}
