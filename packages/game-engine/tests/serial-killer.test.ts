import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { buildRoleDeck } from "../src/assignRoles";
import type { GameState, NightState } from "../src/types";
import {
  DEFAULT_ROOM_CONFIG,
  type GameEventView,
  type Role,
  type RoomConfig,
} from "@masoi/shared";

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 1,
  hunter: false,
  cursed: false,
  serialKiller: true,
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
    trackerTargets: {},
    trackerResults: {},
    serialKillerTarget: null,
    serialKillerSkipped: false,
  };
}

interface Seat {
  id: string;
  name: string;
  role: Role;
}

const DEFAULT_SEATS: Seat[] = [
  { id: "wolf", name: "Sói", role: "WEREWOLF" },
  { id: "killer", name: "Sát", role: "SERIAL_KILLER" },
  { id: "seer", name: "Tiên Tri", role: "SEER" },
  { id: "guard", name: "Bảo Vệ", role: "GUARD" },
  { id: "witch", name: "Phù Thuỷ", role: "WITCH" },
  { id: "villager", name: "Dân", role: "VILLAGER" },
];

/**
 * Bàn cố định có đúng một Sát Nhân.
 *
 * Vai gán TAY chứ không qua `assignRoles`, cùng lý do với bộ test của Thằng Hề:
 * mọi khẳng định ở đây nói về "chuyện gì xảy ra với Sát Nhân", nên ai cầm lá
 * nào phải là một hằng số của bài test chứ không phải kết quả của một lần xáo
 * bài.
 */
function killerState(over: Partial<GameState> = {}, seats: Seat[] = DEFAULT_SEATS): GameState {
  return {
    phase: "NIGHT",
    round: 1,
    phaseEndsAt: 30_000,
    phaseStartedAt: 0,
    voteMutations: [],
    dayVoteHistory: [],
    trial: null,
    lastTrial: null,
    players: seats.map((seat) => ({ ...seat, alive: true, isBot: false })),
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
    ...over,
  };
}

const engineWith = (over: Partial<GameState> = {}, seats?: Seat[]) =>
  new GameEngine(killerState(over, seats));

/** Chốt phiếu Sói bằng một RNG cố định để hai lần chạy không đảo kết quả. */
function lockWolves(e: GameEngine): void {
  e.lockWolves(() => 0);
}

const causeOf = (e: GameEngine, id: string) =>
  e.state.nightHistory.at(-1)?.deaths.find((d) => d.player.id === id)?.cause;

const alive = (e: GameEngine, id: string) => e.player(id)!.alive;

// ---------------------------------------------------------------------------
// 1. Hành động đêm
// ---------------------------------------------------------------------------

describe("Sát Nhân - hành động đêm", () => {
  it("giết được một người còn sống khác mình", () => {
    const e = engineWith();
    e.submitNightAction("killer", "SERIAL_KILL", "villager");
    lockWolves(e);
    e.resolveNight();

    expect(alive(e, "villager")).toBe(false);
    expect(causeOf(e, "villager")).toBe("serial_killer");
  });

  it("bỏ qua được, và đêm đó không ai chết vì dao", () => {
    const e = engineWith();
    e.submitNightAction("killer", "SKIP", null);
    lockWolves(e);
    const deaths = e.resolveNight();

    expect(deaths.some((d) => d.cause === "serial_killer")).toBe(false);
    expect(e.state.night.serialKillerSkipped).toBe(true);
  });

  it("đổi được mục tiêu tới khi đêm khép lại", () => {
    const e = engineWith();
    e.submitNightAction("killer", "SERIAL_KILL", "villager");
    e.submitNightAction("killer", "SERIAL_KILL", "seer");
    lockWolves(e);
    e.resolveNight();

    // Chỉ nạn nhân CUỐI CÙNG chết: một ô mục tiêu, không phải một danh sách.
    expect(alive(e, "villager")).toBe(true);
    expect(alive(e, "seer")).toBe(false);
  });

  it("bỏ qua là quyết định CUỐI: không rút lại được trong đêm đó", () => {
    const e = engineWith();
    e.submitNightAction("killer", "SKIP", null);
    expect(() => e.submitNightAction("killer", "SERIAL_KILL", "villager")).toThrow(
      /đã bỏ qua/,
    );
    expect(() => e.submitNightAction("killer", "SKIP", null)).toThrow(/đã bỏ qua/);
  });

  it("không tự giết mình", () => {
    const e = engineWith();
    expect(() => e.submitNightAction("killer", "SERIAL_KILL", "killer")).toThrow(
      /không thể tự giết mình/,
    );
  });

  it("không nhắm người đã chết", () => {
    const e = engineWith();
    e.player("villager")!.alive = false;
    expect(() => e.submitNightAction("killer", "SERIAL_KILL", "villager")).toThrow(
      /Mục tiêu đã chết/,
    );
  });

  it("không ai ngoài Sát Nhân dùng được hành động này", () => {
    const e = engineWith();
    for (const id of ["wolf", "seer", "guard", "villager"]) {
      expect(() => e.submitNightAction(id, "SERIAL_KILL", "villager"), id).toThrow(
        /Chỉ Sát Nhân/,
      );
    }
    /*
     * Phù Thuỷ bị chặn bởi một hàng rào ĐỨNG TRƯỚC ("chưa tới lượt", vì bầy Sói
     * chưa khoá phiếu), nên thông điệp khác - nhưng nước đi vẫn bị từ chối, và
     * đó mới là điều cần khoá lại. Khoá theo đúng chuỗi chữ ở đây sẽ biến bài
     * test thành một bản sao thứ hai của thứ tự các hàng rào trong engine.
     */
    expect(() => e.submitNightAction("witch", "SERIAL_KILL", "villager")).toThrow();
    lockWolves(e);
    expect(() => e.submitNightAction("witch", "SERIAL_KILL", "villager")).toThrow(
      /Chỉ Sát Nhân/,
    );
  });

  it("nhắm được cả Ma Sói: nó không có đồng bọn nào để tha", () => {
    const e = engineWith();
    e.submitNightAction("killer", "SERIAL_KILL", "wolf");
    lockWolves(e);
    e.resolveNight();
    expect(alive(e, "wolf")).toBe(false);
  });

  it("người chết không ra tay được nữa", () => {
    const e = engineWith();
    e.player("killer")!.alive = false;
    expect(() => e.submitNightAction("killer", "SERIAL_KILL", "villager")).toThrow(
      /Người chết/,
    );
  });

  it("bộ bài chỉ chia đúng MỘT lá Sát Nhân", () => {
    const deck = buildRoleDeck({ ...CONFIG, werewolves: 2 }, 9, () => 0.5);
    expect(deck.filter((role) => role === "SERIAL_KILLER")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Tương tác với các vai khác
// ---------------------------------------------------------------------------

describe("Sát Nhân - tương tác", () => {
  it("Bảo Vệ chặn được nhát dao", () => {
    const e = engineWith();
    e.submitNightAction("guard", "GUARD", "villager");
    e.submitNightAction("killer", "SERIAL_KILL", "villager");
    lockWolves(e);
    e.resolveNight();
    expect(alive(e, "villager")).toBe(true);
  });

  it("Thiên Thần Hộ Mệnh cũng chặn được", () => {
    const seats: Seat[] = [
      { id: "wolf", name: "Sói", role: "WEREWOLF" },
      { id: "killer", name: "Sát", role: "SERIAL_KILLER" },
      { id: "angel", name: "Thiên Thần", role: "GUARDIAN_ANGEL" },
      { id: "seer", name: "Tiên Tri", role: "SEER" },
      { id: "villager", name: "Dân", role: "VILLAGER" },
      { id: "villager2", name: "Dân 2", role: "VILLAGER" },
    ];
    const e = engineWith({ guardianAngelCharges: { angel: 2 } }, seats);
    e.submitNightAction("angel", "GUARDIAN_PROTECT", "villager");
    e.submitNightAction("killer", "SERIAL_KILL", "villager");
    lockWolves(e);
    e.resolveNight();
    expect(alive(e, "villager")).toBe(true);
    // Lượt khiên vẫn bị tiêu: nó đã đỡ một đòn thật.
    expect(e.state.guardianAngelCharges.angel).toBe(1);
  });

  it("bình cứu chặn CẢ đòn Sói lẫn nhát dao khi cùng nhắm một người", () => {
    const e = engineWith();
    e.submitNightAction("wolf", "KILL", "villager");
    e.submitNightAction("killer", "SERIAL_KILL", "villager");
    lockWolves(e);
    e.submitNightAction("witch", "HEAL", null);
    e.resolveNight();

    expect(alive(e, "villager")).toBe(true);
    expect(e.state.healUsed).toBe(true);
  });

  it("bình cứu KHÔNG che được người khác với nạn nhân của Sói", () => {
    const e = engineWith();
    e.submitNightAction("wolf", "KILL", "villager");
    e.submitNightAction("killer", "SERIAL_KILL", "seer");
    lockWolves(e);
    e.submitNightAction("witch", "HEAL", null);
    e.resolveNight();

    expect(alive(e, "villager")).toBe(true);
    expect(alive(e, "seer")).toBe(false);
    expect(causeOf(e, "seer")).toBe("serial_killer");
  });

  it("Đêm Bình Yên: bình cứu đỡ nhát dao thì bình VẪN mất, và recap ghi đúng người", () => {
    /*
     * Đêm Bình Yên tước lượt cắn CHÍNH của bầy Sói, nhưng `killTarget` vẫn được
     * chốt - nên Phù Thuỷ vẫn rót được bình cứu vào đúng người đó, và người đó
     * vẫn nằm trong tầm dao của Sát Nhân. Đó là đêm duy nhất trong ván mà bình
     * cứu chặn một đòn mà KHÔNG có cú cắn nào đi kèm, tức đêm duy nhất mà vòng
     * cắn - chỗ vẫn ghi sổ hộ - không hề chạy.
     */
    const peaceful: GameEventView = {
      id: "PEACEFUL_NIGHT",
      name: "Đêm Bình Yên",
      description: "Phe Sói bị tước lượt cắn chính trong đêm đó.",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "village",
      power: 4,
    };
    const e = engineWith({ activeEvent: peaceful });
    e.submitNightAction("wolf", "KILL", "villager");
    e.submitNightAction("killer", "SERIAL_KILL", "villager");
    lockWolves(e);
    e.submitNightAction("witch", "HEAL", null);
    e.resolveNight();

    expect(alive(e, "villager")).toBe(true);
    // Cái giá của mạng vừa cứu. Thiếu dòng này, Phù Thuỷ giữ nguyên bình sau
    // khi đã dùng nó - một lượt cứu MIỄN PHÍ mà không luật nào cấp cho vai đó.
    expect(e.state.healUsed).toBe(true);

    const recap = e.state.nightHistory.at(-1)!;
    expect(recap.witch.usedHeal).toBe(true);
    expect(recap.witch.healedTarget?.id).toBe("villager");
    expect(recap.deaths).toHaveLength(0);

    // Và bình mất THẬT, không chỉ mất trên recap: đêm sau không rót lại được.
    e.startNight(30_000, 0, () => 0, null);
    e.submitNightAction("wolf", "KILL", "seer");
    lockWolves(e);
    expect(() => e.submitNightAction("witch", "HEAL", null)).toThrow(
      /Bình cứu đã được sử dụng/,
    );
  });

  it("Đêm Bình Yên KHÔNG có Sát Nhân: bình cứu không mất, không có đòn nào để đỡ", () => {
    /*
     * Vế đối chứng của bài ngay trên, và là ranh giới của bản sửa: bình chỉ mất
     * khi nó thật sự chặn được một đòn. Một Đêm Bình Yên không có nhát dao nào
     * thì lượt cắn đã bị tước, chẳng có gì đổ vào - và Phù Thuỷ giữ nguyên bình.
     */
    const peaceful: GameEventView = {
      id: "PEACEFUL_NIGHT",
      name: "Đêm Bình Yên",
      description: "Phe Sói bị tước lượt cắn chính trong đêm đó.",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "village",
      power: 4,
    };
    const e = engineWith({ activeEvent: peaceful });
    e.submitNightAction("wolf", "KILL", "villager");
    e.submitNightAction("killer", "SKIP", null);
    lockWolves(e);
    e.submitNightAction("witch", "HEAL", null);
    e.resolveNight();

    expect(alive(e, "villager")).toBe(true);
    expect(e.state.healUsed).toBe(false);
    expect(e.state.nightHistory.at(-1)!.witch.usedHeal).toBe(false);
  });

  it("Đêm Bình Yên: bình cứu KHÔNG che được người khác với mục tiêu của Sói", () => {
    // Luật cũ giữ nguyên: bình cứu chỉ cứu `killTarget`. Đêm Bình Yên không
    // nới nó ra thành một lượt cứu người bất kỳ.
    const peaceful: GameEventView = {
      id: "PEACEFUL_NIGHT",
      name: "Đêm Bình Yên",
      description: "Phe Sói bị tước lượt cắn chính trong đêm đó.",
      targetPhase: "NIGHT",
      round: 1,
      beneficiary: "village",
      power: 4,
    };
    const e = engineWith({ activeEvent: peaceful });
    e.submitNightAction("wolf", "KILL", "villager");
    e.submitNightAction("killer", "SERIAL_KILL", "seer");
    lockWolves(e);
    e.submitNightAction("witch", "HEAL", null);
    e.resolveNight();

    expect(alive(e, "seer")).toBe(false);
    expect(causeOf(e, "seer")).toBe("serial_killer");
    expect(e.state.healUsed).toBe(false);
  });

  it("bình độc KHÔNG bị khiên chặn, và Sát Nhân cũng chết vì nó như mọi người", () => {
    const e = engineWith();
    e.submitNightAction("guard", "GUARD", "killer");
    lockWolves(e);
    e.submitNightAction("witch", "POISON", "killer");
    e.resolveNight();

    expect(alive(e, "killer")).toBe(false);
    expect(causeOf(e, "killer")).toBe("poison");
  });

  it("Sát Nhân giết Kẻ Nguyền Rủa: chết thật, KHÔNG hoá Sói", () => {
    const seats: Seat[] = [
      { id: "wolf", name: "Sói", role: "WEREWOLF" },
      { id: "killer", name: "Sát", role: "SERIAL_KILLER" },
      { id: "cursed", name: "Nguyền", role: "CURSED" },
      { id: "seer", name: "Tiên Tri", role: "SEER" },
      { id: "villager", name: "Dân", role: "VILLAGER" },
      { id: "villager2", name: "Dân 2", role: "VILLAGER" },
    ];
    const e = engineWith({ config: { ...CONFIG, cursed: true } }, seats);
    e.submitNightAction("killer", "SERIAL_KILL", "cursed");
    lockWolves(e);
    e.resolveNight();

    expect(alive(e, "cursed")).toBe(false);
    expect(e.player("cursed")!.role).toBe("CURSED");
    expect(e.player("cursed")!.cursedTurned).toBe(false);
    expect(e.state.nightHistory.at(-1)!.cursedTurned).toBeNull();
  });

  it("Sói cắn Kẻ Nguyền Rủa CÙNG đêm Sát Nhân đâm nó: chết, không đổi phe", () => {
    const seats: Seat[] = [
      { id: "wolf", name: "Sói", role: "WEREWOLF" },
      { id: "killer", name: "Sát", role: "SERIAL_KILLER" },
      { id: "cursed", name: "Nguyền", role: "CURSED" },
      { id: "seer", name: "Tiên Tri", role: "SEER" },
      { id: "villager", name: "Dân", role: "VILLAGER" },
      { id: "villager2", name: "Dân 2", role: "VILLAGER" },
    ];
    const e = engineWith({ config: { ...CONFIG, cursed: true } }, seats);
    e.submitNightAction("wolf", "KILL", "cursed");
    e.submitNightAction("killer", "SERIAL_KILL", "cursed");
    lockWolves(e);
    e.resolveNight();

    /*
     * Nhát cắn một mình sẽ biến nó thành Sói. Nhát dao đi cùng đêm thì không -
     * cơ chế hoá Sói chỉ chạy khi người đó CÒN SỐNG sau khi mọi cái chết đã áp,
     * và một xác không đổi phe được.
     */
    expect(alive(e, "cursed")).toBe(false);
    expect(e.player("cursed")!.role).toBe("CURSED");
  });

  it("Sát Nhân giết Thằng Hề: Hề KHÔNG thắng cá nhân", () => {
    const seats: Seat[] = [
      { id: "wolf", name: "Sói", role: "WEREWOLF" },
      { id: "killer", name: "Sát", role: "SERIAL_KILLER" },
      { id: "jester", name: "Hề", role: "JESTER" },
      { id: "seer", name: "Tiên Tri", role: "SEER" },
      { id: "villager", name: "Dân", role: "VILLAGER" },
      { id: "villager2", name: "Dân 2", role: "VILLAGER" },
    ];
    const e = engineWith({ config: { ...CONFIG, jester: true } }, seats);
    e.submitNightAction("killer", "SERIAL_KILL", "jester");
    lockWolves(e);
    e.resolveNight();

    expect(alive(e, "jester")).toBe(false);
    // Thằng Hề CHỈ thắng khi chết vì phán quyết treo cổ.
    expect(e.personalWins()).toEqual([]);
  });

  it("Thám Tử soi Sát Nhân với Thằng Hề: KHÁC phe", () => {
    const seats: Seat[] = [
      { id: "wolf", name: "Sói", role: "WEREWOLF" },
      { id: "killer", name: "Sát", role: "SERIAL_KILLER" },
      { id: "jester", name: "Hề", role: "JESTER" },
      { id: "detective", name: "Thám Tử", role: "DETECTIVE" },
      { id: "villager", name: "Dân", role: "VILLAGER" },
      { id: "villager2", name: "Dân 2", role: "VILLAGER" },
    ];
    /*
     * Hai lượt soi, hai ĐÊM - không phải hai lời gọi trong cùng một đêm: Thám
     * Tử chỉ được điều tra một lần mỗi đêm, vì kết quả về ngay lúc nộp.
     */
    const config = { ...CONFIG, jester: true, detective: true };
    const different = engineWith({ config }, seats);
    different.submitNightAction("detective", "DETECTIVE_CHECK", "killer", "jester");
    // `neutral` là một NHÃN, không phải một phe: hai vai trung lập không đứng
    // cùng nhau, và Thám Tử phải đọc ra đúng điều đó.
    expect(different.state.night.detectiveResults.detective.sameTeam).toBe(false);

    // Và hai người CÙNG phe thật vẫn báo đúng.
    const same = engineWith({ config }, seats);
    same.submitNightAction("detective", "DETECTIVE_CHECK", "villager", "villager2");
    expect(same.state.night.detectiveResults.detective.sameTeam).toBe(true);
  });

  it("Tiên Tri soi Sát Nhân nhận PHE TRUNG LẬP, không nhận tên vai", () => {
    const e = engineWith();
    e.submitNightAction("seer", "SEE", "killer");
    const result = e.state.night.seerResults.seer;
    expect(result.team).toBe("neutral");
    expect(result.isWolf).toBe(false);

    const view = e.snapshotFor("seer");
    expect(view.nightInfo?.seerResult?.team).toBe("neutral");
    // Không có trường nào mang mã vai thật.
    expect(JSON.stringify(view.nightInfo?.seerResult)).not.toContain("SERIAL_KILLER");
  });
});

// ---------------------------------------------------------------------------
// 3. Hai nguồn giết người trong cùng một đêm
// ---------------------------------------------------------------------------

describe("Sói và Sát Nhân cùng ra tay", () => {
  it("cùng nhắm một nạn nhân: chết MỘT lần, một mục trong bản ghi đêm", () => {
    const e = engineWith();
    e.submitNightAction("wolf", "KILL", "villager");
    e.submitNightAction("killer", "SERIAL_KILL", "villager");
    lockWolves(e);
    const deaths = e.resolveNight();

    expect(deaths.filter((d) => d.playerId === "villager")).toHaveLength(1);
    expect(e.state.lastNightDeaths).toHaveLength(1);
  });

  it("cùng nhắm một Thợ Săn: phản ứng chết chỉ kích hoạt MỘT lần", () => {
    const seats: Seat[] = [
      { id: "wolf", name: "Sói", role: "WEREWOLF" },
      { id: "killer", name: "Sát", role: "SERIAL_KILLER" },
      { id: "hunter", name: "Thợ Săn", role: "HUNTER" },
      { id: "seer", name: "Tiên Tri", role: "SEER" },
      { id: "villager", name: "Dân", role: "VILLAGER" },
      { id: "villager2", name: "Dân 2", role: "VILLAGER" },
    ];
    const e = engineWith({ config: { ...CONFIG, hunter: true } }, seats);
    e.submitNightAction("wolf", "KILL", "hunter");
    e.submitNightAction("killer", "SERIAL_KILL", "hunter");
    lockWolves(e);
    e.resolveNight();

    expect(e.hasPendingHunterShot()).toBe(true);
    expect(e.state.hunterReaction!.hunterId).toBe("hunter");
    e.beginHunterShot(1_000);
    e.submitHunterShot("hunter", null);
    e.completeHunterReaction();
    expect(e.hasPendingHunterShot()).toBe(false);
  });

  it("bản ghi đêm giữ ĐỦ hai đòn, không đòn nào ghi đè đòn nào", () => {
    const e = engineWith();
    e.submitNightAction("wolf", "KILL", "villager");
    e.submitNightAction("killer", "SERIAL_KILL", "seer");
    lockWolves(e);
    e.resolveNight();

    const recap = e.state.nightHistory.at(-1)!;
    expect(recap.wolfTarget).toEqual({ id: "villager", name: "Dân" });
    expect(recap.serialKillerTarget).toEqual({ id: "seer", name: "Tiên Tri" });
    expect(recap.deaths.map((d) => d.cause).sort()).toEqual(["serial_killer", "wolf"]);
  });

  it("giết nhau trong cùng một đêm: CẢ HAI đều ngã xuống", () => {
    const e = engineWith();
    e.submitNightAction("wolf", "KILL", "killer");
    e.submitNightAction("killer", "SERIAL_KILL", "wolf");
    lockWolves(e);
    e.resolveNight();

    /*
     * Đòn của người chết trong CÙNG đêm vẫn có hiệu lực.
     *
     * Đây là bất biến trung tâm của mục "giải quyết hành động đêm": nếu thứ tự
     * xử lý áp cái chết của Sát Nhân trước khi tính nhát dao của nó, con Sói sẽ
     * sống - và ai chết trước sẽ phụ thuộc vào thứ tự dòng code chứ không phải
     * vào luật.
     */
    expect(alive(e, "wolf")).toBe(false);
    expect(alive(e, "killer")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Điều kiện kết thúc ván
// ---------------------------------------------------------------------------

describe("checkWin với Sát Nhân trên bàn", () => {
  const only = (...ids: string[]) => {
    const e = engineWith();
    for (const player of e.state.players) player.alive = ids.includes(player.id);
    return e;
  };

  it("a. không còn ai sống: HOÀ", () => {
    expect(only().checkWin()).toBe("draw");
  });

  it("b. chỉ còn Sát Nhân: Sát Nhân thắng", () => {
    expect(only("killer").checkWin()).toBe("serial_killer");
  });

  it("c. hết Sói và hết Sát Nhân: Dân thắng theo luật cũ", () => {
    expect(only("seer", "villager").checkWin()).toBe("village");
  });

  it("d. hết Sát Nhân, Sói đủ quân số: Sói thắng theo luật cũ", () => {
    expect(only("wolf", "villager").checkWin()).toBe("wolves");
  });

  it("e. Sát Nhân còn sống thì ván CHẠY TIẾP - hết Sói cũng chưa đủ cho làng", () => {
    expect(only("killer", "villager", "seer").checkWin()).toBeNull();
    // Không còn con Sói nào, mà làng vẫn chưa thắng: vẫn còn một kẻ giết người
    // đi lại trong làng.
    expect(only("killer", "villager").checkWin()).toBeNull();
  });

  it("Sói KHÔNG tự thắng nhờ ngang số khi Sát Nhân còn sống", () => {
    // 1 Sói / 1 Sát Nhân: ngang số theo luật cũ, nhưng ván chưa xong.
    expect(only("wolf", "killer").checkWin()).toBeNull();
    // Thêm một người làng nữa cũng vậy.
    expect(only("wolf", "killer", "villager").checkWin()).toBeNull();
  });

  it("một Sói và một Sát Nhân giết nhau, không còn ai khác: HOÀ", () => {
    const e = engineWith();
    for (const player of e.state.players) {
      player.alive = player.id === "wolf" || player.id === "killer";
    }
    e.submitNightAction("wolf", "KILL", "killer");
    e.submitNightAction("killer", "SERIAL_KILL", "wolf");
    lockWolves(e);
    e.resolveNight();

    expect(e.checkWin()).toBe("draw");
  });

  it("phản ứng Thợ Săn chưa xử xong thì CHƯA chốt được thắng hay hoà", () => {
    const seats: Seat[] = [
      { id: "wolf", name: "Sói", role: "WEREWOLF" },
      { id: "killer", name: "Sát", role: "SERIAL_KILLER" },
      { id: "hunter", name: "Thợ Săn", role: "HUNTER" },
    ];
    const e = engineWith({ config: { ...CONFIG, hunter: true } }, seats);
    e.submitNightAction("killer", "SERIAL_KILL", "hunter");
    e.submitNightAction("wolf", "SKIP", null);
    lockWolves(e);
    e.resolveNight();

    // Thợ Săn đã chết nhưng còn một viên đạn: nó có thể hạ nốt con Sói cuối
    // hoặc hạ chính Sát Nhân, và cả hai đổi hẳn kết cục.
    expect(e.hasPendingHunterShot()).toBe(true);
    expect(e.checkWin()).toBeNull();

    e.beginHunterShot(1_000);
    e.submitHunterShot("hunter", "wolf");
    e.completeHunterReaction();

    expect(e.checkWin()).toBe("serial_killer");
  });

  it("phát bắn của Thợ Săn hạ Sát Nhân thì làng thắng, không phải hoà", () => {
    const seats: Seat[] = [
      { id: "killer", name: "Sát", role: "SERIAL_KILLER" },
      { id: "hunter", name: "Thợ Săn", role: "HUNTER" },
      { id: "villager", name: "Dân", role: "VILLAGER" },
    ];
    const e = engineWith({ config: { ...CONFIG, werewolves: 0, hunter: true } }, seats);
    e.submitNightAction("killer", "SERIAL_KILL", "hunter");
    lockWolves(e);
    e.resolveNight();

    e.beginHunterShot(1_000);
    e.submitHunterShot("hunter", "killer");
    e.completeHunterReaction();

    expect(e.checkWin()).toBe("village");
  });
});

describe("finishGame với kết cục mới", () => {
  it("ghi đúng câu cho từng kết cục, không gán nhầm cho phe nào", () => {
    for (const [winner, expected] of [
      ["serial_killer", "Sát Nhân chiến thắng!"],
      ["draw", "Không ai còn sống, ván đấu hoà!"],
      ["village", "Phe Dân Làng chiến thắng!"],
      ["wolves", "Phe Ma Sói chiến thắng!"],
    ] as const) {
      const e = engineWith();
      e.finishGame(winner);
      expect(e.state.winner, winner).toBe(winner);
      expect(e.state.log.at(-1), winner).toBe(expected);
      expect(e.state.phase).toBe("GAME_OVER");
    }
  });

  it("thành tích của Thằng Hề vẫn được giữ trong một ván HOÀ", () => {
    const seats: Seat[] = [
      { id: "wolf", name: "Sói", role: "WEREWOLF" },
      { id: "killer", name: "Sát", role: "SERIAL_KILLER" },
      { id: "jester", name: "Hề", role: "JESTER" },
    ];
    const e = engineWith(
      {
        config: { ...CONFIG, jester: true },
        personalWins: [
          { playerId: "jester", name: "Hề", role: "JESTER", condition: "JESTER_LYNCHED", round: 1 },
        ],
      },
      seats,
    );
    e.player("jester")!.alive = false;
    e.finishGame("draw");

    // Hoà KHÔNG xoá sổ thành tích: hai đại lượng khác nhau ở hai trường khác nhau.
    expect(e.personalWins()).toHaveLength(1);
    expect(e.state.log.join("\n")).toContain("thắng cá nhân");
  });
});

// ---------------------------------------------------------------------------
// 5. Ranh giới thông tin
// ---------------------------------------------------------------------------

describe("snapshot không rò vai hay mục tiêu riêng của Sát Nhân", () => {
  it("người khác không thấy vai, không thấy mục tiêu", () => {
    const e = engineWith();
    e.submitNightAction("killer", "SERIAL_KILL", "villager");

    for (const viewer of ["wolf", "seer", "guard", "witch", "villager"]) {
      const view = e.snapshotFor(viewer);
      expect(view.players.find((p) => p.id === "killer")?.role, viewer).toBeUndefined();
      expect(view.nightInfo?.serialKillerTarget, viewer).toBeUndefined();
      expect(JSON.stringify(view), viewer).not.toContain("SERIAL_KILLER");
    }
  });

  it("chính Sát Nhân thấy mục tiêu mình đã chốt", () => {
    const e = engineWith();
    e.submitNightAction("killer", "SERIAL_KILL", "villager");
    const view = e.snapshotFor("killer");

    expect(view.you?.role).toBe("SERIAL_KILLER");
    expect(view.nightInfo?.serialKillerTarget).toBe("villager");
    expect(view.nightInfo?.acted).toBe(true);
    expect(view.nightInfo?.canAct).toBe(true);
  });

  it("Sát Nhân KHÔNG thấy nạn nhân của bầy Sói", () => {
    const e = engineWith();
    e.submitNightAction("wolf", "KILL", "villager");
    lockWolves(e);

    const view = e.snapshotFor("killer");
    // Chỉ Sói và Phù Thuỷ được biết; một kẻ giết người khác không phải đồng bọn.
    expect(view.nightInfo?.wolfTarget).toBeNull();
  });

  it("lõi BOT của Sát Nhân chỉ biết vai của chính nó", () => {
    const e = engineWith();
    const knowledge = e.botKnowledgeFor("killer");

    expect(knowledge.knownRoles).toEqual({ killer: "SERIAL_KILLER" });
    expect(knowledge.night?.legalActions).toContain("SERIAL_KILL");
    expect(knowledge.night?.legalActions).toContain("SKIP");
    // Mọi người còn sống trừ chính mình - kể cả Sói.
    expect(new Set(knowledge.night?.legalTargets.SERIAL_KILL)).toEqual(
      new Set(["wolf", "seer", "guard", "witch", "villager"]),
    );
    expect(knowledge.night?.wolfTarget).toBeNull();
  });

  it("bộ bài trung lập là thông tin CÔNG KHAI và đi tới mọi BOT", () => {
    const e = engineWith({ config: { ...CONFIG, jester: true } });
    for (const viewer of ["wolf", "seer", "villager", "killer"]) {
      expect(e.botKnowledgeFor(viewer).neutralRolesInPlay.sort(), viewer).toEqual([
        "JESTER",
        "SERIAL_KILLER",
      ]);
    }
    // Ván tắt hai lá đó thì danh sách rỗng, không phải "không rõ".
    const off = engineWith({ config: { ...CONFIG, serialKiller: false } });
    expect(off.botKnowledgeFor("seer").neutralRolesInPlay).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Tương thích với state cũ
// ---------------------------------------------------------------------------

describe("state ghi trước khi có Sát Nhân", () => {
  it("nạp lại được, và chuẩn hoá về đúng trạng thái 'chưa có gì'", () => {
    const legacy = killerState();
    // Đúng hình dạng của một snapshot ghi bởi bản build trước.
    delete (legacy.night as Partial<NightState>).serialKillerTarget;
    delete (legacy.night as Partial<NightState>).serialKillerSkipped;
    delete (legacy.config as Partial<RoomConfig>).serialKiller;

    const e = new GameEngine(legacy);
    expect(e.state.night.serialKillerTarget).toBeNull();
    expect(e.state.night.serialKillerSkipped).toBe(false);
    expect(e.state.config.serialKiller).toBe(false);
    // Và ván đó chạy tiếp bình thường: không ai mọc thêm một nhát dao.
    lockWolves(e);
    expect(e.resolveNight().some((d) => d.cause === "serial_killer")).toBe(false);
  });

  it("ván MỚI bắt đầu với sổ Sát Nhân trắng", () => {
    const players = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`,
      name: `Người ${i}`,
      isBot: false,
    }));
    const e = GameEngine.create(players, { ...CONFIG, werewolves: 2 }, 0, () => 0.5);
    expect(e.state.night.serialKillerTarget).toBeNull();
    expect(e.state.night.serialKillerSkipped).toBe(false);
    expect(e.state.winner).toBeNull();
  });

  it("sang đêm mới thì mục tiêu và cờ bỏ qua được xoá sạch", () => {
    const e = engineWith();
    e.submitNightAction("killer", "SKIP", null);
    lockWolves(e);
    e.resolveNight();

    e.startNight(30_000, 0, () => 0.99, null);
    expect(e.state.night.serialKillerTarget).toBeNull();
    expect(e.state.night.serialKillerSkipped).toBe(false);
    // Và đêm mới thì lại ra tay được.
    e.submitNightAction("killer", "SERIAL_KILL", "villager");
    expect(e.state.night.serialKillerTarget).toBe("villager");
  });
});
