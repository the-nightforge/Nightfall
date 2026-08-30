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
        mist: "#9db2d5",
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
      },
      animation: {
        pulseSlow: "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        fogDrift: "fogDrift 26s ease-in-out infinite",
        moonGlow: "moonGlow 7s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
