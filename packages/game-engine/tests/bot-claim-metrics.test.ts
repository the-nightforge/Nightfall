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

  it(
    "làng tin claim đúng nhiều hơn claim láo",
    () => {
      const report = batch("claim-accuracy", 120, BOT_WEIGHTS_V4);
      expect(report.overall.claimAccuracy.value).toBeGreaterThan(0.5);
    },
    60_000,
  );
});
