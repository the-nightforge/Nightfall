import { describe, expect, it } from "vitest";
import express from "express";
import cors from "cors";
import request from "supertest";
import { securityHeaders } from "../src/security";

/*
 * Dựng app theo đúng thứ tự của index.ts: securityHeaders TRƯỚC cors. Thứ tự
 * đó là điều test này gác - đảo lại thì phản hồi preflight (OPTIONS) do cors
 * kết thúc sớm sẽ không mang header nào.
 */
function app() {
  const instance = express();
  instance.use(securityHeaders());
  instance.use(cors({ origin: ["https://masoi.example"] }));
  instance.get("/api/health", (_req, res) => res.json({ ok: true }));
  return instance;
}

describe("securityHeaders", () => {
  it("phản hồi JSON mang HSTS, nosniff và frame-ancestors chặn nhúng", async () => {
    const res = await request(app()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("preflight CORS vẫn mang header an toàn và vẫn cho origin đã khai", async () => {
    const res = await request(app())
      .options("/api/health")
      .set("Origin", "https://masoi.example")
      .set("Access-Control-Request-Method", "GET");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://masoi.example");
    expect(res.headers["strict-transport-security"]).toBeDefined();
  });

  it("không chặn fetch CORS từ frontend: CORP same-origin chỉ áp cho nhúng no-cors", async () => {
    const res = await request(app()).get("/api/health").set("Origin", "https://masoi.example");
    expect(res.headers["access-control-allow-origin"]).toBe("https://masoi.example");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });
});
