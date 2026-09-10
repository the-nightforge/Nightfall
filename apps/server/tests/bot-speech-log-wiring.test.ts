import { describe, expect, it, vi } from "vitest";
import { GameEngine, openQuestion, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));
vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));
vi.mock("../src/db", () => ({ prisma: {} }));

const { endVoting } = await import("../src/game/machine");
const { startBotSpeechLog } = await import("../src/game/bot-speech-log");

function votingRoom(): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: "VOTING",
    round: 1,
    phaseEndsAt: Date.now() + 30_000,
    players: [
      { id: "human1", name: "Người 1", role: "VILLAGER", alive: true, isBot: false },
      { id: "human2", name: "Người 2", role: "SEER", alive: true, isBot: false },
      { id: "bot", name: "Bot Sói", role: "WEREWOLF", alive: true, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      ...NIGHT_SCAFFOLD,
      killTarget: null,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    log: [],
  };
  return {
    ...ROOM_SCAFFOLD,
    code: "WIRED",
    hostId: "human1",
    status: "IN_GAME",
    members: [
      { playerId: "human1", name: "Người 1", ready: true, connected: true, isBot: false },
      { playerId: "human2", name: "Người 2", ready: true, connected: true, isBot: false },
      { playerId: "bot", name: "Bot Sói", ready: true, connected: false, isBot: true },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

describe("móc sổ vào luồng chơi", () => {
  it("endVoting chốt câu hỏi của ngày ngay trước khi chốt đề cử", () => {
    const room = votingRoom();
    startBotSpeechLog(room);
    openQuestion(room.questionLedger!, {
      messageId: "q",
      askerId: "human1",
      targetId: "bot",
      round: 1,
      humanAsker: true,
    });

    endVoting(room);

    expect(room.questionLedger!.open).toEqual([]);
    expect(room.speechLog).toEqual([
      expect.objectContaining({ kind: "QUESTION_OUTCOME", messageId: "q", outcome: "UNDETERMINED", humanAsker: true }),
    ]);
  });
});
