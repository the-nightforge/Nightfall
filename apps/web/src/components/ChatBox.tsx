"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { GHOST_AUTHOR_ID, type ChatMessage } from "@masoi/shared";
import { getIdentity } from "@/lib/identity";

const CHANNEL_LABEL: Record<string, string> = {
  lobby: "Phòng",
  day: "Làng",
  wolves: "Sói",
  dead: "Người chết",
};

const CHANNEL_ICON: Record<string, string> = {
  lobby: "🏠",
  day: "☀️",
  wolves: "🐺",
  dead: "💀",
};

/**
 * Nền bong bóng theo kênh.
 *
 * Kênh là thông tin an toàn quan trọng nhất trong khung này: người chết xem
 * được cả kênh Sói lẫn kênh Làng, và một dòng đọc nhầm kênh là đọc nhầm cả ván.
 * Nhãn chữ nhỏ ở bản cũ quá dễ lướt qua, nên màu nền mang luôn nghĩa đó.
 */
const CHANNEL_STYLE: Record<string, string> = {
  wolves: "bg-blood-600/15 border-blood-500/25",
  dead: "bg-night-800/60 border-white/[0.04]",
};
const DEFAULT_CHANNEL_STYLE = "bg-night-800/70 border-white/[0.05]";

/**
 * Bong bóng hội thoại đặt trong ô nhập.
 *
 * Vẽ tay thay vì kéo về một bộ icon: cả web mới chỉ cần đúng một hình này, và
 * thêm hẳn một dependency cho một thẻ <svg> thì phần tải về đắt hơn phần dùng.
 * Nét theo đúng dựng hình của Lucide MessageCircle (lưới 24, stroke 2) để sau
 * này có lắp bộ icon thật thì hình không nhảy.
 */
function MessageCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  placeholder?: string;
  /**
   * Bản nháp do bên ngoài giữ.
   *
   * Trên điện thoại khung này sống trong một tấm trượt đóng mở được, và tấm
   * trượt đóng lại là component bị tháo. Giữ chữ đang gõ trong state nội bộ thì
   * mỗi lần liếc ra ngoài xem lưới người chơi là mất câu đang viết dở. Bỏ trống
   * cặp prop này thì khung tự giữ nháp như cũ.
   */
  draft?: string;
  onDraftChange?: (draft: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
}

export function ChatBox({
  messages,
  onSend,
  placeholder,
  draft,
  onDraftChange,
  inputRef,
  autoFocus,
}: Props) {
  const [ownText, setOwnText] = useState("");
  const text = draft ?? ownText;
  const setText = onDraftChange ?? setOwnText;
  const boxRef = useRef<HTMLDivElement>(null);
  const meId = getIdentity()?.playerId;

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [messages.length]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  return (
    // Chiều cao do chỗ đặt quyết định, không tự đặt max-h: ở cột phụ trên desktop
    // khung này phải cao hết màn, còn trên điện thoại thì bị bó lại 18rem.
    // min-h-0 là bắt buộc, thiếu nó thì flex item không co được và phần tin nhắn
    // tràn ra ngoài thay vì cuộn.
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-night-600/60 bg-night-900/70">
      {/*
        * overscroll-contain: trên điện thoại khung này nằm trong một tấm trượt
        * đè lên trang phòng. Thiếu nó thì vuốt tới đáy danh sách rồi vuốt tiếp
        * sẽ "xuyên" xuống trang phía sau, kéo trang trôi đi trong khi mắt vẫn
        * đang ở khung chat - và lúc đóng tấm trượt thì trang đã ở chỗ khác.
        */}
      <div
        ref={boxRef}
        className={`lobby-roster-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-2.5 ${
          // Khung rỗng thì dồn nội dung vào GIỮA thay vì dán một dòng chữ xám ở
          // mép trên và bỏ trống 400px bên dưới - ở cột phải trên desktop đó là
          // khoảng trống lớn nhất của cả trang phòng chờ.
          messages.length === 0 ? "grid place-content-center" : "space-y-1.5"
        }`}
      >
        {messages.length === 0 && (
          <div className="px-4 py-6 text-center">
            {/*
              * /55 chứ không phải /35.
              *
              * Nét icon ở /35 trộn ra khoảng #3f4b61 trên nền #0b1120, tức là
              * tương phản 2.1:1 - dưới mức 3:1 cho hình đồ hoạ, và trên màn
              * hình chỉnh tối một chút thì nó biến mất hẳn: khung rỗng trông
              * như chỉ có hai dòng chữ. /55 đưa lên khoảng 3.5:1, bằng đúng
              * icon trong ô nhập ngay bên dưới, mà vẫn nhạt hơn hai dòng chữ
              * nên thứ tự đọc không đổi.
              */}
            <MessageCircleIcon
              className="mx-auto h-8 w-8 text-mist/55"
            />
            <p className="mt-2.5 text-sm font-semibold text-mist/85">Chưa có tin nhắn nào</p>
            <p className="mt-1 text-xs leading-relaxed text-mist/70">
              Chào cả phòng một câu trong lúc chờ đủ người.
            </p>
          </div>
        )}
        {messages.map((message) => {
          const mine = message.playerId === meId;
          // Lời nhắn ẩn danh phải TRÔNG khác một câu chat thường, nếu không
          // người chơi sẽ tưởng có một người tên "Một linh hồn" trong phòng.
          const ghost = message.playerId === GHOST_AUTHOR_ID;
          return (
            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-xl border px-2.5 py-1.5 ${
                  ghost
                    ? "border-violet-500/30 bg-violet-900/25 italic"
                    : mine
                      ? "bg-indigo-500/15 border-indigo-500/25"
                      : CHANNEL_STYLE[message.channel] ?? DEFAULT_CHANNEL_STYLE
                }`}
              >
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`text-xs font-bold ${
                      ghost ? "text-violet-200" : mine ? "text-indigo-200" : "text-white"
                    }`}
                  >
                    {message.playerName}
                  </span>
                  <span
                    className={`text-[11px] leading-none ${
                      message.channel === "wolves" ? "text-blood-400/80" : "text-mist/60"
                    }`}
                    title={CHANNEL_LABEL[message.channel] ?? message.channel}
                    aria-label={CHANNEL_LABEL[message.channel] ?? message.channel}
                  >
                    {ghost ? "👻" : CHANNEL_ICON[message.channel] ?? "💬"}
                  </span>
                </div>
                {/* break-words: một chuỗi 300 ký tự không dấu cách sẽ đẩy toang cột phụ. */}
                <p className="break-words text-sm leading-relaxed text-mist/95">{message.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 border-t border-night-600/60 p-2">
        {/*
          * Icon nằm chồng lên ô nhập chứ không đứng cạnh: đặt cạnh thì nó ăn
          * mất chiều ngang của ô, mà trên điện thoại ô này đã hẹp sẵn.
          * pointer-events-none để chạm vào icon vẫn là chạm vào ô nhập.
          */}
        <div className="relative min-w-0 flex-1">
          <MessageCircleIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-mist/55" />
          <input
            className="input pl-10"
            ref={inputRef}
            autoFocus={autoFocus}
            aria-label="Nội dung tin nhắn"
            value={text}
            maxLength={300}
            placeholder={placeholder ?? "Nhập tin nhắn..."}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <button className="btn-primary shrink-0" onClick={submit} disabled={!text.trim()}>
          Gửi
        </button>
      </div>
    </div>
  );
}
