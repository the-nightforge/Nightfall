import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { assignRoles, buildRoleDeck } from "../src/assignRoles";
import { GameError, type GameState } from "../src/types";
import type { RoomConfig } from "@masoi/shared";

const CONFIG: RoomConfig = {
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: false,
  nightSeconds: 30,
  discussionSeconds: 90,
  voteSeconds: 30,
};

function ids(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Người ${i + 1}`, isBot: false }));
}

function makeEngine(playerCount = 6, config = CONFIG) {
  const engine = GameEngine.create(ids(playerCount), config);
  // Chuyển sang đêm đầu tiên
  engine.setPhase("NIGHT", 30_000);
  return engine;
}

function roleOf(engine: GameEngine, playerId: string) {
  return engine.state.players.find((p) => p.id === playerId)!.role;
}

function findPlayersByRole(engine: GameEngine, role: string) {
  return engine.state.players.filter((p) => p.role === role);
}

/**
 * Chốt phiếu cắn để tới lượt Phù Thuỷ. rng cố định để mọi khẳng định về nạn
 * nhân là xác định, kể cả khi bầy Sói hoà phiếu.
 */
function lockWolves(engine: GameEngine, pick = 0) {
  return engine.lockWolves(() => pick);
}

function makeHunterEngine(phase: GameState["phase"] = "NIGHT") {
  const state: GameState = {
    phase,
    round: 1,
    phaseEndsAt: 30_000,
    players: [
      { id: "hunter", name: "Thợ Săn", role: "HUNTER", alive: true, isBot: false },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...CONFIG, werewolves: 1, hunter: true },
    winner: null,
    night: {
      wolfVotes: {},
      killTarget: null,
      wolvesLocked: false,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };
  return new GameEngine(state);
}

function prepareHunterShot(engine: GameEngine, source: "night" | "vote" = "night") {
  engine.state.players.find((player) => player.id === "hunter")!.alive = false;
  engine.state.hunterReaction = { hunterId: "hunter", source, resolved: false };
  engine.beginHunterShot(15_000, 1_000);
}

describe("Chia vai trò", () => {
  it("chia đúng số lượng vai trò theo cấu hình", () => {
    const deck = buildRoleDeck(CONFIG, 8);
    expect(deck.filter((r) => r === "WEREWOLF")).toHaveLength(2);
    expect(deck.filter((r) => r === "SEER")).toHaveLength(1);
    expect(deck.filter((r) => r === "GUARD")).toHaveLength(1);
    expect(deck.filter((r) => r === "WITCH")).toHaveLength(1);
    expect(deck.filter((r) => r === "VILLAGER")).toHaveLength(3);
    expect(deck).toHaveLength(8);
  });

  it("thêm đúng một Thợ Săn khi cấu hình bật", () => {
    const deck = buildRoleDeck({ ...CONFIG, hunter: true }, 8);
    expect(deck.filter((role) => role === "HUNTER")).toHaveLength(1);
    expect(deck.filter((role) => role === "VILLAGER").length).toBeGreaterThan(0);
  });

  it("mỗi người nhận đúng một vai trò từ bộ bài", () => {
    const result = assignRoles(ids(6), CONFIG);
    expect(Object.keys(result)).toHaveLength(6);
    for (const role of Object.values(result)) {
      expect(["WEREWOLF", "SEER", "GUARD", "WITCH", "VILLAGER"]).toContain(role);
    }
  });

  it("từ chối cấu hình không hợp lệ", () => {
    expect(() => buildRoleDeck({ ...CONFIG, werewolves: 5 }, 6)).toThrow();
    expect(() => buildRoleDeck(CONFIG, 5)).toThrow();
  });
});

describe("Thứ tự xử lý hành động ban đêm", () => {
  it("Bảo Vệ chặn cắn của Sói (bảo vệ thành công)", () => {
    const e = makeEngine(7);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    const guard = findPlayersByRole(e, "GUARD")[0];
    const victim = e.state.players.find(
      (p) => p.role === "VILLAGER" && p.id !== wolf.id && p.id !== guard.id,
    )!;

    e.submitNightAction(guard.id, "GUARD", victim.id);
    e.submitNightAction(wolf.id, "KILL", victim.id);

    const deaths = e.resolveNight();
    expect(deaths).toHaveLength(0);
    expect(victim.alive).toBe(true);
    expect(e.state.lastNightDeaths).toHaveLength(0);
  });

  it("Sói cắn người không được bảo vệ thì người đó chết", () => {
    const e = makeEngine(7);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    const guard = findPlayersByRole(e, "GUARD")[0];
    const victim = e.state.players.find((p) => p.role === "VILLAGER")!;

    e.submitNightAction(wolf.id, "KILL", victim.id);
    if (guard.id !== wolf.id) e.submitNightAction(guard.id, "GUARD", guard.id === victim.id ? wolf.id : wolf.id);

    const deaths = e.resolveNight();
    expect(deaths.map((d) => d.playerId)).toContain(victim.id);
    expect(victim.alive).toBe(false);
  });

  it("Phù Thủy cứu được nạn nhân của Sói và tiêu hao bình cứu", () => {
    const e = makeEngine(7);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    const witch = findPlayersByRole(e, "WITCH")[0];
    const victim = e.state.players.find((p) => p.role === "VILLAGER")!;

    e.submitNightAction(wolf.id, "KILL", victim.id);
    lockWolves(e);
    e.submitNightAction(witch.id, "HEAL", null);

    const deaths = e.resolveNight();
    expect(deaths).toHaveLength(0);
    expect(victim.alive).toBe(true);
    expect(e.state.healUsed).toBe(true);
    // Không cứu lần thứ hai được
    expect(() => e.submitNightAction(witch.id, "HEAL", null)).toThrow(GameError);
  });

  it("Phù Thủy dùng cả hai bình trong cùng một đêm", () => {
    const e = makeEngine(7);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    const witch = findPlayersByRole(e, "WITCH")[0];
    const villagers = findPlayersByRole(e, "VILLAGER");
    const victim = villagers[0];
    const poisoned = villagers[1];

    e.submitNightAction(wolf.id, "KILL", victim.id);
    lockWolves(e);
    e.submitNightAction(witch.id, "HEAL", null);
    e.submitNightAction(witch.id, "POISON", poisoned.id);

    const deaths = e.resolveNight();
    expect(deaths).toEqual([
      expect.objectContaining({ playerId: poisoned.id, cause: "poison" }),
    ]);
    expect(victim.alive).toBe(true);
    expect(e.state.healUsed).toBe(true);
    expect(e.state.poisonUsed).toBe(true);
  });

  it("Phù Thủy đầu độc một người, bình độc tiêu hao", () => {
    const e = makeEngine(7);
    const witch = findPlayersByRole(e, "WITCH")[0];
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    const target = e.state.players.find((p) => p.role === "VILLAGER")!;

    e.submitNightAction(wolf.id, "KILL", witch.id);
    lockWolves(e);
    e.submitNightAction(witch.id, "POISON", target.id);

    const deaths = e.resolveNight();
    const deadIds = deaths.map((d) => d.playerId);
    expect(deadIds).toContain(witch.id);
    expect(deadIds).toContain(target.id);
    expect(e.state.poisonUsed).toBe(true);
  });

  it("không tính một người chết hai lần khi vừa bị Sói cắn vừa trúng độc", () => {
    const e = makeEngine(7);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    const witch = findPlayersByRole(e, "WITCH")[0];
    const target = e.state.players.find(
      (p) => p.alive && p.id !== wolf.id && p.id !== witch.id && p.role !== "WEREWOLF",
    )!;

    e.submitNightAction(wolf.id, "KILL", target.id);
    lockWolves(e);
    e.submitNightAction(witch.id, "POISON", target.id);
    const deaths = e.resolveNight();

    expect(deaths.filter((d) => d.playerId === target.id)).toHaveLength(1);
    expect(e.state.lastNightDeaths.filter((d) => d.playerId === target.id)).toHaveLength(1);
    expect(e.state.nightHistory[0].deaths).toEqual([
      {
        player: { id: target.id, name: target.name },
        cause: "wolf",
      },
    ]);
  });

  it("Bảo Vệ không thể bảo vệ cùng một người hai đêm liên tiếp", () => {
    const e = makeEngine(7);
    const guard = findPlayersByRole(e, "GUARD")[0];
    const target = e.state.players.find((p) => p.id !== guard.id)!;

    e.submitNightAction(guard.id, "GUARD", target.id);
    e.resolveNight();

    // Đêm 2
    e.setPhase("NIGHT", 30_000);
    expect(() => e.submitNightAction(guard.id, "GUARD", target.id)).toThrow(GameError);
  });
});

describe("Tiên Tri", () => {
  it("chỉ Tiên Tri nhận kết quả soi trong snapshot của mình", () => {
    const e = makeEngine(7);
    const seer = findPlayersByRole(e, "SEER")[0];
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];

    e.submitNightAction(seer.id, "SEE", wolf.id);

    const seerView = e.snapshotFor(seer.id);
    expect(seerView.nightInfo?.seerResult?.isWolf).toBe(true);

    const otherView = e.snapshotFor(findPlayersByRole(e, "VILLAGER")[0].id);
    expect(otherView.nightInfo?.seerResult ?? null).toBeFalsy();
  });

  it("người khác không thể dùng hành động của Tiên Tri", () => {
    const e = makeEngine(7);
    const villager = findPlayersByRole(e, "VILLAGER")[0];
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    expect(() => e.submitNightAction(villager.id, "SEE", wolf.id)).toThrow(GameError);
  });
});

describe("Phù Thủy bỏ qua dùng thuốc", () => {
  it("đánh dấu đã hành động nhưng không tiêu hao bình", () => {
    const e = makeEngine(7);
    const witch = findPlayersByRole(e, "WITCH")[0];

    lockWolves(e);
    e.submitNightAction(witch.id, "SKIP", null);

    expect(e.state.night.witchSkipped).toBe(true);
    expect(e.state.healUsed).toBe(false);
    expect(e.state.poisonUsed).toBe(false);
    expect(e.snapshotFor(witch.id).nightInfo?.acted).toBe(true);
  });

  it("không cho dùng thuốc sau khi đã skip", () => {
    const e = makeEngine(7);
    const witch = findPlayersByRole(e, "WITCH")[0];
    const target = e.state.players.find((player) => player.id !== witch.id)!;

    lockWolves(e);
    e.submitNightAction(witch.id, "SKIP", null);

    expect(() => e.submitNightAction(witch.id, "HEAL", null)).toThrow(/đã bỏ qua/);
    expect(() => e.submitNightAction(witch.id, "POISON", target.id)).toThrow(/đã bỏ qua/);
  });

  it("không cho vai trò khác skip và reset trạng thái ở đêm mới", () => {
    const e = makeEngine(7);
    const witch = findPlayersByRole(e, "WITCH")[0];
    const villager = findPlayersByRole(e, "VILLAGER")[0];

    expect(() => e.submitNightAction(villager.id, "SKIP", null)).toThrow(/Phù Thủy/);
    lockWolves(e);
    e.submitNightAction(witch.id, "SKIP", null);
    e.setPhase("NIGHT", 30_000);

    expect(e.state.night.witchSkipped).toBe(false);
    expect(e.state.night.wolvesLocked).toBe(false);
    expect(e.snapshotFor(witch.id).nightInfo?.acted).toBe(false);
  });
});

describe("Bầy Sói bỏ phiếu cắn", () => {
  it("chỉ hoàn tất lượt Sói khi tất cả Sói còn sống đã bỏ phiếu", () => {
    const e = makeEngine(7);
    const wolves = findPlayersByRole(e, "WEREWOLF");

    e.submitNightAction(wolves[0].id, "SKIP", null);
    expect(e.allWolvesVoted()).toBe(false);
    expect(e.state.night.wolfVotes).toEqual({ [wolves[0].id]: null });

    e.submitNightAction(wolves[1].id, "SKIP", null);
    expect(e.allWolvesVoted()).toBe(true);
    expect(lockWolves(e)).toBeNull();
    expect(e.state.night.killTarget).toBeNull();
  });

  it("mục tiêu nhiều phiếu nhất bị cắn", () => {
    const e = makeEngine(9, { ...CONFIG, werewolves: 3 });
    const wolves = findPlayersByRole(e, "WEREWOLF");
    const [popular, other] = findPlayersByRole(e, "VILLAGER");

    e.submitNightAction(wolves[0].id, "KILL", popular.id);
    e.submitNightAction(wolves[1].id, "KILL", popular.id);
    e.submitNightAction(wolves[2].id, "KILL", other.id);

    // pick = 0.99 vẫn ra popular: đa số tuyệt đối thì không có gì để bốc.
    expect(lockWolves(e, 0.99)).toBe(popular.id);
    expect(e.resolveNight()).toEqual([
      expect.objectContaining({ playerId: popular.id, cause: "wolf" }),
    ]);
  });

  it("hoà phiếu thì bốc ngẫu nhiên trong nhóm dẫn đầu", () => {
    const pickFirst = makeEngine(7);
    const firstPack = findPlayersByRole(pickFirst, "WEREWOLF");
    const [a, b] = findPlayersByRole(pickFirst, "VILLAGER");
    pickFirst.submitNightAction(firstPack[0].id, "KILL", a.id);
    pickFirst.submitNightAction(firstPack[1].id, "KILL", b.id);
    expect(lockWolves(pickFirst, 0)).toBe(a.id);

    const pickLast = makeEngine(7);
    const lastPack = findPlayersByRole(pickLast, "WEREWOLF");
    const [c, d] = findPlayersByRole(pickLast, "VILLAGER");
    pickLast.submitNightAction(lastPack[0].id, "KILL", c.id);
    pickLast.submitNightAction(lastPack[1].id, "KILL", d.id);
    expect(lockWolves(pickLast, 0.99)).toBe(d.id);
  });

  it("phiếu không cắn là ứng viên ngang hàng, thắng được và hoà được", () => {
    const e = makeEngine(9, { ...CONFIG, werewolves: 3 });
    const wolves = findPlayersByRole(e, "WEREWOLF");
    const prey = findPlayersByRole(e, "VILLAGER")[0];

    e.submitNightAction(wolves[0].id, "SKIP", null);
    e.submitNightAction(wolves[1].id, "SKIP", null);
    e.submitNightAction(wolves[2].id, "KILL", prey.id);

    expect(lockWolves(e, 0.99)).toBeNull();
    expect(e.resolveNight()).toEqual([]);
  });

  it("Sói đổi được phiếu tới khi chốt, sau khi chốt thì không", () => {
    const e = makeEngine(7);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    const [first, second] = findPlayersByRole(e, "VILLAGER");

    e.submitNightAction(wolf.id, "SKIP", null);
    e.submitNightAction(wolf.id, "KILL", first.id);
    e.submitNightAction(wolf.id, "KILL", second.id);
    expect(e.state.night.wolfVotes[wolf.id]).toBe(second.id);

    lockWolves(e);
    expect(() => e.submitNightAction(wolf.id, "KILL", first.id)).toThrow(/đã chốt/);
    expect(() => e.submitNightAction(wolf.id, "SKIP", null)).toThrow(/đã chốt/);
  });

  it("reset phiếu và trạng thái chốt ở đêm mới", () => {
    const e = makeEngine(7);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];

    e.submitNightAction(wolf.id, "SKIP", null);
    lockWolves(e);

    e.setPhase("NIGHT", 30_000);
    expect(e.state.night.wolfVotes).toEqual({});
    expect(e.state.night.wolvesLocked).toBe(false);
    expect(e.snapshotFor(wolf.id).nightInfo).toMatchObject({
      acted: false,
      wolfSkipVotes: 0,
      wolfVotesRequired: 2,
    });
  });

  it("tất cả Sói bỏ qua thì không có mục tiêu và không ai chết vì Sói", () => {
    const e = makeEngine(7);
    const wolves = findPlayersByRole(e, "WEREWOLF");

    for (const wolf of wolves) e.submitNightAction(wolf.id, "SKIP", null);
    lockWolves(e);

    expect(e.state.night.killTarget).toBeNull();
    const deaths = e.resolveNight();
    expect(deaths).toHaveLength(0);
    expect(deaths.some((death) => death.cause === "wolf")).toBe(false);
    expect(e.state.nightHistory[0].wolfTarget).toBeNull();
    expect(e.state.nightHistory[0].deaths).toEqual([]);
  });

  it("SKIP của Sói không nhận mục tiêu", () => {
    const e = makeEngine(7);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    const villager = findPlayersByRole(e, "VILLAGER")[0];

    expect(() => e.submitNightAction(wolf.id, "SKIP", villager.id)).toThrow(
      /không cần mục tiêu/,
    );
    expect(e.state.night.wolfVotes).toEqual({});
  });

  it("vai ngoài Sói và Phù Thủy không được gửi SKIP", () => {
    const e = makeEngine(7);

    for (const role of ["SEER", "GUARD", "VILLAGER"]) {
      const player = findPlayersByRole(e, role)[0];
      expect(() => e.submitNightAction(player.id, "SKIP", null)).toThrow(GameError);
    }

    expect(e.state.night.wolfVotes).toEqual({});
    expect(e.state.night.witchSkipped).toBe(false);
  });

  it("các vai còn lại vẫn hành động được sau khi Sói đã chọn xong", () => {
    const e = makeEngine(7);
    const wolves = findPlayersByRole(e, "WEREWOLF");
    const seer = findPlayersByRole(e, "SEER")[0];
    const guard = findPlayersByRole(e, "GUARD")[0];
    const witch = findPlayersByRole(e, "WITCH")[0];
    const villager = findPlayersByRole(e, "VILLAGER")[0];

    for (const wolf of wolves) e.submitNightAction(wolf.id, "SKIP", null);
    expect(e.state.phase).toBe("NIGHT");
    expect(e.snapshotFor(seer.id).nightInfo?.canAct).toBe(true);

    e.submitNightAction(seer.id, "SEE", wolves[0].id);
    e.submitNightAction(guard.id, "GUARD", villager.id);
    lockWolves(e);
    e.submitNightAction(witch.id, "POISON", villager.id);

    expect(e.snapshotFor(seer.id).nightInfo?.seerResult?.isWolf).toBe(true);
    expect(e.state.night.guardTarget).toBe(villager.id);
    expect(e.resolveNight()).toEqual([
      expect.objectContaining({ playerId: villager.id, cause: "poison" }),
    ]);
  });

  it("chỉ phe Sói thấy tiến độ bỏ phiếu trong snapshot", () => {
    const e = makeEngine(7);
    const wolves = findPlayersByRole(e, "WEREWOLF");

    e.submitNightAction(wolves[0].id, "SKIP", null);

    expect(e.snapshotFor(wolves[1].id).nightInfo).toMatchObject({
      wolfSkipVotes: 1,
      wolfVotesRequired: 2,
      acted: false,
    });
    expect(e.snapshotFor(wolves[0].id).nightInfo).toMatchObject({
      acted: true,
      myWolfVote: null,
    });

    for (const role of ["SEER", "GUARD", "WITCH"]) {
      const view = e.snapshotFor(findPlayersByRole(e, role)[0].id).nightInfo;
      expect(view?.wolfSkipVotes).toBeUndefined();
      expect(view?.wolfVotesRequired).toBeUndefined();
      expect(view?.wolfVoteCounts).toBeUndefined();
      expect(view?.wolfTarget).toBeNull();
    }

    expect(e.snapshotFor(findPlayersByRole(e, "VILLAGER")[0].id).nightInfo).toBeNull();
  });
});

describe("Bỏ phiếu", () => {
  function toVoting(engine: GameEngine) {
    engine.setPhase("DAY_DISCUSSION", 60_000);
    engine.setPhase("VOTING", 30_000);
  }

  it("người có nhiều phiếu nhất bị loại", () => {
    const e = makeEngine(6);
    toVoting(e);
    const target = e.state.players[0];
    e.submitVote("p2", target.id);
    e.submitVote("p3", target.id);
    e.submitVote("p4", "p5");
    const eliminated = e.resolveVote();
    expect(eliminated?.playerId).toBe(target.id);
    expect(target.alive).toBe(false);
  });

  it("hoà phiếu thì không ai bị loại", () => {
    const e = makeEngine(6);
    toVoting(e);
    e.submitVote("p1", "p2");
    e.submitVote("p2", "p1");
    e.submitVote("p3", "p4");
    e.submitVote("p4", "p3");
    e.submitVote("p5", "p6");
    e.submitVote("p6", "p5");
    const eliminated = e.resolveVote();
    expect(eliminated).toBeNull();
    expect(e.state.players.every((p) => p.alive)).toBe(true);
  });

  it("người chết không được bỏ phiếu và không được chọn làm mục tiêu sống động", () => {
    const e = makeEngine(6);
    toVoting(e);
    e.state.players[5].alive = false;
    expect(() => e.submitVote("p6", "p1")).toThrow(/chết/);
    expect(() => e.submitVote("p1", "p6")).toThrow(/đã chết/);
  });

  it("tính phiếu không treo là một phiếu đã hoàn thành", () => {
    const e = makeEngine(6);
    toVoting(e);
    for (const player of e.state.players) e.submitVote(player.id, null);

    expect(e.allAliveVoted()).toBe(true);
    expect(e.voteTally()).toEqual({ players: {}, noElimination: 6 });
    expect(e.resolveVote()).toBeNull();
    expect(e.state.players.every((player) => player.alive)).toBe(true);
  });

  it("loại player chỉ khi player cao nhất duy nhất và hơn không treo", () => {
    const e = makeEngine(6);
    toVoting(e);
    e.submitVote("p1", "p3");
    e.submitVote("p2", "p3");
    e.submitVote("p3", "p3");
    e.submitVote("p4", null);
    e.submitVote("p5", null);
    e.submitVote("p6", "p1");

    expect(e.resolveVote()?.playerId).toBe("p3");
  });

  it("không loại ai khi không treo cao nhất hoặc hòa cao nhất", () => {
    const noEliminationWins = makeEngine(6);
    toVoting(noEliminationWins);
    noEliminationWins.submitVote("p1", null);
    noEliminationWins.submitVote("p2", null);
    noEliminationWins.submitVote("p3", null);
    noEliminationWins.submitVote("p4", "p5");
    noEliminationWins.submitVote("p5", "p5");
    noEliminationWins.submitVote("p6", "p1");
    expect(noEliminationWins.resolveVote()).toBeNull();

    const tied = makeEngine(6);
    toVoting(tied);
    tied.submitVote("p1", null);
    tied.submitVote("p2", null);
    tied.submitVote("p3", "p5");
    tied.submitVote("p4", "p5");
    tied.submitVote("p5", "p1");
    tied.submitVote("p6", "p2");
    expect(tied.resolveVote()).toBeNull();
  });

  it("không cho người chết vote không treo hoặc người sống đổi phiếu", () => {
    const e = makeEngine(6);
    toVoting(e);
    e.state.players[5].alive = false;
    expect(() => e.submitVote("p6", null)).toThrow(/chết/);

    e.submitVote("p1", null);
    expect(() => e.submitVote("p1", "p2")).toThrow(/đã bỏ phiếu/);
    e.submitVote("p2", "p3");
    expect(() => e.submitVote("p2", null)).toThrow(/đã bỏ phiếu/);
  });

  it("snapshot phân biệt chưa vote và đã chọn không treo", () => {
    const e = makeEngine(6);
    toVoting(e);
    expect(e.snapshotFor("p1")).toMatchObject({
      hasVoted: false,
      myVote: null,
      noEliminationVoteCount: 0,
    });

    e.submitVote("p1", null);
    expect(e.snapshotFor("p1")).toMatchObject({
      hasVoted: true,
      myVote: null,
      noEliminationVoteCount: 1,
    });
    expect(e.snapshotFor("p2")).toMatchObject({
      hasVoted: false,
      myVote: null,
      noEliminationVoteCount: 1,
    });
  });

  // Phiếu không treo không được cộng vào bất kỳ player nào: nếu lọt vào
  // PlayerView.voteCount thì UI sẽ hiện số phiếu ma trên đầu người chơi.
  it("phiếu không treo không làm tăng voteCount của player nào", () => {
    const e = makeEngine(6);
    toVoting(e);
    e.submitVote("p1", null);
    e.submitVote("p2", null);

    const view = e.snapshotFor("p1");
    expect(view.players.every((player) => player.voteCount === 0)).toBe(true);
    expect(view.noEliminationVoteCount).toBe(2);
  });
});

describe("Điều kiện thắng", () => {
  it("Sói thắng khi số Sói >= số người phe làng còn sống", () => {
    const e = makeEngine(6);
    // Giữ sống đúng 2 sói và 2 người phe làng
    const wolves = e.state.players.filter((p) => p.role === "WEREWOLF").slice(0, 2);
    const villages = e.state.players.filter((p) => p.role !== "WEREWOLF").slice(0, 2);
    e.state.players.forEach((p) => {
      p.alive = [...wolves, ...villages].some((w) => w.id === p.id);
    });
    expect(e.aliveWolves()).toHaveLength(2);
    expect(e.checkWin()).toBe("wolves");
  });

  it("Phe làng thắng khi toàn bộ Sói bị loại", () => {
    const e = makeEngine(6);
    e.state.players.forEach((p) => {
      if (p.role === "WEREWOLF") p.alive = false;
    });
    expect(e.checkWin()).toBe("village");
  });

  it("trận tiếp diễn khi chưa đủ điều kiện thắng", () => {
    const e = makeEngine(8);
    // 2 sói vs >= 4 dân còn sống
    expect(e.checkWin()).toBeNull();
  });
});

describe("Hành động không hợp lệ & quyền hạn", () => {
  it("không cho hành động ngoài pha NIGHT", () => {
    const e = makeEngine(6);
    e.setPhase("DAY_DISCUSSION", 60_000);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    expect(() => e.submitNightAction(wolf.id, "KILL", "p2")).toThrow(GameError);
  });

  it("người chết không thể hành động ban đêm và không bị tính vào điều kiện hoàn tất đêm", () => {
    const e = makeEngine(6);
    const wolves = findPlayersByRole(e, "WEREWOLF");
    wolves[0].alive = false;
    // Chỉ cần con sói còn lại hành động là đủ
    const aliveWolf = wolves[1] ?? wolves[0];
    if (!aliveWolf.alive) throw new Error("test setup sai");
    const target = e.state.players.find((player) => player.alive && player.role !== "WEREWOLF")!;
    e.submitNightAction(aliveWolf.id, "KILL", target.id);
    expect(e.allWolvesVoted()).toBe(true);
  });

  it("sói không thể cắn đồng bọn", () => {
    const e = makeEngine(6);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    const mate = findPlayersByRole(e, "WEREWOLF").find((w) => w.id !== wolf.id)!;
    expect(() => e.submitNightAction(wolf.id, "KILL", mate.id)).toThrow(/đồng bọn/);
  });

  it("dân thường không thể cắn/bảo vệ/độc", () => {
    const e = makeEngine(7);
    const villager = findPlayersByRole(e, "VILLAGER")[0];
    expect(() => e.submitNightAction(villager.id, "KILL", "p1")).toThrow(GameError);
    expect(() => e.submitNightAction(villager.id, "GUARD", "p1")).toThrow(GameError);
    expect(() => e.submitNightAction(villager.id, "POISON", "p1")).toThrow(GameError);
  });
});

describe("Snapshot không lộ thông tin bí mật", () => {
  it("vai trò của người khác không xuất hiện khi game chưa kết thúc và viewer còn sống", () => {
    const e = makeEngine(7);
    const villager = findPlayersByRole(e, "VILLAGER")[0];
    const view = e.snapshotFor(villager.id);
    expect(view.you!.role).toBeDefined(); // thấy vai trò của mình
    for (const p of view.players) {
      expect(p.role).toBeUndefined();
    }
  });

  it("toàn bộ vai trò chỉ lộ khi game kết thúc hoặc viewer đã chết", () => {
    const e = makeEngine(7);
    e.finishGame("village");
    const view = e.snapshotFor("p1");
    for (const p of view.players) {
      expect(p.role).toBeDefined();
    }
  });

  it("sói thấy bảng phiếu rồi thấy nạn nhân đã chốt, dân không thấy gì", () => {
    const e = makeEngine(7);
    const wolves = findPlayersByRole(e, "WEREWOLF");
    const prey = findPlayersByRole(e, "VILLAGER")[0];
    e.submitNightAction(wolves[0].id, "KILL", prey.id);

    // Trước khi chốt, đồng bọn thấy phiếu chứ chưa thấy nạn nhân cuối cùng
    const beforeLock = e.snapshotFor(wolves[1].id).nightInfo;
    expect(beforeLock?.wolfVoteCounts).toEqual({ [prey.id]: 1 });
    expect(beforeLock?.wolfTarget).toBeNull();

    lockWolves(e);
    expect(e.snapshotFor(wolves[1].id).nightInfo?.wolfTarget).toBe(prey.id);

    const villager = e.state.players.find(
      (p) => p.role === "VILLAGER" && p.id !== prey.id,
    )!;
    const seer = findPlayersByRole(e, "SEER")[0];
    expect(JSON.stringify(e.snapshotFor(villager.id))).not.toContain("wolfTarget");
    expect(e.snapshotFor(seer.id).nightInfo).toMatchObject({
      wolfTarget: null,
      wolfVoteCounts: undefined,
    });
  });

  it("phiếu chi tiết không lộ trước khi hết bỏ phiếu, chỉ lộ số phiếu", () => {
    const e = makeEngine(6);
    e.setPhase("DAY_DISCUSSION", 1000);
    e.setPhase("VOTING", 30000);
    e.submitVote("p1", "p2");
    const v1 = e.snapshotFor("p1");
    expect(v1.myVote).toBe("p2");
    const json = JSON.stringify(e.snapshotFor("p3"));
    expect(json).not.toMatch(/"votes"/);
    expect(json).not.toContain('"myVote":"p2"');
  });
});

describe("Lịch sử diễn biến ban đêm", () => {
  it("ghi đầy đủ hành động và kết quả của một đêm", () => {
    const e = makeEngine(7);
    const wolf = findPlayersByRole(e, "WEREWOLF")[0];
    const guard = findPlayersByRole(e, "GUARD")[0];
    const seer = findPlayersByRole(e, "SEER")[0];
    const witch = findPlayersByRole(e, "WITCH")[0];
    const wolfTarget = e.state.players.find((p) => p.role === "VILLAGER")!;
    const poisonTarget = e.state.players.find(
      (p) => p.alive && p.id !== wolfTarget.id && p.id !== witch.id && p.role !== "WEREWOLF",
    )!;

    e.submitNightAction(wolf.id, "KILL", wolfTarget.id);
    e.submitNightAction(guard.id, "GUARD", wolfTarget.id);
    e.submitNightAction(seer.id, "SEE", wolf.id);
    lockWolves(e);
    e.submitNightAction(witch.id, "HEAL", null);
    e.submitNightAction(witch.id, "POISON", poisonTarget.id);
    e.resolveNight();

    expect(e.state.nightHistory).toEqual([
      {
        round: 1,
        wolfTarget: { id: wolfTarget.id, name: wolfTarget.name },
        guardTarget: { id: wolfTarget.id, name: wolfTarget.name },
        seerChecks: [{
          seer: { id: seer.id, name: seer.name },
          target: { id: wolf.id, name: wolf.name },
          isWolf: true,
        }],
        witch: {
          usedHeal: true,
          healedTarget: { id: wolfTarget.id, name: wolfTarget.name },
          poisonTarget: { id: poisonTarget.id, name: poisonTarget.name },
        },
        deaths: [{
          player: { id: poisonTarget.id, name: poisonTarget.name },
          cause: "poison",
        }],
      },
    ]);
  });

  it("giữ các đêm theo thứ tự và ghi cả đêm không có người chết", () => {
    const e = makeEngine(7);
    e.resolveNight();
    e.setPhase("NIGHT", 30_000);
    e.resolveNight();

    expect(e.state.nightHistory.map((night) => night.round)).toEqual([1, 2]);
    expect(e.state.nightHistory[0].deaths).toEqual([]);
    expect(e.state.nightHistory[1].deaths).toEqual([]);
  });

  it("engine của ván mới không mang lịch sử ván trước", () => {
    const first = makeEngine(7);
    first.resolveNight();
    const next = makeEngine(7);

    expect(first.state.nightHistory).toHaveLength(1);
    expect(next.state.nightHistory).toEqual([]);
  });

  it("đêm không ai bị cắn thì không cứu được và bình cứu còn nguyên", () => {
    const e = makeEngine(7);
    const witch = findPlayersByRole(e, "WITCH")[0];
    lockWolves(e);

    expect(() => e.submitNightAction(witch.id, "HEAL", null)).toThrow(/không có ai bị cắn/);
    e.resolveNight();

    expect(e.state.healUsed).toBe(false);
    expect(e.state.nightHistory[0].witch).toMatchObject({
      usedHeal: false,
      healedTarget: null,
    });
  });

  it("Phù Thuỷ chưa được hành động khi bầy Sói chưa chốt", () => {
    const e = makeEngine(7);
    const witch = findPlayersByRole(e, "WITCH")[0];
    const target = findPlayersByRole(e, "VILLAGER")[0];

    expect(() => e.submitNightAction(witch.id, "SKIP", null)).toThrow(/Chưa tới lượt/);
    expect(() => e.submitNightAction(witch.id, "POISON", target.id)).toThrow(/Chưa tới lượt/);
    expect(e.snapshotFor(witch.id).nightInfo).toMatchObject({
      canAct: false,
      wolvesLocked: false,
      wolfTarget: null,
    });
  });

  it("Phù Thuỷ thấy đúng nạn nhân sau khi bầy Sói chốt", () => {
    const e = makeEngine(7);
    const wolves = findPlayersByRole(e, "WEREWOLF");
    const witch = findPlayersByRole(e, "WITCH")[0];
    const prey = findPlayersByRole(e, "VILLAGER")[0];

    for (const wolf of wolves) e.submitNightAction(wolf.id, "KILL", prey.id);
    lockWolves(e);

    expect(e.snapshotFor(witch.id).nightInfo).toMatchObject({
      canAct: true,
      wolvesLocked: true,
      wolfTarget: prey.id,
    });
    e.submitNightAction(witch.id, "HEAL", null);
    expect(e.resolveNight()).toEqual([]);
    expect(e.state.healUsed).toBe(true);
  });

  it("bình cứu vẫn tiêu hao khi Bảo Vệ đã đỡ sẵn, để không tố ai được bảo vệ", () => {
    const e = makeEngine(7);
    const wolves = findPlayersByRole(e, "WEREWOLF");
    const witch = findPlayersByRole(e, "WITCH")[0];
    const guard = findPlayersByRole(e, "GUARD")[0];
    const prey = findPlayersByRole(e, "VILLAGER")[0];

    for (const wolf of wolves) e.submitNightAction(wolf.id, "KILL", prey.id);
    e.submitNightAction(guard.id, "GUARD", prey.id);
    lockWolves(e);
    e.submitNightAction(witch.id, "HEAL", null);

    expect(e.resolveNight()).toEqual([]);
    expect(e.state.healUsed).toBe(true);
  });

  it("resolveNight tự chốt phiếu nếu chưa ai chốt", () => {
    const e = makeEngine(7);
    const wolves = findPlayersByRole(e, "WEREWOLF");
    const prey = findPlayersByRole(e, "VILLAGER")[0];

    for (const wolf of wolves) e.submitNightAction(wolf.id, "KILL", prey.id);
    expect(e.state.night.wolvesLocked).toBe(false);

    expect(e.resolveNight()).toEqual([
      expect.objectContaining({ playerId: prey.id, cause: "wolf" }),
    ]);
    expect(e.state.night.wolvesLocked).toBe(true);
  });

  it("ẩn toàn bộ lịch sử đêm trước GAME_OVER kể cả với người đã chết", () => {
    const e = makeEngine(7);
    e.resolveNight();
    const deadViewer = e.state.players[0];
    deadViewer.alive = false;

    expect(e.snapshotFor(e.state.players[1].id).nightHistory).toEqual([]);
    expect(e.snapshotFor(deadViewer.id).nightHistory).toEqual([]);
  });

  it("công khai toàn bộ lịch sử khi GAME_OVER", () => {
    const e = makeEngine(7);
    e.resolveNight();
    e.finishGame("village");

    expect(e.snapshotFor(e.state.players[0].id).nightHistory).toEqual(e.state.nightHistory);
  });

  it("chuẩn hóa state cũ chưa có nightHistory thành mảng rỗng", () => {
    const source = GameEngine.create(ids(7), CONFIG).getState();
    const legacy = { ...source, nightHistory: undefined } as unknown as GameState;

    expect(new GameEngine(legacy).state.nightHistory).toEqual([]);
  });
});

describe("Thợ Săn", () => {
  it("xếp phản ứng khi Thợ Săn bị Sói cắn", () => {
    const e = makeHunterEngine();
    e.state.night.killTarget = "hunter";
    e.state.night.wolvesLocked = true;

    e.resolveNight(1_000);

    expect(e.state.hunterReaction).toEqual({
      hunterId: "hunter",
      source: "night",
      resolved: false,
    });
  });

  it("xếp phản ứng khi Thợ Săn bị đầu độc", () => {
    const e = makeHunterEngine();
    e.state.night.poisonTarget = "hunter";
    e.state.night.wolvesLocked = true;

    e.resolveNight(1_000);

    expect(e.state.hunterReaction).toEqual({
      hunterId: "hunter",
      source: "night",
      resolved: false,
    });
  });

  it("xếp phản ứng khi Thợ Săn bị treo", () => {
    const e = makeHunterEngine("VOTING");
    e.state.votes = { wolf: "hunter", villager: "hunter" };

    e.resolveVote(1_000);

    expect(e.state.hunterReaction).toEqual({
      hunterId: "hunter",
      source: "vote",
      resolved: false,
    });
  });

  it("không xếp phản ứng khi Dân bị chết", () => {
    const e = makeHunterEngine();
    e.state.night.killTarget = "villager";
    e.state.night.wolvesLocked = true;

    e.resolveNight(1_000);

    expect(e.state.hunterReaction).toBeNull();
  });

  it("mở lượt bắn với thời hạn được truyền vào", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    e.state.players.find((player) => player.id === "hunter")!.alive = false;
    e.state.hunterReaction = { hunterId: "hunter", source: "night", resolved: false };

    e.beginHunterShot(15_000, 1_000);

    expect(e.state.phase).toBe("HUNTER_SHOT");
    expect(e.state.phaseEndsAt).toBe(16_000);
  });

  it("chặn kiểm tra thắng khi phản ứng chưa được giải quyết", () => {
    const e = makeHunterEngine();
    e.state.players.find((player) => player.id === "wolf")!.alive = false;
    e.state.hunterReaction = { hunterId: "hunter", source: "night", resolved: false };

    expect(e.checkWin()).toBeNull();
  });

  it("bắn Sói hợp lệ, ghi recap và đem chiến thắng cho phe làng", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(e);

    expect(e.submitHunterShot("hunter", "wolf")).toEqual({
      playerId: "wolf",
      name: "Sói",
    });
    expect(e.state.players.find((player) => player.id === "wolf")!.alive).toBe(false);
    expect(e.state.hunterShots).toHaveLength(1);
    expect(e.state.hunterShots.at(-1)?.target?.id).toBe("wolf");
    expect(e.checkWin()).toBe("village");
  });

  it("cho phép Thợ Săn bỏ qua và ghi recap không có mục tiêu", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(e);

    expect(e.submitHunterShot("hunter", null)).toBeNull();
    expect(e.state.hunterShots).toEqual([
      {
        round: 1,
        hunter: { id: "hunter", name: "Thợ Săn" },
        target: null,
        source: "night",
      },
    ]);
  });

  it("từ chối người bắn không phải Thợ Săn", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(e);

    expect(() => e.submitHunterShot("wolf", "villager")).toThrow(GameError);
  });

  it("từ chối bắn ngoài pha HUNTER_SHOT", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    e.state.players.find((player) => player.id === "hunter")!.alive = false;
    e.state.hunterReaction = { hunterId: "hunter", source: "night", resolved: false };

    expect(() => e.submitHunterShot("hunter", "wolf")).toThrow(GameError);
  });

  it("từ chối Thợ Săn còn sống bắn", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    e.state.hunterReaction = { hunterId: "hunter", source: "night", resolved: false };
    e.beginHunterShot(15_000, 1_000);

    expect(() => e.submitHunterShot("hunter", "wolf")).toThrow(GameError);
  });

  it("từ chối tự bắn, mục tiêu đã chết, và gửi lượt bắn lần hai", () => {
    const selfShot = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(selfShot);
    expect(() => selfShot.submitHunterShot("hunter", "hunter")).toThrow(GameError);

    const deadTarget = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(deadTarget);
    deadTarget.state.players.find((player) => player.id === "wolf")!.alive = false;
    expect(() => deadTarget.submitHunterShot("hunter", "wolf")).toThrow(GameError);

    const doubleSubmit = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(doubleSubmit);
    doubleSubmit.submitHunterShot("hunter", null);
    expect(() => doubleSubmit.submitHunterShot("hunter", "villager")).toThrow(GameError);
  });

  it("để Sói thắng khi Thợ Săn bắn Dân và tạo parity", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(e);

    e.submitHunterShot("hunter", "villager");

    expect(e.checkWin()).toBe("wolves");
  });

  it("chỉ hiển thị quyền bắn trong pha HUNTER_SHOT và chỉ công khai recap khi GAME_OVER", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(e, "vote");

    expect(e.snapshotFor("hunter").hunterShotInfo).toEqual({
      hunterId: "hunter",
      hunterName: "Thợ Săn",
      canAct: true,
      resolved: false,
      target: null,
    });
    expect(e.snapshotFor("wolf").hunterShotInfo).toEqual({
      hunterId: "hunter",
      hunterName: "Thợ Săn",
      canAct: false,
      resolved: false,
      target: null,
    });
    e.submitHunterShot("hunter", null);
    expect(e.completeHunterReaction()).toBe("vote");
    e.finishGame("wolves");
    expect(e.snapshotFor("wolf").hunterShots).toEqual(e.state.hunterShots);
  });

  it("công khai mục tiêu trong snapshot khi lượt bắn đã được giải quyết", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(e);

    e.submitHunterShot("hunter", "wolf");

    expect(e.snapshotFor("villager").hunterShotInfo).toEqual({
      hunterId: "hunter",
      hunterName: "Thợ Săn",
      canAct: false,
      resolved: true,
      target: { id: "wolf", name: "Sói" },
    });
  });

  it("không tiết lộ vai trò bí mật cho Thợ Săn đã chết trong lượt bắn", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(e);

    const view = e.snapshotFor("hunter");

    expect(view.you?.role).toBe("HUNTER");
    expect(view.players.filter((player) => player.id !== "hunter").every((player) => player.role === undefined)).toBe(true);
  });

  it("xóa phản ứng đã giải quyết và chuẩn hóa state cũ", () => {
    const e = makeHunterEngine("NIGHT_RESULT");
    prepareHunterShot(e);
    e.submitHunterShot("hunter", null);

    expect(e.completeHunterReaction()).toBe("night");
    expect(e.state.hunterReaction).toBeNull();

    const legacy = GameEngine.create(ids(6), CONFIG).getState();
    const legacyEngine = new GameEngine({
      ...legacy,
      hunterReaction: undefined,
      hunterShots: undefined,
    } as unknown as GameState);
    expect(legacyEngine.state.hunterReaction).toBeNull();
    expect(legacyEngine.state.hunterShots).toEqual([]);
  });
});
