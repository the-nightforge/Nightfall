"use client";

import { useMemo } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { useVoiceContext } from "@/components/VoiceProvider";

/**
 * Điều khiển voice chat. Chỉ hiển thị - trạng thái do `VoiceProvider` giữ.
 */
export function VoiceControl({ snapshot }: { snapshot: RoomSnapshot | null }) {
  const voice = useVoiceContext();
  const ui = voice?.ui ?? { visible: false, mode: "join" as const };
  const micOpen = voice?.micOpen ?? false;
  const micMode = voice?.micMode ?? "ptt";
  const toggleHold = voice?.toggleHold ?? (() => undefined);
  const setMicMode = voice?.setMicMode ?? (() => undefined);
  const activate = voice?.activate ?? (() => undefined);
  const holdStart = voice?.holdStart ?? (() => undefined);
  const holdEnd = voice?.holdEnd ?? (() => undefined);

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

  const talkClass = `w-full rounded-xl px-4 py-3 font-semibold transition ${
    micOpen ? "bg-blood-500 text-white" : "bg-white/10 text-mist"
  }`;

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
        <>
          {micMode === "ptt" ? (
            <button
              className={talkClass}
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
          ) : (
            // Chế độ chạm bật/tắt: onClick chứ không phải pointer*, để một cú
            // chạm là một lần lật - không phụ thuộc ngón tay có xê dịch hay không.
            <button className={talkClass} onClick={toggleHold}>
              {micOpen ? "🔴 Đang nói — chạm để tắt" : "🎙️ Chạm để nói"}
            </button>
          )}

          <button
            className="text-xs text-mist/65 underline-offset-2 hover:underline"
            onClick={() => setMicMode(micMode === "ptt" ? "toggle" : "ptt")}
          >
            {micMode === "ptt" ? "Chuyển sang chạm bật/tắt" : "Chuyển sang giữ để nói"}
          </button>
        </>
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

      {hint && <p className="text-center text-xs text-mist/65">{hint}</p>}
    </div>
  );
}
