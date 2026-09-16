import { describe, expect, it } from "vitest";
import { analyzeChat } from "../src/bot/analysis/chat-analysis";
import { BOT_WEIGHTS_PRESETS } from "../src/bot/config/presets";
import { BOT_WEIGHTS_V37, type BotWeights } from "../src/bot/config/weights";

/**
 * Phản bác: nới cách gõ mà parser đọc được (`claim.counterClaimLoose`).
 *
 * Trước knob này parser đòi ĐÚNG một khuôn - " không thể là " cộng "tôi mới là "
 * - nên prompt phải ép LLM viết đúng khuôn đó (mọi lời phản bác nghe y nhau), và
 * người thật gõ "An đâu phải tt, t mới là tt" thì bot không hiểu gì.
 */

const PLAYERS = [
  { id: "p1", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
];

const LOOSE: BotWeights = {
  ...BOT_WEIGHTS_V37,
  claim: { ...BOT_WEIGHTS_V37.claim, counterClaimLoose: 1 },
};

/** Bình (p2) phản bác An (p1). */
const memories = (text: string, weights: BotWeights) =>
  analyzeChat([{ id: "m", actorId: "p2", text, at: 0 }], PLAYERS, { weights });

const counter = (text: string, weights: BotWeights = LOOSE) =>
  memories(text, weights).find((memory) => memory.type === "COUNTER_CLAIM");

describe("cách gõ phản bác mà parser đọc được", () => {
  it("khuôn cũ vẫn đọc được, ở cả hai cấu hình", () => {
    for (const weights of [BOT_WEIGHTS_V37, LOOSE]) {
      expect(counter("An không thể là Tiên Tri, tôi mới là Tiên Tri", weights)).toMatchObject({
        targetId: "p1",
        data: { role: "SEER" },
      });
    }
  });

  it("cụm phủ định tự nhiên hơn: đâu phải, không phải là, ko phải", () => {
    for (const text of [
      "An đâu phải tt, t mới là tt",
      "An không phải là Bảo Vệ, mình mới là Bảo Vệ",
      "An ko phải tt, chính tôi là tt",
      "An không phải Phù Thủy, tôi mới đúng là Phù Thủy",
    ]) {
      expect(counter(text), text).toMatchObject({ targetId: "p1" });
    }
  });

  it('"tôi là" cũng thành phản bác khi vai bị phủ định TRÙNG vai tự nhận', () => {
    expect(counter("An không thể là tiên tri, tôi là tiên tri")).toMatchObject({
      targetId: "p1",
      data: { role: "SEER" },
    });
  });

  it("cụm rõ ràng giữ nghĩa cũ: hai vai khác nhau vẫn là phản bác", () => {
    for (const weights of [BOT_WEIGHTS_V37, LOOSE]) {
      expect(counter("An không thể là sói, tôi mới là Tiên Tri", weights), String(weights.version)).toMatchObject({
        targetId: "p1",
        data: { role: "SEER" },
      });
    }
  });
});

describe("ranh giới phải giữ", () => {
  const types = (text: string) =>
    memories(text, LOOSE)
      .filter((memory) => memory.type !== "DIRECT_QUESTION" && memory.type !== "DIRECT_ADDRESS")
      .map((memory) => [memory.type, memory.targetId]);

  it("chỉ phủ định, không tự nhận: vẫn chỉ là bênh người đó", () => {
    expect(types("An không thể là sói")).toEqual([["DEFEND", "p1"]]);
  });

  it("bênh người khác rồi khai vai KHÁC: không phải phản bác", () => {
    expect(counter("An không phải sói, tôi là dân")).toBeUndefined();
  });

  it("knob tắt (v37) thì cách gõ mới vẫn không đọc được", () => {
    for (const text of ["An đâu phải tt, t mới là tt", "An không phải là Bảo Vệ, mình mới là Bảo Vệ"]) {
      expect(counter(text, BOT_WEIGHTS_V37), text).toBeUndefined();
    }
  });
});

describe("preset", () => {
  it("v38 = v37 + nới cách gõ phản bác", () => {
    expect(BOT_WEIGHTS_PRESETS["38.0.0"]).toEqual({ ...LOOSE, version: "38.0.0" });
  });
});
