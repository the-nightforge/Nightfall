/*
 * Phía server của Next (render RSC, route `manifest.ts`). Cùng luật với
 * `instrumentation-client.ts`: không có DSN thì không init.
 *
 * Bản Vercel của app này gần như tĩnh, nên phần này hiếm khi có việc; nó ở
 * đây để một lỗi render server (một vai lạ trong metadata chẳng hạn) không
 * chỉ hiện ở log Vercel mà còn tới cùng chỗ với lỗi phía trình duyệt.
 */
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}

export const onRequestError = Sentry.captureRequestError;
