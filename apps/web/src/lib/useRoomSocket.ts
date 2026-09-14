"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, MatchChatEntry, RoomSnapshot, SocketError } from "@masoi/shared";
import { recordServerTime } from "./clock";
import { getIdentity, type Identity } from "./identity";
import { fetchMatchChat, mergeArchivedChat } from "./match-history";
import { attachRoomSocketSession } from "./room-socket-session";
import { getSocket } from "./socket";

interface State {
  snapshot: RoomSnapshot | null;
  messages: ChatMessage[];
  error: string | null;
  connected: boolean;
  identityMissing: boolean;
}

export function useRoomSocket(code: string) {
  const [state, setState] = useState<State>({
    snapshot: null,
    messages: [],
    error: null,
    connected: false,
    identityMissing: false,
  });
  const identityRef = useRef<Identity | null>(null);
  identityRef.current = typeof window !== "undefined" ? getIdentity() : null;

  useEffect(() => {
    const identity = getIdentity();
    if (!identity) {
      setState((s) => ({ ...s, identityMissing: true }));
      return;
    }

    const socket = getSocket(identity);

    const onConnect = () => setState((s) => ({ ...s, connected: true, error: null }));
    const onDisconnect = () => setState((s) => ({ ...s, connected: false }));
    const onError = (e: SocketError) =>
      setState((s) => ({ ...s, error: e.message }));

    const onSnapshot = (snap: RoomSnapshot) => {
      // Đo độ lệch đồng hồ ngay khi gói vừa tới, trước cả setState: mọi ms trôi
      // qua sau đó đều bị tính nhầm thành độ lệch.
      recordServerTime(snap.serverNow);
      setState((s) => ({ ...s, snapshot: snap, messages: snap.chatLog, error: null }));
    };

    const onChat = (msg: ChatMessage) => {
      setState((s) =>
        s.messages.some((m) => m.id === msg.id)
          ? s
          : { ...s, messages: [...s.messages.slice(-99), msg] },
      );
    };

    return attachRoomSocketSession(socket, code, {
      onConnect,
      onDisconnect,
      onError,
      onSnapshot,
      onChat,
    });
  }, [code]);

  /*
   * Màn kết thúc: thay 60 tin cuối của snapshot bằng log đầy đủ của ván.
   * Snapshot chỉ mang `gameId` ở GAME_OVER, nên ván mới bắt đầu là tự rơi về
   * chat trực tiếp.
   */
  const gameOverId = state.snapshot?.phase === "GAME_OVER" ? (state.snapshot.gameId ?? null) : null;
  const [archive, setArchive] = useState<{ gameId: string; messages: MatchChatEntry[] } | null>(null);

  useEffect(() => {
    if (!gameOverId) return;
    const controller = new AbortController();
    void fetchMatchChat(gameOverId, controller.signal).then((messages) => {
      if (messages) setArchive({ gameId: gameOverId, messages });
    });
    return () => controller.abort();
  }, [gameOverId]);

  const messages = useMemo(
    () =>
      archive && archive.gameId === gameOverId
        ? mergeArchivedChat(archive.messages, state.messages)
        : state.messages,
    [archive, gameOverId, state.messages],
  );

  const emit = (event: string, payload?: unknown) => {
    const identity = getIdentity();
    if (!identity) return;
    getSocket(identity).emit(event, payload ?? {});
  };

  return { ...state, messages, emit };
}
