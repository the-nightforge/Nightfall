"use client";

import { useState } from "react";
import { DEAD_MESSAGE_MAX_LENGTH, type RoomSnapshot } from "@masoi/shared";

interface Props {
  snapshot: RoomSnapshot;
  onSend: (text: string) => void;
}

/**
 * Ô nhập của Tiếng Vọng Người Chết.
 *
 * Chỉ hiện với linh hồn ĐƯỢC CHỌN, và server là nơi quyết định điều đó -
 * `deadCanSpeak.canAct` đã được tính riêng cho từng người nhận snapshot. Web
 * không tự suy ra ai được nói, vì để làm vậy nó sẽ phải biết danh tính linh
 * hồn, tức đúng thứ cả sự kiện dựa vào việc không ai biết.
 */
export function DeadWhisperPanel({ snapshot, onSend }: Props) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);

  if (!snapshot.deadCanSpeak?.canAct) return null;

  const trimmed = text.trim();
  const submit = () => {
    if (!trimmed || sent) return;
    // Khoá ngay tại chỗ: người chơi chỉ có đúng một lượt cả ván, và một cú
    // double-click sẽ đổi lượt đó thành một thông báo lỗi.
    setSent(true);
    onSend(trimmed);
  };

  return (
    <div className="card border-violet-500/30 bg-violet-950/20">
      <h4 className="font-bold text-violet-200">Tiếng Vọng Người Chết</h4>
      <p className="text-xs text-mist/60">
        Bạn được gửi một lời nhắn ẩn danh tới cả làng. Chỉ một lần, và không ai biết là bạn.
      </p>
      <div className="mt-2 flex gap-2">
        <input
          className="input"
          value={text}
          maxLength={DEAD_MESSAGE_MAX_LENGTH}
          disabled={sent}
          placeholder="Lời nhắn cuối..."
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
        />
        <button className="btn-primary shrink-0" onClick={submit} disabled={!trimmed || sent}>
          Gửi
        </button>
      </div>
      <p className="mt-1 text-right text-[11px] text-mist/65">
        {text.length}/{DEAD_MESSAGE_MAX_LENGTH}
      </p>
    </div>
  );
}
