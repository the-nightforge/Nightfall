import type { Phase } from "./phases";

/**
 * Luật quyền nói bằng giọng nói.
 *
 * Hàm thuần, không chứa bí mật, dùng chung client/server - cùng kiểu với
 * `validateRoomConfig`. Server dùng nó để CƯỠNG CHẾ; client dùng CHÍNH NÓ để tự
 * tắt mic tức thì. Một hàm hai người dùng thì không thể lệch nhau.
 *
 * Nó quyết định đúng MỘT grant: `canPublish`. Mọi grant còn lại
 * (`canPublishData`, `canPublishSources`, ...) bị ghim cứng ở tầng adapter và
 * không bao giờ phụ thuộc vào pha - xem `apps/server/src/voice/livekit.ts`.
 *
 * Cố ý KHÔNG gộp vào `resolveChat` (apps/server/src/rooms/snapshot.ts): text
 * trả về kênh cộng danh sách người nhận, voice chỉ trả về một boolean, và voice
 * là tập con hẹp hơn hẳn. Hai bên được giữ khỏi trôi khỏi nhau bằng test bất
 * biến trong `apps/server/tests/voice-permission.test.ts` chứ không bằng cách
 * gộp code. Sửa luật chat thì phải chạy lại test đó.
 */

/** Pha mà người còn sống được nói tự do. */
const OPEN_TO_LIVING: ReadonlySet<Phase> = new Set<Phase>([
  "NIGHT_RESULT",
  "DAY_DISCUSSION",
  "VOTING",
  "FINAL_VOTE",
  "ELIMINATION",
]);

/**
 * Pha mà mọi người đều được nói, kể cả người chết.
 *
 * GAME_OVER nằm đây có chủ ý: lúc lật bài xong là lúc đáng nói nhất cả ván, và
 * không còn bí mật nào để bảo vệ. Đây cũng là lý do room voice KHÔNG bị xoá ở
 * GAME_OVER mà chỉ bị xoá khi phòng quay về lobby.
 */
const OPEN_TO_ALL: ReadonlySet<Phase> = new Set<Phase>(["LOBBY", "GAME_OVER"]);

export interface VoicePermissionInput {
  phase: Phase;
  alive: boolean;
  /** Người đang bị đưa ra biện hộ ở phiên toà. */
  isAccused: boolean;
}

export function voiceCanPublish({ phase, alive, isAccused }: VoicePermissionInput): boolean {
  if (OPEN_TO_ALL.has(phase)) return true;

  // Mọi nhánh còn lại đều yêu cầu còn sống. Đây là bất biến quan trọng nhất của
  // cả tính năng: người chết không bao giờ nói được với người sống.
  if (!alive) return false;

  // Biện hộ là lượt nói độc quyền của bị cáo - người sống khác cũng phải câm.
  if (phase === "DEFENSE") return isAccused;

  return OPEN_TO_LIVING.has(phase);
}

/**
 * Tên room LiveKit của một phòng game.
 *
 * Tiền tố mang tên môi trường để `masoi-dev-ABCDE` và `masoi-prod-ABCDE` không
 * bao giờ đụng nhau, kể cả khi dev và production dùng chung một LiveKit project.
 * Mã phòng vốn chỉ có 5 ký tự nên trùng mã giữa hai môi trường là chuyện thường.
 */
export function voiceRoomName(env: string, code: string): string {
  return `masoi-${env}-${code}`;
}
