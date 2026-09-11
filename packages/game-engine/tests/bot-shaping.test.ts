import { describe, expect, it } from "vitest";
import type { Role } from "@masoi/shared";
import { gameToTrajectories } from "../src/bot/evaluation/trajectory";
import { shapingLabelFor } from "../src/bot/evaluation/shaping";
import type { BotDecisionTrace } from "../src/bot/trace/trace";
import type { SelfPlayGame } from "../src/bot/evaluation/selfplay";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

/**
 * Nhãn shaping (spec 2026-09-11-shaping-reward-design D2/D3): "nước đi có trúng
 * phe địch không" — VOTE/HUNTER_SHOT theo mục tiêu, FINAL_VOTE theo sự nhất
 * quán treo/tha với phe của bị cáo. Trung lập và NIGHT/SPEECH không có nhãn.
 */

function trace(overrides: Partial<BotDecisionTrace> = {}): BotDecisionTrace {
  return {
    botId: "p1",
    round: 2,
    phase: "VOTING",
    decision: "VOTE",
    chosen: { targetId: "p2", label: "bầu" },
    candidates: [],
    beliefBefore: {},
    beliefAfter: {},
    personality: {
      aggressiveness: 0.5, talkativeness: 0.5, riskTolerance: 0.5,
      deceptionSkill: 0.5, analyticalSkill: 0.5, loyalty: 0.5, stubbornness: 0.5,
    },
    rngDraws: [],
    fallbackReason: null,
    knowledgeSnapshot: { aliveIds: ["p1", "p2", "p3"], legalChoices: [], knownRoles: {}, seerResult: null },
    ...overrides,
  } as unknown as BotDecisionTrace;
}

function game(roles: Record<string, Role>, overrides: Partial<SelfPlayGame> = {}): SelfPlayGame {
  const config: RoomConfig = { ...DEFAULT_ROOM_CONFIG, werewolves: 1 };
  return {
    record: { seed: "s", playerCount: 3, config, weightsVersion: "t", maxRounds: 20, events: false, speech: true, defense: false },
    winner: "village",
    rounds: 2, actions: 1, rejected: 0, skipped: 0,
    events: [], violations: [], traces: [], roles,
    ...overrides,
  };
}

const ROLES: Record<string, Role> = { p1: "VILLAGER", p2: "WEREWOLF", p3: "SEER" };

describe("shapingLabelFor (spec 2026-09-11 D2/D3)", () => {
  it("VOTE: mục tiêu khác phe → +1, cùng phe → −1", () => {
    const g = game(ROLES);
    expect(shapingLabelFor(g, trace({ botId: "p1", chosen: { targetId: "p2", label: "bầu" } }))).toBe(1);
    expect(shapingLabelFor(g, trace({ botId: "p2", chosen: { targetId: "p1", label: "bầu" } }))).toBe(1);
    expect(shapingLabelFor(g, trace({ botId: "p1", chosen: { targetId: "p3", label: "bầu" } }))).toBe(-1);
  });

  it("HUNTER_SHOT cùng quy tắc mục tiêu", () => {
    const g = game(ROLES);
    expect(shapingLabelFor(g, trace({ botId: "p1", decision: "HUNTER_SHOT", chosen: { targetId: "p2", label: "bắn" } }))).toBe(1);
    expect(shapingLabelFor(g, trace({ botId: "p1", decision: "HUNTER_SHOT", chosen: { targetId: "p3", label: "bắn" } }))).toBe(-1);
  });

  it("FINAL_VOTE: phán quyết nhất quán với phe bị cáo → +1", () => {
    const g = game(ROLES);
    // làng treo Sói: nhất quán → +1; làng tha Sói: mâu thuẫn → −1.
    expect(shapingLabelFor(g, trace({ botId: "p1", decision: "FINAL_VOTE", chosen: { targetId: "p2", label: "treo" } }))).toBe(1);
    expect(shapingLabelFor(g, trace({ botId: "p1", decision: "FINAL_VOTE", chosen: { targetId: "p2", label: "tha" } }))).toBe(-1);
    // Sói treo dân: nhất quán với phe mình → +1.
    expect(shapingLabelFor(g, trace({ botId: "p2", decision: "FINAL_VOTE", chosen: { targetId: "p1", label: "treo" } }))).toBe(1);
  });

  it("trung lập (actor hoặc mục tiêu) → null; targetId null → null", () => {
    const jester: Record<string, Role> = { p1: "VILLAGER", p2: "WEREWOLF", p3: "JESTER" };
    expect(shapingLabelFor(game(jester), trace({ chosen: { targetId: "p3", label: "bầu" } }))).toBeNull();
    expect(shapingLabelFor(game(jester), trace({ botId: "p3", chosen: { targetId: "p1", label: "bầu" } }))).toBeNull();
    expect(shapingLabelFor(game(ROLES), trace({ chosen: { targetId: null, label: "không treo ai" } }))).toBeNull();
  });

  it("NIGHT/SPEECH không có nhãn; thiếu vai → null", () => {
    const g = game(ROLES);
    expect(shapingLabelFor(g, trace({ decision: "NIGHT", chosen: { targetId: "p2", label: "cắn" } }))).toBeNull();
    expect(shapingLabelFor(g, trace({ decision: "SPEECH", chosen: { targetId: "p2", label: "nói" } }))).toBeNull();
    expect(shapingLabelFor(g, trace({ botId: "ghost" }))).toBeNull();
  });

  it("gameToTrajectories ghi `shaping` ngay sau `reward`, không lẫn vào observation", () => {
    const g = game(ROLES, { traces: [trace({ botId: "p1" })] });
    const lines = gameToTrajectories(g);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.shaping).toBe(1); // dân bầu Sói
    expect(lines[0]!.reward).toBe(1); // làng thắng
    const raw = JSON.stringify(lines[0]);
    const keys = Object.keys(JSON.parse(raw));
    expect(keys.indexOf("shaping")).toBe(keys.indexOf("reward") + 1);
    expect(Object.keys(lines[0]!.observation)).not.toContain("shaping");
  });
});
