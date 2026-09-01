import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { GameEngine } from "@masoi/game-engine";
import { PERSISTENCE_VERSION, roomEnvelopeSchema } from "../src/persistence/schema";

function engineState() {
  const engine = GameEngine.create(
    Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `N${i + 1}`, isBot: i > 2 })),
    { ...DEFAULT_ROOM_CONFIG },
  );
  engine.startNight(30_000);
  return engine.getState();
}

function validEnvelope() {
  return {
    persistenceVersion: PERSISTENCE_VERSION,
    savedAt: Date.now(),
    opSeq: 7,
    room: {
      code: "ABCDE",
      hostId: "p1",
      status: "IN_GAME",
      members: [
        { playerId: "p1", name: "N1", ready: true, connected: true, disconnectedAt: null, isBot: false, avatarUrl: null },
      ],
      config: { ...DEFAULT_ROOM_CONFIG },
      chatLog: [
        { id: "m1", channel: "day", playerId: "p1", playerName: "N1", text: "chào", at: 1 },
      ],
      createdAt: 1,
      engineState: engineState(),
      gameId: "11111111-1111-4111-8111-111111111111",
      resultWritten: false,
      pendingStep: { name: "lockWolves", token: "1:NIGHT:1", runAt: Date.now() + 1000 },
      phaseSeq: 1,
      botSession: {
        seed: "ABCDE:1",
        playerIds: ["p1", "p2"],
        brains: {},
        cursors: { "p4:brain": 3 },
      },
      governorCalls: 2,
      discussionSkipVotes: ["p1"],
      discussionRun: null,
    },
  };
}

describe("schema snapshot phòng", () => {
  it("nhận envelope hợp lệ", () => {
    const parsed = roomEnvelopeSchema.safeParse(validEnvelope());
    if (!parsed.success) console.error(parsed.error.issues);
    expect(parsed.success).toBe(true);
  });

  it("từ chối version khác", () => {
    const bad = { ...validEnvelope(), persistenceVersion: 2 };
    expect(roomEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("từ chối thiếu opSeq", () => {
    const bad = validEnvelope() as Record<string, unknown>;
    delete bad.opSeq;
    expect(roomEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("từ chối pha không có thật", () => {
    const bad = validEnvelope();
    bad.room.engineState.phase = "TEA_BREAK" as never;
    expect(roomEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("từ chối pha LOBBY trong engine state", () => {
    const bad = validEnvelope();
    bad.room.engineState.phase = "LOBBY" as never;
    expect(roomEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("từ chối vai không có thật", () => {
    const bad = validEnvelope();
    bad.room.engineState.players[0]!.role = "BÁC SĨ" as never;
    expect(roomEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("từ chối bước chờ mang tên lạ", () => {
    const bad = validEnvelope();
    bad.room.pendingStep = { name: "danceParty", token: "x", runAt: 1 } as never;
    expect(roomEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("từ chối con trỏ RNG âm", () => {
    const bad = validEnvelope();
    bad.room.botSession.cursors["p4:brain"] = -1;
    expect(roomEnvelopeSchema.safeParse(bad).success).toBe(false);
  });

  it("giữ nguyên phiếu null - 'không treo ai' là một lá phiếu thật", () => {
    const input = validEnvelope();
    input.room.engineState.votes = { p1: null, p2: "p3" };

    const parsed = roomEnvelopeSchema.parse(input);

    expect(parsed.room.engineState.votes).toEqual({ p1: null, p2: "p3" });
  });

  it("không bóc mất lịch sử đêm", () => {
    const input = validEnvelope();
    input.room.engineState.nightHistory = [
      { round: 1, deaths: [{ playerId: "p2", name: "N2" }], saved: false } as never,
    ];

    const parsed = roomEnvelopeSchema.parse(input);

    expect(parsed.room.engineState.nightHistory).toEqual(input.room.engineState.nightHistory);
  });

  it("nhận brain state đầy đủ của bot", () => {
    const input = validEnvelope();
    input.room.botSession.brains = {
      p4: {
        lastDecayRound: 1,
        state: {
          playerId: "p4",
          personality: {
            aggressiveness: 0.5, talkativeness: 0.5, riskTolerance: 0.5,
            deceptionSkill: 0.5, analyticalSkill: 0.5, loyalty: 0.5, stubbornness: 0.5,
          },
          suspicion: { p1: { score: 3, reasons: [], lastUpdatedRound: 1 } },
          trust: {},
          knownInformation: { knownRoles: { p4: "SEER" }, seerResults: [] },
          claims: [],
          myClaim: { role: "SEER", round: 2 },
          memories: [],
          relationships: {},
          currentTheory: null,
          currentTargets: ["p2"],
          confidence: 0.4,
          previousVotes: [{ round: 1, choice: { type: "PLAYER", targetId: "p2" } }],
          previousNightActions: [{ round: 1, action: "SEE", targetId: "p2" }],
          speechMemory: [],
          speechSequence: 3,
          repliedMessageIds: [],
          seenEventIds: ["e1"],
          appliedClaimEvidenceIds: [],
        },
      },
    } as never;

    const parsed = roomEnvelopeSchema.safeParse(input);
    if (!parsed.success) console.error(parsed.error.issues);
    expect(parsed.success).toBe(true);
  });

  it("từ chối brain state thiếu personality", () => {
    const input = validEnvelope();
    input.room.botSession.brains = {
      p4: { lastDecayRound: 0, state: { playerId: "p4" } },
    } as never;
    expect(roomEnvelopeSchema.safeParse(input).success).toBe(false);
  });
});
