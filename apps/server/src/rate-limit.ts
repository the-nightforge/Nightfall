/**
 * Rate limit cửa sổ trượt, dùng chung cho socket (khoá theo playerId) và HTTP
 * (khoá theo IP).
 *
 * Bản đồ TỰ DỌN. Trước đây nó nằm trong ws.ts và không bao giờ được dọn: mỗi
 * cặp (người chơi, loại hành động) để lại một entry sống hết vòng đời process,
 * mà có 13 loại hành động - đúng kiểu rò rỉ mà `removeRoom` đã phải đi dọn cho
 * bot state và discussion vote.
 *
 * KHÔNG dọn theo sự kiện disconnect: ngắt rồi nối lại là thao tác client tự làm
 * được, nên xoá theo disconnect sẽ biến mọi giới hạn thành thứ né được bằng một
 * lần F5. Chỉ xoá entry đã vượt cửa sổ dài nhất - lúc đó nó không còn chặn được
 * gì nữa, nên xoá là vô hại.
 */

const hits = new Map<string, number[]>();

/** Cửa sổ dài nhất từng dùng; mốc để biết một entry đã hết giá trị. */
let maxWindowMs = 0;
let lastSweepAt = 0;

const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [key, times] of hits) {
    const newest = times[times.length - 1];
    if (newest === undefined || now - newest >= maxWindowMs) hits.delete(key);
  }
}

export function allowAction(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  if (windowMs > maxWindowMs) maxWindowMs = windowMs;
  sweep(now);

  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const allowed = recent.length < limit;
  if (allowed) recent.push(now);
  // Lưu cả khi BỊ CHẶN: giữ lại bản đã lọc để lần spam kế khỏi lọc lại mảng cũ.
  hits.set(key, recent);
  return allowed;
}

/** Số entry đang giữ. Dùng cho test và chẩn đoán rò rỉ. */
export function rateLimitEntryCount(): number {
  return hits.size;
}

/** Dùng cho test: trả bộ đếm về trạng thái sạch. */
export function resetRateLimit(): void {
  hits.clear();
  maxWindowMs = 0;
  lastSweepAt = 0;
}
