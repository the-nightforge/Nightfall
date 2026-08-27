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
    <div className="flex h-full min-h-[240px] flex-col rounded-xl border border-night-600/60 bg-night-900/70">
      <div ref={boxRef} className="flex-1 space-y-2 overflow-y-auto p-3 max-h-72">
        {messages.length === 0 && (
          <p className="text-sm text-mist/40">Chưa có tin nhắn nào.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="text-sm">
            <span
              className={`mr-1 rounded px-1 text-[10px] uppercase ${
                m.channel === "wolves"
                  ? "bg-blood-600/30 text-blood-400"
                  : m.channel === "dead"
                    ? "bg-night-700 text-mist/60"
                    : "bg-night-700 text-mist"
              }`}
            >
              {CHANNEL_LABEL[m.channel] ?? m.channel}
            </span>
            <span className={`font-semibold ${m.playerId === meId ? "text-indigo-300" : "text-white"}`}>
              {m.playerName}:
            </span>{" "}
            <span className="text-mist">{m.text}</span>
          </div>
        ))}
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
