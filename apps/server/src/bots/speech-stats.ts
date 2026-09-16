import { looksCasual } from "@masoi/game-engine";

/**
 * Thống kê vận hành của tầng DIỄN ĐẠT lời bot - đếm trong bộ nhớ, có trần.
 *
 * Bốn câu hỏi nó trả lời: bao nhiêu phần lời thoại đang đến từ bảng mẫu thay vì
 * nhà cung cấp, vì sao, mỗi lượt diễn đạt mất bao lâu, và **câu phát ra có đọc
 * như người chat không**. Không có nó, một nhà cung cấp hỏng lặng lẽ suốt một
 * tuần trông y hệt một nhà cung cấp tốt: `fromTemplate` được trả về từ
 * `renderBotSpeech` từ Phase 4 nhưng chưa nơi nào cộng dồn nó.
 *
 * Câu hỏi thứ tư là chỗ TỐI NHẤT trong cả hệ. `casualToneRate` tồn tại trong
 * báo cáo self-play, nhưng self-play chạy 100% bảng mẫu - nó đo BẢNG MẪU, chưa
 * bao giờ đo nhà cung cấp. Mà nhà cung cấp mới là đường chạy ở production, và
 * là chỗ giọng thật sự trôi được: đổi model, đổi nhiệt độ, prompt bị cắt, một
 * bản cập nhật phía nhà cung cấp - không cái nào trong đó chạm vào repo này,
 * nên không test nào đỏ và không chỉ số nào cũ nhúc nhích. Ván thật đã từng cho
 * ra "Mình đang nghi X nhất, ông nói rõ căn cứ đi, đừng né." và phải có người
 * ĐỌC mới thấy.
 *
 * Ranh giới cố ý:
 * - KHÔNG ghi nội dung chat, không ghi prompt, không ghi token hay khoá. Chỉ
 *   số đếm, mili giây và một nhãn lý do từ một tập hữu hạn. Câu chữ có ĐI QUA
 *   `record`, nhưng chỉ để qua `looksCasual` - một hàm thuần - rồi thành một
 *   số đếm; không có đường nào để nó ở lại.
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
 * - `template_silent`: bot IM. Hai nguyên nhân: bảng mẫu không còn câu nào
 *   không trùng, hoặc ý định không có ai để nói tới nên bảng mẫu từ chối dựng
 *   câu. Cái sau là nhánh phòng thủ của `speechTemplate` - lõi không được phép
 *   tạo ra tình huống đó, nên nhãn này khác 0 bất thường là dấu hiệu lỗi LÕI,
 *   không phải lỗi nhà cung cấp.
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
  /** Số lượt THẬT SỰ phát ra một câu, tức `total` trừ những lượt im. */
  spoken: number;
  /** Số câu đọc như người chat (`looksCasual`), trên tổng `spoken`. */
  casual: number;
  /** `casual / spoken`, `null` khi chưa câu nào được phát. */
  casualToneRate: number | null;
  /**
   * Số câu đọc như chat, chia theo NGUỒN - song song với `bySource`.
   *
   * Phải chia theo nguồn, không được đọc một con số gộp: `casualToneRate` gộp
   * trộn lẫn HAI chuyện hoàn toàn khác nhau. Bảng mẫu đo được 0,90 sau khi bỏ
   * dấu chấm cuối; nên khi nhà cung cấp hỏng lặng lẽ và mọi thứ rơi về bảng
   * mẫu, tỉ lệ gộp sẽ TRÔI VỀ 0,90 và trông như một cải thiện. Chia theo nguồn
   * thì `provider` tụt mẫu số về 0 và chuyện đó hiện ra ngay.
   *
   * Mẫu số của từng nguồn là `bySource[nguồn]`, trừ `template_silent` - lượt im
   * không có câu nào để chấm nên nó luôn bằng 0 ở đây.
   */
  casualBySource: Record<SpeechSource, number>;
  /**
   * Câu mà một người NGHE đọc ra đúng việc lõi vừa chốt, chia theo nguồn.
   *
   * Câu hỏi TỐI NHẤT còn lại trong cả hệ, và là câu hỏi mà bốn cổng của
   * `speech-renderer` KHÔNG hỏi: cả bốn đều hỏi "câu này có nói SAI không", và
   * `targetSurvivesRoundTrip` dùng `.every()` nên một câu không đọc ra memory
   * NÀO cũng qua. Một câu mơ hồ của nhà cung cấp vì thế đi thẳng ra phòng, và
   * với mọi BOT khác nó là một lượt nói KHÔNG XẢY RA - belief không dịch.
   *
   * Self-play đo được 1,0 (bảng mẫu có test sweep khoá), nhưng self-play không
   * có nhà cung cấp. Con số cho `provider`/`provider_retry` ở đây là con số
   * duy nhất nói được điều đó về production.
   *
   * Mẫu số là `heardEligibleBySource`, KHÔNG phải `bySource`: chỉ những loại
   * nói có mục tiêu mới có việc để mà nghe ra (xem `HEARD_AS`), và một lượt im
   * không có câu nào để chấm.
   */
  heardBySource: Record<SpeechSource, number>;
  /** Số lượt CÓ phát câu và thuộc một loại nói có mục tiêu, chia theo nguồn. */
  heardEligibleBySource: Record<SpeechSource, number>;
  /** `heard / eligible` gộp mọi nguồn; `null` khi chưa có lượt nào chấm được. */
  heardRate: number | null;
  bySource: Record<SpeechSource, number>;
  /** Số lượt rơi vào từng ngăn của `DURATION_BUCKETS_MS`, cộng một ngăn "trên hết". */
  durationHistogramMs: Array<{ upTo: number | null; count: number }>;
  /** Thời gian trung bình một lượt, ms; `null` khi chưa có lượt nào. */
  meanDurationMs: number | null;
  maxDurationMs: number;
}

/** Tổng hai bảng theo nguồn thành một tỉ lệ; `null` khi mẫu số bằng 0. */
function heardRateOf(
  heard: Record<SpeechSource, number>,
  eligible: Record<SpeechSource, number>,
): number | null {
  const sum = (table: Record<SpeechSource, number>): number =>
    Object.values(table).reduce((total, value) => total + value, 0);
  const denominator = sum(eligible);
  return denominator === 0 ? null : sum(heard) / denominator;
}

const emptyBySource = (): Record<SpeechSource, number> => ({
  provider: 0,
  provider_retry: 0,
  provider_failed: 0,
  gate_rejected: 0,
  template_silent: 0,
});

export class SpeechStats {
  private total = 0;
  private fromTemplate = 0;
  private spoken = 0;
  private casual = 0;
  private sumMs = 0;
  private maxMs = 0;
  private readonly bySource: Record<SpeechSource, number> = emptyBySource();
  private readonly casualBySource: Record<SpeechSource, number> = emptyBySource();
  private readonly heardBySource: Record<SpeechSource, number> = emptyBySource();
  private readonly heardEligibleBySource: Record<SpeechSource, number> = emptyBySource();
  private readonly buckets: number[] = new Array(DURATION_BUCKETS_MS.length + 1).fill(0);

  /**
   * `text` là câu ĐÃ PHÁT, hoặc `null` khi lượt đó im.
   *
   * Nhận cả câu chứ không nhận sẵn một cờ boolean: `looksCasual` là thước dùng
   * chung với `casualToneRate` của báo cáo self-play và với test gác
   * `VOICE_HINTS`. Chấm ở đây bằng chính hàm đó là điều kiện để con số của
   * production và con số của self-play so được với nhau; một phép chấm riêng ở
   * server sẽ trôi lệch, và nó sẽ trôi lệch âm thầm.
   *
   * KHÔNG lưu `text` - xem ranh giới ở đầu file. Nó chỉ đi qua một hàm thuần
   * rồi thành một số đếm.
   */
  record(
    source: SpeechSource,
    durationMs: number,
    text: string | null,
    heard: boolean | null = null,
  ): void {
    const ms = Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0;
    this.total += 1;
    this.bySource[source] += 1;
    if (source !== "provider" && source !== "provider_retry") this.fromTemplate += 1;
    if (text !== null) {
      this.spoken += 1;
      if (looksCasual(text)) {
        this.casual += 1;
        this.casualBySource[source] += 1;
      }
      // `null` = loại nói này không nói thay lõi, nên nó không vào mẫu số.
      // Đếm nó thành 0 sẽ kéo tỉ lệ xuống theo tỉ trọng của `AGREE`/`REACTION`
      // trong ván, tức con số sẽ đổi khi tính cách bot đổi chứ không khi tầng
      // diễn đạt hỏng - đúng thứ nó sinh ra để phát hiện.
      if (heard !== null) {
        this.heardEligibleBySource[source] += 1;
        if (heard) this.heardBySource[source] += 1;
      }
    }
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
      spoken: this.spoken,
      casual: this.casual,
      casualToneRate: this.spoken === 0 ? null : this.casual / this.spoken,
      casualBySource: { ...this.casualBySource },
      heardBySource: { ...this.heardBySource },
      heardEligibleBySource: { ...this.heardEligibleBySource },
      heardRate: heardRateOf(this.heardBySource, this.heardEligibleBySource),
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
    this.spoken = 0;
    this.casual = 0;
    this.sumMs = 0;
    this.maxMs = 0;
    for (const key of Object.keys(this.bySource) as SpeechSource[]) {
      this.bySource[key] = 0;
      this.casualBySource[key] = 0;
      this.heardBySource[key] = 0;
      this.heardEligibleBySource[key] = 0;
    }
    this.buckets.fill(0);
  }
}

/** Một bộ đếm cho cả tiến trình; `renderBotSpeech` ghi vào đây theo mặc định. */
export const speechStats = new SpeechStats();
