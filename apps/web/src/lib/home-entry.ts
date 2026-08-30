import type { Socket } from "socket.io-client";
import type { EntryAttempt } from "./entry-attempt";
import { isAbortError } from "./entry-attempt";
import type { Identity } from "./identity";
import { enterRoom, type RoomEntryRequest } from "./room-entry";

/** Khi fetch ném ngoại lệ không phải do ta abort. */
export const SERVER_UNREACHABLE_MESSAGE = "Không kết nối được server";

export type CreatePlayerOutcome =
  | { ok: true; identity: Identity }
  | { ok: false; message: string };

/**
 * Mọi thứ luồng này cần từ thế giới bên ngoài.
 *
 * Bơm vào chứ không import thẳng, vì cả bộ test hiện tại chạy bằng
 * `tsx --test src/lib/*.test.ts` - không có DOM, không có React, không có
 * localStorage. Luồng này là chỗ hai race condition từng nằm, nên nó phải
 * test được; nhét nó trong một component thì không.
 */
export interface EntryPorts {
  /** Đọc phiên đã lưu (localStorage). */
  readStoredIdentity(): Identity | null;
  /** Ghi phiên vừa tạo. CHỈ được gọi khi lượt còn hợp lệ. */
  storeIdentity(identity: Identity): void;
  /** POST /api/players. Phải truyền `signal` xuống `fetch`. */
  createPlayer(nickname: string, signal: AbortSignal): Promise<CreatePlayerOutcome>;
  /** Ngắt socket cũ rồi dựng socket mới cho danh tính này. */
  openSocket(identity: Identity): Promise<Socket>;
  /** Vừa ghi phiên mới xong - dùng để bật nút "Xoá phiên". */
  onIdentityStored(): void;
  /** Thất bại có lý do đọc được. Bên gọi hiện lỗi và hạ cờ bận. */
  onFailed(message: string): void;
  /** Vào phòng xong. Bên gọi điều hướng. */
  onEntered(code: string): void;
}

/**
 * Chạy trọn một lượt vào phòng, huỷ được ở mọi đoạn.
 *
 * Sau MỌI `await` đều có một chốt `attempt.isActive()`. Đó không phải phòng xa:
 * `await` nào cũng là một chỗ người dùng chen được vào giữa, và trước bản vá
 * này thì
 *
 *   - bấm "Xoá phiên" giữa lúc chờ socket -> `disconnectSocket()` giết socket
 *     nên `connect_error` không bao giờ tới, không ai hạ cờ bận, nút kẹt ở
 *     "Đang mở phòng..." vĩnh viễn;
 *   - rời trang giữa lúc chờ `/api/players` -> hàm cleanup lúc đó còn chưa
 *     được tạo, nên request cứ chạy tiếp rồi lưu danh tính, dựng socket, gắn
 *     listener và gọi `router.push` cho một thao tác đã bị bỏ.
 *
 * Không có nhánh nào chạm ra ngoài mà chưa qua chốt. Chốt đứng TRƯỚC
 * `storeIdentity` chứ không phải sau: ghi vào localStorage rồi mới phát hiện
 * lượt đã chết thì phiên vẫn nằm lại trên máy sau khi người dùng bấm đăng xuất.
 */
export async function runEntryAttempt(
  attempt: EntryAttempt,
  request: RoomEntryRequest,
  nickname: string,
  ports: EntryPorts,
): Promise<void> {
  try {
    const trimmed = nickname.trim();
    const stored = ports.readStoredIdentity();
    let identity: Identity;

    if (stored && stored.nickname === trimmed) {
      // Đã có phiên và không đổi tên -> dùng lại để giữ khả năng reconnect.
      identity = stored;
    } else {
      const outcome = await ports.createPlayer(trimmed, attempt.signal);
      if (!attempt.isActive()) return;
      if (!outcome.ok) {
        attempt.finish();
        ports.onFailed(outcome.message);
        return;
      }
      identity = outcome.identity;
      ports.storeIdentity(identity);
      ports.onIdentityStored();
    }

    const socket = await ports.openSocket(identity);
    // `openSocket` có `await` bên trong (import động module socket), nên đây
    // vẫn là một khe hở thời gian riêng - phải kiểm lại chứ không dùng lại
    // kết quả của lần kiểm trước.
    if (!attempt.isActive()) return;

    const cleanup = enterRoom(socket, request, {
      onEntered: (code) => {
        if (!attempt.isActive()) return;
        // `finish` chứ không phải huỷ: socket từ đây thuộc về trang phòng, và
        // cleanup lúc unmount của Home không được đụng vào nó.
        attempt.finish();
        ports.onEntered(code);
      },
      onFailed: (message) => {
        if (!attempt.isActive()) return;
        // `enterRoom` đã tự gỡ listener của nó khi chốt, nên ở đây chỉ cần
        // đóng lượt lại, không cần chạy cleanup lần nữa.
        attempt.finish();
        ports.onFailed(message);
      },
    });
    attempt.setCleanup(cleanup);
  } catch (error) {
    // Lượt đã chết thì im lặng: người dùng đã đăng xuất hoặc rời trang, và một
    // dòng lỗi đỏ hiện lên lúc đó chỉ gây hoang mang.
    if (!attempt.isActive()) return;
    if (isAbortError(error)) return;
    attempt.finish();
    ports.onFailed(SERVER_UNREACHABLE_MESSAGE);
  }
}
