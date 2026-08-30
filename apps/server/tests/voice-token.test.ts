import { describe, expect, it } from "vitest";
import { TrackSource } from "@livekit/protocol";
import { resolveVoiceConfig } from "../src/config";
import {
  TOKEN_TTL_SECONDS,
  apiUrl,
  browserUrl,
  joinTokenGrant,
  mintJoinToken,
  participantPermission,
} from "../src/voice/livekit";

const CONFIG = {
  url: "wss://demo.livekit.cloud",
  apiKey: "APIkey123",
  apiSecret: "secret-value-long-enough-for-hmac",
  env: "test",
};

function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

describe("resolveVoiceConfig", () => {
  it("thiếu hết thì voice tắt, phần còn lại của server chạy y như cũ", () => {
    expect(resolveVoiceConfig({})).toEqual({ enabled: false });
  });

  it("đủ bốn biến thì bật", () => {
    const resolved = resolveVoiceConfig({
      LIVEKIT_URL: CONFIG.url,
      LIVEKIT_API_KEY: CONFIG.apiKey,
      LIVEKIT_API_SECRET: CONFIG.apiSecret,
      LIVEKIT_ENV: "prod",
    });
    expect(resolved).toEqual({ enabled: true, ...CONFIG, env: "prod" });
  });

  it("thiếu LIVEKIT_ENV thì mặc định 'dev' chứ không tắt voice", () => {
    const resolved = resolveVoiceConfig({
      LIVEKIT_URL: CONFIG.url,
      LIVEKIT_API_KEY: CONFIG.apiKey,
      LIVEKIT_API_SECRET: CONFIG.apiSecret,
    });
    expect(resolved).toEqual({ enabled: true, ...CONFIG, env: "dev" });
  });

  /**
   * Cấu hình hỏng một nửa phải nổ lúc khởi động, không được âm thầm tắt.
   * Comment dài trong config.ts về BOT_AI_MAX_CALLS_PER_GAME đã kể vì sao im
   * lặng nuốt cấu hình hỏng là cái bẫy: tính năng tắt ngấm ngầm, không log.
   */
  for (const missing of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"]) {
    it(`thiếu mỗi ${missing} thì ném lỗi chứ không âm thầm tắt`, () => {
      const env: Record<string, string> = {
        LIVEKIT_URL: CONFIG.url,
        LIVEKIT_API_KEY: CONFIG.apiKey,
        LIVEKIT_API_SECRET: CONFIG.apiSecret,
      };
      delete env[missing];
      expect(() => resolveVoiceConfig(env)).toThrow(/LIVEKIT/);
    });
  }

  it("rỗng một phần, có giá trị thật ở phần còn lại: vẫn là hỏng một nửa", () => {
    expect(() =>
      resolveVoiceConfig({
        LIVEKIT_URL: CONFIG.url,
        LIVEKIT_API_KEY: "",
        LIVEKIT_API_SECRET: CONFIG.apiSecret,
      }),
    ).toThrow(/LIVEKIT/);
  });

  /**
   * `.env.example` khai báo sẵn ba khoá với giá trị rỗng. Copy template về mà
   * server nổ lúc khởi động là hỏng đường vào của người mới - rỗng phải tính
   * như chưa đặt, không phải như hỏng.
   */
  it("copy nguyên .env.example (cả ba rỗng) thì voice tắt, không ném lỗi", () => {
    expect(
      resolveVoiceConfig({
        LIVEKIT_URL: "",
        LIVEKIT_API_KEY: "",
        LIVEKIT_API_SECRET: "",
        LIVEKIT_ENV: "dev",
      }),
    ).toEqual({ enabled: false });
  });

  it("khoảng trắng thừa quanh giá trị không làm hỏng cấu hình", () => {
    expect(
      resolveVoiceConfig({
        LIVEKIT_URL: `  ${CONFIG.url}  `,
        LIVEKIT_API_KEY: CONFIG.apiKey,
        LIVEKIT_API_SECRET: CONFIG.apiSecret,
      }),
    ).toEqual({ enabled: true, ...CONFIG, env: "dev" });
  });
});

describe("joinTokenGrant - ghim toàn bộ grant, không dựa vào mặc định", () => {
  const grant = joinTokenGrant("masoi-test-ABCDE");

  it("không bao giờ cấp quyền nói", () => {
    expect(grant.canPublish).toBe(false);
  });

  /**
   * Bẫy: SDK ghi rõ canPublishSources "supersedes CanPublish". Liệt kê
   * microphone ở đây sẽ CHO PHÉP nói dù canPublish là false, phá đúng lý do
   * token tồn tại. Danh sách nguồn chỉ được xuất hiện lúc cấp quyền qua
   * updateParticipant, không bao giờ nằm trong token.
   */
  it("KHÔNG mang canPublishSources, vì nó ghi đè canPublish", () => {
    expect(grant.canPublishSources).toBeUndefined();
  });

  it("đóng kênh dữ liệu - mặc định của LiveKit là MỞ", () => {
    expect(grant.canPublishData).toBe(false);
  });

  it("cho nghe, không cho tự sửa metadata, không ẩn mình", () => {
    expect(grant.canSubscribe).toBe(true);
    expect(grant.canUpdateOwnMetadata).toBe(false);
    expect(grant.hidden).toBe(false);
  });

  it("chỉ vào đúng room được chỉ định, không có quyền quản trị", () => {
    expect(grant.roomJoin).toBe(true);
    expect(grant.room).toBe("masoi-test-ABCDE");
    expect(grant.roomAdmin).toBeUndefined();
    expect(grant.roomCreate).toBeUndefined();
    expect(grant.roomList).toBeUndefined();
  });

  it("khoá đúng bộ trường - thêm trường mới phải sửa test này có ý thức", () => {
    expect(Object.keys(grant).sort()).toEqual(
      [
        "canPublish",
        "canPublishData",
        "canSubscribe",
        "canUpdateOwnMetadata",
        "hidden",
        "room",
        "roomJoin",
      ].sort(),
    );
  });
});

describe("participantPermission - quyền nói chỉ đến từ đây", () => {
  it("cấp quyền thì giới hạn đúng microphone", () => {
    const allowed = participantPermission(true);
    expect(allowed.canPublish).toBe(true);
    expect(allowed.canPublishSources).toEqual([TrackSource.MICROPHONE]);
    expect(allowed.canPublishData).toBe(false);
    expect(allowed.canSubscribe).toBe(true);
  });

  it("thu quyền thì bỏ luôn danh sách nguồn", () => {
    const denied = participantPermission(false);
    expect(denied.canPublish).toBe(false);
    expect(denied.canPublishSources).toEqual([]);
    expect(denied.canSubscribe).toBe(true);
  });

  /**
   * Tên trường khác nhau giữa hai tầng và rất dễ gõ nhầm: token (VideoGrant)
   * dùng `canUpdateOwnMetadata`, còn quyền lúc chạy (ParticipantPermission)
   * dùng `canUpdateMetadata`. Gõ nhầm thì trường bị bỏ qua im lặng.
   */
  it("luôn gửi bộ đầy đủ: LiveKit cập nhật quyền theo kiểu thay thế", () => {
    for (const can of [true, false]) {
      expect(Object.keys(participantPermission(can)).sort()).toEqual(
        [
          "canPublish",
          "canPublishData",
          "canPublishSources",
          "canSubscribe",
          "canUpdateMetadata",
          "hidden",
        ].sort(),
      );
    }
  });
});

describe("mintJoinToken", () => {
  // SDK không phát `iat`, chỉ phát `nbf` và `exp`.
  it("token sống đúng 120 giây - đủ để join, không đủ để giữ", async () => {
    const token = await mintJoinToken(CONFIG, "masoi-test-ABCDE", "player-1", "Bình");
    const payload = decodeJwtPayload(token);
    expect(TOKEN_TTL_SECONDS).toBe(120);
    expect((payload.exp as number) - (payload.nbf as number)).toBe(TOKEN_TTL_SECONDS);
  });

  it("identity là playerId, không sinh id thứ hai", async () => {
    const token = await mintJoinToken(CONFIG, "masoi-test-ABCDE", "player-1", "Bình");
    expect(decodeJwtPayload(token).sub).toBe("player-1");
  });

  it("grant trong token đúng bằng joinTokenGrant", async () => {
    const token = await mintJoinToken(CONFIG, "masoi-test-ABCDE", "player-1", "Bình");
    const video = decodeJwtPayload(token).video as Record<string, unknown>;
    expect(video.canPublish).toBe(false);
    expect(video.canPublishData).toBe(false);
    expect(video.canSubscribe).toBe(true);
    expect(video.room).toBe("masoi-test-ABCDE");
    expect(video.canPublishSources).toBeUndefined();
  });
});

describe("tách scheme - trình duyệt dùng wss, RoomServiceClient dùng https", () => {
  it("đổi được cả hai chiều", () => {
    expect(browserUrl("https://demo.livekit.cloud")).toBe("wss://demo.livekit.cloud");
    expect(browserUrl("wss://demo.livekit.cloud")).toBe("wss://demo.livekit.cloud");
    expect(apiUrl("wss://demo.livekit.cloud")).toBe("https://demo.livekit.cloud");
    expect(apiUrl("https://demo.livekit.cloud")).toBe("https://demo.livekit.cloud");
  });

  it("giữ nguyên host và đường dẫn, cắt dấu / thừa ở cuối", () => {
    expect(apiUrl("wss://demo.livekit.cloud/")).toBe("https://demo.livekit.cloud");
    expect(browserUrl("http://localhost:7880")).toBe("ws://localhost:7880");
    expect(apiUrl("ws://localhost:7880")).toBe("http://localhost:7880");
  });
});
