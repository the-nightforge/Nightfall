"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@masoi/shared";
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

interface Props {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  placeholder?: string;
}

export function ChatBox({ messages, onSend, placeholder }: Props) {
  const [text, setText] = useState("");
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
      <div ref={boxRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {messages.length === 0 && (
          <p className="text-sm text-mist/60">Chưa có tin nhắn nào.</p>
        )}
        {messages.map((message) => {
          const mine = message.playerId === meId;
          return (
            <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-xl border px-2.5 py-1.5 ${
                  mine
                    ? "bg-indigo-500/15 border-indigo-500/25"
                    : CHANNEL_STYLE[message.channel] ?? DEFAULT_CHANNEL_STYLE
                }`}
              >
                <div className="flex items-baseline gap-1.5">
                  <span
                    className={`text-xs font-bold ${mine ? "text-indigo-200" : "text-white"}`}
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
                    {CHANNEL_ICON[message.channel] ?? "💬"}
                  </span>
                </div>
                {/* break-words: một chuỗi 300 ký tự không dấu cách sẽ đẩy toang cột phụ. */}
                <p className="break-words text-sm text-mist">{message.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2 border-t border-night-600/60 p-2">
        <input
          className="input"
          value={text}
          maxLength={300}
          placeholder={placeholder ?? "Nhập tin nhắn..."}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="btn-primary shrink-0" onClick={submit} disabled={!text.trim()}>
          Gửi
        </button>
      </div>
    </div>
  );
}
