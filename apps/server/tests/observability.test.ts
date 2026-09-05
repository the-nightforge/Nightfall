import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  attachExpressErrorReporter,
  flushObservability,
  initObservability,
  observabilityEnabled,
  reportError,
  resolveSentryDsn,
} from "../src/observability";
import { apiErrorFallback } from "../src/error-middleware";

/*
 * Chỉ kiểm nhánh KHÔNG có DSN. Nhánh có DSN gọi thẳng Sentry.init và bắt đầu
 * gửi sự kiện ra ngoài - không phải thứ một bộ test đơn vị nên làm. Điều đáng
 * gác ở đây là lời hứa "không có SENTRY_DSN thì server chạy y như trước".
 */
describe("resolveSentryDsn", () => {
  it("chuỗi rỗng hay toàn khoảng trắng tính như chưa đặt", () => {
    expect(resolveSentryDsn({})).toBeNull();
    expect(resolveSentryDsn({ SENTRY_DSN: "" })).toBeNull();
    expect(resolveSentryDsn({ SENTRY_DSN: "   " })).toBeNull();
    expect(resolveSentryDsn({ SENTRY_DSN: " https://k@o1.ingest.sentry.io/1 " })).toBe(
      "https://k@o1.ingest.sentry.io/1",
    );
  });
});

describe("observability khi không có SENTRY_DSN", () => {
  it("initObservability trả false và mọi hàm còn lại là no-op", async () => {
    expect(initObservability({})).toBe(false);
    expect(observabilityEnabled()).toBe(false);
    expect(() => reportError(new Error("x"), { socketEvent: "room:join" })).not.toThrow();
    await expect(flushObservability()).resolves.toBeUndefined();
  });

  it("attachExpressErrorReporter không đổi hành vi của apiErrorFallback", async () => {
    const app = express();
    app.get("/boom", () => {
      throw new Error("boom");
    });
    attachExpressErrorReporter(app);
    app.use(apiErrorFallback);

    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Đã có lỗi xảy ra, thử lại sau" });
  });
});
