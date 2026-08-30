import type { DayVoteRecap, GameEventId, Phase, PublicVoteChoice, Role } from "@masoi/shared";

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
  /**
   * Một câu nêu đích danh một người. Thuần CÚ PHÁP, không phải suy diễn.
   *
   * Không sinh bằng chứng và không đổi belief: gọi tên ai đó không nói lên
   * người đó là Sói. Nó chỉ là móc treo để BOT biết mình đang được nói tới.
   */
  | "DIRECT_ADDRESS"
  /** `DIRECT_ADDRESS` kèm dấu hỏi hoặc một từ để hỏi. Cũng không sinh bằng chứng. */
  | "DIRECT_QUESTION"
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

/**
 * Những gì một BOT có thể LÀM bằng lời.
 *
 * Ba loại đầu là của Phase 1–3 và giữ nguyên nghĩa. Chín loại còn lại tồn tại
 * vì một lý do duy nhất: `ACCUSE | QUESTION | WITHHOLD` không diễn đạt được
 * hành vi *trả lời một người*. Một BOT chỉ có ba loại đó buộc phải phát biểu
 * độc lập, và đó chính là triệu chứng mà Phase 4 phải chữa.
 *
 * Không BOT nào cần dùng đủ mười bốn loại trong một ván.
 */
export const BOT_SPEECH_KINDS = [
  "ACCUSE",
  "QUESTION",
  "WITHHOLD",
  "REPLY",
  "AGREE",
  "DISAGREE",
  "CHALLENGE",
  "DEFEND",
  "ASK_EVIDENCE",
  "CHANGE_MIND",
  "REACTION",
  "HUMOR",
  /**
   * Tự nhận vai. Hai kind này là ĐƯỜNG DUY NHẤT để một lời khai của BOT ra
   * khỏi lõi; không có đường nào khác, và cổng ở `speech-renderer` bảo đảm nhà
   * cung cấp không mở thêm được đường thứ hai.
   */
  "CLAIM_ROLE",
  "COUNTER_CLAIM",
] as const;

export type BotSpeechKind = (typeof BOT_SPEECH_KINDS)[number];

/**
 * Giọng của một câu. Tập ĐÓNG, không phải chuỗi tự do.
 *
 * Bảng mẫu câu và prompt đều khoá theo giá trị này; một tone tự do sẽ lặng lẽ
 * rơi về nhánh mặc định thay vì làm đỏ trình biên dịch.
 */
export const BOT_SPEECH_TONES = [
  "NEUTRAL",
  "FIRM",
  "SOFT",
  "PLAYFUL",
  "TENSE",
  "CURIOUS",
] as const;

export type BotSpeechTone = (typeof BOT_SPEECH_TONES)[number];

/** Trục nội dung. Tham gia vào vân tay ngữ nghĩa để phân biệt hai câu cùng loại. */
export const BOT_SPEECH_TOPICS = [
  "SUSPICION",
  "TRUST",
  "VOTE",
  "ROLE_CLAIM",
  "EVIDENCE",
  "PROCESS",
  "SMALLTALK",
] as const;

export type BotSpeechTopic = (typeof BOT_SPEECH_TOPICS)[number];

/** Ba loại này không nói điều gì kiểm chứng được, nên không được mang bằng chứng. */
const EVIDENCE_FREE_KINDS: ReadonlySet<BotSpeechKind> = new Set<BotSpeechKind>([
  "WITHHOLD",
  "REACTION",
  "HUMOR",
]);

export interface BotSpeechIntention {
  kind: BotSpeechKind;
  /** Người được nói TỚI hoặc nói VỀ. */
  targetId?: string;
  /** Câu chat cụ thể đang được phản hồi. */
  replyToMessageId?: string;
  /** Tác giả của câu đó. */
  replyToActorId?: string;
  topic?: BotSpeechTopic;
  /**
   * Vai được nói TO giữa phòng. Bắt buộc với `CLAIM_ROLE`/`COUNTER_CLAIM`, vô
   * nghĩa với mọi kind khác.
   *
   * KHÔNG phải vai thật: một con Sói khai láo mang `claimedRole: "SEER"`. Đây
   * cũng chính là lý do trường này an toàn để đưa vào prompt — nó là thứ sắp
   * được công bố, không phải thứ đang được giấu.
   */
  claimedRole?: Role;
  confidence: number;
  evidence: BotEvidence[];
  /**
   * Bắt buộc, không optional.
   *
   * Một trường optional ở đây tạo ra trạng thái thứ bảy - "không rõ giọng" - mà
   * mọi bảng mẫu câu phải xử lý riêng, và không ai nhớ xử lý.
   */
  tone: BotSpeechTone;
  /**
   * Giải thích nội bộ, cho trace và log.
   *
   * KHÔNG được gửi cho nhà cung cấp: nó có thể chứa lý do rút từ thông tin
   * riêng của vai (kết quả soi, danh sách đồng bọn).
   */
  reason?: string;
}

/** Đúng những gì một ý định được phép nhắc tới, đã lọc theo quyền của chính BOT. */
export interface SpeechScope {
  players: ReadonlyArray<{ id: string }>;
  chat: ReadonlyArray<{ id: string }>;
  seenSourceIds: readonly string[];
}

/**
 * Mọi ID và mọi bằng chứng trong một ý định phải tồn tại trong tầm nhìn của BOT.
 *
 * Trả về DANH SÁCH vấn đề chứ không ném: chỗ gọi ở tầng kiểm bất biến cần gom
 * hết vi phạm của một ván, còn chỗ gọi ở planner chỉ cần biết rỗng hay không.
 */
export function assertSpeechScope(
  intention: BotSpeechIntention,
  scope: SpeechScope,
): string[] {
  const problems: string[] = [];
  const knownPlayer = new Set(scope.players.map((player) => player.id));
  const knownMessage = new Set(scope.chat.map((message) => message.id));
  const knownSource = new Set(scope.seenSourceIds);

  if (intention.targetId !== undefined && !knownPlayer.has(intention.targetId)) {
    problems.push(`targetId không có trong knowledge: ${intention.targetId}`);
  }
  if (intention.replyToActorId !== undefined && !knownPlayer.has(intention.replyToActorId)) {
    problems.push(`replyToActorId không có trong knowledge: ${intention.replyToActorId}`);
  }
  if (intention.replyToMessageId !== undefined && !knownMessage.has(intention.replyToMessageId)) {
    problems.push(
      `replyToMessageId không có trong chat đã lọc: ${intention.replyToMessageId}`,
    );
  }
  if (EVIDENCE_FREE_KINDS.has(intention.kind) && intention.evidence.length > 0) {
    problems.push(`${intention.kind} không được mang bằng chứng`);
  }
  for (const item of intention.evidence) {
    if (!knownSource.has(item.sourceId)) {
      problems.push(`evidence.sourceId chưa từng được quan sát: ${item.sourceId}`);
    }
  }

  return problems;
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
  /**
   * Hành động được chọn THÊM một mục tiêu phụ đêm nay, hoặc `null`.
   *
   * Sinh ra từ những luật NGOÀI vai: Màn Sương Tan cho Tiên Tri soi hai người,
   * Cuộc Săn Đẫm Máu và Sói Con phẫn nộ cho bầy Sói cắn hai. Engine tính sẵn ở
   * đây vì strategy không được đọc `activeEvent` rồi tự dựng lại luật - đó là
   * bản sao luật thứ hai, và nó sẽ trôi lệch khỏi luật thật.
   *
   * KHÔNG bao gồm `DETECTIVE_CHECK`: Thám Tử luôn cần đúng hai người, đó là kỹ
   * năng gốc chứ không phải phần thưởng, nên nó không đọc trường này.
   */
  bonusSecondTargetFor: NightActionKind | null;
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
  /**
   * Sự kiện đang có hiệu lực, hoặc `null`.
   *
   * An toàn để lộ: `activeEvent` nằm trong `RoomSnapshot` công khai, cả phòng
   * đang nhìn cùng một banner. Đặt ở đây chứ không ở `BotDecisionContext` để
   * chỉ có MỘT đường - mọi thứ BOT biết đều đi qua bộ lọc của engine.
   */
  activeEventId: GameEventId | null;
  /**
   * Lời khai của Ngày Sự Thật, `playerId` -> vai, hoặc `null` là không tiết lộ.
   *
   * Công khai y như `activeEventId`: cả phòng nhìn cùng một bảng. Đi đường CẤU
   * TRÚC chứ không qua chat có chủ đích - claim vốn đã là dữ liệu có cấu trúc,
   * và đẩy nó qua parser tiếng Việt chỉ để đọc lại là tự thêm một tầng mất mát.
   *
   * Giữ lại sau khi sự kiện tắt: một lời khai hôm qua vẫn là bằng chứng hôm
   * nay, và engine chỉ xoá bảng khi một Ngày Sự Thật MỚI bắt đầu.
   */
  dayOfTruthClaims: Record<string, Role | null>;
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
  /**
   * Lịch sử phát ngôn CÓ CẤU TRÚC, cửa sổ giới hạn.
   *
   * Phase 3 lưu đúng `{ sourceIds, round }`. Hai hệ quả: `QUESTION` và
   * `WITHHOLD` không có bằng chứng nên được ghi thành danh sách rỗng - không
   * phân biệt được với nhau, nên BOT lặp lại chúng vô hạn; và không có gì để
   * đối chiếu khi muốn biết "câu này mình nói rồi chưa".
   *
   * Raw chat KHÔNG bao giờ vào đây. Chỉ vân tay và dữ liệu đã cấu trúc.
   */
  speechMemory: BotSpeechRecord[];
  /** Bộ đếm tất định thay cho `Date.now`; nguồn của `BotSpeechRecord.seq`. */
  speechSequence: number;
  /** Message đã phản hồi rồi, để không đáp hai lần cùng một câu. Có trần. */
  repliedMessageIds: string[];
  seenEventIds: string[];
}

/**
 * Một lần BOT mở miệng.
 *
 * `seq` là thứ tự tất định trong ván, KHÔNG phải thời gian thật: một mốc thời
 * gian ở đây sẽ làm replay lệch ngay lần chạy thứ hai.
 */
export interface BotSpeechRecord {
  seq: number;
  round: number;
  kind: BotSpeechKind;
  targetId: string | null;
  replyToMessageId: string | null;
  sourceIds: string[];
  topic: BotSpeechTopic | null;
  tone: BotSpeechTone;
  /** Vân tay của văn bản ĐÃ PHÁT; `null` khi lõi chưa biết câu chữ. */
  textFingerprint: string | null;
  /** Vân tay của Ý ĐỊNH; luôn có, kể cả khi chưa render. */
  semanticFingerprint: string;
  /** Ba token mở đầu đã chuẩn hoá; `null` khi chưa render. */
  opening: string | null;
}
