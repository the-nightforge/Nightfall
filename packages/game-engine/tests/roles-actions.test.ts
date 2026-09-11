import { describe, it, expect, beforeEach } from "vitest";
import { GameEngine } from "../src/engine";
import { buildRoleDeck, assignRoles } from "../src/assignRoles";
import { GameState, EnginePlayer } from "../src/types";
import { DEFAULT_ROOM_CONFIG, RoomConfig } from "@masoi/shared";

function createTestState(players: Partial<EnginePlayer>[]): GameState {
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
    // Bắt buộc trong `GameState` từ khi có hệ thống sự kiện. Fixture này thiếu
    // chúng nên `tsc -p tsconfig.test.json` đỏ; bổ sung khi merge Phase 2.
    activeEvent: null,
    eventHistory: [],
    log: [],
    pendingLastStandVictim: null,
    bloodMoonArmed: false,
    bloodMoonUsed: false,
    deadCanSpeakUsed: false,
    howlBonusDay: null,
    dayOfTruthClaims: {},
  };
}

describe("Extended Roles - Deck Building", () => {
  it("builds custom deck with all new roles", () => {
    const config: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 2,
      wolfCub: true,
      seer: true,
      apprenticeSeer: true,
      detective: true,
      guard: true,
      tracker: true,
      witch: true,
      hunter: true,
      mayor: true,
      cursed: true,
    };
    const deck = buildRoleDeck(config, 15);
    expect(deck).toHaveLength(15);
    expect(deck.filter((r) => r === "WEREWOLF")).toHaveLength(2);
    expect(deck).toContain("WOLF_CUB");
    expect(deck).toContain("SEER");
    expect(deck).toContain("APPRENTICE_SEER");
    expect(deck).toContain("DETECTIVE");
    expect(deck).toContain("GUARD");
    expect(deck).toContain("TRACKER");
    expect(deck).toContain("WITCH");
    expect(deck).toContain("HUNTER");
    expect(deck).toContain("MAYOR");
    expect(deck).toContain("CURSED");
    expect(deck).toContain("VILLAGER");
  });
});

describe("Detective Role Actions", () => {
  it("checks two players on same team (village)", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "v1", role: "VILLAGER" },
      { id: "seer", role: "SEER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "seer");
    const snap = engine.snapshotFor("det");

    expect(snap.nightInfo?.detectiveResult).toBeDefined();
    expect(snap.nightInfo?.detectiveResult?.sameTeam).toBe(true);
    expect(snap.nightInfo?.acted).toBe(true);
  });

  it("checks two players on different teams (village vs wolf)", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "w1");
    const snap = engine.snapshotFor("det");

    expect(snap.nightInfo?.detectiveResult).toBeDefined();
    expect(snap.nightInfo?.detectiveResult?.sameTeam).toBe(false);
  });

  it("checks two wolves on same team (werewolf vs wolf cub)", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "w1", role: "WEREWOLF" },
      { id: "wc", role: "WOLF_CUB" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("det", "DETECTIVE_CHECK", "w1", "wc");
    const snap = engine.snapshotFor("det");

    expect(snap.nightInfo?.detectiveResult?.sameTeam).toBe(true);
  });

  it("rejects invalid targets for detective", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "v1", role: "VILLAGER" },
      { id: "dead", role: "VILLAGER", alive: false },
    ]);
    const engine = new GameEngine(state);

    // Target dead
    expect(() => engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "dead")).toThrow();
    // Same target twice
    expect(() => engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "v1")).toThrow();
    // Missing secondary target
    expect(() => engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", null)).toThrow();
  });

  it("không thể tự đưa mình vào cặp - tự ghép biến Thám Tử thành Tiên Tri", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    expect(() => engine.submitNightAction("det", "DETECTIVE_CHECK", "det", "v1")).toThrow(
      /không thể tự đưa mình/i,
    );
    expect(() => engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "det")).toThrow(
      /không thể tự đưa mình/i,
    );
    // Danh sách hợp lệ phải nói cùng một điều, nếu không client vẫn mời người
    // chơi bấm vào một nước mà engine sẽ từ chối.
    expect(engine.botKnowledgeFor("det").night?.legalTargets.DETECTIVE_CHECK).not.toContain("det");
  });
});

describe("Apprentice Seer Mechanics", () => {
  it("cannot act while Seer is alive", () => {
    const state = createTestState([
      { id: "seer", role: "SEER" },
      { id: "app", role: "APPRENTICE_SEER" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    expect(engine.hasNightAction("APPRENTICE_SEER")).toBe(false);
    expect(() => engine.submitNightAction("app", "SEE", "w1")).toThrow();
  });

  it("awakens when Seer dies in night and can act next night", () => {
    const state = createTestState([
      { id: "seer", role: "SEER" },
      { id: "app", role: "APPRENTICE_SEER" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    // Wolf kills Seer
    engine.submitNightAction("w1", "KILL", "seer");
    engine.resolveNight();

    expect(engine.state.apprenticeAwakened).toBe(true);

    // Start next night
    engine.setPhase("NIGHT", 30000);
    expect(engine.hasNightAction("APPRENTICE_SEER")).toBe(true);

    engine.submitNightAction("app", "SEE", "w1");
    const snap = engine.snapshotFor("app");
    expect(snap.nightInfo?.seerResult?.isWolf).toBe(true);
  });

  it("awakens when Seer dies in day voting", () => {
    const state = createTestState([
      { id: "seer", role: "SEER" },
      { id: "app", role: "APPRENTICE_SEER" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.setPhase("VOTING", 30000);
    engine.submitVote("v1", "seer");
    engine.submitVote("w1", "seer");
    engine.submitVote("app", "seer");

    engine.resolveNomination(20000);
    engine.beginFinalVote(20000);
    engine.submitFinalVote("v1", true);
    engine.submitFinalVote("w1", true);
    engine.submitFinalVote("app", true);

    engine.resolveFinalVote();

    expect(engine.player("seer")?.alive).toBe(false);
    expect(engine.state.apprenticeAwakened).toBe(true);
  });
});

describe("Wolf Cub Rage Mechanics", () => {
  it("triggers rage on next night when Wolf Cub dies", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF" },
      { id: "wc", role: "WOLF_CUB" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "witch", role: "WITCH" },
    ]);
    const engine = new GameEngine(state);

    // Witch poisons the wolf cub (after wolf votes lock so she may act).
    // Wolves skip biting this night so the cub is the only death.
    engine.submitNightAction("w1", "SKIP", null);
    engine.lockWolves();
    engine.submitNightAction("witch", "POISON", "wc");
    engine.resolveNight();

    expect(engine.state.wolfCubRageNextNight).toBe(true);

    // Transition to next night
    engine.setPhase("NIGHT", 30000);
    expect(engine.state.night.wolfCubRageTonight).toBe(true);
    expect(engine.state.wolfCubRageNextNight).toBe(false);

    // Wolf bites two targets
    engine.state.night.wolfSecondaryTarget = "v2";
    engine.submitNightAction("w1", "KILL", "v1");

    const deaths = engine.resolveNight();
    expect(deaths.map((d) => d.playerId)).toContain("v1");
    expect(deaths.map((d) => d.playerId)).toContain("v2");
  });

  // Ô cắn phụ dùng chung cho cả bầy chứ không nằm trong phiếu bầu, nên phiếu
  // chính hoàn toàn có thể chốt trúng đúng người đã bị đánh dấu cắn thêm. Trước
  // đây đêm đó chỉ chết một người: `addDeath` lọc trùng và bầy sói mất trắng
  // vết cắn thứ hai mà phẫn nộ Sói Con vừa cho.
  it("đẩy đòn cắn phụ sang mục tiêu khác khi phiếu chính chốt trúng chính nó", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF" },
      { id: "w2", role: "WEREWOLF" },
      { id: "w3", role: "WEREWOLF" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "v3", role: "VILLAGER" },
      { id: "v4", role: "VILLAGER" },
      { id: "v5", role: "VILLAGER" },
    ]);
    state.night.wolfCubRageTonight = true;
    const engine = new GameEngine(state);

    // v2 thắng phiếu chính 2-1, nhưng cũng đang là mục tiêu phụ của w1.
    engine.submitNightAction("w1", "KILL", "v1", "v2");
    engine.submitNightAction("w2", "KILL", "v2");
    engine.submitNightAction("w3", "KILL", "v2");

    expect(engine.lockWolves()).toBe("v2");
    expect(engine.state.night.wolfSecondaryTarget).toBe("v1");

    const deaths = engine.resolveNight();
    expect(deaths.map((d) => d.playerId).sort()).toEqual(["v1", "v2"]);
  });

  // Cùng gốc lỗi ở phía ngược lại: một Sói bầu trúng người đang nằm ở ô phụ thì
  // trước đây ô phụ bị xoá ngay lúc gửi phiếu, kể cả khi phiếu chính cuối cùng
  // chốt sang người khác và hai vết cắn vẫn còn chỗ để rơi xuống.
  it("giữ đòn cắn phụ khi một Sói khác bầu trùng người đang bị đánh dấu", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF" },
      { id: "w2", role: "WEREWOLF" },
      { id: "w3", role: "WEREWOLF" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "v3", role: "VILLAGER" },
      { id: "v4", role: "VILLAGER" },
      { id: "v5", role: "VILLAGER" },
    ]);
    state.night.wolfCubRageTonight = true;
    const engine = new GameEngine(state);

    engine.submitNightAction("w1", "KILL", "v1", "v2");
    engine.submitNightAction("w2", "KILL", "v2");
    engine.submitNightAction("w3", "KILL", "v1");

    expect(engine.state.night.wolfSecondaryTarget).toBe("v2");
    expect(engine.lockWolves()).toBe("v1");

    const deaths = engine.resolveNight();
    expect(deaths.map((d) => d.playerId).sort()).toEqual(["v1", "v2"]);
  });

  // Cả bầy chỉ bầu đúng một người: không có nạn nhân thứ hai để đẩy sang, và
  // recap không được phép khoe một cú cắn kép không tồn tại.
  it("xoá đòn cắn phụ khi phiếu bầy không còn ứng viên nào khác", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "v3", role: "VILLAGER" },
    ]);
    state.night.wolfCubRageTonight = true;
    const engine = new GameEngine(state);

    engine.submitNightAction("w1", "KILL", "v1", "v2");
    engine.submitNightAction("w1", "KILL", "v2");

    expect(engine.lockWolves()).toBe("v2");
    expect(engine.state.night.wolfSecondaryTarget).toBeNull();

    const deaths = engine.resolveNight();
    expect(deaths.map((d) => d.playerId)).toEqual(["v2"]);
  });
});

describe("Night Recap - đủ diễn biến vai trò mở rộng", () => {
  it("ghi lại 2 mục tiêu Thám Tử kiểm tra", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);
    engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "w1");
    engine.resolveNight();

    const night = engine.state.nightHistory[0];
    expect(night.detectiveChecks).toEqual([
      {
        detective: { id: "det", name: "Player 1" },
        target1: { id: "v1", name: "Player 2" },
        target2: { id: "w1", name: "Player 3" },
        sameTeam: false,
      },
    ]);
  });

  it("ghi lại mục tiêu soi thứ 2 của Tiên Tri khi có sự kiện Màn Sương Tan", () => {
    const state = createTestState([
      { id: "seer", role: "SEER" },
      { id: "w1", role: "WEREWOLF" },
      { id: "v1", role: "VILLAGER" },
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
    engine.resolveNight();

    const night = engine.state.nightHistory[0];
    expect(night.seerChecks).toEqual([
      {
        seer: { id: "seer", name: "Player 1" },
        target: { id: "w1", name: "Player 2" },
        isWolf: true,
        team: "wolves",
        secondaryTarget: { id: "v1", name: "Player 3" },
        secondaryIsWolf: false,
      },
    ]);
  });

  it("ghi lại mục tiêu cắn thứ 2 khi Sói Con phẫn nộ", () => {
    const state = createTestState([
      { id: "w1", role: "WEREWOLF" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
    ]);
    state.night.wolfCubRageTonight = true;
    const engine = new GameEngine(state);
    engine.submitNightAction("w1", "KILL", "v1", "v2");
    engine.resolveNight();

    const night = engine.state.nightHistory[0];
    expect(night.wolfSecondaryTarget).toEqual({ id: "v2", name: "Player 3" });
  });
});

describe("Mayor 2x Vote Weight", () => {
  it("counts Mayor nomination vote as 2 votes", () => {
    const state = createTestState([
      { id: "mayor", role: "MAYOR" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "pA", role: "VILLAGER" },
      { id: "pB", role: "VILLAGER" },
    ]);
    const engine = new GameEngine(state);

    engine.setPhase("VOTING", 30000);
    // 2 villagers vote pA (2 votes)
    engine.submitVote("v1", "pA");
    engine.submitVote("v2", "pA");
    // Mayor votes pB (counts as 2 votes)
    engine.submitVote("mayor", "pB");

    const tally = engine.voteTally();
    expect(tally.players["pA"]).toBe(2);
    expect(tally.players["pB"]).toBe(2);
  });

  it("counts Mayor final vote as 2 in trial", () => {
    const state = createTestState([
      { id: "accused", role: "VILLAGER" },
      { id: "mayor", role: "MAYOR" },
      { id: "v1", role: "VILLAGER" },
    ]);
    const engine = new GameEngine(state);

    engine.state.trial = {
      accusedId: "accused",
      finalVotes: {},
    };
    engine.setPhase("FINAL_VOTE", 20000);

    // Mayor votes guilty (2 votes)
    engine.submitFinalVote("mayor", true);
    // v1 votes innocent (1 vote)
    engine.submitFinalVote("v1", false);

    const tally = engine.finalVoteTally();
    expect(tally.guilty).toBe(2);
    expect(tally.innocent).toBe(1);
    expect(tally.eligible).toBe(3);

    const eliminated = engine.resolveFinalVote();
    expect(eliminated?.playerId).toBe("accused");
    expect(engine.player("accused")?.alive).toBe(false);
  });
});

describe("Đổi ý trong đêm không đốt mất lượt", () => {
  it("Phù Thuỷ bỏ qua sau khi đã chọn thuốc thì không dùng thuốc", () => {
    const state = createTestState([
      { id: "witch", role: "WITCH" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("w1", "KILL", "v1");
    engine.lockWolves();
    engine.submitNightAction("witch", "POISON", "v2");
    engine.submitNightAction("witch", "SKIP", null);
    engine.resolveNight();

    expect(engine.player("v2")?.alive).toBe(true);
    expect(engine.state.poisonUsed).toBe(false);
  });
});

describe("Vai thông tin chỉ có MỘT lượt mỗi đêm", () => {
  it("Tiên Tri không soi được người thứ hai trong cùng một đêm", () => {
    const state = createTestState([
      { id: "seer", role: "SEER" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
      { id: "w2", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("seer", "SEE", "v1");
    expect(() => engine.submitNightAction("seer", "SEE", "w1")).toThrow(/đã soi/);

    // Kết quả giữ nguyên ở mục tiêu đầu: lần nộp bị từ chối không được ghi đè.
    const snap = engine.snapshotFor("seer");
    expect(snap.nightInfo?.seerResult?.targetId).toBe("v1");
    expect(snap.nightInfo?.seerResult?.isWolf).toBe(false);
  });

  it("Thám Tử không điều tra được cặp thứ hai trong cùng một đêm", () => {
    const state = createTestState([
      { id: "det", role: "DETECTIVE" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
      { id: "w2", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("det", "DETECTIVE_CHECK", "v1", "w1");
    expect(() => engine.submitNightAction("det", "DETECTIVE_CHECK", "w1", "w2")).toThrow(/đã điều tra/);

    const snap = engine.snapshotFor("det");
    expect(snap.nightInfo?.detectiveResult?.target2.id).toBe("w1");
    expect(snap.nightInfo?.detectiveResult?.sameTeam).toBe(false);
  });

  it("cả làng không bị quét sạch trong một đêm", () => {
    const state = createTestState([
      { id: "seer", role: "SEER" },
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
      { id: "w2", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    let resolved = 0;
    for (const targetId of ["v1", "v2", "w1", "w2"]) {
      try {
        engine.submitNightAction("seer", "SEE", targetId);
        resolved += 1;
      } catch {
        /* đúng như mong đợi từ lần thứ hai trở đi */
      }
    }

    expect(resolved).toBe(1);
    expect(Object.keys(engine.state.night.seerResults)).toHaveLength(1);
  });
});

describe("allNightActionsDone", () => {
  it("false khi còn người chưa nộp, true khi mọi lượt đã xong", () => {
    const state = createTestState([
      { id: "seer", role: "SEER" },
      { id: "guard", role: "GUARD" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    expect(engine.allNightActionsDone()).toBe(false);
    engine.submitNightAction("w1", "KILL", "v1");
    expect(engine.allNightActionsDone()).toBe(false);
    engine.submitNightAction("seer", "SEE", "w1");
    expect(engine.allNightActionsDone()).toBe(false);
    engine.submitNightAction("guard", "GUARD", "v1");
    expect(engine.allNightActionsDone()).toBe(true);
  });

  it("Dân Làng và người chết không giữ đêm lại", () => {
    const state = createTestState([
      { id: "v1", role: "VILLAGER" },
      { id: "v2", role: "VILLAGER" },
      { id: "seer", role: "SEER", alive: false },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("w1", "KILL", "v1");
    expect(engine.allNightActionsDone()).toBe(true);
  });

  it("Phù Thuỷ chỉ giữ đêm lại sau khi phiếu Sói đã khoá", () => {
    const state = createTestState([
      { id: "witch", role: "WITCH" },
      { id: "v1", role: "VILLAGER" },
      { id: "w1", role: "WEREWOLF" },
    ]);
    const engine = new GameEngine(state);

    engine.submitNightAction("w1", "KILL", "v1");
    // Chặng một: chưa tới lượt Phù Thuỷ, nên đêm đã đủ điều kiện chốt phiếu Sói.
    expect(engine.allNightActionsDone()).toBe(true);

    engine.lockWolves();
    // Chặng hai: giờ mới là lượt của cô ta.
    expect(engine.allNightActionsDone()).toBe(false);
    engine.submitNightAction("witch", "SKIP", null);
    expect(engine.allNightActionsDone()).toBe(true);
  });
});

describe("revealRoleOnDeath (biến thể luật đang đo)", () => {
  function deadRolesState(reveal: boolean) {
    const state = createTestState([
      { id: "seer", role: "SEER", alive: false },
      { id: "v1", role: "VILLAGER", alive: false },
      { id: "guard", role: "GUARD", alive: true },
      { id: "w1", role: "WEREWOLF", alive: true },
      { id: "w2", role: "WEREWOLF", alive: true },
    ]);
    state.config = { ...state.config, revealRoleOnDeath: reveal };
    return new GameEngine(state);
  }

  it("tắt: vai người chết vẫn kín, đúng như luật mặc định", () => {
    const engine = deadRolesState(false);

    const seen = engine.snapshotFor("guard").players.filter((p) => p.role !== undefined);
    expect(seen).toHaveLength(0);
    expect(engine.botKnowledgeFor("guard").knownRoles).toEqual({ guard: "GUARD" });
  });

  it("bật: đưa vai người chết vào knownRoles", () => {
    const engine = deadRolesState(true);

    // Cả hai đường phải khớp nhau: một biến thể luật mà BOT không nhìn thấy sẽ
    // đo ra "không ảnh hưởng gì" bất kể nó ảnh hưởng thế nào tới người thật.
    const seen = engine.snapshotFor("guard").players.filter((p) => p.role !== undefined);
    expect(seen.map((p) => p.id).sort()).toEqual(["seer", "v1"]);
    expect(engine.botKnowledgeFor("guard").knownRoles).toEqual({
      guard: "GUARD",
      seer: "SEER",
      v1: "VILLAGER",
    });
  });

  it("bật: KHÔNG đụng tới vai người còn sống", () => {
    const engine = deadRolesState(true);

    const known = engine.botKnowledgeFor("guard").knownRoles;
    expect(known.w1).toBeUndefined();
    expect(known.w2).toBeUndefined();
  });
});
