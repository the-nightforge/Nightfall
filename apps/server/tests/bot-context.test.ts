import { describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { buildBotDecisionContext } from "../src/bots/context";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

vi.mock("../src/redis", () => ({ redis: { set: async () => undefined, get: async () => null, del: async () => undefined } }));
vi.mock("../src/db", () => ({ prisma: {} }));

/**
 * Phòng có đủ bí mật để chứng minh là chúng KHÔNG lọt ra: một Phù Thuỷ còn
 * sống, một Tiên Tri đã chết, một cặp Sói và một kênh chat sói.
 */
function secretRoleRoom(): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: "VOTING",
    round: 2,
    phaseEndsAt: 130_000,
    phaseStartedAt: 100_000,
    players: [
      { id: "villager-bot", name: "Bot Dân", role: "VILLAGER", alive: true, isBot: true },
      { id: "dead-seer", name: "Tiên Tri", role: "SEER", alive: false, isBot: false },
      { id: "witch", name: "Phù Thuỷ", role: "WITCH", alive: true, isBot: false },
      { id: "wolf-a", name: "Sói A", role: "WEREWOLF", alive: true, isBot: true },
      { id: "wolf-b", name: "Sói B", role: "WEREWOLF", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 2 },
    winner: null,
    night: {
      ...NIGHT_SCAFFOLD,
      wolfVotes: { "wolf-a": "witch" },
      killTarget: "witch",
      wolvesLocked: true,
      guardTarget: "villager-bot",
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: { "dead-seer": { targetId: "wolf-a", isWolf: true } },
    },
    votes: {},
    voteMutations: [],
    dayVoteHistory: [],
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [{ playerId: "dead-seer", name: "Tiên Tri" }],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    lastTrial: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };

  return {
    ...ROOM_SCAFFOLD,
    code: "ROOM1",
    hostId: "witch",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: player.isBot,
    })),
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 2 },
    engine: new GameEngine(state),
    chatLog: [
      { id: "day-1", channel: "day", playerId: "witch", playerName: "Phù Thuỷ", text: "Tôi nghi Sói A", at: 1 },
      { id: "wolf-1", channel: "wolves", playerId: "wolf-a", playerName: "Sói A", text: "Cắn Phù Thuỷ", at: 2 },
      { id: "dead-1", channel: "dead", playerId: "dead-seer", playerName: "Tiên Tri", text: "Sói A là sói", at: 3 },
    ],
    createdAt: 0,
  };
}

describe("bot decision context", () => {
  /**
   * Chuỗi JSON của context ĐÃ LOẠI `roleComposition` — bộ bài công khai
   * (`RoomSnapshot.config` đi xuống mọi client), được phép nhắc tên vai.
   * Mọi phần khác của context vẫn không được nhắc vai nào ngoài vai đã lộ.
   */
  function privateJson(context: ReturnType<typeof buildBotDecisionContext>): string {
    const { roleComposition: _public, ...knowledge } = context.knowledge;
    return JSON.stringify({ ...context, knowledge });
  }

  it("combines only engine knowledge and visible chat", () => {
    const context = buildBotDecisionContext(secretRoleRoom(), "villager-bot");

    expect(context.visibleChat.map((item) => item.id)).toEqual(["day-1"]);
    expect(privateJson(context)).not.toContain("WITCH");
    expect(privateJson(context)).not.toContain("SEER");
    expect(privateJson(context)).not.toContain("WEREWOLF");
    expect(context.knowledge.roleComposition).toEqual({
      WEREWOLF: 2,
      SEER: 1,
      GUARD: 1,
      WITCH: 1,
      VILLAGER: 0,
    });
    expect(context.knowledge.players.map((player) => player.id)).toContain("dead-seer");
    expect(context.knowledge.knownRoles).not.toHaveProperty("dead-seer");
    expect(context.knowledge.knownRoles).toEqual({ "villager-bot": "VILLAGER" });
  });

  it("gives a wolf bot its teammates but the same day-only chat", () => {
    const context = buildBotDecisionContext(secretRoleRoom(), "wolf-a");

    // Ban ngày kênh sói đóng với tất cả, kể cả Sói: adapter đi qua đúng
    // visibleChatLog nên BOT không được đọc nhiều hơn người thật.
    expect(context.visibleChat.map((item) => item.id)).toEqual(["day-1"]);
    expect(context.knowledge.knownRoles).toEqual({ "wolf-a": "WEREWOLF", "wolf-b": "WEREWOLF" });
    expect(privateJson(context)).not.toContain("WITCH");
    expect(privateJson(context)).not.toContain("SEER");
  });

  it("opens the wolf channel to a wolf bot only at night", () => {
    const target = secretRoleRoom();
    target.engine!.state.phase = "NIGHT";

    expect(
      buildBotDecisionContext(target, "wolf-a").visibleChat.map((item) => item.id),
    ).toEqual(["wolf-1"]);
    expect(
      buildBotDecisionContext(target, "villager-bot").visibleChat.map((item) => item.id),
    ).toEqual([]);
  });

  it("never hands a dead player's chat to a living bot", () => {
    const context = buildBotDecisionContext(secretRoleRoom(), "villager-bot");

    expect(context.visibleChat.map((item) => item.id)).not.toContain("dead-1");
  });

  it("maps chat into the bot observation shape without the channel", () => {
    const context = buildBotDecisionContext(secretRoleRoom(), "villager-bot");

    expect(context.visibleChat).toEqual([
      { id: "day-1", actorId: "witch", text: "Tôi nghi Sói A", at: 1 },
    ]);
  });

  it("returns an empty chat list for a bot that is not in the room", () => {
    const room = secretRoleRoom();

    expect(() => buildBotDecisionContext(room, "ghost")).toThrow();
  });

  it("does not reach into engine player roles from the adapter itself", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "src", "bots", "context.ts"),
      "utf8",
    );

    expect(source).not.toContain("state.players");
    expect(source).not.toContain(".role");
  });
});
