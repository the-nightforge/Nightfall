import { describe, expect, it } from "vitest";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { actionIndexOf, actionSize, DEFAULT_MAX_SEATS } from "../src/bot/learning/observation";
import type { LearnedPolicy } from "../src/bot/learning/mlp";

/** Policy giả: luôn thích một chỉ số hành động cho trước. */
function preferring(index: number): LearnedPolicy {
  return {
    id: `prefer-${index}`,
    logits: () => {
      const l = new Array<number>(actionSize()).fill(0);
      l[index] = 10;
      return l;
    },
    value: () => null,
  };
}

describe("learnedPolicyModel (VOTE)", () => {
  it("chạy trọn ván với learnedPolicy giả mà không ném, và phiếu luôn hợp lệ", () => {
    const game = runSelfPlay({
      seed: "lp-2",
      playerCount: 8,
      maxRounds: 6,
      // Luôn thích "không treo ai".
      learnedPolicy: preferring(actionIndexOf("CHOOSE", DEFAULT_MAX_SEATS)),
    });
    expect(game.violations).toEqual([]);
    expect(game.rejected).toBe(0);
  });

  it("policy thích ô bất hợp lệ thì rơi về heuristic, không ném", () => {
    const game = runSelfPlay({
      seed: "lp-3",
      playerCount: 8,
      maxRounds: 6,
      // POISON không bao giờ hợp lệ ban ngày.
      learnedPolicy: preferring(actionIndexOf("POISON", 3)),
    });
    expect(game.violations).toEqual([]);
    expect(game.rejected).toBe(0);
  });

  it("không có learnedPolicy → ván byte-identical với hiện tại", () => {
    const a = runSelfPlay({ seed: "lp-4", playerCount: 8, maxRounds: 6 });
    const b = runSelfPlay({ seed: "lp-4", playerCount: 8, maxRounds: 6, learnedPolicy: undefined });
    expect(b.winner).toBe(a.winner);
    expect(b.rounds).toBe(a.rounds);
    expect(b.actions).toBe(a.actions);
  });
});
