import { describe, expect, it } from "vitest";
import { GameEngine } from "../src/engine";
import { createSeededRng } from "../src/bot/rng";
import { BotRuntime } from "../src/bot/BotRuntime";
import type { BotDecisionContext } from "../src/bot/types";
import { DEFAULT_ROOM_CONFIG, type RoomConfig } from "@masoi/shared";

/**
 * Audit đối kháng cho các đảm bảo của Phase 1.
 *
 * Khác với engine.test.ts (viết cùng lúc với code, nên dễ chỉ khẳng định lại
 * đúng những gì code đã làm), file này viết từ phía một người ĐI TÌM LỖ HỔNG:
 * mỗi test hỏi "có đường nào rò rỉ không", không hỏi "code có chạy không".
 *
 * Đây là lưới an toàn cho Phase 2: Phase 2 đụng rất sâu vào belief và chiến
 * lược theo vai, nên những đảm bảo dưới đây phải đỏ ngay khi bị vi phạm.
 */

const CONFIG: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: false,
  nightSeconds: 30,
  discussionSeconds: 90,
  voteSeconds: 30,
};

function ids(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Người ${i + 1}`,
    isBot: false,
  }));
}

/**
 * Vai cố định theo vị trí.
 *
 * `GameEngine.create` chia vai ngẫu nhiên, nên một fixture dựa vào nó không thể
 * dùng để kiểm tra tính tái lập: hai lần chạy sẽ nhặt phải hai người khác nhau
 * và test đỏ vì lý do chẳng liên quan gì tới thứ đang đo.
 */
const FIXED_ROLES = [
  "WEREWOLF",
  "WEREWOLF",
  "SEER",
  "GUARD",
  "WITCH",
  "VILLAGER",
] as const;

function engineAtVoting(playerCount = 6) {
  const engine = GameEngine.create(ids(playerCount), CONFIG);
  engine.state.players.forEach((player, i) => {
    player.role = FIXED_ROLES[i % FIXED_ROLES.length];
  });
  engine.setPhase("NIGHT", 30_000, 0);
  engine.setPhase("DAY_DISCUSSION", 60_000, 0);
  engine.setPhase("VOTING", 30_000, 0);
  return engine;
}

/** Mọi chuỗi vai bằng mã tiếng Anh mà engine dùng nội bộ. */
const ROLE_CODES = [
  "WEREWOLF",
  "SEER",
  "GUARD",
  "WITCH",
  "HUNTER",
  "CURSED",
  "VILLAGER",
] as const;

/** Đếm mã vai xuất hiện trong một payload đã serialize. */
function roleCodesIn(value: unknown): string[] {
  const text = JSON.stringify(value) ?? "";
  return ROLE_CODES.filter((role) => text.includes(role));
}

describe("Phase 1 · phiếu công khai và đổi phiếu", () => {
  it("một người đổi phiếu ba lần chỉ tính lá cuối, nhưng lưu đủ ba bước", () => {
    const e = engineAtVoting();

    e.submitVote("p1", "p2", 1_000);
    e.submitVote("p1", "p3", 2_000);
    e.submitVote("p1", "p4", 3_000);

    expect(e.voteTally().players).toEqual({ p4: 1 });
    expect(e.state.voteMutations).toHaveLength(3);
    expect(e.state.voteMutations.map((m) => m.choice)).toEqual([
      { type: "PLAYER", targetId: "p2" },
      { type: "PLAYER", targetId: "p3" },
      { type: "PLAYER", targetId: "p4" },
    ]);
  });

  it("đổi qua lại rồi quay về lựa chọn cũ vẫn là một mutation mới, không phải no-op", () => {
    // Quay lại B sau khi đã sang C là một hành vi xã hội có thật và phải đọc
    // được; gộp nó thành no-op sẽ xoá mất chính tín hiệu đó.
    const e = engineAtVoting();

    e.submitVote("p1", "p2", 1_000);
    e.submitVote("p1", "p3", 2_000);
    e.submitVote("p1", "p2", 3_000);

    expect(e.state.voteMutations).toHaveLength(3);
    expect(e.voteTally().players).toEqual({ p2: 1 });
  });

  it("gửi lại đúng lựa chọn hiện tại là no-op, kể cả với không-treo-ai", () => {
    const e = engineAtVoting();

    e.submitVote("p1", null, 1_000);
    e.submitVote("p1", null, 2_000);
    e.submitVote("p2", "p3", 3_000);
    e.submitVote("p2", "p3", 4_000);

    expect(e.state.voteMutations).toHaveLength(2);
  });

  it("danh tính phiếu KHÔNG lộ trong lúc đang bỏ phiếu", () => {
    const e = engineAtVoting();
    e.submitVote("p1", "p3", 1_000);
    e.submitVote("p2", "p3", 2_000);

    // Trong pha VOTING, mọi viewer chỉ được thấy số đếm.
    for (const viewer of e.alivePlayers()) {
      expect(e.snapshotFor(viewer.id).dayVoteHistory).toEqual([]);
    }
  });

  it("danh tính phiếu công khai NGAY SAU khi vòng đề cử chốt, và giống nhau với mọi viewer", () => {
    const e = engineAtVoting();
    e.submitVote("p1", "p3", 1_000);
    e.submitVote("p2", "p3", 2_000);
    e.submitVote("p4", null, 3_000);
    e.resolveNomination(25_000, 30_000);

    const views = e.alivePlayers().map((p) => e.snapshotFor(p.id).dayVoteHistory);
    // Không viewer nào được thấy nhiều hơn viewer khác.
    for (const view of views) expect(view).toEqual(views[0]);

    const recap = views[0].at(-1)!;
    expect(recap.finalBallots).toEqual(
      expect.arrayContaining([
        { voterId: "p1", choice: { type: "PLAYER", targetId: "p3" } },
        { voterId: "p2", choice: { type: "PLAYER", targetId: "p3" } },
        { voterId: "p4", choice: { type: "NO_ELIMINATION" } },
      ]),
    );
  });

  it("recap là bản sao: sửa nó không ghi ngược vào state của engine", () => {
    // Nếu snapshotFor trả tham chiếu sống, một bug ở tầng UI/server có thể sửa
    // lịch sử phiếu của ván đang chạy.
    const e = engineAtVoting();
    e.submitVote("p1", "p3", 1_000);
    e.resolveNomination(25_000, 30_000);

    const recap = e.snapshotFor("p1").dayVoteHistory.at(-1)!;
    recap.finalBallots.push({ voterId: "HACKED", choice: { type: "NO_ELIMINATION" } });
    recap.mutations.length = 0;

    const fresh = e.snapshotFor("p1").dayVoteHistory.at(-1)!;
    expect(fresh.finalBallots.map((b) => b.voterId)).not.toContain("HACKED");
    expect(fresh.mutations.length).toBeGreaterThan(0);
  });

  it("recap phiếu không bao giờ chứa mã vai của bất kỳ ai", () => {
    const e = engineAtVoting();
    for (const voter of e.alivePlayers()) e.submitVote(voter.id, "p3", 1_000);
    e.resolveNomination(25_000, 30_000);

    expect(roleCodesIn(e.snapshotFor("p1").dayVoteHistory)).toEqual([]);
  });
});

describe("Phase 1 · bí mật vai tới GAME_OVER", () => {
  it("người sống không thấy vai của bất kỳ ai khác ngoài chính mình", () => {
    const e = engineAtVoting();

    for (const viewer of e.alivePlayers()) {
      const snap = e.snapshotFor(viewer.id);
      const leaked = snap.players.filter(
        (p) => p.role !== undefined && p.id !== viewer.id,
      );
      // Sói được thấy đồng bọn - đó là luật, không phải rò rỉ.
      const viewerRole = e.mustPlayer(viewer.id).role;
      const allowed =
        viewerRole === "WEREWOLF"
          ? leaked.every((p) => p.role === "WEREWOLF")
          : leaked.length === 0;
      expect(allowed).toBe(true);
    }
  });

  it("vai của người CHẾT vẫn ẩn với người đang sống", () => {
    const e = engineAtVoting();
    const victim = e.alivePlayers().find((p) => p.role !== "WEREWOLF")!;
    victim.alive = false;

    const observer = e.alivePlayers().find((p) => p.role !== "WEREWOLF")!;
    const snap = e.snapshotFor(observer.id);
    const dead = snap.players.find((p) => p.id === victim.id)!;

    expect(dead.alive).toBe(false);
    expect(dead.role).toBeUndefined();
  });

  it("BOT knowledge của dân làng không chứa vai người khác, sống hay chết", () => {
    const e = engineAtVoting();
    const villager = e.state.players.find((p) => p.role === "VILLAGER")!;
    const seer = e.state.players.find((p) => p.role === "SEER")!;
    seer.alive = false;

    const view = e.botKnowledgeFor(villager.id);

    expect(view.knownRoles).toEqual({ [villager.id]: "VILLAGER" });
    // Người chết vẫn phải nằm trong danh sách (BOT cần biết ai còn sống),
    // nhưng không kèm vai.
    expect(view.players.map((p) => p.id)).toContain(seer.id);
    expect(roleCodesIn(view.knownRoles)).toEqual(["VILLAGER"]);
  });

  it("BOT Sói chỉ thấy đồng bọn Sói, không thấy vai phe làng", () => {
    const e = engineAtVoting();
    const wolves = e.state.players.filter((p) => p.role === "WEREWOLF");
    const view = e.botKnowledgeFor(wolves[0].id);

    expect(Object.keys(view.knownRoles).sort()).toEqual(
      wolves.map((w) => w.id).sort(),
    );
    expect(Object.values(view.knownRoles).every((r) => r === "WEREWOLF")).toBe(true);
  });

  it("kết quả soi của Tiên Tri không rò sang BOT khác", () => {
    const e = engineAtVoting();
    const seer = e.state.players.find((p) => p.role === "SEER")!;
    const wolf = e.state.players.find((p) => p.role === "WEREWOLF")!;
    e.state.night.seerResults[seer.id] = { targetId: wolf.id, isWolf: true };

    expect(e.botKnowledgeFor(seer.id).seerResult).toMatchObject({
      targetId: wolf.id,
      isWolf: true,
    });

    for (const other of e.state.players) {
      if (other.id === seer.id) continue;
      expect(e.botKnowledgeFor(other.id).seerResult).toBeNull();
    }
  });

  it("toàn bộ BotKnowledgeView của dân làng không chứa mã vai nào ngoài vai của chính mình", () => {
    const e = engineAtVoting();
    const villager = e.state.players.find((p) => p.role === "VILLAGER")!;

    expect(roleCodesIn(e.botKnowledgeFor(villager.id))).toEqual(["VILLAGER"]);
  });
});

describe("Phase 1 · engine thuần", () => {
  it("engine và lõi BOT không import I/O nào", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const root = join(__dirname, "..", "src");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts")) files.push(full);
      }
    };
    walk(root);

    // Bất kỳ thứ nào dưới đây lọt vào engine là biến lõi luật chơi thành thứ
    // không test được nếu không dựng hạ tầng.
    const banned = [
      "ioredis",
      "@prisma/client",
      "socket.io",
      "express",
      "node:fs",
      "node:net",
      "node:http",
    ];

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const mod of banned) {
        if (source.includes(`from "${mod}"`) || source.includes(`require("${mod}")`)) {
          offenders.push(`${file} → ${mod}`);
        }
      }
    }

    expect(offenders).toEqual([]);
    expect(files.length).toBeGreaterThan(10);
  });
});

describe("Phase 1 · quyết định BOT deterministic", () => {
  function contextFor(engine: GameEngine, botId: string): BotDecisionContext {
    return { knowledge: engine.botKnowledgeFor(botId), visibleChat: [] };
  }

  function runOnce(seed: string): unknown {
    const engine = engineAtVoting();
    const bot = engine.state.players.find((p) => p.role === "VILLAGER")!;
    const runtime = new BotRuntime({
      playerId: bot.id,
      rng: createSeededRng(seed),
      playerIds: engine.state.players.map((p) => p.id),
    });

    const decisions: unknown[] = [];
    for (let round = 0; round < 5; round += 1) {
      const context = contextFor(engine, bot.id);
      runtime.observe(context);
      decisions.push(runtime.decideVote(context));
    }
    return { decisions, state: runtime.state };
  }

  it("cùng seed cho ra cùng chuỗi quyết định VÀ cùng state cuối", () => {
    expect(runOnce("audit-seed")).toEqual(runOnce("audit-seed"));
  });

  it("seed khác nhau không phải lúc nào cũng cho cùng personality", () => {
    // Nếu mọi seed ra cùng một BOT thì seed là trang trí, và Phase 2 sẽ xây
    // trên một nền không có đa dạng nào.
    const personalities = new Set(
      Array.from({ length: 24 }, (_, i) => {
        const engine = engineAtVoting();
        const runtime = new BotRuntime({
          playerId: "p1",
          rng: createSeededRng(`seed-${i}`),
          playerIds: engine.state.players.map((p) => p.id),
        });
        return JSON.stringify(runtime.state.personality);
      }),
    );

    expect(personalities.size).toBeGreaterThan(1);
  });

  it("lõi BOT không gọi Math.random: thay thế toàn cục cũng không đổi kết quả", () => {
    const original = Math.random;
    try {
      // Nếu ở đâu đó còn Math.random, hai lần chạy dưới đây sẽ lệch nhau.
      let counter = 0;
      Math.random = () => {
        counter += 1;
        return 0.123456;
      };
      const first = runOnce("no-global-random");

      Math.random = () => {
        counter += 1;
        return 0.987654;
      };
      const second = runOnce("no-global-random");

      expect(first).toEqual(second);
    } finally {
      Math.random = original;
    }
  });
});
