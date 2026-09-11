import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { learnedRuntimeOptions, policyAppliesToSeat, resolveBotPolicy } from "../src/bots/learned-policy";
import { BotSession } from "../src/bots/session-registry";

/**
 * Cấu hình learned policy cho bot prod (spec wiring 2026-09-11):
 * không set path = heuristic; set mà hỏng thì NÉ ngay lúc boot (pattern
 * resolveVoiceConfig: hỏng ồn ào, không bao giờ im lặng rơi về heuristic).
 *
 * Mock config trỏ champion đóng gói trong repo để cả đường `botPolicy()`
 * (cache) lẫn đường BotSession lọc phe chạy đúng như production khi bật.
 */
vi.mock("../src/config", () => ({
  config: {
    botPolicyFile: join(__dirname, "..", "assets", "models", "village-ppo-0009.weights.json"),
  },
}));

const CHAMPION = join(__dirname, "..", "assets", "models", "village-ppo-0009.weights.json");

describe("resolveBotPolicy", () => {
  it("path null/rỗng → disabled, không đụng file hệ thống", () => {
    expect(resolveBotPolicy(null)).toEqual({ enabled: false });
    expect(resolveBotPolicy(undefined)).toEqual({ enabled: false });
    expect(resolveBotPolicy("")).toEqual({ enabled: false });
  });

  it("file không tồn tại → ném lỗi nêu rõ đường dẫn", () => {
    expect(() => resolveBotPolicy("no-such-dir/no-such.weights.json")).toThrow(
      /BOT_POLICY_FILE.*no-such\.weights\.json/,
    );
  });

  it("JSON hỏng → ném lỗi", () => {
    const dir = mkdtempSync(join(tmpdir(), "policy-"));
    try {
      const p = join(dir, "broken.json");
      writeFileSync(p, "{ không phải json", "utf8");
      expect(() => resolveBotPolicy(p)).toThrow(/BOT_POLICY_FILE/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("model lệch schema encoder → ném lỗi từ loadMlpPolicy", () => {
    const dir = mkdtempSync(join(tmpdir(), "policy-"));
    try {
      const p = join(dir, "wrong-schema.json");
      writeFileSync(p, JSON.stringify({ format: "khác" }), "utf8");
      expect(() => resolveBotPolicy(p)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("champion đóng gói trong repo phải load được — model phe làng, residual", () => {
    const resolved = resolveBotPolicy(CHAMPION);
    if (!resolved.enabled) throw new Error("champion phải enabled");
    expect(resolved.modelId).toBe("ppo-0009");
    expect(resolved.seats).toBe("village");
    expect(resolved.policy.residual).toEqual({ beta: 10 });
  });
});

describe("learnedRuntimeOptions", () => {
  it("enabled → ghế làng, cả vote lẫn đêm, argmax như benchmark", () => {
    const resolved = resolveBotPolicy(CHAMPION);
    const options = learnedRuntimeOptions(resolved);
    expect(options).toMatchObject({
      learnedTemperature: 0,
      learnedDecisions: "both",
    });
    expect(options.learnedPolicy?.id).toBe("ppo-0009");
  });

  it("disabled → object rỗng, BotRuntime giữ heuristic y nguyên", () => {
    expect(learnedRuntimeOptions({ enabled: false })).toEqual({});
  });
});

describe("policyAppliesToSeat", () => {
  const enabled = resolveBotPolicy(CHAMPION);

  it("phe làng với seats=village → chỉ ghế KHÔNG thuộc bầy sói được policy", () => {
    if (!enabled.enabled) throw new Error("champion phải enabled");
    expect(policyAppliesToSeat(enabled, false)).toBe(true);
    expect(policyAppliesToSeat(enabled, true)).toBe(false);
  });

  it("chưa biết phe (sảnh chờ, ảnh chụp cũ) → KHÔNG giao: an toàn", () => {
    expect(policyAppliesToSeat(enabled, undefined)).toBe(false);
  });

  it("disabled → không ghế nào được giao", () => {
    expect(policyAppliesToSeat({ enabled: false }, false)).toBe(false);
  });
});

describe("BotSession lọc policy theo phe", () => {
  it("ghế làng và ghế sói cùng dựng được runtime, sói bỏ qua policy", () => {
    const session = new BotSession("seed-1", ["lang", "soi"], { lang: false, soi: true });
    expect(() => session.runtimeFor("lang")).not.toThrow();
    expect(() => session.runtimeFor("soi")).not.toThrow();
  });

  it("session sảnh chờ (không biết phe) → mọi bot heuristic, không nổ", () => {
    const session = new BotSession("seed-2", ["a", "b"]);
    expect(() => session.runtimeFor("a")).not.toThrow();
  });

  it("wolfPack sống sót qua serialize/restore cho ván qua restart", () => {
    const session = new BotSession("seed-3", ["lang", "soi"], { lang: false, soi: true });
    session.runtimeFor("lang");
    session.runtimeFor("soi");
    const restored = BotSession.restore(session.serialize());
    expect(restored.serialize().wolfPack).toEqual({ lang: false, soi: true });
  });

  it("session không biết phe serialize ra KHÔNG có trường wolfPack", () => {
    const session = new BotSession("seed-4", ["a"]);
    expect(session.serialize().wolfPack).toBeUndefined();
  });
});
