"use client";

/**
 * Tách riêng một module chỉ để `LazyMotion` có cái mà dynamic import.
 *
 * Truyền thẳng `domAnimation` vào features thì nó bị gói đồng bộ vào chunk đầu -
 * chữ "lazy" trong tên component không tự làm gì cả. Phải là một hàm trả về
 * Promise thì phần chạy animation mới rời khỏi đường tải đầu tiên.
 */
export { domAnimation as default } from "motion/react";
