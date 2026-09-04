import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Playfair_Display } from "next/font/google";
import Script from "next/script";
import { INSTALL_CAPTURE_SCRIPT } from "@/lib/pwa-install";
import { MotionProvider } from "@/components/MotionProvider";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import "./globals.css";
// Hệ chuyển cảnh có bảng CSS riêng - xem đầu file đó về lý do tách.
import "./cinematics.css";
import "./characters.css";

/**
 * Cả hai font đều khai báo subset "vietnamese".
 *
 * Đây không phải tối ưu dung lượng mà là một cái chốt an toàn: font Google
 * không có bộ dấu tiếng Việt sẽ làm build gãy ngay, thay vì lên production rồi
 * mới thấy "Ma Sói" tụt về font dự phòng ở giữa câu.
 */
const sans = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  // Chỉ ba nét đang thực sự dùng trong code. Be Vietnam Pro không có bản biến
  // thiên nên mỗi nét là một file riêng cho mỗi subset: thừa một nét là thừa
  // hai lượt tải trên 4G.
  weight: ["400", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

/**
 * Chỉ dùng cho tên pha và tên vai - những chỗ cần ra dáng sân khấu.
 *
 * Không khai báo weight: Playfair Display có bản biến thiên, bỏ trống thì mỗi
 * subset chỉ còn MỘT file phủ mọi nét thay vì một file cho mỗi nét.
 */
const display = Playfair_Display({
  subsets: ["latin", "vietnamese"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ma Sói Online",
  description: "Game Ma Sói online multiplayer - chơi cùng bạn bè qua mã phòng",
  /*
   * Trỏ tới route sinh từ `app/manifest.ts`, không phải một file trong /public.
   *
   * Next tự phát `<link rel="manifest">` khi có khoá này; tên route là
   * `/manifest.webmanifest` theo quy ước của App Router.
   */
  manifest: "/manifest.webmanifest",
  icons: {
    /*
     * apple-touch-icon phải khai ở đây chứ không nằm trong manifest được: iOS
     * đến giờ vẫn không đọc `icons` của manifest khi thêm vào màn hình chính.
     * Không có thẻ này thì iPhone tự chụp ảnh màn hình trang làm biểu tượng.
     */
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
  /*
   * Chế độ ứng dụng của Apple.
   *
   * `capable` sinh ra `<meta name="mobile-web-app-capable">` - bản chuẩn hoá
   * của thẻ `apple-mobile-web-app-capable` cũ, và Next lo phần đó nên đừng
   * thêm thẻ nào bằng tay ở đây.
   *
   * `black-translucent` chứ không `black`: giao diện của game vốn đã là nền
   * đêm #070b14 và trải hết mép trên, nên một thanh trạng thái đục màu đen sẽ
   * đọc ra một dải xám khác tông nằm chắn ngang đỉnh màn hình.
   */
  appleWebApp: {
    capable: true,
    title: "Ma Sói",
    statusBarStyle: "black-translucent",
  },
  applicationName: "Ma Sói Online",
  /*
   * Tắt tự nhận diện số điện thoại của Safari.
   *
   * Trong app có đầy con số đứng riêng - mã phòng 6 ký tự, số phiếu, số ghế -
   * và iOS biến những chuỗi trông giống số điện thoại thành link xanh gọi điện.
   */
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#070b14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${sans.variable} ${display.variable}`}>
      <body>
        {/*
          * Script trần, chạy TRƯỚC hydrate, chỉ để bắt một sự kiện.
          *
          * Đo được trên chính bản build này: Chrome bắn `beforeinstallprompt`
          * ở mốc ~35ms sau điều hướng, còn React thì lâu hơn thế mới gắn xong
          * listener - và sự kiện đó không bắn lại. Không có đoạn này thì nút
          * "Cài ứng dụng" không bao giờ hiện trên Chrome/Android, dù mọi thứ
          * khác của PWA đều đúng.
          *
          * `beforeInteractive` bắt buộc phải đặt ở root layout, và bản thân nội
          * dung script nằm ở `lib/pwa-install.ts` để test chạy đúng đoạn mã
          * này chứ không phải một bản chép tay.
          */}
        <Script id="masoi-install-capture" strategy="beforeInteractive">
          {INSTALL_CAPTURE_SCRIPT}
        </Script>
        <MotionProvider>{children}</MotionProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
