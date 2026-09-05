/**
 * Thống kê vận hành của tầng DIỄN ĐẠT lời bot - đếm trong bộ nhớ, có trần.
 *
 * Câu hỏi nó trả lời: bao nhiêu phần lời thoại đang đến từ bảng mẫu thay vì
 * nhà cung cấp, vì sao, và mỗi lượt diễn đạt mất bao lâu. Không có nó, một
 * nhà cung cấp hỏng lặng lẽ suốt một tuần trông y hệt một nhà cung cấp tốt:
 * `fromTemplate` được trả về từ `renderBotSpeech` từ Phase 4 nhưng chưa nơi
 * nào cộng dồn nó.
 *
 * Ranh giới cố ý:
 * - KHÔNG ghi nội dung chat, không ghi prompt, không ghi token hay khoá. Chỉ
 *   số đếm, mili giây và một nhãn lý do từ một tập hữu hạn.
 * - KHÔNG ghi mã phòng hay id người chơi: đây là số liệu của TIẾN TRÌNH, không
 *   phải của một ván.
 * - Bộ nhớ CỐ ĐỊNH: vài số đếm cộng một histogram 7 ngăn. Không mảng nào lớn
 *   theo thời gian chạy; một server sống một tháng tốn đúng bằng một server
 *   sống một phút.
 * - Không I/O: đọc qua `/api/health`. Không có timer, không có log định kỳ.
 */

/**
 * Vì sao câu chữ KHÔNG đến từ lượt hỏi nhà cung cấp đầu tiên.
 *
 * - `provider`: nhà cung cấp trả câu và câu qua cổng ngay lượt đầu.
 * - `provider_retry`: lượt đầu trượt cổng, lượt hỏi lại qua.
 * - `provider_failed`: nhà cung cấp không trả câu nào (timeout, 429, JSON vỡ,
 *   hết ngân sách, hoặc không cấu hình) - rơi về bảng mẫu.
 * - `gate_rejected`: nhà cung cấp trả câu nhưng cả hai lượt đều trượt cổng
 *   (nhại lại chính mình, mở đầu trùng, nói sai lời khai) - rơi về bảng mẫu.
 * - `template_silent`: bảng mẫu cũng không có câu nào không trùng, bot im.
 */
export type SpeechSource =
  | "provider"
  | "provider_retry"
  | "provider_failed"
  | "gate_rejected"
  | "template_silent";

/** Biên trên của từng ngăn thời gian, ms. Ngăn cuối là "trên hết". */
export const DURATION_BUCKETS_MS = [250, 500, 1_000, 2_000, 4_000, 8_000] as const;

export interface SpeechStatsSnapshot {
  /** Tổng số lượt diễn đạt đã ghi. */
  total: number;
  /** Số lượt câu chữ đến từ bảng mẫu (hoặc im vì bảng mẫu cạn). */
  fromTemplate: number;
  /** `fromTemplate / total`, `null` khi chưa có lượt nào. */
  fromTemplateRate: number | null;
  bySource: Record<SpeechSource, number>;
  /** Số lượt rơi vào từng ngăn của `DURATION_BUCKETS_MS`, cộng một ngăn "trên hết". */
  durationHistogramMs: Array<{ upTo: number | null; count: number }>;
  /** Thời gian trung bình một lượt, ms; `null` khi chưa có lượt nào. */
  meanDurationMs: number | null;
  maxDurationMs: number;
}

export class SpeechStats {
  private total = 0;
  private fromTemplate = 0;
  private sumMs = 0;
  private maxMs = 0;
  private readonly bySource: Record<SpeechSource, number> = {
    provider: 0,
    provider_retry: 0,
    provider_failed: 0,
    gate_rejected: 0,
    template_silent: 0,
  };
  private readonly buckets: number[] = new Array(DURATION_BUCKETS_MS.length + 1).fill(0);

  record(source: SpeechSource, durationMs: number): void {
    const ms = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    this.total += 1;
    this.bySource[source] += 1;
    if (source !== "provider" && source !== "provider_retry") this.fromTemplate += 1;
    this.sumMs += ms;
    if (ms > this.maxMs) this.maxMs = ms;
    let index = DURATION_BUCKETS_MS.findIndex((upTo) => ms <= upTo);
    if (index === -1) index = DURATION_BUCKETS_MS.length;
    this.buckets[index] += 1;
  }

  snapshot(): SpeechStatsSnapshot {
    return {
      total: this.total,
      fromTemplate: this.fromTemplate,
      fromTemplateRate: this.total === 0 ? null : this.fromTemplate / this.total,
      bySource: { ...this.bySource },
      durationHistogramMs: this.buckets.map((count, index) => ({
        upTo: index < DURATION_BUCKETS_MS.length ? DURATION_BUCKETS_MS[index]! : null,
        count,
      })),
      meanDurationMs: this.total === 0 ? null : this.sumMs / this.total,
      maxDurationMs: this.maxMs,
    };
  }

  /** Cho test; production không bao giờ đặt lại. */
  reset(): void {
    this.total = 0;
    this.fromTemplate = 0;
    this.sumMs = 0;
    this.maxMs = 0;
    for (const key of Object.keys(this.bySource) as SpeechSource[]) this.bySource[key] = 0;
    this.buckets.fill(0);
  }
}

/** Một bộ đếm cho cả tiến trình; `renderBotSpeech` ghi vào đây theo mặc định. */
export const speechStats = new SpeechStats();
