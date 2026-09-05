/**
 * Header an toàn cho frontend, đọc từ `next.config.ts` qua `headers()`.
 *
 * Thuần: nhận env, trả danh sách header. `next.config.ts` chạy lúc build nên
 * không test được trực tiếp; mọi luật ở đây kiểm bằng `security-headers.test.ts`.
 *
 * VỀ CSP - vì sao nó trông lỏng hơn sách giáo khoa:
 *
 *  - `script-src` có `'unsafe-inline'`: Next phát script hydration nội tuyến
 *    và `layout.tsx` có `INSTALL_CAPTURE_SCRIPT` cũng nội tuyến. Lối nonce
 *    của Next đòi middleware chạy trên mọi request và tắt prerender tĩnh của
 *    trang chủ - cái giá không đáng cho một app không nhúng script ngoài. Cái
 *    CSP này vẫn chặn được là NẠP script từ origin lạ: XSS có lọt cũng không
 *    kéo được payload về.
 *  - `img-src` mở `https:`: ảnh đại diện nằm ở object storage (R2/S3) mà domain
 *    chỉ biết lúc chạy server, không biết lúc build web.
 *  - `connect-src` cho `*.livekit.cloud`: URL LiveKit do server cấp lúc xin
 *    token, không có lúc build. Tự host LiveKit thì thêm origin vào
 *    `CSP_CONNECT_SRC_EXTRA`.
 *  - Không `upgrade-insecure-requests`: `next start` cục bộ chạy http và gọi
 *    server http, chỉ thị này sẽ ép mọi thứ lên https và gãy ngay.
 *
 * CSP chỉ phát ở production build: `next dev` cần `'unsafe-eval'` cho HMR và
 * mở websocket riêng, viết một CSP thứ hai cho dev là nuôi hai chính sách mà
 * chỉ một cái được kiểm.
 */

export interface SecurityHeader {
  key: string;
  value: string;
}

export interface SecurityHeadersEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_SERVER_URL?: string;
  NEXT_PUBLIC_SENTRY_DSN?: string;
  CSP_CONNECT_SRC_EXTRA?: string;
}

const DEFAULT_SERVER_URL = "http://localhost:4000";

/** Origin http(s) và bản ws(s) tương ứng của URL server, để Socket.IO đi được cả hai đường. */
export function serverConnectSources(serverUrl: string): string[] {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return [];
  }
  const secure = url.protocol === "https:";
  const host = url.host;
  return [`${secure ? "https" : "http"}://${host}`, `${secure ? "wss" : "ws"}://${host}`];
}

/** Origin ingest của Sentry rút từ DSN, để trình duyệt được phép gửi lỗi tới đó. */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn?.trim()) return null;
  try {
    return new URL(dsn.trim()).origin;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy(env: SecurityHeadersEnv): string {
  const connect = new Set<string>(["'self'"]);
  for (const src of serverConnectSources(env.NEXT_PUBLIC_SERVER_URL ?? DEFAULT_SERVER_URL)) {
    connect.add(src);
  }
  connect.add("https://*.livekit.cloud");
  connect.add("wss://*.livekit.cloud");
  const sentry = sentryIngestOrigin(env.NEXT_PUBLIC_SENTRY_DSN);
  if (sentry) connect.add(sentry);
  for (const extra of (env.CSP_CONNECT_SRC_EXTRA ?? "").split(/\s+/)) {
    if (extra) connect.add(extra);
  }

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["form-action", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'", "data:"]],
    ["media-src", ["'self'", "blob:"]],
    ["worker-src", ["'self'", "blob:"]],
    ["connect-src", [...connect]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(" ")}`).join("; ");
}

export function securityHeaders(env: SecurityHeadersEnv): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Voice chat cần micro; những thứ còn lại app không dùng và không nên xin được.
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), display-capture=()",
    },
    // Trình duyệt bỏ qua HSTS trên http://, nên phát ở dev cục bộ vô hại.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  ];
  if (env.NODE_ENV === "production") {
    headers.push({ key: "Content-Security-Policy", value: contentSecurityPolicy(env) });
  }
  return headers;
}
