import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameEngine } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG, type ChatMessage } from "@masoi/shared";
import type { Attempt, DaySpeechDecision, SpeechRequest } from "../src/bots/types";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

/**
 * BOT Sát Nhân trên ĐƯỜNG THẬT của server.
 *
 * Self-play chạy lõi quyết định trực tiếp; nó không đi qua scheduler, không đi
 * qua pha DEFENSE, và không đi qua `applyNight`. Đúng ba tầng đó là nơi lượt
 * đêm của một vai mới hay lặng lẽ biến mất - engine vẫn chào một hành động hợp
 * lệ và không ai nhận. Bài này đi qua cả ba, chỉ thay nhà cung cấp LLM.
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

/**
 * Hẹn giờ gom vào một HÀNG ĐỢI thay vì chạy.
 *
 * `scheduleNightBots` rải mốc hẹn theo thời gian còn lại của pha; chờ thật là
 * chờ vài giây trong một bài test. Gom lại rồi rút ra chạy giữ nguyên đường
 * code - vẫn đúng `stillPending()`, vẫn đúng `applyNight` - chỉ bỏ phần đồng
 * hồ.
 *
 * KHÔNG chạy ngay tại chỗ hẹn: `armStep` cũng đi qua đây, và một lần chạy ngay
 * sẽ thực thi bước chuyển pha ngay bên trong lời hẹn của nó - tức chạy `endVoting`
 * trước khi bài test kịp gọi nó, rồi xoá `pendingStep` mà bài test đang cầm.
 */
const timers = vi.hoisted(() => ({ queued: [] as Array<() => void> }));

vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: (_code: string, fn: () => void) => {
    timers.queued.push(fn);
  },
}));

/** Chạy hết mốc hẹn đang chờ, theo đúng thứ tự đã hẹn. */
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

// Nạp machine để nó ĐĂNG KÝ bảng xử lý bước chuyển pha; đây cũng chính là thứ
// đang được kiểm, nên nó phải là module thật.
const machine = await import("../src/game/machine");
const { armStep, runPendingStep } = await import("../src/game/steps");
const { clearBotSession, startBotSession } = await import("../src/bots/session-registry");

/** Bàn 6 người, `p2` là một BOT Sát Nhân. */
function killerRoom(code: string): Room {
  const players = [
    { id: "p1", name: "Người 1", isBot: false },
    { id: "p2", name: "Sát Nhân", isBot: true },
    { id: "p3", name: "Người 3", isBot: false },
    { id: "p4", name: "Người 4", isBot: false },
    { id: "p5", name: "Người 5", isBot: false },
    { id: "p6", name: "Người 6", isBot: false },
  ];
  const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1, serialKiller: true };
  const engine = GameEngine.create(players, config, 1_000);
  engine.state.players[0].role = "WEREWOLF";
  engine.state.players[1].role = "SERIAL_KILLER";
  for (const player of engine.state.players.slice(2)) player.role = "VILLAGER";

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
  for (const code of ["SKF01", "SKF02", "SKF03"]) clearBotSession(code);
});

describe("lượt đêm của BOT Sát Nhân đi qua scheduler thật", () => {
  it("scheduler THẬT SỰ nộp một nhát dao lên engine", () => {
    const room = killerRoom("SKF01");
    room.engine!.setPhase("NIGHT", 30_000, 2_000);

    machine.scheduleNightBots(room);
    drainTimers();

    /*
     * Đây là bài kiểm nhạy nhất của cả tầng server: `scheduleNightBots` bỏ qua
     * mọi BOT có `!view.night?.canAct`, nên chỉ cần `nightInfoFor` quên một vai
     * là lượt đêm của cả vai đó mất trắng mọi ván - im lặng, không lỗi, không
     * log.
     */
    const target = room.engine!.state.night.serialKillerTarget;
    expect(target).not.toBeNull();
    // Và mục tiêu phải là một người còn sống KHÁC chính nó.
    expect(target).not.toBe("p2");
    expect(room.engine!.player(target!)!.alive).toBe(true);
  });

  it("gọi lại scheduler không nộp thêm lượt thứ hai", () => {
    const room = killerRoom("SKF02");
    room.engine!.setPhase("NIGHT", 30_000, 2_000);

    machine.scheduleNightBots(room);
    drainTimers();
    const first = room.engine!.state.night.serialKillerTarget;
    // `lockWolves` gọi `scheduleNightBots` lần nữa để mở cửa sổ Phù Thuỷ; cờ
    // `acted` là thứ chặn việc hỏi lại một BOT đã hành động.
    machine.scheduleNightBots(room);
    drainTimers();

    expect(room.engine!.state.night.serialKillerTarget).toBe(first);
  });
});

describe("lượt tự bào chữa của BOT Sát Nhân", () => {
  /** Chạy đúng bước `endVoting` của machine, tức mở phiên toà thật. */
  async function runDefense(room: Room): Promise<void> {
    room.engine!.state.round = 2;
    room.engine!.setPhase("VOTING", 30_000, 2_000);
    for (const voter of room.engine!.alivePlayers()) {
      if (voter.id !== "p2") room.engine!.submitVote(voter.id, "p2", 3_000);
    }
    armStep(room, { name: "endVoting" }, 0);
    // Bỏ hẳn mốc hẹn mà `armStep` vừa đặt: bài test tự gọi bước đó ngay dưới,
    // và chạy nó hai lần là chạy `endVoting` cho một tình thế đã trôi qua.
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

  it("được chỉ thị CÃI ĐỂ SỐNG - ngược hẳn Thằng Hề", async () => {
    const room = killerRoom("SKF03");
    await runDefense(room);

    const request = defenseRequest();
    /*
     * Hai vai trung lập, hai thái độ trái ngược ở đúng cùng một lượt. Với Hề,
     * `SURVIVE` là chỉ thị làm hỏng điều kiện thắng của chính nó; với Sát Nhân
     * thì `INDIFFERENT` mới là chỉ thị đó. `DefenseStance` tồn tại để cả ba
     * tầng cùng nhìn thấy khác biệt này thay vì mỗi tầng tự đoán.
     */
    expect(request.defense?.stance).toBe("SURVIVE");

    const { buildDaySpeechPrompt } = await import("../src/bots/prompt");
    const prompt = buildDaySpeechPrompt(request).user;
    expect(prompt).toContain("thuyết phục làng đừng treo bạn");
  });

  it("nói dối một vai chức năng, và KHÔNG bao giờ nói ra vai thật", async () => {
    const room = killerRoom("SKF03");
    await runDefense(room);

    const request = defenseRequest();
    expect(request.intention.kind).toBe("CLAIM_ROLE");
    expect(request.intention.claimedRole).toBeTruthy();
    // Lá bài cuối là một lời NÓI DỐI: khai đúng vai thật là tự kết án mình.
    expect(request.intention.claimedRole).not.toBe("SERIAL_KILLER");

    const prompt = (await import("../src/bots/prompt")).buildDaySpeechPrompt(request).user;
    expect(prompt).not.toContain("Sát Nhân");
  });

  it("đường lui bảng mẫu cũng phát ra một câu thật, không im lặng", async () => {
    // `brainControl.reply === null` nên nhà cung cấp hỏng ở mọi lượt - đúng
    // đường chạy của production mỗi khi hết quota hay mạng lỗi.
    const room = killerRoom("SKF03");
    await runDefense(room);

    const text = broadcast.chats.map((message) => message.text).join(" ");
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("Sát Nhân");
  });
});
