import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { GAME_EVENTS } from "../src/events/eventManager";
import { BotRuntime } from "../src/bot/BotRuntime";
import { strategyFor } from "../src/bot/roles/registry";
import { createSeededRng } from "../src/bot/rng";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import type { BotBrainState, BotDecisionContext } from "../src/bot/types";
import { DEFAULT_ROOM_CONFIG, type GameEventId, type RoomConfig } from "@masoi/shared";

/**
 * Sự kiện phải đi tới được lõi BOT.
 *
 * Trước task này `activeEventId` chỉ nằm trên `BotDecisionContext` và không có
 * chỗ nào đọc, nên mọi sự kiện đổi luật đêm đều vô hình với BOT: Tiên Tri vẫn
 * soi một người trong Màn Sương Tan, bầy Sói vẫn cắn một người trong Cuộc Săn
 * Đẫm Máu. Các test dưới đây khoá đường đi đó lại ở tầng knowledge, tức tầng
 * DUY NHẤT mà engine được phép nói chuyện với lõi AI.
 */

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: false,
  mode: "chaos",
};

const FIXED_ROLES = ["WEREWOLF", "WEREWOLF", "SEER", "GUARD", "WITCH", "VILLAGER"] as const;

function nightEngine(): GameEngine {
  const engine = GameEngine.create(
    Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `Người ${i + 1}`, isBot: true })),
    CONFIG,
  );
  engine.state.players.forEach((player, i) => {
    player.role = FIXED_ROLES[i];
  });
  engine.setPhase("NIGHT", 30_000, 0);
  return engine;
}

/** Gắn sự kiện thẳng vào state: `selectEvent` là ngẫu nhiên, test thì không. */
function withEvent(engine: GameEngine, id: GameEventId): GameEngine {
  engine.state.activeEvent = { ...GAME_EVENTS[id], round: engine.state.round };
  return engine;
}

const idOf = (engine: GameEngine, role: string) =>
  engine.state.players.find((p) => p.role === role)!.id;

const wolfOf = (engine: GameEngine) => idOf(engine, "WEREWOLF");

describe("BotKnowledgeView · sự kiện đang chạy", () => {
  it("không có sự kiện thì activeEventId là null", () => {
    const e = nightEngine();
    expect(e.botKnowledgeFor(idOf(e, "SEER")).activeEventId).toBeNull();
  });

  it("mọi vai đều thấy sự kiện đang chạy, vì banner là công khai", () => {
    const e = withEvent(nightEngine(), "CLEARING_MIST");

    for (const player of e.state.players) {
      expect(e.botKnowledgeFor(player.id).activeEventId).toBe("CLEARING_MIST");
    }
  });
});

describe("NightKnowledge · quyền chọn mục tiêu phụ", () => {
  it("bình thường không ai được mục tiêu phụ", () => {
    const e = nightEngine();

    expect(e.botKnowledgeFor(idOf(e, "SEER")).night!.bonusSecondTargetFor).toBeNull();
    expect(e.botKnowledgeFor(wolfOf(e)).night!.bonusSecondTargetFor).toBeNull();
  });

  it("Màn Sương Tan mở mục tiêu phụ cho Tiên Tri, và chỉ cho Tiên Tri", () => {
    const e = withEvent(nightEngine(), "CLEARING_MIST");

    expect(e.botKnowledgeFor(idOf(e, "SEER")).night!.bonusSecondTargetFor).toBe("SEE");
    expect(e.botKnowledgeFor(wolfOf(e)).night!.bonusSecondTargetFor).toBeNull();
    expect(e.botKnowledgeFor(idOf(e, "GUARD")).night!.bonusSecondTargetFor).toBeNull();
  });

  it("Đêm Không Trăng khoá luôn mục tiêu phụ của Tiên Tri", () => {
    // Hai sự kiện không bao giờ chạy cùng lúc, nhưng điều kiện phải bám vào
    // lượt soi có mở hay không chứ không phải vào tên sự kiện.
    const e = withEvent(nightEngine(), "MOONLESS_NIGHT");

    expect(e.botKnowledgeFor(idOf(e, "SEER")).night!.bonusSecondTargetFor).toBeNull();
  });

  it("Cuộc Săn Đẫm Máu mở mục tiêu phụ cho bầy Sói, và chỉ cho bầy Sói", () => {
    const e = withEvent(nightEngine(), "BLOODY_HUNT");

    expect(e.botKnowledgeFor(wolfOf(e)).night!.bonusSecondTargetFor).toBe("KILL");
    expect(e.botKnowledgeFor(idOf(e, "SEER")).night!.bonusSecondTargetFor).toBeNull();
  });

  it("Sói Con phẫn nộ mở mục tiêu phụ y như sự kiện, dù không có sự kiện nào", () => {
    // Cùng một nhánh `canDoubleKill` trong engine; bỏ sót nó nghĩa là đêm sau
    // khi Sói Con chết, BOT vẫn chỉ cắn một người.
    const e = nightEngine();
    e.state.night.wolfCubRageTonight = true;

    expect(e.botKnowledgeFor(wolfOf(e)).night!.bonusSecondTargetFor).toBe("KILL");
  });

  it("không đủ hai mồi thì không chào mục tiêu phụ cho Sói", () => {
    // Mục tiêu phụ trùng mục tiêu chính là lỗi engine ném, và cú ném đó làm
    // mất CẢ lượt cắn chứ không riêng mục tiêu phụ.
    const e = withEvent(nightEngine(), "BLOODY_HUNT");
    for (const player of e.state.players) {
      if (player.role !== "WEREWOLF" && player.role !== "SEER") player.alive = false;
    }

    expect(e.botKnowledgeFor(wolfOf(e)).night!.bonusSecondTargetFor).toBeNull();
  });
});

/**
 * Từ knowledge xuống nước đi thật.
 *
 * Dựng context từ CHÍNH engine chứ không từ fixture: thứ cần chứng minh là nước
 * đi bot sinh ra được engine chấp nhận, và một fixture viết tay thì không chứng
 * minh được điều đó.
 */
function contextFor(engine: GameEngine, playerId: string): BotDecisionContext {
  return { knowledge: engine.botKnowledgeFor(playerId), visibleChat: [] };
}

function stateFor(engine: GameEngine, playerId: string): BotBrainState {
  return createBotBrainState(
    playerId,
    createBotPersonality(createSeededRng(playerId)),
    engine.state.players.map((p) => p.id),
  );
}

describe("Tiên Tri · Màn Sương Tan", () => {
  it("soi hai người khác nhau khi sự kiện mở mục tiêu phụ", () => {
    const e = withEvent(nightEngine(), "CLEARING_MIST");
    const seer = idOf(e, "SEER");

    const decision = strategyFor("SEER").decideNight(
      contextFor(e, seer),
      stateFor(e, seer),
      createSeededRng("mist"),
    )!;

    expect(decision.action).toBe("SEE");
    expect(decision.secondaryTargetId).toBeTruthy();
    expect(decision.secondaryTargetId).not.toBe(decision.targetId);
    expect(e.botKnowledgeFor(seer).night!.legalTargets.SEE).toContain(
      decision.secondaryTargetId!,
    );
  });

  it("không có sự kiện thì vẫn chỉ soi một người", () => {
    const e = nightEngine();
    const seer = idOf(e, "SEER");

    const decision = strategyFor("SEER").decideNight(
      contextFor(e, seer),
      stateFor(e, seer),
      createSeededRng("mist"),
    )!;

    expect(decision.secondaryTargetId ?? null).toBeNull();
  });

  it("engine nhận nguyên nước đi hai mục tiêu và trả về hai kết quả soi", () => {
    // Đây là cổng thật: sai điều kiện thì engine ném và Tiên Tri mất CẢ đêm.
    const e = withEvent(nightEngine(), "CLEARING_MIST");
    const seer = idOf(e, "SEER");

    const decision = strategyFor("SEER").decideNight(
      contextFor(e, seer),
      stateFor(e, seer),
      createSeededRng("mist"),
    )!;
    e.submitNightAction(seer, "SEE", decision.targetId, decision.secondaryTargetId ?? undefined);

    const result = e.state.night.seerResults[seer];
    expect(result.targetId).toBe(decision.targetId);
    expect(result.secondaryTargetId).toBeTruthy();
    expect(result.secondaryTargetId).toBe(decision.secondaryTargetId);
    expect(typeof result.secondaryIsWolf).toBe("boolean");
  });
});

describe("Bầy Sói · Cuộc Săn Đẫm Máu", () => {
  it("cắn hai mục tiêu khác nhau, không con nào là đồng bọn", () => {
    const e = withEvent(nightEngine(), "BLOODY_HUNT");
    const wolf = wolfOf(e);

    const decision = strategyFor("WEREWOLF").decideNight(
      contextFor(e, wolf),
      stateFor(e, wolf),
      createSeededRng("hunt"),
    )!;

    expect(decision.action).toBe("KILL");
    expect(decision.secondaryTargetId).toBeTruthy();
    expect(decision.secondaryTargetId).not.toBe(decision.targetId);
    expect(e.botKnowledgeFor(wolf).night!.legalTargets.KILL).toContain(
      decision.secondaryTargetId!,
    );
  });

  it("không có sự kiện thì vẫn chỉ cắn một người", () => {
    const e = nightEngine();
    const wolf = wolfOf(e);

    const decision = strategyFor("WEREWOLF").decideNight(
      contextFor(e, wolf),
      stateFor(e, wolf),
      createSeededRng("hunt"),
    )!;

    expect(decision.secondaryTargetId ?? null).toBeNull();
  });

  it("engine ghi nhận mục tiêu phụ của bầy Sói", () => {
    const e = withEvent(nightEngine(), "BLOODY_HUNT");
    const wolf = wolfOf(e);

    const decision = strategyFor("WEREWOLF").decideNight(
      contextFor(e, wolf),
      stateFor(e, wolf),
      createSeededRng("hunt"),
    )!;
    e.submitNightAction(wolf, "KILL", decision.targetId, decision.secondaryTargetId ?? undefined);

    expect(e.state.night.wolfSecondaryTarget).toBe(decision.secondaryTargetId);
  });
});

/**
 * Ngày Sự Thật.
 *
 * Sự kiện này là sự kiện DUY NHẤT đòi người chơi bấm một nút. Trước task này chỉ
 * có client người thật gọi `submitDayOfTruthClaim`, nên trong một bàn nhiều BOT
 * nó không làm gì cả: bảng claim rỗng và cả làng nhìn nhau.
 *
 * Chính sách cố tình đơn giản và tái lập được: phe Sói và mọi vai chức năng đều
 * nói "Dân Làng" - lộ vai chức năng ban ngày là mời bầy Sói cắn đêm đó. Ngoại
 * lệ duy nhất là Tiên Tri đã soi TRÚNG một con Sói: lúc đó thông tin đáng giá
 * hơn cái mạng, vì làng có thể treo đúng người ngay hôm nay.
 */
function dayEngine(): GameEngine {
  const engine = nightEngine();
  engine.setPhase("DAY_DISCUSSION", 60_000, 0);
  return engine;
}

function runtimeFor(engine: GameEngine, playerId: string): BotRuntime {
  return new BotRuntime({
    playerId,
    rng: createSeededRng(playerId),
    playerIds: engine.state.players.map((p) => p.id),
  });
}

/** Cho Tiên Tri một kết quả soi rồi để runtime tự nạp nó qua `observe`. */
function seerSees(engine: GameEngine, seerId: string, targetId: string, isWolf: boolean) {
  engine.state.night.seerResults[seerId] = { targetId, isWolf };
  const runtime = runtimeFor(engine, seerId);
  runtime.observe(contextFor(engine, seerId));
  return runtime;
}

describe("Ngày Sự Thật · claim của BOT", () => {
  it("Sói không tự khai, nhận là Dân Làng", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const wolf = wolfOf(e);
    const runtime = runtimeFor(e, wolf);
    runtime.observe(contextFor(e, wolf));

    expect(runtime.decideRoleClaim(contextFor(e, wolf)).role).toBe("VILLAGER");
  });

  it("Dân Làng nói thật, vì sự thật của họ đúng bằng lời nói dối của Sói", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const villager = idOf(e, "VILLAGER");
    const runtime = runtimeFor(e, villager);
    runtime.observe(contextFor(e, villager));

    expect(runtime.decideRoleClaim(contextFor(e, villager)).role).toBe("VILLAGER");
  });

  it("Bảo Vệ giấu vai: khai ra là tự đặt mình lên bàn cắn đêm nay", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const guard = idOf(e, "GUARD");
    const runtime = runtimeFor(e, guard);
    runtime.observe(contextFor(e, guard));

    expect(runtime.decideRoleClaim(contextFor(e, guard)).role).toBe("VILLAGER");
  });

  it("Tiên Tri đã soi trúng Sói thì khai thật, vì thông tin đáng hơn cái mạng", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const seer = idOf(e, "SEER");
    const runtime = seerSees(e, seer, wolfOf(e), true);

    expect(runtime.decideRoleClaim(contextFor(e, seer)).role).toBe("SEER");
  });

  it("Tiên Tri mới chỉ soi ra người sạch thì vẫn giấu", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const seer = idOf(e, "SEER");
    const runtime = seerSees(e, seer, idOf(e, "VILLAGER"), false);

    expect(runtime.decideRoleClaim(contextFor(e, seer)).role).toBe("VILLAGER");
  });

  it("claim luôn là một vai engine chấp nhận", () => {
    // `submitDayOfTruthClaim` ném với chuỗi lạ, và cú ném đó nuốt mất lượt claim.
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");

    for (const player of e.state.players) {
      const runtime = runtimeFor(e, player.id);
      const claim = runtime.decideRoleClaim(contextFor(e, player.id));
      expect(() => e.submitDayOfTruthClaim(player.id, claim.role)).not.toThrow();
      expect(e.state.dayOfTruthClaims[player.id]).toBe(claim.role);
    }
  });
});

/**
 * Claim của Ngày Sự Thật đi vào lõi BOT bằng đường CẤU TRÚC.
 *
 * Không đẩy qua chat: claim là dữ liệu có cấu trúc, và round-trip nó qua một
 * parser tiếng Việt chỉ để bot đọc lại là tự chuốc một tầng mất mát. Engine đã
 * lưu sẵn `dayOfTruthClaims` và nó công khai với cả phòng, nên đường ngắn nhất
 * cũng là đường chính xác nhất.
 */
describe("BotKnowledgeView · claim Ngày Sự Thật", () => {
  it("chưa ai claim thì bảng rỗng chứ không phải undefined", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");

    expect(e.botKnowledgeFor(wolfOf(e)).dayOfTruthClaims).toEqual({});
  });

  it("claim của người khác là công khai, ai cũng đọc được", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const seer = idOf(e, "SEER");
    e.submitDayOfTruthClaim(seer, "SEER");

    for (const player of e.state.players) {
      expect(e.botKnowledgeFor(player.id).dayOfTruthClaims[seer]).toBe("SEER");
    }
  });

  it("giá trị rác không lọt vào knowledge", () => {
    // Phòng phục hồi từ Redis có thể mang state của một phiên bản khác. Lọc ở
    // đúng ranh giới kiểu rẻ hơn nhiều so với việc truy một memory bịa.
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    e.state.dayOfTruthClaims = { [wolfOf(e)]: "KHONG_PHAI_VAI", [idOf(e, "GUARD")]: null };

    const claims = e.botKnowledgeFor(idOf(e, "SEER")).dayOfTruthClaims;
    expect(claims[wolfOf(e)]).toBeUndefined();
    expect(claims[idOf(e, "GUARD")]).toBeNull();
  });
});

describe("BotRuntime · nạp claim Ngày Sự Thật", () => {
  it("ghi claim thành ROLE_CLAIM memory, không cần đọc chat", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const seer = idOf(e, "SEER");
    e.submitDayOfTruthClaim(seer, "SEER");

    const runtime = runtimeFor(e, wolfOf(e));
    runtime.observe(contextFor(e, wolfOf(e)));

    const claim = runtime.state.claims.find((memory) => memory.actorId === seer);
    expect(claim?.type).toBe("ROLE_CLAIM");
    expect(claim?.data.role).toBe("SEER");
  });

  it("observe nhiều lần không nhân đôi cùng một lời khai", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const seer = idOf(e, "SEER");
    e.submitDayOfTruthClaim(seer, "SEER");

    const runtime = runtimeFor(e, wolfOf(e));
    runtime.observe(contextFor(e, wolfOf(e)));
    runtime.observe(contextFor(e, wolfOf(e)));
    e.setPhase("VOTING", 30_000, 0);
    runtime.observe(contextFor(e, wolfOf(e)));

    expect(runtime.state.claims.filter((memory) => memory.actorId === seer)).toHaveLength(1);
  });

  it("người lật claim thì BOT nhớ CẢ HAI lời, vì lật lọng cũng là thông tin", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const guard = idOf(e, "GUARD");
    const runtime = runtimeFor(e, wolfOf(e));

    e.submitDayOfTruthClaim(guard, "VILLAGER");
    runtime.observe(contextFor(e, wolfOf(e)));
    e.submitDayOfTruthClaim(guard, "SEER");
    runtime.observe(contextFor(e, wolfOf(e)));

    const roles = runtime.state.claims
      .filter((memory) => memory.actorId === guard)
      .map((memory) => memory.data.role);
    expect(roles).toEqual(["VILLAGER", "SEER"]);
  });

  it("không tiết lộ thì không có gì để nhớ", () => {
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const guard = idOf(e, "GUARD");
    e.submitDayOfTruthClaim(guard, null);

    const runtime = runtimeFor(e, wolfOf(e));
    runtime.observe(contextFor(e, wolfOf(e)));

    expect(runtime.state.claims.filter((memory) => memory.actorId === guard)).toHaveLength(0);
  });

  it("Sói nhắm người tự nhận vai chức năng trong Ngày Sự Thật", () => {
    // Đây là toàn bộ lý do của tính năng: claim phải đổi được nước đi, không
    // chỉ nằm trong một cái bảng.
    const e = withEvent(dayEngine(), "DAY_OF_TRUTH");
    const seer = idOf(e, "SEER");
    e.submitDayOfTruthClaim(seer, "SEER");

    const wolf = wolfOf(e);
    const runtime = runtimeFor(e, wolf);
    runtime.observe(contextFor(e, wolf));

    e.setPhase("NIGHT", 30_000, 0);
    e.state.activeEvent = null;
    const decision = runtime.decideNight(contextFor(e, wolf))!;

    expect(decision.targetId).toBe(seer);
  });
});
