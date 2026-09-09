import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import {
  DEFAULT_MAX_SEATS,
  actionSize,
  canonicalSeats,
  encodeObservation,
  maskLogits,
  observationFeatureNames,
  observationSize,
} from "../src/bot/learning/observation";
import {
  splitOf,
  splitTrajectories,
  summarizeDataset,
  validateTrajectoryLine,
} from "../src/bot/learning/dataset";
import type { BotTrajectory } from "../src/bot/evaluation/trajectory";

/**
 * BOT_SELF_LEARNING Phase 1: observation encoder + action mask + leak validator
 * + game-level split.
 *
 * Bài kiểm quan trọng nhất ở đây là §7: một line có rò rỉ phải bị TỪ CHỐI. Nếu
 * validator im lặng bỏ qua, mọi tầng train phía sau vẫn chạy — và con bug sinh
 * ra rò rỉ đó sẽ không bao giờ bị nhìn thấy.
 */

function line(overrides: Partial<BotTrajectory> = {}): BotTrajectory {
  const base: BotTrajectory = {
    gameId: "g1",
    seed: "g1",
    playerId: "p2",
    finalRole: "VILLAGER" as Role,
    turn: 3,
    phase: "VOTING",
    decision: "VOTE",
    observation: {
      aliveIds: ["p1", "p2", "p3"],
      legalActions: ["p1", "p3", "NO_ELIMINATION"],
      knownRoles: { p2: "VILLAGER" as Role },
      seerResult: null,
      belief: [
        { playerId: "p1", suspicion: 60, trust: 0 },
        { playerId: "p2", suspicion: 0, trust: 20 },
        { playerId: "p3", suspicion: 10, trust: 0 },
      ],
      nightLegalTargets: null,
      personality: {
        aggressiveness: 0.5,
        talkativeness: 0.4,
        riskTolerance: 0.3,
        deceptionSkill: 0.2,
        analyticalSkill: 0.6,
        loyalty: 0.7,
        stubbornness: 0.8,
      },
    },
    legalActions: ["p1", "p3", "NO_ELIMINATION"],
    candidates: [],
    selectedAction: { decision: "VOTE", targetId: "p1", label: "bầu" },
    reward: 1,
    finalWinner: "village",
  };
  return { ...base, ...overrides };
}

describe("observation encoder (§8-§11)", () => {
  it("ghế 0 LUÔN là chính bot, phần còn lại xoay theo thứ tự đã sort (§9)", () => {
    expect(canonicalSeats(line())).toEqual(["p2", "p3", "p1"]);
    expect(canonicalSeats(line({ playerId: "p1" }))).toEqual(["p1", "p2", "p3"]);
  });

  it("vector có chiều cố định và tên chiều khớp một-một", () => {
    const encoded = encodeObservation(line());
    expect(encoded.features).toHaveLength(observationSize());
    expect(observationFeatureNames()).toHaveLength(observationSize());
    expect(encoded.mask).toHaveLength(actionSize());
  });

  it("tách mục tiêu đêm theo từng loại hành động", () => {
    // Phù Thuỷ ban đêm: Cứu p1, Độc p3. Hợp của hai tập không phân biệt được
    // hai ý định ngược nhau, nên cờ theo loại phải khác nhau theo ghế.
    const witch = line({
      finalRole: "WITCH" as Role,
      phase: "NIGHT",
      decision: "NIGHT",
      legalActions: ["p1", "p3"],
      observation: {
        ...line().observation,
        nightLegalTargets: { HEAL: ["p1"], POISON: ["p3"] },
      },
    });

    const names = observationFeatureNames();
    const { features, seats } = encodeObservation(witch);
    const at = (name: string): number => features[names.indexOf(name)]!;

    expect(at("nightKindOpen:HEAL")).toBe(1);
    expect(at("nightKindOpen:POISON")).toBe(1);
    expect(at("nightKindOpen:KILL")).toBe(0);

    const healSeat = seats.indexOf("p1");
    const poisonSeat = seats.indexOf("p3");
    expect(at(`seat${healSeat}:nightLegal:HEAL`)).toBe(1);
    expect(at(`seat${healSeat}:nightLegal:POISON`)).toBe(0);
    expect(at(`seat${poisonSeat}:nightLegal:POISON`)).toBe(1);
    expect(at(`seat${poisonSeat}:nightLegal:HEAL`)).toBe(0);

    // Ngoài lượt đêm mọi cờ phải tắt, không được rò trạng thái đêm sang ban ngày.
    const day = encodeObservation(line());
    for (const kind of ["HEAL", "POISON", "KILL"]) {
      expect(day.features[names.indexOf(`nightKindOpen:${kind}`)]).toBe(0);
    }
  });

  it("tất định: cùng line → cùng vector", () => {
    expect(encodeObservation(line()).features).toEqual(encodeObservation(line()).features);
  });

  it("mask chỉ bật đúng ghế hợp lệ; ô cuối là NO_ELIMINATION (§13)", () => {
    const encoded = encodeObservation(line());
    // seats = [p2, p3, p1]; hợp lệ là p1, p3 và NO_ELIMINATION.
    expect(encoded.mask[0]).toBe(false); // p2 = chính mình, không nằm trong legal
    expect(encoded.mask[1]).toBe(true); // p3
    expect(encoded.mask[2]).toBe(true); // p1
    expect(encoded.mask[DEFAULT_MAX_SEATS]).toBe(true); // NO_ELIMINATION
    expect(encoded.mask.filter(Boolean)).toHaveLength(3);
  });

  it("actionIndex trỏ đúng ghế đã chọn, và null khi hành động ngoài tập hợp lệ", () => {
    expect(encodeObservation(line()).actionIndex).toBe(2); // p1 ở ghế 2
    const illegal = line({ selectedAction: { decision: "VOTE", targetId: "p9", label: "bầu" } });
    expect(encodeObservation(illegal).actionIndex).toBeNull();
  });

  it("bỏ phiếu 'không treo ai' ánh xạ vào ô cuối", () => {
    const none = line({ selectedAction: { decision: "VOTE", targetId: null, label: "không treo" } });
    expect(encodeObservation(none).actionIndex).toBe(DEFAULT_MAX_SEATS);
  });

  it("maskLogits đưa hành động bất hợp lệ về -Infinity (xác suất 0)", () => {
    const masked = maskLogits([1, 2, 3], [true, false, true]);
    expect(masked).toEqual([1, Number.NEGATIVE_INFINITY, 3]);
  });

  it("vượt trần ghế thì NÉM, không cắt bớt người chơi trong im lặng", () => {
    const many = line({
      observation: {
        ...line().observation,
        aliveIds: Array.from({ length: 20 }, (_, i) => `q${i}`),
      },
    });
    expect(() => encodeObservation(many)).toThrow(/maxSeats/);
  });
});

describe("leak validator (§7, §42, §44)", () => {
  it("line sạch thì hợp lệ", () => {
    expect(validateTrajectoryLine(line())).toEqual({ valid: true, violations: [] });
  });

  it("TỪ CHỐI khi dân làng biết vai của một người còn sống", () => {
    const leaked = line({
      observation: {
        ...line().observation,
        knownRoles: { p2: "VILLAGER" as Role, p1: "WEREWOLF" as Role },
      },
    });
    const report = validateTrajectoryLine(leaked);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.kind === "leak" && v.field.endsWith("p1"))).toBe(true);
  });

  it("CHO PHÉP Sói biết đồng bọn còn sống, và ai cũng biết vai người đã chết", () => {
    const wolf = line({
      finalRole: "WEREWOLF" as Role,
      observation: {
        ...line().observation,
        knownRoles: { p2: "WEREWOLF" as Role, p1: "WEREWOLF" as Role },
      },
    });
    expect(validateTrajectoryLine(wolf).valid).toBe(true);

    const dead = line({
      observation: {
        ...line().observation,
        aliveIds: ["p2", "p3"],
        knownRoles: { p2: "VILLAGER" as Role, p1: "SEER" as Role },
      },
    });
    expect(validateTrajectoryLine(dead).valid).toBe(true);
  });

  it("TỪ CHỐI seerResult ở một vai không có lượt soi", () => {
    const fake = line({
      observation: {
        ...line().observation,
        seerResult: { targetId: "p1", isWolf: true },
      },
    });
    expect(validateTrajectoryLine(fake).valid).toBe(false);

    const seer = line({
      observation: {
        ...line().observation,
        knownRoles: { p2: "SEER" as Role },
        seerResult: { targetId: "p1", isWolf: true },
      },
    });
    expect(validateTrajectoryLine(seer).valid).toBe(true);
  });

  it("TỪ CHỐI trường lạ trong observation — kể cả nhãn kết cục (§44)", () => {
    const leaked = line();
    (leaked.observation as unknown as Record<string, unknown>).finalWinner = "village";
    const report = validateTrajectoryLine(leaked);
    expect(report.valid).toBe(false);
    expect(report.violations[0]?.kind).toBe("leak");
  });

  it("TỪ CHỐI hành động ngoài tập hợp lệ (§42)", () => {
    const illegal = line({ selectedAction: { decision: "VOTE", targetId: "p9", label: "bầu" } });
    const report = validateTrajectoryLine(illegal);
    expect(report.valid).toBe(false);
    expect(report.violations.some((v) => v.kind === "action")).toBe(true);
  });

  it("TỪ CHỐI reward ngoài ±1 và line không phải object", () => {
    expect(validateTrajectoryLine(line({ reward: 0 })).valid).toBe(false);
    expect(validateTrajectoryLine("nope").valid).toBe(false);
  });
});

describe("dataset stats + split (§15, §42, §43)", () => {
  it("đếm ván/episode/timestep và phân phối vai, pha, lớp hành động", () => {
    const stats = summarizeDataset([
      line(),
      line({ turn: 4 }),
      line({ gameId: "g2", seed: "g2", finalRole: "SEER" as Role }),
    ]);
    expect(stats.timesteps).toBe(3);
    expect(stats.games).toBe(2);
    expect(stats.episodes).toBe(2);
    expect(stats.roleDistribution.VILLAGER).toBe(2);
    expect(stats.phaseDistribution.VOTING).toBe(3);
    expect(stats.rewardDistribution).toEqual({ win: 3, loss: 0 });
    expect(Object.values(stats.actionDistribution).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("đếm rò rỉ và hành động sai riêng biệt, và không tự sửa line", () => {
    const leaked = line({
      observation: {
        ...line().observation,
        knownRoles: { p2: "VILLAGER" as Role, p1: "WEREWOLF" as Role },
      },
    });
    const stats = summarizeDataset([leaked]);
    expect(stats.leakViolations).toBe(1);
    // Line gốc không bị chạm vào.
    expect(leaked.observation.knownRoles.p1).toBe("WEREWOLF");
  });

  it("split theo VÁN: mọi line của một ván rơi cùng một phần (§15)", () => {
    const lines = [
      line({ gameId: "a" }),
      line({ gameId: "a", turn: 4 }),
      line({ gameId: "b" }),
      line({ gameId: "c" }),
    ];
    const split = splitTrajectories(lines);
    const partOf = new Map<string, string>();
    for (const [part, group] of Object.entries(split)) {
      for (const item of group) {
        const seen = partOf.get(item.gameId);
        expect(seen === undefined || seen === part).toBe(true);
        partOf.set(item.gameId, part);
      }
    }
    expect(lines).toHaveLength(
      split.train.length + split.validation.length + split.test.length,
    );
  });

  it("split tất định và bám tỉ lệ 70/15/15 trên seed thật của một batch", () => {
    // Đúng hình dạng id mà `runBatch` sinh ra: chỉ khác nhau ở đuôi số. Một
    // hàm băm không trộn bit sẽ dồn cả batch này vào một hai phần — đã xảy ra
    // thật (0 ván validation trên 200 ván), nên bài kiểm dùng chính hình dạng đó.
    const ids = Array.from({ length: 400 }, (_, i) => `ai-phase1-${i}`);
    const parts = ids.map((id) => splitOf(id));
    expect(parts).toEqual(ids.map((id) => splitOf(id)));

    const share = (name: string): number =>
      parts.filter((part) => part === name).length / ids.length;
    expect(share("train")).toBeGreaterThan(0.6);
    expect(share("train")).toBeLessThan(0.8);
    expect(share("validation")).toBeGreaterThan(0.08);
    expect(share("test")).toBeGreaterThan(0.08);
  });
});
