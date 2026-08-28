import { describe, expect, it } from "vitest";
import { buildVersion, healthHttpStatus, redisConnectionHealthy } from "../src/health";
import { resolveBotAiMaxCallsPerGame, resolvePort } from "../src/config";

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

describe("resolveBotAiMaxCallsPerGame", () => {
  it("mặc định 180 khi không cấu hình", () => {
    // Nâng từ 60 khi thêm phiên toà: một ván 8 bot × 6 vòng tốn ~126 lượt gọi.
    expect(resolveBotAiMaxCallsPerGame({})).toBe(180);
  });

  it("dùng giá trị hợp lệ do vận hành đặt", () => {
    expect(resolveBotAiMaxCallsPerGame({ BOT_AI_MAX_CALLS_PER_GAME: "120" })).toBe(120);
  });

  // "" nằm trong danh sách vì đây là cách âm thầm nhất để dính lỗi này:
  // BOT_AI_MAX_CALLS_PER_GAME= trong .env, hay biến bị nền tảng deploy vật
  // chất hoá thành "" khi không đặt, sẽ ra Number("") === 0, không bị "??"
  // bắt (nó chỉ bắt null/undefined) - phải bị chặn ở đây, không được lọt qua.
  it.each(["invalid", "0", "-1", "1.5", "NaN", ""])(
    "ném lỗi thay vì âm thầm ra NaN hoặc 0 (cả hai đều khiến Gemini không bao giờ chạy, không log): %s",
    (value) => {
      expect(() => resolveBotAiMaxCallsPerGame({ BOT_AI_MAX_CALLS_PER_GAME: value })).toThrow(
        /BOT_AI_MAX_CALLS_PER_GAME/,
      );
    },
  );
});

describe("healthHttpStatus", () => {
  it("keeps liveness healthy during a degraded Redis outage", () => {
    expect(healthHttpStatus({ db: true, redis: true })).toBe(200);
    expect(healthHttpStatus({ db: false, redis: true })).toBe(503);
    expect(healthHttpStatus({ db: true, redis: false })).toBe(200);
  });
});

describe("redisConnectionHealthy", () => {
  it("reads the existing Redis connection state without waiting on a command", () => {
    expect(redisConnectionHealthy("ready")).toBe(true);
    expect(redisConnectionHealthy("reconnecting")).toBe(false);
    expect(redisConnectionHealthy("end")).toBe(false);
  });
});

describe("buildVersion", () => {
  it("rút gọn SHA của Render thành 7 ký tự", () => {
    expect(buildVersion({ RENDER_GIT_COMMIT: "05f3d3812ab4c9d0e1f2" })).toBe("05f3d38");
  });

  it("ưu tiên GIT_COMMIT đặt tay hơn biến của Render", () => {
    expect(buildVersion({ GIT_COMMIT: "abcdef1234", RENDER_GIT_COMMIT: "9999999" })).toBe("abcdef1");
  });

  it.each(["", "   "])("coi giá trị rỗng như không khai báo: %s", (value) => {
    expect(buildVersion({ GIT_COMMIT: value, RENDER_GIT_COMMIT: "05f3d38" })).toBe("05f3d38");
    expect(buildVersion({ GIT_COMMIT: value })).toBe("dev");
  });

  it("trả về dev khi chạy ngoài môi trường deploy", () => {
    expect(buildVersion({})).toBe("dev");
  });
});
