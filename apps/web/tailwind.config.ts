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
        display: ["system-ui", "sans-serif"],
      },
      animation: {
        pulseSlow: "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
