import { describe, it, expect } from "vitest";
import { GameEngine } from "../src/engine";
import { selectEvent, GAME_EVENTS } from "../src/events/eventManager";
import { GameState, EnginePlayer } from "../src/types";
import { DEFAULT_ROOM_CONFIG, deathCauseClause, GameEventView } from "@masoi/shared";

function createTestState(players: Partial<EnginePlayer>[], overrides?: Partial<GameState>): GameState {
  const fullPlayers: EnginePlayer[] = players.map((p, i) => ({
    id: p.id ?? `p${i + 1}`,
    name: p.name ?? `Player ${i + 1}`,
    role: p.role ?? "VILLAGER",
    alive: p.alive ?? true,
    isBot: p.isBot ?? false,
    cursedTurned: p.cursedTurned ?? false,
  }));

  return {
    deadCanSpeakChosenId: null,
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: Date.now() + 30000,
    phaseStartedAt: Date.now(),
    players: fullPlayers,
    config: {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 2,
    },
    winner: null,
    night: {
      wolfVotes: {},
      killTarget: null,
      wolfSecondaryTarget: null,
      wolfCubRageTonight: false,
      wolvesLocked: false,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
    witchSkipped: false,
    seerResults: {},
      detectiveTargets: null,
      detectiveResults: {},
      sorcererResults: {},
      trackerTargets: {},
      trackerResults: {},
    },
    votes: {},
    voteMutations: [],
    dayVoteHistory: [],
    guardPrevious: null,
    apprenticeAwakened: false,
    wolfCubRageNextNight: false,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    lastTrial: null,
    hunterReaction: null,
    hunterShots: [],
    activeEvent: null,
    eventHistory: [],
    log: [],
    pendingLastStandVictim: null,
    bloodMoonArmed: false,
    bloodMoonUsed: false,
    deadCanSpeakUsed: false,
    howlBonusDay: null,
    dayOfTruthClaims: {},
    ...overrides,
  };
}

describe("Dynamic Event Selection", () => {  it("ranked không có sự kiện, ở cả hai pha, và không đốt một lần rút RNG nào", () => {
    // Bảy test riêng từng đứng ở đây, mỗi test dựng một thế trận khác nhau -
    // Sói đang dẫn, làng đang dẫn, đã có kết quả Thám Tử - rồi cùng khẳng định
    // `null`. Cả bảy đều dừng ở ĐÚNG MỘT câu `if (mode !== "chaos") return null`
    // ngay đầu `selectEvent`, nên sáu cái sau không đo thêm được gì; tên chúng
    // còn nhắc "balanced-ranked" từ thời ranked có bộ chọn riêng.
    //
    // Cái duy nhất đáng giữ là lần rút RNG: câu return phải nằm TRƯỚC mọi lần
    // gọi `rng`, nếu không thì bật chaos giữa chừng sẽ lệch dòng số của ván.
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "detective", role: "DETECTIVE", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "ranked";
    // Thế trận thừa sự kiện hợp lệ ở cả hai pha: chaos ở đây sẽ bốc ra được.
    state.night.detectiveResults["detective"] = {
      target1Id: "w1",
      target2Id: "v1",
      sameTeam: false,
    };

    let rngCalls = 0;
    const rng = () => {
      rngCalls += 1;
      return 0;
    };

    expect(selectEvent(state, "NIGHT", rng)).toBeNull();
    expect(selectEvent(state, "DAY", rng)).toBeNull();
    expect(rngCalls).toBe(0);

    // Cùng thế trận đó, chaos phải bốc ra sự kiện - nếu không thì ba khẳng định
    // trên xanh vì lý do sai.
    state.config.mode = "chaos";
    expect(selectEvent(state, "NIGHT", () => 0)).not.toBeNull();
    expect(selectEvent(state, "DAY", () => 0)).not.toBeNull();
  });
  it("does not select CLEARING_MIST or MOONLESS_NIGHT if Seer is dead and Apprentice is not awakened", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: false },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: false },
      { id: "guard", role: "GUARD", alive: true },
      { id: "witch", role: "WITCH", alive: true },
      { id: "hunter", role: "HUNTER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "chaos";

    // rng() = 0 luôn qua cổng 0.6 và luôn chọn phần tử đầu, nên nếu hai sự kiện
    // này còn lọt vào danh sách hợp lệ thì test bắt được ngay.
    for (let i = 0; i < 20; i++) {
      const event = selectEvent(state, "NIGHT", () => i / 20);
      expect(event?.id).not.toBe("MOONLESS_NIGHT");
      expect(event?.id).not.toBe("CLEARING_MIST");
    }
  });

  it("chaos mode selects events randomly matching targetPhase", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "chaos";

    const event = selectEvent(state, "NIGHT", () => 0.1);
    expect(event).not.toBeNull();
    expect(event?.targetPhase).toBe("NIGHT");
  });
});

describe("Event Modifiers in GameEngine", () => {
  it("PEACEFUL_NIGHT nullifies wolf kill for that night", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "PEACEFUL_NIGHT",
      name: "Đêm Bình Yên",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "village",
      power: 4,
    };

    const engine = new GameEngine(state);
    engine.submitNightAction("w1", "KILL", "v1");
    const deaths = engine.resolveNight();

    expect(deaths).toHaveLength(0);
    expect(engine.mustPlayer("v1").alive).toBe(true);
  });

  it("MOONLESS_NIGHT blocks Seer and Apprentice Seer from scanning", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "MOONLESS_NIGHT",
      name: "Đêm Không Trăng",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "wolves",
      power: 3,
    };

    const engine = new GameEngine(state);
    expect(engine.snapshotFor("seer").nightInfo?.canAct).toBe(false);
    expect(() => engine.submitNightAction("seer", "SEE", "w1")).toThrowError(/Đêm Không Trăng/);
  });

  it("CLEARING_MIST allows Seer to scan 2 targets in one night", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "CLEARING_MIST",
      name: "Màn Sương Tan",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "village",
      power: 3,
    };

    const engine = new GameEngine(state);
    engine.submitNightAction("seer", "SEE", "w1", "v1");

    const snap = engine.snapshotFor("seer");
    expect(snap.nightInfo?.seerResult?.targetId).toBe("w1");
    expect(snap.nightInfo?.seerResult?.isWolf).toBe(true);
    expect(snap.nightInfo?.seerResult?.secondaryTargetId).toBe("v1");
    expect(snap.nightInfo?.seerResult?.secondaryIsWolf).toBe(false);
  });

  it("WOLF_SHADOW does not affect Detective results", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE", alive: true },
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "WOLF_SHADOW",
      name: "Bóng Sói",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "wolves",
      power: 3,
    };

    const engine = new GameEngine(state);
    engine.submitNightAction("det", "DETECTIVE_CHECK", "w1", "v1");

    const result = engine.snapshotFor("det").nightInfo?.detectiveResult;
    expect(result?.sameTeam).toBe(false);
  });

  it("BLOODY_HUNT allows secondary wolf kill with 50% success probability", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "BLOODY_HUNT",
      name: "Cuộc Săn Đẫm Máu",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "wolves",
      power: 4,
    };

    const engine = new GameEngine(state);
    engine.submitNightAction("w1", "KILL", "v1", "v2");

    // Test success (rng = 0.1 < 0.5)
    const deathsSuccess = engine.resolveNight(Date.now(), () => 0.1);
    expect(deathsSuccess.map((d) => d.playerId)).toContain("v1");
    expect(deathsSuccess.map((d) => d.playerId)).toContain("v2");
  });

  it("CURFEW cuts discussion duration by 50% when startDay is called", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.config.discussionSeconds = 60;
    const engine = new GameEngine(state);

    const curfewEvent: GameEventView = {
      id: "CURFEW",
      name: "Lệnh Giới Nghiêm",
      description: "...",
      targetPhase: "DAY",
      round: 1,
      beneficiary: "neutral",
      power: 1,
    };

    const now = 100000;
    engine.startDay(60000, now, () => 0, curfewEvent);

    expect(engine.state.phase).toBe("DAY_DISCUSSION");
    expect(engine.state.activeEvent?.id).toBe("CURFEW");
    expect(engine.state.phaseEndsAt).toBe(now + 30000);
  });

  it("JUDGMENT_DAY publishes the Detective result in the public event snapshot", () => {
    const state = createTestState([
      { id: "w1", name: "Khải", role: "WEREWOLF", alive: true },
      { id: "det", role: "DETECTIVE", alive: true },
      { id: "v1", name: "Linh", role: "VILLAGER", alive: true },
    ]);
    state.night.detectiveResults["det"] = {
      target1Id: "w1",
      target2Id: "v1",
      sameTeam: false,
    };
    const engine = new GameEngine(state);

    const judgmentEvent: GameEventView = {
      id: "JUDGMENT_DAY",
      name: "Ngày Phán Xét",
      description: "...",
      targetPhase: "DAY",
      round: 1,
      beneficiary: "village",
      power: 3,
    };

    engine.startDay(60000, 100000, () => 0, judgmentEvent);

    expect(engine.snapshotFor("v1").activeEvent?.announcement).toBe(
      "Kết quả Thám Tử: Khải và Linh là KHÁC PHE!",
    );
  });

  it("includes activeEvent in snapshotFor", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    state.activeEvent = {
      id: "SILENT_NIGHT",
      name: "Đêm Tĩnh Lặng",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "neutral",
      power: 1,
    };
    const engine = new GameEngine(state);
    const snap = engine.snapshotFor("w1");
    expect(snap.activeEvent?.id).toBe("SILENT_NIGHT");
  });

  it("LAST_STAND victim sống qua ngày sau", () => {
    const state = createTestState([
      { id: "wolf1", role: "WEREWOLF", alive: true },
      { id: "villager", role: "VILLAGER", alive: true },
      { id: "seer", role: "SEER", alive: true },
    ]);
    state.activeEvent = {
      id: "LAST_STAND",
      name: "Tử Thủ",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "village",
      power: 3,
    } as any;
    const engine = new GameEngine(state);
    engine.submitNightAction("wolf1", "KILL", "villager");
    const deaths = engine.resolveNight();
    expect(deaths.length).toBe(0);
    expect(engine.state.pendingLastStandVictim?.playerId).toBe("villager");
    expect(engine.player("villager")?.alive).toBe(true);
    engine.setPhase("DAY_DISCUSSION", 30000);
    // victim still alive during day
    expect(engine.player("villager")?.alive).toBe(true);
    engine.setPhase("NIGHT", 30000);
    expect(engine.player("villager")?.alive).toBe(true);
    const deaths2 = engine.resolveNight();
    expect(deaths2.some((d) => d.playerId === "villager")).toBe(true);
    expect(engine.player("villager")?.alive).toBe(false);
  });

  it("WOLF_SHADOW 30% đảo phe", () => {
    const wolfId = "w1";
    // case flip when rng 0.1 <0.3
    const stateFlip = createTestState([
      { id: wolfId, role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    stateFlip.activeEvent = {
      id: "WOLF_SHADOW",
      name: "Bóng Sói",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "wolves",
      power: 3,
    } as any;
    const engineFlip = new GameEngine(stateFlip);
    engineFlip.submitNightAction("seer", "SEE", wolfId, null, () => 0.1);
    const snapFlip = engineFlip.snapshotFor("seer");
    expect(snapFlip.nightInfo?.seerResult?.isWolf).toBe(false);

    // case no flip when rng 0.5 >=0.3
    const stateNoFlip = createTestState([
      { id: wolfId, role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    stateNoFlip.activeEvent = {
      id: "WOLF_SHADOW",
      name: "Bóng Sói",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "wolves",
      power: 3,
    } as any;
    const engineNoFlip = new GameEngine(stateNoFlip);
    engineNoFlip.submitNightAction("seer", "SEE", wolfId, null, () => 0.5);
    const snapNoFlip = engineNoFlip.snapshotFor("seer");
    expect(snapNoFlip.nightInfo?.seerResult?.isWolf).toBe(true);
  });

  it("BLOOD_MOON arm khi 0 death, đêm sau 20% xuyên shield", () => {
    // Night 1: BLOOD_MOON active, 0 wolf deaths -> arm
    const state1 = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
    ]);
    state1.activeEvent = {
      id: "BLOOD_MOON",
      name: "Trăng Máu",
      description: "...",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "wolves",
      power: 3,
    } as any;
    const engine1 = new GameEngine(state1);
    // wolves do not kill (skip)
    engine1.submitNightAction("w1", "SKIP", null);
    const deaths1 = engine1.resolveNight(Date.now(), () => 0.9);
    expect(deaths1.length).toBe(0);
    expect(engine1.state.bloodMoonArmed).toBe(true);

    // Night 2: guard protects v1, wolves kill v1, with pierce rng 0.1 <0.2 should pierce
    engine1.setPhase("DAY_DISCUSSION", 30000);
    engine1.setPhase("NIGHT", 30000);
    // need to set no active event now but bloodMoonArmed still true before resolve
    engine1.submitNightAction("guard", "GUARD", "v1");
    engine1.submitNightAction("w1", "KILL", "v1");
    const deaths2 = engine1.resolveNight(Date.now(), () => 0.1);
    expect(deaths2.map((d) => d.playerId)).toContain("v1");
    expect(engine1.state.bloodMoonArmed).toBe(false);
    expect(engine1.state.bloodMoonUsed).toBe(true);
  });

  it("migrate cứng xóa SHROUDED_ECLIPSE", () => {
    expect((GAME_EVENTS as any)["SHROUDED_ECLIPSE"]).toBeUndefined();
    expect(GAME_EVENTS["WOLF_SHADOW"]).toBeDefined();
    // Đếm cứng để một lần thêm nhầm SHROUDED_ECLIPSE trở lại bị bắt ngay; cộng
    // một mỗi khi thêm sự kiện mới (18 = 17 cũ + Sổ Tang).
    expect(Object.keys(GAME_EVENTS)).toHaveLength(18);
  });
});

describe("Bộ chọn sự kiện cân theo độ nghiêng", () => {
  function chaosState() {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    state.config.mode = "chaos";
    return state;
  }

  /** Nổ đúng một sự kiện của phe đó vào lịch sử, không đụng state khác. */
  function withHistory(state: GameState, ids: string[]) {
    state.eventHistory = ids.map((id) => ({
      ...GAME_EVENTS[id as keyof typeof GAME_EVENTS],
      round: 1,
    })) as GameEventView[];
    return state;
  }

  /** Mọi sự kiện bốc được với bộ RNG quét hết nhóm. */
  function reachable(state: GameState, phase: "NIGHT" | "DAY"): string[] {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      let call = 0;
      // Lần gọi đầu là cửa 0.6, lần sau là chỉ số trong nhóm.
      const event = selectEvent(state, phase, () => (call++ === 0 ? 0 : i / 40));
      if (event) seen.add(event.id);
    }
    return [...seen];
  }

  it("nhóm bốc mở cho cả hai phe khi độ nghiêng còn trong ngưỡng", () => {
    // Bóng Sói (phe Sói, power 3) đưa độ nghiêng lên đúng 3... nên thay bằng
    // một sự kiện nhẹ hơn để ở dưới ngưỡng.
    const state = withHistory(chaosState(), ["CURFEW"]);
    const ids = reachable(state, "NIGHT");
    expect(ids).toContain("MOONLESS_NIGHT");
    expect(ids).toContain("CLEARING_MIST");
  });

  it("phe Sói bị loại khỏi lượt bốc khi đã dẫn quá ngưỡng", () => {
    // Bóng Sói: beneficiary "wolves", power 3 -> chạm đúng TILT_LIMIT.
    const state = withHistory(chaosState(), ["WOLF_SHADOW"]);
    const ids = reachable(state, "NIGHT");

    expect(ids).not.toContain("MOONLESS_NIGHT");
    expect(ids).not.toContain("BLOODY_HUNT");
    expect(ids).not.toContain("BLOOD_MOON");
    // Phe làng và trung lập vẫn còn nguyên cửa.
    expect(ids).toContain("CLEARING_MIST");
    expect(ids).toContain("PEACEFUL_NIGHT");
  });

  it("phe làng cũng bị loại khi chính họ dẫn quá ngưỡng", () => {
    // Đêm Bình Yên: beneficiary "village", power 4.
    const state = withHistory(chaosState(), ["PEACEFUL_NIGHT"]);
    const ids = reachable(state, "NIGHT");

    expect(ids).not.toContain("CLEARING_MIST");
    expect(ids).toContain("MOONLESS_NIGHT");
  });

  it("không bao giờ tắt hẳn sự kiện: lọc rỗng thì trả lại nhóm ban đầu", () => {
    // Cả hai sự kiện ngày trung lập đã dùng, độ nghiêng nghiêng hẳn về Sói.
    // Nhóm ngày còn lại toàn phe Sói/làng, lọc xong vẫn phải bốc ra được gì đó.
    const state = withHistory(chaosState(), [
      "WOLF_SHADOW",
      "CURFEW",
      "AMNESTY_DAY",
      "MORNING_REPORT",
      "DEAD_CAN_SPEAK",
      "DAY_OF_TRUTH",
    ]);
    const ids = reachable(state, "DAY");
    expect(ids).toContain("HOWL_OF_THE_PACK");
  });

  /**
   * Bản Tin Bình Minh chỉ đáng nổ khi nó có gì để nói.
   *
   * Giá trị của nó nằm ở NGUYÊN NHÂN từng cái chết - `nightHistory` chỉ lộ ra
   * client lúc GAME_OVER nên giữa ván đó là bí mật thật. Một đêm không ai chết
   * thì bản tin chỉ đọc lại "không ai thiệt mạng", điều mà cả phòng đã nhìn
   * thấy suốt NIGHT_RESULT. Đổi 2 điểm nghiêng lấy một dòng chữ ai cũng biết,
   * và đốt luôn suất một-lần-mỗi-ván của sự kiện.
   */
  function afterNightWith(deathCount: number): GameState {
    const state = chaosState();
    state.nightHistory = [
      {
        round: 1,
        deaths: Array.from({ length: deathCount }, (_, i) => ({
          player: { id: `d${i}`, name: `Nan nhan ${i}`, role: "VILLAGER" },
          cause: "wolf",
        })),
      },
    ] as never;
    return state;
  }

  it("Bản Tin Bình Minh bốc được khi đêm trước có người chết", () => {
    expect(reachable(afterNightWith(1), "DAY")).toContain("MORNING_REPORT");
  });

  it("Bản Tin Bình Minh bị chặn khi đêm trước không ai chết", () => {
    expect(reachable(afterNightWith(0), "DAY")).not.toContain("MORNING_REPORT");
  });

  it("bị chặn thì buổi sáng đó bốc sự kiện khác, không bỏ trống suất", () => {
    /*
     * Hàng rào precondition nằm trong BỘ LỌC dựng `eligibleEvents`, chạy TRƯỚC
     * lượt bốc - nên một sự kiện không thoả điều kiện không bao giờ được bốc
     * rồi bị vứt, để lại một buổi sáng trống. Nó đơn giản là không có mặt
     * trong nhóm, và lượt bốc rơi vào những sự kiện còn lại.
     *
     * Bài này khoá đúng tính chất đó: cùng một thế cờ, chặn Bản Tin không được
     * làm nghèo đi số sự kiện còn bốc được.
     */
    const coNguoiChet = reachable(afterNightWith(1), "DAY");
    const khongAiChet = reachable(afterNightWith(0), "DAY");

    expect(khongAiChet.length).toBeGreaterThan(0);
    // Mất ĐÚNG Bản Tin, không mất gì thêm.
    expect(new Set(khongAiChet)).toEqual(
      new Set(coNguoiChet.filter((id) => id !== "MORNING_REPORT")),
    );
  });

  it("Bản Tin Bình Minh bị chặn khi chưa có đêm nào để kể", () => {
    // Nhánh "không có dữ liệu đêm trước" cũng rỗng nghĩa y như đêm không ai
    // chết, nên cùng một hàng rào chặn cả hai.
    const state = chaosState();
    state.nightHistory = [];
    expect(reachable(state, "DAY")).not.toContain("MORNING_REPORT");
  });

  /**
   * Sổ Tang công khai vai của MỘT người đã chết.
   *
   * Giá trị của nó là thông tin kiểm chứng được - khác hẳn claim không xác thực
   * mà Ngày Sự Thật cho. Nhưng nó rỗng nghĩa ở đúng hai thế cờ, và cả hai đều
   * phải chặn ở khâu bốc chứ không phải ở khâu dựng câu.
   */
  function withDead(deadCount: number, revealRoleOnDeath?: boolean): GameState {
    const state = chaosState();
    for (let i = 0; i < deadCount; i++) state.players[i].alive = false;
    if (revealRoleOnDeath !== undefined) state.config.revealRoleOnDeath = revealRoleOnDeath;
    return state;
  }

  it("Sổ Tang bốc được khi đã có người chết", () => {
    expect(reachable(withDead(1), "DAY")).toContain("OBITUARY");
  });

  it("Sổ Tang bị chặn khi chưa ai chết", () => {
    expect(reachable(withDead(0), "DAY")).not.toContain("OBITUARY");
  });

  it("Sổ Tang bị chặn khi luật đã tự công khai vai người chết", () => {
    // `revealRoleOnDeath` lộ sẵn mọi vai người chết cho cả bàn, nên bản sổ tang
    // chỉ đọc lại thứ ai cũng đang nhìn thấy - cùng loại rỗng nghĩa với Bản Tin
    // Bình Minh trên một đêm không ai chết.
    expect(reachable(withDead(2, true), "DAY")).not.toContain("OBITUARY");
  });

  it("Bóng Sói bị chặn khi không còn ai soi, y như Đêm Không Trăng", () => {
    // Cả ba sự kiện soi cùng một hàng rào: không còn Tiên Tri thì Bóng Sói chỉ
    // là một slot đêm bị đốt cộng 3 điểm nghiêng khống cho phe Sói.
    const state = chaosState();
    state.players.find((p) => p.role === "SEER")!.alive = false;

    const ids = reachable(state, "NIGHT");
    expect(ids).not.toContain("WOLF_SHADOW");
    expect(ids).not.toContain("MOONLESS_NIGHT");
    expect(ids).not.toContain("CLEARING_MIST");
    expect(ids).toContain("BLOOD_MOON");
  });

  it("Bóng Sói vẫn bốc được khi Tập Sự đã thức tỉnh", () => {
    const state = chaosState();
    state.players.find((p) => p.role === "SEER")!.role = "APPRENTICE_SEER";
    state.apprenticeAwakened = true;

    expect(reachable(state, "NIGHT")).toContain("WOLF_SHADOW");
  });
});

describe("Độ nghiêng tính sự kiện đêm nặng gấp đôi sự kiện ngày", () => {
  function state6() {
    const st = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    st.config.mode = "chaos";
    return st;
  }

  function poolAfter(ids: string[], phase: "NIGHT" | "DAY"): string[] {
    const st = state6();
    st.eventHistory = ids.map((id) => ({
      ...GAME_EVENTS[id as keyof typeof GAME_EVENTS],
      round: 1,
    })) as GameEventView[];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      let call = 0;
      const event = selectEvent(st, phase, () => (call++ === 0 ? 0 : i / 40));
      if (event) seen.add(event.id);
    }
    return [...seen];
  }

  it("một sự kiện NGÀY power 3 chưa chạm trần", () => {
    // Ngày Phán Xét: phe làng, power 3, pha NGÀY -> nghiêng -3, dưới trần 6.
    const ids = poolAfter(["JUDGMENT_DAY"], "NIGHT");
    expect(ids).toContain("PEACEFUL_NIGHT");
  });

  it("một sự kiện ĐÊM power 3 thì chạm trần ngay", () => {
    // Màn Sương Tan: cùng phe làng, cùng power 3, nhưng pha ĐÊM -> 3 x 2 = 6.
    // Đây là cả điểm của thay đổi: một mẩu thông tin ban ngày không được tính
    // ngang giá với một đêm đổi ai sống ai chết.
    const ids = poolAfter(["CLEARING_MIST"], "NIGHT");
    expect(ids).not.toContain("PEACEFUL_NIGHT");
    expect(ids).not.toContain("VIGILANT_NIGHT");
    expect(ids).toContain("MOONLESS_NIGHT");
  });
});

describe("Đêm Bình Yên cứu được đêm Sói Con nổi giận", () => {
  it("bốc được vào đêm nổi giận, còn Tử Thủ thì không", () => {
    const st = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    st.config.mode = "chaos";
    st.night.wolfCubRageTonight = true;

    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      let call = 0;
      const event = selectEvent(st, "NIGHT", () => (call++ === 0 ? 0 : i / 40));
      if (event) seen.add(event.id);
    }
    expect([...seen]).toContain("PEACEFUL_NIGHT");
    expect([...seen]).not.toContain("LAST_STAND");
    expect([...seen]).not.toContain("BLOODY_HUNT");
  });

  it("tước CẢ lượt cắn phụ, không chỉ lượt chính", () => {
    const st = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
      { id: "v3", role: "VILLAGER", alive: true },
    ]);
    st.night.wolfCubRageTonight = true;
    st.activeEvent = { ...GAME_EVENTS.PEACEFUL_NIGHT, round: 1 } as GameEventView;
    const engine = new GameEngine(st);
    engine.submitNightAction("w1", "KILL", "v1", "v2");

    // Trước thay đổi này v2 vẫn chết: isPeacefulNight chỉ null mục tiêu chính.
    expect(engine.resolveNight(Date.now(), () => 0.9)).toHaveLength(0);
  });
});

describe("Đêm Tĩnh Lặng không nổ khi bầy Sói toàn bot", () => {
  function reachableWith(wolvesAreBots: boolean): string[] {
    const st = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true, isBot: wolvesAreBots },
      { id: "w2", role: "WEREWOLF", alive: true, isBot: wolvesAreBots },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
    ]);
    st.config.mode = "chaos";
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      let call = 0;
      const event = selectEvent(st, "NIGHT", () => (call++ === 0 ? 0 : i / 40));
      if (event) seen.add(event.id);
    }
    return [...seen];
  }

  it("bầy toàn bot thì không bốc: bot không chat đêm nên không mất gì", () => {
    expect(reachableWith(true)).not.toContain("SILENT_NIGHT");
  });

  it("còn một Sói người thật thì bốc bình thường", () => {
    expect(reachableWith(false)).toContain("SILENT_NIGHT");
  });
});

describe("Phiếu Kín giấu danh tính lá phiếu, không giấu tổng", () => {
  function voting(withEvent: boolean) {
    const st = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    const engine = new GameEngine(st);
    engine.setPhase("VOTING", 30000);
    if (withEvent) {
      engine.state.activeEvent = { ...GAME_EVENTS.SECRET_BALLOT, round: 1 } as GameEventView;
    }
    engine.submitVote("v1", "w1");
    engine.submitVote("v2", "w1");
    return engine.snapshotFor("v1");
  }

  it("ngày thường vẫn thấy ai bầu ai", () => {
    expect(voting(false).openBallots).toHaveLength(2);
  });

  it("ngày Phiếu Kín thì danh sách rỗng", () => {
    expect(voting(true).openBallots).toHaveLength(0);
  });

  it("tổng phiếu vẫn hiện: sự kiện giấu DANH TÍNH, không giấu kết quả", () => {
    expect(voting(true).players.find((p) => p.id === "w1")?.voteCount).toBe(2);
  });
});

describe("Đêm Cảnh Giác cho Bảo Vệ che 2 người", () => {
  const roster: Partial<EnginePlayer>[] = [
    { id: "w1", role: "WEREWOLF", alive: true },
    { id: "guard", role: "GUARD", alive: true },
    { id: "v1", role: "VILLAGER", alive: true },
    { id: "v2", role: "VILLAGER", alive: true },
  ];

  function guarded(withEvent: boolean) {
    const st = createTestState(roster);
    if (withEvent) {
      st.activeEvent = { ...GAME_EVENTS.VIGILANT_NIGHT, round: 1 } as GameEventView;
    }
    return new GameEngine(st);
  }

  it("khiên thứ hai chặn được nhát cắn", () => {
    const engine = guarded(true);
    engine.submitNightAction("guard", "GUARD", "v1", "v2");
    engine.submitNightAction("w1", "KILL", "v2");
    expect(engine.resolveNight(Date.now(), () => 0.9)).toHaveLength(0);
  });

  it("ngoài sự kiện thì engine từ chối người thứ hai", () => {
    const engine = guarded(false);
    expect(() => engine.submitNightAction("guard", "GUARD", "v1", "v2")).toThrow(
      /Đêm Cảnh Giác/,
    );
  });

  it("luật của Bảo Vệ áp nguyên cho lượt che thứ hai", () => {
    const engine = guarded(true);
    engine.state.guardPrevious = "v2";
    expect(() => engine.submitNightAction("guard", "GUARD", "v1", "v2")).toThrow(
      /hai đêm liên tiếp/,
    );
    expect(() => engine.submitNightAction("guard", "GUARD", "v1", "guard")).toThrow(
      /tự bảo vệ/,
    );
    expect(() => engine.submitNightAction("guard", "GUARD", "v1", "v1")).toThrow(/2 lần/);
  });

  it("không còn Bảo Vệ sống thì không bốc, cùng hàng rào với 3 sự kiện soi", () => {
    const st = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "guard", role: "GUARD", alive: false },
      { id: "seer", role: "SEER", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    st.config.mode = "chaos";
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      let call = 0;
      const event = selectEvent(st, "NIGHT", () => (call++ === 0 ? 0 : i / 40));
      if (event) seen.add(event.id);
    }
    expect([...seen]).not.toContain("VIGILANT_NIGHT");
  });

  it("cả HAI người được che đêm nay đều bị cấm che lại đêm sau", () => {
    const engine = guarded(true);
    engine.submitNightAction("guard", "GUARD", "v1", "v2");
    engine.submitNightAction("w1", "KILL", "v1");
    engine.resolveNight(Date.now(), () => 0.9);

    // Bản đầu chỉ nhớ mục tiêu CHÍNH, nên v2 che lại được ngay - một đường vòng
    // qua đúng luật mà vai Bảo Vệ dựa vào.
    expect(engine.state.guardPrevious).toBe("v1");
    expect(engine.state.guardSecondPrevious).toBe("v2");

    engine.setPhase("DAY_DISCUSSION", 30000);
    engine.setPhase("NIGHT", 30000);
    expect(() => engine.submitNightAction("guard", "GUARD", "v2")).toThrow(
      /hai đêm liên tiếp/,
    );
    expect(() => engine.submitNightAction("guard", "GUARD", "v1")).toThrow(
      /hai đêm liên tiếp/,
    );
    expect(engine.botKnowledgeFor("guard").night!.legalTargets.GUARD).not.toContain("v2");
  });

  it("bot được mời mục tiêu thứ hai qua bonusSecondTargetFor", () => {
    expect(guarded(true).botKnowledgeFor("guard").night?.bonusSecondTargetFor).toBe("GUARD");
    expect(guarded(false).botKnowledgeFor("guard").night?.bonusSecondTargetFor).toBeNull();
  });
});

describe("Bản Tin Bình Minh nói nguyên nhân, không đọc lại tên người chết", () => {
  /** Một đêm đã khép lại với đúng những cái chết yêu cầu, rồi mở ngày kế. */
  function afterNight(deaths: Array<{ name: string; cause: string }>) {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    const engine = new GameEngine(state);
    engine.state.nightHistory = [
      {
        round: 1,
        deaths: deaths.map((death) => ({
          player: { id: death.name, name: death.name, role: "VILLAGER" },
          cause: death.cause,
        })),
      },
    ] as never;
    return engine;
  }

  const report = (engine: GameEngine): string =>
    engine.startDay(30000, Date.now(), () => 0, {
      ...GAME_EVENTS.MORNING_REPORT,
      round: 2,
    } as GameEventView)!.announcement!;

  it("tách nhát cắn của Sói khỏi Bình Độc của Phù Thuỷ", () => {
    const text = report(
      afterNight([
        { name: "Nam", cause: "wolf" },
        { name: "Lan", cause: "poison" },
      ]),
    );
    expect(text).toContain("Nam bị Sói cắn");
    expect(text).toContain("Lan trúng Bình Độc của Phù Thủy");
  });

  it("nhát dao trong đêm không gọi tên Sát Nhân", () => {
    const text = report(afterNight([{ name: "Nam", cause: "serial_killer" }]));
    expect(text).toContain("Nam bị đâm trong đêm");
    expect(text).not.toContain("Sát Nhân");
  });

  it("không còn là bản sao của lastNightDeaths: chỉ tên thôi là chưa đủ", () => {
    const text = report(afterNight([{ name: "Nam", cause: "wolf" }]));
    // Câu cũ - "Nam đã thiệt mạng" - không nói gì mà cả phòng chưa nhìn thấy.
    expect(text).not.toContain("đã thiệt mạng");
  });

  it("đêm không ai chết vẫn có bản tin", () => {
    expect(report(afterNight([]))).toContain("không ai thiệt mạng");
  });
});

describe("Bản tin không xác nhận lá bài của Linh Mục", () => {
  function reportOf(cause: string): string {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
    ]);
    const engine = new GameEngine(state);
    engine.state.nightHistory = [
      {
        round: 1,
        deaths: [{ player: { id: "x", name: "Nam", role: "VILLAGER" }, cause }],
      },
    ] as never;
    return engine.startDay(30000, Date.now(), () => 0, {
      ...GAME_EVENTS.MORNING_REPORT,
      round: 2,
    } as GameEventView)!.announcement!;
  }

  it("không gọi tên Linh Mục cũng không nói tới Nước thánh", () => {
    const text = reportOf("priest");
    expect(text).not.toContain("Linh Mục");
    expect(text).not.toContain("Nước thánh");
  });

  it("trúng đích và phản vệ đọc ra y hệt nhau", () => {
    // Để riêng thì vế "thanh tẩy" chỉ ra người chết là Sói, vế "phản vệ" chỉ ra
    // người chết là Linh Mục. Cùng một câu thì không suy ngược được cái nào.
    expect(reportOf("priest")).toBe(reportOf("priest_backfire"));
  });

  it("các nguyên nhân khác vẫn giữ nguyên vế đầy đủ", () => {
    expect(reportOf("wolf")).toContain("bị Sói cắn");
    expect(reportOf("poison")).toContain("Bình Độc");
  });

  it("bản tường thuật cuối ván vẫn kể đúng chuyện đã xảy ra", () => {
    // Làm mờ là luật của GIỮA VÁN. Ván xong thì không còn gì để giấu.
    expect(deathCauseClause("priest")).toContain("Nước thánh");
    expect(deathCauseClause("priest_backfire")).not.toBe(deathCauseClause("priest"));
  });
});

describe("Phiếu ẩn Tiếng Hú Bầy Sói đổi được bản án", () => {
  /** Một phiên toà với `accused` đứng trước vành móng ngựa, Tiếng Hú đang hiệu lực. */
  function trial(howl: boolean) {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
      { id: "accused", role: "VILLAGER", alive: true },
    ]);
    const engine = new GameEngine(state);
    engine.state.phase = "FINAL_VOTE";
    engine.state.trial = { accusedId: "accused", finalVotes: {} };
    engine.state.howlBonusDay = howl ? engine.state.round : null;
    return engine;
  }

  it("một phiếu Treo thiếu vẫn treo được người khi bầy Sói cũng đòi treo", () => {
    // 3 cử tri, 1 phiếu Treo: 1*2 = 2, không quá 3 -> tha.
    const without = trial(false);
    without.submitFinalVote("w1", true);
    without.submitFinalVote("v1", false);
    expect(without.resolveFinalVote()).toBeNull();

    // Cùng bảng phiếu đó, có Tiếng Hú: 2*2 = 4 > 3 -> treo.
    const withHowl = trial(true);
    withHowl.submitFinalVote("w1", true);
    withHowl.submitFinalVote("v1", false);
    expect(withHowl.resolveFinalVote()?.playerId).toBe("accused");
  });

  it("bầy Sói bỏ phiếu Tha thì phiếu ẩn đứng về phía Tha", () => {
    // Phiếu ẩn bám theo bầy Sói, nên khi bầy đòi tha thì nó không được tự ý rơi
    // vào cột Treo.
    const engine = trial(true);
    engine.submitFinalVote("w1", false);
    engine.submitFinalVote("v1", true);
    engine.submitFinalVote("v2", true);
    expect(engine.finalVoteTally().innocent).toBe(2);
    expect(engine.finalVoteTally().guilty).toBe(2);
  });

  it("phiếu ẩn hướng Tha cứu được bị cáo, không chỉ làm đẹp cột Tha", () => {
    // Bảng phiếu này treo người khi không có sự kiện: 2 Treo trên 3 cử tri, và
    // 2*2 = 4 > 3.
    const without = trial(false);
    without.submitFinalVote("w1", false);
    without.submitFinalVote("v1", true);
    without.submitFinalVote("v2", true);
    expect(without.resolveFinalVote()?.playerId).toBe("accused");

    // Cùng bảng phiếu, có Tiếng Hú và bầy Sói đòi tha: cử tri thứ 4 xuất hiện ở
    // cột Tha, ngưỡng quá bán dâng lên và 2*2 = 4 không còn quá 4 -> tha.
    const withHowl = trial(true);
    withHowl.submitFinalVote("w1", false);
    withHowl.submitFinalVote("v1", true);
    withHowl.submitFinalVote("v2", true);
    expect(withHowl.finalVoteTally().eligible).toBe(4);
    expect(withHowl.resolveFinalVote()).toBeNull();
  });

  it("bầy Sói im lặng thì không có phiếu ẩn nào", () => {
    const engine = trial(true);
    engine.submitFinalVote("v1", true);
    expect(engine.finalVoteTally().guilty).toBe(1);
  });

  it("bảng phiếu hiển thị không được thấy phiếu ẩn", () => {
    // Cùng lý do với trọng số Thị Trưởng: danh sách phiếu công khai, nên một
    // con số lệch là tự khai ra sự kiện đang chạy.
    const engine = trial(true);
    engine.submitFinalVote("w1", true);
    expect(engine.finalVoteTally(false).guilty).toBe(1);
    expect(engine.finalVoteTally(true).guilty).toBe(2);
  });

  it("ngoài ngày Tiếng Hú thì không cộng gì", () => {
    const engine = trial(true);
    engine.state.howlBonusDay = engine.state.round + 1;
    engine.submitFinalVote("w1", true);
    expect(engine.finalVoteTally().guilty).toBe(1);
  });
});

describe("Trăng Máu xuyên đúng khiên đang chắn mục tiêu Sói", () => {
  /** Nạp Trăng Máu bằng một đêm 0 người chết, rồi mở đêm kế. */
  function armed(players: Partial<EnginePlayer>[]) {
    const state = createTestState(players);
    state.activeEvent = { ...GAME_EVENTS.BLOOD_MOON, round: 1 } as GameEventView;
    const engine = new GameEngine(state);
    engine.submitNightAction("w1", "SKIP", null);
    engine.resolveNight(Date.now(), () => 0.9);
    expect(engine.state.bloodMoonArmed).toBe(true);

    engine.setPhase("DAY_DISCUSSION", 30000);
    engine.setPhase("NIGHT", 30000);
    engine.state.activeEvent = null;
    return engine;
  }

  it("không xuyên khiên của người Sói KHÔNG cắn", () => {
    // Bảo Vệ che v1, Sói cắn v2. Cú xuyên trước đây gỡ khiên của v1 - người
    // không hề bị nhắm - rồi tiêu mất, còn v2 thì chết sẵn không cần xuyên.
    const engine = armed([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
    ]);
    engine.submitNightAction("guard", "GUARD", "v1");
    engine.submitNightAction("w1", "KILL", "v2");
    engine.resolveNight(Date.now(), () => 0.1);

    expect(engine.state.players.find((p) => p.id === "v1")!.alive).toBe(true);
    expect(engine.state.log.some((line) => line.includes("Trăng Máu xuyên"))).toBe(false);
  });

  it("xuyên khiên thứ HAI chứ không chỉ khiên vào Set trước", () => {
    // Khiên che v1 vào Set trước, khiên che v2 vào sau, Sói cắn v2. Bản cũ luôn
    // gỡ phần tử đầu Set nên v2 sống; giờ phải chết.
    //
    // Khiên thứ hai đặt THẲNG vào `night.guardSecondTarget` chứ không đi qua
    // một lượt hành động: từ khi Thiên Thần Hộ Mệnh bị xoá cứng, nguồn khiên
    // thứ hai duy nhất là Đêm Cảnh Giác - và chồng hai sự kiện lên một đêm sẽ
    // biến bài này thành bài kiểm tra máy sự kiện thay vì luật xuyên khiên.
    const engine = armed([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "v2", role: "VILLAGER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
    ]);
    engine.submitNightAction("guard", "GUARD", "v1");
    engine.state.night.guardSecondTarget = "v2";
    engine.submitNightAction("w1", "KILL", "v2");
    const deaths = engine.resolveNight(Date.now(), () => 0.1);

    expect(deaths.map((d) => d.playerId)).toContain("v2");
    expect(engine.state.players.find((p) => p.id === "v1")!.alive).toBe(true);
  });

  it("trượt cửa 20% thì khiên giữ nguyên và lượt nạp vẫn tiêu", () => {
    const engine = armed([
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "v1", role: "VILLAGER", alive: true },
      { id: "guard", role: "GUARD", alive: true },
    ]);
    engine.submitNightAction("guard", "GUARD", "v1");
    engine.submitNightAction("w1", "KILL", "v1");
    const deaths = engine.resolveNight(Date.now(), () => 0.9);

    expect(deaths.map((d) => d.playerId)).not.toContain("v1");
    expect(engine.state.bloodMoonArmed).toBe(false);
    expect(engine.state.bloodMoonUsed).toBe(true);
  });
});

describe("Sổ Tang công khai vai một người đã chết", () => {
  function engineWithDead(): GameEngine {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF", alive: false, name: "Sói Chết" },
      { id: "seer", role: "SEER", alive: true, name: "Tiên Tri" },
      { id: "v1", role: "VILLAGER", alive: true, name: "Dân" },
      { id: "bot", role: "VILLAGER", alive: true, name: "Bot" },
    ]);
    state.config.mode = "chaos";
    return new GameEngine(state);
  }

  const fire = (engine: GameEngine): string =>
    engine.startDay(30_000, Date.now(), () => 0, {
      ...GAME_EVENTS.OBITUARY,
      round: 2,
    } as GameEventView)!.announcement!;

  it("gọi đúng tên và vai của người đã chết", () => {
    const text = fire(engineWithDead());
    expect(text).toContain("Sói Chết");
    expect(text).toContain("Sói");
  });

  it("vai lộ ra tới được knownRoles của BOT, không chỉ nằm trong câu chữ", () => {
    /*
     * Bot KHÔNG đọc `announcement` - không một dòng nào trong `src/bot/` chạm
     * tới trường đó. Một sự kiện thuần thông báo vì thế vô hình với mọi bot ở
     * bàn, và mọi phép đo self-play sẽ nói nó đáng 0 điểm bất kể nó đáng bao
     * nhiêu với người thật. Kênh đúng là `knownRoles`, cùng kênh mà
     * `revealRoleOnDeath` dùng.
     */
    const engine = engineWithDead();
    fire(engine);

    expect(engine.botKnowledgeFor("bot").knownRoles.w1).toBe("WEREWOLF");
    // Người còn sống thì không lộ gì thêm.
    expect(engine.botKnowledgeFor("bot").knownRoles.seer).toBeUndefined();
  });

  it("người thật thấy đúng thứ BOT thấy", () => {
    // `botKnowledgeFor` có chú thích bắt buộc khớp `snapshotFor`: một thứ chỉ
    // một bên nhìn thấy sẽ đo ra sai lệch có hệ thống.
    const engine = engineWithDead();
    fire(engine);

    const view = engine.snapshotFor("v1");
    expect(view.players.find((p) => p.id === "w1")?.role).toBe("WEREWOLF");
    expect(view.players.find((p) => p.id === "seer")?.role).toBeUndefined();
  });
});
