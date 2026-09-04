import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createHash } from "node:crypto";

/**
 * Kho giả bé nhất còn nói thật được về quyền đọc.
 *
 * `$queryRaw` được nhận qua template tag, nên bài test đọc chính đoạn SQL để
 * biết route đang hỏi câu nào - đó là cách duy nhất kiểm được rằng chốt "người
 * hỏi có trong ván đó không" nằm TRONG câu SQL chứ không phải một phép lọc
 * trong JS mà một lần sửa vô ý có thể bỏ đi.
 */
const db = vi.hoisted(() => ({
  players: new Map<string, { id: string }>(),
  tokenHashes: new Map<string, string>(),
  /** matchId -> danh sách playerId có mặt trong ván. */
  matches: new Map<string, string[]>(),
  /** matchId -> chat, CỐ Ý cất theo thứ tự lộn xộn. */
  chat: new Map<
    string,
    Array<{
      seq: number;
      channel: string;
      actorId: string;
      actorName: string;
      text: string;
      round: number;
      phase: string;
      createdAt: Date;
    }>
  >(),
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

      if (sql.includes('FROM "MatchChatMessage"')) {
        const [matchId, viewerJson] = values as [string, string];
        const viewerId = (JSON.parse(viewerJson) as Array<{ id: string }>)[0]!.id;
        if (!(db.matches.get(matchId) ?? []).includes(viewerId)) return [];
        return [...(db.chat.get(matchId) ?? [])].sort((a, b) => a.seq - b.seq);
      }

      if (sql.includes('FROM "GameResult"')) {
        const [matchId, viewerJson] = values as [string, string];
        const viewerId = (JSON.parse(viewerJson) as Array<{ id: string }>)[0]!.id;
        return (db.matches.get(matchId) ?? []).includes(viewerId) ? [{ one: 1 }] : [];
      }

      return [];
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

register("in-match", "token-in");
register("outsider", "token-out");

db.matches.set("m1", ["in-match", "someone-else"]);
db.chat.set("m1", [
  {
    seq: 2,
    channel: "dead",
    actorId: "someone-else",
    actorName: "Người khác",
    text: "tiếc quá",
    round: 2,
    phase: "NIGHT",
    createdAt: new Date(3_000),
  },
  {
    seq: 0,
    channel: "day",
    actorId: "in-match",
    actorName: "Tôi",
    text: "tôi là tt",
    round: 1,
    phase: "DAY_DISCUSSION",
    createdAt: new Date(1_000),
  },
  {
    seq: 1,
    channel: "wolves",
    actorId: "someone-else",
    actorName: "Người khác",
    text: "ăn nó đi",
    round: 1,
    phase: "NIGHT",
    createdAt: new Date(2_000),
  },
]);
db.matches.set("m-empty", ["in-match"]);

describe("GET /players/me/matches/:id/chat", () => {
  it("người trong ván đọc được TOÀN BỘ kênh, đúng thứ tự seq", async () => {
    const res = await request(app)
      .get("/api/players/me/matches/m1/chat")
      .set("authorization", "Bearer token-in");

    expect(res.status).toBe(200);
    // Kênh sói và kênh người chết đều có mặt: ở GAME_OVER `visibleChatLog` đã
    // mở toàn bộ log cho cả phòng, nên giấu lại ở đây là nói dối về một thứ họ
    // vừa đọc xong bằng mắt.
    expect(res.body.messages.map((m: { channel: string }) => m.channel)).toEqual([
      "day",
      "wolves",
      "dead",
    ]);
    expect(res.body.messages[0]).toMatchObject({
      seq: 0,
      text: "tôi là tt",
      actorName: "Tôi",
      round: 1,
      phase: "DAY_DISCUSSION",
      at: 1_000,
    });
  });

  it("người NGOÀI ván không đọc được, và không phân biệt được ván đó có thật không", async () => {
    const outsider = await request(app)
      .get("/api/players/me/matches/m1/chat")
      .set("authorization", "Bearer token-out");
    const ghost = await request(app)
      .get("/api/players/me/matches/khong-co-that/chat")
      .set("authorization", "Bearer token-out");

    expect(outsider.status).toBe(404);
    expect(ghost.status).toBe(404);
    // Hai câu trả lời phải GIỐNG HỆT nhau: khác nhau là một đường dò xem một
    // matchId có thật hay không, và ai đã chơi ván đó.
    expect(outsider.body).toEqual(ghost.body);
  });

  it("thiếu token thì 401, không đụng tới DB", async () => {
    db.sql.length = 0;
    const res = await request(app).get("/api/players/me/matches/m1/chat");

    expect(res.status).toBe(401);
    expect(db.sql).toEqual([]);
  });

  it("quyền đọc nằm trong chính câu SQL, không phải một phép lọc ở JS", async () => {
    db.sql.length = 0;
    await request(app)
      .get("/api/players/me/matches/m1/chat")
      .set("authorization", "Bearer token-in");

    expect(db.sql[0]).toContain('"playerRoles" @>');
    expect(db.sql[0]).toContain('ORDER BY m."seq" ASC');
  });

  it("ván có thật, mình có mặt, nhưng không ai nói câu nào: 200 với mảng rỗng", async () => {
    // Rỗng vì im lặng KHÁC rỗng vì không có quyền. Trả 404 ở đây sẽ nói với
    // người chơi rằng ván của chính họ không tồn tại.
    const res = await request(app)
      .get("/api/players/me/matches/m-empty/chat")
      .set("authorization", "Bearer token-in");

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
  });
});
