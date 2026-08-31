import type { MatchHistoryEntry } from "@masoi/shared";
import { getIdentity } from "./identity";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export type HistoryOutcome =
  | { kind: "ok"; matches: MatchHistoryEntry[] }
  | { kind: "anonymous" }
  | { kind: "error" };

/**
 * Lịch sử ván của chính người đang đăng nhập.
 *
 * Trả về kết quả có nhãn thay vì ném: "chưa đăng nhập" và "gọi hỏng" dẫn tới
 * hai giao diện khác hẳn nhau, mà một khối try/catch ở phía gọi thì không phân
 * biệt được hai thứ đó.
 */
export async function fetchMatchHistory(signal?: AbortSignal): Promise<HistoryOutcome> {
  const identity = getIdentity();
  if (!identity) return { kind: "anonymous" };

  try {
    const res = await fetch(`${SERVER_URL}/api/players/me/matches`, {
      headers: { Authorization: `Bearer ${identity.token}` },
      signal,
    });
    // 401 nghĩa là phiên đã hỏng - vẫn là "chưa đăng nhập" dưới mắt người dùng,
    // không phải một lỗi đáng bắt họ thử lại.
    if (res.status === 401) return { kind: "anonymous" };
    if (!res.ok) return { kind: "error" };

    const data = (await res.json()) as { matches?: MatchHistoryEntry[] };
    return { kind: "ok", matches: data.matches ?? [] };
  } catch {
    return { kind: "error" };
  }
}

/** "12 phút 30 giây" đọc nhanh hơn "750s" ở một danh sách nhìn lướt. */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  if (minutes === 0) return `${seconds} giây`;
  if (seconds === 0) return `${minutes} phút`;
  return `${minutes} phút ${seconds} giây`;
}

/**
 * Mốc thời gian tương đối.
 *
 * Ngày giờ tuyệt đối buộc người đọc tự trừ nhẩm để biết "có phải ván lúc nãy
 * không" - câu hỏi duy nhất họ thực sự hỏi ở màn này.
 */
export function formatWhen(endedAt: number, now = Date.now()): string {
  const diffMinutes = Math.floor((now - endedAt) / 60_000);
  if (diffMinutes < 1) return "vừa xong";
  if (diffMinutes < 60) return `${diffMinutes} phút trước`;

  const hours = Math.floor(diffMinutes / 60);
  if (hours < 24) return `${hours} giờ trước`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return new Date(endedAt).toLocaleDateString("vi-VN");
}
