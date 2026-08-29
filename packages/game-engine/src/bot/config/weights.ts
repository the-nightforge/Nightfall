import type { PublicEvidenceKind } from "../types";

/**
 * Toàn bộ hằng số điều chỉnh của lõi BOT, ở đúng một chỗ.
 *
 * Trước Phase 3, ~70 con số này nằm rải rác trong 20 file, với ba bảng weight
 * song song không đồng bộ và ít nhất sáu magic number bị nhân bản. Hệ quả không
 * phải là code xấu - nó là việc **không cân bằng được**: muốn hạ win-rate của
 * Sói xuống 5% thì không ai trả lời được là sửa số nào, ở file nào, và sửa xong
 * có làm hỏng vai khác không.
 *
 * Ba quy tắc của module này:
 *
 * 1. **Đọc-chỉ và được inject.** Không singleton ghi được. Một biến module có
 *    thể ghi sẽ biến hai ván chạy song song trong cùng process thành một nguồn
 *    không tất định, và đó đúng là thứ Phase 1 đã bỏ công gỡ bỏ.
 * 2. **Không import gì ngoài `types.ts`.** Đây là lá của đồ thị phụ thuộc, nên
 *    mọi module quyết định đều nhận được nó mà không tạo vòng.
 * 3. **Đổi một giá trị là đổi `version`.** Một con số win-rate không truy được
 *    về cấu hình sinh ra nó là một con số vô dụng.
 */

export interface EvidenceWeight {
  /** Điểm suspicion cộng vào trước khi nhân confidence và inertia. */
  readonly weight: number;
  /** `0..1`. Vừa nhân vào delta, vừa là đầu vào của bonus tin cậy khi chấm phiếu. */
  readonly confidence: number;
}

/**
 * Sức nặng của bằng chứng công khai.
 *
 * Đây là bảng DUY NHẤT; `chat-analysis` và `BotRuntime` trước đây giữ bản sao
 * riêng của cùng những con số này, và ba bản sao đã trôi lệch khỏi nhau.
 */
export type EvidenceWeightTable = Readonly<Record<PublicEvidenceKind, EvidenceWeight>>;

/**
 * Đóng băng cả bảng lẫn từng ô.
 *
 * `Object.freeze` là NÔNG. Mọi nhóm khác trong `BotWeights` đều phẳng nên một
 * lần freeze là đủ, `evidence` là ngoại lệ duy nhất: freeze bảng chỉ chặn việc
 * thay cả ô, không chặn `table.ACCUSE.weight = 999`. Không có hàm này thì một
 * dòng ở bất kỳ đâu trong process cũng làm hỏng vĩnh viễn `DEFAULT_BOT_WEIGHTS`
 * - đúng kiểu hỏng mà quy tắc 1 ở đầu file tuyên bố đã loại trừ.
 */
function freezeEvidenceTable(table: Record<PublicEvidenceKind, EvidenceWeight>): EvidenceWeightTable {
  for (const entry of Object.values(table)) Object.freeze(entry);
  return Object.freeze(table);
}

/** Độ quan trọng của memory. Quyết định cái gì bị quên trước khi cắt ngân sách. */
export interface MemoryImportanceWeights {
  roleClaim: number;
  counterClaim: number;
  accuse: number;
  defend: number;
  /** Dùng cho memory chat không khớp loại nào ở trên. */
  fallback: number;
  playerDied: number;
  seerResult: number;
  allyLost: number;
  roundSummary: number;
  voteCast: number;
  voteChanged: number;
  lateVote: number;
  nominated: number;
  finalJudgment: number;
  /**
   * Thấp có chủ đích.
   *
   * Một lời gọi tên hay một câu hỏi không phải bằng chứng về vai của ai; nó chỉ
   * cần sống đủ lâu để BOT kịp trả lời. Đặt ngang `ACCUSE` sẽ khiến chúng chiếm
   * chỗ của những quan sát thật sự có nội dung khi ngân sách memory bị cắt.
   */
  directAddress: number;
  directQuestion: number;
}

/**
 * Thông tin riêng của vai.
 *
 * Dấu ÂM ở `seerClear` và `knownAlly` là bắt buộc, không phải quy ước tuỳ ý:
 * `applyTrustEvidence` đảo dấu weight trước khi cộng, nên một bằng chứng gỡ tội
 * phải mang weight âm thì mới làm TĂNG tin tưởng.
 */
export interface PrivateInfoWeights {
  seerWolf: number;
  seerClear: number;
  knownAlly: number;
}

export interface SuspicionWeights {
  /** Bằng chứng chắc chắn đáng giá hơn cùng một điểm nghi ngờ không có lý do. */
  evidenceConfidenceBonus: number;
  /** Bị nhiều người công kích là tín hiệu xã hội, không phải bằng chứng cứng. */
  hostilityBonus: number;
  /** Đóng góp tối đa của social graph khi một cặp trông như đang phối hợp. */
  pairBonus: number;
  /** Nhỏ có chủ đích: cô lập là gợi ý, không được tự mình đẩy ai qua ngưỡng. */
  isolationBonus: number;
  /** Người bướng bỉnh đổi ý chậm hơn: `base + stubbornness * span`. */
  inertiaBase: number;
  inertiaStubbornSpan: number;
  /** Inertia chỉ làm CHẬM update, không bao giờ đảo dấu: `1 - inertia * scale`. */
  inertiaScale: number;
}

export interface TrustWeights {
  /** Trust kéo ngược suspicion nhưng không bao giờ triệt tiêu được nó. */
  damping: number;
}

export interface VoteHistoryWeights {
  /** Đổi phiếu trong phần đuôi này của vòng được coi là muộn. */
  lateSwitchRatio: number;
  /** Một wagon phải có sẵn bấy nhiêu phiếu thì nhảy vào mới là "theo đuôi". */
  minBandwagonLead: number;
}

export interface SocialWeights {
  /** Một evidence nặng cỡ chừng này điểm là đủ kéo một cạnh từ 0 lên trần. */
  edgeStepDivisor: number;
  /** Chiết khấu Bayes cho số quan sát ít: `samples / (samples + prior)`. */
  priorStrength: number;
  alignmentMix: number;
  supportMix: number;
  hostilityMix: number;
  /** Dưới mức này thì hai người chỉ tình cờ trùng ý, không phải một phe. */
  minCohesion: number;
  /** "Ai muốn người đó chết": weight nhân với hostility của cạnh. */
  deathMotiveWeight: number;
  deathMotiveConfidence: number;
}

export interface RecencyWeights {
  /** Mỗi vòng, một niềm tin không được củng cố giữ lại bấy nhiêu sức nặng. */
  beliefDecayPerRound: number;
  /** Cùng ý tưởng nhưng cho importance của memory. */
  memoryDecayPerRound: number;
  /**
   * Evidence cũ hơn bấy nhiêu vòng bị coi là *stale* khi ĐO.
   *
   * Đây là ngưỡng của một METRIC, không phải một luật: dùng bằng chứng cũ không
   * sai, nhưng tỉ lệ cao nghĩa là decay không làm việc.
   */
  staleAfterRounds: number;
}

export interface SelfPreservationWeights {
  /** Trên mức thù địch này, Bảo Vệ coi chính mình là mục tiêu đêm nay. */
  guardSelfHostilityThreshold: number;
  guardSelfBonusBase: number;
  guardSelfBonusSpan: number;
  /** Đỡ người mình nghi là Sói thì vừa phí lượt vừa cứu nhầm phe. */
  guardSuspicionPenalty: number;
  /**
   * Phạt điểm khi đỡ lại một người đã từng đỡ.
   *
   * Bảo Vệ luôn chọn "người đáng tin nhất" sẽ đỡ đúng một người gần như mọi
   * đêm, và bầy Sói đọc được mẫu đó sau hai vòng. `0` để tắt.
   */
  guardRepeatPenalty: number;
}

export interface TeammateProtectionWeights {
  /** Bias ban ngày: Sói không bao giờ tự đề cử đồng bọn. */
  voteBiasPenalty: number;
  /** Phạt điểm khi chấm phiếu: `base + loyalty * loyaltySpan`. */
  penaltyBase: number;
  loyaltySpan: number;
}

export interface DeceptionRiskWeights {
  /**
   * Tỉ lệ phiếu đang dồn vào một đồng đội mà trên đó hy sinh nó RẺ HƠN bảo vệ.
   *
   * Đo bằng ÁP LỰC CÔNG KHAI (`currentVoteCounts`), không phải bằng nghi ngờ của
   * chính con Sói. Đó là chỗ bản đầu tiên sai: `applyPrivateInformation` ghim
   * suspicion của đồng đội về 0, nên một cổng dựa trên belief riêng KHÔNG BAO
   * GIỜ mở - hành vi tồn tại trên giấy và không lần nào chạy.
   *
   * Đặt `> 1` để tắt hoàn toàn.
   */
  bussingVoteShare: number;
  /** Sói có `deceptionSkill` cao mới dám bán đồng đội. */
  bussingDeceptionScale: number;
  /**
   * Điểm cộng khi nhảy lên chuyến xe đang lăn.
   *
   * Bỏ phạt bảo vệ đồng đội là CHƯA ĐỦ: đồng đội có suspicion bằng 0 trong mắt
   * chính con Sói (bị ghim), nên nếu chỉ gỡ phạt thì nó vẫn không bao giờ được
   * chọn. Hành vi thật của bussing là *bỏ phiếu cùng đa số*, nên nó cần một số
   * hạng DƯƠNG tỉ lệ với số phiếu đang dồn vào.
   */
  bussingJoinBonus: number;
  /**
   * Vòng sớm nhất mà Tiên Tri chịu đính kết quả soi vào lời nói.
   *
   * Soi trúng Sói ngay đêm đầu rồi hô lên ở vòng 1 là cách nhanh nhất để chết ở
   * đêm 2: bầy Sói biết ngay ai là Tiên Tri. Đặt `0` để tắt (luôn nói ngay).
   */
  seerRevealRound: number;
  /**
   * Ngưỡng vote hiệu dụng tăng thêm sau khi một Sói mất đồng đội.
   *
   * Mất đồng bọn thì đẩy phiếu lộ liễu là tự chỉ vào mình. `0` để tắt.
   */
  allyLostThresholdBonus: number;
  /**
   * Tỉ lệ người đã chết mà trên đó "không treo ai" trở thành nước thua.
   *
   * Ma Sói không có hoà: mỗi đêm làng mất một người, nên một ngày không treo ai
   * là một người mất trắng. Treo bừa có xác suất trúng Sói bằng
   * `số Sói / số còn sống`; không treo có xác suất bằng 0.
   */
  abstainPressureCeiling: number;
}

export interface AggressionWeights {
  /** Ngưỡng tối thiểu để dám đề cử: `base - aggressiveness*a - riskTolerance*r`. */
  thresholdBase: number;
  aggressivenessSpan: number;
  riskSpan: number;
}

export interface ConfidenceWeights {
  /** Khoảng cách tối thiểu để bỏ mục tiêu đang bầu: `base + stubbornness*span`. */
  hysteresisBase: number;
  hysteresisStubbornSpan: number;
  /** Phát bắn Thợ Săn phải chắc hơn một lá phiếu thường bấy nhiêu điểm. */
  hunterMargin: number;
  /** Biên tin tưởng cần có để THA một người cả làng vừa đưa ra xử. */
  spareTrustMargin: number;
  /** Biên độ nhiễu người-hoá, luôn từ RNG được inject: `±jitterSpan/2`. */
  jitterSpan: number;
}

export interface RoleThresholdWeights {
  witchHealTrust: number;
  witchPoisonSuspicion: number;
  /** Trên mức này thì dù nghi tới đâu cũng không độc. */
  witchPoisonTrustVeto: number;
  /** Nước thánh có phản đòn, nên ngưỡng cao hơn cả bình độc. */
  priestSuspicion: number;
  priestTrustVeto: number;
  /** Thiên Thần chỉ có hai lượt cả ván nên ngưỡng cao hơn Bảo Vệ. */
  guardianAngelWorthACharge: number;
  guardianAngelHostilityBonus: number;
  /**
   * Trường RIÊNG dù trùng giá trị với `selfPreservation.guardSuspicionPenalty`.
   *
   * Hai vai đỡ đòn theo hai kinh tế khác nhau: Bảo Vệ đỡ mỗi đêm, Thiên Thần
   * chỉ có hai lượt. Dùng chung một khoá sẽ khiến việc hiệu chỉnh Bảo Vệ ở
   * Task 8 lặng lẽ dịch cả Thiên Thần.
   */
  guardianAngelSuspicionPenalty: number;
  /** Giá trị thông tin cao nhất nằm ở giữa, không ở hai đầu. */
  seerMostInformativeSuspicion: number;
  seerUncertaintySlope: number;
  /** Sói: người tự nhận vai quyền lực phải chết trước, không cần tính gì thêm. */
  wolfClaimedPowerScore: number;
  wolfThreatBase: number;
  wolfTrustWeight: number;
  wolfHostilityWeight: number;
  /** Trừ suspicion: làng đang nghi sẵn thì để làng tự xử. */
  wolfSuspicionDiscount: number;
}

/** Confidence gắn vào intention. Là ĐẦU RA, không tham gia chấm điểm. */
export interface NightConfidenceWeights {
  seer: number;
  detective: number;
  guard: number;
  guardianAngel: number;
  witchHeal: number;
  witchPoison: number;
  witchSkip: number;
  priest: number;
  /** Confidence mặc định của một evidence do nước đi đêm sinh ra. */
  nightEvidence: number;
}

/** Mọi trait được rút i.i.d. từ `[min, max]`. */
export interface PersonalityRange {
  min: number;
  max: number;
}

/** Trần bộ nhớ. Không ảnh hưởng chất lượng chơi, nhưng ảnh hưởng chi phí. */
export interface MemoryLimits {
  beliefReasons: number;
  edgeReasons: number;
  /** Lịch sử phiếu và lịch sử phát ngôn giữ trong state. */
  history: number;
  pinned: number;
  memory: number;
  seenEvents: number;
  /** Số evidence tối đa mang theo một intention. */
  intentionEvidence: number;
  /**
   * Số nghi phạm đầu bảng ghi vào tóm tắt vòng.
   *
   * Trường riêng dù trùng giá trị với `intentionEvidence`: "bao nhiêu nghi phạm
   * vào bản tóm tắt" và "bao nhiêu bằng chứng đi kèm một nước đi" là hai câu
   * hỏi khác nhau, và gộp chúng khiến chỉnh cái này đổi luôn cái kia.
   */
  topSuspects: number;
}

/**
 * Hội thoại: bao nhiêu, bao lâu một lần, và khi nào thì im.
 *
 * Nhóm này KHÔNG chứa hằng số thời gian thật (mili giây). Server sở hữu timing;
 * đưa `minGapMs` vào đây sẽ kéo một khái niệm của đồng hồ vào một package tuyên
 * bố là thuần, và biến mọi test lõi thành test phụ thuộc lịch.
 */
export interface ConversationWeights {
  /** Số bản ghi phát ngôn giữ lại trong `BotBrainState`. */
  memoryWindow: number;
  /**
   * Cửa sổ chống lặp là KÉP: cả vòng lẫn số bản ghi.
   *
   * Chỉ theo vòng thì trong một vòng thảo luận dài BOT vẫn lặp được; chỉ theo
   * số bản ghi thì sang vòng mới vẫn còn bị khoá bởi chuyện đã cũ.
   */
  semanticCooldownRounds: number;
  semanticCooldownCount: number;
  /** Trần tin nhắn của MỘT bot trong MỘT vòng. */
  messagesPerBotPerRound: number;
  /** Trần tin nhắn BOT của cả phòng trong một vòng. */
  roomMessagesPerRound: number;
  /** Một câu chat kích hoạt được tối đa bấy nhiêu phản hồi. */
  maxRepliesPerMessage: number;
  /** Độ sâu chuỗi A→B→A tối đa. Chặn vòng lặp hai bot đáp qua đáp lại. */
  maxChainDepth: number;
  /** Sàn xác suất trả lời khi bị gọi tên hoặc bị hỏi thẳng. `[0,1]`. */
  directReplyFloor: number;
  /** Trần xác suất phản hồi. PHẢI < 1: không ai trả lời mọi câu. `[0,1]`. */
  replyCeiling: number;
  /** Câu cũ hơn bấy nhiêu vòng không còn đáng phản hồi. */
  triggerFreshnessRounds: number;
  /** Trust tối thiểu để coi một người là "người tôi tin" khi họ bị tố. */
  agreeTrustThreshold: number;
  /** Suspicion tối thiểu để coi một người là "người tôi nghi" khi họ được bênh. */
  disagreeSuspicionThreshold: number;
  /** Cơ hội pha trò khi không có gì đáng nói. `[0,1]`. */
  humorChance: number;
  /** Cơ hội buông một câu phản ứng ngắn. `[0,1]`. */
  reactionChance: number;
  /** Số dòng chat tối đa đưa vào prompt. */
  promptChatWindow: number;
  /** Số câu gần nhất của CHÍNH bot đưa vào prompt để nó không tự lặp. */
  promptRecentOwnLines: number;
  /** Số lượt thảo luận mỗi vòng trong self-play. */
  selfPlayTurnsPerRound: number;
}

export interface BotWeights {
  /** Semver. Đổi giá trị bất kỳ là phải đổi version. */
  readonly version: string;
  readonly evidence: EvidenceWeightTable;
  readonly memoryImportance: MemoryImportanceWeights;
  readonly privateInfo: PrivateInfoWeights;
  readonly suspicion: SuspicionWeights;
  readonly trust: TrustWeights;
  readonly voteHistory: VoteHistoryWeights;
  readonly social: SocialWeights;
  readonly recency: RecencyWeights;
  readonly selfPreservation: SelfPreservationWeights;
  readonly teammateProtection: TeammateProtectionWeights;
  readonly deceptionRisk: DeceptionRiskWeights;
  readonly aggression: AggressionWeights;
  readonly confidence: ConfidenceWeights;
  readonly roleThresholds: RoleThresholdWeights;
  readonly nightConfidence: NightConfidenceWeights;
  readonly personalityRange: PersonalityRange;
  readonly limits: MemoryLimits;
  readonly conversation: ConversationWeights;
}

/** Cho phép ghi đè từng nhánh mà không phải khai lại cả cây. */
export type BotWeightsOverride = {
  [K in keyof BotWeights]?: BotWeights[K] extends string
    ? BotWeights[K]
    : Partial<BotWeights[K]>;
};

/**
 * Trường phải nằm trong `[0, 1]`.
 *
 * Liệt kê tường minh chứ không đoán theo tên: một `0.5` hợp lệ ở chỗ này là một
 * lỗi ở chỗ khác, và đoán theo hậu tố sẽ bỏ sót đúng những chỗ nguy hiểm.
 */
const UNIT_INTERVAL_FIELDS: ReadonlyArray<[keyof BotWeights, string]> = [
  ["suspicion", "inertiaBase"],
  ["suspicion", "inertiaStubbornSpan"],
  ["suspicion", "inertiaScale"],
  ["trust", "damping"],
  ["voteHistory", "lateSwitchRatio"],
  ["social", "alignmentMix"],
  ["social", "supportMix"],
  ["social", "hostilityMix"],
  ["social", "minCohesion"],
  ["social", "deathMotiveConfidence"],
  ["recency", "beliefDecayPerRound"],
  ["recency", "memoryDecayPerRound"],
  ["selfPreservation", "guardSelfHostilityThreshold"],
  ["selfPreservation", "guardSuspicionPenalty"],
  ["deceptionRisk", "abstainPressureCeiling"],
  ["roleThresholds", "guardianAngelWorthACharge"],
  ["roleThresholds", "guardianAngelSuspicionPenalty"],
  ["personalityRange", "min"],
  ["personalityRange", "max"],
  // `nightConfidence` được gán THẲNG vào `BotNightIntention.confidence` mà không
  // qua clamp nào. Một giá trị 1.5 ở đây sinh ra một intention có xác suất > 1,
  // và invariant `NUMERIC_SANITY` sẽ bắt nó ở tận vòng mô phỏng thứ n.
  ["nightConfidence", "seer"],
  ["nightConfidence", "detective"],
  ["nightConfidence", "guard"],
  ["nightConfidence", "guardianAngel"],
  ["nightConfidence", "witchHeal"],
  ["nightConfidence", "witchPoison"],
  ["nightConfidence", "witchSkip"],
  ["nightConfidence", "priest"],
  ["nightConfidence", "nightEvidence"],
  // Bốn cái dưới đây được so THẲNG với `rng()`. Một giá trị 1.5 biến "đôi khi
  // trả lời" thành "luôn trả lời" mà không có lỗi nào để lần theo.
  ["conversation", "directReplyFloor"],
  ["conversation", "replyCeiling"],
  ["conversation", "humorChance"],
  ["conversation", "reactionChance"],
];

/** Nhóm mà mọi kiểm tra sâu bên dưới giả định là có mặt. */
const REQUIRED_GROUPS: ReadonlyArray<keyof BotWeights> = [
  "evidence",
  "memoryImportance",
  "privateInfo",
  "suspicion",
  "trust",
  "voteHistory",
  "social",
  "recency",
  "selfPreservation",
  "teammateProtection",
  "deceptionRisk",
  "aggression",
  "confidence",
  "roleThresholds",
  "nightConfidence",
  "personalityRange",
  "limits",
  "conversation",
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Từ chối một cấu hình hỏng NGAY TẠI ĐIỂM CẤU HÌNH.
 *
 * Một `NaN` lọt qua đây sẽ không nổ; nó sẽ lặng lẽ làm mọi phép so sánh trả về
 * `false`, và BOT sẽ bỏ lượt suốt ván mà không có lỗi nào. Chi phí phát hiện
 * muộn là hàng trăm ván mô phỏng vô nghĩa.
 */
export function validateWeights(weights: BotWeights): string[] {
  const problems: string[] = [];

  if (typeof weights.version !== "string" || weights.version.trim() === "") {
    problems.push("version phải là chuỗi không rỗng");
  }

  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") return;
    if (isFiniteNumber(value)) return;
    if (typeof value === "number") {
      problems.push(`${path} không phải số hữu hạn (${String(value)})`);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
      return;
    }
    problems.push(`${path} có kiểu không hợp lệ (${typeof value})`);
  };
  for (const [group, value] of Object.entries(weights)) walk(value, group);

  // Dừng sớm khi HÌNH DẠNG đã sai.
  //
  // Các kiểm tra dưới đây truy cập thẳng vào nhóm con, nên một nhóm thiếu sẽ
  // ném `TypeError` thay vì trả về danh sách vấn đề - và đầu vào có khả năng
  // thiếu nhóm nhất chính là một file JSON do CLI nạp, tức đúng lúc người dùng
  // cần một thông báo đọc được nhất.
  const missingGroup = REQUIRED_GROUPS.some(
    (group) => weights[group] === null || typeof weights[group] !== "object",
  );
  if (missingGroup) {
    for (const group of REQUIRED_GROUPS) {
      if (weights[group] === null || typeof weights[group] !== "object") {
        problems.push(`thiếu nhóm bắt buộc "${String(group)}"`);
      }
    }
    return problems;
  }

  for (const [group, field] of UNIT_INTERVAL_FIELDS) {
    const value = (weights[group] as Record<string, unknown>)[field];
    if (!isFiniteNumber(value)) continue;
    if (value < 0 || value > 1) {
      problems.push(`${String(group)}.${field} phải nằm trong [0, 1] (đang là ${value})`);
    }
  }

  if (weights.personalityRange.min > weights.personalityRange.max) {
    problems.push("personalityRange.min không được lớn hơn max");
  }
  for (const [kind, entry] of Object.entries(weights.evidence)) {
    if (!isFiniteNumber(entry?.confidence)) continue;
    if (entry.confidence < 0 || entry.confidence > 1) {
      problems.push(`evidence.${kind}.confidence phải nằm trong [0, 1]`);
    }
  }

  return problems;
}

/**
 * Merge một nhánh vào bản gốc và trả về một cây MỚI.
 *
 * Không mutate `base`: `DEFAULT_BOT_WEIGHTS` là hằng số dùng chung của cả
 * process, và một lần mutate ở đây sẽ rò cấu hình của ván này sang ván sau.
 */
export function resolveWeights(
  over: BotWeightsOverride = {},
  base: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotWeights {
  const merged = { ...base } as Record<string, unknown>;
  let changedValues = false;

  for (const [group, patch] of Object.entries(over)) {
    if (patch === undefined) continue;
    if (typeof patch === "string") {
      merged[group] = patch;
      continue;
    }
    changedValues = true;
    merged[group] = { ...(base[group as keyof BotWeights] as object), ...patch };
  }

  // Đánh dấu cấu hình đã bị chỉnh, trừ khi caller tự đặt version.
  //
  // Quy tắc 3 của module là "đổi một giá trị là đổi version", và §4.3 của spec
  // giải thích vì sao: một con số win-rate không truy được về cấu hình sinh ra
  // nó là một con số vô dụng. Không có dòng này, `resolveWeights({trust:{...}})`
  // trả về một cấu hình vẫn tự xưng "1.0.0", và report của Task 7 - vốn khoá
  // theo `version` - sẽ gán số liệu của một bản chỉnh tay cho v1.
  if (changedValues && over.version === undefined) {
    merged.version = `${base.version}+custom`;
  }

  return merged as unknown as BotWeights;
}

/**
 * Cấu hình v1: ĐÚNG BẰNG hành vi Phase 2.
 *
 * Mọi con số ở đây được chép nguyên từ chỗ nó từng sống, không làm tròn và
 * không "sửa cho đẹp". Đó là điều kiện để Task 1 là refactor thuần và để v1
 * dùng được làm mốc so sánh vĩnh viễn cho mọi lần hiệu chỉnh sau này.
 */
export const BOT_WEIGHTS_V1: BotWeights = Object.freeze({
  version: "1.0.0",

  evidence: freezeEvidenceTable({
    TIE_BREAK: { weight: 10, confidence: 0.7 },
    SAVE_VOTE: { weight: 9, confidence: 0.65 },
    LATE_SWITCH: { weight: 7, confidence: 0.6 },
    BANDWAGON: { weight: 4, confidence: 0.35 },
    VOTE_ALIGNMENT: { weight: 3, confidence: 0.4 },
    ROLE_CLAIM: { weight: 5, confidence: 0.5 },
    COUNTER_CLAIM: { weight: 6, confidence: 0.5 },
    ACCUSE: { weight: 4, confidence: 0.45 },
    DEFEND: { weight: 3, confidence: 0.4 },
  }),

  memoryImportance: Object.freeze({
    roleClaim: 8,
    counterClaim: 8,
    accuse: 4,
    defend: 3,
    fallback: 3,
    playerDied: 6,
    seerResult: 10,
    allyLost: 10,
    roundSummary: 9,
    voteCast: 4,
    voteChanged: 6,
    lateVote: 7,
    nominated: 7,
    finalJudgment: 6,
    directAddress: 2,
    directQuestion: 3,
  }),

  privateInfo: Object.freeze({ seerWolf: 400, seerClear: -120, knownAlly: -80 }),

  suspicion: Object.freeze({
    evidenceConfidenceBonus: 8,
    hostilityBonus: 6,
    pairBonus: 8,
    isolationBonus: 8,
    inertiaBase: 0.35,
    inertiaStubbornSpan: 0.45,
    inertiaScale: 0.5,
  }),

  trust: Object.freeze({ damping: 0.2 }),

  voteHistory: Object.freeze({ lateSwitchRatio: 0.8, minBandwagonLead: 2 }),

  social: Object.freeze({
    edgeStepDivisor: 20,
    priorStrength: 4,
    alignmentMix: 0.6,
    supportMix: 0.4,
    hostilityMix: 0.5,
    minCohesion: 0.15,
    deathMotiveWeight: 6,
    deathMotiveConfidence: 0.5,
  }),

  recency: Object.freeze({
    beliefDecayPerRound: 0.85,
    memoryDecayPerRound: 0.88,
    staleAfterRounds: 3,
  }),

  selfPreservation: Object.freeze({
    guardSelfHostilityThreshold: 0.5,
    guardSelfBonusBase: 60,
    guardSelfBonusSpan: 60,
    guardSuspicionPenalty: 0.5,
    // Tắt ở v1: Phase 2 không có hành vi này và v1 phải tái lập Phase 2 từng bit.
    guardRepeatPenalty: 0,
  }),

  teammateProtection: Object.freeze({
    voteBiasPenalty: -100,
    penaltyBase: 25,
    loyaltySpan: 30,
  }),

  deceptionRisk: Object.freeze({
    // Bốn giá trị dưới đây TẮT bốn hành vi mới của Phase 3. v1 phải tái lập
    // Phase 2 từng bit, nên chúng phải trung tính ở đây; v2 bật chúng lên.
    // `> 1` là cách tắt bussing mà không cần một cờ boolean riêng.
    bussingVoteShare: 2,
    bussingDeceptionScale: 0,
    bussingJoinBonus: 0,
    seerRevealRound: 0,
    allyLostThresholdBonus: 0,
    abstainPressureCeiling: 0.3,
  }),

  aggression: Object.freeze({
    thresholdBase: 58,
    aggressivenessSpan: 6,
    riskSpan: 4,
  }),

  confidence: Object.freeze({
    hysteresisBase: 5,
    hysteresisStubbornSpan: 8,
    hunterMargin: 20,
    spareTrustMargin: 15,
    jitterSpan: 6,
  }),

  roleThresholds: Object.freeze({
    witchHealTrust: 40,
    witchPoisonSuspicion: 85,
    witchPoisonTrustVeto: 50,
    priestSuspicion: 90,
    priestTrustVeto: 30,
    guardianAngelWorthACharge: 0.35,
    guardianAngelHostilityBonus: 80,
    guardianAngelSuspicionPenalty: 0.5,
    seerMostInformativeSuspicion: 50,
    seerUncertaintySlope: 2,
    wolfClaimedPowerScore: 100,
    wolfThreatBase: 40,
    wolfTrustWeight: 0.4,
    wolfHostilityWeight: 20,
    wolfSuspicionDiscount: 0.35,
  }),

  nightConfidence: Object.freeze({
    seer: 0.7,
    detective: 0.65,
    guard: 0.6,
    guardianAngel: 0.6,
    witchHeal: 0.8,
    witchPoison: 0.75,
    witchSkip: 0.5,
    priest: 0.8,
    nightEvidence: 0.5,
  }),

  personalityRange: Object.freeze({ min: 0.25, max: 0.9 }),

  limits: Object.freeze({
    beliefReasons: 12,
    edgeReasons: 8,
    history: 60,
    pinned: 60,
    memory: 120,
    seenEvents: 2_000,
    intentionEvidence: 3,
    topSuspects: 3,
  }),

  /**
   * TRUNG TÍNH: nhóm này có mặt vì `BotWeights` đòi nó, nhưng mọi giá trị ở đây
   * tái lập đúng hành vi Phase 3 — một tin mỗi bot mỗi ngày, không phản hồi ai,
   * một lượt thảo luận trong self-play.
   *
   * v1 là mốc so sánh vĩnh viễn. Một mốc đổi hành vi vì một phase sau đó không
   * còn là mốc.
   */
  conversation: Object.freeze({
    memoryWindow: 12,
    semanticCooldownRounds: 0,
    semanticCooldownCount: 0,
    messagesPerBotPerRound: 1,
    roomMessagesPerRound: 15,
    maxRepliesPerMessage: 0,
    maxChainDepth: 0,
    directReplyFloor: 0,
    replyCeiling: 0,
    triggerFreshnessRounds: 0,
    agreeTrustThreshold: 1,
    disagreeSuspicionThreshold: 1,
    humorChance: 0,
    reactionChance: 0,
    promptChatWindow: 20,
    promptRecentOwnLines: 4,
    selfPlayTurnsPerRound: 1,
  }),
}) as BotWeights;

/**
 * Cấu hình v2 — kết quả hiệu chỉnh từ 300 ván, kiểm chéo trên ba seed base.
 *
 * v1 để Sói thắng **87%**. Chẩn đoán bằng đo đạc chứ không bằng phỏng đoán, và
 * phát hiện gốc là: **thang belief mà mọi ngưỡng dựa vào không bao giờ được
 * chạm tới.** Suspicion thật có p50 = 0, p90 = 1.8, p99 = 8.6 - trong khi
 * `voteThreshold` là 58, bình độc 85, Nước thánh 90. Mọi ngưỡng đó là chữ chết.
 *
 * Bốn thay đổi, mỗi thay đổi có số đo riêng (xem `docs/bot-ai-phase-3-verification.md`):
 *
 * 1. **Ngưỡng khớp thang thật.** `thresholdBase` 58 → 6, `spareTrustMargin`
 *    15 → 3, `hysteresis` 5/8 → 2/3. Ngưỡng của quyền năng thì GIỮ CAO (95):
 *    chỉ mục tiêu Tiên Tri đã ghim 100 mới kích hoạt được bình độc và Nước
 *    thánh, nên chúng chỉ bắn vào Sói đã xác nhận.
 * 2. **Bussing hoạt động** (`bussingVoteShare`, `bussingJoinBonus`). Riêng nó
 *    đưa làng từ 10% lên 20%.
 * 3. **Sói không còn bỏ phiếu trắng** (`abstainPressureCeiling` 0.3 → 0). Đây
 *    là đòn bẩy lớn nhất: 27% → 48%.
 * 4. **Tín hiệu xã hội nặng hơn** (`hostilityBonus` 6 → 20) và
 *    `social.minCohesion` 0.15 → 0.02 để chỉ số coalition có dữ liệu.
 *
 * Kết quả: làng thắng 38.7% / 45.0% / 48.0% trên ba seed base độc lập, độ chính
 * xác phiếu 35% → 45–49%.
 */
export const BOT_WEIGHTS_V2: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V1,
  version: "2.0.0",

  suspicion: Object.freeze({
    ...BOT_WEIGHTS_V1.suspicion,
    // Bị cả làng công kích là tín hiệu mạnh hơn nhiều so với đánh giá của v1,
    // vì các bằng chứng hành vi khác gần như không phân biệt được Sói.
    hostilityBonus: 20,
  }),

  aggression: Object.freeze({
    // Ngưỡng phải nằm trong tầm với của thang belief thật, nếu không thì nhánh
    // "đủ căn cứ để đề cử" không bao giờ chạy và mọi lá phiếu chỉ là jitter.
    thresholdBase: 6,
    aggressivenessSpan: 2,
    riskSpan: 1,
  }),

  confidence: Object.freeze({
    ...BOT_WEIGHTS_V1.confidence,
    // Giữ CAO có chủ đích: chỉ mục tiêu Tiên Tri đã ghim 100 mới đáng một phát
    // bắn không ai kiểm lại được.
    hunterMargin: 80,
    spareTrustMargin: 3,
    hysteresisBase: 2,
    hysteresisStubbornSpan: 3,
  }),

  roleThresholds: Object.freeze({
    ...BOT_WEIGHTS_V1.roleThresholds,
    // 95 nghĩa là "chỉ Sói do Tiên Tri xác nhận". Hai bình dùng một lần cả ván
    // nên đây đúng là điều kiện để tiêu chúng.
    witchPoisonSuspicion: 95,
    priestSuspicion: 95,
  }),

  deceptionRisk: Object.freeze({
    bussingVoteShare: 0.2,
    bussingDeceptionScale: 3,
    bussingJoinBonus: 120,
    /**
     * `0` = Tiên Tri nói ngay.
     *
     * Trực giác nói nên giấu, và hành vi giấu ĐÃ được cài đặt và có test. Nhưng
     * số liệu bác bỏ nó: hoãn tới vòng 2 làm làng mất 4 điểm win-rate, tới vòng
     * 3 mất 9 điểm. Trong quần thể BOT này, thông tin của Tiên Tri lan quá chậm
     * để việc sống thêm một đêm bù lại được. Giữ cơ chế, tắt mặc định.
     */
    seerRevealRound: 0,
    allyLostThresholdBonus: 6,
    /**
     * `0` = Sói không bao giờ chọn "không treo ai".
     *
     * Đây là đòn bẩy đơn lẻ lớn nhất trong cả đợt hiệu chỉnh (27% → 48%), và lý
     * do cần nói thẳng: bỏ phiếu trắng là một nước MẠNH QUÁ MỨC ở đây, không
     * phải vì nó hay, mà vì đòn đối trọng tự nhiên của nó chưa được mô hình hoá.
     * Ngoài đời, kẻ luôn bỏ phiếu trắng sẽ bị để ý ngay; ở đây lõi belief không
     * sinh ra nghi ngờ nào từ hành vi né tránh, nên Sói tiêu được một ngày của
     * làng mà không trả giá gì.
     *
     * Bật lại khi có bằng chứng "né tránh" trong `vote-analysis`.
     */
    abstainPressureCeiling: 0,
  }),

  selfPreservation: Object.freeze({
    ...BOT_WEIGHTS_V1.selfPreservation,
    // Không đo được lợi ích về win-rate, nhưng cũng không tốn gì, và nó bịt một
    // mẫu hành vi mà người chơi thật đọc ra được sau hai vòng.
    guardRepeatPenalty: 20,
  }),

  social: Object.freeze({
    ...BOT_WEIGHTS_V1.social,
    // 0.15 là ngưỡng KHÔNG BAO GIỜ với tới: điểm ghép cặp thật tối đa ~0.03,
    // nên `detectCoalitions` chưa từng trả về một nhóm nào trong ván thật.
    minCohesion: 0.02,
  }),
}) as BotWeights;

/**
 * Cấu hình v3 — Phase 4 bật hội thoại.
 *
 * Khác v2 ở ĐÚNG một nhóm: `conversation`. Mọi nhóm còn lại dùng chung tham
 * chiếu với v2, nên hiệu chỉnh cân bằng của Phase 3 không thể trôi lệch qua
 * đây, và chênh lệch win-rate giữa v2 và v3 (nếu có) chỉ có đúng một nguyên
 * nhân khả dĩ: BOT nói nhiều hơn nên quan sát được nhiều hơn.
 *
 * Vì sao các con số ở đây:
 *
 * - `messagesPerBotPerRound: 3` — trần trên của khoảng 2–3 mà thiết kế yêu cầu.
 *   Cao hơn thì một bàn 8 bot đẩy ra 24 tin mỗi ngày, đọc không kịp.
 * - `replyCeiling: 0.9` < 1 có chủ đích. Một BOT trả lời 100% số câu nhắm vào
 *   nó là một tổng đài, không phải người chơi.
 * - `maxChainDepth: 3` — A tố B, B đáp, A đáp lại. Tới đó là đủ một nhịp tranh
 *   luận; tầng thứ tư luôn là hai bot lặp lại nhau.
 * - `semanticCooldown` kép 2 vòng / 6 bản ghi — xem chú thích ở `ConversationWeights`.
 * - `agreeTrustThreshold` và `disagreeSuspicionThreshold` đặt trên thang belief
 *   THẬT (p90 ≈ 1.8, xem `docs/bot-ai-phase-3-verification.md` §4), không phải
 *   thang 0–100 trên giấy. Đây đúng là lỗi đã giết v1.
 */
export const BOT_WEIGHTS_V3: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V2,
  version: "3.0.0",

  conversation: Object.freeze({
    memoryWindow: 12,
    semanticCooldownRounds: 2,
    semanticCooldownCount: 6,
    messagesPerBotPerRound: 3,
    roomMessagesPerRound: 18,
    maxRepliesPerMessage: 2,
    maxChainDepth: 3,
    directReplyFloor: 0.75,
    replyCeiling: 0.9,
    triggerFreshnessRounds: 1,
    agreeTrustThreshold: 2,
    disagreeSuspicionThreshold: 2,
    humorChance: 0.12,
    reactionChance: 0.18,
    promptChatWindow: 12,
    promptRecentOwnLines: 4,
    /**
     * Bốn lượt, không phải hai.
     *
     * Đây là con số của TẦNG ĐO, không phải của production: server có lịch
     * riêng. Nó phải đủ lớn để mô phỏng CHẠM TỚI các giới hạn mà nó có nhiệm vụ
     * kiểm. Với hai lượt, chuỗi đối đáp không bao giờ vượt độ sâu 1 - lượt 1 là
     * phát biểu, lượt 2 là trả lời, và không có lượt nào để trả lời một câu trả
     * lời. `maxChainDepth = 3` khi đó là một luật chưa từng chạy.
     *
     * Đo trên 120 ván mỗi mức:
     *
     * | lượt | đáp câu hỏi | có trả lời | chuỗi sâu nhất | tin/bot/ngày | im lặng |
     * | ---- | ----------- | ---------- | -------------- | ------------ | ------- |
     * | 2    | 38.1%       | 25.9%      | 1              | 1.38         | 31.9%   |
     * | 3    | 56.9%       | 36.5%      | 2              | 1.84         | 23.6%   |
     * | 4    | 66.3%       | 40.8%      | 3              | 2.15         | 21.5%   |
     *
     * Mức 4 là mức đầu tiên chạm trần `maxChainDepth`, và vẫn nằm trong mọi
     * ngưỡng chất lượng. Cao hơn nữa chỉ tốn thời gian batch.
     */
    selfPlayTurnsPerRound: 4,
  }),
}) as BotWeights;

/**
 * Cấu hình đang dùng cho production.
 *
 * Mọi API nhận `weights` đều mặc định về hằng số này, nên không call site nào
 * phải thay đổi chỉ vì cấu hình tồn tại.
 */
export const DEFAULT_BOT_WEIGHTS: BotWeights = BOT_WEIGHTS_V3;
