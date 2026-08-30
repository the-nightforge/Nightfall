import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Playfair_Display } from "next/font/google";
import { MotionProvider } from "@/components/MotionProvider";
import "./globals.css";
// Hệ chuyển cảnh có bảng CSS riêng - xem đầu file đó về lý do tách.
import "./cinematics.css";

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
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#070b14",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${sans.variable} ${display.variable}`}>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
