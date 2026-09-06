import type { BotSpeechStyle } from "../personality/speech-style";
import type {
  BotDecisionContext,
  BotEvidence,
  BotRng,
  BotSpeechIntention,
} from "../types";

/**
 * Trần lượt nói DEFENSE của mỗi bot trong một phiên xử.
 *
 * Cùng con số mà Global Constraints của plan DEFENSE chốt: tối đa 2 lượt,
 * 0 cũng hợp lệ (bot chưa đủ tin thì im, xem `shouldSpeakInDefense`).
 */
export const DEFENSE_MAX_SPEECHES_PER_BOT = 2;

/**
 * Ngưỡng tin tối thiểu để một bot phi-bị-cáo lên tiếng trong DEFENSE.
 *
 * `decideFinalVote` trả `confidence = |trust - suspicion| / MAX_BELIEF_SCORE`,
 * nên 0 nghĩa là bot không có căn cứ nào về bị cáo (belief rỗng/trung tính).
 * Chỉ đúng trường hợp đó mới im: mọi tín hiệu dương dù yếu đều được nói.
 * Bị cáo không đi qua cổng này (luôn được tự bào chữa).
 */
export const DEFENSE_SPEAK_MIN_CONFIDENCE = 0;

/** `true` khi bot phi-bị-cáo đủ tin để lên tiếng về bị cáo. */
export function shouldSpeakInDefense(
  confidence: number,
  threshold: number = DEFENSE_SPEAK_MIN_CONFIDENCE,
): boolean {
  return confidence > threshold;
}

/**
 * Xếp lượt nói DEFENSE cho mọi người sống.
 *
 * Thuần và tất định theo `rng`: xáo trộn danh sách sống (Fisher-Yates) rồi
 * rải đều `maxPerBot` vòng. Bị cáo luôn có suất (nằm trong `aliveIds`) nhưng
 * KHÔNG nhất thiết đầu tiên; mỗi id xuất hiện tối đa `maxPerBot` lần.
 *
 * Dùng chung cho phòng thật (`apps/server` `scheduleDefenseBot`) và harness
 * đo (`runDefenseDiscussion` trong selfplay): cùng seed cho cùng thứ tự.
 */
export function planDefenseSpeakers(
  aliveIds: string[],
  accusedId: string,
  rng: BotRng,
  maxPerBot: number = DEFENSE_MAX_SPEECHES_PER_BOT,
): string[] {
  const pool = aliveIds.includes(accusedId) ? [...aliveIds] : [...aliveIds, accusedId];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const swap = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = swap;
  }
  const slots: string[] = [];
  for (let turn = 0; turn < maxPerBot; turn += 1) {
    for (const id of pool) slots.push(id);
  }
  return slots;
}

/**
 * Lời bàn của bot phi-bị-cáo về bị cáo, dựng từ phán quyết Treo/Tha sẵn có.
 *
 * Không phải một thái độ mới: `guilty`/`confidence`/`evidence` lấy nguyên từ
 * `decideFinalVote` (tức từ belief suspicion/trust của chính bot đó), nên Sói
 * bênh đồng bọn (Tha) / ép dân (Treo) đúng như lá phiếu nó sắp bỏ, còn bot
 * trung tính (confidence 0) đã bị `shouldSpeakInDefense` chặn từ trước.
 *
 * Vai Hề KHÔNG đi qua đây: nó giữ nguyên đường `decideDefenseSpeech`
 * (INDIFFERENT/HUMOR, không claim).
 */
export function planDefenseCommentary(args: {
  context: BotDecisionContext;
  guilty: boolean;
  accusedId: string;
  confidence: number;
  evidence: BotEvidence[];
  style: BotSpeechStyle;
}): BotSpeechIntention {
  const { guilty, accusedId, confidence, evidence, style } = args;
  void args.context;
  if (guilty) {
    return {
      kind: "ACCUSE",
      targetId: accusedId,
      topic: "SUSPICION",
      confidence,
      evidence: evidence.map((item) => ({ ...item })),
      tone: style.harshness >= 0.6 ? "TENSE" : "FIRM",
      reason: "buộc tội bị cáo theo phán quyết Treo sắp bỏ",
    };
  }
  return {
    kind: "DEFEND",
    targetId: accusedId,
    topic: "TRUST",
    confidence,
    evidence: evidence.map((item) => ({ ...item })),
    tone: style.warmth === "WARM" ? "SOFT" : "NEUTRAL",
    reason: "bênh bị cáo theo phán quyết Tha sắp bỏ",
  };
}
