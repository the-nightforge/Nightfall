import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";

/**
 * `GET /players/me/stats`: đọc hết ván của người hỏi, không giới hạn 20, và
 * gộp bằng đúng phép đọc "ai thắng" của trang lịch sử.
 *
 * Kho giả ghi lại câu SQL để khẳng định hai điều mà chỉ câu SQL nói được: chốt
 * "người hỏi có trong ván" nằm trong WHERE, và không có LIMIT.
 */
const db = vi.hoisted(() => ({
  players: new Map<string, { id: string }>(),
  tokenHashes: new Map<string, string>(),
  rows: [] as Array<Record<string, unknown>>,
  sql: [] as string[],
}));

vi.mock("../src/db", () => ({
  prisma: {
    player: {
      findUnique: async ({ where }: { where: { tokenHash?: string } }) => {
        const id = where.tokenHash ? db.tokenHashes.get(where.tokenHash) : undefined;
        return id ? db.players.get(id) ?? null : null;
      },
    },
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      db.sql.push(sql);
      if (!sql.includes('FROM "GameResult"')) return [];
      const viewerId = (JSON.parse(values[0] as string) as Array<{ id: string }>)[0]!.id;
      return db.rows.filter((row) =>
        (row.playerRoles as Array<{ id?: string }>).some((p) => p.id === viewerId),
      );
    },
  },
}));

vi.mock("../src/redis", () => ({ redis: { status: "ready" } }));

const { apiRouter } = await import("../src/http");

const app = express();
app.use("/api", apiRouter);

function register(playerId: string, token: string): void {
  db.players.set(playerId, { id: playerId });
  db.tokenHashes.set(createHash("sha256").update(token).digest("hex"), playerId);
}

register("me", "token-me");
register("nobody", "token-nobody");

let n = 0;
function row(winner: string, myRole: string, alive: boolean, extra: Record<string, unknown> = {}) {
  n += 1;
  return {
    id: `m${n}`,
    roomCode: "ABCDE",
    winner,
    round: 3,
    durationSec: 500,
    playerRoles: [
      { id: "me", name: "Tôi", role: myRole, alive, ...extra },
      { id: "bot-1", name: "Bot", role: "VILLAGER", alive: true },
    ],
    caseFile: null,
    createdAt: new Date(1_000_000 - n * 1000),
  };
}

db.rows.push(
  row("village", "SEER", true),
  row("wolves", "SEER", false),
  row("wolves", "WEREWOLF", true),
  row("wolves", "JESTER", false, { personalWin: { condition: "JESTER_LYNCHED", round: 2 } }),
  // Ván cũ: không có id -> không khớp ai, không được đếm.
  { ...row("village", "VILLAGER", true), playerRoles: [{ name: "Ai đó", role: "VILLAGER", alive: true }] },
);

describe("GET /players/me/stats", () => {
  it("không token thì 401", async () => {
    const res = await request(app).get("/api/players/me/stats");
    expect(res.status).toBe(401);
  });

  it("gộp đúng: thắng theo phe và thắng cá nhân, chuỗi, sống sót, theo vai", async () => {
    const res = await request(app).get("/api/players/me/stats").set("authorization", "Bearer token-me");
    expect(res.status).toBe(200);
    const stats = res.body.stats;
    expect(stats.games).toBe(4);
    // SEER thắng ván 1, WEREWOLF thắng ván 3, JESTER thắng cá nhân ván 4.
    expect(stats.wins).toBe(3);
    expect(stats.personalWins).toBe(1);
    expect(stats.survived).toBe(2);
    // Mới nhất là ván 1 (createdAt lớn nhất): thắng; ván 2 thua -> chuỗi 1.
    expect(stats.currentStreak).toBe(1);
    expect(stats.byRole[0]).toEqual({ role: "SEER", games: 2, wins: 1 });
    expect(stats.byTeam.wolves).toEqual({ games: 1, wins: 1 });
  });

  it("người chưa chơi ván nào nhận hồ sơ rỗng, không phải lỗi", async () => {
    const res = await request(app).get("/api/players/me/stats").set("authorization", "Bearer token-nobody");
    expect(res.status).toBe(200);
    expect(res.body.stats.games).toBe(0);
    expect(res.body.stats.lastPlayedAt).toBeNull();
  });

  it("câu SQL lọc theo người hỏi và KHÔNG giới hạn số dòng", async () => {
    db.sql.length = 0;
    await request(app).get("/api/players/me/stats").set("authorization", "Bearer token-me");
    const sql = db.sql.find((q) => q.includes('FROM "GameResult"'))!;
    expect(sql).toContain('"playerRoles" @>');
    expect(sql).not.toMatch(/LIMIT/i);
    // Không kéo cột nặng nhất của bảng cho một việc không cần tới nó.
    expect(sql).toContain('NULL AS "caseFile"');
  });
});
