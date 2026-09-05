/*
 * Next nạp file này ở phía trình duyệt trước khi hydrate. Không có
 * NEXT_PUBLIC_SENTRY_DSN thì không init gì cả: SDK không mở kết nối, không
 * bắt lỗi, và trang chạy y như trước khi có Sentry.
 *
 * Chỉ lỗi, không tracing và không replay: replay ghi lại màn hình - trong một
 * game giấu vai, đó là thứ tuyệt đối không được gửi ra ngoài.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    sendDefaultPii: false,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
