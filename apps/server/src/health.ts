export interface DependencyHealth {
  db: boolean;
  redis: boolean;
}

export function healthHttpStatus(health: DependencyHealth): 200 | 503 {
  return health.db && health.redis ? 200 : 503;
}
