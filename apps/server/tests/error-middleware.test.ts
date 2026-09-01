import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { apiErrorFallback } from "../src/error-middleware";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
});

function app() {
  const instance = express();
  instance.get("/boom-sync", () => {
    throw new Error("boom");
  });
  instance.get("/boom-next", (_req, _res, next) => {
    next(new Error("boom"));
  });
  instance.use(apiErrorFallback);
  return instance;
}

/*
 * index.ts gắn middleware này SAU CÙNG, ngoài apiRouter, để hứng mọi throw
 * đồng bộ hay next(err) lọt khỏi route/middleware phía trên - không có nó,
 * Express rơi về finalhandler mặc định: trả nguyên err.stack (dev) hoặc HTML
 * "Internal Server Error" (prod), cả hai đều không phải { error: "..." }
 * tiếng Việt. avatar-routes.test.ts dựng app Express riêng và không bao giờ
 * chạm tới index.ts, nên middleware này trước đây không có test nào - xoá nó
 * khỏi index.ts vẫn để cả suite xanh. Test dưới đây lấp đúng lỗ đó.
 */
describe("apiErrorFallback", () => {
  it("throw đồng bộ trong route: trả JSON tiếng Việt 500, không phải stack trace", async () => {
    const res = await request(app()).get("/boom-sync");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Đã có lỗi xảy ra, thử lại sau" });
    expect(res.text).not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });

  it("next(err) từ route: trả JSON tiếng Việt 500", async () => {
    const res = await request(app()).get("/boom-next");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Đã có lỗi xảy ra, thử lại sau" });
  });

  it("response đã gửi dở thì không ghi đè - giao lại cho next(err)", () => {
    const next = vi.fn();
    const res = { headersSent: true, status: vi.fn(), json: vi.fn() } as unknown as Parameters<
      typeof apiErrorFallback
    >[2];

    apiErrorFallback(new Error("đã gửi rồi"), {} as never, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});
