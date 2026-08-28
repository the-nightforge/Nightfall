import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_CONFIG, type NightActionView, type RoomSnapshot } from "@masoi/shared";
import { legalNightTargets, soloNightAction } from "../src/bots/targets";
import { buildDaySpeechPrompt, buildNightPrompt, personaFor } from "../src/bots/prompt";
import { interpretNight } from "../src/bots/decide";
import type { SpeechRequest } from "../src/bots/types";

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
    serverNow: 0,
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

/**
 * Yêu cầu diễn đạt ban ngày của chính bot Kẻ Nguyền Rủa.
 *
 * Ban ngày không còn đi qua snapshot: lõi deterministic chốt mục tiêu, còn nhà
 * cung cấp chỉ nhận đúng ý định và bằng chứng. Vai không nằm trong hình dạng
 * này, nên bí mật của Kẻ Nguyền Rủa được giữ bởi kiểu dữ liệu chứ không phải
 * bởi một câu dặn dò mà model có thể phớt lờ.
 */
function cursedSpeechRequest(over: Partial<SpeechRequest> = {}): SpeechRequest {
  return {
    roomCode: "CURSE",
    speaker: { id: "cursed", name: "Nguyền" },
    personalityStyle: personaFor("cursed"),
    intention: {
      kind: "ACCUSE",
      targetId: "villager",
      confidence: 0.7,
      evidence: [
        {
          id: "ev-1",
          kind: "BANDWAGON",
          sourceId: "2:nomination:3",
          actorId: "villager",
          targetId: "seer",
          weight: 4,
          confidence: 0.5,
          round: 2,
          summary: "nhảy vào phiếu đang dẫn ngay khi nó dẫn",
        },
      ],
    },
    evidence: [{ sourceId: "2:nomination:3", summary: "nhảy vào phiếu đang dẫn ngay khi nó dẫn" }],
    targetName: "Dân",
    recentSpeechSourceIds: [],
    ...over,
  };
}

describe("Bot Kẻ Nguyền Rủa trước khi chuyển phe", () => {
  it("không có hành động đêm nên không sinh prompt đêm", () => {
    expect(soloNightAction("CURSED")).toBeNull();
    expect(buildNightPrompt(botView({ night: nightInfo() }))).toBeNull();
  });

  it("không thể tiết lộ cơ chế nguyền rủa vì prompt ngày không mang vai", () => {
    const prompt = buildDaySpeechPrompt(cursedSpeechRequest());
    const text = `${prompt.system}\n${prompt.user}`;

    expect(text).not.toContain("CURSED");
    expect(text).not.toContain("Kẻ Nguyền Rủa");
    // "Nguyền" trần là TÊN của chính bot và vẫn phải xuất hiện; thứ không được
    // lộ là cơ chế, nên assert bám vào cụm mô tả cơ chế.
    expect(text).not.toMatch(/nguyền rủa|bị nguyền|hoá thành Ma Sói/i);
    expect(text).not.toContain("Vai của bạn");
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

  it("nộp được quyết định cắn hợp lệ qua interpretNight", () => {
    const outcome = interpretNight(
      turnedView(),
      { think: "cắn Tiên Tri", targetId: "seer" },
      () => undefined,
    );

    expect(outcome).toEqual({ ok: true, value: { action: "KILL", targetId: "seer" } });
  });

  it("không nhận mã vai thô CURSED trong prompt đêm gửi provider", () => {
    const prompt = buildNightPrompt(turnedView());
    expect(prompt?.user).not.toContain("CURSED");
    expect(prompt?.system).not.toContain("CURSED");
  });

  it("prompt ngày vẫn không mang theo việc mình từng bị nguyền", () => {
    const prompt = buildDaySpeechPrompt(cursedSpeechRequest());

    expect(`${prompt.system}\n${prompt.user}`).not.toMatch(
      /nguyền rủa|bị nguyền|từng là|phe Ma Sói/i,
    );
  });
});
