import { describe, expect, it } from "vitest";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";

const IDS = ["b1", "b2", "b3"];

function fresh(): BotRuntime {
  return new BotRuntime({
    playerId: "b1",
    rng: createSeededRng("s:b1:brain"),
    playerIds: IDS,
  });
}

describe("khôi phục BotRuntime", () => {
  it("nạp lại state đã serialize thay vì dựng brain mới", () => {
    const original = fresh();
    original.state.suspicion["b2"]!.score = 42;

    const dumped = original.serialize();
    const restored = new BotRuntime({
      playerId: "b1",
      rng: createSeededRng("s:b1:brain", 5),
      playerIds: IDS,
      state: dumped.state,
      lastDecayRound: dumped.lastDecayRound,
    });

    expect(restored.state.suspicion["b2"]!.score).toBe(42);
    expect(restored.serialize().lastDecayRound).toBe(dumped.lastDecayRound);
  });

  it("không tiêu thêm số RNG khi đã có state", () => {
    const state = fresh().serialize().state;
    const rng = createSeededRng("s:b1:brain", 7);

    new BotRuntime({ playerId: "b1", rng, playerIds: IDS, state });

    expect(rng.cursor).toBe(7);
  });

  it("brain mới vẫn tiêu RNG để sinh personality", () => {
    const rng = createSeededRng("s:b1:brain");
    new BotRuntime({ playerId: "b1", rng, playerIds: IDS });
    expect(rng.cursor).toBeGreaterThan(0);
  });

  it("giữ nguyên phong cách nói dẫn xuất từ personality đã lưu", () => {
    const original = fresh();
    const restored = new BotRuntime({
      playerId: "b1",
      rng: createSeededRng("s:b1:brain", 3),
      playerIds: IDS,
      state: original.serialize().state,
    });

    expect(restored.style).toEqual(original.style);
    expect(restored.state.personality).toEqual(original.state.personality);
  });
});
