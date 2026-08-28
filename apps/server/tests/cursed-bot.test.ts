import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG, type NightActionView, type RoomSnapshot } from "@masoi/shared";
import { legalNightTargets, soloNightAction } from "../src/bots/targets";
import { buildDayPrompt, buildNightPrompt } from "../src/bots/prompt";
import { interpretNight } from "../src/bots/decide";

function nightInfo(over: Partial<NightActionView> = {}): NightActionView {
  return {
    canAct: true,
    acted: false,
    wolvesLocked: false,
    wolfTarget: null,
    seerResult: null,
    healUsed: false,
    poisonUsed: false,
    ...over,
  };
}

function botView(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "CURSE",
    hostId: "villager",
    phase: "NIGHT",
    config: { ...DEFAULT_ROOM_CONFIG, cursed: true },
    round: 2,
    phaseEndsAt: Date.now() + 30_000,
    you: {
      id: "cursed",
      name: "Nguyền",
      ready: true,
      connected: false,
      role: "CURSED",
      alive: true,
      cursedTurned: false,
    },
    players: [
      { id: "cursed", name: "Nguyền", alive: true, isBot: true },
      { id: "wolf", name: "Sói", alive: true, isBot: false },
      { id: "villager", name: "Dân", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", alive: true, isBot: false },
    ],
    night: null,
    hunterShot: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
    ...over,
  };
}

/** Snapshot của chính bot sau khi bị nguyền: engine đã đổi vai sang Ma Sói. */
function turnedView(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return botView({
    you: {
      id: "cursed",
      name: "Nguyền",
      ready: true,
      connected: false,
      role: "WEREWOLF",
      alive: true,
      cursedTurned: true,
    },
    players: [
      { id: "cursed", name: "Nguyền", alive: true, isBot: true, role: "WEREWOLF" },
      { id: "wolf", name: "Sói", alive: true, isBot: false, role: "WEREWOLF" },
      { id: "villager", name: "Dân", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", alive: true, isBot: false },
    ],
    night: nightInfo(),
    ...over,
  });
}

describe("Bot Kẻ Nguyền Rủa trước khi chuyển phe", () => {
  it("không có hành động đêm nên không sinh prompt đêm", () => {
    expect(soloNightAction("CURSED")).toBeNull();
    expect(buildNightPrompt(botView({ night: nightInfo() }))).toBeNull();
  });

  it("prompt ban ngày gọi đúng tên vai tiếng Việt", () => {
    const prompt = buildDayPrompt(botView({ phase: "DAY_DISCUSSION" }));
    expect(prompt?.user).toContain("Vai của bạn: Kẻ Nguyền Rủa.");
    expect(prompt?.user).not.toContain("CURSED");
  });

  it("được dặn không tiết lộ cơ chế nguyền rủa trong chat", () => {
    const prompt = buildDayPrompt(botView({ phase: "DAY_DISCUSSION" }));
    expect(prompt?.user).toMatch(/không.*(nói|tiết lộ).*nguyền/i);
  });
});

describe("Bot Ma Sói nhắm Kẻ Nguyền Rủa", () => {
  it("coi Kẻ Nguyền Rủa là mục tiêu cắn bình thường", () => {
    const wolfView = botView({
      you: {
        id: "wolf",
        name: "Sói",
        ready: true,
        connected: false,
        role: "WEREWOLF",
        alive: true,
      },
      players: [
        { id: "cursed", name: "Nguyền", alive: true, isBot: true },
        { id: "wolf", name: "Sói", alive: true, isBot: false, role: "WEREWOLF" },
        { id: "villager", name: "Dân", alive: true, isBot: false },
        { id: "seer", name: "Tiên Tri", alive: true, isBot: false },
      ],
      night: nightInfo(),
    });

    expect(legalNightTargets(wolfView, "KILL")).toContain("cursed");
  });
});

describe("Bot Kẻ Nguyền Rủa sau khi chuyển phe", () => {
  it("dùng logic Ma Sói từ đêm tiếp theo", () => {
    const view = turnedView();
    expect(soloNightAction(view.you?.role)).toBe("KILL");
    expect(legalNightTargets(view, "KILL").sort()).toEqual(["seer", "villager"]);
  });

  it("nhận prompt đêm của Ma Sói với đúng danh sách mục tiêu", () => {
    const prompt = buildNightPrompt(turnedView());
    expect(prompt?.user).toContain("Vai của bạn: Ma Sói.");
    expect(prompt?.schema.properties.targetId).toEqual({
      type: "string",
      enum: ["villager", "seer"],
    });
  });

  it("được nhắc giữ kín việc mình từng là Kẻ Nguyền Rủa", () => {
    const prompt = buildDayPrompt(turnedView({ phase: "DAY_DISCUSSION" }));
    expect(prompt?.user).toMatch(/không.*(nói|tiết lộ).*nguyền/i);
  });

  it("nộp được quyết định cắn hợp lệ qua interpretNight", () => {
    const outcome = interpretNight(
      turnedView(),
      { think: "cắn Tiên Tri", targetId: "seer" },
      () => undefined,
    );

    expect(outcome).toEqual({ ok: true, value: { action: "KILL", targetId: "seer" } });
  });

  it("không nhận mã vai thô CURSED trong prompt gửi provider", () => {
    const prompt = buildDayPrompt(turnedView({ phase: "DAY_DISCUSSION" }));
    expect(prompt?.user).not.toContain("CURSED");
    expect(prompt?.system).not.toContain("CURSED");
  });
});
