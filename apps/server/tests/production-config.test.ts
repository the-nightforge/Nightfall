import { describe, expect, it } from "vitest";
import { healthHttpStatus } from "../src/health";
import { resolvePort } from "../src/config";

describe("resolvePort", () => {
  it("prefers the platform-provided PORT", () => {
    expect(resolvePort({ PORT: "8080", SERVER_PORT: "4100" })).toBe(8080);
  });

  it("uses SERVER_PORT for local development", () => {
    expect(resolvePort({ SERVER_PORT: "4100" })).toBe(4100);
  });

  it("falls back safely when the configured port is invalid", () => {
    expect(resolvePort({ PORT: "invalid" })).toBe(4000);
  });
});

describe("healthHttpStatus", () => {
  it("returns success only when PostgreSQL and Redis are healthy", () => {
    expect(healthHttpStatus({ db: true, redis: true })).toBe(200);
    expect(healthHttpStatus({ db: false, redis: true })).toBe(503);
    expect(healthHttpStatus({ db: true, redis: false })).toBe(503);
  });
});
