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
