export interface DependencyHealth {
  db: boolean;
  redis: boolean;
}

export function healthHttpStatus(health: DependencyHealth): 200 | 503 {
  return health.db ? 200 : 503;
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
