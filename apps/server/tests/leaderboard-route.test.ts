import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";

/**
 * `GET /leaderboard`: công khai, Bearer tuỳ chọn, cache 60 giây.
 */
const db = vi.hoisted(() => ({
  players: new Map<string, { id: string; nickname: string; avatarUrl: string | null }>(),
  tokenHashes: new Map<string, string>(),
  results: [] as Array<{ id: string; winner: string; createdAt: Date; playerRoles: unknown }>,
  findManyCalls: 0,
}));

vi.mock("../src/db", () => ({
  prisma: {
    player: {
      findUnique: async ({ where }: { where: { tokenHash?: string } }) => {
        const id = where.tokenHash ? db.tokenHashes.get(where.tokenHash) : undefined;
        return id ? db.players.get(id) ?? null : null;
      },
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => db.players.get(id)).filter((p): p is NonNullable<typeof p> => !!p),
    },
    gameResult: {
      findMany: async ({ where }: { where: { createdAt: { gte: Date } } }) => {
        db.findManyCalls += 1;
        return db.results.filter((r) => r.createdAt >= where.createdAt.gte);
      },
    },
  },
}));

vi.mock("../src/redis", () => ({ redis: { status: "ready" } }));

const { apiRouter } = await import("../src/http");
const { invalidateLeaderboard } = await import("../src/leaderboard");

const app = express();
app.use("/api", apiRouter);

function register(id: string, nickname: string, token: string): void {
  db.players.set(id, { id, nickname, avatarUrl: null });
  db.tokenHashes.set(createHash("sha256").update(token).digest("hex"), id);
}
for (const [id, name] of [["h1", "An"], ["h2", "Bình"], ["h3", "Chi"], ["h4", "Dũng"], ["h5", "Em"]]) {
  register(id, name, `token-${id}`);
}

const seat = (id: string, role: string, alive: boolean) => ({ id, name: id, role, alive });
let n = 0;
function table(winner: string, daysAgo = 1) {
  n += 1;
  db.results.push({
    id: `m${n}`,
    winner,
    createdAt: new Date(Date.now() - daysAgo * 86_400_000),
    playerRoles: [
      seat("h1", "SEER", true),
      seat("h2", "WEREWOLF", false),
      seat("h3", "VILLAGER", true),
      seat("h4", "GUARD", false),
      seat("bot-1", "VILLAGER", true),
      seat("bot-2", "VILLAGER", true),
      seat("bot-3", "VILLAGER", true),
      seat("bot-4", "VILLAGER", true),
    ],
  });
}
table("village");
table("village");
table("village");
// h5 chỉ có một ván 4 người thật -> chưa đủ.
db.results.push({
  id: "m-h5",
  winner: "village",
  createdAt: new Date(),
  playerRoles: [seat("h5", "SEER", true), seat("h1", "GUARD", true), seat("h2", "GUARD", true), seat("h3", "GUARD", true)],
});

describe("GET /leaderboard", () => {
  it("không cần token: trả bảng đã xếp hạng, không có dòng 'của bạn'", async () => {
    invalidateLeaderboard();
    const res = await request(app).get("/api/leaderboard");
    expect(res.status).toBe(200);
    expect(res.body.entries.map((e: { nickname: string }) => e.nickname)).toEqual(["An", "Chi", "Dũng", "Bình"]);
    expect(res.body.entries[0]).toMatchObject({ rank: 1, points: 4 * 12, games: 4, wins: 4 });
    expect(res.body.me).toBeNull();
    expect(res.body.myGames).toBe(0);
    expect(res.body).toMatchObject({ windowDays: 30, minGames: 3, minHumans: 4 });
  });

  it("có token: thêm dòng của mình và số ván đã tính", async () => {
    const res = await request(app).get("/api/leaderboard").set("authorization", "Bearer token-h3");
    expect(res.status).toBe(200);
    expect(res.body.me).toMatchObject({ rank: 2, nickname: "Chi" });
    expect(res.body.myGames).toBe(4);
  });

  it("chưa đủ ván thì me = null nhưng myGames vẫn đếm, để nói 'còn N ván nữa'", async () => {
    const res = await request(app).get("/api/leaderboard").set("authorization", "Bearer token-h5");
    expect(res.body.me).toBeNull();
    expect(res.body.myGames).toBe(1);
  });

  it("token hỏng không làm mất bảng", async () => {
    const res = await request(app).get("/api/leaderboard").set("authorization", "Bearer rac");
    expect(res.status).toBe(200);
    expect(res.body.entries.length).toBe(4);
    expect(res.body.me).toBeNull();
  });

  it("cache: nhiều request trong một phút chỉ hỏi DB một lần", async () => {
    invalidateLeaderboard();
    db.findManyCalls = 0;
    await request(app).get("/api/leaderboard");
    await request(app).get("/api/leaderboard").set("authorization", "Bearer token-h1");
    await request(app).get("/api/leaderboard");
    expect(db.findManyCalls).toBe(1);
  });
});
