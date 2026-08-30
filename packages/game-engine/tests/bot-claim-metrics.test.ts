import { describe, expect, it } from "vitest";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { collectMetrics } from "../src/bot/evaluation/metrics";
import { BOT_WEIGHTS_V3, BOT_WEIGHTS_V4, type BotWeights } from "../src/bot/config/weights";

/**
 * `runSelfPlay` chạy ĐÚNG một ván (xem `selfplay.ts`); nó không nhận `games` và
 * không trả `overall`. Batch ở đây tự lặp N seed rồi gom qua `collectMetrics`,
 * đúng cách `bot-weights.test.ts` đã làm cho win-rate.
 */
function batch(seedPrefix: string, games: number, weights: BotWeights) {
  const results = Array.from({ length: games }, (_, i) =>
    runSelfPlay({ seed: `${seedPrefix}-${i}`, weights }),
  );
  return collectMetrics(results, weights);
}

describe("chỉ số claim", () => {
  it(
    "v4 có lời khai, v3 tuyệt đối không",
    () => {
      const v4 = batch("claim-v4", 40, BOT_WEIGHTS_V4);
      const v3 = batch("claim-v4", 40, BOT_WEIGHTS_V3);
      expect(v4.overall.claimsPerGame).toBeGreaterThan(0);
      expect(v3.overall.claimsPerGame).toBe(0);
    },
    60_000,
  );

  it(
    "mật độ nằm trong khoảng thiết kế, không thành chợ",
    () => {
      const report = batch("claim-density", 60, BOT_WEIGHTS_V4);
      expect(report.overall.claimsPerGame).toBeGreaterThanOrEqual(1);
      expect(report.overall.claimsPerGame).toBeLessThanOrEqual(6);
    },
    60_000,
  );

  /**
   * Bốn khẳng định dưới đây đọc CÙNG một batch 120 ván v4 (`claim-accuracy`).
   *
   * `counterClaimRate` và `claimFollowRate` mang doc-comment khẳng định một
   * bất biến thật ("phải > 0 và < 1", "≈ 0 nghĩa là hỏng mục tiêu Phase 5") mà
   * không có test nào giữ chúng đúng - một chỉ số có chú thích tự tin mà không
   * ai kiểm là một lời khẳng định không ai xác minh. Dùng chung một batch thay
   * vì bốn batch riêng: rẻ hơn, và cả bốn chỉ số đang nói về cùng một quần thể
   * ván nên so sánh được với nhau.
   */
  it(
    "làng tin claim đúng nhiều hơn claim láo, có phản bác, có chuyển phiếu thật",
    () => {
      const report = batch("claim-accuracy", 120, BOT_WEIGHTS_V4);

      expect(report.overall.claimAccuracy.value).toBeGreaterThan(0.5);

      // counterClaimRate: không bao giờ 0 (nếu không ai phản bác thì cơ chế vô
      // dụng) và không bao giờ 1 (nếu ván nào cũng có phản bác thì mọi lời khai
      // đều bị chợ hoá).
      expect(report.overall.counterClaimRate.value).toBeGreaterThan(0);
      expect(report.overall.counterClaimRate.value).toBeLessThan(1);

      // claimFollowRate ≈ 0 nghĩa là mô hình uy tín chỉ là số chạy ngầm - người
      // chơi sẽ không bao giờ thấy một lời khai đổi được lá phiếu nào. Ngưỡng
      // 0.05 không phải một con số thiết kế, nó chỉ là "rõ ràng không phải
      // không-đáng-kể"; xem ghi chú trong `metrics.ts`.
      expect(report.overall.claimFollowRate.value).toBeGreaterThan(0.05);
      expect(report.overall.claimFollowRate.value).toBeLessThan(1);
    },
    60_000,
  );
});
