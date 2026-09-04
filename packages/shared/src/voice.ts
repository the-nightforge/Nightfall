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
  // Biện hộ từng là lượt nói độc quyền của bị cáo. Giờ nó mở như ban ngày:
  // cả làng phản ứng được ngay, đổi lại bị cáo không còn được nói mà không bị
  // cắt ngang - đó là đánh đổi có chủ ý, không phải sót.
  "DEFENSE",
  "FINAL_VOTE",
  "ELIMINATION",
]);

/**
 * Pha mà mọi người đều được nói, kể cả người chết.
 *
 * GAME_OVER nằm đây có chủ ý: lúc lật bài xong là lúc đáng nói nhất cả ván, và
 * không còn bí mật nào để bảo vệ.
 *
 * LOBBY mở cho tất cả cũng là lý do reset về phòng chờ KHÔNG cần xoá room voice:
 * quyền của pha mới đã rộng hơn quyền của mọi pha trong ván. Xem mục 8.6 của
 * `docs/superpowers/specs/2026-08-30-voice-chat-design.md`.
 */
const OPEN_TO_ALL: ReadonlySet<Phase> = new Set<Phase>(["LOBBY", "GAME_OVER"]);

export interface VoicePermissionInput {
  phase: Phase;
  alive: boolean;
}

export function voiceCanPublish({ phase, alive }: VoicePermissionInput): boolean {
  if (OPEN_TO_ALL.has(phase)) return true;

  // Mọi nhánh còn lại đều yêu cầu còn sống. Đây là bất biến quan trọng nhất của
  // cả tính năng: người chết không bao giờ nói được với người sống.
  if (!alive) return false;

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
