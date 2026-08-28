import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

const storeMocks = vi.hoisted(() => {
  const rooms = new Map<string, Room>();
  const timers: NodeJS.Timeout[] = [];
  return {
    rooms,
    timers,
    persistRoom: vi.fn(async () => undefined),
  };
});

vi.mock("../src/rooms/store", () => ({
  allRooms: () => [...storeMocks.rooms.values()],
  clearRoomTimers: () => {
    for (const timer of storeMocks.timers) clearTimeout(timer);
    storeMocks.timers.length = 0;
  },
  getRoom: (code: string) => storeMocks.rooms.get(code),
  loadRoomFromRedis: async () => null,
  persistRoom: storeMocks.persistRoom,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => {
    storeMocks.timers.push(setTimeout(fn, ms));
  },
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
  trackSocket: () => undefined,
  untrackSocket: () => undefined,
}));

vi.mock("../src/db", () => ({
  prisma: { gameResult: { create: vi.fn(async () => undefined) } },
}));

import { maybeEndFinalVoteEarly, maybeEndVotingEarly } from "../src/game/machine";
import { pendingEndFinalVote, pendingEndVote } from "../src/game/bot-room-state";

const CONFIG = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 1,
  seer: false,
  guard: false,
  witch: false,
  discussionSeconds: 30,
  voteSeconds: 15,
  defenseSeconds: 25,
  finalVoteSeconds: 20,
};

/**
 * Phòng đang ở pha VOTING với phiếu sơ bộ đã điền sẵn. Toàn người thật để không
 * lượt bot nào xen vào; nhánh bot có bộ test riêng.
 */
function votingRoom(votes: Record<string, string | null>, hunterId?: string): Room {
  const state: GameState = {
    phase: "VOTING",
    round: 1,
    phaseEndsAt: Date.now() + CONFIG.voteSeconds * 1000,
    players: [
      { id: "p1", name: "Một", role: "WEREWOLF", alive: true, isBot: false },
      { id: "p2", name: "Hai", role: "VILLAGER", alive: true, isBot: false },
      { id: "p3", name: "Ba", role: "VILLAGER", alive: true, isBot: false },
      { id: "p4", name: "Bốn", role: "VILLAGER", alive: true, isBot: false },
      { id: "p5", name: "Năm", role: "VILLAGER", alive: true, isBot: false },
      { id: "p6", name: "Sáu", role: "VILLAGER", alive: true, isBot: false },
    ],
    config: { ...CONFIG, hunter: hunterId !== undefined },
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
    votes,
    guardPrevious: null,
    healUsed: false,
    poisonUsed: false,
    lastNightDeaths: [],
    nightHistory: [],
    lastEliminated: null,
    trial: null,
    lastTrial: null,
    hunterReaction: null,
    hunterShots: [],
    log: [],
  };
  if (hunterId) state.players.find((p) => p.id === hunterId)!.role = "HUNTER";

  const room: Room = {
    code: "TRIAL",
    hostId: "p1",
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
    chatLog: [],
    createdAt: Date.now(),
  };
  storeMocks.rooms.set(room.code, room);
  return room;
}

/** Đẩy đồng hồ tới hết pha hiện tại rồi để timer của machine chạy. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

/**
 * Chốt vote sơ bộ. Phòng test bắt đầu thẳng ở VOTING nên chưa có timer nào của
 * beginVoting; đi qua đường kết thúc sớm là cách duy nhất khởi động chuỗi mà
 * không phải chạy lại cả một đêm.
 */
async function closeNomination(room: Room) {
  maybeEndVotingEarly(room);
  await advance(1_000);
}

/** p2 dẫn 3 phiếu; ba người còn lại rải mỗi người một phiếu khác nhau. */
const NOMINATE_P2 = { p1: "p2", p2: "p1", p3: "p2", p4: "p2", p5: "p3", p6: "p4" };

const DEFENSE_END = CONFIG.defenseSeconds * 1000 + 600;
const FINAL_VOTE_END = CONFIG.finalVoteSeconds * 1000 + 600;
const RESULT_END = 8_600;

beforeEach(() => {
  vi.useFakeTimers();
  storeMocks.rooms.clear();
  storeMocks.timers.length = 0;
  // Hai cờ này sống theo mã phòng ngoài phạm vi một ván; không dọn thì test thứ
  // hai trở đi thấy cờ đã bật và bỏ qua mốc chốt sớm.
  pendingEndVote.clear();
  pendingEndFinalVote.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("Luồng phiên toà", () => {
  it("dẫn phiếu duy nhất đi VOTING -> DEFENSE -> FINAL_VOTE", async () => {
    const room = votingRoom({ p1: "p2", p2: "p1", p3: "p2", p4: "p2", p5: "p6", p6: "p5" });

    await closeNomination(room);
    expect(room.engine!.state.phase).toBe("DEFENSE");
    expect(room.engine!.state.trial?.accusedId).toBe("p2");
    // Vote sơ bộ không giết ai.
    expect(room.engine!.state.players.find((p) => p.id === "p2")!.alive).toBe(true);

    await advance(DEFENSE_END);
    expect(room.engine!.state.phase).toBe("FINAL_VOTE");
  });

  it("hoà phiếu sơ bộ bỏ qua phiên toà và về thẳng đêm", async () => {
    const room = votingRoom({ p1: "p2", p2: "p1", p3: "p4", p4: "p3", p5: "p6", p6: "p5" });

    await closeNomination(room);
    expect(room.engine!.state.phase).toBe("ELIMINATION");
    expect(room.engine!.state.trial).toBeNull();

    await advance(RESULT_END);
    expect(room.engine!.state.phase).toBe("NIGHT");
  });

  it("'không treo ai' thắng cũng bỏ qua phiên toà", async () => {
    const room = votingRoom({ p1: null, p2: null, p3: null, p4: "p5", p5: "p4", p6: "p1" });

    await closeNomination(room);
    expect(room.engine!.state.phase).toBe("ELIMINATION");
    expect(room.engine!.state.trial).toBeNull();
  });

  it("đủ phiếu Treo thì giết bị cáo rồi vào đêm", async () => {
    const room = votingRoom(NOMINATE_P2);
    await closeNomination(room);
    await advance(DEFENSE_END);
    expect(room.engine!.state.phase).toBe("FINAL_VOTE");

    // 6 sống, bị cáo p2 -> 5 cử tri -> cần 3 phiếu Treo.
    for (const id of ["p1", "p3", "p4"]) room.engine!.submitFinalVote(id, true);
    await advance(FINAL_VOTE_END);

    expect(room.engine!.state.phase).toBe("ELIMINATION");
    expect(room.engine!.state.players.find((p) => p.id === "p2")!.alive).toBe(false);
    expect(room.engine!.state.lastTrial?.lynched).toBe(true);

    await advance(RESULT_END);
    expect(room.engine!.state.phase).toBe("NIGHT");
  });

  it("thiếu phiếu Treo thì tha, bị cáo sống tiếp sang đêm", async () => {
    const room = votingRoom(NOMINATE_P2);
    await closeNomination(room);
    await advance(DEFENSE_END);

    room.engine!.submitFinalVote("p1", true);
    room.engine!.submitFinalVote("p3", false);
    await advance(FINAL_VOTE_END);

    expect(room.engine!.state.players.find((p) => p.id === "p2")!.alive).toBe(true);
    expect(room.engine!.state.lastTrial).toMatchObject({ lynched: false, abstain: 3 });

    await advance(RESULT_END);
    expect(room.engine!.state.phase).toBe("NIGHT");
  });

  it("treo Thợ Săn thì qua HUNTER_SHOT trước khi vào đêm", async () => {
    const room = votingRoom(NOMINATE_P2, "p2");
    await closeNomination(room);
    await advance(DEFENSE_END);
    for (const id of ["p1", "p3", "p4"]) room.engine!.submitFinalVote(id, true);
    await advance(FINAL_VOTE_END + RESULT_END);

    expect(room.engine!.state.phase).toBe("HUNTER_SHOT");
  });

  it("mọi cử tri đã bỏ phiếu thì chốt sớm, không chờ hết giờ", async () => {
    const room = votingRoom(NOMINATE_P2);
    await closeNomination(room);
    await advance(DEFENSE_END);

    for (const id of ["p1", "p3", "p4", "p5", "p6"]) {
      room.engine!.submitFinalVote(id, true);
    }
    maybeEndFinalVoteEarly(room);
    await advance(1_000);

    expect(room.engine!.state.phase).toBe("ELIMINATION");
  });
});
