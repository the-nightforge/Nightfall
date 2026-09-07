import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { GameEngine } from "@masoi/game-engine";
import { PERSISTENCE_VERSION, gameStateSchema, roomEnvelopeSchema } from "../src/persistence/schema";
import { ROOM_SCAFFOLD } from "./helpers/room";

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
      ...ROOM_SCAFFOLD,
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

  it("vai đã xóa cứng (PRIEST/MEDIUM) rơi về VILLAGER thay vì trượt schema", () => {
    const input = validEnvelope();
    input.room.engineState.players[0]!.role = "PRIEST" as never;
    input.room.engineState.players[1]!.role = "MEDIUM" as never;
    input.room.engineState.personalWins = [
      { playerId: "p1", name: "N1", role: "PRIEST", condition: "JESTER_LYNCHED", round: 2 },
    ] as never;

    const parsed = roomEnvelopeSchema.parse(input);

    expect(parsed.room.engineState!.players[0]!.role).toBe("VILLAGER");
    expect(parsed.room.engineState!.players[1]!.role).toBe("VILLAGER");
    expect(parsed.room.engineState!.personalWins).toEqual([
      { playerId: "p1", name: "N1", role: "VILLAGER", condition: "JESTER_LYNCHED", round: 2 },
    ]);
  });

  it("brain mang vai cũ và lượt đêm cũ (HOLY_WATER/PRIEST_BLESS) vẫn đọc được", () => {
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
          suspicion: {},
          trust: {},
          knownInformation: { knownRoles: { p1: "MEDIUM" }, seerResults: [] },
          claims: [],
          myClaim: { role: "PRIEST", round: 2 },
          memories: [],
          relationships: {},
          currentTheory: null,
          currentTargets: [],
          confidence: 0.4,
          previousVotes: [],
          previousNightActions: [
            { round: 1, action: "HOLY_WATER", targetId: "p2" },
            { round: 2, action: "PRIEST_BLESS", targetId: null },
          ],
          speechMemory: [],
          speechSequence: 0,
          repliedMessageIds: [],
          seenEventIds: [],
          appliedClaimEvidenceIds: [],
        },
      },
    } as never;

    const parsed = roomEnvelopeSchema.parse(input);
    const brain = parsed.room.botSession!.brains["p4"]!.state;

    expect(brain.knownInformation.knownRoles).toEqual({ p1: "VILLAGER" });
    expect(brain.myClaim).toEqual({ role: "VILLAGER", round: 2 });
    expect(brain.previousNightActions).toEqual([
      { round: 1, action: "HOLY_WATER", targetId: "p2" },
      { round: 2, action: "PRIEST_BLESS", targetId: null },
    ]);
  });

  it("config cũ mang key priest/medium vẫn đọc được, key lạ bị lược", () => {
    const input = validEnvelope();
    const legacyConfig = { ...input.room.config, priest: true, medium: true };
    input.room.config = legacyConfig as never;
    input.room.engineState.config = { ...legacyConfig } as never;

    const parsed = roomEnvelopeSchema.parse(input);

    expect("priest" in parsed.room.config).toBe(false);
    expect("medium" in parsed.room.config).toBe(false);
    expect("priest" in parsed.room.engineState!.config).toBe(false);
    expect("medium" in parsed.room.engineState!.config).toBe(false);
    // Key thật còn nguyên: lược key lạ chứ không thay cả config.
    expect(parsed.room.config.seer).toBe((input.room.config as { seer: boolean }).seer);
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

    expect(parsed.room.engineState!.votes).toEqual({ p1: null, p2: "p3" });
  });

  it("không bóc mất lịch sử đêm", () => {
    const input = validEnvelope();
    input.room.engineState.nightHistory = [
      { round: 1, deaths: [{ playerId: "p2", name: "N2" }], saved: false } as never,
    ];

    const parsed = roomEnvelopeSchema.parse(input);

    expect(parsed.room.engineState!.nightHistory).toEqual(input.room.engineState.nightHistory);
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

/*
 * Trường thêm sau PHẢI optional.
 *
 * `persistenceVersion` là `z.literal`, và mọi trường bắt buộc mới đều làm ảnh
 * chụp ghi bởi bản trước trượt `safeParse`. Trượt ở đây không phải là "bỏ qua
 * một trường": `loadEnvelope` đưa bản trượt vào `quarantine`, trả `corrupt`, và
 * người chơi được báo là ván cũ không khôi phục được. Nói cách khác, đánh dấu
 * một trường mới là bắt buộc sẽ GIẾT MỌI VÁN ĐANG CHẠY ngay lúc deploy.
 */
describe("tương thích ngược với ảnh chụp của bản cũ", () => {
  it("thiếu startedAt vẫn đọc được", () => {
    const envelope = validEnvelope();
    delete (envelope.room as Record<string, unknown>).startedAt;

    expect(roomEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("thiếu kickedPlayerIds vẫn đọc được", () => {
    const envelope = validEnvelope();
    delete (envelope.room as Record<string, unknown>).kickedPlayerIds;

    expect(roomEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it("thiếu sorcererResults và alphaShieldUsed (ảnh bản cũ) vẫn đọc được", () => {
    const envelope = validEnvelope();
    const night = envelope.room.engineState.night as unknown as Record<string, unknown>;
    delete night.sorcererResults;
    delete (envelope.room.engineState as unknown as Record<string, unknown>).alphaShieldUsed;

    const parsed = roomEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) console.error(parsed.error.issues);
    expect(parsed.success).toBe(true);
  });
});

describe("Sổ Tang sống sót qua một vòng lưu-khôi phục", () => {
  /**
   * `serialize` ghi trọn `engine.getState()`, nhưng `z.object()` STRIP mọi khoá
   * lạ khi đọc lại. Một trường state không được khai báo ở schema vì thế biến
   * mất lặng lẽ - không lỗi, không log - và sau một lần restart giữa ván, vai
   * mà Sổ Tang đã công khai lại ẩn đi với cả người thật lẫn bot.
   */
  it("giữ lại người được xướng tên", () => {
    const state = engineState();
    state.obituaryRevealedId = "p2";

    const parsed = gameStateSchema.parse(JSON.parse(JSON.stringify(state)));

    expect(parsed.obituaryRevealedId).toBe("p2");
  });

  it("ảnh chụp của bản cũ không có trường này vẫn đọc được", () => {
    // Bắt buộc một trường thêm sau là làm mọi snapshot đã ghi trước bản này
    // trượt schema rồi rơi vào quarantine - tức giết sạch ván đang chạy lúc
    // deploy. Cùng lý do với `kickedPlayerIds`/`startedAt`.
    const raw = JSON.parse(JSON.stringify(engineState()));
    delete raw.obituaryRevealedId;

    expect(() => gameStateSchema.parse(raw)).not.toThrow();
  });
});

describe("trackerTargets/trackerResults của Kẻ Theo Dõi", () => {
  it("ảnh chụp của bản cũ (chưa có Kẻ Theo Dõi) vẫn đọc được", () => {
    // Cùng bẫy với `sorcererResults`: bắt buộc hai trường này ở INPUT là làm
    // mọi ván đang chạy lúc deploy trượt schema rồi rơi vào quarantine.
    const raw = JSON.parse(JSON.stringify(engineState()));
    delete raw.night.trackerTargets;
    delete raw.night.trackerResults;

    const parsed = gameStateSchema.parse(raw);

    expect(parsed.night.trackerTargets).toEqual({});
    expect(parsed.night.trackerResults).toEqual({});
  });

  it("giữ nguyên mục tiêu và kết quả theo dõi khi ảnh chụp có", () => {
    // `z.object()` thường (không `.strict()`) STRIP mọi khoá không khai báo -
    // nếu chỉ thêm `.optional()` mà quên khai kiểu, dữ liệu Kẻ Theo Dõi của
    // một ván đang chạy sẽ mất lặng lẽ sau một lần khôi phục.
    const state = engineState();
    state.night.trackerTargets = { p1: "p2" };
    state.night.trackerResults = { p1: { targetId: "p2", acted: true } };

    const parsed = gameStateSchema.parse(JSON.parse(JSON.stringify(state)));

    expect(parsed.night.trackerTargets).toEqual({ p1: "p2" });
    expect(parsed.night.trackerResults).toEqual({ p1: { targetId: "p2", acted: true } });
  });
});
