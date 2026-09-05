import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { collectMetrics } from "../src/bot/evaluation/metrics";
import { runBatch } from "../src/bot/evaluation/report";
import {
  runSelfPlay,
  type QuestionOutcome,
  type SelfPlayEvent,
  type SelfPlayGame,
} from "../src/bot/evaluation/selfplay";
import { speechTextFingerprint } from "../src/bot/conversation/fingerprint";
import { BOT_WEIGHTS_V17 } from "../src/bot/config/weights";

/**
 * Chỉ số "vì sao bot không đáp" và hai chỉ số kỹ năng tách ngăn (Phù Thuỷ giữ
 * bình, Tiên Tri chết sau khai).
 *
 * Nguyên tắc chung của mọi test ở đây: MẪU SỐ đúng, các ngăn RỜI NHAU và phủ
 * kín, và mẫu số 0 cho ra `null` chứ không phải 0. Một tỉ lệ đẹp trên một mẫu
 * số sai vẫn là một con số sai.
 */

function game(over: Partial<SelfPlayGame> = {}): SelfPlayGame {
  return {
    record: {
      seed: "qo",
      playerCount: 8,
      config: {} as SelfPlayGame["record"]["config"],
      weightsVersion: BOT_WEIGHTS_V17.version,
      maxRounds: 20,
      events: false,
      speech: true,
    },
    winner: "village",
    rounds: 3,
    actions: 0,
    rejected: 0,
    skipped: 0,
    events: [],
    violations: [],
    traces: [],
    roles: { s: "SEER", wt: "WITCH", v1: "VILLAGER", w1: "WEREWOLF", w2: "WEREWOLF" } as Record<
      string,
      Role
    >,
    ...over,
  };
}

function outcome(round: number, outcome: QuestionOutcome, seq: number): SelfPlayEvent {
  return {
    kind: "QUESTION_OUTCOME",
    round,
    messageId: `q${seq}`,
    askerId: "v1",
    targetId: "w1",
    outcome,
  };
}

function death(round: number, playerId: string, cause: string): SelfPlayEvent {
  return { kind: "DEATH", round, playerId, cause };
}

function claim(round: number, actorId: string, seq: number): SelfPlayEvent {
  const text = "Tôi là Tiên Tri.";
  return {
    kind: "SPEECH",
    round,
    actorId,
    messageId: `c${seq}`,
    speech: "CLAIM_ROLE",
    targetId: null,
    replyToMessageId: null,
    chainDepth: 0,
    tone: "FIRM",
    text,
    textFingerprint: speechTextFingerprint(text),
    semanticFingerprint: "claim",
    evidenceSourceIds: [],
    fromTemplate: true,
    claimedRole: "SEER",
  };
}

function hold(
  round: number,
  topSuspectId: string | null,
  topSuspicion = 50,
  vetoedByTrust = false,
): SelfPlayEvent {
  return {
    kind: "WITCH_HOLD",
    round,
    actorId: "wt",
    topSuspectId,
    topSuspicion,
    threshold: 85,
    vetoedByTrust,
  };
}

describe("số phận câu hỏi trực tiếp", () => {
  it("bảy ngăn dùng chung một mẫu số và cộng lại bằng 1", () => {
    const { overall } = collectMetrics([
      game({
        events: [
          outcome(1, "ANSWERED", 1),
          outcome(1, "ANSWERED", 2),
          outcome(1, "NOT_PARSED", 3),
          outcome(2, "NO_TURN", 4),
          outcome(2, "DECLINED_SPOKE_OTHER", 5),
          outcome(2, "DECLINED_SILENT", 6),
          outcome(3, "BLOCKED_ROOM", 7),
          outcome(3, "UNDETERMINED", 8),
        ],
      }),
    ]);
    const buckets = overall.directQuestionOutcomes;
    for (const ratio of Object.values(buckets)) expect(ratio.denominator).toBe(8);
    expect(buckets.ANSWERED.numerator).toBe(2);
    const sum = Object.values(buckets).reduce((acc, ratio) => acc + (ratio.value ?? 0), 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("không có câu hỏi nào thì mọi ngăn là null, không phải 0%", () => {
    const { overall } = collectMetrics([game()]);
    for (const ratio of Object.values(overall.directQuestionOutcomes)) {
      expect(ratio).toEqual({ value: null, numerator: 0, denominator: 0 });
    }
    expect(overall.speechBlockedByRoom).toEqual({
      BUDGET: 0,
      CHAIN_DEPTH: 0,
      REPLIES_PER_MESSAGE: 0,
    });
  });

  it("câu bị phòng chặn được đếm theo lý do", () => {
    const blocked = (reason: "BUDGET" | "CHAIN_DEPTH" | "REPLIES_PER_MESSAGE"): SelfPlayEvent => ({
      kind: "SPEECH_BLOCKED",
      round: 1,
      actorId: "v1",
      speech: "REPLY",
      replyToMessageId: "q1",
      reason,
    });
    const { overall } = collectMetrics([
      game({ events: [blocked("BUDGET"), blocked("BUDGET"), blocked("CHAIN_DEPTH")] }),
    ]);
    expect(overall.speechBlockedByRoom).toEqual({
      BUDGET: 2,
      CHAIN_DEPTH: 1,
      REPLIES_PER_MESSAGE: 0,
    });
  });
});

describe("harness chốt số phận câu hỏi", () => {
  // Nhiều ván, để chắc chắn có cả câu hỏi được đáp và câu hỏi không được đáp.
  // `messageId` chỉ duy nhất TRONG một ván, nên mọi phép so ở đây đi theo ván.
  const games = runBatch({ seedBase: "qo-harness", games: 6, playerCount: 8 });
  const outcomesOf = (g: SelfPlayGame) =>
    g.events.flatMap((e) => (e.kind === "QUESTION_OUTCOME" ? [e] : []));
  const questionsOf = (g: SelfPlayGame) =>
    g.events.filter(
      (e) =>
        e.kind === "SPEECH" &&
        (e.speech === "QUESTION" || e.speech === "ASK_EVIDENCE") &&
        e.targetId !== null,
    );

  it("mỗi câu hỏi trực tiếp được chốt đúng MỘT lần", () => {
    let total = 0;
    for (const g of games) {
      const outcomes = outcomesOf(g);
      total += outcomes.length;
      expect(outcomes.length).toBe(questionsOf(g).length);
      expect(new Set(outcomes.map((e) => e.messageId)).size).toBe(outcomes.length);
    }
    expect(total).toBeGreaterThan(0);
  });

  it("ngăn ANSWERED khớp với cách đo độc lập bằng replyToMessageId", () => {
    const { overall } = collectMetrics(games);
    expect(overall.directQuestionOutcomes.ANSWERED.numerator).toBe(
      overall.directQuestionResponseRate.numerator,
    );
    expect(overall.directQuestionOutcomes.ANSWERED.denominator).toBe(
      overall.directQuestionResponseRate.denominator,
    );
  });

  it("chỉ ANSWERED mới có câu đáp của người được hỏi trỏ tới câu hỏi", () => {
    // Bằng chứng đọc được từ log: mọi ngăn khác không thể có câu đáp như vậy.
    for (const g of games) {
      for (const item of outcomesOf(g)) {
        const replied = g.events.some(
          (e) =>
            e.kind === "SPEECH" &&
            e.actorId === item.targetId &&
            e.replyToMessageId === item.messageId,
        );
        expect(replied).toBe(item.outcome === "ANSWERED");
      }
    }
  });

  it(
    "--verify-replay mang theo humanSeats: bàn có cờ người thật tái lập không lệch",
    () => {
      // Trước bản sửa, lần chạy đối chứng bỏ quên `humanSeats` và ~15% ván bị
      // gắn REPLAY_DIVERGENCE giả; 30 ván x 2 lượt chạy là đủ để lỗi cũ lộ với
      // xác suất > 99%. Hạn giờ tường minh vì đây là phép đo theo batch, chậm
      // hơn hẳn mặc định 5s khi cả bộ test chạy song song.
      const games = runBatch({
        seedBase: "replay-check",
        games: 30,
        playerCount: 8,
        humanSeats: 4,
        verifyReplay: true,
      });
      const divergent = games.filter((g) => g.violations.some((v) => v.id === "REPLAY_DIVERGENCE"));
      expect(divergent.map((g) => g.record.seed)).toEqual([]);
    },
    60_000,
  );

  it("sổ theo dõi không đổi một sự kiện nào của ván (cùng seed, cùng chuỗi)", () => {
    // Các móc chỉ ĐỌC. Nếu chúng rút RNG hay đổi state, hai lần chạy khác nhau.
    const once = runSelfPlay({ seed: "qo-harness:0", playerCount: 8 });
    const twice = runSelfPlay({ seed: "qo-harness:0", playerCount: 8 });
    expect(JSON.stringify(twice.events)).toBe(JSON.stringify(once.events));
  });
});

describe("Phù Thuỷ giữ bình: ba ngăn rời nhau", () => {
  it("tổng ba ngăn bằng số ván bình còn nguyên", () => {
    const { overall } = collectMetrics([
      // Ván 1: sống tới cuối, chưa đêm nào nghi nhất một con Sói.
      game({ events: [hold(1, "v1"), hold(2, "v1")] }),
      // Ván 2: chết đêm 2, chưa từng nghi nhất Sói.
      game({ events: [hold(1, "v1"), death(2, "wt", "wolves")] }),
      // Ván 3: có đêm nghi nhất đúng Sói mà vẫn giữ, rồi chết.
      game({ events: [hold(1, "v1"), hold(2, "w1", 70), death(3, "wt", "wolves")] }),
      // Ván 4: dùng bình - không nằm trong mẫu số "giữ tới cuối".
      game({
        events: [
          hold(1, "w2", 60),
          { kind: "NIGHT_ACTION", round: 2, actorId: "wt", action: "POISON", targetId: "w2" },
        ],
      }),
    ]);
    expect(overall.witchPoisonUnusedRate).toEqual({ value: 3 / 4, numerator: 3, denominator: 4 });
    expect(overall.witchPoisonUnusedNoTargetRate).toEqual({
      value: 1 / 3,
      numerator: 1,
      denominator: 3,
    });
    expect(overall.witchPoisonUnusedDiedEarlyRate).toEqual({
      value: 1 / 3,
      numerator: 1,
      denominator: 3,
    });
    expect(overall.witchPoisonUnusedTopWolfBelowBarRate).toEqual({
      value: 1 / 3,
      numerator: 1,
      denominator: 3,
    });
    // Đêm giữ bình đếm CẢ ván có dùng bình về sau: 6 đêm, 2 đêm nghi nhất là Sói.
    expect(overall.witchHoldTopWolfRate).toEqual({ value: 2 / 6, numerator: 2, denominator: 6 });
    // Khoảng cách tới ngưỡng chỉ tính trên hai đêm đó: (85-70) và (85-60).
    expect(overall.witchHoldWolfGapMean).toBeCloseTo((15 + 25) / 2);
    expect(overall.witchHoldVetoedByTrustRate).toEqual({ value: 0, numerator: 0, denominator: 6 });
  });

  it("đêm bị veto tin tưởng được đếm riêng", () => {
    const { overall } = collectMetrics([
      game({ events: [hold(1, "w1", 90, true), hold(2, "v1", 3)] }),
    ]);
    expect(overall.witchHoldVetoedByTrustRate).toEqual({
      value: 1 / 2,
      numerator: 1,
      denominator: 2,
    });
  });

  it("không có Phù Thuỷ thì mọi ngăn là null", () => {
    const { overall } = collectMetrics([
      game({ roles: { v1: "VILLAGER", w1: "WEREWOLF" } as Record<string, Role> }),
    ]);
    expect(overall.witchPoisonUnusedTopWolfBelowBarRate.value).toBeNull();
    expect(overall.witchHoldTopWolfRate.value).toBeNull();
    expect(overall.witchHoldWolfGapMean).toBeNull();
  });
});

describe("Tiên Tri chết sau khai vai: mẫu số đúng", () => {
  it("chỉ Tiên Tri còn sống bước vào đêm 2 mới vào mẫu số, chia theo đã/chưa khai R1", () => {
    const { overall } = collectMetrics([
      // Khai R1, chết đêm 2.
      game({ events: [claim(1, "s", 1), death(2, "s", "wolves")] }),
      // Khai R1, bị treo ngay R1: không có đêm 2 -> không vào mẫu số nào.
      game({ events: [claim(1, "s", 2), death(1, "s", "lynch")] }),
      // Khai R1, sống tới cuối.
      game({ events: [claim(1, "s", 3)] }),
      // Không khai R1, chết đêm 2.
      game({ events: [death(2, "s", "wolves")] }),
      // Không khai R1, chết đêm 1: chưa tới đêm 2 -> loại.
      game({ events: [death(1, "s", "wolves")] }),
      // Không khai, ván xong sau vòng 1: không có đêm 2 -> loại.
      game({ rounds: 1, events: [] }),
    ]);
    expect(overall.seerClaimedR1DiedNightTwoRate).toEqual({
      value: 1 / 2,
      numerator: 1,
      denominator: 2,
    });
    expect(overall.seerUnclaimedR1DiedNightTwoRate).toEqual({
      value: 1 / 1,
      numerator: 1,
      denominator: 1,
    });
    // Chỉ số cũ giữ nguyên định nghĩa: 2 Tiên Tri chết đêm 2 trên 6 ván có Tiên Tri.
    expect(overall.seerDiedNightTwoRate).toEqual({ value: 2 / 6, numerator: 2, denominator: 6 });
  });

  it("chết đêm ngay sau khai: dùng lời khai ĐẦU và đếm mỗi ván một lần", () => {
    const { overall } = collectMetrics([
      // Khai R2 (và khai lại R3), chết đêm 3: một lần, đúng.
      game({ events: [claim(2, "s", 1), claim(3, "s", 2), death(3, "s", "wolves")] }),
      // Khai R1, chết đêm 3: sống qua đêm sau khai -> vào mẫu số, không vào tử số.
      game({ events: [claim(1, "s", 3), death(3, "s", "wolves")] }),
      // Khai R2 rồi bị treo ngay R2: không có đêm sau khai -> loại.
      game({ events: [claim(2, "s", 4), death(2, "s", "lynch")] }),
      // Khai ở vòng cuối của ván: không có đêm sau -> loại.
      game({ rounds: 2, events: [claim(2, "s", 5)] }),
      // Chết đêm sau khai vì bị Thợ Săn bắn ban ngày -> không phải "đêm".
      game({ events: [claim(1, "s", 6), death(2, "s", "hunter")] }),
    ]);
    expect(overall.seerDiedNightAfterClaimRate).toEqual({
      value: 1 / 3,
      numerator: 1,
      denominator: 3,
    });
  });

  it("không có Tiên Tri nào khai thì là null", () => {
    const { overall } = collectMetrics([game()]);
    expect(overall.seerDiedNightAfterClaimRate.value).toBeNull();
    expect(overall.seerClaimedR1DiedNightTwoRate.value).toBeNull();
  });
});
