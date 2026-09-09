import { describe, expect, it } from "vitest";
import { isWolfPack } from "@masoi/shared";
import { replayGame, runSelfPlay } from "../src/bot/evaluation/selfplay";
import { gameToTrajectories } from "../src/bot/evaluation/trajectory";
import {
  actionIndexOf,
  actionSize,
  DEFAULT_MAX_SEATS,
  encodeObservation,
} from "../src/bot/learning/observation";
import type { LearnedPolicy } from "../src/bot/learning/mlp";
import { sampleMasked } from "../src/bot/policy/learned-policy";
import { createSeededRng } from "../src/bot/rng";

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

describe("lấy mẫu có nhiệt độ (rollout RL)", () => {
  it("sampleMasked: T=0 là argmax; T=1 lấy mẫu đúng phân phối; logProb khớp softmax", () => {
    const logits = [2, 0, 1, 5];
    const mask = [true, true, true, false]; // ô 3 bị che dù logit cao nhất
    const rng = createSeededRng("sample-1");
    const greedy = sampleMasked(logits, mask, 0, rng)!;
    expect(greedy.index).toBe(0);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 2000; i += 1) counts[sampleMasked(logits, mask, 1, rng)!.index]! += 1;
    expect(counts[3]).toBe(0);
    expect(counts[0]!).toBeGreaterThan(counts[2]!);
    expect(counts[2]!).toBeGreaterThan(counts[1]!);
    const z = Math.exp(2) + Math.exp(0) + Math.exp(1);
    expect(sampleMasked(logits, mask, 0, rng)!.logProb).toBeCloseTo(Math.log(Math.exp(2) / z), 8);
  });

  it("rollout: T=1 ghi learned{actionIndex,logProb,value} vào trace và trajectory, replay tái lập", () => {
    const policy = preferring(actionIndexOf("CHOOSE", 1));
    const game = runSelfPlay({
      seed: "rl-1",
      playerCount: 8,
      maxRounds: 5,
      trace: true,
      learnedPolicy: policy,
      learnedTemperature: 1,
    });
    const picks = game.traces.filter((t) => t.chosen.learned);
    expect(picks.length).toBeGreaterThan(0);
    for (const t of picks) {
      expect(t.chosen.learned!.logProb).toBeLessThanOrEqual(0);
      expect(t.chosen.learned!.temperature).toBe(1);
    }
    const lines = gameToTrajectories(game);
    const withLearned = lines.filter((l) => l.learned);
    expect(withLearned.length).toBe(picks.length);
    // Nhãn encoder phải trùng chỉ số policy đã lấy mẫu.
    for (const l of withLearned) expect(encodeObservation(l).actionIndex).toBe(l.learned!.actionIndex);
    const again = replayGame(game.record, undefined, policy);
    expect(again.actions).toBe(game.actions);
    expect(again.winner).toBe(game.winner);
  });
});

describe("learnedDecisions — model chỉ quyết một trong hai lượt", () => {
  it("\"vote\": lượt đêm đi y hệt heuristic; \"night\": lượt bầu đi y hệt heuristic", () => {
    // Policy thích KILL ghế 2 và CHOOSE ghế 1: mỗi lượt có một ô nó muốn.
    const policy: LearnedPolicy = {
      id: "split",
      logits: () => {
        const l = new Array<number>(actionSize()).fill(0);
        l[actionIndexOf("KILL", 2)] = 10;
        l[actionIndexOf("CHOOSE", 1)] = 10;
        return l;
      },
      value: () => null,
    };
    const plain = runSelfPlay({ seed: "ld-1", playerCount: 8, maxRounds: 5, trace: true });
    const voteOnly = runSelfPlay({
      seed: "ld-1", playerCount: 8, maxRounds: 5, trace: true,
      learnedPolicy: policy, learnedDecisions: "vote",
    });
    const nightOnly = runSelfPlay({
      seed: "ld-1", playerCount: 8, maxRounds: 5, trace: true,
      learnedPolicy: policy, learnedDecisions: "night",
    });
    const both = runSelfPlay({
      seed: "ld-1", playerCount: 8, maxRounds: 5, trace: true, learnedPolicy: policy,
    });
    // Đêm ĐẦU TIÊN chưa có gì khác nhau giữa các ván (cùng seed, cùng vai), nên
    // so được trực tiếp: "vote" phải đi đúng nước đêm của heuristic, "night" thì không.
    const firstNight = (g: typeof plain) =>
      g.traces.filter((t) => t.decision === "NIGHT" && t.round === 1).map((t) => [t.botId, t.chosen.actionKind, t.chosen.targetId]);
    expect(firstNight(voteOnly)).toEqual(firstNight(plain));
    expect(firstNight(nightOnly)).toEqual(firstNight(both));
    expect(firstNight(nightOnly)).not.toEqual(firstNight(plain));
    // Và record ghi lại lựa chọn để replay dựng đúng cấu hình.
    expect(voteOnly.record.learnedDecisions).toBe("vote");
    expect(nightOnly.record.learnedDecisions).toBe("night");
    expect(Object.keys(both.record)).not.toContain("learnedDecisions");
    expect(Object.keys(plain.record)).not.toContain("learnedDecisions");
    expect(replayGame(voteOnly.record, undefined, policy).actions).toBe(voteOnly.actions);
  });
});
