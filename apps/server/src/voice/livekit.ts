import { AccessToken, type VideoGrant } from "livekit-server-sdk";
import { TrackSource } from "@livekit/protocol";

/**
 * Adapter LiveKit - nơi DUY NHẤT trong server import SDK của nhà cung cấp.
 *
 * Không chứa luật chơi. Đổi nhà cung cấp sau này chỉ phải viết lại file này.
 * Phần biết luật chơi nằm ở `./service.ts`.
 */

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
