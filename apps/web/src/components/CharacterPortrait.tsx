"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { AvatarId } from "@/lib/avatar-art";
import { hasSheet, hasVariants, sheetFor } from "@/lib/character-art";
import { portraitMode, portraitSource } from "@/lib/character-portrait";
import { readNetworkHints } from "@/lib/cinematic-settings";
import { Avatar } from "./Avatar";

/**
 * Khuôn mặt của một người chơi.
 *
 * Chỉ dùng ở những chỗ hình ĐỦ LỚN - ô người chơi, cột Người chơi, sân khấu
 * phiên toà, màn kết ván, phòng chờ. Những chỗ 24px trong nhật ký phiếu vẫn
 * dùng `<Avatar>`: ở cỡ đó khuôn mặt không mang thông tin gì, cái đĩa màu mới
 * mang, và nhồi ảnh 256px xuống 24px chỉ tốn băng thông đổi lấy một vũng nhoè.
 *
 * Component này CỐ Ý mỏng. Hai quyết định dễ sai - hiện chế độ nào, lấy hình ở
 * đâu - nằm ở `lib/character-portrait.ts` và được test ở đó.
 */

interface Props {
  avatar: AvatarId | string;
  tint: string;
  alive: boolean;
  /** Đang phát tiếng qua LiveKit. Nơi gọi nào có `seatShowsSpeaking` thì lọc trước. */
  speaking?: boolean;
  /** Mốc hết mấp máy của bot. Chưa nối dây ở đợt này - xem spec, đợt 4. */
  talkingUntilMs?: number | null;
  /** Độ lệch pha nháy mắt 0..1, lấy từ `breathOffsetFor`. */
  breathOffset?: number;
  className?: string;
  isCustom?: boolean;
}

/**
 * Save-Data của trình duyệt, đọc ĐỒNG BỘ ngay lần render đầu ở client.
 *
 * Không dùng useEffect: mặc định false rồi mới sửa lại nghĩa là ảnh đã bắt đầu
 * tải xong trước khi ta kịp biết người dùng bật tiết kiệm dữ liệu - tức là đúng
 * thứ cờ đó tồn tại để ngăn. `getServerSnapshot` trả false vì phía server không
 * có `navigator`.
 */
const subscribe = () => () => {};
function useSaveData(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readNetworkHints().saveData,
    () => false,
  );
}

export function CharacterPortrait({
  avatar,
  tint,
  alive,
  speaking = false,
  talkingUntilMs = null,
  breathOffset = 0,
  className = "",
  isCustom,
}: Props) {
  const saveData = useSaveData();
  // Ảnh hỏng thì đi tiếp bằng SVG và KHÔNG thử lại: một file 404 sẽ 404 lại.
  const [broken, setBroken] = useState(false);
  const onError = useCallback(() => setBroken(true), []);

  const isUploaded =
    isCustom === true ||
    (typeof avatar === "string" && /^(https?:|data:image)/.test(avatar));

  const source = portraitSource({
    isCustom: isUploaded,
    hasSheet: !broken && hasSheet(avatar),
    saveData,
  });

  if (source !== "sheet") {
    return (
      <Avatar
        avatar={avatar}
        tint={tint}
        alive={alive}
        className={className}
        isCustom={isUploaded}
      />
    );
  }

  const mode = portraitMode({
    alive,
    speaking,
    talkingUntilMs,
    nowMs: Date.now(),
  });

  return (
    <span
      className={`character-portrait is-${mode}${
        hasVariants(avatar) ? " has-variants" : ""
      } overflow-hidden rounded-full border border-white/10 transition-colors ${className}`}
      style={
        {
          background: alive ? tint : "rgba(120, 130, 150, 0.10)",
          "--breath-offset": breathOffset,
        } as React.CSSProperties
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sheetFor(avatar)!.src}
        alt=""
        aria-hidden="true"
        onError={onError}
        className="character-portrait__sheet"
      />
    </span>
  );
}
