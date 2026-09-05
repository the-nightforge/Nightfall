"use client";

import { useEffect, useRef } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { AttentionChannel, browserAttentionPorts } from "./attention";
import { attentionFor } from "./attention-cues";

/**
 * Nối snapshot của phòng vào ba kênh gọi chú ý (tiêu đề tab, rung, thông báo).
 *
 * Cùng khuôn với `useGameAudio`: snapshot trước nằm trong ref để so cạnh, và
 * ref sống xuyên qua lần rớt mạng nên resync giữa pha không báo lại việc cũ.
 * Kênh được dựng trong effect chứ không lúc render vì nó đọc `document`.
 */
export function useAttention(snapshot: RoomSnapshot | null): void {
  const previous = useRef<RoomSnapshot | null>(null);
  const channel = useRef<AttentionChannel | null>(null);

  useEffect(() => {
    channel.current = new AttentionChannel(browserAttentionPorts());
    return () => {
      channel.current?.dispose();
      channel.current = null;
      previous.current = null;
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    channel.current?.show(attentionFor(previous.current, snapshot));
    previous.current = snapshot;
  }, [snapshot]);
}
