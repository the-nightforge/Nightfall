"use client";

/**
 * Ước lượng độ lệch giữa đồng hồ máy người chơi và đồng hồ server.
 *
 * `phaseEndsAt` là epoch ms do SERVER sinh ra. So thẳng với `Date.now()` của
 * client là sai đúng bằng độ lệch đồng hồ máy đó, và trên điện thoại không bật
 * giờ tự động thì lệch vài chục giây là chuyện thường: người chơi thấy đồng hồ
 * đếm ngược sai hẳn mà không ai biết vì sao.
 *
 * Mỗi snapshot mang theo `serverNow`, nên hiệu số với lúc nhận là một mẫu đo.
 */

/**
 * Lấy TRUNG VỊ của vài mẫu gần nhất chứ không phải mẫu mới nhất: một lần tab bị
 * treo, GC dừng lâu hay mạng nghẽn tạo ra mẫu lệch cả giây, và trung vị bỏ qua
 * được mà không cần ngưỡng nào để chỉnh.
 */
const MAX_SAMPLES = 7;

const samples: number[] = [];

/**
 * Ghi nhận một mốc thời gian server. Bỏ qua giá trị không phải số hữu hạn:
 * web deploy trên Vercel còn server deploy trên Render, nên có cửa sổ mà client
 * mới nói chuyện với server cũ chưa gửi trường này. Không mẫu nào thì offset là
 * 0, tức là đúng bằng hành vi cũ.
 */
export function recordServerTime(serverNow: unknown, receivedAt = Date.now()): void {
  if (typeof serverNow !== "number" || !Number.isFinite(serverNow)) return;
  samples.push(serverNow - receivedAt);
  if (samples.length > MAX_SAMPLES) samples.shift();
}

/**
 * Số ms phải cộng vào `Date.now()` để ra giờ server.
 *
 * Còn sai số hệ thống khoảng nửa RTT vì snapshot được đóng dấu ở server rồi mới
 * đi qua mạng, nên ước lượng luôn chậm hơn server vài chục ms. Cố ý không bù:
 * nó nhỏ hơn hai bậc so với thứ đang sửa, và bù sai còn tệ hơn không bù.
 */
export function serverOffset(): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Giờ hiện tại theo đồng hồ server. Mọi so sánh với `phaseEndsAt` phải dùng hàm này. */
export function serverNow(): number {
  return Date.now() + serverOffset();
}

/** Chỉ dùng trong test: xoá mẫu đã đo để mỗi ca kiểm thử bắt đầu từ trạng thái sạch. */
export function resetClock(): void {
  samples.length = 0;
}
