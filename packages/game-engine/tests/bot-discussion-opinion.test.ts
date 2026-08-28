import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { BotRuntime } from "../src/bot/BotRuntime";
import { createSeededRng } from "../src/bot/rng";
import { DEFAULT_ROOM_CONFIG, type Role, type RoomConfig } from "@masoi/shared";
import type { BotDecisionContext } from "../src/bot/types";

/**
 * BOT phải có Ý KIẾN trong pha thảo luận, không chỉ trong pha bỏ phiếu.
 *
 * Hồi quy thật đã lên production: `legalVoteChoices` chỉ khác rỗng khi
 * `phase === "VOTING"`, còn `selectVote` chấm điểm bằng đúng danh sách đó. Ở
 * pha thảo luận danh sách rỗng, nên mọi BOT đều kết luận "không treo ai", và
 * `decideSpeech` biến điều đó thành WITHHOLD.
 *
 * Kết quả trong phòng thật: cả mười hai BOT lần lượt nói cùng một câu
 * "hiện tại tôi chưa đủ căn cứ để chỉ đích danh ai", mỗi vòng, cả ván.
 *
 * Harness ở Task 9 không bắt được vì nó chỉ gọi `decideVote` trong pha bỏ
 * phiếu - đúng cái pha mà bug không xảy ra.
 */

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: false,
};

const FIXED_ROLES: readonly Role[] = [
  "WEREWOLF",
  "WEREWOLF",
  "SEER",
  "GUARD",
  "WITCH",
  "VILLAGER",
  "VILLAGER",
  "VILLAGER",
];

function boardAt(phase: "DAY_DISCUSSION" | "VOTING") {
  const engine = GameEngine.create(
    FIXED_ROLES.map((_, i) => ({ id: `p${i + 1}`, name: `Người ${i + 1}`, isBot: true })),
    CONFIG,
  );
  engine.state.players.forEach((player, i) => {
    player.role = FIXED_ROLES[i];
  });
  engine.setPhase("NIGHT", 30_000, 0);
  engine.setPhase("DAY_DISCUSSION", 60_000, 0);
  if (phase === "VOTING") engine.setPhase("VOTING", 30_000, 0);
  return engine;
}

const contextFor = (engine: GameEngine, playerId: string): BotDecisionContext => ({
  knowledge: engine.botKnowledgeFor(playerId),
  visibleChat: [],
});

function runtimeFor(engine: GameEngine, playerId: string): BotRuntime {
  return new BotRuntime({
    playerId,
    rng: createSeededRng(`op:${playerId}`),
    playerIds: engine.state.players.map((p) => p.id),
  });
}

describe("ý kiến trong pha thảo luận", () => {
  it("BOT phe làng nêu được một người cụ thể khi đang thảo luận", () => {
    const engine = boardAt("DAY_DISCUSSION");
    const villager = engine.state.players.find((p) => p.role === "VILLAGER")!;

    const context = contextFor(engine, villager.id);
    const runtime = runtimeFor(engine, villager.id);
    runtime.observe(context);

    expect(runtime.decideVote(context).choice.type).toBe("PLAYER");
  });

  it("không phải mọi BOT đều nhắm cùng một người", () => {
    // Nếu tất cả cùng chỉ vào một người thì đó là jitter hỏng, và cả phòng sẽ
    // hành xử như một khối duy nhất.
    const engine = boardAt("DAY_DISCUSSION");

    const targets = new Set(
      engine.alivePlayers().map((player) => {
        const context = contextFor(engine, player.id);
        const runtime = runtimeFor(engine, player.id);
        runtime.observe(context);
        const choice = runtime.decideVote(context).choice;
        return choice.type === "PLAYER" ? choice.targetId : "NONE";
      }),
    );

    expect(targets.size).toBeGreaterThan(1);
  });

  it("KHÔNG phải mọi BOT đều im lặng kiểu WITHHOLD trong thảo luận", () => {
    // Đây là assert bám sát đúng triệu chứng người chơi nhìn thấy.
    const engine = boardAt("DAY_DISCUSSION");

    const kinds: string[] = [];
    for (const player of engine.alivePlayers()) {
      const context = contextFor(engine, player.id);
      const runtime = runtimeFor(engine, player.id);
      runtime.observe(context);
      const vote = runtime.decideVote(context);
      // Bỏ qua xác suất im lặng theo personality: ta đang đo Ý ĐỊNH, không đo
      // tần suất nói.
      const speech = runtime.decideSpeech(context, vote);
      if (speech) kinds.push(speech.kind);
    }

    expect(kinds.length).toBeGreaterThan(0);
    expect(kinds.every((kind) => kind === "WITHHOLD")).toBe(false);
  });

  it("BOT không nhắm chính mình khi thảo luận", () => {
    const engine = boardAt("DAY_DISCUSSION");

    for (const player of engine.alivePlayers()) {
      const context = contextFor(engine, player.id);
      const runtime = runtimeFor(engine, player.id);
      runtime.observe(context);
      const choice = runtime.decideVote(context).choice;
      if (choice.type === "PLAYER") expect(choice.targetId).not.toBe(player.id);
    }
  });

  it("BOT không nhắm người đã chết", () => {
    const engine = boardAt("DAY_DISCUSSION");
    const dead = engine.state.players[7];
    dead.alive = false;

    for (const player of engine.alivePlayers()) {
      const context = contextFor(engine, player.id);
      const runtime = runtimeFor(engine, player.id);
      runtime.observe(context);
      const choice = runtime.decideVote(context).choice;
      if (choice.type === "PLAYER") expect(choice.targetId).not.toBe(dead.id);
    }
  });

  it("Sói vẫn không nhắm đồng bọn khi thảo luận", () => {
    const engine = boardAt("DAY_DISCUSSION");
    const wolves = engine.state.players.filter((p) => p.role === "WEREWOLF");

    const context = contextFor(engine, wolves[0].id);
    const runtime = runtimeFor(engine, wolves[0].id);
    runtime.observe(context);

    const choice = runtime.decideVote(context).choice;
    if (choice.type === "PLAYER") expect(choice.targetId).not.toBe(wolves[1].id);
  });
});

describe("pha bỏ phiếu vẫn bị ràng buộc bởi luật engine", () => {
  it("chỉ chọn trong legalVoteChoices khi thật sự được bỏ phiếu", () => {
    // Sửa bug thảo luận không được phép nới lỏng ràng buộc lúc nộp phiếu thật.
    const engine = boardAt("VOTING");
    const legal = new Set(
      engine
        .legalVoteChoicesFor("p1")
        .flatMap((choice) => (choice.type === "PLAYER" ? [choice.targetId] : [])),
    );
    expect(legal.size).toBeGreaterThan(0);

    const context = contextFor(engine, "p1");
    const runtime = runtimeFor(engine, "p1");
    runtime.observe(context);

    const choice = runtime.decideVote(context).choice;
    if (choice.type === "PLAYER") expect(legal.has(choice.targetId)).toBe(true);
  });

  it("người đã chết không có ý kiến lẫn lá phiếu", () => {
    const engine = boardAt("VOTING");
    engine.mustPlayer("p1").alive = false;

    const context = contextFor(engine, "p1");
    const runtime = runtimeFor(engine, "p1");
    runtime.observe(context);

    expect(runtime.decideVote(context).choice).toEqual({ type: "NO_ELIMINATION" });
  });
});
