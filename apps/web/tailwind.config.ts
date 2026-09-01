import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        night: {
          950: "#070b14",
          900: "#0b1120",
          800: "#111a2e",
          700: "#1a2743",
          600: "#26365a",
        },
        blood: {
          500: "#dc2640",
          600: "#b91c33",
          400: "#f04760",
        },
        /*
       * Sương - màu chữ phụ của cả trang.
       *
       * Trước đây chỉ có một sắc duy nhất, nên mọi chỗ cần chữ đọc rõ hơn đều
       * phải tự pha bằng `text-white/85` hay một mã màu rời. Ba nấc dưới đây là
       * ba VAI TRÒ, không phải ba sắc độ cho đẹp:
       *
       *   mist         - nhãn phụ, chú thích, thứ được phép chìm
       *   mist-strong  - chữ nội dung: tin nhắn, tên trong lịch sử phiếu
       *   mist-bright  - chữ gần như chính, dùng khi trắng nguyên là quá gắt
       *
       * mist-strong đo được 8.6:1 trên nền thẻ (#141d31) và 11:1 trên nền
       * trang (#070b14) - trên ngưỡng AA cho chữ thường, còn `mist` gốc ở
       * opacity 60-70% mà bản cũ rắc khắp nơi thì rơi xuống quanh 3:1.
       *
       * Hai nấc này vừa được nâng thêm một bậc so với lần đầu (#c2d2ea /
       * #dde7f8): trên màn hình chỉnh sáng thấp, chữ phụ ở nấc cũ vẫn phải
       * nheo mắt. Vẫn cách chữ trắng nguyên (15:1) đủ xa để thứ bậc không
       * phẳng ra.
       */
      mist: {
        DEFAULT: "#9db2d5",
        strong: "#ccd9ef",
        bright: "#e7eefb",
      },
      },
      fontFamily: {
        // Tailwind preflight gán fontFamily.sans cho <html>, nên khai báo ở đây
        // là đủ để cả trang đổi font, không cần chạm vào component nào.
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
      },
      keyframes: {
        // Sương trôi ngang hero trang chủ. Biên độ nhỏ và chu kỳ dài: đây là
        // nền của một trang có ô nhập chữ, không phải một màn hình chờ.
        fogDrift: {
          "0%, 100%": { transform: "translate3d(-4%, 0, 0)" },
          "50%": { transform: "translate3d(4%, 0, 0)" },
        },
        moonGlow: {
          "0%, 100%": { opacity: "0.75" },
          "50%": { opacity: "1" },
        },
        // Tàn lửa bay lên từ phía làng ở nền trang chủ. Mờ ở cả hai đầu chu kỳ
        // nên không bao giờ thấy một đốm sáng bật ra hay tắt phụt giữa trời.
        emberFloat: {
          "0%": { transform: "translate3d(0, 0, 0)", opacity: "0" },
          "18%": { opacity: "0.55" },
          "72%": { opacity: "0.35" },
          "100%": { transform: "translate3d(18px, -46vh, 0)", opacity: "0" },
        },
        // Panel form hiện lên khi vào trang. `both` để giữ nguyên trạng thái
        // cuối, không nhảy về opacity gốc sau khi chạy xong.
        riseIn: {
          from: { opacity: "0", transform: "translate3d(0, 22px, 0)" },
          to: { opacity: "1", transform: "translate3d(0, 0, 0)" },
        },
      },
      animation: {
        pulseSlow: "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        fogDrift: "fogDrift 26s ease-in-out infinite",
        moonGlow: "moonGlow 7s ease-in-out infinite",
        emberFloat: "emberFloat 14s linear infinite",
        riseIn: "riseIn 640ms cubic-bezier(0.22, 0.61, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};

export default config;
