import { isPersonalWinCondition } from "@masoi/shared";
import type { CaseFile, MatchHistoryEntry } from "@masoi/shared";
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
    return { kind: "ok", matches: (data.matches ?? []).map(normalizeEntry) };
  } catch {
    return { kind: "error" };
  }
}

/**
 * Chuẩn hoá MỘT ván đọc từ dây về đúng hình dạng mà giao diện được phép tin.
 *
 * Đây là biên duy nhất mà dữ liệu của server đi vào web, nên nó cũng là chỗ
 * duy nhất được phép quyết định "thiếu trường nghĩa là gì". Hai thứ khác nhau
 * cùng phải quy về `null`:
 *
 *  - Server CŨ không gửi `myPersonalWin` (`undefined`). Web và server deploy
 *    rời nhau, nên đây là trạng thái bình thường trong vài phút mỗi lần phát
 *    hành, không phải một lỗi.
 *  - Server gửi một điều kiện mà bản build này không hiểu. Cùng lý do với
 *    `isRole` ở `toHistoryEntry` phía server: cột Json giữ nguyên hình dạng của
 *    bản đã ghi nó, và tra một chuỗi lạ vào `PERSONAL_WIN_LABELS` ra
 *    `undefined` ngay giữa lúc render TRANG CHỦ.
 *
 * Gộp cả hai về `null` ở đây nghĩa là mọi component phía sau chỉ phải hiểu MỘT
 * trạng thái "không có thành tích", thay vì ba.
 */
function normalizeEntry(entry: MatchHistoryEntry): MatchHistoryEntry {
  const win = entry.myPersonalWin;
  const valid =
    win != null && isPersonalWinCondition(win.condition) && typeof win.round === "number";
  return { ...entry, myPersonalWin: valid ? win : null };
}

/**
 * Đọc hồ sơ vụ án lấy từ lịch sử.
 *
 * Giá trị này là JSON nằm trong DB, do một phiên bản server nào đó ghi ra, nên
 * tin nó khớp kiểu hiện tại là tự chuốc lấy lỗi lúc chạy. `CaseFile.version` có
 * sẵn đúng cho việc này: schema đổi thì hồ sơ cũ bị bỏ qua chứ không làm vỡ cả
 * trang lịch sử.
 *
 * Trả `null` cũng là trạng thái BÌNH THƯỜNG, không phải lỗi: ván ghi trước khi
 * có cột này đơn giản là không có hồ sơ.
 */
export function readStoredCaseFile(value: unknown): CaseFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const file = value as Partial<CaseFile>;
  if (file.version !== 1) return null;
  if (!Array.isArray(file.highlights) || file.highlights.length === 0) return null;
  return file as CaseFile;
}

/**
 * Thời lượng ván dạng đồng hồ: "12:22", hoặc "1:05:00" khi vượt một giờ.
 *
 * Dòng meta của một hàng lịch sử phải quét được trong một nhịp mắt, mà
 * "12 phút 30 giây" chiếm gần gấp ba bề ngang của cùng thông tin ở dạng đồng
 * hồ - đủ để đẩy mốc "4 giờ trước", thứ người ta thực sự tìm, xuống dòng thứ
 * ba trên khung điện thoại. Phần giờ chỉ hiện khi thực sự có: "65:00" đọc ra
 * như một con số lỗi.
 */
export function formatDurationClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
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
