import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { buildRoleDeck } from "../src/assignRoles";
import type { GameState, NightState } from "../src/types";
import { DEFAULT_ROOM_CONFIG, validateRoomConfig, type RoomConfig } from "@masoi/shared";

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 1,
  hunter: false,
  cursed: false,
  jester: true,
};

function emptyNight(): NightState {
  return {
    wolfVotes: {},
    killTarget: null,
    wolvesLocked: false,
    guardTarget: null,
    healTonight: false,
    poisonTarget: null,
    witchSkipped: false,
    seerResults: {},
    wolfSecondaryTarget: null,
    wolfCubRageTonight: false,
    detectiveTargets: null,
    detectiveResults: {},
    sorcererResults: {},
    trackerTargets: {},
    trackerResults: {},
  };
}

/**
 * Bàn cố định có đúng một Thằng Hề.
 *
 * Vai được gán TAY chứ không qua `assignRoles`: mọi khẳng định ở đây nói về
 * "chuyện gì xảy ra với Thằng Hề", nên ai cầm lá nào phải là một hằng số của
 * bài test chứ không phải kết quả của một lần xáo bài.
 */
function jesterState(over: Partial<GameState> = {}): GameState {
  return {
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: 30_000,
    phaseStartedAt: 0,
    voteMutations: [],
    dayVoteHistory: [],
    trial: null,
    lastTrial: null,
    players: [
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "jester", name: "Hề", role: "JESTER", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
      { id: "extra", name: "Dân Thêm", role: "VILLAGER", alive: true, isBot: false },
      { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
      { id: "detective", name: "Thám Tử", role: "DETECTIVE", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...CONFIG },
    winner: null,
    night: emptyNight(),
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    hunterReaction: null,
    hunterShots: [],
    alphaShieldUsed: {},
    apprenticeAwakened: false,
    wolfCubRageNextNight: false,
    activeEvent: null,
    eventHistory: [],
    log: [],
    pendingLastStandVictim: null,
    bloodMoonArmed: false,
    bloodMoonUsed: false,
    deadCanSpeakUsed: false,
    deadCanSpeakChosenId: null,
    howlBonusDay: null,
    dayOfTruthClaims: {},
    personalWins: [],
    ...over,
  };
}

function jesterEngine(over: Partial<GameState> = {}): GameEngine {
  return new GameEngine(jesterState(over));
}

function playerOf(engine: GameEngine, id: string) {
  return engine.state.players.find((p) => p.id === id)!;
}

/** Đưa `targetId` ra toà: cả làng đề cử, rồi bỏ phiếu Treo hoặc Tha. */
function tryInCourt(engine: GameEngine, targetId: string, guilty: boolean) {
  engine.setPhase("DAY_DISCUSSION", 60_000, 0);
  engine.setPhase("VOTING", 30_000, 0);
  for (const voter of engine.alivePlayers()) {
    if (voter.id !== targetId) engine.submitVote(voter.id, targetId, 10_000);
  }
  engine.resolveNomination(25_000, 30_000);
  engine.beginFinalVote(20_000);
  for (const voter of engine.finalVoters()) engine.submitFinalVote(voter.id, guilty);
  return engine.resolveFinalVote();
}

describe("Thằng Hề - điều kiện thắng cá nhân", () => {
  it("bị treo cổ thì ghi nhận thắng cá nhân, kèm đúng vòng", () => {
    const engine = jesterEngine();
    engine.state.round = 2;
    tryInCourt(engine, "jester", true);

    expect(playerOf(engine, "jester").alive).toBe(false);
    expect(engine.personalWins()).toEqual([
      {
        playerId: "jester",
        name: "Hề",
        role: "JESTER",
        condition: "JESTER_LYNCHED",
        round: 2,
      },
    ]);
  });

  it("KHÔNG kết thúc ván và KHÔNG đổi phe thắng chung", () => {
    // Đây là ranh giới của cả tính năng: một thắng lợi cá nhân được GHI NHẬN
    // rồi ván chạy tiếp. Nếu nó cắt ngang ván thì mọi người còn lại mất trắng
    // phần chơi của mình vì lựa chọn của một người khác.
    const engine = jesterEngine();
    tryInCourt(engine, "jester", true);

    expect(engine.state.winner).toBeNull();
    expect(engine.state.phase).toBe("ELIMINATION");
    // Sói vẫn còn, làng vẫn đông hơn: ván chưa ngã ngũ, đúng như trước cú treo.
    expect(engine.checkWin()).toBeNull();
  });

  it("được tha thì KHÔNG tính - bị đề cử không phải là bị treo", () => {
    const engine = jesterEngine();
    const eliminated = tryInCourt(engine, "jester", false);

    expect(eliminated).toBeNull();
    expect(playerOf(engine, "jester").alive).toBe(true);
    expect(engine.personalWins()).toEqual([]);
  });

  it("chết vì Sói cắn thì KHÔNG tính", () => {
    const engine = jesterEngine();
    engine.submitNightAction("wolf", "KILL", "jester");
    engine.resolveNight();

    expect(playerOf(engine, "jester").alive).toBe(false);
    expect(engine.personalWins()).toEqual([]);
  });

  it("chết vì bình độc thì KHÔNG tính", () => {
    const engine = jesterEngine();
    engine.submitNightAction("wolf", "KILL", "villager");
    engine.lockWolves();
    engine.submitNightAction("witch", "POISON", "jester");
    engine.resolveNight();

    expect(playerOf(engine, "jester").alive).toBe(false);
    expect(engine.personalWins()).toEqual([]);
  });

  it("chết vì phát bắn của Thợ Săn thì KHÔNG tính", () => {
    const engine = jesterEngine();
    // Thợ Săn thay chỗ Thám Tử: bàn vẫn 7 người, chỉ đổi một lá bài.
    playerOf(engine, "detective").role = "HUNTER";
    engine.submitNightAction("wolf", "KILL", "detective");
    engine.resolveNight();
    engine.setPhase("HUNTER_SHOT", 15_000);
    engine.submitHunterShot("detective", "jester");

    expect(playerOf(engine, "jester").alive).toBe(false);
    expect(engine.personalWins()).toEqual([]);
  });

  it("ghi nhận ĐÚNG MỘT LẦN, kể cả khi bước chuyển pha chạy lại", () => {
    // Ca thật đứng sau khẳng định này: một process khôi phục sau restart có
    // thể dựng lại engine từ snapshot rồi chạy lại đúng bước vừa chạy.
    const engine = jesterEngine();
    tryInCourt(engine, "jester", true);
    const after = new GameEngine(JSON.parse(JSON.stringify(engine.state)));
    // Ép chạy lại chính nhánh ghi nhận trên một state đã có sẵn thành tích.
    after.state.phase = "FINAL_VOTE";
    after.state.trial = { accusedId: "jester", finalVotes: {} };
    playerOf(after, "jester").alive = true;
    for (const voter of after.finalVoters()) after.submitFinalVote(voter.id, true);
    after.resolveFinalVote();

    expect(after.personalWins()).toHaveLength(1);
  });

  it("sống sót tới hết ván là THUA: không có thành tích nào được ghi", () => {
    const engine = jesterEngine();
    // Làng treo đúng con Sói -> làng thắng, Hề còn sống và không được gì.
    tryInCourt(engine, "wolf", true);

    expect(engine.checkWin()).toBe("village");
    expect(playerOf(engine, "jester").alive).toBe(true);
    expect(engine.personalWins()).toEqual([]);
  });

  it("thành tích sống tới cuối ván, kể cả khi phe khác thắng sau đó", () => {
    const engine = jesterEngine();
    tryInCourt(engine, "jester", true);
    // Sau cú treo, làng tóm nốt con Sói ở vòng sau.
    engine.state.round = 2;
    tryInCourt(engine, "wolf", true);
    const winner = engine.checkWin();
    expect(winner).toBe("village");
    engine.finishGame(winner!);

    expect(engine.state.winner).toBe("village");
    expect(engine.personalWins()).toHaveLength(1);
    expect(engine.state.log.some((line) => line.includes("thắng cá nhân"))).toBe(true);
  });

  it("ghi nhận trước khi ván kết thúc ngay sau cú treo", () => {
    /*
     * Ca gắt nhất của thứ tự xử lý: cú treo chính nó đưa bầy Sói tới thế cân
     * bằng. Nếu thành tích được ghi SAU `checkWin` thì đúng những ván này -
     * ván mà Hề mua bằng cả mạng mình - sẽ nuốt mất nó.
     */
    const engine = jesterEngine();
    for (const id of ["seer", "extra", "witch", "detective"]) {
      playerOf(engine, id).alive = false;
    }
    // Còn: wolf, jester, villager. Treo Hề -> 1 Sói vs 1 người còn lại.
    tryInCourt(engine, "jester", true);

    expect(engine.personalWins()).toHaveLength(1);
    expect(engine.checkWin()).toBe("wolves");
  });

  it("ván mới xoá sạch sổ thành tích", () => {
    const engine = jesterEngine();
    tryInCourt(engine, "jester", true);
    expect(engine.personalWins()).toHaveLength(1);

    const next = GameEngine.create(
      engine.state.players.map((p) => ({ id: p.id, name: p.name, isBot: p.isBot })),
      { ...CONFIG },
    );
    expect(next.personalWins()).toEqual([]);
  });

  it("state lưu trước khi có tính năng này đọc lên thành sổ rỗng", () => {
    const legacy = jesterState();
    delete (legacy as { personalWins?: unknown }).personalWins;
    delete (legacy.config as { jester?: unknown }).jester;

    const engine = new GameEngine(legacy);
    expect(engine.personalWins()).toEqual([]);
    expect(engine.state.config.jester).toBe(false);
  });
});

describe("Thằng Hề - tương tác với luật hiện có", () => {
  it("Tiên Tri soi ra PHE TRUNG LẬP, không lộ vai cụ thể", () => {
    const engine = jesterEngine();
    engine.submitNightAction("seer", "SEE", "jester");

    expect(engine.state.night.seerResults.seer).toEqual({
      targetId: "jester",
      isWolf: false,
      team: "neutral",
    });
    const view = engine.snapshotFor("seer").nightInfo!.seerResult!;
    expect(view.team).toBe("neutral");
    expect(view.isWolf).toBe(false);
    // Không có trường nào mang mã vai: "phe trung lập" là tất cả những gì
    // lượt soi được phép nói.
    expect(JSON.stringify(view)).not.toContain("JESTER");
  });

  it("Thám Tử thấy Hề KHÁC PHE với cả Dân lẫn Sói", () => {
    const withVillager = jesterEngine();
    withVillager.submitNightAction("detective", "DETECTIVE_CHECK", "jester", "villager");
    expect(withVillager.state.night.detectiveResults.detective.sameTeam).toBe(false);

    const withWolf = jesterEngine();
    withWolf.submitNightAction("detective", "DETECTIVE_CHECK", "jester", "wolf");
    expect(withWolf.state.night.detectiveResults.detective.sameTeam).toBe(false);
  });

  it("Hề không có lượt đêm nào", () => {
    const engine = jesterEngine();
    expect(engine.hasNightAction("JESTER")).toBe(false);
    expect(engine.snapshotFor("jester").nightInfo).toBeNull();
    // Không kênh hành động nào: mọi lệnh đêm đều bị engine từ chối.
    expect(() => engine.submitNightAction("jester", "KILL", "villager")).toThrow();
    expect(() => engine.submitNightAction("jester", "SEE", "villager")).toThrow();
    expect(() => engine.submitNightAction("jester", "SKIP", null)).toThrow();
  });

  it("Sói không được thấy Hề là đồng bọn, và Hề không thấy Sói", () => {
    const engine = jesterEngine();
    const wolfView = engine.snapshotFor("wolf");
    expect(wolfView.players.find((p) => p.id === "jester")?.role).toBeUndefined();

    const jesterView = engine.snapshotFor("jester");
    expect(jesterView.players.filter((p) => p.role !== undefined)).toEqual([]);
    expect(engine.botKnowledgeFor("jester").knownRoles).toEqual({ jester: "JESTER" });
  });

  it("Hề còn sống được tính vào số người KHÔNG phải Sói", () => {
    const engine = jesterEngine();
    for (const id of ["seer", "extra", "witch", "detective"]) {
      playerOf(engine, id).alive = false;
    }
    // 1 Sói vs (Hề + Dân) = 2 -> chưa cân bằng, ván chưa xong.
    expect(engine.checkWin()).toBeNull();

    playerOf(engine, "villager").alive = false;
    // 1 Sói vs (Hề) = 1 -> Sói đạt thế cân bằng nhờ chính lá phiếu của Hề.
    expect(engine.checkWin()).toBe("wolves");
  });

  it("hết Sói thì làng thắng dù Hề còn sống", () => {
    const engine = jesterEngine();
    playerOf(engine, "wolf").alive = false;
    expect(engine.checkWin()).toBe("village");
  });
});

describe("Thằng Hề - lộ thông tin", () => {
  it("thành tích chỉ hiện cho chính chủ trước khi lật bài", () => {
    /*
     * Luật của phòng là cái chết KHÔNG tiết lộ gì cho tới `GAME_OVER`. Một
     * danh sách thắng lợi công khai ngay lúc treo sẽ nói thẳng vai của người
     * vừa chết cho cả bàn - kể cả khi không component nào vẽ nó ra, vì payload
     * đi tới mọi trình duyệt.
     */
    const engine = jesterEngine();
    tryInCourt(engine, "jester", true);

    expect(engine.snapshotFor("jester").personalWins).toHaveLength(1);
    for (const id of ["wolf", "seer", "villager"]) {
      expect(engine.snapshotFor(id).personalWins).toEqual([]);
    }
  });

  it("lật bài xong thì cả phòng đọc được", () => {
    const engine = jesterEngine();
    tryInCourt(engine, "jester", true);
    engine.finishGame("village");

    for (const id of ["wolf", "seer", "villager", "jester"]) {
      expect(engine.snapshotFor(id).personalWins).toHaveLength(1);
    }
  });

  it("snapshot trả về bản SAO, không phải tham chiếu sống vào state", () => {
    const engine = jesterEngine();
    tryInCourt(engine, "jester", true);
    engine.finishGame("village");

    const view = engine.snapshotFor("wolf").personalWins;
    view[0].name = "bị sửa";
    expect(engine.personalWins()[0].name).toBe("Hề");
  });
});

describe("Thằng Hề - bộ bài và cấu hình", () => {
  it("tối đa một lá trong bộ bài", () => {
    const deck = buildRoleDeck({ ...CONFIG }, 7, () => 0.5);
    expect(deck.filter((role) => role === "JESTER")).toHaveLength(1);
  });

  it("không bật thì không có lá nào", () => {
    const deck = buildRoleDeck({ ...CONFIG, jester: false }, 7, () => 0.5);
    expect(deck).not.toContain("JESTER");
  });

  it("chiếm một ghế: cấu hình phải còn chỗ cho Dân Làng", () => {
    // 8 người, không phải 6: `MIN_PLAYERS_TO_START` lên 8 từ 2026-09-04, và
    // dưới ngưỡng đó `validateRoomConfig` trả lỗi số người trước khi tới được
    // phép đếm ghế mà test này muốn khẳng định.
    //
    // 1 Sói + Tiên Tri + Bảo Vệ + Phù Thuỷ + Thợ Săn + Thám Tử + Thị Trưởng +
    // Hề = 8 vai đặc biệt cho đúng 8 ghế, không còn chỗ nào cho Dân Làng.
    const full: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      werewolves: 1,
      seer: true,
      guard: true,
      witch: true,
      hunter: true,
      detective: true,
      mayor: true,
      jester: true,
    };
    expect(validateRoomConfig(full, 8)).toBe("Phải còn chỗ cho Dân Làng");
    expect(validateRoomConfig({ ...full, jester: false }, 8)).toBeNull();
  });
});
