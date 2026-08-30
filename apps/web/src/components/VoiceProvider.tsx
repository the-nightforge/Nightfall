"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { getIdentity } from "@/lib/identity";
import { getSocket } from "@/lib/socket";
import { useVoice, type UseVoice } from "@/lib/useVoice";

/**
 * Một chỗ duy nhất gọi `useVoice`.
 *
 * Cần context vì hai nơi rất xa nhau trong cây cùng cần dữ liệu voice: bảng
 * điều khiển ở thanh bên, và vòng sáng "đang nói" quanh từng người trong danh
 * sách người chơi. Gọi hook hai lần sẽ tạo HAI kết nối LiveKit cùng một danh
 * tính, mà trùng danh tính thì LiveKit đá cái cũ - hai bản sao sẽ thay nhau đá
 * lẫn nhau.
 */
const VoiceContext = createContext<UseVoice | null>(null);

export function VoiceProvider({
  snapshot,
  children,
}: {
  snapshot: RoomSnapshot | null;
  children: ReactNode;
}) {
  const [socket, setSocket] = useState<ReturnType<typeof getSocket> | null>(null);

  useEffect(() => {
    const identity = getIdentity();
    if (identity) setSocket(getSocket(identity));
  }, []);

  const voice = useVoice(socket, snapshot?.voice);
  return <VoiceContext.Provider value={voice}>{children}</VoiceContext.Provider>;
}

/** Trả null khi ở ngoài provider, để component dùng được cả ở nơi chưa có voice. */
export function useVoiceContext(): UseVoice | null {
  return useContext(VoiceContext);
}

/** Ai đang nói. Rỗng khi voice tắt hoặc chưa nối. */
export function useSpeakers(): ReadonlySet<string> {
  return useContext(VoiceContext)?.speakers ?? EMPTY;
}

const EMPTY: ReadonlySet<string> = new Set();
