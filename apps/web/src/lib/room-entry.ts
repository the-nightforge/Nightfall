import type { RoomSnapshot, SocketError } from "@masoi/shared";
import { CLIENT_EVENTS, SERVER_EVENTS } from "@masoi/shared";
import type { Socket } from "socket.io-client";
import { runWhenSocketConnected } from "./room-socket-session";

/**
 * Thông báo khi socket không bắt tay được với server.
 *
 * Tách thành hằng số để test khẳng định đúng chuỗi này thay vì chép lại chữ:
 * sửa câu chữ mà quên sửa test là một bài kiểm tra vô nghĩa vẫn xanh.
 */
export const CONNECT_FAILED_MESSAGE = "Không thể kết nối máy chủ. Vui lòng thử lại.";

export type RoomEntryRequest = { kind: "create" } | { kind: "join"; code: string };

export interface RoomEntryHandlers {
  /** Đã vào được phòng. `code` là mã phòng để điều hướng tới. */
  onEntered: (code: string) => void;
  /** Thất bại, kèm câu để hiện cho người dùng. Nút phải bật lại sau lời gọi này. */
  onFailed: (message: string) => void;
}

/**
 * Một lượt "vào phòng": nối socket, phát lệnh, rồi chốt đúng MỘT kết quả.
 *
 * Vì sao phải là một hàm riêng chứ không nằm thẳng trong trang chủ:
 *
 * 1. Bản cũ chỉ nghe app event `"error"` (server chủ động gửi khi từ chối) và
 *    `"room:snapshot"`. Nhưng handshake hỏng - sai origin CORS, server ngủ,
 *    mất mạng, transport bị chặn - thì socket.io bắn `"connect_error"`, không
 *    bắn `"error"`. Không nhánh nào hạ cờ bận, nên nút "Tạo phòng mới" mờ đi
 *    vĩnh viễn cho tới khi người dùng tự tải lại trang.
 *
 * 2. Socket được cấu hình `reconnectionAttempts: Infinity`. Sau `connect_error`
 *    nó vẫn âm thầm thử lại; nếu callback của lần thao tác ĐÃ THẤT BẠI còn nằm
 *    trong danh sách listener thì một lần `connect` muộn sẽ tạo ra một phòng mà
 *    người dùng không hề bấm nút lần nữa.
 *
 * Cả hai đều là chuyện của vòng đời listener, và vòng đời đó thì test được -
 * còn `page.tsx` thì không, vì bộ test hiện tại chỉ chạy `src/lib/*.test.ts`.
 *
 * Cách chốt: một cờ `settled` cộng một `cleanup()` duy nhất. Kết quả nào tới
 * trước thì gỡ sạch bốn listener rồi khoá luôn, nên không có đường nào để một
 * event tới sau gọi lại callback hay phát lại lệnh cũ.
 *
 * Chỉ gỡ ĐÚNG những listener của chính mình và không đụng tới `disconnect()`
 * hay tuỳ chọn reconnect: cơ chế kết nối lại khi người chơi đã ở trong phòng
 * do `attachRoomSocketSession` lo, và nó phải chạy tiếp bình thường.
 *
 * @returns hàm huỷ - gọi được nhiều lần, gọi sau khi đã chốt thì không làm gì.
 */
export function enterRoom(
  socket: Socket,
  request: RoomEntryRequest,
  handlers: RoomEntryHandlers,
): () => void {
  let settled = false;
  let cancelWaitForConnect: (() => void) | null = null;

  function cleanup() {
    socket.off(SERVER_EVENTS.SNAPSHOT, onSnapshot);
    socket.off(SERVER_EVENTS.ERROR, onAppError);
    socket.off("connect_error", onConnectError);
    cancelWaitForConnect?.();
    cancelWaitForConnect = null;
  }

  /** Chốt kết quả đúng một lần: gỡ listener trước, rồi mới báo ra ngoài. */
  function settle(report: () => void) {
    if (settled) return;
    settled = true;
    cleanup();
    report();
  }

  // Handler đặt tên chứ không dùng arrow ẩn danh: `off()` cần đúng tham chiếu
  // đã truyền cho `on()`, và một hàm ẩn danh dựng lại mỗi lần là không gỡ được.
  function onSnapshot(snapshot: RoomSnapshot) {
    // Với "join" dùng mã người dùng đã nhập, với "create" dùng mã server vừa
    // cấp - lúc bấm nút thì mã đó còn chưa tồn tại.
    const code = request.kind === "join" ? request.code : snapshot.code;
    settle(() => handlers.onEntered(code));
  }

  function onAppError(error: SocketError) {
    settle(() => handlers.onFailed(error.message));
  }

  function onConnectError() {
    settle(() => handlers.onFailed(CONNECT_FAILED_MESSAGE));
  }

  socket.on(SERVER_EVENTS.SNAPSHOT, onSnapshot);
  socket.on(SERVER_EVENTS.ERROR, onAppError);
  socket.on("connect_error", onConnectError);

  const cancel = runWhenSocketConnected(socket, () => {
    // Chốt chặn thứ hai bên cạnh việc gỡ listener: nếu vì lý do nào đó lượt này
    // đã kết thúc, tuyệt đối không phát lệnh nữa.
    if (settled) return;
    if (request.kind === "create") socket.emit(CLIENT_EVENTS.ROOM_CREATE, {});
    else socket.emit(CLIENT_EVENTS.ROOM_JOIN, { code: request.code });
  });

  // Socket đã kết nối sẵn thì `runWhenSocketConnected` chạy action NGAY, và
  // server có thể trả lời trong cùng nhịp đó - lúc ấy `settle` đã chạy xong
  // trước khi dòng này gán. Gọi cancel luôn thay vì cất một tham chiếu chết.
  if (settled) cancel();
  else cancelWaitForConnect = cancel;

  return () => settle(() => undefined);
}
