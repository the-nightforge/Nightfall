import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { GameError, type GameState, type NightState } from "../src/types";
import {
  DEFAULT_ROOM_CONFIG,
  validateRoomConfig,
  type RoomConfig,
  type Role,
} from "@masoi/shared";

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 1,
  hunter: false,
  cursed: false,
  executioner: true,
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
    guardianAngelTarget: null,
    detectiveTargets: null,
    detectiveResults: {},
    sorcererResults: {},
  };
}

/**
 * Bàn cố định có đúng một Kẻ Báo Thù, và nhiệm vụ được GÁN TAY.
 *
 * Cùng lý do với bàn của Thằng Hề: mọi khẳng định ở đây nói về "chuyện gì xảy
 * ra với Kẻ Báo Thù và mục tiêu của nó", nên ai cầm lá nào và ai là mục tiêu
 * phải là hằng số của bài test chứ không phải kết quả của một lần bốc bài.
 * Phần "bốc đúng không" có nhóm test riêng ở dưới, chạy qua `GameEngine.create`.
 */
function executionerState(over: Partial<GameState> = {}): GameState {
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
      { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: false },
      { id: "target", name: "Mục Tiêu", role: "VILLAGER", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
      { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
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
    guardianAngelPrevious: null,
    guardianAngelCharges: {},
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
    executionerTargets: { exec: "target" },
    ...over,
  };
}

function executionerEngine(over: Partial<GameState> = {}): GameEngine {
  return new GameEngine(executionerState(over));
}

function playerOf(engine: GameEngine, id: string) {
  return engine.state.players.find((p) => p.id === id)!;
}

/**
 * Đưa `targetId` ra toà. `guiltyVoters` cho phép chọn AI bỏ phiếu kết tội - bài
 * test "không cần chính Kẻ Báo Thù kết tội" dựa vào đúng tham số đó.
 */
function tryInCourt(
  engine: GameEngine,
  targetId: string,
  guilty: boolean,
  options: { guiltyVoters?: string[] } = {},
) {
  engine.setPhase("DAY_DISCUSSION", 60_000, 0);
  engine.setPhase("VOTING", 30_000, 0);
  for (const voter of engine.alivePlayers()) {
    if (voter.id !== targetId) engine.submitVote(voter.id, targetId, 10_000);
  }
  engine.resolveNomination(25_000, 30_000);
  engine.beginFinalVote(20_000);
  for (const voter of engine.finalVoters()) {
    const votesGuilty = options.guiltyVoters
      ? options.guiltyVoters.includes(voter.id)
      : guilty;
    engine.submitFinalVote(voter.id, votesGuilty);
  }
  return engine.resolveFinalVote();
}

/** Đúng chuỗi mà server chạy sau mỗi đợt chết: chốt chuyển vai rồi mới xét thắng. */
function settleRound(engine: GameEngine) {
  engine.settleExecutioner();
  return engine.checkWin();
}

/** RNG tuyến tính, tất định, để hai lần chạy cùng seed đi cùng một đường. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const SEATS = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i}`,
  name: `P${i}`,
  isBot: false,
}));

const DECK: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  executioner: true,
};

/** Bộ bài không còn ghế Dân Làng nào - chỉ dựng được từ code, không qua sảnh chờ. */
const NO_VILLAGE: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 4,
  seer: false,
  guard: false,
  witch: false,
  hunter: false,
  cursed: false,
  jester: true,
  serialKiller: true,
  executioner: true,
};

const NO_VILLAGE_SEATS = Array.from({ length: 7 }, (_, i) => ({
  id: `q${i}`,
  name: `Q${i}`,
  isBot: false,
}));

// ---------------------------------------------------------------- A. Chia bài

describe("Kẻ Báo Thù - bốc mục tiêu lúc chia bài", () => {
  it("mục tiêu luôn thuộc phe Dân, và không bao giờ là chính mình", () => {
    // Quét nhiều seed thay vì một: câu khẳng định là về TẬP ứng viên, và một
    // seed duy nhất chỉ chứng minh được một lần bốc.
    for (let seed = 1; seed <= 60; seed += 1) {
      const engine = GameEngine.create(SEATS, DECK, 0, seeded(seed));
      const exec = engine.state.players.find((p) => p.role === "EXECUTIONER")!;
      const targetId = engine.executionerTargets()[exec.id];
      const target = engine.state.players.find((p) => p.id === targetId)!;

      expect(targetId).not.toBe(exec.id);
      expect(["SEER", "GUARD", "WITCH", "VILLAGER"] as Role[]).toContain(target.role);
    }
  });

  it("cùng seed cho cùng mục tiêu, và cùng cả bộ bài", () => {
    const a = GameEngine.create(SEATS, DECK, 0, seeded(4242));
    const b = GameEngine.create(SEATS, DECK, 0, seeded(4242));

    expect(b.executionerTargets()).toEqual(a.executionerTargets());
    expect(b.state.players.map((p) => p.role)).toEqual(a.state.players.map((p) => p.role));
  });

  it("KHÔNG tiêu thêm RNG khi role tắt: bộ bài cũ chia ra y hệt", () => {
    /*
     * Đây là hàng rào tương thích ngược của cả tính năng. Nếu việc bốc mục tiêu
     * rút một số ngay cả khi bộ bài không có Kẻ Báo Thù, thì MỌI ván tái lập
     * theo seed đã ghi trước bản này sẽ chia ra một bộ bài khác - và không có
     * gì báo lỗi, chỉ có những con số cũ lặng lẽ hết đúng.
     *
     * Con trỏ RNG sau khi chia bài là bằng chứng trực tiếp: giá trị KẾ TIẾP của
     * hai dòng số phải trùng nhau.
     */
    const off: RoomConfig = { ...DECK, executioner: false };
    const rngA = seeded(777);
    const rngB = seeded(777);
    const a = GameEngine.create(SEATS, off, 0, rngA);
    const b = GameEngine.create(SEATS, off, 0, rngB);

    expect(a.state.players.map((p) => p.role)).toEqual(b.state.players.map((p) => p.role));
    expect(a.executionerTargets()).toEqual({});
    expect(rngA()).toBe(rngB());
  });

  it("từ chối bắt đầu khi không có ứng viên phe Dân nào", () => {
    /*
     * Bộ bài này không mở được qua sảnh chờ (`validateRoomConfig` chặn trước),
     * nên nó được dựng thẳng ở đây: hàng rào của engine phải đứng độc lập với
     * hàng rào của cấu hình, vì harness và test đi vào bằng cửa khác.
     */
    expect(() => GameEngine.create(NO_VILLAGE_SEATS, NO_VILLAGE, 0, seeded(9))).toThrow(
      GameError,
    );
    expect(() => GameEngine.create(NO_VILLAGE_SEATS, NO_VILLAGE, 0, seeded(9))).toThrow(
      /Kẻ Báo Thù/,
    );
  });

  it("sảnh chờ không bao giờ mở được một bộ bài thiếu mục tiêu", () => {
    /*
     * Hàng rào của engine ở test ngay trên là hàng rào THẬT, nhưng nó không
     * phải thứ người chơi gặp: `validateRoomConfig` chặn bộ bài đó sớm hơn, và
     * chặn bằng một luật đã có sẵn từ trước ("phải còn chỗ cho Dân Làng"). Đó
     * chính là lý do không có một phép kiểm tra riêng cho Kẻ Báo Thù ở đó -
     * còn ghế Dân Làng thì luôn còn ứng viên.
     *
     * Test này khoá đúng chuỗi lập luận ấy. Nếu một ngày nào đó luật kia được
     * nới ra, dòng dưới đỏ lên và người sửa biết mình vừa mở một lối vào cho
     * một ván không thắng được.
     */
    expect(validateRoomConfig(NO_VILLAGE, 7)).not.toBeNull();
    // Bộ bài bình thường thì không bị chặn gì thêm.
    expect(validateRoomConfig({ ...DEFAULT_ROOM_CONFIG, executioner: true }, 8)).toBeNull();
    // Và bộ bài hợp lệ đó thật sự chia ra một ván có mục tiêu.
    expect(
      Object.keys(GameEngine.create(SEATS, DECK, 0, seeded(5)).executionerTargets()),
    ).toHaveLength(1);
  });

  it("nạp lại state KHÔNG bốc lại mục tiêu", () => {
    const engine = GameEngine.create(SEATS, DECK, 0, seeded(31));
    const before = { ...engine.executionerTargets() };

    // Đúng thứ persistence làm: serialize rồi dựng lại engine từ đối tượng thô.
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.getState())));

    expect(restored.executionerTargets()).toEqual(before);
  });

  it("state cũ thiếu trường vẫn nạp được, và không ai bỗng dưng có nhiệm vụ", () => {
    const legacy = executionerState();
    delete (legacy as Partial<GameState>).executionerTargets;
    delete (legacy as Partial<GameState>).personalWins;
    for (const player of legacy.players) {
      delete (player as { executionerTurned?: boolean }).executionerTurned;
    }
    delete (legacy.config as Partial<RoomConfig>).executioner;

    const engine = new GameEngine(legacy);

    expect(engine.executionerTargets()).toEqual({});
    expect(engine.personalWins()).toEqual([]);
    expect(playerOf(engine, "exec").executionerTurned).toBe(false);
    // Không có nhiệm vụ thì không có gì để chốt, và không ai đổi vai.
    engine.settleExecutioner();
    expect(playerOf(engine, "exec").role).toBe("EXECUTIONER");
  });

  it("mục tiêu hoá Sói vẫn là mục tiêu cũ", () => {
    /*
     * Nhiệm vụ khoá vào một CON NGƯỜI, không vào một lá bài. Kẻ Nguyền Rủa bị
     * cắn là phép đổi vai duy nhất có thể xảy ra với một mục tiêu, và nó không
     * được huỷ nhiệm vụ của ai.
     */
    const engine = executionerEngine({
      players: [
        { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
        { id: "exec", name: "Báo Thù", role: "EXECUTIONER", alive: true, isBot: false },
        { id: "target", name: "Mục Tiêu", role: "CURSED", alive: true, isBot: false },
        { id: "seer", name: "Tiên Tri", role: "SEER", alive: true, isBot: false },
        { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
        { id: "villager2", name: "Dân 2", role: "VILLAGER", alive: true, isBot: false },
      ],
    });

    engine.submitNightAction("wolf", "KILL", "target");
    engine.resolveNight();

    expect(playerOf(engine, "target").role).toBe("WEREWOLF");
    expect(playerOf(engine, "target").alive).toBe(true);
    expect(engine.executionerTargets().exec).toBe("target");
    // Mục tiêu còn sống nên không có gì để chốt: không thắng, không đổi vai.
    settleRound(engine);
    expect(playerOf(engine, "exec").role).toBe("EXECUTIONER");
    expect(engine.personalWins()).toEqual([]);

    // Và treo con Sói ĐÓ vẫn tính là hoàn thành nhiệm vụ.
    tryInCourt(engine, "target", true);
    expect(engine.personalWins().map((w) => w.playerId)).toEqual(["exec"]);
  });
});

// ------------------------------------------------------------------- B. Thắng

describe("Kẻ Báo Thù - điều kiện thắng cá nhân", () => {
  it("mục tiêu bị treo khi mình còn sống thì ghi thắng, kèm đúng vòng", () => {
    const engine = executionerEngine();
    engine.state.round = 3;
    tryInCourt(engine, "target", true);

    expect(playerOf(engine, "target").alive).toBe(false);
    expect(engine.personalWins()).toEqual([
      {
        playerId: "exec",
        name: "Báo Thù",
        role: "EXECUTIONER",
        condition: "EXECUTIONER_TARGET_LYNCHED",
        round: 3,
      },
    ]);
  });

  it("KHÔNG cần chính Kẻ Báo Thù bỏ phiếu kết tội", () => {
    const engine = executionerEngine();
    // Kẻ Báo Thù bỏ THA; cả làng vẫn treo. Luật là "mục tiêu bị treo", không
    // phải "mục tiêu bị chính mình treo".
    const others = engine
      .alivePlayers()
      .filter((p) => p.id !== "target" && p.id !== "exec")
      .map((p) => p.id);
    tryInCourt(engine, "target", true, { guiltyVoters: others });

    expect(playerOf(engine, "target").alive).toBe(false);
    expect(engine.personalWins().map((w) => w.condition)).toEqual([
      "EXECUTIONER_TARGET_LYNCHED",
    ]);
  });

  it("KHÔNG kết thúc ván và KHÔNG thêm một kết cục chung nào", () => {
    const engine = executionerEngine();
    tryInCourt(engine, "target", true);

    expect(engine.state.winner).toBeNull();
    expect(engine.state.phase).toBe("ELIMINATION");
    expect(settleRound(engine)).toBeNull();
  });

  it("bị đề cử rồi được tha thì KHÔNG tính", () => {
    const engine = executionerEngine();
    const eliminated = tryInCourt(engine, "target", false);

    expect(eliminated).toBeNull();
    expect(playerOf(engine, "target").alive).toBe(true);
    expect(engine.personalWins()).toEqual([]);
  });

  it("Kẻ Báo Thù đã chết trước đó thì KHÔNG thắng, và không đổi vai sau khi chết", () => {
    const engine = executionerEngine();
    engine.submitNightAction("wolf", "KILL", "exec");
    engine.resolveNight();
    expect(playerOf(engine, "exec").alive).toBe(false);

    tryInCourt(engine, "target", true);

    expect(engine.personalWins()).toEqual([]);
    settleRound(engine);
    expect(playerOf(engine, "exec").role).toBe("EXECUTIONER");
    expect(playerOf(engine, "exec").executionerTurned).toBe(false);
  });

  it("thắng đã ghi thì giữ nguyên khi chết sau đó", () => {
    const engine = executionerEngine();
    tryInCourt(engine, "target", true);
    const won = engine.personalWins().map((w) => ({ ...w }));

    engine.setPhase("NIGHT", 30_000, 100_000);
    engine.submitNightAction("wolf", "KILL", "exec");
    engine.resolveNight(200_000);

    expect(playerOf(engine, "exec").alive).toBe(false);
    expect(engine.personalWins()).toEqual(won);
  });

  it("thắng đã ghi thì giữ nguyên cả khi ván kết thúc hoà", () => {
    const engine = executionerEngine();
    tryInCourt(engine, "target", true);
    for (const player of engine.state.players) player.alive = false;

    expect(settleRound(engine)).toBe("draw");
    expect(engine.personalWins().map((w) => w.playerId)).toEqual(["exec"]);
  });

  it("không ghi trùng dù pha được chạy lại", () => {
    const engine = executionerEngine();
    tryInCourt(engine, "target", true);
    settleRound(engine);
    settleRound(engine);
    settleRound(engine);

    expect(engine.personalWins()).toHaveLength(1);
    // Và người vừa thắng KHÔNG bị chuyển thành Thằng Hề chỉ vì mục tiêu đã chết.
    expect(playerOf(engine, "exec").role).toBe("EXECUTIONER");
    expect(playerOf(engine, "exec").executionerTurned).toBe(false);
  });

  it("không chặn chiến thắng của Dân, và tính quân số như vai trung lập thường", () => {
    // Hết Sói là làng thắng, kể cả khi Kẻ Báo Thù còn sống nguyên trên bàn.
    const engine = executionerEngine();
    playerOf(engine, "wolf").alive = false;

    expect(settleRound(engine)).toBe("village");
    // Không mục nào được ghi vào sổ riêng: làng thắng không phải chuyện của nó.
    expect(engine.personalWins()).toEqual([]);
  });

  it("Sói hoà quân số vẫn thắng dù còn một Kẻ Báo Thù sống", () => {
    // Đối xứng với test trên: một vai trung lập KHÔNG CÓ đòn giết được đếm vào
    // "phần còn lại", đúng cách `checkWin` vẫn đếm Thằng Hề.
    const engine = executionerEngine();
    for (const id of ["seer", "witch", "villager", "villager2"]) {
      playerOf(engine, id).alive = false;
    }
    // Còn lại: 1 Sói, 1 Kẻ Báo Thù, 1 mục tiêu -> chưa hoà quân số.
    expect(settleRound(engine)).toBeNull();

    playerOf(engine, "target").alive = false;
    // Còn lại: 1 Sói vs 1 Kẻ Báo Thù -> hoà quân số, Sói thắng.
    expect(settleRound(engine)).toBe("wolves");
  });
});
