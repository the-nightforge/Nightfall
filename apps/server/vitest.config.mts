import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    /*
     * Cùng lý do với `packages/game-engine`: vài test ở đây SPAWN một tiến trình
     * `tsx` con (trace-view) hoặc chạy engine thật, tức thang giây chứ không
     * phải mili giây. Trần 5 giây mặc định vừa lọt khi máy rảnh và đỏ khi máy
     * bận, mà một test đỏ theo tải máy thì không nói được gì về code.
     */
    testTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
  },
});
