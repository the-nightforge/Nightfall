import type { ChatMessage, RoomSnapshot } from "@masoi/shared";
import { moodFor } from "./mood";
import { PHASE_META } from "./phase-meta";

/**
 * Một mốc "từ đây trở đi luật nói đã khác".
 *
 * `at` là giờ SERVER, cùng thang với `ChatMessage.at`, nên vạch ngăn rơi đúng
 * chỗ trong dòng thời gian chứ không phụ thuộc đồng hồ máy người xem.
 */
export interface PhaseMarker {
  id: string;
  label: string;
  at: number;
}

export type ChatTimelineItem =
  | { kind: "message"; key: string; message: ChatMessage }
  | { kind: "divider"; key: string; label: string };

/**
 * Những pha ĐÁNG chèn một vạch ngăn.
 *
 * Không phải mọi lần đổi pha: một vạch cho mỗi pha thì một ngày ba vòng đã có
 * bảy vạch, và một khung chat gãy làm bảy khúc thì bản thân vạch ngăn thành
 * tiếng ồn. Bốn pha dưới đây là bốn chỗ quyền NÓI thật sự đổi chủ - làng câm
 * đi (NIGHT), làng nói lại được (NIGHT_RESULT), sân khấu thuộc về một mình bị
 * cáo (DEFENSE), rồi trả lại cho cả làng (FINAL_VOTE).
 */
const MARKED_PHASES = new Set(["NIGHT", "NIGHT_RESULT", "DEFENSE", "FINAL_VOTE"]);

/**
 * Khoá nhận dạng một LẦN vào pha, không phải một cái tên pha.
 *
 * Kèm cả `phaseEndsAt` vì một ván có thể vào DEFENSE nhiều lần trong cùng một
 * vòng khi phiên toà đầu tha bổng; thiếu nó thì lần xử thứ hai không có vạch.
 */
function markerIdOf(snapshot: RoomSnapshot): string {
  return `${snapshot.phase}:${snapshot.round}:${snapshot.phaseEndsAt ?? "-"}`;
}

function markerLabelOf(snapshot: RoomSnapshot): string {
  if (snapshot.phase === "DEFENSE" && snapshot.trial) {
    return `${snapshot.trial.accusedName} bắt đầu biện hộ`;
  }
  const unit = moodFor(snapshot.phase) === "night" ? "Đêm" : "Ngày";
  const label = PHASE_META[snapshot.phase].label;
  return snapshot.round > 0 ? `${label} · ${unit} thứ ${snapshot.round}` : label;
}

/**
 * Danh sách mốc sau khi nhìn thấy một snapshot mới.
 *
 * Trả về CHÍNH mảng cũ khi không có gì để thêm, để chỗ gọi so sánh tham chiếu
 * được và không phải render lại khung chat sau mỗi snapshot (server đẩy
 * snapshot mỗi lần có người bỏ phiếu, tức là vài lần một giây ở pha cao điểm).
 *
 * `now` là giờ server do chỗ gọi truyền vào - snapshot không nói pha bắt đầu
 * lúc nào, nên mốc là lúc client NHÌN THẤY pha đó. Nối lại giữa pha thì vạch
 * rơi muộn hơn thực tế, và đó là đánh đổi có ý thức: nó chỉ ảnh hưởng tới một
 * đường kẻ, còn giá của lựa chọn kia là thêm một trường vào protocol.
 */
export function nextPhaseMarkers(
  previous: PhaseMarker[],
  snapshot: RoomSnapshot | null,
  now: number,
  limit = 12,
): PhaseMarker[] {
  if (!snapshot || !MARKED_PHASES.has(snapshot.phase)) return previous;
  const id = markerIdOf(snapshot);
  if (previous.some((marker) => marker.id === id)) return previous;
  const next = [...previous, { id, label: markerLabelOf(snapshot), at: now }];
  // Log chat chỉ giữ 100 dòng gần nhất, nên mốc cũ hơn thế không bao giờ được
  // vẽ ra nữa - giữ lại chỉ để mảng phình dần suốt ván.
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Trộn mốc pha vào danh sách tin nhắn.
 *
 * Mốc nào không có tin nhắn nào đứng TRƯỚC thì bị bỏ: một vạch "Hải Yến bắt đầu
 * biện hộ" nằm ngay dòng đầu tiên của khung không ngăn cách được gì, nó chỉ đẩy
 * tin nhắn thật xuống thấp thêm một dòng.
 */
export function buildChatTimeline(
  messages: ChatMessage[],
  markers: PhaseMarker[],
): ChatTimelineItem[] {
  if (markers.length === 0) {
    return messages.map((message) => ({ kind: "message", key: message.id, message }));
  }

  const sorted = [...markers].sort((a, b) => a.at - b.at);
  const items: ChatTimelineItem[] = [];
  let cursor = 0;

  for (const message of messages) {
    while (cursor < sorted.length && sorted[cursor].at <= message.at) {
      const marker = sorted[cursor];
      cursor += 1;
      if (items.length > 0) items.push({ kind: "divider", key: marker.id, label: marker.label });
    }
    items.push({ kind: "message", key: message.id, message });
  }

  return items;
}

export interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * Còn đang dán ở đáy danh sách hay không.
 *
 * 64px chứ không phải 0: người chơi vừa lỡ tay lăn chuột một nấc vẫn đang đọc
 * dòng cuối, và bắt họ cuộn lại chính xác về đáy mới được tự động theo tiếp là
 * một cái bẫy. Ngược lại, ai đã cuộn lên đọc lại đoạn cũ thì mỗi lần khung tự
 * nhảy xuống đáy là mất chỗ đang đọc - đó mới là thứ phải chặn.
 */
export const STICK_THRESHOLD_PX = 64;

export function isNearBottom(box: ScrollBox, threshold = STICK_THRESHOLD_PX): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= threshold;
}
