import { isAbortError } from "./entry-attempt";
import { normalizeJoinCode } from "./join-code";

/**
 * Mọi thứ cần để mời một người vào phòng, và KHÔNG gì khác.
 *
 * Bốn trường này là toàn bộ mặt tiếp xúc với thế giới bên ngoài - bảng chia sẻ
 * của hệ điều hành, bộ nhớ tạm, mã QR. Chúng được dựng từ đúng hai tham số
 * `origin` và `code`, nên câu hỏi "có lọt token/playerId ra ngoài không" trả
 * lời được bằng chữ ký hàm chứ không cần đọc hết chỗ gọi.
 */
export interface InvitePayload {
  /** Link mời, dạng `<origin>/?code=ABCDE`. */
  url: string;
  /** Tiêu đề cho bảng chia sẻ. */
  title: string;
  /** Lời mời ngắn. Cố ý KHÔNG chứa link - xem `buildInvitePayload`. */
  text: string;
  /** Mã phòng đã chuẩn hoá, để hiện dưới mã QR và cho nút chép mã. */
  code: string;
}

export type InviteStrategy = "share" | "clipboard" | "manual";

export interface InviteCapabilities {
  canShare: boolean;
  canCopy: boolean;
}

export type InviteOutcome =
  | { kind: "shared" }
  | { kind: "copied-link" }
  | { kind: "copied-code" }
  | { kind: "manual" }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/** Chỉ đúng phần `navigator` mà luồng mời chạm tới, để test tiêm được đồ giả. */
export interface InviteNavigatorLike {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

const INVITE_TITLE = "Ma Sói Online";

/**
 * Dựng link mời từ origin của tab hiện tại và mã phòng.
 *
 * Trả `null` chứ không phải chuỗi rỗng cho mọi đầu vào không dùng được, để chỗ
 * gọi phân biệt "có link" với "không có link" bằng một phép kiểm tra duy nhất
 * và không bao giờ đẩy một chuỗi vô nghĩa vào bộ nhớ tạm hay mã QR.
 *
 * Ba quyết định đáng nói:
 *
 * 1. `pathname` được GIỮ. `window.location.origin` không bao giờ có path, nhưng
 *    nếu một ngày game nằm dưới một thư mục con thì link về gốc tên miền là
 *    link tới hư không. Giữ path lại thì cả hai kiểu deploy đều đúng.
 * 2. `search` bị GHI ĐÈ chứ không thêm vào, và `hash` bị vứt. Origin truyền vào
 *    có thể chính là URL trang hiện tại (`/?code=ZZZZZ` mà người mời vừa dùng
 *    để vào phòng); nối thêm thì link mời mang hai mã phòng khác nhau.
 * 3. Chỉ nhận `http:` và `https:`. `new URL` nhận cả `javascript:` và `file:` -
 *    những thứ đó không ai mở được, mà lại đi thẳng vào QR và bộ nhớ tạm.
 */
export function buildInviteUrl(
  origin: string | null | undefined,
  rawCode: string | null | undefined,
): string | null {
  const code = normalizeJoinCode(rawCode);
  if (!code || !origin) return null;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    // Render phía server truyền vào chuỗi rỗng, và người dùng thì không bao giờ
    // thấy lỗi này - nút mời chỉ đơn giản là chưa dùng được cho tới khi hydrate.
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  url.search = `code=${code}`;
  url.hash = "";
  return url.toString();
}

/**
 * Nội dung chia sẻ hoàn chỉnh, hoặc `null` khi chưa dựng được link.
 *
 * `text` cố ý KHÔNG nhắc lại link: Web Share nhận `text` và `url` như hai phần
 * riêng, và nhiều ứng dụng nhận tin dán chúng liền nhau - người nhận sẽ thấy
 * đúng một đường link hai lần. Nhưng `text` CÓ nhắc mã phòng, vì người được mời
 * hay đọc lời mời trên một máy rồi gõ mã trên máy khác.
 */
export function buildInvitePayload(
  origin: string | null | undefined,
  rawCode: string | null | undefined,
): InvitePayload | null {
  const url = buildInviteUrl(origin, rawCode);
  const code = normalizeJoinCode(rawCode);
  if (!url || !code) return null;

  return {
    url,
    title: INVITE_TITLE,
    text: `Vào làng chơi Ma Sói với mình nhé. Mã phòng: ${code}`,
    code,
  };
}

/**
 * Khả năng chia sẻ thật sự có, đọc từ trình duyệt.
 *
 * Cố ý KHÔNG hỏi `navigator.canShare`. Hồ sơ vụ án phải hỏi vì nó gửi kèm file
 * ảnh, và đó là thứ trình duyệt hay từ chối; ở đây payload chỉ có title/text/url
 * - thứ mà mọi bản Web Share đều nhận - nên thêm một câu hỏi là thêm một nhánh
 * để hỏng, và một số trình duyệt còn ném thay vì trả false.
 */
export function inviteCapabilities(
  navigatorLike: InviteNavigatorLike | undefined,
): InviteCapabilities {
  if (!navigatorLike) return { canShare: false, canCopy: false };
  return {
    canShare: typeof navigatorLike.share === "function",
    // `clipboard` tồn tại nhưng thiếu `writeText` là hình dạng thật của ngữ
    // cảnh không bảo mật, và gọi vào là ném.
    canCopy: typeof navigatorLike.clipboard?.writeText === "function",
  };
}

export function pickInviteStrategy(capabilities: InviteCapabilities): InviteStrategy {
  if (capabilities.canShare) return "share";
  if (capabilities.canCopy) return "clipboard";
  return "manual";
}

/**
 * Người dùng đóng bảng chia sẻ là một lựa chọn CỐ Ý, không phải sự cố.
 *
 * Cùng một luật với luồng chia sẻ hồ sơ vụ án, nhưng dùng chung `isAbortError`
 * thay vì chép lại phép so `error.name`. Câu chữ thì không dùng chung được -
 * ở đây phải chỉ sang nút "Chép link", không phải nút "Sao chép tóm tắt".
 */
export function classifyInviteError(error: unknown): InviteOutcome {
  if (isAbortError(error)) return { kind: "cancelled" };
  return { kind: "error", message: "Không mở được bảng chia sẻ. Hãy dùng nút Chép link." };
}

/** Lời nhắn cho người dùng; `null` nghĩa là im lặng. */
export function describeInviteOutcome(outcome: InviteOutcome): string | null {
  switch (outcome.kind) {
    case "shared":
      return "Đã gửi lời mời đi.";
    case "copied-link":
      return "Đã chép link mời vào bộ nhớ tạm.";
    case "copied-code":
      return "Đã chép mã phòng vào bộ nhớ tạm.";
    case "manual":
      return "Trình duyệt không cho chép tự động. Hãy chọn đoạn dưới rồi chép thủ công.";
    case "cancelled":
      // Dựng một dòng chữ cho hành động huỷ là mắng người dùng vì đã đổi ý.
      return null;
    case "error":
      return outcome.message;
  }
}
