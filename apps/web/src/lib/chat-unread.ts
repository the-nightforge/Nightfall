"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@masoi/shared";

/**
 * Mốc "đã đọc tới đâu" của khung chat.
 *
 * Mốc là ID của tin nhắn cuối cùng đã đọc chứ không phải một con số đếm:
 * `snapshot.chatLog` được thay TOÀN BỘ mỗi lần server đẩy snapshot và bị cắt
 * còn 100 dòng gần nhất, nên mọi cách đếm theo độ dài mảng đều lệch ngay lần
 * cắt đầu tiên.
 */
export interface UnreadMark {
  lastSeenId: string | null;
}

export const NOTHING_SEEN: UnreadMark = { lastSeenId: null };

/**
 * Số tin nhắn tới sau mốc, không tính tin của chính mình.
 *
 * Không tìm thấy mốc trong danh sách nghĩa là log đã trôi qua mất mốc đó -
 * khi ấy đếm tất, vì báo thừa còn hơn giấu mất một dòng người chơi chưa đọc.
 */
export function countUnread(
  messages: ChatMessage[],
  mark: UnreadMark,
  selfId: string | null,
): number {
  if (messages.length === 0) return 0;
  const seenAt = mark.lastSeenId
    ? messages.findIndex((message) => message.id === mark.lastSeenId)
    : -1;
  let unread = 0;
  for (let i = seenAt + 1; i < messages.length; i += 1) {
    if (messages[i].playerId !== selfId) unread += 1;
  }
  return unread;
}

/** Mốc mới sau khi người chơi vừa nhìn khung chat. */
export function markAllRead(messages: ChatMessage[]): UnreadMark {
  return { lastSeenId: messages.at(-1)?.id ?? null };
}

/** Nhãn hiển thị trên huy hiệu; trên 99 thì con số chính xác không còn nghĩa gì. */
export function unreadLabel(unread: number): string {
  return unread > 99 ? "99+" : String(unread);
}

/**
 * Đếm tin chưa đọc cho khung chat đóng/mở được.
 *
 * Vào phòng giữa chừng thì lịch sử có sẵn KHÔNG phải tin chưa đọc: người chơi
 * vừa mới tới, chưa ai nhắn gì cho họ cả. Nên lần đầu có dữ liệu là đặt mốc ở
 * cuối danh sách chứ không đếm từ đầu - nếu không, huy hiệu bật lên "99+" ngay
 * khi vừa vào và chẳng nói lên điều gì.
 */
export function useChatUnread(
  messages: ChatMessage[],
  selfId: string | null,
  open: boolean,
): number {
  const [mark, setMark] = useState<UnreadMark>(NOTHING_SEEN);
  const primed = useRef(false);

  useEffect(() => {
    if (primed.current) return;
    primed.current = true;
    setMark(markAllRead(messages));
  }, [messages]);

  // Khung đang mở thì mọi tin tới đều coi như đã đọc ngay.
  useEffect(() => {
    if (!open) return;
    setMark(markAllRead(messages));
  }, [open, messages]);

  return open ? 0 : countUnread(messages, mark, selfId);
}
