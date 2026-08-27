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

  it("uses 4000 only when no port is configured", () => {
    expect(resolvePort({})).toBe(4000);
  });

  it.each(["invalid", "0", "-1", "1.5", "65536"])(
    "rejects an invalid configured port: %s",
    (value) => {
      expect(() => resolvePort({ PORT: value })).toThrow(/PORT/);
    },
  );

  it("rejects an invalid local SERVER_PORT too", () => {
    expect(() => resolvePort({ SERVER_PORT: "nope" })).toThrow(/SERVER_PORT/);
  });
});

describe("healthHttpStatus", () => {
  it("keeps liveness healthy during a degraded Redis outage", () => {
    expect(healthHttpStatus({ db: true, redis: true })).toBe(200);
    expect(healthHttpStatus({ db: false, redis: true })).toBe(503);
    expect(healthHttpStatus({ db: true, redis: false })).toBe(200);
  });
});
