import { describe, expect, it } from "vitest";
import type { RoomConfig } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { GameEngine, projectRoleBeliefs, getWolfProbability } from "../src/index";

/**
 * Đường tích hợp PR1: `botKnowledgeFor` của ENGINE THẬT phải cấp
 * `roleComposition` khớp bộ bài mà nó chia, và projection chạy trên knowledge
 * đó cho ra prior đúng — không qua fixture tay nào.
 *
 * Bất biến thông tin: composition chỉ đọc config công khai, nên bảng này phải
 * GIỐNG NHAU cho mọi viewer bất kể vai thật của họ.
 */

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: false,
};

function makeEngine(playerCount = 8, config = CONFIG) {
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Người ${i + 1}`,
    isBot: true,
  }));
  const engine = GameEngine.create(players, config);
  engine.setPhase("NIGHT", 30_000);
  return engine;
}

describe("roleComposition qua engine thật (PR1)", () => {
  /** So sánh object theo key đã sort: JSON.stringify phụ thuộc thứ tự chèn. */
  function canonical(value: Record<string, number>): string {
    return JSON.stringify(
      Object.keys(value)
        .sort()
        .map((key) => `${key}:${value[key]}`),
    );
  }

  it("mọi viewer thấy cùng composition, khớp số ghế bộ bài đã chia", () => {
    const engine = makeEngine();

    const expected: Record<string, number> = {};
    for (const role of engine.state.players.map((p) => p.role)) {
      expected[role] = (expected[role] ?? 0) + 1;
    }

    const seen = new Set<string>();
    for (const botId of engine.state.players.map((p) => p.id)) {
      const knowledge = engine.botKnowledgeFor(botId);
      expect(knowledge.roleComposition).toBeDefined();
      seen.add(canonical(knowledge.roleComposition!));
      const total = Object.values(knowledge.roleComposition!).reduce((s, v) => s + v, 0);
      expect(total).toBe(8);
    }
    // Công khai: composition không phụ thuộc vai người xem.
    expect(seen.size).toBe(1);
    expect(seen.has(canonical(expected))).toBe(true);
  });

  it("projection trên knowledge engine thật: người không bằng chứng đứng ở prior", () => {
    const engine = makeEngine();
    const seerId =
      engine.state.players.find((p) => p.role === "SEER")!.id;
    const knowledge = engine.botKnowledgeFor(seerId);

    const beliefs = projectRoleBeliefs({
      knowledge,
      state: {
        playerId: seerId,
        personality: {
          aggressiveness: 0.5,
          talkativeness: 0.5,
          riskTolerance: 0.5,
          deceptionSkill: 0.5,
          analyticalSkill: 0.5,
          loyalty: 0.5,
          stubbornness: 0.5,
        },
        suspicion: {},
        trust: {},
        profiles: {},
        knownInformation: { knownRoles: {}, seerResults: [] },
        claims: [],
        myClaim: null,
        memories: [],
        relationships: {},
        currentTheory: null,
        currentTargets: [],
        confidence: 0,
        previousVotes: [],
        previousNightActions: [],
        speechMemory: [],
        speechSequence: 0,
        repliedMessageIds: [],
        seenEventIds: [],
        appliedClaimEvidenceIds: [],
      },
      roleComposition: knowledge.roleComposition,
    });

    const wolfSeats = knowledge.roleComposition!.WEREWOLF ?? 0;
    const plainId = engine.state.players.find(
      (p) => p.id !== seerId && beliefs[p.id] !== undefined,
    )!.id;
    // Người không có bằng chứng đứng đúng prior; Tiên Tri biết chắc vai mình.
    expect(getWolfProbability(beliefs, plainId)).toBeCloseTo(wolfSeats / 8, 6);
    expect(beliefs[seerId]!.probabilities["SEER"]).toBe(1);
    for (const belief of Object.values(beliefs)) {
      const total = Object.values(belief.probabilities).reduce((s, v) => s + v, 0);
      expect(total).toBeCloseTo(1, 6);
    }
  });
});
