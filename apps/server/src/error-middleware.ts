import type { NextFunction, Request, Response } from "express";

/**
 * Lưới an toàn cuối cùng: Express nhận diện middleware xử lý lỗi bằng ĐÚNG 4
 * tham số (kể cả tham số không dùng), nên chữ ký dưới đây giữ nguyên cả 4.
 * Không có middleware này thì bất kỳ throw đồng bộ hay next(err) nào lọt ra
 * khỏi route/middleware phía trên đều rơi vào finalhandler mặc định của
 * Express - nó trả nguyên err.stack (dev) hay HTML "Internal Server Error"
 * (prod), cả hai đều không phải { error: "..." } tiếng Việt mà API này cam
 * kết. Đây là lưới hứng cho MỌI route sau này, không riêng avatar.
 *
 * Tách ra module riêng (thay vì định nghĩa ngay trong index.ts) để test được:
 * index.ts chỉ gọi main() và không export gì, nên middleware định nghĩa ngay
 * trong đó không có cách nào import vào test.
 */
export function apiErrorFallback(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Response đã bắt đầu gửi thì không còn cách nào sửa status/body nữa -
  // giao lại cho Express tự đóng kết nối, đừng gọi res.json() chồng lên.
  if (res.headersSent) {
    next(err);
    return;
  }
  console.error("[api] Lỗi không xác định lọt tới tầng ngoài cùng:", err);
  res.status(500).json({ error: "Đã có lỗi xảy ra, thử lại sau" });
}
