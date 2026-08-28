"use client";

import { AVATAR_PATHS, type AvatarId } from "@/lib/avatar-art";

interface Props {
  avatar: AvatarId;
  tint: string;
  alive: boolean;
  className?: string;
}

/**
 * Chân dung đơn sắc trong một đĩa tròn.
 *
 * Hình giữ nguyên một màu cho mọi người: màu trong lưới ô người chơi là để nói
 * trạng thái (bị bỏ phiếu, đã chết, đang chọn), tô thêm màu cá nhân lên chính
 * hình thì hai tầng thông tin đè lên nhau. Cá nhân hoá nằm ở sắc nền của đĩa.
 */
export function Avatar({ avatar, tint, alive, className = "" }: Props) {
  return (
    <span
      className={`grid place-items-center rounded-full border border-white/10 transition-colors ${className}`}
      style={{ background: alive ? tint : "rgba(120, 130, 150, 0.10)" }}
    >
      <svg
        viewBox="0 0 512 512"
        aria-hidden="true"
        className={`h-[68%] w-[68%] ${alive ? "fill-mist/90" : "fill-mist/25"}`}
      >
        <path d={AVATAR_PATHS[avatar]} />
      </svg>
    </span>
  );
}
