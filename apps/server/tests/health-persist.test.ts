import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

/*
 * `persistMaxBytes` trong `GET /health` là chỉ số nuôi quyết định gộp ghi:
 * nó cho biết envelope lớn nhất đã đi qua, và người vận hành đọc nó để biết
 * có cần gom các lần ghi của một phòng vào một batch hay không. Không có test
 * nào chốt sự tồn tại của trường này thì một lần refactor vô tình đổi tên hay
 * xoá nó sẽ trôi qua êm - và cái metric quyết định batching mất tích không ai
 * hay cho tới lúc cần đọc.
 */
vi.mock("../src/db", () => ({
  prisma: {
    $queryRaw: async () => [{ one: 1 }],
  },
}));

// `redisConnectionHealthy` coi kết nối là sống khi status === "ready".
vi.mock("../src/redis", () => ({ redis: { status: "ready" } }));

const { apiRouter } = await import("../src/http");

const app = express();
app.use("/api", apiRouter);

describe("GET /health", () => {
  it("trả persistMaxBytes dạng số - chỉ số quyết định gộp ghi", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(typeof res.body.persistMaxBytes).toBe("number");
  });
});
