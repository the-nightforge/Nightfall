import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@masoi/shared";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { buildDayPrompt, buildNightPrompt, personaFor } from "../src/bots/prompt";

/** Snapshot của Dân Làng: đã lọc, không ai lộ vai */
function villagerView(): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "v",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 2,
    phaseEndsAt: null,
    you: { id: "v", name: "Vân", ready: true, connected: true, role: "VILLAGER", alive: true },
    players: [
      { id: "v", name: "Vân", alive: true, isBot: true },
      { id: "w", name: "Wolf", alive: true, isBot: false },
      { id: "s", name: "Sang", alive: true, isBot: false },
    ],
    night: null,
    myVote: null,
    votesRevealed: false,
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [
      { id: "1", channel: "day", playerId: "s", playerName: "Sang", text: "Tôi nghi Wolf", at: 1 },
    ],
    log: [],
  };
}

/** Snapshot của Sói: thấy đồng bọn, không thấy vai phe làng */
function wolfView(): RoomSnapshot {
  return {
    ...villagerView(),
    phase: "NIGHT",
    you: { id: "w", name: "Wolf", ready: true, connected: true, role: "WEREWOLF", alive: true },
    players: [
      { id: "v", name: "Vân", alive: true, isBot: false },
      { id: "w", name: "Wolf", alive: true, isBot: true, role: "WEREWOLF" },
      { id: "s", name: "Sang", alive: true, isBot: false, role: "WEREWOLF" },
    ],
    night: { canAct: true, acted: false, wolfTarget: null, seerResult: null },
  };
}

describe("ranh giới bảo mật của prompt", () => {
  it("prompt của Dân Làng không chứa vai trò của bất kỳ ai khác", () => {
    const spec = buildDayPrompt(villagerView());
    const text = `${spec!.system}\n${spec!.user}`;
    expect(text).not.toContain("WEREWOLF");
    expect(text).not.toContain("SEER");
    expect(text).not.toContain("WITCH");
    expect(text).not.toContain("GUARD");
  });

  it("prompt của Sói nêu đồng bọn nhưng không nêu vai phe làng", () => {
    const spec = buildNightPrompt(wolfView());
    const text = `${spec!.system}\n${spec!.user}`;
    expect(text).toContain("Sang");
    expect(text).not.toContain("SEER");
    expect(text).not.toContain("WITCH");
  });

  it("chat của người chơi được bọc là dữ liệu, không phải chỉ thị", () => {
    const spec = buildDayPrompt(villagerView());
    expect(spec!.user).toContain("<chat>");
    expect(spec!.user).toContain("</chat>");
    expect(spec!.user).toContain("Tôi nghi Wolf");
  });
});

describe("responseSchema", () => {
  it("enum mục tiêu đêm của Sói chỉ gồm người ngoài phe Sói", () => {
    const spec = buildNightPrompt(wolfView());
    const target = spec!.schema.properties.targetId as { enum: string[] };
    expect(target.enum).toEqual(["v"]);
  });

  it("prompt ngày có enum phiếu bầu cho phép null", () => {
    const spec = buildDayPrompt(villagerView());
    const vote = spec!.schema.properties.voteTargetId as { enum: (string | null)[] };
    expect(vote.enum).toEqual(["w", "s", null]);
  });

  it("Dân Làng không có prompt đêm", () => {
    const v = { ...villagerView(), phase: "NIGHT" as const, night: null };
    expect(buildNightPrompt(v)).toBeNull();
  });
});

describe("personaFor", () => {
  it("cùng một id luôn ra cùng persona", () => {
    expect(personaFor("bot-1")).toBe(personaFor("bot-1"));
  });

  it("id khác nhau phủ được nhiều persona", () => {
    const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(personaFor));
    expect(seen.size).toBeGreaterThan(1);
  });
});
