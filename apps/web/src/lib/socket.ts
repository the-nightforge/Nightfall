"use client";

import { io, type Socket } from "socket.io-client";
import type { Identity } from "./identity";

let socket: Socket | null = null;

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export function getSocket(identity: Identity): Socket {
  if (socket) {
    socket.auth = { playerId: identity.playerId, token: identity.token };
    return socket;
  }
  socket = io(SERVER_URL, {
    autoConnect: false,
    auth: { playerId: identity.playerId, token: identity.token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    transports: ["websocket", "polling"],
  });
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
