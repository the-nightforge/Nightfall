import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import type { Room } from "../src/rooms/store";

const store = vi.hoisted(() => ({ data: new Map<string, string>() }));

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
}));

vi.mock("../src/db", () => ({
  prisma: { gameResult: { create: async () => undefined } },
}));

vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));

vi.mock("../src/voice/service", () => ({
  destroyVoiceRoom: async () => undefined,
  syncVoicePermissions: async () => undefined,
  dropVoiceParticipant: async () => undefined,
  voiceViewFor: () => null,
}));

async function boot() {
  vi.resetModules();
  const [machine, steps, storeModule, load, registry, context] = await Promise.all([
    import("../src/game/machine"),
    import("../src/game/steps"),
    import("../src/rooms/store"),
    import("../src/rooms/load"),
    import("../src/bots/session-registry"),
    import("../src/bots/context"),
  ]);
  return {
    startGame: machine.startGame,
    runPendingStep: steps.runPendingStep,
    persistRoom: storeModule.persistRoom,
    loadAndResumeRoom: load.loadAndResumeRoom,
    botSessionFor: registry.botSessionFor,
    clearBotSession: registry.clearBotSession,
    buildBotDecisionContext: context.buildBotDecisionContext,
  };
}

type Modules = Awaited<ReturnType<typeof boot>>;

function lobby(code: string): Room {
  return {
    code,
    hostId: "p1",
    status: "LOBBY",
    members: Array.from({ length: 9 }, (_, i) => ({
      playerId: `p${i + 1}`,
      name: `Người ${i + 1}`,
      ready: true,
      connected: true,
      disconnectedAt: null,
      isBot: i >= 2,
      avatarUrl: null,
    })),
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 2 },
    engine: null,
    chatLog: [],
    createdAt: Date.now() - 120_000,
    gameId: null,
    resultWritten: false,
    pendingStep: null,
    phaseSeq: 0,
  };
}

/** Quyết định của từng BOT tại thời điểm gọi, dạng so sánh được. */
function decisions(room: Room, modules: Modules): string[] {
  const session = modules.botSessionFor(room);
  return room.members
    .filter((member) => member.isBot)
    .filter((member) => room.engine!.state.players.find((p) => p.id === member.playerId)?.alive)
    .map((member) => {
      const runtime = session.runtimeFor(member.playerId);
      const context = modules.buildBotDecisionContext(room, member.playerId);
      const vote = runtime.decideVote(context);
      const claim = runtime.decideRoleClaim(context);
      return JSON.stringify({
        bot: member.playerId,
        vote: vote.choice,
        claim: claim.role,
        confidence: runtime.state.confidence,
        suspicion: Object.entries(runtime.state.suspicion)
          .map(([id, entry]) => `${id}:${entry.score.toFixed(6)}`)
          .sort(),
      });
    });
}

/** Cho bot quan sát vài lượt để brain có nội dung thật, không phải trang giấy trắng. */
function letBotsObserve(room: Room, modules: Modules): void {
  const session = modules.botSessionFor(room);
  for (const member of room.members.filter((m) => m.isBot)) {
    const runtime = session.runtimeFor(member.playerId);
    runtime.observe(modules.buildBotDecisionContext(room, member.playerId));
  }
}

beforeEach(() => {
  store.data.clear();
});

describe("bot không đổi quyết định chỉ vì restart", () => {
  it("quyết định ở VOTING giống hệt nhau, có restart hay không", async () => {
    const code = "DETVO";
    const first = await boot();
    first.clearBotSession(code);
    const room = lobby(code);
    first.startGame(room);

    // Đi tới VOTING, cho bot quan sát ở mỗi chặng để brain tích luỹ thật.
    let guard = 0;
    while (room.engine!.state.phase !== "VOTING" && room.pendingStep && guard < 25) {
      first.runPendingStep(room, room.pendingStep);
      letBotsObserve(room, first);
      guard += 1;
    }
    expect(room.engine!.state.phase).toBe("VOTING");

    await first.persistRoom(room);

    // Nhánh A: không restart, hỏi lõi ngay.
    const withoutRestart = decisions(room, first);

    // Nhánh B: process chết rồi sống lại, hỏi đúng câu đó.
    const second = await boot();
    const loaded = await second.loadAndResumeRoom(code);
    expect(loaded.status).toBe("ok");
    if (loaded.status !== "ok") return;
    const withRestart = decisions(loaded.room, second);

    expect(withRestart).toEqual(withoutRestart);
    // Không rỗng: một mảng rỗng cũng "bằng nhau" mà chẳng chứng minh điều gì.
    expect(withRestart.length).toBeGreaterThan(3);
  });

  it("quyết định ban đêm giống hệt nhau qua restart", async () => {
    const code = "DETNI";
    const first = await boot();
    first.clearBotSession(code);
    const room = lobby(code);
    first.startGame(room);
    first.runPendingStep(room, room.pendingStep!); // vào NIGHT
    letBotsObserve(room, first);
    await first.persistRoom(room);

    const session = first.botSessionFor(room);
    const before = room.members
      .filter((m) => m.isBot)
      .map((m) => {
        const runtime = session.runtimeFor(m.playerId);
        return JSON.stringify(
          runtime.decideNight(first.buildBotDecisionContext(room, m.playerId)),
        );
      });

    const second = await boot();
    const loaded = await second.loadAndResumeRoom(code);
    if (loaded.status !== "ok") throw new Error("không nạp được phòng");
    const restoredSession = second.botSessionFor(loaded.room);
    const after = loaded.room.members
      .filter((m) => m.isBot)
      .map((m) => {
        const runtime = restoredSession.runtimeFor(m.playerId);
        return JSON.stringify(
          runtime.decideNight(second.buildBotDecisionContext(loaded.room, m.playerId)),
        );
      });

    expect(after).toEqual(before);
  });

  it("trí nhớ và personality của bot sống sót nguyên vẹn", async () => {
    const code = "DETME";
    const first = await boot();
    first.clearBotSession(code);
    const room = lobby(code);
    first.startGame(room);
    first.runPendingStep(room, room.pendingStep!);
    letBotsObserve(room, first);

    const bot = room.members.find((m) => m.isBot)!;
    const brainBefore = JSON.stringify(
      first.botSessionFor(room).runtimeFor(bot.playerId).state,
    );
    await first.persistRoom(room);

    const second = await boot();
    const loaded = await second.loadAndResumeRoom(code);
    if (loaded.status !== "ok") throw new Error("không nạp được phòng");

    const brainAfter = JSON.stringify(
      second.botSessionFor(loaded.room).runtimeFor(bot.playerId).state,
    );

    expect(brainAfter).toBe(brainBefore);
  });
});
