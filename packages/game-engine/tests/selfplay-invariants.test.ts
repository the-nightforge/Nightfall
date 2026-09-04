import { describe, expect, it } from "vitest";
import { PRESET_DECKS } from "@masoi/shared";
import type { Phase, PublicVoteChoice, Role } from "@masoi/shared";
import {
  createInvariantAuditor,
  type GroundTruth,
  type InvariantId,
} from "../src/bot/evaluation/invariants";
import {
  replayGame,
  runSelfPlay,
  type SelfPlayRecord,
} from "../src/bot/evaluation/selfplay";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type { BotBrainState, BotKnowledgeView, NightKnowledge } from "../src/bot/types";
import type { BotDecisionTrace } from "../src/bot/trace/trace";

const PLAYERS = ["me", "ally", "seer", "villager"];

const RECORD: SelfPlayRecord = {
  seed: "unit",
  playerCount: 4,
  config: {} as SelfPlayRecord["config"],
  weightsVersion: "1.0.0",
  maxRounds: 20,
  events: false,
  speech: true,
};

function truth(over: Partial<GroundTruth> = {}): GroundTruth {
  return {
    roles: {
      me: "VILLAGER",
      ally: "WEREWOLF",
      seer: "SEER",
      villager: "VILLAGER",
      ...over.roles,
    },
    alive: { me: true, ally: true, seer: true, villager: true, ...over.alive },
    // Các trường còn lại đi qua nguyên vẹn. Bản cũ chỉ ghép `roles` và `alive`,
    // nên mọi trường mới của `GroundTruth` bị âm thầm nuốt mất và test truyền
    // chúng vào sẽ đo một thứ khác với thứ nó tưởng.
    activeEventId: over.activeEventId,
    shadowedSeerResults: over.shadowedSeerResults,
    roleChangedIds: over.roleChangedIds,
  };
}

function night(over: Partial<NightKnowledge> = {}): NightKnowledge {
  return {
    bonusSecondTargetFor: null,
    canAct: true,
    legalActions: [],
    legalTargets: {
      KILL: [],
      SEE: [],
      GUARD: [],
      HEAL: [],
      POISON: [],
      SKIP: [],
      DETECTIVE_CHECK: [],
      GUARDIAN_PROTECT: [],
      HOLY_WATER: [],
      SERIAL_KILL: [],
      MEDIUM_CHECK: [],
    },
    wolfTarget: null,
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    wolvesLocked: false,
    ...over,
  };
}

function knowledge(over: Partial<BotKnowledgeView> = {}): BotKnowledgeView {
  return {
    dayOfTruthClaims: {},
    neutralRolesInPlay: [],
    activeEventId: null,
    botId: "me",
    round: 3,
    phase: "VOTING" as Phase,
    phaseStartedAt: 0,
    phaseEndsAt: 1_000,
    selfRole: "VILLAGER",
    players: PLAYERS.map((id) => ({ id, name: id, alive: true })),
    knownRoles: { me: "VILLAGER" },
    seerResult: null,
    night: null,
    trialAccusedId: null,
    canFinalVote: false,
    hunterShot: null,
    publicVoteHistory: [],
    currentVoteCounts: { players: {}, noElimination: 0 },
    hasVoted: false,
    myVote: null,
    legalVoteChoices: [] as PublicVoteChoice[],
    lastNightDeaths: [],
    ...over,
  };
}

function state(): BotBrainState {
  return createBotBrainState("me", createBotPersonality(createSeededRng("s")), PLAYERS);
}

function idsFrom(run: (a: ReturnType<typeof createInvariantAuditor>) => void): InvariantId[] {
  const auditor = createInvariantAuditor(RECORD);
  run(auditor);
  return auditor.violations.map((item) => item.id);
}

// ---------------------------------------------------------------------------
// Mỗi kiểm tra phải BẮT được lỗi mà nó tuyên bố bắt. Không có phần này thì một
// auditor luôn trả về mảng rỗng vẫn khiến mọi test batch xanh rực.
// ---------------------------------------------------------------------------

describe("từng bất biến đều bắt được lỗi cố ý", () => {
  it("ROLE_LEAK: dân làng biết vai người khác", () => {
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({ knownRoles: { me: "VILLAGER", seer: "SEER" } }),
          state(),
          truth(),
        ),
      ),
    ).toContain("ROLE_LEAK");
  });

  it("ROLE_LEAK: Sói được báo sai vai của đồng bọn", () => {
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({
            botId: "me",
            knownRoles: { me: "WEREWOLF", ally: "WOLF_CUB" },
          }),
          state(),
          truth({ roles: { me: "WEREWOLF", ally: "WEREWOLF" } as Record<string, Role> }),
        ),
      ),
    ).toContain("ROLE_LEAK");
  });

  it("Sói thấy đồng bọn là HỢP LỆ, không phải vi phạm", () => {
    // Một auditor báo động ở đây sẽ chôn vùi mọi vi phạm thật dưới nhiễu.
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({ knownRoles: { me: "WEREWOLF", ally: "WEREWOLF" } }),
          state(),
          truth({ roles: { me: "WEREWOLF", ally: "WEREWOLF" } as Record<string, Role> }),
        ),
      ),
    ).toEqual([]);
  });

  it("Sói Con và Sói tính CÙNG PHE, không so theo mã vai", () => {
    // Một kiểm tra chỉ so với "WEREWOLF" sẽ báo động giả ở đúng những cấu hình
    // vai mà nó cần bảo vệ nhất.
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({ knownRoles: { me: "WOLF_CUB", ally: "WEREWOLF" } }),
          state(),
          truth({ roles: { me: "WOLF_CUB", ally: "WEREWOLF" } as Record<string, Role> }),
        ),
      ),
    ).toEqual([]);
  });

  it("WOLF_ALLY_SCOPE: Sói đã chết vẫn thấy bầy", () => {
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({ knownRoles: { me: "WEREWOLF", ally: "WEREWOLF" } }),
          state(),
          truth({
            roles: { me: "WEREWOLF", ally: "WEREWOLF" } as Record<string, Role>,
            alive: { me: false },
          }),
        ),
      ),
    ).toContain("WOLF_ALLY_SCOPE");
  });

  it("DEAD_ROLE_REVEALED: vai người chết lộ trước GAME_OVER", () => {
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({ knownRoles: { me: "VILLAGER", seer: "SEER" } }),
          state(),
          truth({ alive: { seer: false } }),
        ),
      ),
    ).toContain("DEAD_ROLE_REVEALED");
  });

  it("SEER_RESULT_SCOPE: người không phải Tiên Tri nhận kết quả soi", () => {
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({ seerResult: { targetId: "ally", targetName: "A", isWolf: true, team: "wolves" } }),
          state(),
          truth(),
        ),
      ),
    ).toContain("SEER_RESULT_SCOPE");
  });

  it("SEER_RESULT_SCOPE: kết quả soi nói dối về sự thật", () => {
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({
            botId: "seer",
            selfRole: "SEER",
            knownRoles: { seer: "SEER" },
            seerResult: { targetId: "villager", targetName: "V", isWolf: true, team: "wolves" },
          }),
          state(),
          truth(),
        ),
      ),
    ).toContain("SEER_RESULT_SCOPE");
  });

  /*
   * Vai bị GHI ĐÈ giữa ván, không phải engine nói dối.
   *
   * `seerReadsAsWolf` chỉ chữa được vế trước khi đổi: soi một Kẻ Phản Bội ra
   * "không phải Sói" là ĐÚNG lúc soi. Sau `settleTraitor` thì vai đã là
   * `WEREWOLF`, và chính kết quả đúng ấy bị đem ra tố cáo - tái hiện được ở
   * preset 11 với `fam1-n11:56` và `fam2-n11:57`.
   */
  it("Kẻ Phản Bội đã thăng cấp: kết quả soi cũ được miễn trừ", () => {
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({
            botId: "seer",
            selfRole: "SEER",
            knownRoles: { seer: "SEER" },
            seerResult: { targetId: "ally", targetName: "A", isWolf: false, team: "village" },
          }),
          state(),
          truth({ roleChangedIds: new Set(["ally"]) }),
        ),
      ),
    ).not.toContain("SEER_RESULT_SCOPE");
  });

  it("miễn trừ chỉ áp cho người ĐÃ đổi vai, không phải mọi con Sói", () => {
    // Cùng một kết quả soi, chỉ khác việc `ally` có nằm trong tập đổi vai hay
    // không: thiếu phép kiểm này thì miễn trừ trên có thể là một cái gỡ chung.
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({
            botId: "seer",
            selfRole: "SEER",
            knownRoles: { seer: "SEER" },
            seerResult: { targetId: "ally", targetName: "A", isWolf: false, team: "village" },
          }),
          state(),
          truth(),
        ),
      ),
    ).toContain("SEER_RESULT_SCOPE");
  });

  it("Bóng Sói: kết quả đã bị đảo vẫn được miễn trừ ở những vòng SAU", () => {
    // Sự kiện Bóng Sói cố tình đảo kết quả soi. Kết quả sai đó nằm lại trong
    // knowledge của Tiên Tri suốt phần còn lại của ván, nhưng sự kiện chỉ sống
    // đúng một vòng. Miễn trừ theo sự kiện ĐANG hoạt động vì thế hết hiệu lực
    // trước khi lời nói dối hết hạn, và auditor tố cáo chính cái luật mà engine
    // đang thi hành đúng.
    const seerKnowledge = knowledge({
      botId: "seer",
      selfRole: "SEER",
      knownRoles: { seer: "SEER" },
      seerResult: { targetId: "villager", targetName: "V", isWolf: true, team: "wolves" },
    });

    expect(
      idsFrom((a) =>
        a.checkKnowledge(seerKnowledge, state(), truth({ activeEventId: null })),
      ),
    ).toContain("SEER_RESULT_SCOPE");

    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          seerKnowledge,
          state(),
          truth({
            activeEventId: null,
            shadowedSeerResults: new Set(["seer:villager"]),
          }),
        ),
      ),
    ).not.toContain("SEER_RESULT_SCOPE");
  });

  it("Bóng Sói: miễn trừ chỉ áp cho ĐÚNG kết quả đã bị đảo", () => {
    // Không được biến miễn trừ thành một công tắc tắt cả bất biến: một kết quả
    // khác, về một người khác, vẫn phải bị soi xét như thường.
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({
            botId: "seer",
            selfRole: "SEER",
            knownRoles: { seer: "SEER" },
            seerResult: { targetId: "villager", targetName: "V", isWolf: true, team: "wolves" },
          }),
          state(),
          truth({
            activeEventId: null,
            shadowedSeerResults: new Set(["seer:someone-else"]),
          }),
        ),
      ),
    ).toContain("SEER_RESULT_SCOPE");
  });

  it("Bóng Sói: miễn trừ KHÔNG che được việc sai chủ sở hữu", () => {
    // Ranh giới "ai được cầm kết quả soi" là bất biến an toàn thật sự và không
    // có sự kiện nào được phép phá nó.
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({ seerResult: { targetId: "ally", targetName: "A", isWolf: true, team: "wolves" } }),
          state(),
          truth({ shadowedSeerResults: new Set(["me:ally"]) }),
        ),
      ),
    ).toContain("SEER_RESULT_SCOPE");
  });

  it("ACTION_BY_DEAD: người chết được cấp lựa chọn phiếu", () => {
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({ legalVoteChoices: [{ type: "PLAYER", targetId: "ally" }] }),
          state(),
          truth({ alive: { me: false } }),
        ),
      ),
    ).toContain("ACTION_BY_DEAD");
  });

  it("ACTION_BY_DEAD: người chết gửi nước đi đêm", () => {
    expect(
      idsFrom((a) =>
        a.checkNightAction(
          knowledge({ phase: "NIGHT" as Phase }),
          {
            kind: "NIGHT_ACTION",
            action: "KILL",
            targetId: "seer",
            confidence: 0.5,
            evidence: [],
          },
          truth({ alive: { me: false } }),
        ),
      ),
    ).toContain("ACTION_BY_DEAD");
  });

  it("DEAD_TARGET: mục tiêu đêm đã chết", () => {
    expect(
      idsFrom((a) =>
        a.checkNightAction(
          knowledge({ phase: "NIGHT" as Phase }),
          {
            kind: "NIGHT_ACTION",
            action: "KILL",
            targetId: "seer",
            confidence: 0.5,
            evidence: [],
          },
          truth({ alive: { seer: false } }),
        ),
      ),
    ).toContain("DEAD_TARGET");
  });

  it("DEAD_TARGET: engine chào một mục tiêu đêm đã chết", () => {
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({
            phase: "NIGHT" as Phase,
            night: night({
              legalActions: ["KILL"],
              legalTargets: { ...night().legalTargets, KILL: ["seer"] },
            }),
          }),
          state(),
          truth({ alive: { seer: false } }),
        ),
      ),
    ).toContain("DEAD_TARGET");
  });

  /*
   * Bà Đồng LẬT bất biến chứ không được miễn trừ: ba phép kiểm dưới khoá cả hai
   * chiều. Bản đầu chỉ gỡ điều kiện đi, và khi đó một `MEDIUM_CHECK` nhắm người
   * còn sống - đúng thứ engine từ chối - sẽ đi qua auditor mà không ai kêu.
   */
  it("MEDIUM_CHECK nhắm người ĐÃ CHẾT là hợp lệ", () => {
    expect(
      idsFrom((a) =>
        a.checkNightAction(
          knowledge({ phase: "NIGHT" as Phase }),
          {
            kind: "NIGHT_ACTION",
            action: "MEDIUM_CHECK",
            targetId: "seer",
            confidence: 0.5,
            evidence: [],
          },
          truth({ alive: { seer: false } }),
        ),
      ),
    ).not.toContain("DEAD_TARGET");
  });

  it("DEAD_TARGET: MEDIUM_CHECK nhắm người còn sống", () => {
    expect(
      idsFrom((a) =>
        a.checkNightAction(
          knowledge({ phase: "NIGHT" as Phase }),
          {
            kind: "NIGHT_ACTION",
            action: "MEDIUM_CHECK",
            targetId: "seer",
            confidence: 0.5,
            evidence: [],
          },
          truth(),
        ),
      ),
    ).toContain("DEAD_TARGET");
  });

  it("DEAD_TARGET: engine chào một hồn còn sống cho Bà Đồng", () => {
    expect(
      idsFrom((a) =>
        a.checkKnowledge(
          knowledge({
            phase: "NIGHT" as Phase,
            night: night({
              legalActions: ["MEDIUM_CHECK"],
              legalTargets: { ...night().legalTargets, MEDIUM_CHECK: ["seer"] },
            }),
          }),
          state(),
          truth(),
        ),
      ),
    ).toContain("DEAD_TARGET");
  });

  it("FUTURE_EVIDENCE: bằng chứng mang round tương lai", () => {
    const brain = state();
    brain.suspicion.ally = {
      score: 10,
      // Một evidence từ tương lai được MIỄN DECAY vĩnh viễn, vì
      // `age = max(0, round - lastUpdated)` kẹp ở 0.
      reasons: [
        {
          id: "x",
          kind: "ACCUSE",
          sourceId: "s",
          actorId: "ally",
          weight: 1,
          confidence: 0.5,
          round: 99,
          summary: "",
        },
      ],
      lastUpdatedRound: 99,
    };
    expect(idsFrom((a) => a.checkKnowledge(knowledge(), brain, truth()))).toContain(
      "FUTURE_EVIDENCE",
    );
  });

  it("NUMERIC_SANITY: belief là NaN", () => {
    const brain = state();
    brain.suspicion.ally = { score: Number.NaN, reasons: [], lastUpdatedRound: 1 };
    expect(idsFrom((a) => a.checkKnowledge(knowledge(), brain, truth()))).toContain(
      "NUMERIC_SANITY",
    );
  });

  it("NUMERIC_SANITY: confidence của nước đi đêm ngoài [0, 1]", () => {
    expect(
      idsFrom((a) =>
        a.checkNightAction(
          knowledge({ phase: "NIGHT" as Phase }),
          {
            kind: "NIGHT_ACTION",
            action: "KILL",
            targetId: "seer",
            confidence: 1.5,
            evidence: [],
          },
          truth(),
        ),
      ),
    ).toContain("NUMERIC_SANITY");
  });

  it("ROLE_LEAK: trace chứa vai không được phép", () => {
    const trace: BotDecisionTrace = {
      botId: "me",
      round: 1,
      phase: "VOTING" as Phase,
      decision: "VOTE",
      chosen: { targetId: "ally", label: "bầu" },
      candidates: [],
      beliefBefore: {},
      beliefAfter: {},
      personality: createBotPersonality(createSeededRng("p")),
      rngDraws: [],
      fallbackReason: null,
      knowledgeSnapshot: {
        aliveIds: PLAYERS,
        legalChoices: [],
        knownRoles: { me: "VILLAGER", seer: "SEER" },
        seerResult: null,
      },
    };
    expect(idsFrom((a) => a.checkTrace(trace, truth()))).toContain("ROLE_LEAK");
  });
});

describe("hành vi của auditor", () => {
  it("không ném, chỉ gom", () => {
    const auditor = createInvariantAuditor(RECORD);
    expect(() =>
      auditor.checkKnowledge(
        knowledge({ knownRoles: { me: "VILLAGER", seer: "SEER" } }),
        state(),
        truth(),
      ),
    ).not.toThrow();
    expect(auditor.violations.length).toBeGreaterThan(0);
  });

  it("không lặp lại cùng một vi phạm mỗi vòng", () => {
    // Một vi phạm lặp mỗi vòng sẽ nhấn chìm báo cáo của một batch 300 ván.
    const auditor = createInvariantAuditor(RECORD);
    for (let round = 1; round <= 10; round += 1) {
      auditor.checkKnowledge(
        knowledge({ round, knownRoles: { me: "VILLAGER", seer: "SEER" } }),
        state(),
        truth(),
      );
    }
    expect(auditor.violations.filter((item) => item.id === "ROLE_LEAK")).toHaveLength(1);
  });

  it("vi phạm mang đủ dữ liệu để chạy lại đúng ván đó", () => {
    const auditor = createInvariantAuditor(RECORD);
    auditor.note("vòng 3: ally bị nghi");
    auditor.checkKnowledge(
      knowledge({ knownRoles: { me: "VILLAGER", seer: "SEER" } }),
      state(),
      truth(),
    );

    const violation = auditor.violations[0];
    expect(violation.seed).toBe("unit");
    expect(violation.record).toEqual(RECORD);
    expect(violation.playerId).toBe("me");
    expect(violation.expected).toContain("không được biết vai");
    expect(violation.actual).toContain("SEER");
    expect(violation.events).toContain("vòng 3: ally bị nghi");
  });

  it("chỉ giữ ngữ cảnh gần nhất, không phải toàn bộ log", () => {
    const auditor = createInvariantAuditor(RECORD);
    for (let i = 0; i < 100; i += 1) auditor.note(`dòng ${i}`);
    auditor.checkKnowledge(
      knowledge({ knownRoles: { me: "VILLAGER", seer: "SEER" } }),
      state(),
      truth(),
    );
    expect(auditor.violations[0].events.length).toBeLessThanOrEqual(12);
    expect(auditor.violations[0].events.at(-1)).toBe("dòng 99");
  });
});

// ---------------------------------------------------------------------------
// Ván thật
// ---------------------------------------------------------------------------

describe("batch tự chơi", () => {
  const SEEDS = Array.from({ length: 30 }, (_, i) => `audit-${i}`);
  const games = SEEDS.map((seed) => runSelfPlay({ seed, trace: true }));

  it("không ván nào vi phạm bất biến", () => {
    const found = games.flatMap((game) =>
      game.violations.map((item) => `${item.seed} ${item.id}: ${item.actual}`),
    );
    expect(found).toEqual([]);
  });

  /*
   * Bộ bài MẶC ĐỊNH của runner không có Bà Đồng, Trưởng Lão hay Kẻ Song Trùng,
   * nên batch ngay trên chạy xanh suốt trong khi preset 17 vi phạm 9/10 ván.
   * Preset thật là chỗ DUY NHẤT ba lá đó gặp nhau, và cũng là chỗ duy nhất một
   * mục tiêu đêm hợp lệ lại là một người đã chết.
   *
   * Ít ván vì mỗi ván 17 người tốn hơn một giây: đây là hàng rào bắt một lớp
   * lỗi xảy ra ở gần như mọi ván, không phải một phép đo cân bằng.
   */
  it("preset có Bà Đồng cũng không vi phạm bất biến", () => {
    const found = Array.from({ length: 6 }, (_, i) =>
      runSelfPlay({ seed: `preset17-${i}`, playerCount: 17, config: PRESET_DECKS[17] }),
    ).flatMap((game) => game.violations.map((item) => `${item.seed} ${item.id}: ${item.actual}`));
    expect(found).toEqual([]);
    // Sáu ván 17 người tốn khoảng 6 giây, trên trần 5 giây mặc định của vitest.
  }, 30_000);

  it("không ván nào rò rỉ vai", () => {
    const leaks = games.flatMap((game) =>
      game.violations.filter(
        (item) => item.id === "ROLE_LEAK" || item.id === "DEAD_ROLE_REVEALED",
      ),
    );
    expect(leaks).toEqual([]);
  });

  it("batch chạy hết dù một ván có vi phạm", () => {
    // Ném sẽ dừng batch ở ván đầu tiên và giấu mất phần còn lại.
    const mixed = [
      runSelfPlay({ seed: "ok-1" }),
      runSelfPlay({ seed: "capped", maxRounds: 1 }),
      runSelfPlay({ seed: "ok-2" }),
    ];
    expect(mixed).toHaveLength(3);
    expect(mixed[1].violations.map((item) => item.id)).toEqual(["ROUND_LIMIT"]);
    expect(mixed[2].violations).toEqual([]);
  });

  it("cấu hình vai mở rộng cũng sạch", () => {
    const game = runSelfPlay({
      seed: "extended-audit",
      playerCount: 14,
      config: {
        werewolves: 2,
        wolfCub: true,
        seer: true,
        apprenticeSeer: true,
        detective: true,
        guard: true,
        guardianAngel: true,
        priest: true,
        witch: true,
        hunter: true,
        mayor: true,
        cursed: true,
      } as SelfPlayRecord["config"],
      events: true,
      trace: true,
    });
    expect(game.violations).toEqual([]);
  });

  it("mọi seed thất bại đều replay lại đúng như cũ", () => {
    const capped = runSelfPlay({ seed: "capped", maxRounds: 1 });
    const again = replayGame(capped.record);
    expect(again.violations.map((item) => item.id)).toEqual(
      capped.violations.map((item) => item.id),
    );
    expect(again.rounds).toBe(capped.rounds);
  });
});
