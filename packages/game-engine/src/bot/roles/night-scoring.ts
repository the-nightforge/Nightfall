import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { sumTerms, type DecisionProbe, type TraceTerm } from "../trace/trace";
import type { BotRng } from "../types";

/**
 * Hình dạng chấm điểm ĐÊM dùng chung cho mọi vai có bảng điểm ứng viên:
 * mục tiêu hợp lệ do engine cấp → term có tên cho trace → tie-break tất định.
 *
 * Trước khi tách ra, bảy vai chép lại cùng một khung `map → push jitter →
 * sumTerms → probe.candidate → sort(score desc, id asc)`. Bản sao đồng nghĩa
 * mỗi khi thêm một số hạng chung (ví dụ một trần chống nhiễu) phải sửa bảy nơi,
 * và một nơi quên là hai vai tự lệch nhau mà không test nào báo.
 *
 * Helper KHÔNG quyết định gì về chiến thuật: `termsFor` là của từng vai, thứ tự
 * term giữ nguyên như bản cũ, và phần giáo vào decision (winner, runner-up,
 * confidence, evidence) vẫn nằm ở file vai.
 *
 * Hai quy ước mà mọi vai cũ đều đang có, giữ nguyên ở đây:
 *
 * 1. `jitter` là term CUỐI và là LỄ RÚT RNG DUY NHẤT cho mỗi ứng viên — truyền
 *    `rng` mới có jitter. Vai không muốn nhiễu (Tracker, Sát Nhân) bỏ trống và
 *    nhờ vậy không đốt stream RNG của bot.
 * 2. `scale` nhân TỔNG SAU khi cộng, còn `terms` đưa vào probe là bản CHƯA nhân
 *    (đúng cách Sát Nhân đang làm với cổng `nightThreatWeight`). Cổng đó chỉ mang
 *    giá trị 0 (tắt, thoát sớm trước khi chấm) hoặc 1, nên khi bảng điểm thật sự
 *    chạy thì Σterms === score — bất biến mà `trace-jsonl.termSumProblems` kiểm.
 */
export interface RankedNightTarget {
  targetId: string;
  score: number;
  terms: TraceTerm[];
}

export function rankNightTargets(
  candidates: readonly string[],
  options: {
    weights?: BotWeights;
    /** Có mặt thì mỗi ứng viên rút đúng một số cho term `jitter`. */
    rng?: BotRng;
    /** Nhân tổng điểm sau khi cộng; mặc định 1. */
    scale?: number;
    probe?: DecisionProbe;
    termsFor: (targetId: string) => TraceTerm[];
  },
): RankedNightTarget[] {
  const weights = options.weights ?? DEFAULT_BOT_WEIGHTS;
  return candidates
    .map((targetId) => {
      const terms = [...options.termsFor(targetId)];
      if (options.rng) {
        terms.push({
          name: "jitter",
          value: (options.rng() - 0.5) * weights.confidence.jitterSpan,
        });
      }
      const score = sumTerms(terms) * (options.scale ?? 1);
      options.probe?.candidate({ targetId, score, terms, evidenceIds: [] });
      return { targetId, score, terms };
    })
    // Tie-break theo id để cùng seed luôn ra cùng kết quả, không phụ thuộc thứ
    // tự Map hay thứ tự mảng nguồn.
    .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));
}
