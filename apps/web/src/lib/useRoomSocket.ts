"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, RoomSnapshot, SocketError } from "@masoi/shared";
import { CLIENT_EVENTS, SERVER_EVENTS } from "@masoi/shared";
import { getIdentity, type Identity } from "./identity";
import { getSocket } from "./socket";

interface State {
  snapshot: RoomSnapshot | null;
  messages: ChatMessage[];
  error: string | null;
  connected: boolean;
  identityMissing: boolean;
}

export function useRoomSocket() {
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
      setState((s) => ({ ...s, snapshot: snap, messages: snap.chatLog, error: null }));
    };

    const onChat = (msg: ChatMessage) => {
      setState((s) =>
        s.messages.some((m) => m.id === msg.id)
          ? s
          : { ...s, messages: [...s.messages.slice(-99), msg] },
      );
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on(SERVER_EVENTS.ERROR, onError);
    socket.on(SERVER_EVENTS.SNAPSHOT, onSnapshot);
    socket.on(SERVER_EVENTS.CHAT_NEW, onChat);

    if (!socket.connected) socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off(SERVER_EVENTS.ERROR, onError);
      socket.off(SERVER_EVENTS.SNAPSHOT, onSnapshot);
      socket.off(SERVER_EVENTS.CHAT_NEW, onChat);
    };
  }, []);

  const emit = (event: string, payload?: unknown) => {
    const identity = getIdentity();
    if (!identity) return;
    getSocket(identity).emit(event, payload ?? {});
  };

  return { ...state, emit };
}

export const EVENTS = { ...CLIENT_EVENTS };
