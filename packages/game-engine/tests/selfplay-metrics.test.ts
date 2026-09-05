import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { collectMetrics } from "../src/bot/evaluation/metrics";
import { runSelfPlay, type SelfPlayEvent, type SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { BOT_WEIGHTS_V1, resolveWeights } from "../src/bot/config/weights";

/** Ván dựng tay: mọi số liệu dưới đây tính được bằng đầu. */
function game(over: Partial<SelfPlayGame> = {}): SelfPlayGame {
  return {
    record: {
      seed: "unit",
      playerCount: 4,
      config: {} as SelfPlayGame["record"]["config"],
      weightsVersion: "1.0.0",
      maxRounds: 20,
      events: false,
      speech: true,
    },
    winner: "village",
    rounds: 3,
    actions: 10,
    rejected: 0,
    skipped: 0,
    events: [],
    violations: [],
    traces: [],
    roles: {
      w1: "WEREWOLF",
      w2: "WEREWOLF",
      v1: "VILLAGER",
      v2: "SEER",
    } as Record<string, Role>,
    ...over,
  };
}

function vote(
  round: number,
  voterId: string,
  targetId: string | null,
  over: Partial<Extract<SelfPlayEvent, { kind: "VOTE" }>> = {},
): SelfPlayEvent {
  return { kind: "VOTE", round, voterId, targetId, changed: false, evidence: [], ...over };
}

let speechSeq = 0;

/** Một lượt nói tối thiểu; mọi trường hội thoại để mặc định "tự mở lời". */
export function speechEvent(
  round: number,
  actorId: string,
  targetId: string | null,
  over: Partial<Extract<SelfPlayEvent, { kind: "SPEECH" }>> = {},
): SelfPlayEvent {
  speechSeq += 1;
  const text = over.text ?? `câu ${speechSeq}`;
  return {
    kind: "SPEECH",
    round,
    actorId,
    messageId: `m${speechSeq}`,
    speech: "ACCUSE",
    targetId,
    replyToMessageId: null,
    chainDepth: 0,
    tone: "FIRM",
    text,
    textFingerprint: `fp${speechSeq}`,
    semanticFingerprint: `sem${speechSeq}`,
    evidenceSourceIds: [],
    fromTemplate: true,
    claimedRole: null,
    ...over,
  };
}

describe("mẫu số luôn hiện rõ", () => {
  it("mẫu số 0 cho ra null, không phải 0 và không phải NaN", () => {
    // "Chưa đo được" và "bằng không" là hai kết luận khác hẳn nhau. Một `0`
    // giả ở đây sẽ được đọc là "Dân không bao giờ bỏ phiếu đúng".
    const { overall } = collectMetrics([game({ events: [] })]);
    expect(overall.villageVoteAccuracy).toEqual({
      value: null,
      numerator: 0,
      denominator: 0,
    });
    expect(overall.consensus).toBeNull();
    expect(Number.isNaN(overall.voteChangeRate.value as number)).toBe(false);
  });

  it("mọi tỉ lệ mang theo tử số và mẫu số", () => {
    const { overall } = collectMetrics([game()]);
    for (const key of [
      "villageVoteAccuracy",
      "wolfSelfSabotage",
      "voteChangeRate",
      "staleEvidenceRate",
      "speechRepetitionRate",
      "roundLimitRate",
    ] as const) {
      expect(Object.keys(overall[key]).sort()).toEqual([
        "denominator",
        "numerator",
        "value",
      ]);
    }
  });
});

describe("từng chỉ số tính đúng trên ván dựng tay", () => {
  it("win rate theo phe, mẫu số là số ván ĐÃ kết thúc", () => {
    const { overall } = collectMetrics([
      game({ winner: "village" }),
      game({ winner: "wolves" }),
      game({ winner: "wolves" }),
      game({ winner: null }),
    ]);
    expect(overall.games).toBe(4);
    expect(overall.finished).toBe(3);
    expect(overall.winRate.village).toEqual({ value: 1 / 3, numerator: 1, denominator: 3 });
    expect(overall.winRate.wolves).toEqual({ value: 2 / 3, numerator: 2, denominator: 3 });
  });

  it("win rate theo vai", () => {
    const { byRole } = collectMetrics([game({ winner: "village" }), game({ winner: "wolves" })]);
    const seer = byRole.find((item) => item.role === "SEER")!;
    const wolf = byRole.find((item) => item.role === "WEREWOLF")!;
    expect(seer.wins).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
    expect(wolf.wins).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("byRole có thứ tự ổn định", () => {
    // Thứ tự chèn của Map phụ thuộc vào ván nào chạy trước; đó là một nguồn
    // khác biệt giả giữa hai lần chạy cùng batch.
    const roles = collectMetrics([game()]).byRole.map((item) => item.role);
    expect(roles).toEqual([...roles].sort());
  });

  it("số vòng trung bình chỉ tính ván đã kết thúc", () => {
    const { overall } = collectMetrics([
      game({ winner: "village", rounds: 2 }),
      game({ winner: "wolves", rounds: 6 }),
      game({ winner: null, rounds: 20 }),
    ]);
    expect(overall.averageRounds).toBe(4);
  });

  it("độ chính xác phiếu của Dân chỉ tính LÁ CHỐT", () => {
    // v1 đổi phiếu từ v2 (sai) sang w1 (đúng): chỉ lá cuối được tính.
    const { overall } = collectMetrics([
      game({
        events: [
          vote(1, "v1", "v2"),
          vote(1, "v1", "w1", { changed: true }),
          vote(1, "v2", "w2"),
        ],
      }),
    ]);
    expect(overall.villageVoteAccuracy).toEqual({ value: 1, numerator: 2, denominator: 2 });
  });

  it("phiếu không nhắm ai không vào mẫu số của độ chính xác", () => {
    const { overall } = collectMetrics([
      game({ events: [vote(1, "v1", null), vote(1, "v2", "w1")] }),
    ]);
    expect(overall.villageVoteAccuracy).toEqual({ value: 1, numerator: 1, denominator: 1 });
  });

  it("Sói tự phá: bỏ phiếu cho đồng bọn", () => {
    const { overall } = collectMetrics([
      game({ events: [vote(1, "w1", "w2"), vote(1, "w2", "v1")] }),
    ]);
    expect(overall.wolfSelfSabotage).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("Sói tự phá: công khai tố đồng bọn", () => {
    const { overall } = collectMetrics([
      game({
        events: [speechEvent(1, "w1", "w2"), speechEvent(1, "w2", "v1")],
      }),
    ]);
    expect(overall.wolfSelfSabotage).toEqual({ value: 0.5, numerator: 1, denominator: 2 });
  });

  it("tỉ lệ đổi phiếu", () => {
    const { overall } = collectMetrics([
      game({
        events: [vote(1, "v1", "w1"), vote(1, "v1", "w2", { changed: true }), vote(1, "v2", "w1")],
      }),
    ]);
    expect(overall.voteChangeRate).toEqual({ value: 1 / 3, numerator: 1, denominator: 3 });
  });

  it("đồng thuận: phiếu cho người dẫn đầu trên số người bỏ phiếu", () => {
    const { overall } = collectMetrics([
      game({ events: [vote(1, "v1", "w1"), vote(1, "v2", "w1"), vote(1, "w1", "v1")] }),
    ]);
    expect(overall.consensus).toBeCloseTo(2 / 3, 10);
  });

  it("độ gắn kết coalition là trung bình các quan sát", () => {
    const { overall } = collectMetrics([
      game({
        events: [
          { kind: "COALITION", round: 1, observerId: "v1", size: 2, cohesion: 0.2 },
          { kind: "COALITION", round: 1, observerId: "v2", size: 3, cohesion: 0.4 },
        ],
      }),
    ]);
    expect(overall.coalitionCohesion).toBeCloseTo(0.3, 10);
  });

  it("bằng chứng hết hạn: miễn trừ những kind vĩnh viễn", () => {
    // Kết quả soi là sự thật đã xác lập, không phải ấn tượng; nó đáng nhớ mãi
    // và không được tính là "biện luận bằng chuyện cũ".
    const { overall } = collectMetrics([
      game({
        events: [
          vote(9, "v1", "w1", {
            evidence: [
              { round: 1, kind: "ACCUSE" },
              { round: 1, kind: "SEER_RESULT_WOLF" },
              { round: 8, kind: "ACCUSE" },
            ],
          }),
        ],
      }),
    ]);
    expect(overall.staleEvidenceRate).toEqual({ value: 1 / 3, numerator: 1, denominator: 3 });
  });

  it("ngưỡng hết hạn đến từ cấu hình trọng số", () => {
    const events = [vote(9, "v1", "w1", { evidence: [{ round: 5, kind: "ACCUSE" }] })];
    expect(collectMetrics([game({ events })]).overall.staleEvidenceRate.numerator).toBe(1);
    expect(
      collectMetrics([game({ events })], resolveWeights({ recency: { staleAfterRounds: 10 } }))
        .overall.staleEvidenceRate.numerator,
    ).toBe(0);
  });

  it("lặp lời thoại: nói lại đúng kiểu và mục tiêu của lần trước", () => {
    const speech = (round: number, actorId: string, targetId: string): SelfPlayEvent =>
      speechEvent(round, actorId, targetId);
    const { overall } = collectMetrics([
      game({
        roles: { v1: "VILLAGER", v2: "VILLAGER" } as Record<string, Role>,
        events: [speech(1, "v1", "x"), speech(2, "v1", "x"), speech(3, "v1", "y")],
      }),
    ]);
    expect(overall.speechRepetitionRate).toEqual({ value: 1 / 3, numerator: 1, denominator: 3 });
  });

  it("vi phạm ranh giới hiểu biết được đếm riêng và phải bằng 0", () => {
    const { overall } = collectMetrics([game()]);
    expect(overall.knowledgeBoundaryViolations).toBe(0);
  });

  it("nước đi bị từ chối tách khỏi lượt chủ động bỏ", () => {
    // Gộp chúng lại thì Linh Mục giữ bình - nước đi ĐÚNG của vai đó - sẽ được
    // đếm y như một bug của lõi.
    const { overall } = collectMetrics([game({ rejected: 2, skipped: 5 })]);
    expect(overall.fallbackActions).toBe(2);
    expect(overall.declinedTurns).toBe(5);
  });

  it("tỉ lệ chạm trần vòng", () => {
    const capped = game({
      winner: null,
      violations: [
        {
          id: "ROUND_LIMIT",
          seed: "x",
          record: game().record,
          round: 20,
          phase: "VOTING",
          playerId: null,
          expected: "",
          actual: "",
          events: [],
        },
      ],
    });
    const { overall } = collectMetrics([game(), capped, game()]);
    expect(overall.roundLimitRate).toEqual({ value: 1 / 3, numerator: 1, denominator: 3 });
  });
});

describe("trên ván thật", () => {
  const SEEDS = Array.from({ length: 20 }, (_, i) => `metric-${i}`);
  const games = SEEDS.map((seed) => runSelfPlay({ seed, weights: BOT_WEIGHTS_V1 }));

  it("metrics tất định với cùng batch", () => {
    const again = SEEDS.map((seed) => runSelfPlay({ seed, weights: BOT_WEIGHTS_V1 }));
    expect(collectMetrics(again)).toEqual(collectMetrics(games));
  });

  it("không vi phạm ranh giới hiểu biết nào", () => {
    expect(collectMetrics(games).overall.knowledgeBoundaryViolations).toBe(0);
  });

  it("mọi tỉ lệ nằm trong [0, 1] hoặc là null", () => {
    const { overall } = collectMetrics(games);
    for (const item of [
      overall.villageVoteAccuracy,
      overall.wolfSelfSabotage,
      overall.voteChangeRate,
      overall.staleEvidenceRate,
      overall.speechRepetitionRate,
      overall.roundLimitRate,
      overall.winRate.village,
      overall.winRate.wolves,
    ]) {
      if (item.value === null) continue;
      expect(item.value).toBeGreaterThanOrEqual(0);
      expect(item.value).toBeLessThanOrEqual(1);
    }
  });

  it("sự thật về vai CHỈ được dùng ở tầng đo", () => {
    // `roles` có mặt trong kết quả để tính độ chính xác phiếu, nhưng không BOT
    // nào được thấy nó. Kiểm gián tiếp nhưng chắc: nếu BOT đọc được sự thật thì
    // Dân đã bỏ phiếu đúng gần như tuyệt đối.
    const accuracy = collectMetrics(games).overall.villageVoteAccuracy.value;
    expect(accuracy).not.toBeNull();
    expect(accuracy!).toBeLessThan(0.9);
  });

  it("BOT có đổi phiếu, và không phải lúc nào cũng đổi", () => {
    const rate = collectMetrics(games).overall.voteChangeRate.value;
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0);
    expect(rate!).toBeLessThan(1);
  });
});
