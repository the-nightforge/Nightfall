"use client";

import { useEffect, useRef, type RefObject } from "react";
import { EMOJI_GROUPS } from "@/lib/chat-emoji";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (emoji: string) => void;
  /** Ô nhập đi kèm - focus quay về đây lúc bảng đóng. */
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * Bảng biểu tượng của ô chat.
 *
 * Nút nằm TRONG ô nhập, mép phải. Đặt nó thành nút thứ ba trong hàng thì hàng
 * đáy có ba đích chạm cạnh nhau - biểu tượng, ô nhập, Gửi - và trên điện thoại
 * ô nhập vốn đã hẹp phải nhường thêm chỗ. Trong ô thì nó ăn vào phần đệm sẵn
 * có, và nó ở ngay chỗ mắt đang nhìn lúc gõ.
 *
 * Bảng mở LÊN TRÊN: hàng nhập nằm sát đáy khung ở cả cột phải desktop lẫn tấm
 * trượt điện thoại, mở xuống là mở ra ngoài màn hình. Bảng không đóng sau mỗi
 * lần chọn - "😱😱😱" là một câu nói hoàn chỉnh trong ván Ma Sói, và bắt mở
 * lại bảng ba lần để nói nó là bắt người chơi trả giá cho cách họ đang chơi.
 */
export function EmojiPicker({ open, onOpenChange, onPick, inputRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    // Focus rơi vào ô đầu tiên: mở bảng bằng bàn phím rồi phải Tab thêm một
    // nhịp nữa mới tới được ô nào là một nhịp thừa ở mọi lần mở.
    panelRef.current?.querySelector("button")?.focus({ preventScroll: true });

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapRef.current?.contains(target)) return;
      onOpenChange(false);
    };

    /*
     * KHÔNG bắt ở pha capture.
     *
     * Trên điện thoại bảng này sống trong tấm trượt chat, mà tấm trượt đã có
     * một handler Escape ở pha capture trên document để tự đóng. Bắt capture ở
     * đây thì handler nào đăng ký trước sẽ thắng - tức là tấm trượt - và một
     * phím Escape đóng luôn cả khung chat trong khi người chơi chỉ định đóng
     * bảng biểu tượng. Ở pha bubble thì cả hai cùng nhận được phím, và
     * MobileChatDock biết bảng đang mở nên nó nhường lượt này.
     */
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onOpenChange(false);
      // Trả focus về chỗ đang gõ dở, không phải về nút vừa mở bảng: người chơi
      // bấm Escape để quay lại viết tiếp câu đang bỏ giữa chừng.
      inputRef.current?.focus({ preventScroll: true });
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange, inputRef]);

  return (
    <div ref={wrapRef} className="contents">
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Bảng biểu tượng"
          /*
           * bottom-full + mb-2 neo bảng ngay trên hàng nhập. Nó ĐÈ lên phần
           * tin nhắn phía trên chứ không đẩy layout - khung chat cao cố định,
           * đẩy được thì hàng nhập tụt xuống dưới mép và bàn phím ảo nuốt mất.
           *
           * right-0 chứ không căn giữa: nút mở nằm ở mép phải, và ở cột chat
           * rộng 21rem một bảng căn giữa sẽ lệch hẳn khỏi ngón tay vừa bấm.
           *
           * max-w chặn máy hẹp: 17rem neo theo mép phải ô nhập thì dưới 360px
           * bề ngang, mép trái của bảng lùi ra ngoài màn hình và hai ô đầu mỗi
           * hàng bị cắt mất - lưới co lại vẫn bấm được, tràn ra ngoài thì không.
           */
          className="absolute bottom-full right-0 z-30 mb-2 w-[17rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-night-600 bg-night-900/95 p-2 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.9)] backdrop-blur-md"
        >
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label} className="mb-1.5 last:mb-0">
              <p className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-mist/60">
                {group.label}
              </p>
              <div className="grid grid-cols-6 gap-0.5">
                {group.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    // leading-none: emoji là ký tự cao, để mặc định thì nó đội
                    // ô cao thêm vài px và lưới hết vuông.
                    className="rounded-lg py-1.5 text-xl leading-none transition hover:bg-night-700 focus-visible:bg-night-700"
                    onClick={() => onPick(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        ref={triggerRef}
        type="button"
        aria-label="Chèn biểu tượng"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          const next = !open;
          onOpenChange(next);
          if (!next) inputRef.current?.focus({ preventScroll: true });
        }}
        className={`absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-lg leading-none transition ${
          open ? "bg-night-700 text-white" : "text-mist/70 hover:bg-night-700 hover:text-white"
        }`}
      >
        <span aria-hidden="true">🙂</span>
      </button>
    </div>
  );
}
