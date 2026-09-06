import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        /*
         * Header an toàn cho MỌI đường dẫn. Luật và lý do nằm ở
         * `src/lib/security-headers.ts`, nơi có test; ở đây chỉ nối dây.
         */
        source: "/(.*)",
        headers: securityHeaders(process.env),
      },
      {
        /*
         * Service worker không được nằm lại trong cache HTTP.
         *
         * Trình duyệt tự giới hạn tuổi của `sw.js` ở 24 giờ, nhưng 24 giờ vẫn
         * là 24 giờ một luật cache cũ tiếp tục có hiệu lực sau khi đã sửa nó.
         * `no-cache` bắt kiểm tra lại với server ở mỗi lần đăng ký, nên một
         * bản vá cho `public/sw.js` có hiệu lực ngay ở lần mở app kế tiếp.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

/*
 * withSentryConfig chỉ đáng giá khi có token để tải source map lên; không có
 * thì nó chỉ thêm tiếng ồn vào log build. `SENTRY_AUTH_TOKEN` + `SENTRY_ORG`
 * + `SENTRY_PROJECT` là ba biến của Vercel; thiếu bất kỳ cái nào thì bỏ qua
 * bước tải và build đúng như không có Sentry. SDK ở runtime (instrumentation*)
 * vẫn tự tắt khi không có NEXT_PUBLIC_SENTRY_DSN, độc lập với chỗ này.
 */
const canUploadSourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !canUploadSourceMaps },
});
