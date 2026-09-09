import { describe, expect, it } from "vitest";
import { isWolfPack } from "@masoi/shared";
import { replayGame, runSelfPlay } from "../src/bot/evaluation/selfplay";
import {
  actionIndexOf,
  actionSize,
  DEFAULT_MAX_SEATS,
  encodeObservation,
} from "../src/bot/learning/observation";
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

describe("selectLearnedNight (NIGHT)", () => {
  it("ban đêm: policy thích KILL ghế 2 thì Sói cắn đúng người đó khi hợp lệ", () => {
    const policy = preferring(actionIndexOf("KILL", 2));
    const game = runSelfPlay({
      seed: "lp-5",
      playerCount: 8,
      maxRounds: 6,
      trace: true,
      traceLiveInput: true,
      learnedPolicy: policy,
    });
    expect(game.violations).toEqual([]);
    let checked = 0;
    for (const t of game.traces) {
      if (t.decision !== "NIGHT" || t.chosen.actionKind !== "KILL" || !t.liveInput) continue;
      const enc = encodeObservation(t.liveInput);
      const seat2 = enc.seats[2];
      const legal = t.liveInput.observation.nightLegalTargets?.KILL ?? [];
      if (seat2 !== undefined && legal.includes(seat2)) {
        expect(t.chosen.targetId).toBe(seat2);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("ban đêm: policy thích SKIP thì Phù Thuỷ giữ thuốc, và Thám Tử vẫn đi hai người", () => {
    const game = runSelfPlay({
      seed: "lp-6",
      playerCount: 8,
      maxRounds: 6,
      trace: true,
      traceLiveInput: true,
      learnedPolicy: preferring(actionIndexOf("SKIP", DEFAULT_MAX_SEATS)),
    });
    // Không ai hành động đêm thì không ai chết đêm, nên ván chạm trần vòng —
    // đó là hệ quả của policy giả, không phải một nước đi phạm luật. Thứ đang
    // được đo là seam đêm không bao giờ gửi một nước engine không chào.
    expect(game.violations.filter((v) => v.id !== "ROUND_LIMIT")).toEqual([]);
    const witchNights = game.traces.filter(
      (t) =>
        t.decision === "NIGHT" &&
        game.roles[t.botId] === "WITCH" &&
        t.liveInput?.observation.nightLegalTargets,
    );
    for (const t of witchNights) expect(t.chosen.targetId).toBeNull();
    const detective = game.traces.find(
      (t) => t.decision === "NIGHT" && t.chosen.actionKind === "DETECTIVE_CHECK",
    );
    // heuristic giữ lượt Thám Tử
    if (detective) expect(detective.chosen.targetId).not.toBeNull();
  });
});

describe("self-play cấp policy theo phe, và replay đòi đúng policy", () => {
  it("learnedSeats='wolves': chỉ ghế Sói dùng policy", () => {
    // Policy thích "không treo ai" ban ngày: nếu ÁP cho làng, làng sẽ hay bỏ
    // treo hơn hẳn. Đếm số phiếu "không treo ai" của phe làng ở hai cấu hình.
    const policy = preferring(actionIndexOf("CHOOSE", DEFAULT_MAX_SEATS));
    const wolvesOnly = runSelfPlay({
      seed: "lp-7",
      playerCount: 8,
      maxRounds: 6,
      trace: true,
      learnedPolicy: policy,
      learnedSeats: "wolves",
    });
    const all = runSelfPlay({
      seed: "lp-7",
      playerCount: 8,
      maxRounds: 6,
      trace: true,
      learnedPolicy: policy,
      learnedSeats: "all",
    });
    const noneVotes = (game: typeof all, wolf: boolean): number =>
      game.traces.filter(
        (t) =>
          t.decision === "VOTE" &&
          isWolfPack(game.roles[t.botId]!) === wolf &&
          t.chosen.targetId === null,
      ).length;
    // Làng ở wolvesOnly KHÔNG bị policy chi phối.
    expect(noneVotes(wolvesOnly, false)).toBeLessThan(noneVotes(all, false));
    expect(wolvesOnly.record.learnedPolicyId).toBe(policy.id);
    expect(wolvesOnly.record.learnedSeats).toBe("wolves");
  });

  it("record không có policy thì không mang hai trường đó", () => {
    const plain = runSelfPlay({ seed: "lp-9", playerCount: 8, maxRounds: 4 });
    // Khoá phải VẮNG chứ không phải bằng `undefined`: record đi thẳng ra JSON
    // và một ván heuristic phải cho ra đúng record như trước bản này.
    expect(Object.keys(plain.record)).not.toContain("learnedPolicyId");
    expect(Object.keys(plain.record)).not.toContain("learnedSeats");
  });

  it("replayGame từ chối khi thiếu policy đúng id", () => {
    const policy = preferring(actionIndexOf("CHOOSE", 1));
    const game = runSelfPlay({ seed: "lp-8", playerCount: 8, maxRounds: 4, learnedPolicy: policy });
    expect(() => replayGame(game.record)).toThrow(/learnedPolicy/);
    expect(() =>
      replayGame(game.record, undefined, preferring(actionIndexOf("CHOOSE", 2))),
    ).toThrow(/prefer-/);
    const again = replayGame(game.record, undefined, policy);
    expect(again.winner).toBe(game.winner);
    expect(again.actions).toBe(game.actions);
  });
});
