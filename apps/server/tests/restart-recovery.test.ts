import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";
import { ROOM_SCAFFOLD } from "./helpers/room";

/**
 * Redis giả sống NGOÀI hệ thống module.
 *
 * Đây là điểm mấu chốt của cả file: `vi.resetModules()` xoá sạch mọi Map cấp
 * module (sổ phòng, session bot, ngân sách governor, phiên thảo luận, hàng đợi
 * bước chờ) - tức là mô phỏng đúng cái chết của một process. Thứ duy nhất được
 * phép sống qua ranh giới đó là mấy dòng byte trong `store.data`, y như Redis
 * thật. Nếu một mẩu state nào đó vẫn còn sau restart mà không đi qua đây, thì
 * đó là state chưa được persist và test này phải trượt.
 */
const store = vi.hoisted(() => ({ data: new Map<string, string>() }));
const db = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>> }));

vi.mock("../src/redis", () => ({
  redis: {
    get: async (key: string) => store.data.get(key) ?? null,
    set: async (key: string, value: string) => {
      store.data.set(key, value);
      return "OK";
    },
    del: async (key: string) => (store.data.delete(key) ? 1 : 0),
    exists: async (key: string) => (store.data.has(key) ? 1 : 0),
    eval: async (_s: string, _n: number, key: string, value: string) => {
      store.data.set(key, value);
      return 1;
    },
  },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
  saveSession: async () => undefined,
  getSession: async () => null,
  pingRedis: async () => true,
}));

vi.mock("../src/db", () => ({
  prisma: {
    gameResult: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const gameId = data.gameId as string | null;
        if (gameId && db.created.some((row) => row.gameId === gameId)) {
          // Unique index của Postgres, dựng lại đúng hình dạng lỗi của Prisma.
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        }
        db.created.push(data);
        return data;
      },
    },
  },
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
  setIo: () => undefined,
}));

vi.mock("../src/voice/service", () => ({
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
  dropVoiceParticipant: async () => undefined,
  voiceViewFor: () => null,
}));

vi.mock("../src/bots", async () => {
  const actual = await vi.importActual<typeof import("../src/bots")>("../src/bots");
  return {
    ...actual,
    // Không nhà cung cấp: lời thoại đến từ bảng mẫu tất định, nên test không
    // phụ thuộc mạng và không tốn tiền.
    botBrain: () => ({ name: "no-provider", renderDaySpeech: async () => ({ ok: false as const }) }),
  };
});

interface ServerModules {
  startGame: typeof import("../src/game/machine").startGame;
  runPendingStep: typeof import("../src/game/steps").runPendingStep;
  persistRoom: typeof import("../src/rooms/store").persistRoom;
  removeRoom: typeof import("../src/rooms/store").removeRoom;
  loadAndResumeRoom: typeof import("../src/rooms/load").loadAndResumeRoom;
  buildSnapshot: typeof import("../src/rooms/snapshot").buildSnapshot;
  clearBotSession: typeof import("../src/bots/session-registry").clearBotSession;
  botSessionFor: typeof import("../src/bots/session-registry").botSessionFor;
}

/** Một "process" mới: mọi module được nạp lại từ đầu, mọi Map trống trơn. */
async function bootProcess(): Promise<ServerModules> {
  vi.resetModules();
  const [machine, steps, storeModule, load, snapshot, registry] = await Promise.all([
    import("../src/game/machine"),
    import("../src/game/steps"),
    import("../src/rooms/store"),
    import("../src/rooms/load"),
    import("../src/rooms/snapshot"),
    import("../src/bots/session-registry"),
  ]);
  return {
    startGame: machine.startGame,
    runPendingStep: steps.runPendingStep,
    persistRoom: storeModule.persistRoom,
    removeRoom: storeModule.removeRoom,
    loadAndResumeRoom: load.loadAndResumeRoom,
    buildSnapshot: snapshot.buildSnapshot,
    clearBotSession: registry.clearBotSession,
    botSessionFor: registry.botSessionFor,
  };
}

function lobby(code: string): Room {
  return {
    ...ROOM_SCAFFOLD,
    code,
    hostId: "p1",
    status: "LOBBY",
    members: Array.from({ length: 9 }, (_, i) => ({
      playerId: `p${i + 1}`,
      name: `Người ${i + 1}`,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: i >= 4,
      avatarUrl: null,
    })),
    config: { ...DEFAULT_ROOM_CONFIG, hunter: true, werewolves: 2 },
    engine: null,
    chatLog: [],
    createdAt: Date.now() - 120_000,
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

/**
 * Dựng một ván tới đúng pha mong muốn rồi lưu snapshot, y như process thật vừa
 * làm xong lần ghi cuối cùng trước khi bị giết.
 */
async function playUntil(
  code: string,
  phase: string,
  tweak?: (room: Room) => void,
): Promise<{ room: Room; modules: ServerModules }> {
  const modules = await bootProcess();
  modules.clearBotSession(code);
  const room = lobby(code);
  modules.startGame(room);

  let guard = 0;
  while (room.engine!.state.phase !== phase && room.pendingStep && guard < 25) {
    modules.runPendingStep(room, room.pendingStep);
    guard += 1;
  }
  expect(room.engine!.state.phase).toBe(phase);

  tweak?.(room);
  await modules.persistRoom(room);
  return { room, modules };
}

/** Giết process rồi nạp lại phòng ở một process hoàn toàn mới. */
async function restartAndLoad(code: string): Promise<{ room: Room; modules: ServerModules }> {
  const modules = await bootProcess();
  const result = await modules.loadAndResumeRoom(code);
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("không nạp được phòng");
  return { room: result.room, modules };
}

beforeEach(() => {
  store.data.clear();
  db.created.length = 0;
});

describe("restart giữa các pha", () => {
  const PHASES = ["NIGHT", "DAY_DISCUSSION", "VOTING"] as const;

  for (const phase of PHASES) {
    it(`giữ nguyên ván khi restart giữa ${phase}`, async () => {
      const code = `RC${phase.slice(0, 3)}`;
      const { room: before } = await playUntil(code, phase);
      const stateBefore = before.engine!.getState();

      const { room: after } = await restartAndLoad(code);
      const stateAfter = after.engine!.getState();

      expect(after.status).toBe("IN_GAME");
      expect(stateAfter.phase).toBe(stateBefore.phase);
      expect(stateAfter.round).toBe(stateBefore.round);
      expect(stateAfter.players).toEqual(stateBefore.players);
      expect(stateAfter.votes).toEqual(stateBefore.votes);
      expect(stateAfter.night).toEqual(stateBefore.night);
      expect(stateAfter.nightHistory).toEqual(stateBefore.nightHistory);
      expect(stateAfter.dayVoteHistory).toEqual(stateBefore.dayVoteHistory);
      expect(stateAfter.hunterShots).toEqual(stateBefore.hunterShots);
      expect(stateAfter.activeEvent).toEqual(stateBefore.activeEvent);
      expect(after.gameId).toBe(before.gameId);
    });
  }

  it("phaseEndsAt không đổi khi vẫn còn nhiều thời gian", async () => {
    const { room: before } = await playUntil("RCEND", "NIGHT");
    const deadline = before.engine!.state.phaseEndsAt;

    const { room: after } = await restartAndLoad("RCEND");

    expect(after.engine!.state.phaseEndsAt).toBe(deadline);
  });

  it("VOTING sau khi có người đổi phiếu giữ đúng phiếu cuối và lịch sử đổi", async () => {
    const { room: before } = await playUntil("RCMUT", "VOTING", (room) => {
      const alive = room.engine!.state.players.filter((p) => p.alive);
      room.engine!.submitVote(alive[0]!.id, alive[1]!.id);
      room.engine!.submitVote(alive[0]!.id, alive[2]!.id);
      room.engine!.submitVote(alive[1]!.id, null);
    });
    const votesBefore = { ...before.engine!.state.votes };
    const mutationsBefore = before.engine!.state.voteMutations.length;

    const { room: after } = await restartAndLoad("RCMUT");

    expect(after.engine!.state.votes).toEqual(votesBefore);
    expect(after.engine!.state.voteMutations).toHaveLength(mutationsBefore);
    expect(mutationsBefore).toBeGreaterThan(0);
  });

  it("DEFENSE giữ nguyên bị cáo", async () => {
    const { room: before } = await playUntil("RCDEF", "VOTING", (room) => {
      const alive = room.engine!.state.players.filter((p) => p.alive);
      for (const voter of alive) room.engine!.submitVote(voter.id, alive[0]!.id);
    });
    const modules = await bootProcess();
    // Chốt vote sơ bộ để phòng bước vào phiên toà, rồi mới lưu.
    before.engine!.resolveNomination(before.config.defenseSeconds * 1_000);
    expect(before.engine!.state.phase).toBe("DEFENSE");
    await modules.persistRoom(before);

    const { room: after } = await restartAndLoad("RCDEF");

    expect(after.engine!.state.phase).toBe("DEFENSE");
    expect(after.engine!.state.trial?.accusedId).toBe(before.engine!.state.trial?.accusedId);
  });

  it("FINAL_VOTE giữ nguyên phiếu Treo/Tha đã bỏ", async () => {
    const { room: before } = await playUntil("RCFIN", "VOTING", (room) => {
      const alive = room.engine!.state.players.filter((p) => p.alive);
      for (const voter of alive) room.engine!.submitVote(voter.id, alive[0]!.id);
    });
    before.engine!.resolveNomination(1_000);
    before.engine!.beginFinalVote(before.config.finalVoteSeconds * 1_000);
    const voters = before.engine!.finalVoters();
    before.engine!.submitFinalVote(voters[0]!.id, true);
    before.engine!.submitFinalVote(voters[1]!.id, false);
    const finalVotesBefore = { ...before.engine!.state.trial!.finalVotes };

    const modules = await bootProcess();
    await modules.persistRoom(before);
    const { room: after } = await restartAndLoad("RCFIN");

    expect(after.engine!.state.phase).toBe("FINAL_VOTE");
    expect(after.engine!.state.trial!.finalVotes).toEqual(finalVotesBefore);
    // `false` là một phiếu THA thật, không phải "chưa bỏ phiếu".
    expect(after.engine!.state.trial!.finalVotes[voters[1]!.id]).toBe(false);
  });

  it("giữ nguyên phản ứng Thợ Săn đang chờ bắn", async () => {
    const { room: before } = await playUntil("RCHUN", "NIGHT");
    const hunter = before.engine!.state.players.find((p) => p.role === "HUNTER");
    // Không dùng `if (!hunter) return`: một test tự bỏ qua chính mình là một
    // test luôn xanh. Cấu hình ở `lobby()` bật `hunter`, nên thiếu vai này
    // nghĩa là việc chia vai đã hỏng và test PHẢI kêu.
    expect(hunter).toBeDefined();

    before.engine!.state.hunterReaction = {
      hunterId: hunter!.id,
      source: "night",
      resolved: false,
    };
    before.engine!.beginHunterShot(15_000);

    const modules = await bootProcess();
    await modules.persistRoom(before);
    const { room: after } = await restartAndLoad("RCHUN");

    expect(after.engine!.state.phase).toBe("HUNTER_SHOT");
    expect(after.engine!.state.hunterReaction).toEqual({
      hunterId: hunter!.id,
      source: "night",
      resolved: false,
    });
  });
});

describe("restart khi deadline đã trôi qua", () => {
  it("pha chuyển tiếp chạy bù đúng MỘT lần, không nhân đôi lịch sử đêm", async () => {
    const { room: before } = await playUntil("RCLAT", "NIGHT_RESULT", (room) => {
      room.pendingStep = { ...room.pendingStep!, runAt: Date.now() - 10 * 60_000 };
    });
    const historyBefore = before.engine!.state.nightHistory.length;
    const deathsBefore = before.engine!.state.players.filter((p) => !p.alive).length;

    const { room: after } = await restartAndLoad("RCLAT");

    expect(after.engine!.state.phase).not.toBe("NIGHT_RESULT");
    expect(after.engine!.state.nightHistory).toHaveLength(historyBefore);
    expect(after.engine!.state.players.filter((p) => !p.alive)).toHaveLength(deathsBefore);
  });

  it("pha thao tác quá hạn được kéo lên sàn 10 giây chứ không cắt lượt", async () => {
    const { room: before } = await playUntil("RCFLO", "NIGHT", (room) => {
      room.pendingStep = { ...room.pendingStep!, runAt: Date.now() - 5 * 60_000 };
    });
    void before;

    const { room: after } = await restartAndLoad("RCFLO");

    expect(after.engine!.state.phase).toBe("NIGHT");
    expect(after.engine!.state.phaseEndsAt).toBeGreaterThan(Date.now() + 9_000);
  });
});

describe("restart quanh lúc ván kết thúc", () => {
  it("chết TRƯỚC khi ghi kết quả thì lần khôi phục ghi bù", async () => {
    const { room: before } = await playUntil("RCGO1", "NIGHT", (room) => {
      room.engine!.finishGame("village");
      room.pendingStep = null;
    });
    expect(db.created).toHaveLength(0);

    const { room: after } = await restartAndLoad("RCGO1");
    await Promise.resolve();
    await Promise.resolve();

    expect(db.created).toHaveLength(1);
    expect(db.created[0]!.gameId).toBe(before.gameId);
    expect(after.engine!.state.phase).toBe("GAME_OVER");
  });

  it("chết SAU khi ghi kết quả thì không ghi thêm dòng nào", async () => {
    await playUntil("RCGO2", "NIGHT", (room) => {
      room.engine!.finishGame("wolves");
      room.pendingStep = null;
      // Process trước đã ghi xong nhưng CHƯA kịp lưu cờ vào snapshot: đây đúng
      // là khe hở mà unique index trên gameId sinh ra để bịt.
      db.created.push({ gameId: room.gameId, winner: "wolves" });
    });

    await restartAndLoad("RCGO2");
    await Promise.resolve();
    await Promise.resolve();

    expect(db.created).toHaveLength(1);
  });

  it("không hẹn bước nào sau khi ván đã xong", async () => {
    await playUntil("RCGO3", "NIGHT", (room) => {
      room.engine!.finishGame("village");
      room.pendingStep = null;
    });

    const { room: after } = await restartAndLoad("RCGO3");

    expect(after.pendingStep).toBeNull();
  });
});

describe("quyền xem sau khi khôi phục", () => {
  it("snapshot của Dân Làng không lộ vai người khác", async () => {
    await playUntil("RCSEC", "DAY_DISCUSSION");
    const { room: after, modules } = await restartAndLoad("RCSEC");

    // Chọn theo TIÊU CHÍ chứ không theo một vai cụ thể: việc chia vai dùng
    // `Math.random`, nên "phải có một Dân Làng còn sống" là một điều kiện có
    // thể không xảy ra, và một test chỉ xanh ở vài lần chạy là một test hỏng.
    const viewer = after.engine!.state.players.find(
      (p) => p.alive && p.role !== "WEREWOLF" && p.role !== "WOLF_CUB",
    )!;
    const view = modules.buildSnapshot(after, viewer.id);

    // Khẳng định KHÔNG rỗng trước: nếu snapshot không hề có trường vai thì hai
    // dòng dưới đây xanh mà chẳng chứng minh được gì.
    expect(view.you?.role).toBe(viewer.role);
    const revealed = view.players.filter((p) => p.role !== undefined && p.id !== viewer.id);
    expect(revealed).toHaveLength(0);
    expect(JSON.stringify(view)).not.toContain("WEREWOLF");
  });

  it("payload persistence không mang theo bất kỳ vai nào lên dây", async () => {
    await playUntil("RCWIR", "NIGHT");
    const { room: after, modules } = await restartAndLoad("RCWIR");

    const viewer = after.engine!.state.players.find(
      (p) => p.role !== "WEREWOLF" && p.role !== "WOLF_CUB",
    )!;
    const view = modules.buildSnapshot(after, viewer.id);

    expect(JSON.stringify(view)).not.toContain("deadCanSpeakChosenId");
    expect(JSON.stringify(view)).not.toContain("botSession");
    expect(JSON.stringify(view)).not.toContain("persistenceVersion");
  });
});

describe("trạng thái bot sau khôi phục", () => {
  it("giữ nguyên nghi ngờ đã tích luỹ và con trỏ RNG", async () => {
    const { room: before, modules: first } = await playUntil("RCBOT", "NIGHT");
    const bot = before.members.find((m) => m.isBot)!;
    const session = first.botSessionFor(before);
    session.runtimeFor(bot.playerId).state.suspicion["p1"]!.score = 31;
    session.rngFor(bot.playerId, "vote-schedule")();
    session.rngFor(bot.playerId, "vote-schedule")();
    await first.persistRoom(before);

    const { room: after, modules } = await restartAndLoad("RCBOT");
    const restored = modules.botSessionFor(after);

    expect(restored.runtimeFor(bot.playerId).state.suspicion["p1"]!.score).toBe(31);
    // Dòng RNG tiếp tục từ vị trí cũ: hai số đã tiêu không được phát lại.
    expect(restored.rngFor(bot.playerId, "vote-schedule").cursor).toBe(2);
  });

  it("ngân sách AI đã tiêu không được cấp lại sau restart", async () => {
    const { room: before, modules: first } = await playUntil("RCBUD", "NIGHT");
    const { restoreBotBudget, botBudgetUsed } = await import("../src/bots");
    restoreBotBudget(before.code, 12);
    await first.persistRoom(before);
    void botBudgetUsed;

    await restartAndLoad("RCBUD");
    const bots = await import("../src/bots");

    expect(bots.botBudgetUsed("RCBUD")).toBe(12);
  });
});
