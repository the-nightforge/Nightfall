import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { gameToTrajectories, serializeTrajectory } from "../src/bot/evaluation/trajectory";
import type { BotDecisionTrace } from "../src/bot/trace/trace";
import type { SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

/**
 * PR 7 của BOT_AI_CONTINUE_UPGRADE (§22): trajectory export từ self-play.
 *
 * Ranh giới tuyệt đối (§22 "Never place hidden information into the acting
 * bot's observation snapshot"): observation chỉ chứa dữ liệu CÓ SẴN trong
 * trace/knowledge snapshot của bot — vai thật của người khác không bao giờ lọt
 * vào `observation`; nó chỉ nằm ở field cấp-1 `finalRole` (label cho tầng
 * train), và vai người khác không bao giờ xuất hiện ở bất kỳ đâu.
 */

function trace(botId: string, decision: BotDecisionTrace["decision"] = "VOTE"): BotDecisionTrace {
  return {
    botId,
    round: 2,
    phase: "VOTING",
    decision,
    chosen: { targetId: "p2", label: "bầu" },
    candidates: [
      { targetId: "p2", score: 40, terms: [{ name: "belief", value: 40 }], evidenceIds: [] },
      { targetId: "p3", score: 10, terms: [{ name: "belief", value: 10 }], evidenceIds: [] },
    ],
    beliefBefore: { p1: { suspicion: 0, trust: 0 }, p2: { suspicion: 10, trust: 0 } },
    beliefAfter: { p1: { suspicion: 5, trust: 0 }, p2: { suspicion: 40, trust: 0 } },
    personality: {
      aggressiveness: 0.5,
      talkativeness: 0.5,
      riskTolerance: 0.5,
      deceptionSkill: 0.5,
      analyticalSkill: 0.5,
      loyalty: 0.5,
      stubbornness: 0.5,
    },
    rngDraws: [0.42],
    fallbackReason: null,
    knowledgeSnapshot: {
      aliveIds: ["p1", "p2", "p3"],
      legalChoices: ["p1", "p2", "p3", "__none__"],
      knownRoles: { p1: "VILLAGER" },
      seerResult: null,
    },
  } as unknown as BotDecisionTrace;
}

function game(overrides: Partial<SelfPlayGame> = {}): SelfPlayGame {
  const config: RoomConfig = {
    ...DEFAULT_ROOM_CONFIG,
    werewolves: 1,
    seer: true,
    guard: false,
    witch: false,
    hunter: false,
    cursed: false,
  };
  return {
    record: {
      seed: "traj-test",
      playerCount: 3,
      config,
      weightsVersion: "18.0.0",
      maxRounds: 20,
      events: false,
      speech: true,
      defense: false,
    },
    winner: "village",
    rounds: 2,
    actions: 1,
    rejected: 0,
    skipped: 0,
    events: [],
    violations: [],
    traces: [trace("p1"), trace("p2", "NIGHT")],
    roles: { p1: "VILLAGER", p2: "WEREWOLF", p3: "SEER" } as Record<string, Role>,
    ...overrides,
  };
}

describe("gameToTrajectories (PR7 — trajectory export)", () => {
  it("mỗi trace thành một line: id/seed/player/turn/observation/legal/candidates/selected", () => {
    const lines = gameToTrajectories(game());
    expect(lines).toHaveLength(2);

    const first = lines[0]!;
    expect(first.gameId).toBe("traj-test");
    expect(first.seed).toBe("traj-test");
    expect(first.playerId).toBe("p1");
    expect(first.finalRole).toBe("VILLAGER");
    expect(first.turn).toBe(2);
    expect(first.legalActions).toEqual(["p1", "p2", "p3", "__none__"]);
    expect(first.candidates).toHaveLength(2);
    expect(first.selectedAction).toEqual({ targetId: "p2", decision: "VOTE", label: "bầu", kind: null });
    expect(first.finalWinner).toBe("village");
  });

  it("reward ±1 theo ĐÚNG team của vai bot (roleWonOutcome), neutral thắng riêng được +1", () => {
    const won = gameToTrajectories(game())[0]!;
    expect(won.reward).toBe(1); // VILLAGER, winner village

    const wolfWon = gameToTrajectories(game({ winner: "wolves" }))[1]!;
    expect(wolfWon.reward).toBe(1); // WEREWOLF, winner wolves
    expect(gameToTrajectories(game({ winner: "village" }))[1]!.reward).toBe(-1);

    // Thằng Hề treo trúng điều kiện riêng: winner wolves, personalWins có Hề.
    const jester = game({
      winner: "wolves",
      personalWins: [
        { playerId: "p1", name: "P1", role: "JESTER" as Role, condition: "JESTER_LYNCHED", round: 2 },
      ],
      roles: { p1: "JESTER", p2: "WEREWOLF", p3: "SEER" } as Record<string, Role>,
    });
    expect(gameToTrajectories(jester)[0]!.reward).toBe(1);
  });

  it("§22 ranh giới: observation KHÔNG chứa vai của người khác — chỉ knownRoles của bot", () => {
    // p2 là WEREWOLF; trace của p1 (dân) không được thấy điều đó ở bất kỳ đâu
    // trong observation.
    const lines = gameToTrajectories(game());
    const villagerLine = lines[0]!;
    const observationText = JSON.stringify(villagerLine.observation);
    expect(observationText).not.toContain("WEREWOLF");
    // knownRoles của chính p1 (chỉ p1: VILLAGER) được giữ.
    expect(villagerLine.observation.knownRoles).toEqual({ p1: "VILLAGER" });
  });

  it("field finalRole là ĐƯỜNG DUY NHẤT mang vai thật, tách khỏi observation", () => {
    const lines = gameToTrajectories(game());
    expect(lines[0]!.finalRole).toBe("VILLAGER");
    expect(lines[1]!.finalRole).toBe("WEREWOLF");
    for (const line of lines) {
      const text = JSON.stringify(line);
      // observation không được chứa finalRole của chính bot lẫn của người khác.
      const observationText = JSON.stringify(line.observation);
      expect(observationText).not.toBe(text);
    }
  });

  it("tất định: cùng game → cùng chuỗi JSONL; serialize một line một dòng", () => {
    const a = gameToTrajectories(game()).map(serializeTrajectory);
    const b = gameToTrajectories(game()).map(serializeTrajectory);
    expect(a).toEqual(b);
    for (const line of a) expect(line).not.toMatch(/\r?\n/);
  });
});
