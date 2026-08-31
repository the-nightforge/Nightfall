/**
 * Bảng ký tự chấp nhận được cho mã phòng, viết rộng hơn bảng server đang phát.
 *
 * Server sinh mã từ một bảng đã bỏ các ký tự dễ nhìn nhầm (không I, O, 0, 1 -
 * xem CODE_ALPHABET ở apps/server/src/util.ts). Ở đây cố ý KHÔNG chép lại bảng
 * hẹp đó: nhiệm vụ của hàm này là chặn rác, không phải đoán mã nào có thật.
 * Chép bảng hẹp sang đây nghĩa là một ngày nào đó server nới bảng chữ và trang
 * chủ lặng lẽ vứt đi những mã hoàn toàn hợp lệ.
 */
const CODE_PATTERN = /^[A-Z0-9]{5}$/;

/**
 * Đưa mã phòng lấy từ query string về đúng dạng ô nhập cần, hoặc null.
 *
 * Đây là một đường vào có thật chứ không phải tiện ích: trang phòng tự chuyển
 * về `/?code=XXXXX` khi thiếu danh tính (apps/web/src/app/room/[code]/page.tsx),
 * nên mọi link phòng người ta gửi cho nhau đều đi qua đây.
 *
 * Trả null thay vì chuỗi rỗng cho mọi thứ không dùng được: bên gọi phân biệt
 * "có mã" với "không có mã" bằng một phép kiểm tra duy nhất, và không bao giờ
 * ghi đè ô nhập bằng một giá trị vô nghĩa.
 */
export function normalizeJoinCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return CODE_PATTERN.test(code) ? code : null;
}
