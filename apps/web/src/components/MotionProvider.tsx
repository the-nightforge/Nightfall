"use client";

import { LazyMotion, MotionConfig } from "motion/react";

/**
 * Nạp phần chạy animation SAU chunk đầu tiên.
 *
 * Phải là hàm dynamic import chứ không phải truyền thẳng `domAnimation`: truyền
 * thẳng thì nó nằm luôn trong chunk đầu và LazyMotion chẳng lazy gì cả. Trong
 * khoảng ngắn trước khi tải xong, các thẻ `m` render tĩnh - đúng bằng giao diện
 * không có chuyển động, không phải màn hình trắng.
 */
const loadFeatures = () => import("./motion-features").then((mod) => mod.default);

/**
 * `strict` để dùng nhầm `motion.div` là ném lỗi ngay lúc dev: thẻ đó kéo trọn
 * gói vào chunk đầu và xoá sạch tác dụng của việc tách ở trên.
 *
 * `reducedMotion="user"` tôn trọng thiết lập hệ thống. Chuyển động ở đây chỉ để
 * phản hồi thao tác, không mang thông tin nào riêng, nên tắt hết vẫn chơi đủ.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
