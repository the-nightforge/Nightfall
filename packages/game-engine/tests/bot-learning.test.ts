import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import {
  ACTION_KINDS,
  DEFAULT_MAX_SEATS,
  actionIndexOf,
  actionNames,
  actionSize,
  canonicalSeats,
  decodeAction,
  encodeObservation,
  maskLogits,
  observationFeatureNames,
  observationSize,
} from "../src/bot/learning/observation";
import {
  candidateBases,
  candidateScores,
  optimalActionMask,
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
      nightLegalTargets: null,
      knownRoles: { p2: "VILLAGER" as Role },
      seerResult: null,
      belief: [
        { playerId: "p1", suspicion: 60, trust: 0, wolfProbability: 0.7, threat: 0.2, credibility: 0.4, influence: 0.1, informationValue: 40, claimedPowerRole: true, guardedBefore: false },
        { playerId: "p2", suspicion: 0, trust: 20, wolfProbability: 0, threat: 0, credibility: 0.5, influence: 0, informationValue: 20, claimedPowerRole: false, guardedBefore: false },
        { playerId: "p3", suspicion: 10, trust: 0, wolfProbability: 0.2, threat: 0.6, credibility: 0.5, influence: 0.3, informationValue: 30, claimedPowerRole: false, guardedBefore: true },
      ],
      personality: {
        aggressiveness: 0.5,
        talkativeness: 0.4,
        riskTolerance: 0.3,
        deceptionSkill: 0.2,
        analyticalSkill: 0.6,
        loyalty: 0.7,
        stubbornness: 0.8,
      },
      nightWolfTarget: null,
      healUsed: false,
      poisonUsed: false,
      guardPrevious: null,
      lastNightDeaths: [],
      voteCounts: { players: { p1: 1 }, noElimination: 0 },
      trialAccusedId: null,
    },
    legalActions: ["p1", "p3", "NO_ELIMINATION"],
    candidates: [],
    selectedAction: { decision: "VOTE", targetId: "p1", label: "bầu", kind: null },
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

  it("tất định: cùng line → cùng vector", () => {
    expect(encodeObservation(line()).features).toEqual(encodeObservation(line()).features);
  });

  it("mask chỉ bật đúng ghế hợp lệ của loại CHOOSE; ô cuối là NO_ELIMINATION (§13)", () => {
    const encoded = encodeObservation(line());
    // seats = [p2, p3, p1]; hợp lệ là p1, p3 và NO_ELIMINATION — tất cả ở loại CHOOSE (kind 0).
    expect(encoded.mask[0]).toBe(false); // p2 = chính mình, không nằm trong legal
    expect(encoded.mask[1]).toBe(true); // p3
    expect(encoded.mask[2]).toBe(true); // p1
    expect(encoded.mask[DEFAULT_MAX_SEATS]).toBe(true); // NO_ELIMINATION
    expect(encoded.mask.filter(Boolean)).toHaveLength(3);
    expect(encoded.mask).toHaveLength(actionSize());
    expect(actionNames()).toHaveLength(actionSize());
    expect(decodeAction(2, encoded.seats)).toEqual({ kind: "CHOOSE", targetId: "p1" });
    expect(decodeAction(DEFAULT_MAX_SEATS, encoded.seats)).toEqual({ kind: "CHOOSE", targetId: null });
  });

  it("ban đêm: nhãn là cặp (loại, mục tiêu) — HEAL và POISON cùng người là hai ô khác nhau", () => {
    const witch = line({
      phase: "NIGHT",
      decision: "NIGHT",
      finalRole: "WITCH" as Role,
      observation: {
        ...line().observation,
        knownRoles: { p2: "WITCH" as Role },
        legalActions: ["p1", "p3"],
        nightLegalTargets: { HEAL: [], POISON: ["p1", "p3"], SKIP: [] },
        nightWolfTarget: "p3",
      },
      legalActions: ["p1", "p3"],
      selectedAction: { decision: "NIGHT", targetId: "p3", label: "POISON", kind: "POISON" },
    });
    const encoded = encodeObservation(witch);
    // seats = [p2, p3, p1]
    expect(encoded.actionIndex).toBe(actionIndexOf("POISON", 1));
    expect(decodeAction(encoded.actionIndex!, encoded.seats)).toEqual({ kind: "POISON", targetId: "p3" });
    // HEAL không kèm mục tiêu (engine tự cứu nạn nhân), SKIP là giữ thuốc.
    expect(encoded.mask[actionIndexOf("HEAL", DEFAULT_MAX_SEATS)]).toBe(true);
    expect(encoded.mask[actionIndexOf("HEAL", 1)]).toBe(false);
    expect(encoded.mask[actionIndexOf("SKIP", DEFAULT_MAX_SEATS)]).toBe(true);
    expect(encoded.mask[actionIndexOf("CHOOSE", 1)]).toBe(false);
    // Nạn nhân bầy hiện ở đúng ghế của p3.
    const names = observationFeatureNames();
    expect(encoded.features[names.indexOf("seat1:isWolfTarget")]).toBe(1);
    expect(encoded.features[names.indexOf("seat1:threat")]).toBeCloseTo(0.6);

    const heal = encodeObservation({
      ...witch,
      selectedAction: { decision: "NIGHT", targetId: null, label: "HEAL", kind: "HEAL" },
    });
    expect(heal.actionIndex).toBe(actionIndexOf("HEAL", DEFAULT_MAX_SEATS));

    // "Giữ thuốc" là một nhãn thật, không phải dòng bị bỏ.
    const hold = {
      ...witch,
      selectedAction: { decision: "NIGHT", targetId: null, label: "bỏ lượt", kind: null },
    };
    expect(encodeObservation(hold).actionIndex).toBe(actionIndexOf("SKIP", DEFAULT_MAX_SEATS));
    expect(validateTrajectoryLine(hold).violations).toEqual([]);
  });

  it("ba đầu vào của scorer đêm nằm đúng ghế: informationValue, claimedPowerRole, guardedBefore", () => {
    const encoded = encodeObservation(line());
    const names = observationFeatureNames();
    // seats = [p2, p3, p1]
    expect(encoded.features[names.indexOf("seat2:claimedPowerRole")]).toBe(1); // p1 đã khai
    expect(encoded.features[names.indexOf("seat1:claimedPowerRole")]).toBe(0);
    expect(encoded.features[names.indexOf("seat1:guardedBefore")]).toBe(1); // p3 từng được canh
    expect(encoded.features[names.indexOf("seat2:informationValue")]).toBeCloseTo(0.4);
    // Trace cũ không có ba trường này → 0, không ném.
    const legacy = line({
      observation: {
        ...line().observation,
        belief: line().observation.belief.map(({ informationValue, claimedPowerRole, guardedBefore, ...rest }) => rest) as never,
      },
    });
    expect(encodeObservation(legacy).features[names.indexOf("seat2:claimedPowerRole")]).toBe(0);
    expect(validateTrajectoryLine(legacy).valid).toBe(true);
    // Kiểu sai thì validator bắt.
    const bad = line({
      observation: {
        ...line().observation,
        belief: [{ ...line().observation.belief[0]!, claimedPowerRole: "yes" as never }],
      },
    });
    expect(validateTrajectoryLine(bad).valid).toBe(false);
  });

  it("vai không có lượt đêm: không nhãn, không vi phạm", () => {
    const idle = line({
      phase: "NIGHT",
      decision: "NIGHT",
      observation: { ...line().observation, legalActions: [], nightLegalTargets: null },
      legalActions: [],
      selectedAction: { decision: "NIGHT", targetId: null, label: "bỏ lượt", kind: null },
    });
    expect(encodeObservation(idle).actionIndex).toBeNull();
    expect(validateTrajectoryLine(idle).valid).toBe(true);
  });

  it("mọi NightActionKind đều có chỗ trong trục loại", () => {
    for (const kind of ["KILL", "SEE", "GUARD", "HEAL", "POISON", "SKIP", "DETECTIVE_CHECK", "TRACK"]) {
      expect(ACTION_KINDS).toContain(kind);
    }
  });

  it("actionIndex trỏ đúng ghế đã chọn, và null khi hành động ngoài tập hợp lệ", () => {
    expect(encodeObservation(line()).actionIndex).toBe(2); // p1 ở ghế 2
    const illegal = line({ selectedAction: { decision: "VOTE", targetId: "p9", label: "bầu", kind: null } });
    expect(encodeObservation(illegal).actionIndex).toBeNull();
  });

  it("bỏ phiếu 'không treo ai' ánh xạ vào ô cuối", () => {
    const none = line({ selectedAction: { decision: "VOTE", targetId: null, label: "không treo", kind: null } });
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

  it("TỪ CHỐI dân làng thấy nạn nhân bầy / bình thuốc / người Bảo Vệ đã canh", () => {
    const wolfTarget = line({ observation: { ...line().observation, nightWolfTarget: "p1" } });
    expect(validateTrajectoryLine(wolfTarget).violations.map((v) => v.kind)).toEqual(["leak"]);
    const potion = line({ observation: { ...line().observation, healUsed: true } });
    expect(validateTrajectoryLine(potion).violations.map((v) => v.kind)).toEqual(["leak"]);
    const guard = line({ observation: { ...line().observation, guardPrevious: "p1" } });
    expect(validateTrajectoryLine(guard).violations.map((v) => v.kind)).toEqual(["leak"]);

    // Cùng những trường đó là hợp lệ với đúng vai.
    const witch = line({
      observation: {
        ...line().observation,
        knownRoles: { p2: "WITCH" as Role },
        nightWolfTarget: "p1",
        healUsed: true,
      },
    });
    expect(validateTrajectoryLine(witch).valid).toBe(true);
  });

  it("TỪ CHỐI trường lạ trong observation — kể cả nhãn kết cục (§44)", () => {
    const leaked = line();
    (leaked.observation as unknown as Record<string, unknown>).finalWinner = "village";
    const report = validateTrajectoryLine(leaked);
    expect(report.valid).toBe(false);
    expect(report.violations[0]?.kind).toBe("leak");
  });

  it("TỪ CHỐI hành động ngoài tập hợp lệ (§42)", () => {
    const illegal = line({ selectedAction: { decision: "VOTE", targetId: "p9", label: "bầu", kind: null } });
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

  it("trần độ khớp: đếm nước đi trùng argmax(điểm − jitter), bỏ line không có ứng viên", () => {
    const candidates = [
      { targetId: "p1", score: 50, terms: [{ name: "belief", value: 60 }, { name: "jitter", value: -10 }], evidenceIds: [] },
      { targetId: "p3", score: 55, terms: [{ name: "belief", value: 10 }, { name: "jitter", value: 45 }], evidenceIds: [] },
    ];
    const stats = summarizeDataset([
      // Bot chọn p1 = argmax không jitter → khớp.
      line({ candidates }),
      // Bot chọn p3 (thắng nhờ jitter) → không khớp: phần model không học được.
      line({ candidates, selectedAction: { decision: "VOTE", targetId: "p3", label: "bầu", kind: null } }),
      // Không có ứng viên → không tính vào trần.
      line({ turn: 4 }),
    ]);
    expect(stats.teacherCeiling).toEqual({ rows: 2, matched: 1 });
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

  it("optimalActionMask: mọi ứng viên hoà đỉnh (bỏ jitter) đều là tối ưu; không ứng viên → chỉ ô đã chọn", () => {
    const tied = line({
      candidates: [
        { targetId: "p1", score: 50, terms: [{ name: "belief", value: 40 }, { name: "jitter", value: 10 }], evidenceIds: [] },
        { targetId: "p3", score: 40, terms: [{ name: "belief", value: 40 }, { name: "jitter", value: 0 }], evidenceIds: [] },
      ],
    });
    const enc = encodeObservation(tied);
    const opt = optimalActionMask(tied, enc);
    // seats = [p2, p3, p1] → p3 ghế 1, p1 ghế 2; cả hai hoà 40 sau khi bỏ jitter.
    expect(opt[actionIndexOf("CHOOSE", 1)]).toBe(true);
    expect(opt[actionIndexOf("CHOOSE", 2)]).toBe(true);
    expect(opt.filter(Boolean)).toHaveLength(2);
    expect(opt[enc.actionIndex!]).toBe(true);

    const none = line({ selectedAction: { decision: "VOTE", targetId: null, label: "không treo", kind: null } });
    const encNone = encodeObservation(none);
    const optNone = optimalActionMask(none, encNone);
    expect(optNone.filter(Boolean)).toHaveLength(1);
    expect(optNone[encNone.actionIndex!]).toBe(true);
  });

  it("candidateScores: điểm teacher BỎ jitter ở đúng ô của từng ứng viên, NaN ở mọi ô khác", () => {
    const scored = line({
      candidates: [
        { targetId: "p1", score: 50, terms: [{ name: "belief", value: 40 }, { name: "jitter", value: 10 }], evidenceIds: [] },
        { targetId: "p3", score: 33, terms: [{ name: "belief", value: 33 }, { name: "jitter", value: 0 }], evidenceIds: [] },
      ],
    });
    const enc = encodeObservation(scored);
    const scores = candidateScores(scored, enc);
    expect(scores).toHaveLength(actionSize());
    // seats = [p2, p3, p1]: p3 ghế 1 → 33, p1 ghế 2 → 40 (bỏ jitter 10).
    expect(scores[actionIndexOf("CHOOSE", 1)]).toBe(33);
    expect(scores[actionIndexOf("CHOOSE", 2)]).toBe(40);
    expect(scores.filter((v) => !Number.isNaN(v))).toHaveLength(2);
    // Ô "không treo ai" hợp lệ nhưng không phải ứng viên → NaN, không phải 0.
    expect(Number.isNaN(scores[actionIndexOf("CHOOSE", DEFAULT_MAX_SEATS)])).toBe(true);

    // Không có bảng ứng viên → toàn NaN, kể cả ô đã chọn: không bịa điểm.
    const bare = line({ candidates: [] });
    expect(candidateScores(bare, encodeObservation(bare)).every((v) => Number.isNaN(v))).toBe(true);
  });

  it("candidateBases: điểm THẬT (giữ jitter) ở cùng ô — điểm nền của residual", () => {
    const scored = line({
      candidates: [
        { targetId: "p1", score: 50, terms: [{ name: "belief", value: 40 }, { name: "jitter", value: 10 }], evidenceIds: [] },
        { targetId: "p3", score: 33, terms: [{ name: "belief", value: 33 }, { name: "jitter", value: 0 }], evidenceIds: [] },
      ],
    });
    const enc = encodeObservation(scored);
    const bases = candidateBases(scored, enc);
    const scores = candidateScores(scored, enc);
    expect(bases[actionIndexOf("CHOOSE", 1)]).toBe(33);
    expect(bases[actionIndexOf("CHOOSE", 2)]).toBe(50);
    expect(scores[actionIndexOf("CHOOSE", 2)]).toBe(40);
    expect(bases.filter((v) => !Number.isNaN(v))).toHaveLength(2);
    expect(bases.map((v) => Number.isNaN(v))).toEqual(scores.map((v) => Number.isNaN(v)));
  });
});
