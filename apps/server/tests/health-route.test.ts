import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

/**
 * VÌ SAO file này tồn tại: `deploy/deploy.sh` đếm ván đang chạy bằng cách grep
 * nguyên văn `"activeGames":[0-9]*` trong body của /api/health. TÊN TRƯỜNG
 * chính là giao kèo - đổi tên nó (vd. `activeGameCount`) vẫn qua mọi test
 * khác, nhưng drain thành no-op lặng lẽ: grep không khớp -> `active` rỗng ->
 * script thay container ngay giữa ván của người đang chơi.
 * Test này ghim đúng chuỗi bytes mà script đó đi tìm.
 */
const db = vi.hoisted(() => ({ queryRawFails: false }));

vi.mock("../src/db", () => ({
  prisma: {
    $queryRaw: async () => {
      if (db.queryRawFails) throw new Error("db down");
      return [{ one: 1 }];
    },
  },
}));

vi.mock("../src/redis", () => ({ redis: { status: "ready" } }));

const { apiRouter } = await import("../src/http");

const app = express();
app.use("/api", apiRouter);

describe("GET /health", () => {
  it("trả trường `activeGames` dạng số - đúng chuỗi mà deploy.sh grep", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("activeGames");
    expect(typeof res.body.activeGames).toBe("number");
    // Ghim cả dạng bytes thô: grep cần `"activeGames":` rồi ngay sau là chữ số.
    expect(res.text).toMatch(/"activeGames":\d+/);
  });

  it("trường được emit vô điều kiện - kể cả khi DB chết và response là 503", async () => {
    db.queryRawFails = true;
    try {
      const res = await request(app).get("/api/health");
      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty("activeGames");
      expect(typeof res.body.activeGames).toBe("number");
    } finally {
      db.queryRawFails = false;
    }
  });
});
