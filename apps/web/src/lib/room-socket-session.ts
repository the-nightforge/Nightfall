import type { ChatMessage, RoomSnapshot, SocketError } from "@masoi/shared";
import { CLIENT_EVENTS, SERVER_EVENTS } from "@masoi/shared";
import type { Socket } from "socket.io-client";

export interface RoomSocketSessionHandlers {
  onConnect: () => void;
  onDisconnect: () => void;
  onError: (error: SocketError) => void;
  onSnapshot: (snapshot: RoomSnapshot) => void;
  onChat: (message: ChatMessage) => void;
}

/**
 * Gắn listener trước khi bắt đầu kết nối và yêu cầu lại snapshot mỗi lần
 * socket kết nối. Nhờ vậy chuyển route bằng SPA không làm mất snapshot đầu.
 */
export function attachRoomSocketSession(
  socket: Socket,
  code: string,
  handlers: RoomSocketSessionHandlers,
): () => void {
  const onConnect = () => {
    handlers.onConnect();
    socket.emit(CLIENT_EVENTS.ROOM_JOIN, { code });
  };

  socket.on("connect", onConnect);
  socket.on("disconnect", handlers.onDisconnect);
  socket.on(SERVER_EVENTS.ERROR, handlers.onError);
  socket.on(SERVER_EVENTS.SNAPSHOT, handlers.onSnapshot);
  socket.on(SERVER_EVENTS.CHAT_NEW, handlers.onChat);

  if (socket.connected) onConnect();
  else socket.connect();

  return () => {
    socket.off("connect", onConnect);
    socket.off("disconnect", handlers.onDisconnect);
    socket.off(SERVER_EVENTS.ERROR, handlers.onError);
    socket.off(SERVER_EVENTS.SNAPSHOT, handlers.onSnapshot);
    socket.off(SERVER_EVENTS.CHAT_NEW, handlers.onChat);
  };
}

/** Chạy action đúng một lần sau khi listener connect đã được gắn. */
export function runWhenSocketConnected(socket: Socket, action: () => void): void {
  if (socket.connected) {
    action();
    return;
  }
  socket.once("connect", action);
  socket.connect();
}
