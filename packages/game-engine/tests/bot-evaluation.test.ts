import { describe, expect, it } from "vitest";
import { MAX_ROUNDS, runSelfPlay, type SelfPlayGame } from "../src/bot/evaluation/selfplay";

const SEEDS = Array.from({ length: 30 }, (_, i) => `eval-${i}`);

// Phase 2 đo win rate/rounds/actions với lời nói tắt hẳn; bật lời nói là một
// thay đổi hành vi thuộc phạm vi của bot-weights.test.ts, không phải ở đây.
const simulate = (seed: string) => runSelfPlay({ seed, speech: false });

describe("simulateGame", () => {
  it("chạy trọn một ván và có người thắng", () => {
    const result = simulate("single");

    expect(result.winner).not.toBeNull();
    expect(result.rounds).toBeGreaterThan(0);
    expect(result.rounds).toBeLessThanOrEqual(MAX_ROUNDS);
  });

  it("không nước đi nào bị engine từ chối", () => {
    // Engine vẫn là trọng tài trong harness, nên một nước đi bất hợp lệ sẽ ném
    // và được ghi lại. Danh sách rỗng nghĩa là lõi BOT chưa từng sinh ra nước
    // đi mà luật không cho.
    expect(simulate("legal").violations).toEqual([]);
  });

  it("BOT thật sự có hành động, không phải bỏ lượt cả ván", () => {
    // Không có assert này thì một BOT luôn trả null vẫn "đạt" mọi test khác.
    expect(simulate("active").actions).toBeGreaterThan(10);
  });

  it("cùng seed cho kết quả giống hệt từng bit", () => {
    expect(simulate("replay")).toEqual(simulate("replay"));
  });

  it("seed khác nhau không cho ra cùng một ván", () => {
    const results = SEEDS.slice(0, 10).map((seed) => simulate(seed));
    const shapes = new Set(results.map((item) => `${item.winner}:${item.rounds}`));

    expect(shapes.size).toBeGreaterThan(1);
  });
});

describe("30 ván", () => {
  const results = SEEDS.map((seed) => simulate(seed));

  const summarize = (games: readonly SelfPlayGame[]) => ({
    unfinished: games.filter((g) => g.winner === null).length,
    wolfWins: games.filter((g) => g.winner === "wolves").length,
    villagerWins: games.filter((g) => g.winner === "village").length,
    averageRounds: games.reduce((sum, g) => sum + g.rounds, 0) / Math.max(1, games.length),
    violations: games.flatMap((g) => g.violations),
  });
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
    // Auditor kiểm điều này TRONG LÚC chạy và đẩy vào violations. Từ Phase 3
    // vi phạm là object có cấu trúc, nên lọc theo `id` chứ không dò chuỗi -
    // một phép dò chuỗi sẽ lặng lẽ ngừng khớp khi thông điệp được sửa lại.
    expect(
      metrics.violations.filter(
        (v) => v.id === "ROLE_LEAK" || v.id === "DEAD_ROLE_REVEALED",
      ),
    ).toEqual([]);
  });
});
