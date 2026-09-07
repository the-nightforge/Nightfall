import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine, type GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { scheduleVoteBots } from "../src/game/machine";
import { DISCONNECT_GRACE_MS } from "../src/game/discussion-skip";
import { ROOM_SCAFFOLD } from "./helpers/room";
import { NIGHT_SCAFFOLD } from "./helpers/night";
import { GAME_STATE_SCAFFOLD } from "./helpers/game-state";

const brainControl = vi.hoisted(() => ({ renderDaySpeech: vi.fn() }));

/**
 * Runtime giả để điều khiển thứ tự quyết định. Test này kiểm tra ĐƯỜNG ĐI của
 * phiếu (ai hỏi ai, nộp mấy lần), không kiểm tra chất lượng quyết định - phần
 * đó thuộc về packages/game-engine/tests/bot-runtime.test.ts.
 */
const runtimeControl = vi.hoisted(() => ({
  decideVote: vi.fn(),
  observe: vi.fn(),
  rngValues: [0, 0, 0] as number[],
}));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void, ms: number) => setTimeout(fn, ms),
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/db", () => ({ prisma: {} }));

vi.mock("../src/bots/session-registry", () => {
  const runtime = {
    state: { playerId: "bot", speechMemory: [] as Array<{ sourceIds: string[]; round: number }> },
    observe: runtimeControl.observe,
    decideVote: runtimeControl.decideVote,
    decideSpeech: () => null,
    recordSpeech: () => undefined,
  };
  let cursor = 0;
  return {
    botSessionFor: () => ({
      runtimeFor: () => runtime,
      rngFor: () => () => runtimeControl.rngValues[cursor++ % runtimeControl.rngValues.length],
    }),
    startBotSession: () => undefined,
    clearBotSession: () => undefined,
  };
});

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({
      name: "should-never-be-asked-for-a-target",
      renderDaySpeech: brainControl.renderDaySpeech,
    }),
  };
});

const vote = (targetId: string) => ({
  kind: "VOTE" as const,
  choice: { type: "PLAYER" as const, targetId },
  confidence: 0.9,
  evidence: [],
});

const noElimination = {
  kind: "VOTE" as const,
  choice: { type: "NO_ELIMINATION" as const },
  confidence: 0.3,
  evidence: [],
};

function votingRoom(): Room {
  const state: GameState = {
    ...GAME_STATE_SCAFFOLD,
    phase: "VOTING",
    round: 1,
    phaseEndsAt: 30_000,
    phaseStartedAt: 0,
    players: [
      { id: "bot", name: "Bot", role: "VILLAGER", alive: true, isBot: true },
      { id: "b", name: "Bình", role: "SEER", alive: true, isBot: false },
      { id: "c", name: "Chi", role: "WEREWOLF", alive: true, isBot: false },
    ],
    config: { ...DEFAULT_ROOM_CONFIG },
    winner: null,
    night: {
      ...NIGHT_SCAFFOLD,
      wolfVotes: {},
      killTarget: null,
      wolvesLocked: false,
      guardTarget: null,
      healTonight: false,
      poisonTarget: null,
      witchSkipped: false,
      seerResults: {},
    },
    votes: {},
    voteMutations: [],
    dayVoteHistory: [],
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

  return {
    ...ROOM_SCAFFOLD,
    code: "VOTE1",
    hostId: "b",
    status: "IN_GAME",
    members: state.players.map((player) => ({
      playerId: player.id,
      name: player.name,
      ready: true,
      connected: true,
      isBot: player.isBot,
    })),
    config: { ...DEFAULT_ROOM_CONFIG },
    engine: new GameEngine(state),
    chatLog: [],
    createdAt: 0,
  };
}

/** Ba mốc rải trong khung, nên đẩy qua trọn khung là chạy hết cả ba. */
async function runWholeVotingWindow(room: Room): Promise<void> {
  await vi.advanceTimersByTimeAsync(room.config.voteSeconds * 1_000);
}

describe("scheduleVoteBots", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Gốc thời gian 0: scaffold đặt phaseStartedAt 0 / phaseEndsAt 30_000, nên
    // `phaseEndsAt - Date.now()` chỉ có nghĩa khi đồng hồ bắt đầu từ 0 - đúng
    // như production, nơi `setPhase` đặt `phaseEndsAt = now + duration`.
    vi.setSystemTime(0);
    brainControl.renderDaySpeech.mockReset();
    runtimeControl.observe.mockReset();
    runtimeControl.decideVote.mockReset();
    runtimeControl.rngValues = [0, 0, 0];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nộp lựa chọn của runtime mà không hỏi nhà cung cấp lấy mục tiêu", async () => {
    const room = votingRoom();
    runtimeControl.decideVote.mockReturnValue(vote("c"));

    scheduleVoteBots(room);
    await runWholeVotingWindow(room);

    expect(room.engine!.state.voteMutations.length).toBeGreaterThan(0);
    expect(room.engine!.state.votes.bot).toBe("c");
    // Ban ngày nhà cung cấp chỉ được diễn đạt. Một lời gọi ở đây nghĩa là mục
    // tiêu lại đang đi qua LLM.
    expect(brainControl.renderDaySpeech).not.toHaveBeenCalled();
  });

  it("đổi phiếu ở mốc sau và không bao giờ nộp trùng cùng một lựa chọn", async () => {
    const room = votingRoom();
    runtimeControl.decideVote
      .mockReturnValueOnce(vote("b"))
      .mockReturnValueOnce(vote("c"))
      .mockReturnValueOnce(vote("c"));

    scheduleVoteBots(room);
    await runWholeVotingWindow(room);

    expect(room.engine!.state.voteMutations.map((item) => item.choice)).toEqual([
      { type: "PLAYER", targetId: "b" },
      { type: "PLAYER", targetId: "c" },
    ]);
  });

  it("ghi lại được cả lần đổi sang không treo ai", async () => {
    const room = votingRoom();
    runtimeControl.decideVote
      .mockReturnValueOnce(vote("b"))
      .mockReturnValueOnce(noElimination)
      .mockReturnValueOnce(noElimination);

    scheduleVoteBots(room);
    await runWholeVotingWindow(room);

    expect(room.engine!.state.votes.bot).toBeNull();
    expect(room.engine!.voteTally().noElimination).toBe(1);
  });

  it("hỏi lại lõi ở đúng hai mốc, tất cả nằm trong khung bỏ phiếu", async () => {
    const room = votingRoom();
    runtimeControl.decideVote.mockReturnValue(vote("c"));

    scheduleVoteBots(room);
    await runWholeVotingWindow(room);

    // Hai mốc: sớm để bảng phiếu có gì đó cho người thật đọc, và sát giờ để
    // chốt sau khi đã nghe gần hết cuộc bàn. Một lá phiếu, một lần đổi ý.
    expect(runtimeControl.decideVote).toHaveBeenCalledTimes(2);
    expect(runtimeControl.observe).toHaveBeenCalledTimes(2);
  });

  it("mốc luôn nằm trong khung và không mốc nào rơi vào lúc pha vừa mở", async () => {
    const room = votingRoom();
    runtimeControl.decideVote.mockReturnValue(vote("c"));

    scheduleVoteBots(room);
    // rng trả 0 nên mốc là 12% và 84% khung: không mốc nào ở t=0.
    await vi.advanceTimersByTimeAsync(0);
    expect(runtimeControl.decideVote).not.toHaveBeenCalled();

    await runWholeVotingWindow(room);
    expect(runtimeControl.decideVote).toHaveBeenCalledTimes(2);
  });

  it("bỏ qua mốc khi pha đã đổi, không nộp phiếu muộn", async () => {
    const room = votingRoom();
    runtimeControl.decideVote.mockReturnValue(vote("c"));

    scheduleVoteBots(room);
    room.engine!.setPhase("DEFENSE", 30_000);
    await runWholeVotingWindow(room);

    expect(room.engine!.state.voteMutations).toEqual([]);
    expect(runtimeControl.decideVote).not.toHaveBeenCalled();
  });

  it("không xếp lịch cho người thật", async () => {
    const room = votingRoom();
    room.members = room.members.filter((member) => !member.isBot);
    runtimeControl.decideVote.mockReturnValue(vote("c"));

    scheduleVoteBots(room);
    await runWholeVotingWindow(room);

    expect(runtimeControl.decideVote).not.toHaveBeenCalled();
  });
});

describe("ghế bị bỏ giữa ván", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Gốc thời gian 0: scaffold đặt phaseStartedAt 0 / phaseEndsAt 30_000, nên
    // `phaseEndsAt - Date.now()` chỉ có nghĩa khi đồng hồ bắt đầu từ 0 - đúng
    // như production, nơi `setPhase` đặt `phaseEndsAt = now + duration`.
    vi.setSystemTime(0);
    runtimeControl.observe.mockReset();
    runtimeControl.decideVote.mockReset();
    runtimeControl.rngValues = [0, 0, 0];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Đánh dấu một ghế người đã rớt được `ms` mili giây. */
  function dropped(room: Room, playerId: string, ms: number): void {
    const member = room.members.find((m) => m.playerId === playerId)!;
    member.connected = false;
    member.disconnectedAt = Date.now() - ms;
  }

  it("người rớt quá ân hạn thì máy bỏ phiếu thay", async () => {
    const room = votingRoom();
    dropped(room, "b", DISCONNECT_GRACE_MS + 1);
    runtimeControl.decideVote.mockReturnValue(vote("c"));

    scheduleVoteBots(room);
    await runWholeVotingWindow(room);

    expect(room.engine!.state.votes.b).toBe("c");
  });

  it("người còn trong ân hạn thì không ai đụng vào ghế", async () => {
    const room = votingRoom();
    dropped(room, "b", DISCONNECT_GRACE_MS - 1_000);
    runtimeControl.decideVote.mockReturnValue(vote("c"));

    scheduleVoteBots(room);
    await runWholeVotingWindow(room);

    expect(room.engine!.state.votes.b).toBeUndefined();
  });

  it("quay lại trước khi mốc hẹn nổ thì lấy lại ghế", async () => {
    const room = votingRoom();
    dropped(room, "b", DISCONNECT_GRACE_MS + 1);
    runtimeControl.decideVote.mockReturnValue(vote("c"));

    scheduleVoteBots(room);
    const member = room.members.find((m) => m.playerId === "b")!;
    member.connected = true;
    member.disconnectedAt = null;
    await runWholeVotingWindow(room);

    expect(room.engine!.state.votes.b).toBeUndefined();
  });
});

/**
 * Hai luật của lá phiếu bot: không đổi ở 5 giây chót, và không quá 3 lá.
 *
 * Cả hai đều là luật về ĐƯỜNG ĐI của phiếu chứ không về chất lượng quyết định,
 * nên chúng thuộc file này.
 */
describe("trần đổi phiếu của bot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    runtimeControl.observe.mockReset();
    runtimeControl.decideVote.mockReset();
    runtimeControl.rngValues = [0, 0, 0];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("không hỏi lõi trong 5 giây cuối khung", async () => {
    const room = votingRoom();
    runtimeControl.decideVote.mockReturnValue(vote("c"));

    scheduleVoteBots(room);

    // Khung 30s; 5 giây chót là từ giây 25 trở đi.
    await vi.advanceTimersByTimeAsync(25_000);
    const truocKhiKhoa = runtimeControl.decideVote.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(runtimeControl.decideVote.mock.calls.length).toBe(truocKhiKhoa);
  });

  it("vẫn giữ đủ hai mốc, chỉ dồn vào phần khung được phép", async () => {
    const room = votingRoom();
    runtimeControl.decideVote.mockReturnValue(vote("c"));

    scheduleVoteBots(room);
    await vi.advanceTimersByTimeAsync(25_000);

    expect(runtimeControl.decideVote).toHaveBeenCalledTimes(2);
  });

  it("không nộp quá hai lá trong một vòng dù lịch bị cấp hai lần", async () => {
    const room = votingRoom();
    // Xen kẽ để mỗi lần nộp đều là một thay đổi thật - lá trùng bị engine nuốt.
    runtimeControl.decideVote
      .mockReturnValueOnce(vote("b"))
      .mockReturnValueOnce(vote("c"))
      .mockReturnValueOnce(vote("b"))
      .mockReturnValueOnce(vote("c"))
      .mockReturnValueOnce(vote("b"))
      .mockReturnValueOnce(vote("c"));

    // Đường resume: server sống lại giữa pha và cấp lại trọn bộ mốc.
    scheduleVoteBots(room);
    scheduleVoteBots(room);
    await runWholeVotingWindow(room);

    const cuaBot = room.engine!.state.voteMutations.filter((item) => item.voterId === "bot");
    expect(cuaBot.length).toBeLessThanOrEqual(2);
  });
});
