import * as Sentry from "@sentry/node";
import { buildVersion } from "./health";

/**
 * Sentry cho backend. Không có `SENTRY_DSN` thì mọi hàm ở đây là no-op và
 * server chạy y hệt trước khi có file này - dev cục bộ, CI, và bất kỳ ai fork
 * repo về không cần biết Sentry tồn tại.
 *
 * Chuỗi rỗng tính như chưa đặt, cùng lối với `resolveVoiceConfig`: template
 * `.env.example` khai sẵn `SENTRY_DSN=` để người ta thấy khoá, và copy template
 * về không được coi là "đang muốn bật Sentry".
 *
 * Tách khỏi `config.ts` vì thứ tự nạp: Sentry muốn được `init` TRƯỚC khi
 * express/http được require để tự móc vào chúng. `index.ts` import module này
 * đầu tiên; `config.ts` thì đứng sau nhiều thứ khác.
 */
export function resolveSentryDsn(env: NodeJS.ProcessEnv): string | null {
  const dsn = env.SENTRY_DSN?.trim();
  return dsn ? dsn : null;
}

let enabled = false;

export function initObservability(env: NodeJS.ProcessEnv = process.env): boolean {
  const dsn = resolveSentryDsn(env);
  if (!dsn) return false;

  Sentry.init({
    dsn,
    environment: env.NODE_ENV ?? "development",
    release: buildVersion(env),
    // Chỉ lỗi, không tracing: server này chạy trên Render Free và mỗi span gửi
    // đi là băng thông + hạn mức Sentry Free. Bật lại khi có lý do cụ thể.
    tracesSampleRate: 0,
    // Không gửi IP người chơi hay header request: game chỉ có biệt danh, và
    // biệt danh cũng không cần nằm trong hệ thống bên thứ ba.
    sendDefaultPii: false,
  });
  enabled = true;
  return true;
}

export function observabilityEnabled(): boolean {
  return enabled;
}

/**
 * Điểm móc cho express: PHẢI đứng sau mọi route và TRƯỚC `apiErrorFallback`,
 * vì Sentry chỉ ghi nhận rồi `next(err)` tiếp - lưới hứng của ta vẫn là bên
 * quyết định người gọi thấy gì.
 */
export function attachExpressErrorReporter(app: Parameters<typeof Sentry.setupExpressErrorHandler>[0]): void {
  if (!enabled) return;
  Sentry.setupExpressErrorHandler(app);
}

/**
 * Báo một lỗi lập trình từ ngoài luồng HTTP - socket handler, timer của pha,
 * job persist. Dùng đúng ở những chỗ đã quyết định "đây là bug chứ không phải
 * luật chơi" (xem `socketErrorLog`), để Sentry không ngập "Phòng đã đầy".
 *
 * `context` chỉ nhận chuỗi/số ngắn: tên sự kiện, playerId, mã phòng. Không đưa
 * payload vào - cùng kỷ luật với `socketErrorLog`.
 */
export function reportError(err: unknown, context: Record<string, string | number> = {}): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) scope.setTag(key, String(value));
    Sentry.captureException(err);
  });
}

/** Đẩy nốt hàng đợi trước khi tiến trình tắt; không có gì để đẩy thì về ngay. */
export async function flushObservability(timeoutMs = 2_000): Promise<void> {
  if (!enabled) return;
  await Sentry.flush(timeoutMs).catch(() => undefined);
}
