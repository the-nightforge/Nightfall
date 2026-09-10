import { describe, expect, it } from "vitest";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { collectMetrics } from "../src/bot/evaluation/metrics";
import { PRESET_DECKS, specialRoleList, type RoomConfig } from "@masoi/shared";
import {
  BOT_WEIGHTS_V3,
  BOT_WEIGHTS_V4,
  DEFAULT_BOT_WEIGHTS,
  type BotWeights,
} from "../src/bot/config/weights";

/**
 * `runSelfPlay` chạy ĐÚNG một ván (xem `selfplay.ts`); nó không nhận `games` và
 * không trả `overall`. Batch ở đây tự lặp N seed rồi gom qua `collectMetrics`,
 * đúng cách `bot-weights.test.ts` đã làm cho win-rate.
 */
function batch(
  seedPrefix: string,
  games: number,
  weights: BotWeights,
  table?: { playerCount: number; config: RoomConfig },
) {
  const results = Array.from({ length: games }, (_, i) =>
    runSelfPlay({ seed: `${seedPrefix}-${i}`, weights, ...table }),
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

  /**
   * Mật độ lời khai của CẤU HÌNH ĐANG CHẠY, trên BỘ BÀI THẬT.
   *
   * Test cũ ở chỗ này ghim `BOT_WEIGHTS_V4` trên bộ bài mặc định của runner
   * (3 vai đặc biệt, 8 người) với dải [1, 6] - tức nó không gác được mặc định,
   * không gác được bộ bài mà phòng thật chia, và dải thì rộng tới mức 5,5
   * lời khai/ván lọt qua êm ru. `DEFAULT_BOT_WEIGHTS` có thể trôi tới đâu cũng
   * không làm nó đỏ.
   *
   * Đơn vị là lời khai trên mỗi GHẾ ĐẶC BIỆT (`specialRoleList`, tính cả Sói),
   * không phải lời khai trên mỗi ván. Đo 300 ván mỗi bộ, v31:
   *
   * ```text
   * PRESET_DECKS[8]   7 ghế  4.10/ván  0.586/ghế
   * PRESET_DECKS[12]  9 ghế  5.52/ván  0.613/ghế
   * PRESET_DECKS[14] 10 ghế  5.80/ván  0.580/ghế
   * PRESET_DECKS[16] 12 ghế  6.49/ván  0.541/ghế
   * ```
   *
   * Lời khai/ván đi theo SỐ VAI ĐẶC BIỆT, không theo số người: bộ bài mặc định
   * của runner (3 vai) cho 3,5/ván ở cả 8, 12 lẫn 14 người. Cái ổn định là tỉ
   * lệ trên ghế. Mục tiêu G4 cũ ("2–4 ở bàn 12–14", Phase 5) là con số của bộ
   * bài 3 vai; trên bộ bài 7–9 vai của hôm nay nó không đạt được nếu không đổi
   * luật khai - và bằng chứng "Đạt" của nó đo trên 8 người, bộ bài runner.
   *
   * Hai cận có nghĩa chứ không phải biên độ tuỳ tiện:
   * - `>= 0.9`: gần như mọi ghế đặc biệt đều lộ - phòng thành chợ, và bầy Sói
   *   có sẵn danh sách để cắn.
   * - `<= 0.3`: lời khai gần như biến mất - cơ chế Phase 5 coi như chết.
   *
   * Batch 40 ván tất định (seed cố định), đo được 0.554 và 0.594: cách mỗi cận
   * cỡ 8 sai số chuẩn. Nó chỉ đỏ khi HÀNH VI đổi, đúng thứ nó sinh ra để bắt.
   * Bộ 14/16 người không vào đây vì chậm (~400 ms/ván); tỉ lệ của chúng nằm
   * trong bảng trên và cùng dải.
   *
   * `claimAccuracy` KHÔNG vào đây dù nó quan trọng hơn: batch này chỉ có 13 và
   * 24 lần làng tin một lời khai Tiên Tri, quá ít để khẳng định `> 0.5` mà
   * không flaky. Nó đang ở ~0.58 trên bộ 12 người - sát sàn - và cần một bench
   * riêng chứ không phải một test đơn vị.
   */
  it(
    "mật độ lời khai của mặc định trên bộ bài thật: không thành chợ, không tắt ngấm",
    () => {
      for (const playerCount of [8, 12]) {
        const config = PRESET_DECKS[playerCount]!;
        const seats = specialRoleList(config).length;
        const report = batch(`claim-deck-${playerCount}`, 40, DEFAULT_BOT_WEIGHTS, {
          playerCount,
          config,
        });
        const perSeat = report.overall.claimsPerGame! / seats;
        expect(perSeat, `${playerCount} người`).toBeGreaterThan(0.3);
        expect(perSeat, `${playerCount} người`).toBeLessThan(0.9);

        // Cùng bất biến mà batch v4 bên dưới giữ, nhưng cho cấu hình đang chạy:
        // có phản bác, và không phải ván nào cũng phản bác.
        expect(report.overall.counterClaimRate.value, `${playerCount} người`).toBeGreaterThan(0);
        expect(report.overall.counterClaimRate.value, `${playerCount} người`).toBeLessThan(1);
      }
    },
    120_000,
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
