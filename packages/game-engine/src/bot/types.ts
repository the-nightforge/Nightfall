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
  | "BOT_SPOKE";

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
export type NightActionKind = "KILL" | "SEE" | "GUARD" | "HEAL" | "POISON" | "SKIP";

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
  speechMemory: Array<{ sourceIds: string[]; round: number }>;
  seenEventIds: string[];
}
