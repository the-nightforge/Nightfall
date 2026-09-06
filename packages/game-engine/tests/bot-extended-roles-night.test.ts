import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import { DEFAULT_ROOM_CONFIG, ROLE_META, ROLES, type Role, type RoomConfig } from "@masoi/shared";
import type { BotDecisionContext } from "../src/bot/types";

/**
 * Các vai mở rộng phải chơi được bằng lõi deterministic.
 *
 * Nhánh vai mới được viết khi BOT còn quyết định ban đêm qua provider. Phase 2
 * gỡ đường đó, nên nếu `botNightKnowledgeFor` không biết một vai thì bot vai đó
 * **im lặng** bỏ lượt đêm - không lỗi, không log, chỉ là một Thám Tử không bao
 * giờ điều tra. Đây là kiểu hỏng mà chỉ test mới thấy.
 */

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 1,
  wolfCub: true,
  seer: true,
  apprenticeSeer: true,
  detective: true,
  guard: true,
  guardianAngel: true,
  sorcerer: true,
  witch: true,
  hunter: false,
  mayor: true,
};

/** Mọi vai có `nightOrder`, tức mọi vai engine cho phép hành động ban đêm. */
const NIGHT_ROLES = ROLES.filter((role) => ROLE_META[role].nightOrder !== undefined);

/**
 * Vai dùng kỹ năng MỖI ĐÊM: không hành động là mất trắng một lượt, nên chúng
 * phải luôn ra quyết định.
 */
const ALWAYS_ACT: readonly Role[] = [
  "WEREWOLF",
  "WOLF_CUB",
  "SEER",
  "APPRENTICE_SEER",
  "DETECTIVE",
  "GUARD",
  "SORCERER",
];

/**
 * Vai có SỐ LƯỢT GIỚI HẠN cả ván. Giữ lượt khi chưa có lý do là hành vi đúng,
 * không phải bot hỏng - Phù Thuỷ và Thiên Thần chỉ có vài lượt. Chúng được
 * kiểm bằng test riêng có điều kiện. (Linh Mục - thành viên thứ ba của nhóm
 * này - đã bị xóa cứng; Sói Pháp Sư soi MỖI ĐÊM nên thuộc nhóm trên.)
 */
const LIMITED_CHARGE: readonly Role[] = ["WITCH", "GUARDIAN_ANGEL"];

function nightEngine(roles: readonly Role[]) {
  const engine = GameEngine.create(
    roles.map((_, i) => ({ id: `p${i + 1}`, name: `Người ${i + 1}`, isBot: true })),
    CONFIG,
  );
  engine.state.players.forEach((player, i) => {
    player.role = roles[i];
  });
  engine.setPhase("NIGHT", 30_000, 0);
  return engine;
}

/** Bàn cờ đủ 9 vai đêm cộng vài dân để luôn có mục tiêu hợp lệ. */
function fullBoard() {
  return nightEngine([
    "WEREWOLF",
    "WOLF_CUB",
    "SEER",
    "APPRENTICE_SEER",
    "DETECTIVE",
    "GUARD",
    "GUARDIAN_ANGEL",
    "SORCERER",
    "WITCH",
    "VILLAGER",
    "MAYOR",
  ]);
}

const idOf = (engine: GameEngine, role: Role) =>
  engine.state.players.find((p) => p.role === role)!.id;

const contextFor = (engine: GameEngine, playerId: string): BotDecisionContext => ({
  knowledge: engine.botKnowledgeFor(playerId),
  visibleChat: [],
});

function runtimeFor(engine: GameEngine, playerId: string): BotRuntime {
  return new BotRuntime({
    playerId,
    rng: createSeededRng(`ext:${playerId}`),
    playerIds: engine.state.players.map((p) => p.id),
  });
}

describe("knowledge đêm cho vai mở rộng", () => {
  it("mọi vai có hành động đêm đều được chào ít nhất một hành động", () => {
    const engine = fullBoard();
    engine.state.apprenticeAwakened = true;

    const silent: string[] = [];
    for (const role of NIGHT_ROLES) {
      // Phù Thuỷ đi sau bầy Sói; trước khi khoá phiếu, engine từ chối cả SKIP.
      if (role === "WITCH") continue;
      const player = engine.state.players.find((p) => p.role === role);
      if (!player) continue;
      const night = engine.botKnowledgeFor(player.id).night;
      if (!night || night.legalActions.length === 0) silent.push(role);
    }

    expect(silent).toEqual([]);
  });

  it("Phù Thuỷ được chào hành động ngay sau khi bầy Sói khoá phiếu", () => {
    const engine = fullBoard();
    engine.state.night.wolvesLocked = true;

    expect(
      engine.botKnowledgeFor(idOf(engine, "WITCH")).night!.legalActions,
    ).toContain("SKIP");
  });

  it("Thám Tử được chào DETECTIVE_CHECK với đủ mục tiêu cho cả hai người", () => {
    const engine = fullBoard();
    const night = engine.botKnowledgeFor(idOf(engine, "DETECTIVE")).night!;

    expect(night.legalActions).toContain("DETECTIVE_CHECK");
    expect(night.legalTargets.DETECTIVE_CHECK.length).toBeGreaterThanOrEqual(2);
  });

  it("Thiên Thần Hộ Mệnh không được đỡ lại người đêm trước", () => {
    const engine = fullBoard();
    const previous = idOf(engine, "VILLAGER");
    engine.state.guardianAngelPrevious = previous;

    const night = engine.botKnowledgeFor(idOf(engine, "GUARDIAN_ANGEL")).night!;

    expect(night.legalActions).toContain("GUARDIAN_PROTECT");
    expect(night.legalTargets.GUARDIAN_PROTECT).not.toContain(previous);
  });

  it("Thiên Thần hết lượt thì không còn được chào bảo vệ", () => {
    const engine = fullBoard();
    const angel = idOf(engine, "GUARDIAN_ANGEL");
    engine.state.guardianAngelCharges[angel] = 0;

    expect(engine.botKnowledgeFor(angel).night!.legalActions).not.toContain(
      "GUARDIAN_PROTECT",
    );
  });

  it("Sói Pháp Sư được chào SORCERER_CHECK cùng phiếu cắn của bầy", () => {
    const engine = fullBoard();
    const sorcerer = idOf(engine, "SORCERER");
    const night = engine.botKnowledgeFor(sorcerer).night!;

    expect(night.legalActions).toContain("SORCERER_CHECK");
    expect(night.legalTargets.SORCERER_CHECK.length).toBeGreaterThan(0);
    expect(night.legalTargets.SORCERER_CHECK).not.toContain(sorcerer);
  });

  it("Tiên Tri Tập Sự chưa thức tỉnh thì không có thông tin đêm", () => {
    const engine = fullBoard();
    engine.state.apprenticeAwakened = false;

    expect(engine.botKnowledgeFor(idOf(engine, "APPRENTICE_SEER")).night).toBeNull();
  });

  it("Tiên Tri Tập Sự đã thức tỉnh thì soi như Tiên Tri", () => {
    const engine = fullBoard();
    engine.state.apprenticeAwakened = true;

    const night = engine.botKnowledgeFor(idOf(engine, "APPRENTICE_SEER")).night!;
    expect(night.legalActions).toContain("SEE");
  });

  it("Sói Con nhận danh sách cắn không chứa đồng bọn", () => {
    const engine = fullBoard();
    const night = engine.botKnowledgeFor(idOf(engine, "WOLF_CUB")).night!;

    expect(night.legalActions).toContain("KILL");
    expect(night.legalTargets.KILL).not.toContain(idOf(engine, "WEREWOLF"));
    expect(night.legalTargets.KILL).not.toContain(idOf(engine, "WOLF_CUB"));
  });

  it("Thị Trưởng không có hành động đêm", () => {
    expect(fullBoard().botKnowledgeFor(idOf(fullBoard(), "MAYOR")).night).toBeNull();
  });

  it("không NightKnowledge nào của vai mở rộng chứa mã vai", () => {
    const engine = fullBoard();
    engine.state.apprenticeAwakened = true;

    for (const player of engine.state.players) {
      const night = engine.botKnowledgeFor(player.id).night;
      if (!night) continue;
      const values = JSON.stringify([
        Object.values(night.legalTargets),
        night.wolfTarget,
        night.guardPrevious,
      ]);
      for (const role of ROLES) expect(values).not.toContain(role);
    }
  });
});

describe("chiến lược đêm cho vai mở rộng", () => {
  it("mọi vai dùng kỹ năng mỗi đêm đều thật sự ra quyết định", () => {
    // Đây là bài kiểm tra chống hồi quy chính: trước khi merge, năm vai mở rộng
    // im lặng bỏ lượt vì `botNightKnowledgeFor` không biết chúng.
    const engine = fullBoard();
    engine.state.apprenticeAwakened = true;

    const idle: string[] = [];
    for (const role of ALWAYS_ACT) {
      const player = engine.state.players.find((p) => p.role === role);
      if (!player) continue;
      const context = contextFor(engine, player.id);
      const runtime = runtimeFor(engine, player.id);
      runtime.observe(context);
      if (runtime.decideNight(context) === null) idle.push(role);
    }

    expect(idle).toEqual([]);
  });

  it("vai có lượt giới hạn thì GIỮ lượt khi chưa có lý do", () => {
    // Ngược lại với test trên: tiêu một lượt vì không nghĩ ra việc gì hay hơn
    // là cách chắc chắn để không còn nó lúc thật sự cần.
    const engine = fullBoard();

    for (const role of LIMITED_CHARGE) {
      const player = engine.state.players.find((p) => p.role === role);
      if (!player) continue;
      const context = contextFor(engine, player.id);
      const runtime = runtimeFor(engine, player.id);
      runtime.observe(context);
      expect(runtime.decideNight(context)).toBeNull();
    }
  });

  it("Thiên Thần tiêu lượt khi có người rõ ràng đang bị nhắm", () => {
    const engine = fullBoard();
    const angel = idOf(engine, "GUARDIAN_ANGEL");
    const victim = idOf(engine, "VILLAGER");

    const context = contextFor(engine, angel);
    const runtime = runtimeFor(engine, angel);
    runtime.observe(context);
    for (const attacker of ["SEER", "GUARD", "WITCH"] as const) {
      runtime.state.relationships[`${idOf(engine, attacker)}->${victim}`] = {
        support: 0,
        hostility: 1,
        voteAlignment: 0,
        samples: 4,
        reasons: [],
        lastUpdatedRound: 1,
      };
    }

    const decision = runtime.decideNight(context)!;

    expect(decision.action).toBe("GUARDIAN_PROTECT");
    expect(decision.targetId).toBe(victim);
  });

  it("quyết định của mọi vai đều được engine chấp nhận", () => {
    // Đây là bài kiểm tra thật sự: engine là trọng tài, nên một nước đi bịa ra
    // sẽ ném chứ không âm thầm trôi qua.
    const engine = fullBoard();
    engine.state.apprenticeAwakened = true;

    const rejected: string[] = [];
    for (const role of NIGHT_ROLES) {
      // Phù Thuỷ chưa tới lượt khi bầy Sói chưa khoá phiếu.
      if (role === "WITCH") continue;
      const player = engine.state.players.find((p) => p.role === role);
      if (!player) continue;

      const context = contextFor(engine, player.id);
      const runtime = runtimeFor(engine, player.id);
      runtime.observe(context);
      const decision = runtime.decideNight(context);
      if (!decision) continue;

      try {
        engine.submitNightAction(
          player.id,
          decision.action,
          decision.targetId,
          decision.secondaryTargetId,
        );
      } catch (error) {
        rejected.push(`${role}: ${String(error)}`);
      }
    }

    expect(rejected).toEqual([]);
  });

  it("Thám Tử chọn hai người KHÁC NHAU", () => {
    const engine = fullBoard();
    const detective = idOf(engine, "DETECTIVE");
    const context = contextFor(engine, detective);
    const runtime = runtimeFor(engine, detective);
    runtime.observe(context);

    const decision = runtime.decideNight(context)!;

    expect(decision.action).toBe("DETECTIVE_CHECK");
    expect(decision.targetId).not.toBeNull();
    expect(decision.secondaryTargetId).not.toBeNull();
    expect(decision.targetId).not.toBe(decision.secondaryTargetId);
  });

  it("Sói Pháp Sư soi người đang claim Tiên Tri trước", () => {
    const engine = fullBoard();
    const sorcerer = idOf(engine, "SORCERER");
    const seer = idOf(engine, "SEER");

    const context = contextFor(engine, sorcerer);
    const runtime = runtimeFor(engine, sorcerer);
    runtime.observe(context);
    runtime.state.seenEventIds.push("m-seer");
    runtime.state.claims.push({
      id: "ROLE_CLAIM:m-seer:",
      sourceId: "m-seer",
      round: 1,
      phase: "DAY_DISCUSSION",
      type: "ROLE_CLAIM",
      actorId: seer,
      importance: 8,
      pinned: true,
      data: { role: "SEER" },
    });

    const decision = runtime.decideNight(contextFor(engine, sorcerer))!;

    expect(decision.action).toBe("SORCERER_CHECK");
    expect(decision.targetId).toBe(seer);
  });

  it("Sói Pháp Sư không soi đồng bọn đã biết", () => {
    const engine = fullBoard();
    const sorcerer = idOf(engine, "SORCERER");
    const context = contextFor(engine, sorcerer);
    const runtime = runtimeFor(engine, sorcerer);
    runtime.observe(context);

    const decision = runtime.decideNight(context)!;

    expect(decision.action).toBe("SORCERER_CHECK");
    expect(engine.state.players.find((p) => p.id === decision.targetId)?.role).not.toBe(
      "WEREWOLF",
    );
    expect(engine.state.players.find((p) => p.id === decision.targetId)?.role).not.toBe(
      "WOLF_CUB",
    );
  });

  it("cùng seed cho cùng quyết định ở mọi vai", () => {
    const run = () => {
      const engine = fullBoard();
      engine.state.apprenticeAwakened = true;
      return NIGHT_ROLES.map((role) => {
        const player = engine.state.players.find((p) => p.role === role);
        if (!player) return null;
        const context = contextFor(engine, player.id);
        const runtime = runtimeFor(engine, player.id);
        runtime.observe(context);
        return runtime.decideNight(context);
      });
    };

    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
