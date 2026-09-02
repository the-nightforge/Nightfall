"use client";

import { useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import type { ChatMessage, Phase } from "@masoi/shared";
import type { ChatChannelId, ChatComposerState } from "@/lib/chat-channels";
import type { PhaseMarker } from "@/lib/chat-timeline";
import { useChatUnread, unreadLabel } from "@/lib/chat-unread";
import { useModalFocus } from "@/lib/useModalFocus";
import { ChatBox } from "./ChatBox";

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  /** Quyền gửi ở pha hiện tại; xem `ChatBox`. */
  composer: ChatComposerState;
  /** Kênh có mặt trong danh sách; xem `ChatBox`. */
  channels?: ChatChannelId[];
  /** Mốc đổi pha để chèn vạch ngăn; xem `ChatBox`. */
  markers?: PhaseMarker[];
  /** Câu gợi ý lúc chưa có tin nhắn; xem `ChatBox`. */
  emptyHint?: string;
  /**
   * Tên khu vực đang xem, in lên thanh tiêu đề tấm trượt.
   *
   * Trên điện thoại tấm trượt che gần hết màn và `ChatBox` bên trong cố ý không
   * mọc thêm tiêu đề thứ hai - nên nếu chỗ này không nói kênh nào đang mở thì
   * người chơi mất hẳn thông tin đó, đúng thứ mà cả vòng sửa này dựng lên.
   */
  title?: string;
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
  composer,
  channels,
  markers,
  emptyHint,
  title,
  draft,
  onDraftChange,
  selfId,
  phase,
}: Props) {
  const [open, setOpen] = useState(false);
  const unread = useChatUnread(messages, selfId, open);
  /*
   * Bảng biểu tượng của ChatBox đang mở hay không.
   *
   * Trong ref chứ không trong state: nó chỉ được đọc bên trong handler Escape,
   * không có gì trên màn hình đổi theo nó, và `useModalFocus` ghim callback
   * `onEscape` vào một ref của riêng nó ở mỗi lần render - một biến state ở
   * đây sẽ dựng lại bẫy focus mỗi lần mở/đóng bảng và ném focus về đầu tấm
   * trượt giữa lúc người chơi đang chọn biểu tượng.
   */
  const emojiOpenRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  /*
   * Tấm trượt là modal thật, không chỉ là một cái nhãn `aria-modal`.
   *
   * Bản cũ khai `aria-modal="true"` nhưng Tab vẫn đi thẳng xuống lưới bỏ phiếu
   * nằm dưới tấm nền mờ: người dùng bàn phím gõ vài phím Tab là "ra khỏi" một
   * tấm trượt đang che 72% màn hình mà không hề biết, rồi Enter trúng một nút
   * họ không nhìn thấy. Hook này giữ Tab lại, tắt phần trang phía sau, và trả
   * focus về nút mở chat lúc đóng.
   *
   * Tấm nền mờ đi cùng tấm trượt trong danh sách gốc: nó là anh em ruột của tấm
   * trượt, và nếu bị `inert` thì chạm ra ngoài để đóng sẽ hết tác dụng.
   *
   * `restoreTo` là bắt buộc chứ không thừa: nút mở chat bị GỠ trong lúc tấm
   * trượt mở (`{!open && ...}`), nên phần tử được nhớ lúc mở đã không còn trong
   * tài liệu lúc đóng.
   */
  useModalFocus({
    active: open,
    roots: [sheetRef, scrimRef],
    /*
     * Ô nhập bị KHOÁ thì không được nhận focus mở màn.
     *
     * `focus()` trên một input `disabled` là lệnh không làm gì cả, nên focus ở
     * lại `body` và người dùng bàn phím mở tấm trượt ra rồi đứng ngoài nó. Bỏ
     * trống thì hook rơi về phần tử focus được đầu tiên trong tấm trượt - nút
     * Đóng hoặc hàng tab kênh, đúng thứ họ dùng được lúc không nói được.
     */
    initialFocus: composer.canSend ? inputRef : undefined,
    restoreTo: triggerRef,
    /*
     * Escape đóng LỚP TRONG CÙNG.
     *
     * Bảng biểu tượng nằm trong tấm trượt này. Không có nhánh dưới đây thì một
     * phím Escape lúc bảng đang mở sẽ cuốn cả tấm trượt đi theo, và người chơi
     * mất luôn khung chat trong khi họ chỉ định gập cái bảng lại. Bảng tự đóng
     * mình ở pha bubble của cùng sự kiện đó - xem chú thích trong EmojiPicker.
     */
    onEscape: () => {
      if (emojiOpenRef.current) return;
      setOpen(false);
    },
  });

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
              ref={scrimRef}
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
              ref={sheetRef}
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
                <h2 className="mt-1 min-w-0 truncate font-display text-base font-bold text-white">
                  {title ?? "Trò chuyện"}
                </h2>
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
                  composer={composer}
                  channels={channels}
                  markers={markers}
                  emptyHint={emptyHint}
                  draft={draft}
                  onDraftChange={onDraftChange}
                  // Không còn `autoFocus`: focus lúc mở giờ do useModalFocus đặt,
                  // và nó gọi focus({ preventScroll: true }) - autoFocus của React
                  // thì không, nên nó cuộn trang ngay giữa lúc tấm trượt đang
                  // trượt lên và làm nhịp mở giật một cái.
                  inputRef={inputRef}
                  onEmojiOpenChange={(emojiOpen) => {
                    emojiOpenRef.current = emojiOpen;
                  }}
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
          ref={triggerRef}
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
