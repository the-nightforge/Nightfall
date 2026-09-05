import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    /*
     * Trần 5 giây mặc định quá chặt cho package này.
     *
     * Nhiều test ở đây chạy self-play THẬT - hàng chục ván engine đầy đủ kèm
     * lời nói - nên chúng nằm ở thang giây chứ không phải mili giây. Ở máy rảnh
     * chúng vừa lọt, ở máy đang bận thì đỏ, và một test đỏ theo tải máy là một
     * test không nói được điều gì về code.
     */
    testTimeout: 30_000,
  },
});
