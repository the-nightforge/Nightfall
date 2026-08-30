"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import type { ChatMessage, Phase } from "@masoi/shared";
import { useChatUnread, unreadLabel } from "@/lib/chat-unread";
import { ChatBox } from "./ChatBox";

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  placeholder?: string;
  /** Bản nháp nằm ở trang phòng nên đóng tấm trượt không xoá mất chữ đang gõ. */
  draft: string;
  onDraftChange: (draft: string) => void;
  selfId: string | null;
  phase: Phase | null;
}

/**
 * Chat trên điện thoại.
 *
 * Dưới `lg` cột phải không tồn tại, và ở bản cũ khung chat bị đẩy xuống dưới cả
 * nội dung pha lẫn danh sách người chơi - trong màn bỏ phiếu nó nằm quanh mốc
 * 1800px, tức là phải cuộn qua toàn bộ lưới chọn người mới thấy. Chat là thứ cả
 * ván xoay quanh, nó không được nằm sau mọi thứ khác.
 *
 * Nút nổi + tấm trượt từ đáy giữ chat cách đúng MỘT thao tác ở mọi pha, mà
 * không chiếm chỗ thường trực của các nút bỏ phiếu / chọn mục tiêu.
 */
export function MobileChatDock({
  messages,
  onSend,
  placeholder,
  draft,
  onDraftChange,
  selfId,
  phase,
}: Props) {
  const [open, setOpen] = useState(false);
  const unread = useChatUnread(messages, selfId, open);
  const inputRef = useRef<HTMLInputElement>(null);

  // Escape đóng tấm trượt: nó che gần hết màn hình nên phải có đường thoát
  // không cần nhắm trúng một nút nhỏ.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Ban ngày chat là hoạt động chính, nên nút đổi hẳn dáng thay vì chỉ đổi màu:
  // ở đó nó là lời mời, các pha khác nó chỉ là lối vào.
  const highlighted = phase === "DAY_DISCUSSION";

  return (
    <div className="lg:hidden">
      <AnimatePresence>
        {open && (
          <>
            <m.div
              key="scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <m.div
              key="sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Khung chat"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              /*
               * dvh chứ không phải vh: bàn phím ảo làm co viewport động, và với
               * vh tấm trượt giữ nguyên chiều cao cũ rồi bị bàn phím nuốt mất ô
               * nhập. 72dvh còn chừa lại một dải nội dung pha phía trên để người
               * chơi vẫn thấy mình đang ở pha nào lúc gõ.
               */
              className="fixed inset-x-0 bottom-0 z-50 flex h-[72dvh] max-h-[72dvh] flex-col rounded-t-2xl border-t border-night-600 bg-night-950/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-18px_40px_-20px_rgba(0,0,0,0.9)] backdrop-blur-md"
            >
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <span aria-hidden="true" className="absolute inset-x-0 top-1.5 mx-auto h-1 w-10 rounded-full bg-white/20" />
                <h2 className="mt-1 font-display text-base font-bold text-white">Trò chuyện</h2>
                <button
                  className="mt-1 rounded-lg border border-night-600 bg-night-800 px-3 py-1.5 text-sm font-semibold text-mist"
                  onClick={() => setOpen(false)}
                >
                  Đóng
                </button>
              </div>
              <div className="min-h-0 flex-1 px-2 pb-2">
                <ChatBox
                  messages={messages}
                  onSend={onSend}
                  placeholder={placeholder}
                  draft={draft}
                  onDraftChange={onDraftChange}
                  inputRef={inputRef}
                  autoFocus
                />
              </div>
            </m.div>
          </>
        )}
      </AnimatePresence>

      {/*
        * Nút nằm bên TRÁI đáy màn: các nút hành động chính (Bỏ phiếu, Không treo
        * ai, Xác nhận) đều là nút full-width trong thẻ nội dung, còn góc phải là
        * chỗ ngón cái quen quét lên xuống. Trang cũng đã chừa `pb-28` ở dưới cùng
        * nên nút không bao giờ đè lên nút cuối trang.
        */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={
            unread > 0 ? `Mở khung chat, ${unread} tin nhắn chưa đọc` : "Mở khung chat"
          }
          className={`fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-full px-4 py-3 font-semibold shadow-lg shadow-black/50 transition ${
            highlighted
              ? "bg-blood-500 text-white"
              : "border border-night-600 bg-night-800/95 text-mist backdrop-blur"
          }`}
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          <span aria-hidden="true">💬</span>
          <span className="text-sm">Chat</span>
          {unread > 0 && (
            <span className="ml-0.5 inline-grid h-5 min-w-[20px] place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-night-950">
              {unreadLabel(unread)}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
