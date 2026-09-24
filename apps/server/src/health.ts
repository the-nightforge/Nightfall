export interface DependencyHealth {
  db: boolean;
  redis: boolean;
}

/**
 * 503 CHỈ khi Postgres chết, dù Redis chết cũng là chuyện nghiêm trọng.
 *
 * `deploy/deploy.sh` đọc chính URL này sau khi thay container, và LÙI BẢN khi
 * nó không xanh. Ván đang chơi sống trong bộ nhớ và được khôi phục sau
 * restart từ snapshot trong Redis. Nếu Redis chết mà trả 503, deploy sẽ lùi
 * một bản không có lỗi gì và restart thêm lần nữa, đúng lúc restart là cách
 * chắc chắn nhất để mất mọi ván đang chạy. Vì thế Redis chết là "degraded"
 * (xem `healthStatus`), không phải 503.
 *
 * Postgres chết thì khác: không tạo được người chơi, không xác thực được socket
 * mới, không lưu được kết quả - restart không làm mất thêm gì.
 */
export function healthHttpStatus(health: DependencyHealth): 200 | 503 {
  return health.db ? 200 : 503;
}

export type HealthStatus = "ok" | "degraded" | "down";

/**
 * Một chữ cho người nhìn dashboard: `ok` đủ cả, `degraded` chơi được nhưng
 * không khôi phục được sau restart (Redis chết), `down` không chơi được.
 */
export function healthStatus(health: DependencyHealth): HealthStatus {
  if (!health.db) return "down";
  if (!health.redis) return "degraded";
  return "ok";
}

export function redisConnectionHealthy(status: string): boolean {
  return status === "ready";
}

/**
 * Bản build đang chạy, để /health nói được nó là commit nào.
 *
 * `deploy/deploy.sh` truyền `GIT_COMMIT` làm build arg của image. Chuỗi rỗng
 * bị coi như không có: biến môi trường khai báo mà để trống là chuyện thường,
 * và "" hiển thị ra thì vô nghĩa.
 */
export function buildVersion(env: NodeJS.ProcessEnv): string {
  const sha = env.GIT_COMMIT?.trim();
  return sha ? sha.slice(0, 7) : "dev";
}
