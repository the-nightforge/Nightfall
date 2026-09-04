"use client";

import { useEffect } from "react";

/**
 * Đăng ký service worker. Không vẽ gì cả.
 *
 * Gắn ở root layout để mọi đường vào app đều đăng ký - kể cả khi người ta mở
 * thẳng một link phòng và không bao giờ đi qua trang chủ.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    /*
     * Chỉ production.
     *
     * Ở `next dev` mọi thứ được phục vụ không cache và bundle đổi liên tục;
     * một service worker chen vào giữa chỉ tạo ra những lần tải về nội dung cũ
     * không cách nào tái lập. Đây cũng là lý do file này không tự huỷ đăng ký ở
     * dev: máy dev không bao giờ đăng ký được nó ngay từ đầu.
     */
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    /*
     * Đợi `load`.
     *
     * Đăng ký service worker mở một luồng tải mới, và làm việc đó trong lúc
     * trang còn đang dựng là tranh băng thông với chính những file mà người
     * dùng đang chờ. Không có gì ở đây gấp cả: tác dụng của nó bắt đầu từ lần
     * mở SAU.
     */
    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
        /*
         * Không dừng gì cả, nhưng cũng không im lặng hoàn toàn.
         *
         * Đăng ký hỏng ở đủ thứ hoàn cảnh bình thường: cửa sổ ẩn danh, người
         * dùng chặn cookie/storage, trang mở qua HTTP thuần. Không có cái nào
         * trong đó là chuyện của người chơi, và game vẫn chạy đủ mà không cần
         * service worker - nên tuyệt đối không hiện gì lên màn hình.
         *
         * Nhưng bản đầu nuốt sạch, và khi có người báo "vào lại thì mất mạng là
         * trang trắng" thì không còn một dấu vết nào để lần. Một dòng
         * `console.warn` là đủ cho một người mở DevTools ra xem, và không đủ để
         * ai khác nhận ra.
         *
         * Chỉ ghi thông điệp lỗi - không URL phòng, không biệt danh, không mã
         * phiên. Console của trình duyệt là nơi mọi tiện ích mở rộng đọc được.
         */
        console.warn(
          "[ma-soi] Không đăng ký được service worker; game vẫn chạy, chỉ mất trang offline.",
          error instanceof Error ? error.message : String(error),
        );
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  /*
   * Cố tình KHÔNG nghe `controllerchange` để tải lại trang.
   *
   * Đó là công thức được chép đi chép lại ở khắp nơi, và nó có nghĩa là: một
   * lần deploy có thể tải lại trang của một người đang ở giữa pha bỏ phiếu.
   * Bản service worker mới nằm chờ tới khi họ đóng tab - xem ghi chú về
   * skipWaiting trong `public/sw.js`.
   */
  return null;
}
