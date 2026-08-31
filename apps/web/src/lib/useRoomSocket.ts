"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, RoomSnapshot, SocketError } from "@masoi/shared";
import { recordServerTime } from "./clock";
import { getIdentity, type Identity } from "./identity";
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

  const emit = (event: string, payload?: unknown) => {
    const identity = getIdentity();
    if (!identity) return;
    getSocket(identity).emit(event, payload ?? {});
  };

  return { ...state, emit };
}
