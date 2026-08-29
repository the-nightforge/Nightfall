"use client";

import { useEffect, useMemo, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { getIdentity } from "@/lib/identity";
import { getSocket } from "@/lib/socket";
import { useVoice } from "@/lib/useVoice";

/**
 * Điều khiển voice chat.
 *
 * Lấy socket từ chính singleton mà `useRoomSocket` đang dùng, nên không phải
 * đổi chữ ký hook đó và không có kết nối thứ hai.
 */
export function VoiceControl({ snapshot }: { snapshot: RoomSnapshot | null }) {
  const [socket, setSocket] = useState<ReturnType<typeof getSocket> | null>(null);

  useEffect(() => {
    const identity = getIdentity();
    if (identity) setSocket(getSocket(identity));
  }, []);

  const { ui, activate, holdStart, holdEnd, micOpen } = useVoice(socket, snapshot?.voice);

  const hint = useMemo(() => {
    switch (ui.mode) {
      case "listen":
        return snapshot?.you?.alive === false
          ? "Bạn đã chết - chỉ nghe được, người sống không nghe thấy bạn"
          : "Lượt này bạn không được nói";
      case "duplicate":
        return "Kênh thoại đã chuyển sang tab khác của bạn";
      default:
        return null;
    }
  }, [ui.mode, snapshot?.you?.alive]);

  if (!snapshot || !ui.visible) return null;

  return (
    <div className="card flex flex-col gap-2">
      {ui.mode === "join" && (
        <button className="btn-primary w-full" onClick={activate}>
          🎙️ Bật mic
        </button>
      )}

      {ui.mode === "unblock-audio" && (
        // Trình duyệt đang chặn phát tiếng. Phải là một cú chạm thật, và có thể
        // xuất hiện lại giữa phiên chứ không chỉ lúc vào.
        <button className="btn-primary w-full" onClick={activate}>
          🔈 Chạm để nghe
        </button>
      )}

      {ui.mode === "talk" && (
        <button
          className={`w-full rounded-xl px-4 py-3 font-semibold transition ${
            micOpen ? "bg-blood-500 text-white" : "bg-white/10 text-mist"
          }`}
          // pointer* bắt được cả chuột lẫn cảm ứng bằng một đường.
          onPointerDown={holdStart}
          onPointerUp={holdEnd}
          // Thiếu pointercancel là mic kẹt mở khi trình duyệt cướp con trỏ
          // (cuộn, kéo ra ngoài nút, cuộc gọi đến).
          onPointerCancel={holdEnd}
          onPointerLeave={holdEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
          {micOpen ? "🔴 Đang nói..." : "🎙️ Giữ để nói"}
        </button>
      )}

      {ui.mode === "listen" && (
        <div className="rounded-xl bg-white/5 px-4 py-3 text-center text-sm text-mist/70">
          🎧 Chỉ nghe
        </div>
      )}

      {ui.mode === "duplicate" && (
        <button className="btn-primary w-full" onClick={activate}>
          Dùng kênh thoại ở tab này
        </button>
      )}

      {ui.mode === "error" && (
        <button className="btn-primary w-full" onClick={activate}>
          Thử kết nối thoại lại
        </button>
      )}

      {hint && <p className="text-center text-xs text-mist/50">{hint}</p>}
    </div>
  );
}
