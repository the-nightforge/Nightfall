export interface DependencyHealth {
  db: boolean;
  redis: boolean;
}

/**
 * 503 CHỈ khi Postgres chết, dù Redis chết cũng là chuyện nghiêm trọng.
 *
 * Render dùng chính URL này làm health check và KHỞI ĐỘNG LẠI dịch vụ khi nó
 * đỏ liên tiếp. Ván đang chơi sống trong bộ nhớ và được khôi phục sau restart
 * từ snapshot trong Redis - tức là đúng lúc Redis chết thì restart là cách
 * chắc chắn nhất để mất sạch mọi ván đang chạy, thay vì để chúng chơi nốt trên
 * bộ nhớ. Vì thế Redis chết là "degraded" (xem `healthStatus`), không phải 503.
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
 * Render tự đặt RENDER_GIT_COMMIT cho service; GIT_COMMIT là lối vào thủ công
 * cho docker build cục bộ. Chuỗi rỗng bị coi như không có: biến môi trường
 * khai báo mà để trống là chuyện thường, và "" hiển thị ra thì vô nghĩa.
 */
export function buildVersion(env: NodeJS.ProcessEnv): string {
  const sha = env.GIT_COMMIT?.trim() || env.RENDER_GIT_COMMIT?.trim();
  return sha ? sha.slice(0, 7) : "dev";
}
