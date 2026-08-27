export interface DependencyHealth {
  db: boolean;
  redis: boolean;
}

export function healthHttpStatus(health: DependencyHealth): 200 | 503 {
  return health.db ? 200 : 503;
}
