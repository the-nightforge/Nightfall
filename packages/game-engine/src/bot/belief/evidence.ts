import type { BotEvidence } from "../types";

export const MIN_BELIEF_SCORE = 0;
export const MAX_BELIEF_SCORE = 100;

/**
 * Không có evidence không nguồn. Mọi lý do nghi ngờ và mọi câu BOT nói ra phải
 * trỏ tới một event hoặc message có thật, nếu không BOT sẽ "nhớ" những chuyện
 * chưa từng xảy ra và người chơi không có cách nào kiểm chứng.
 */
export function validateEvidence(
  evidence: BotEvidence,
  sourceIds: readonly string[],
): void {
  if (!sourceIds.includes(evidence.sourceId)) {
    throw new Error(`Evidence source không tồn tại: ${evidence.sourceId}`);
  }
}

/**
 * Clamp tại biên belief chứ không clamp weight của evidence: một bằng chứng rất
 * nặng vẫn được phép đẩy score kịch trần, nhưng score thì không bao giờ ra khỏi
 * miền 0–100 mà cả decision layer lẫn test đều dựa vào.
 */
export function clampBeliefScore(score: number): number {
  return Math.min(MAX_BELIEF_SCORE, Math.max(MIN_BELIEF_SCORE, score));
}

/** Confidence là một tỉ lệ, nên nó được chuẩn hoá về `[0, 1]` trước khi nhân. */
export function clampConfidence(confidence: number): number {
  return Math.min(1, Math.max(0, confidence));
}
