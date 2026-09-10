import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_CONFIG, PRESET_DECKS } from "@masoi/shared";
import {
  DEFAULT_BOT_WEIGHTS,
  GameEngine,
  collectMetrics,
  createQuestionLedger,
  openQuestion,
  runSelfPlay,
} from "@masoi/game-engine";
import type { Room } from "../src/rooms/store";
import type { BotSpeechLogEvent } from "../src/game/bot-speech-log";
import { ROOM_SCAFFOLD } from "./helpers/room";

const db = vi.hoisted(() => ({ created: [] as Array<Record<string, unknown>> }));

vi.mock("../src/db", () => ({
  prisma: {
    gameResult: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        db.created.push(data);
        return data;
      },
    },
  },
}));
vi.mock("../src/rooms/broadcast", () => ({
  broadcastRoom: () => undefined,
  emitToPlayers: () => undefined,
}));
vi.mock("../src/rooms/store", () => ({
  clearRoomTimers: () => undefined,
  persistRoom: async () => undefined,
  setRoomTimer: () => undefined,
}));
vi.mock("../src/redis", () => ({ redis: { status: "ready" } }));

const { buildBotMetrics, RATIO_KEYS } = await import("../src/game/bot-metrics");
const { writeGameResultOnce } = await import("../src/game/game-result");

const KINDS = new Set(["SPEECH", "SPEECH_BLOCKED", "QUESTION_OUTCOME"]);
const GAME = runSelfPlay({ seed: "bot-metrics-parity", playerCount: 12, config: PRESET_DECKS[12], defense: true });
const EVENTS = GAME.events.filter((e) => KINDS.has(e.kind)) as BotSpeechLogEvent[];
const DIRECT = collectMetrics([GAME], DEFAULT_BOT_WEIGHTS).overall;
const BUILT = buildBotMetrics({
  events: EVENTS,
  roles: GAME.roles,
  winner: GAME.winner,
  rounds: GAME.rounds,
  personalWins: GAME.personalWins,
  players: 12,
  bots: 12,
  weights: DEFAULT_BOT_WEIGHTS,
  brain: "test-brain",
  truncated: false,
  recorderErrors: 0,
  config: PRESET_DECKS[12]!,
});

describe("botMetrics — cùng định nghĩa với self-play", () => {
  it("điều kiện tiên quyết: ván này thật sự có câu hỏi, lời khai và câu bị chặn để so", () => {
    // Không có dòng này thì một ván không ai hỏi ai làm cả test xanh mà không so gì.
    expect(DIRECT.directQuestionOutcomes.ANSWERED.denominator).toBeGreaterThan(0);
    expect(DIRECT.claimsPerGame).toBeGreaterThan(0);
  });

  it("chỉ ba loại sự kiện là đủ: mọi tỉ lệ được lưu khớp collectMetrics trên TOÀN BỘ sự kiện", () => {
    for (const key of RATIO_KEYS) {
      expect(BUILT.ratios[key], key).toEqual([DIRECT[key].numerator, DIRECT[key].denominator]);
    }
  });

  it("bảy ngăn câu hỏi, trần chuỗi, lời khai, lượt bị chặn khớp", () => {
    for (const [key, ratio] of Object.entries(DIRECT.directQuestionOutcomes)) {
      expect(BUILT.questionOutcomes.bot[key as keyof typeof BUILT.questionOutcomes.bot], key).toBe(ratio.numerator);
    }
    expect(BUILT.maxChain).toBe(DIRECT.maxDialogueChainLength);
    expect(BUILT.claims).toBe(DIRECT.claimsPerGame);
    expect(BUILT.hadCounterClaim).toBe(DIRECT.counterClaimRate.numerator > 0);
    expect(BUILT.blocked).toEqual(DIRECT.speechBlockedByRoom);
  });

  it("botDays suy ngược đúng trung bình số câu mỗi (vòng, bot)", () => {
    expect(BUILT.botDays[0] / BUILT.botDays[1]).toBeCloseTo(DIRECT.messagesPerBotPerDay!, 10);
  });
});

describe("botMetrics — không một chữ nào", () => {
  it("không id, không nội dung câu nào lọt vào JSON", () => {
    const json = JSON.stringify(BUILT);
    for (const id of Object.keys(GAME.roles)) expect(json).not.toContain(`"${id}"`);
    for (const event of EVENTS) {
      if (event.kind === "SPEECH" && event.text.length >= 4) expect(json).not.toContain(event.text);
    }
  });
});

describe("writeGameResultOnce ghi botMetrics", () => {
  beforeEach(() => {
    db.created.length = 0;
  });

  function finishedRoom(code: string): Room {
    const players = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Người ${i + 1}`,
      isBot: i >= 4,
    }));
    const config = { ...DEFAULT_ROOM_CONFIG, werewolves: 1 };
    const engine = GameEngine.create(players, config, 1_000);
    engine.state.round = 3;
    engine.state.winner = "village";
    return {
      ...ROOM_SCAFFOLD,
      code,
      gameId: `game-${code}`,
      hostId: "p1",
      status: "IN_GAME",
      members: players.map((p) => ({
        playerId: p.id,
        name: p.name,
        ready: true,
        connected: !p.isBot,
        isBot: p.isBot,
      })),
      config,
      engine,
      chatLog: [],
      createdAt: 0,
      speechLog: [],
      questionLedger: createQuestionLedger(),
      botSpeechLogTruncated: false,
      recorderErrors: 0,
    };
  }

  it("ván có sổ: lưu botMetrics cùng lệnh create", async () => {
    await writeGameResultOnce(finishedRoom("BMOK"));
    expect(db.created).toHaveLength(1);
    expect(db.created[0]!.botMetrics).toMatchObject({
      metricsVersion: 1,
      players: 6,
      bots: 2,
      rounds: 3,
      truncated: false,
      recorderErrors: 0,
    });
    // Quyền riêng tư: không tên, không id người chơi nào của phòng lọt xuống DB.
    const json = JSON.stringify(db.created[0]!.botMetrics);
    for (let i = 1; i <= 6; i += 1) {
      expect(json).not.toContain(`"p${i}"`);
      expect(json).not.toContain(`Người ${i}`);
    }
  });

  it("ván không có sổ từ đầu: botMetrics trống, kết quả vẫn được ghi", async () => {
    const room = finishedRoom("BMNUL");
    room.speechLog = null;
    await writeGameResultOnce(room);
    expect(db.created).toHaveLength(1);
    expect(db.created[0]!.botMetrics).toBeUndefined();
  });

  it("tính hỏng: botMetrics trống, kết quả vẫn được ghi", async () => {
    const room = finishedRoom("BMBAD");
    room.speechLog = [{ kind: "SPEECH", text: null } as unknown as BotSpeechLogEvent];
    await writeGameResultOnce(room);
    expect(db.created).toHaveLength(1);
    expect(db.created[0]!.botMetrics).toBeUndefined();
  });

  it("câu hỏi còn mở lúc hết ván bị bỏ, không thành QUESTION_OUTCOME — như self-play", async () => {
    const room = finishedRoom("BMOPEN");
    openQuestion(room.questionLedger!, { messageId: "late", askerId: "p1", targetId: "p5", round: 3, humanAsker: true });
    await writeGameResultOnce(room);
    const metrics = db.created[0]!.botMetrics as { questionOutcomes: { human: Record<string, number> } };
    expect(Object.values(metrics.questionOutcomes.human).every((n) => n === 0)).toBe(true);
  });
});
