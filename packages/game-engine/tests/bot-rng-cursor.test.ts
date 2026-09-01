import { describe, expect, it } from "vitest";
import { createSeededRng } from "../src/bot/rng";

describe("con trỏ RNG", () => {
  it("đếm số lần đã gọi", () => {
    const rng = createSeededRng("seed");
    expect(rng.cursor).toBe(0);
    rng();
    rng();
    rng();
    expect(rng.cursor).toBe(3);
  });

  it("tua tới cursor cho ra đúng phần còn lại của dòng số gốc", () => {
    const original = createSeededRng("seed:bot:brain");
    const expected = [original(), original(), original(), original(), original()];

    const resumed = createSeededRng("seed:bot:brain", 3);
    expect(resumed.cursor).toBe(3);
    expect([resumed(), resumed()]).toEqual(expected.slice(3));
    expect(resumed.cursor).toBe(5);
  });

  it("tua xa vẫn khớp dòng gốc", () => {
    const original = createSeededRng("xa");
    for (let i = 0; i < 999; i += 1) original();
    const expected = original();

    expect(createSeededRng("xa", 999)()).toBe(expected);
  });

  it("cursor 0 giữ nguyên dòng số cũ", () => {
    const a = createSeededRng("cũ");
    const b = createSeededRng("cũ", 0);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
