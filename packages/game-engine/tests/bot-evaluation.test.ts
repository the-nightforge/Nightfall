import { describe, expect, it } from "vitest";
import { MAX_ROUNDS, simulateGame, summarize } from "../src/bot/evaluation/simulate";

const SEEDS = Array.from({ length: 30 }, (_, i) => `eval-${i}`);

describe("simulateGame", () => {
  it("chạy trọn một ván và có người thắng", () => {
    const result = simulateGame({ seed: "single" });

    expect(result.winner).not.toBeNull();
    expect(result.rounds).toBeGreaterThan(0);
    expect(result.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
  });

  it("không nước đi nào bị engine từ chối", () => {
    // Engine vẫn là trọng tài trong harness, nên một nước đi bất hợp lệ sẽ ném
    // và được ghi lại. Danh sách rỗng nghĩa là lõi BOT chưa từng sinh ra nước
    // đi mà luật không cho.
    expect(simulateGame({ seed: "legal" }).violations).toEqual([]);
  });

  it("BOT thật sự có hành động, không phải bỏ lượt cả ván", () => {
    // Không có assert này thì một BOT luôn trả null vẫn "đạt" mọi test khác.
    expect(simulateGame({ seed: "active" }).actions).toBeGreaterThan(10);
  });

  it("cùng seed cho kết quả giống hệt từng bit", () => {
    expect(simulateGame({ seed: "replay" })).toEqual(simulateGame({ seed: "replay" }));
  });

  it("seed khác nhau không cho ra cùng một ván", () => {
    const results = SEEDS.slice(0, 10).map((seed) => simulateGame({ seed }));
    const shapes = new Set(results.map((item) => `${item.winner}:${item.rounds}`));

    expect(shapes.size).toBeGreaterThan(1);
  });
});

describe("30 ván", () => {
  const results = SEEDS.map((seed) => simulateGame({ seed }));
  const metrics = summarize(results);

  it("không ván nào vi phạm bất biến", () => {
    expect(metrics.violations).toEqual([]);
  });

  it("mọi ván đều kết thúc trong giới hạn vòng", () => {
    expect(metrics.unfinished).toBe(0);
  });

  it("không phe nào thắng tuyệt đối", () => {
    // Một phe thắng 100% nghĩa là bên kia đã ngừng chơi. Đây là bài kiểm tra
    // hồi quy về cân bằng, không phải tuyên bố rằng cân bằng đã tốt.
    expect(metrics.wolfWins).toBeGreaterThan(0);
    expect(metrics.villagerWins).toBeGreaterThan(0);
  });

  it("số vòng trung bình nằm trong khoảng hợp lý", () => {
    expect(metrics.averageRounds).toBeGreaterThan(1);
    expect(metrics.averageRounds).toBeLessThan(MAX_ROUNDS);
  });

  it("không BOT nào biết vai người khác ngoài phần được phép", () => {
    // simulateGame đã kiểm điều này trong lúc chạy và đẩy vào violations.
    expect(metrics.violations.filter((v) => v.includes("biết vai"))).toEqual([]);
  });
});
