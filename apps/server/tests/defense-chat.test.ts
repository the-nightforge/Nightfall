import { describe, expect, it } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type ChatMessage } from "@masoi/shared";
import { resolveChat, visibleChatLog } from "../src/rooms/snapshot";
import type { Room } from "../src/rooms/store";

const messages: ChatMessage[] = [
  { id: "day", channel: "day", playerId: "villager", playerName: "Dân", text: "day", at: 1 },
  { id: "dead", channel: "dead", playerId: "dead", playerName: "Ma", text: "dead", at: 2 },
];

/** Phòng đang xử phiên toà với "accused" là bị cáo. */
function trialRoom(phase: "DEFENSE" | "FINAL_VOTE"): Room {
  const state: GameState = {
    phase,
    round: 1,
    phaseEndsAt: null,
    players: [
      { id: "accused", name: "Bị Cáo", role: "VILLAGER", alive: true, isBot: false },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true, isBot: false },
      { id: "villager", name: "Dân", role: "VILLAGER", alive: true, isBot: false },
      { id: "dead", name: "Ma", role: "SEER", alive: false, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      wolfVotes: {},
      killTarget: null,
      wolvesLocked: false,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: { wolf: "accused", villager: "accused" },
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    trial: { accusedId: "accused", finalVotes: {} },
    lastTrial: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };

  return {
    code: "TRIAL",
    hostId: "wolf",
    status: "IN_GAME",
    members: state.players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      isBot: false,
    })),
    config: state.config,
    engine: new GameEngine(state),
    chatLog: [...messages],
    createdAt: Date.now(),
  };
}

describe("Chat trong phiên toà", () => {
  it("chỉ bị cáo được nói trong pha biện hộ", () => {
    const room = trialRoom("DEFENSE");
    expect(resolveChat(room, "accused")).toMatchObject({ ok: true, channel: "day" });
    expect(resolveChat(room, "wolf")).toEqual({
      ok: false,
      error: "Chỉ người đang biện hộ được nói",
    });
    expect(resolveChat(room, "villager")).toEqual({
      ok: false,
      error: "Chỉ người đang biện hộ được nói",
    });
  });

  it("người chết vẫn chat kênh dead trong lúc biện hộ", () => {
    const room = trialRoom("DEFENSE");
    // Nhánh người chết nằm trước cổng biện hộ, nên khoá kia không chạm tới họ.
    expect(resolveChat(room, "dead")).toMatchObject({ ok: true, channel: "dead" });
  });

  it("lời biện hộ tới được mọi người sống và cả khán giả đã chết", () => {
    const room = trialRoom("DEFENSE");
    const resolved = resolveChat(room, "accused");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.recipients).toEqual(
      expect.arrayContaining(["accused", "wolf", "villager", "dead"]),
    );
  });

  it("mọi người nói lại được ở pha bỏ phiếu xác nhận", () => {
    const room = trialRoom("FINAL_VOTE");
    for (const id of ["accused", "wolf", "villager"]) {
      expect(resolveChat(room, id)).toMatchObject({ ok: true, channel: "day" });
    }
  });

  it("cả hai pha đều đọc được lịch sử kênh day", () => {
    for (const phase of ["DEFENSE", "FINAL_VOTE"] as const) {
      const room = trialRoom(phase);
      expect(visibleChatLog(room, "villager").map((m) => m.channel)).toEqual(["day"]);
    }
  });
});
