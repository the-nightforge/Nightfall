import type { DayVoteRecap, GameEventId, Phase, PublicVoteChoice, Role, Team } from "@masoi/shared";

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
  | "ROUND_SUMMARY"
  /**
   * Một người né tránh suốt nhiều vòng: chỉ phiếu trắng hoặc phiếu lẻ, hoặc
   * không ai đụng tới dù vẫn có mặt. Ghi lại để bot nhắc được "anh im suốt
   * ba vòng rồi" chứ không chỉ cộng điểm. Xem `analyzeAvoidance`.
   */
  | "AVOIDANCE"
  /** Lượt bào chữa của một bị cáo bị chấm là kém. Xem `analyzeDefense`. */
  | "DEFENSE_QUALITY";

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
  | "DEFEND"
  /**
   * Phán đoán đã được KIỂM CHỨNG: một lá phiếu Treo/Tha đọc ngược lại sau khi
   * vai của người bị treo lộ ra. Xem `analysis/verdict-review.ts`.
   *
   * Vẫn là bằng chứng CÔNG KHAI - ai bỏ phiếu gì nằm trong recap, và vai người
   * chết chỉ lộ khi biến thể luật `revealRoleOnDeath` bật. Vì vậy nó decay như
   * mọi tín hiệu hành vi khác chứ không được miễn như thông tin riêng của vai.
   */
  | "VERDICT_HIT"
  | "VERDICT_MISS"
  /**
   * Hai tín hiệu hành vi mà người chơi thật đọc ra nhau, còn bot thì không:
   * né tránh suốt nhiều vòng, và bào chữa kém khi bị đưa ra xử. Cả hai đều
   * là suy đoán từ dữ liệu công khai và decay như mọi tín hiệu hành vi khác.
   */
  | "AVOIDANCE"
  | "DEFENSE_QUALITY";

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
  /**
   * BOT có bằng chứng RIÊNG rằng một lời khai là dối: người còn sống đang nhận
   * một vai mà bot biết chắc thuộc về người khác.
   *
   * Hai nguồn, cùng một loại suy luận - Bà Đồng đọc vai thật của một cái xác,
   * và Tiên Tri Tập Sự được chỉ mặt Tiên Tri từ đêm 1. Cùng hạng với kết quả
   * soi vì gốc đều là sự thật do engine cấp, nhưng nhẹ hơn hẳn: xem
   * `privateInfo.provenFalseClaim`.
   */
  | "PROVEN_FALSE_CLAIM"
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

/**
 * Hồ sơ TRONG VÁN về một người chơi. Xem `belief/player-profile.ts`.
 *
 * Khác `BeliefEntry` ở chỗ nó nói về NGƯỜI chứ không về sự kiện: "người này
 * hay khai láo" chứ không phải "người này đã khai láo ở vòng 2". Nguội chậm
 * hơn belief (`recency.profileDecayPerRound`).
 */
export interface PlayerProfile {
  /** Tỉ lệ lời khai vai đã bị KIỂM CHỨNG là sai. Trung tính 0. */
  bluffRate: number;
  /** Tỉ lệ vòng có công khai buộc tội ai đó. Trung tính 0. */
  aggroRate: number;
  /** Tỉ lệ phiếu Treo/Tha đã kiểm chứng là đúng. Trung tính 0.5. */
  accuracy: number;
  /** Số quan sát (đã nguội). Sức nặng của hồ sơ là `profileStrength`. */
  samples: number;
  /** Mốc để decay không nhân đôi khi gọi hai lần một vòng. */
  lastUpdatedRound: number;
}

/**
 * Sức nặng của một hồ sơ, `0..1`: `samples / (samples + prior)`.
 *
 * Ở đây - chứ không ở `player-profile.ts` - vì `claim-credibility` cũng cần
 * nó mà module đó bị khoá danh sách import (xem test CLAIM_BLINDNESS).
 */
export function profileStrength(profile: PlayerProfile, prior: number): number {
  if (profile.samples <= 0) return 0;
  return profile.samples / (profile.samples + Math.max(0, prior));
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
  | "HOLY_WATER"
  | "SERIAL_KILL"
  | "MEDIUM_CHECK";

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
  /**
   * Ghế này là BOT hay người thật. Engine cấp, lõi không đoán.
   *
   * CÔNG KHAI: `PlayerView.isBot` đi xuống mọi client trong `RoomSnapshot`,
   * cả phòng nhìn thấy ai là bot từ sảnh chờ. Lõi cần nó vì cùng một nước đi
   * có giá khác nhau trước hai loại khán giả: Tiên Tri hô kết quả ngày 1 là
   * đúng trong bàn toàn bot (bầy Sói bot không đọc chat để cắn) và là tự xin
   * chết đêm 2 trước người thật.
   *
   * Optional vì `BotKnowledgeView` được dựng lại từ record self-play cũ và từ
   * fixture test; thiếu cờ thì coi là bot - xem `countHumansAlive`.
   */
  isBot?: boolean;
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
  /**
   * Biến thể luật `revealRoleOnDeath` (xem `RoomConfig`) có đang bật không.
   *
   * Là LUẬT PHÒNG, tức thông tin công khai với cả bàn - không phải một thứ
   * engine lọc theo vai. Lõi cần nó vì `knownRoles` không nói được vì sao một
   * vai lọt vào bảng: một con Sói vẫn nhớ vai của đồng bọn đã bị treo kể cả khi
   * cờ tắt, và thứ đó là thông tin RIÊNG. `verdict-review.ts` chỉ được phép
   * chạy trên thông tin cả bàn cùng thấy, nên cờ này là cổng duy nhất đúng.
   *
   * Optional vì mọi phòng thật chạy với nó tắt; đường vào duy nhất là harness
   * self-play.
   */
  revealRoleOnDeath?: boolean;
  /**
   * Kết quả soi gần nhất. `team` là câu trả lời đầy đủ, `isWolf` là hệ quả của
   * nó - lõi phải đọc `team` khi cần phân biệt "phe làng" với "phe trung lập",
   * vì `isWolf === false` chỉ nói được "không phải Sói".
   */
  seerResult: { targetId: string; targetName: string; isWolf: boolean; team: Team } | null;
  /**
   * Vai THẬT của người đã khuất mà Bà Đồng gọi hồn đêm qua.
   *
   * Mang `role` chứ không phải `team` như `seerResult`: đó là cả điểm khác biệt
   * của lá bài. Đổi lại nó nói về một cái xác, nên tự nó không chỉ ra mối nguy
   * nào đang sống - giá trị nằm ở chỗ đối chiếu ngược với lời khai của người
   * còn sống, xem `applyPrivateInformation`.
   */
  mediumResult: { targetId: string; targetName: string; role: Role } | null;
  /**
   * Vai TRUNG LẬP có trong bộ bài của ván này.
   *
   * CÔNG KHAI, không phải một rò rỉ: cấu hình phòng đi xuống mọi client trong
   * `RoomSnapshot.config`, và cả phòng đọc được bộ bài ở sảnh chờ trước khi ván
   * bắt đầu. Nó nói vai nào CÓ THỂ có mặt, không nói ai đang cầm lá nào.
   *
   * Cần thiết vì `neutral` một mình không còn đủ để kết luận: cùng một nhãn ấy,
   * ván có Thằng Hề nghĩa là "vô hại với làng" còn ván có Sát Nhân nghĩa là
   * "ứng viên số một cho kẻ đang giết người mỗi đêm". Không có trường này, lõi
   * chỉ có một câu trả lời cho hai câu hỏi khác nhau - và nó sẽ chọn câu trả
   * lời nguy hiểm hơn.
   */
  neutralRolesInPlay: Role[];
  /**
   * Mục tiêu của CHÍNH bot này, khi nó là Kẻ Báo Thù. `null` với mọi vai khác.
   *
   * Đây là thông tin RIÊNG đúng nghĩa - engine cấp nó, không suy ra được từ
   * bất cứ thứ gì công khai - nên nó đi thẳng vào view như `seerResult`, và
   * cũng như `seerResult` thì nó chỉ nói về một người.
   *
   * Nó nói người kia là MỤC TIÊU NHIỆM VỤ, và KHÔNG nói gì về vai của họ. Lõi
   * tuyệt đối không được biến nó thành bằng chứng "người này là Sói": mục tiêu
   * luôn thuộc phe Dân, nên một suy luận như vậy vừa sai vừa tự đầu độc lớp sự
   * thật mà mọi quyết định khác dựa vào. Nó chỉ được phép nghiêng LÁ PHIẾU.
   *
   * Cờ này vẫn khác `null` sau khi bot đã hoá Thằng Hề. Chiến thuật đọc `role`
   * (đã là `JESTER`) để rẽ nhánh, không đọc trường này - xem `roles/registry`.
   *
   * Optional vì `BotKnowledgeView` được dựng lại từ record self-play cũ.
   */
  executionerTargetId?: string | null;
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
  /**
   * Cửa sổ thời gian của lượt bào chữa trong vòng này, hoặc `null`.
   *
   * `endedAt` là `null` khi lượt bào chữa còn mở (pha DEFENSE) và là mốc khép
   * khi đã sang FINAL_VOTE. Lõi cần nó vì các bot KHÔNG quan sát trong pha
   * DEFENSE (chỉ bị cáo mới được đánh thức), nên lúc chấm lời bào chữa ở
   * FINAL_VOTE chúng phải biết câu nào của bị cáo nằm trong lượt đó. Công
   * khai như `trialAccusedId`: cả phòng cùng nhìn đồng hồ đó.
   *
   * Optional vì `BotKnowledgeView` được dựng lại từ record self-play cũ, và
   * harness self-play không chạy pha DEFENSE nên không có gì để điền.
   */
  trialDefense?: { startedAt: number; endedAt: number | null } | null;
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
  /**
   * Hồ sơ trong ván về từng người khác. Xem `PlayerProfile`.
   *
   * Khởi tạo trung tính cho cả roster; cập nhật tất định từ những gì bot đã
   * thấy (phán quyết đã lộ vai, lời khai bị kiểm chứng, buộc tội mỗi vòng).
   */
  profiles: Record<string, PlayerProfile>;
  /**
   * Vai chính BOT này đã công khai nhận, hoặc `null`.
   *
   * Một BOT khai đúng MỘT vai cả ván. Lật claim không bị cấm bằng kiểu — nó bị
   * tính giá ở `claim-credibility` — nhưng lõi thì không bao giờ tự lật, vì
   * một người chơi đổi lời khai giữa ván là đang tự thua.
   *
   * Tách khỏi `claims` (kho lời khai của NGƯỜI KHÁC) vì hai câu hỏi khác nhau:
   * "ai đã khai gì" và "tôi đã cam kết điều gì".
   */
  myClaim: { role: Role; round: number } | null;
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
  /**
   * ID bằng chứng lời khai đã áp vào belief rồi, để không áp lại. Có trần,
   * cùng hình dạng với `repliedMessageIds`.
   *
   * `observe()` chạy nhiều lần một vòng (vào đêm, vào ngày, mỗi lượt bỏ phiếu,
   * mỗi lượt thảo luận), và `claimEvidence` tính lại TOÀN BỘ `state.claims`
   * mỗi lần được gọi - nó là hàm thuần, không tự nhớ đã phát cái gì. Không có
   * trường này, cùng một mảnh bằng chứng bị cộng dồn vào belief mỗi lần
   * `observe()` chạy, bão hoà thang suspicion/trust chỉ trong một vòng.
   */
  appliedClaimEvidenceIds: string[];
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
