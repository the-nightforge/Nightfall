import { AccessToken, type VideoGrant } from "livekit-server-sdk";
import { TrackSource } from "@livekit/protocol";

/**
 * Adapter LiveKit - nơi DUY NHẤT trong server import SDK của nhà cung cấp.
 *
 * Không chứa luật chơi. Đổi nhà cung cấp sau này chỉ phải viết lại file này.
 * Phần biết luật chơi nằm ở `./service.ts`.
 */

/**
 * Participant không có trong room - vì chưa từng vào voice, hoặc đã rời.
 *
 * Phải phân biệt được với lỗi thật (mạng, 5xx): coi nó là lỗi sẽ khiến
 * `service.ts` leo thang sang `removeParticipant`, mà trên LiveKit Cloud điều
 * đó THU HỒI TOKEN của người chưa từng dùng voice - họ sẽ không vào được nữa và
 * không hiểu vì sao.
 */
export class VoiceNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoiceNotFoundError";
  }
}

export interface VoiceConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
  /** Vào tên room để dev và production không bao giờ đụng nhau. */
  env: string;
}

/**
 * Token chỉ đủ để join, không đủ để giữ.
 *
 * Mặc định của LiveKit là 6 giờ - dài hơn mọi ván đấu, nên hết hạn không cứu
 * được gì. Ở đây token còn KHÔNG mang quyền nói (xem `joinTokenGrant`), nên TTL
 * ngắn là lớp phòng thủ thứ hai chứ không phải thứ nhất.
 */
export const TOKEN_TTL_SECONDS = 120;

/**
 * Grant của token join. Ghim toàn bộ, không dựa vào bất kỳ mặc định nào.
 *
 * Hai cái bẫy mặc định của LiveKit mà bộ này chặn:
 *
 *  1. `canPublishData` MẶC ĐỊNH LÀ TRUE. Không đóng lại thì mọi người có một
 *     kênh dữ liệu không ai gác - người chết gõ `publishData(...)` trong
 *     DevTools là nhắn thẳng tới toàn bộ người sống, không qua `resolveChat`,
 *     không rate limit, không lưu vết.
 *  2. Không set cả `canPublish` lẫn `canSubscribe` thì LiveKit BẬT CẢ HAI.
 *
 * `canPublish` LUÔN false, kể cả cho người đang được phép nói. Quyền của
 * participant lấy từ token lúc join, nên token mang sẵn quyền nói là token dùng
 * lại được: người chơi còn sống lúc 10:00 giữ token, chết lúc 10:05, nối lại
 * bằng token cũ là có một phiên mới với quyền của lúc còn sống. Quyền nói vì
 * thế chỉ đến từ `updateParticipant` sau khi đã join.
 *
 * CỐ Ý không có `canPublishSources` ở đây. SDK ghi rõ nó "supersedes
 * CanPublish": liệt kê microphone trong token sẽ CHO PHÉP nói dù `canPublish`
 * là false, phá đúng lý do token tồn tại. Danh sách nguồn chỉ xuất hiện lúc cấp
 * quyền, trong `participantPermission`.
 */
export function joinTokenGrant(roomName: string): VideoGrant {
  return {
    roomJoin: true,
    room: roomName,
    canSubscribe: true,
    canPublish: false,
    canPublishData: false,
    canUpdateOwnMetadata: false,
    hidden: false,
  };
}

/** Quyền lúc chạy, gửi kèm mọi lời gọi `updateParticipant`. */
export interface VoiceParticipantPermission {
  canSubscribe: boolean;
  canPublish: boolean;
  canPublishData: boolean;
  canPublishSources: TrackSource[];
  canUpdateMetadata: boolean;
  hidden: boolean;
}

/**
 * Bộ quyền đầy đủ cho một participant đang ở trong room.
 *
 * LiveKit cập nhật quyền theo kiểu THAY THẾ, nên phải gửi trọn bộ mỗi lần -
 * gửi thiếu `canSubscribe` là người đó hoá điếc.
 *
 * Lưu ý tên trường: token dùng `canUpdateOwnMetadata`, còn ở đây là
 * `canUpdateMetadata`. Gõ nhầm thì trường bị bỏ qua im lặng.
 */
export function participantPermission(canPublish: boolean): VoiceParticipantPermission {
  return {
    canSubscribe: true,
    canPublish,
    canPublishData: false,
    // Chỉ microphone: chặn luôn camera và chia sẻ màn hình.
    canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
    canUpdateMetadata: false,
    hidden: false,
  };
}

export async function mintJoinToken(
  config: VoiceConfig,
  roomName: string,
  playerId: string,
  displayName: string,
): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    // Identity CHÍNH LÀ playerId - không sinh id thứ hai, không cần bảng ánh xạ.
    identity: playerId,
    name: displayName,
    ttl: TOKEN_TTL_SECONDS,
  });
  token.addGrant(joinTokenGrant(roomName));
  return token.toJwt();
}

// ---------------------------------------------------------------------------
// Scheme: trình duyệt cần wss://, RoomServiceClient cần https://
// ---------------------------------------------------------------------------

function swapScheme(url: string, map: Record<string, string>): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const match = /^([a-z]+):\/\/(.*)$/i.exec(trimmed);
  if (!match) return trimmed;
  const [, scheme, rest] = match;
  return `${map[scheme.toLowerCase()] ?? scheme}://${rest}`;
}

/** Dạng đưa cho trình duyệt. */
export function browserUrl(url: string): string {
  return swapScheme(url, { https: "wss", http: "ws" });
}

/** Dạng đưa cho RoomServiceClient phía server. */
export function apiUrl(url: string): string {
  return swapScheme(url, { wss: "https", ws: "http" });
}

// ---------------------------------------------------------------------------
// Adapter thật
// ---------------------------------------------------------------------------

/** Room rỗng tự tiêu sau 5 phút - lớp lưới cuối nếu mọi lối xoá tường minh đều trượt. */
export const EMPTY_ROOM_TIMEOUT_SECONDS = 300;

/**
 * LiveKit không phơi ra kiểu lỗi riêng cho "không tồn tại", nên phải nhận dạng
 * bằng thông điệp và mã trạng thái.
 *
 * Nhận nhầm theo hướng NÀY là an toàn hơn hướng ngược lại: coi lỗi thật thành
 * NotFound chỉ làm mất một lần thử lại, còn coi NotFound thành lỗi thật sẽ leo
 * thang sang `removeParticipant` và thu hồi token của người vô can.
 */
function isNotFound(err: unknown): boolean {
  const status = (err as { status?: number; code?: number })?.status ?? (err as { code?: number })?.code;
  if (status === 404) return true;
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return message.includes("does not exist") || message.includes("not found");
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isNotFound(err)) throw new VoiceNotFoundError(err instanceof Error ? err.message : "not found");
    throw err;
  }
}

/**
 * Dựng adapter thật. Kiểu trả về cố ý để `service.ts` khai báo (`VoiceAdmin`) -
 * file này không biết gì về luật chơi và không import ngược lên service.
 */
export function createLiveKitAdmin(config: VoiceConfig) {
  // Import trễ để `livekit-server-sdk` không bị nạp ở môi trường không dùng voice.
  const { RoomServiceClient } = require("livekit-server-sdk") as typeof import("livekit-server-sdk");
  const client = new RoomServiceClient(apiUrl(config.url), config.apiKey, config.apiSecret);

  return {
    /**
     * Tạo room tường minh. BẮT BUỘC, không phải tối ưu hoá: LiveKit tự tạo room
     * khi người đầu tiên join, và đường tự tạo đó không áp `emptyTimeout` mình
     * muốn - room rỗng sẽ sống lâu hơn dự tính.
     */
    async createRoom(roomName: string): Promise<void> {
      await wrap(() =>
        client.createRoom({ name: roomName, emptyTimeout: EMPTY_ROOM_TIMEOUT_SECONDS }),
      );
    },

    async updateParticipant(
      roomName: string,
      identity: string,
      permission: VoiceParticipantPermission,
    ): Promise<void> {
      // Gửi TRỌN bộ quyền mỗi lần: LiveKit cập nhật theo kiểu thay thế, gửi
      // thiếu `canSubscribe` là người đó hoá điếc.
      await wrap(() => client.updateParticipant(roomName, identity, undefined, permission));
    },

    async removeParticipant(roomName: string, identity: string): Promise<void> {
      await wrap(() => client.removeParticipant(roomName, identity));
    },

    async deleteRoom(roomName: string): Promise<void> {
      await wrap(() => client.deleteRoom(roomName));
    },
  };
}
