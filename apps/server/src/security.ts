import helmet, { type HelmetOptions } from "helmet";

/**
 * Header an toàn cho API. Server này chỉ trả JSON và bắt tay Socket.IO, nên
 * phần lớn bộ header của helmet là "dựng rào ở chỗ không có đường" - nhưng
 * rào rẻ, và có hai cái thực sự đáng:
 *
 *  - `Strict-Transport-Security`: Render kết thúc TLS trước khi request tới
 *    đây, nên chỉ có ta mới nói được với trình duyệt "lần sau đừng thử http".
 *  - `X-Content-Type-Options: nosniff`: một endpoint lỗi trả JSON mang chuỗi
 *    do người chơi nhập (biệt danh) không bao giờ được trình duyệt đoán thành
 *    HTML.
 *
 * `Content-Security-Policy` giữ mặc định của helmet (`default-src 'self'`):
 * JSON không thực thi gì, và nếu một ngày có route trả HTML thì nó ra đời với
 * chính sách chặt sẵn thay vì không có gì.
 *
 * `Cross-Origin-Resource-Policy: same-origin` (mặc định) KHÔNG chặn fetch CORS
 * từ frontend ở origin khác - nó chỉ chặn nhúng kiểu `<img>`/`<script>` không
 * qua CORS, mà server này không có tài nguyên nào để nhúng.
 *
 * HSTS chỉ có ý nghĩa qua HTTPS; trình duyệt bỏ qua header này trên http://
 * nên phát nó ở dev cục bộ vô hại. `preload` để tắt: đưa domain vào danh sách
 * preload là chuyện làm bằng tay và không rút lại nhanh được.
 */
export const helmetOptions: HelmetOptions = {
  strictTransportSecurity: {
    maxAge: 60 * 60 * 24 * 365,
    includeSubDomains: true,
    preload: false,
  },
};

export function securityHeaders() {
  return helmet(helmetOptions);
}
