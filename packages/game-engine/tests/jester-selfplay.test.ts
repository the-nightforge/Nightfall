import { describe, expect, it } from "vitest";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import type { RoomConfig } from "@masoi/shared";

/**
 * Ván trọn vẹn có Thằng Hề, chạy qua đúng nhân mô phỏng của self-play.
 *
 * Các test khác trong thư mục này gọi thẳng từng hàm quyết định; bài này là
 * lớp còn thiếu - nó khẳng định rằng khi ghép tất cả lại thành một ván thật,
 * BOT Hề không kẹt, không sinh nước đi bị engine từ chối, và chiến thuật của
 * nó thật sự dẫn tới giá treo với tần suất đáng kể.
 *
 * 30 ván × seed cố định: tất định từng bit, và mất khoảng nửa giây.
 */
const DECK: Partial<RoomConfig> = {
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: true,
  jester: true,
};

const SEEDS = Array.from({ length: 30 }, (_, i) => `jester-${i}`);

interface Outcome {
  violations: string[];
  lynched: number;
  nominated: number;
  killedOtherwise: number;
  survived: number;
  rejected: number;
}

function runBatch(config: Partial<RoomConfig>): Outcome {
  const out: Outcome = {
    violations: [],
    lynched: 0,
    nominated: 0,
    killedOtherwise: 0,
    survived: 0,
    rejected: 0,
  };

  for (const seed of SEEDS) {
    const game = runSelfPlay({ seed, playerCount: 9, config, maxRounds: 20 });
    out.violations.push(...game.violations.map((item) => item.id));
    out.rejected += game.rejected;

    const jesterId = Object.entries(game.roles).find(([, role]) => role === "JESTER")?.[0];
    if (!jesterId) continue;

    if (game.events.some((e) => e.kind === "NOMINATION" && e.accusedId === jesterId)) {
      out.nominated += 1;
    }
    const death = game.events.find((e) => e.kind === "DEATH" && e.playerId === jesterId);
    if (!death) out.survived += 1;
    else if (death.kind === "DEATH" && death.cause === "lynch") out.lynched += 1;
    else out.killedOtherwise += 1;
  }

  return out;
}

describe("Thằng Hề trong ván self-play trọn vẹn", () => {
  const withJester = runBatch(DECK);

  it("không vi phạm bất biến nào", () => {
    // Bộ kiểm bất biến gồm cả ROLE_LEAK và WOLF_ALLY_SCOPE, nên dòng này cũng
    // là phép kiểm "vai trung lập không rò ra chỗ nào nó không được phép".
    expect(withJester.violations).toEqual([]);
  });

  it("không sinh nước đi nào bị engine từ chối", () => {
    // `rejected` gộp cả lượt BOT chủ động bỏ, nhưng Hề không có lượt đêm nào để
    // mà bỏ - nên con số này phải giống hệt bộ bài không có Hề.
    expect(withJester.rejected).toBe(runBatch({ ...DECK, jester: false }).rejected);
  });

  it("chiến thuật thật sự đưa được Hề lên giá treo", () => {
    /*
     * Con số, không phải một khẳng định "có chạy".
     *
     * Ngưỡng đặt ở 1/6 số ván - thấp hơn hẳn mức đo được (10/30) để nó không
     * đỏ vì một lần hiệu chỉnh trọng số nhỏ, nhưng vẫn đủ cao để bắt đúng lỗi
     * mà nó sinh ra để bắt: một con Hề rơi về chiến thuật Dân Làng sẽ gần như
     * không bao giờ bị nghi, và tỉ lệ này sẽ tụt về gần 0.
     */
    expect(withJester.lynched).toBeGreaterThanOrEqual(SEEDS.length / 6);
  });

  it("MỌI lần bị đưa ra toà đều kết thúc bằng bản án treo", () => {
    // Hệ quả của việc Hề không tự bào chữa (xem `decideChatClaim`): tới được
    // phiên toà là cả làng đã đồng thuận, và Hề không làm gì để lật nó.
    expect(withJester.lynched).toBe(withJester.nominated);
  });

  it("bị treo KHÔNG phải kết cục duy nhất - vẫn chết vì đêm và vẫn sống sót", () => {
    // Nếu một trong hai con số này về 0 thì bàn cờ đã thoái hoá: hoặc Hề lộ
    // liễu tới mức luôn bị treo trước khi Sói kịp cắn, hoặc nó vô hình.
    expect(withJester.killedOtherwise).toBeGreaterThan(0);
    expect(withJester.survived).toBeGreaterThan(0);
  });

  it("không đảo lộn cán cân hai phe", () => {
    /*
     * Thằng Hề KHÔNG được là một lá thay đổi ai thắng ván - nó chơi ván của
     * riêng nó. Đo bằng cách chạy đúng bộ seed đó với và không có Hề: chênh
     * lệch phải nhỏ.
     *
     * Ngưỡng 8/30 ván rộng có chủ đích: một lá bài thay một ghế Dân Làng vẫn
     * đổi được vài ván, và siết chặt hơn sẽ biến bài test thành một cái bẫy
     * nhiễu. Nó chỉ bắt trường hợp cán cân bị lật hẳn.
     */
    const wins = (config: Partial<RoomConfig>) =>
      SEEDS.filter(
        (seed) => runSelfPlay({ seed, playerCount: 9, config, maxRounds: 20 }).winner === "village",
      ).length;

    expect(Math.abs(wins(DECK) - wins({ ...DECK, jester: false }))).toBeLessThanOrEqual(8);
    // 60 ván, ~1.9s khi chạy một mình - dưới trần 5s mặc định, nhưng không đủ
    // xa nó: chạy chung cả bộ song song là thỉnh thoảng timeout, và một bài đo
    // cán cân hỏng vì máy bận thì đọc y hệt như cán cân thật sự lệch.
  }, 30_000);
});
