import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type ChatMessage } from "@masoi/shared";
import type { Attempt, DaySpeechDecision, SpeechRequest } from "../src/bots/types";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

/**
 * BOT Kẻ Báo Thù trên ĐƯỜNG THẬT của server.
 *
 * Self-play chạy lõi quyết định trực tiếp; nó không đi qua scheduler và không
 * đi qua pha DEFENSE. Với vai này, cả hai tầng đó đúng là chỗ có thể hỏng theo
 * kiểu im lặng: một lá phiếu không được nộp, hoặc một lượt bào chữa nhận nhầm
 * chỉ thị của Thằng Hề. Bài này đi qua cả hai, chỉ thay nhà cung cấp LLM.
 */

const brainControl = vi.hoisted(() => ({
  requests: [] as SpeechRequest[],
  /** `null` nghĩa là nhà cung cấp hỏng - đường lui bảng mẫu phải gánh. */
  reply: null as string | null,
}));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    botBrain: () => ({
      name: "test",
      renderDaySpeech: async (request: SpeechRequest): Promise<Attempt<DaySpeechDecision>> => {
        brainControl.requests.push(request);
        if (brainControl.reply === null) return { ok: false };
        return { ok: true, value: { chat: brainControl.reply } };
      },
    }),
  };
});

const timers = vi.hoisted(() => ({ queued: [] as Array<() => void> }));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void) => {
    timers.queued.push(fn);
  },
}));

function drainTimers(): void {
  const pending = timers.queued.splice(0, timers.queued.length);
  for (const run of pending) run();
}

const broadcast = vi.hoisted(() => ({ chats: [] as ChatMessage[] }));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: (_ids: string[], _event: string, message: ChatMessage) => {
    broadcast.chats.push(message);
  },
}));

vi.mock("../src/db", () => ({ prisma: {} }));

const machine = await import("../src/game/machine");
const { armStep, runPendingStep } = await import("../src/game/steps");
const { clearBotSession, startBotSession } = await import("../src/bots/session-registry");

const CODES = ["EXB01", "EXB02", "EXB03", "EXB04"];

/** Bàn 6 người: `p2` là BOT Kẻ Báo Thù, mục tiêu là `p4`. */
function executionerRoom(code: string, options: { turned?: boolean } = {}): Room {
  const players = [
    { id: "p1", name: "Người 1", isBot: false },
    { id: "p2", name: "Báo Thù", isBot: true },
    { id: "p3", name: "Người 3", isBot: false },
    { id: "p4", name: "Người 4", isBot: false },
    { id: "p5", name: "Người 5", isBot: false },
    { id: "p6", name: "Người 6", isBot: false },
  ];
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1, executioner: true };
  const engine = GameEngine.create(players, config, 1_000);
  engine.state.players[0].role = "WEREWOLF";
  engine.state.players[1].role = options.turned ? "JESTER" : "EXECUTIONER";
  engine.state.players[1].executionerTurned = options.turned === true;
  for (const player of engine.state.players.slice(2)) player.role = "VILLAGER";
  engine.state.executionerTargets = { p2: "p4" };

  const room: Room = {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "IN_GAME",
    members: players.map((p) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: p.isBot,
      avatarUrl: null,
    })),
    config,
    engine,
    chatLog: [],
    createdAt: 1_000,
    gameId: "g1",
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };

  clearBotSession(code);
  startBotSession(room);
  return room;
}

beforeEach(() => {
  brainControl.requests.length = 0;
  brainControl.reply = null;
  broadcast.chats.length = 0;
  timers.queued.length = 0;
});

afterEach(() => {
  for (const code of CODES) clearBotSession(code);
});

describe("lá phiếu của BOT Kẻ Báo Thù đi qua scheduler thật", () => {
  it("dồn phiếu vào MỤC TIÊU của mình", () => {
    const room = executionerRoom("EXB01");
    room.engine!.state.round = 2;
    room.engine!.setPhase("VOTING", 30_000, 2_000);

    machine.scheduleVoteBots(room);
    drainTimers();

    expect(room.engine!.state.votes.p2).toBe("p4");
  });

  it("sau khi hoá Thằng Hề thì KHÔNG còn săn mục tiêu cũ", () => {
    /*
     * Không có cờ nào phải xoá và không có quyết định đang chờ nào phải huỷ:
     * `strategyFor` tra theo vai HIỆN TẠI, nên lượt kế tiếp đã chạy bằng chiến
     * thuật của Thằng Hề. Bài này khoá đúng điều đó ở tầng server, nơi lá phiếu
     * thật sự được nộp.
     */
    const room = executionerRoom("EXB02", { turned: true });
    room.engine!.state.round = 2;
    room.engine!.setPhase("VOTING", 30_000, 2_000);

    machine.scheduleVoteBots(room);
    drainTimers();

    expect(room.engine!.state.votes.p2).not.toBe("p4");
  });
});

describe("lượt tự bào chữa của BOT Kẻ Báo Thù", () => {
  async function runDefense(room: Room): Promise<void> {
    room.engine!.state.round = 2;
    room.engine!.setPhase("VOTING", 30_000, 2_000);
    for (const voter of room.engine!.alivePlayers()) {
      if (voter.id !== "p2") room.engine!.submitVote(voter.id, "p2", 3_000);
    }
    armStep(room, { name: "endVoting" }, 0);
    // Bỏ mốc hẹn mà `armStep` vừa đặt: bài test tự gọi bước đó ngay dưới.
    timers.queued.length = 0;
    runPendingStep(room, room.pendingStep!);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function defenseRequest(): SpeechRequest {
    const request = brainControl.requests.find((item) => item.defense !== null);
    if (!request) throw new Error("không có lượt bào chữa nào được gửi đi");
    return request;
  }

  it("được chỉ thị CÃI ĐỂ SỐNG - không dùng chiến thuật bất cần của Hề", async () => {
    const room = executionerRoom("EXB03");
    await runDefense(room);

    expect(defenseRequest().defense?.stance).toBe("SURVIVE");
    const { buildDaySpeechPrompt } = await import("../src/bots/prompt");
    expect(buildDaySpeechPrompt(defenseRequest()).user).toContain(
      "thuyết phục làng đừng treo bạn",
    );
  });

  it("prompt KHÔNG mang vai thật, mục tiêu hay id nào của nhiệm vụ", async () => {
    const room = executionerRoom("EXB03");
    await runDefense(room);

    const { buildDaySpeechPrompt } = await import("../src/bots/prompt");
    const prompt = buildDaySpeechPrompt(defenseRequest()).user;

    expect(prompt).not.toContain("Kẻ Báo Thù");
    expect(prompt).not.toContain("EXECUTIONER");
    // Tên mục tiêu là dữ liệu công khai (`Người 4` ngồi ngay đó), nên thứ phải
    // kiểm là id nội bộ và mọi dấu vết của bảng nhiệm vụ.
    expect(prompt).not.toContain("executioner");
  });

  it("đường lui bảng mẫu vẫn phát ra một câu thật, và không lộ vai", async () => {
    const room = executionerRoom("EXB04");
    await runDefense(room);

    const text = broadcast.chats.map((message) => message.text).join(" ");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("Kẻ Báo Thù");
  });
});
