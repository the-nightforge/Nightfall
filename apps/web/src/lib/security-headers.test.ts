import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentSecurityPolicy,
  securityHeaders,
  sentryIngestOrigin,
  serverConnectSources,
} from "./security-headers";

function directive(csp: string, name: string): string[] {
  const found = csp
    .split("; ")
    .map((part) => part.split(" "))
    .find(([n]) => n === name);
  assert.ok(found, `CSP thiếu chỉ thị ${name}: ${csp}`);
  return found.slice(1);
}

describe("serverConnectSources", () => {
  it("URL https ra cặp https + wss, URL http ra cặp http + ws - Socket.IO thử cả hai", () => {
    assert.deepEqual(serverConnectSources("https://ma-soi-server.onrender.com"), [
      "https://ma-soi-server.onrender.com",
      "wss://ma-soi-server.onrender.com",
    ]);
    assert.deepEqual(serverConnectSources("http://localhost:4200"), [
      "http://localhost:4200",
      "ws://localhost:4200",
    ]);
  });

  it("URL hỏng thì bỏ qua thay vì làm gãy build", () => {
    assert.deepEqual(serverConnectSources("không phải url"), []);
  });
});

describe("sentryIngestOrigin", () => {
  it("rút origin ingest từ DSN, bỏ khoá và project id", () => {
    assert.equal(
      sentryIngestOrigin("https://abc123@o4507.ingest.us.sentry.io/4508"),
      "https://o4507.ingest.us.sentry.io",
    );
  });

  it("DSN trống hay hỏng thì không thêm gì", () => {
    assert.equal(sentryIngestOrigin(undefined), null);
    assert.equal(sentryIngestOrigin("  "), null);
    assert.equal(sentryIngestOrigin("rác"), null);
  });
});

describe("contentSecurityPolicy", () => {
  const env = {
    NODE_ENV: "production",
    NEXT_PUBLIC_SERVER_URL: "https://ma-soi-server.onrender.com",
    NEXT_PUBLIC_SENTRY_DSN: "https://k@o1.ingest.de.sentry.io/2",
    CSP_CONNECT_SRC_EXTRA: "wss://lk.example.com  https://lk.example.com",
  };
  const csp = contentSecurityPolicy(env);

  it("connect-src gồm server (http+ws), LiveKit Cloud, Sentry và origin thêm", () => {
    const connect = directive(csp, "connect-src");
    for (const expected of [
      "'self'",
      "https://ma-soi-server.onrender.com",
      "wss://ma-soi-server.onrender.com",
      "https://*.livekit.cloud",
      "wss://*.livekit.cloud",
      "https://o1.ingest.de.sentry.io",
      "wss://lk.example.com",
      "https://lk.example.com",
    ]) {
      assert.ok(connect.includes(expected), `connect-src thiếu ${expected}: ${connect.join(" ")}`);
    }
  });

  it("không có server URL thì dùng mặc định localhost:4000 như socket.ts", () => {
    const connect = directive(contentSecurityPolicy({ NODE_ENV: "production" }), "connect-src");
    assert.ok(connect.includes("http://localhost:4000"));
    assert.ok(connect.includes("ws://localhost:4000"));
  });

  it("script chỉ từ chính mình (cộng inline cho hydration), không nhúng được vào frame, không object", () => {
    assert.deepEqual(directive(csp, "script-src"), ["'self'", "'unsafe-inline'"]);
    assert.deepEqual(directive(csp, "frame-ancestors"), ["'none'"]);
    assert.deepEqual(directive(csp, "object-src"), ["'none'"]);
    assert.deepEqual(directive(csp, "base-uri"), ["'self'"]);
  });

  it("ảnh https bất kỳ (avatar ở object storage), media và worker cho phép blob", () => {
    assert.ok(directive(csp, "img-src").includes("https:"));
    assert.ok(directive(csp, "media-src").includes("blob:"));
    assert.ok(directive(csp, "worker-src").includes("blob:"));
  });

  it("không có upgrade-insecure-requests: next start cục bộ chạy http", () => {
    assert.ok(!csp.includes("upgrade-insecure-requests"));
  });
});

describe("securityHeaders", () => {
  it("production có CSP; dev thì không, vì HMR cần eval", () => {
    const prod = securityHeaders({ NODE_ENV: "production" });
    const dev = securityHeaders({ NODE_ENV: "development" });
    assert.ok(prod.some((h) => h.key === "Content-Security-Policy"));
    assert.ok(!dev.some((h) => h.key === "Content-Security-Policy"));
  });

  it("micro được phép (voice chat), camera và vị trí thì không", () => {
    const policy = securityHeaders({ NODE_ENV: "production" }).find(
      (h) => h.key === "Permissions-Policy",
    );
    assert.ok(policy);
    assert.ok(policy.value.includes("microphone=(self)"));
    assert.ok(policy.value.includes("camera=()"));
    assert.ok(policy.value.includes("geolocation=()"));
  });

  it("có nosniff, chặn frame, referrer gọn và HSTS ở mọi môi trường", () => {
    const keys = securityHeaders({ NODE_ENV: "development" }).map((h) => h.key);
    for (const k of [
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Strict-Transport-Security",
    ]) {
      assert.ok(keys.includes(k), `thiếu ${k}`);
    }
  });
});
