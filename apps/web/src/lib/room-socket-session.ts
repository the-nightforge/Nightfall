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

/**
 * Chạy action đúng một lần sau khi listener connect đã được gắn.
 *
 * Trả về hàm huỷ để bên gọi gỡ được listener đang chờ. Bắt buộc phải có: socket
 * cấu hình reconnect vô hạn, nên một lượt thao tác đã thất bại mà còn để lại
 * listener `connect` thì lần kết nối lại sau đó sẽ phát lại lệnh cũ - người
 * dùng không bấm gì mà tự nhiên vào một phòng mới.
 *
 * `on` + gỡ tay chứ không `once`: `once` bọc action trong một wrapper, và bên
 * gọi chỉ giữ tham chiếu tới action gốc thì không gỡ chắc chắn được. Handler
 * đặt tên ở đây tự gỡ mình trước khi chạy, nên vẫn đúng nghĩa "một lần".
 */
export function runWhenSocketConnected(socket: Socket, action: () => void): () => void {
  if (socket.connected) {
    action();
    return () => undefined;
  }
  const onConnect = () => {
    socket.off("connect", onConnect);
    action();
  };
  socket.on("connect", onConnect);
  socket.connect();
  return () => socket.off("connect", onConnect);
}
