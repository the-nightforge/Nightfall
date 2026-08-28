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
  weight: number;
  /** `0..1`. Vừa nhân vào delta, vừa là đầu vào của bonus tin cậy khi chấm phiếu. */
  confidence: number;
}

/**
 * Sức nặng của bằng chứng công khai.
 *
 * Đây là bảng DUY NHẤT; `chat-analysis` và `BotRuntime` trước đây giữ bản sao
 * riêng của cùng những con số này, và ba bản sao đã trôi lệch khỏi nhau.
 */
export type EvidenceWeightTable = Record<PublicEvidenceKind, EvidenceWeight>;

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
   * Mức nghi ngờ mà trên đó hy sinh đồng đội RẺ HƠN bảo vệ nó.
   *
   * Bảo vệ một đồng đội mà cả làng đã chắc chắn là hành vi tự tố cáo: nó không
   * cứu được ai và làm lộ chính mình. Đặt `> MAX_BELIEF_SCORE` để tắt hoàn toàn.
   */
  bussingSuspicionFloor: number;
  /** Sói có `deceptionSkill` cao mới dám bán đồng đội. */
  bussingDeceptionScale: number;
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
  ["personalityRange", "min"],
  ["personalityRange", "max"],
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
  for (const [group, patch] of Object.entries(over)) {
    if (patch === undefined) continue;
    if (typeof patch === "string") {
      merged[group] = patch;
      continue;
    }
    merged[group] = { ...(base[group as keyof BotWeights] as object), ...patch };
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

  evidence: Object.freeze({
    TIE_BREAK: { weight: 10, confidence: 0.7 },
    SAVE_VOTE: { weight: 9, confidence: 0.65 },
    LATE_SWITCH: { weight: 7, confidence: 0.6 },
    BANDWAGON: { weight: 4, confidence: 0.35 },
    VOTE_ALIGNMENT: { weight: 3, confidence: 0.4 },
    ROLE_CLAIM: { weight: 5, confidence: 0.5 },
    COUNTER_CLAIM: { weight: 6, confidence: 0.5 },
    ACCUSE: { weight: 4, confidence: 0.45 },
    DEFEND: { weight: 3, confidence: 0.4 },
  }) as EvidenceWeightTable,

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
  }),

  teammateProtection: Object.freeze({
    voteBiasPenalty: -100,
    penaltyBase: 25,
    loyaltySpan: 30,
  }),

  deceptionRisk: Object.freeze({
    // > MAX_BELIEF_SCORE nên bussing TẮT ở v1: Phase 2 không có hành vi này, và
    // v1 phải tái lập Phase 2 từng bit. Task 6 bật nó ở v2.
    bussingSuspicionFloor: 101,
    bussingDeceptionScale: 0,
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
  }),
}) as BotWeights;

/**
 * Cấu hình đang dùng cho production.
 *
 * Trỏ tới v1 cho tới khi Task 8 có dữ liệu thật để hiệu chỉnh. Mọi API nhận
 * `weights` đều mặc định về hằng số này, nên không call site nào phải thay đổi
 * chỉ vì cấu hình tồn tại.
 */
export const DEFAULT_BOT_WEIGHTS: BotWeights = BOT_WEIGHTS_V1;
