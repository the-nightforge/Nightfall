"use client";

import { AVATAR_PATHS, type AvatarId } from "@/lib/avatar-art";

interface Props {
  avatar: AvatarId | string;
  tint: string;
  alive: boolean;
  className?: string;
  /** Độ lệch nhịp thở 0..1, lấy từ breathOffsetFor. Xem .avatar-breathe. */
  breathOffset?: number;
  /** Nếu là base64 data URL thì render ảnh thay vì SVG */
  isCustom?: boolean;
}

/**
 * Chân dung đơn sắc trong một đĩa tròn.
 *
 * Hình giữ nguyên một màu cho mọi người: màu trong lưới ô người chơi là để nói
 * trạng thái (bị bỏ phiếu, đã chết, đang chọn), tô thêm màu cá nhân lên chính
 * hình thì hai tầng thông tin đè lên nhau. Cá nhân hoá nằm ở sắc nền của đĩa.
 */
export function Avatar({ avatar, tint, alive, className = "", isCustom }: Props) {
  const isDataUrl = typeof avatar === "string" && avatar.startsWith("data:image");
  const isCustomUrl = isCustom || isDataUrl;
  return (
    <span
      className={`grid place-items-center overflow-hidden rounded-full border border-white/10 transition-colors ${className}`}
      style={{ background: alive ? tint : "rgba(120, 130, 150, 0.10)" }}
    >
      {isCustomUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar as string} alt="" className="h-full w-full object-cover" />
      ) : (
        <svg
          viewBox="0 0 512 512"
          aria-hidden="true"
          className={`h-[68%] w-[68%] ${alive ? "fill-mist/90" : "fill-mist/25"}`}
        >
          <path d={AVATAR_PATHS[avatar as AvatarId]} />
        </svg>
      )}
    </span>
  );
}
