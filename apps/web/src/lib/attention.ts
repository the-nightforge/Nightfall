import type { Attention } from "./attention-cues";

/**
 * Gọi người chơi quay lại khi họ đang ở tab khác hoặc đã tắt màn hình.
 *
 * Ba kênh, dùng theo khả năng của máy chứ không theo cài đặt - không có
 * toggle nào cho việc này:
 *
 *   1. Tiêu đề tab. Luôn có, và là kênh duy nhất chắc chắn hoạt động trên
 *      desktop khi người chơi từ chối thông báo hệ thống.
 *   2. Rung. Chỉ điện thoại Android có; iOS lờ đi. Rung cả khi tab đang mở
 *      vì điện thoại nằm trên bàn thì màn hình sáng cũng không ai thấy.
 *   3. Notification hệ thống. Chỉ khi tab ở NỀN và đã được cấp quyền. Không
 *      bao giờ bắn khi tab đang mở - lúc đó nó chỉ che mất chính cái nút
 *      người chơi cần bấm.
 *
 * Cổng bơm vào thay vì đọc `document`/`navigator` thẳng, cùng lý do với mọi
 * module trong `lib/`: bộ test chạy không có DOM.
 */
export interface AttentionPorts {
  isHidden(): boolean;
  getTitle(): string;
  setTitle(title: string): void;
  /** undefined khi máy không rung được. */
  vibrate?: (pattern: number[]) => void;
  /** undefined khi không có Notification API hoặc chưa được cấp quyền. */
  notify?: (title: string, body: string) => void;
  /** Gọi callback mỗi khi tab hiện lại. Trả về hàm gỡ. */
  onVisible(callback: () => void): () => void;
}

/** Hai nhịp ngắn: đủ để nhận ra, không giống chuông báo thức. */
export const VIBRATE_PATTERN = [120, 60, 120];

/** Chấm tròn đứng đầu vì hàng tab hẹp chỉ hiện được vài ký tự đầu. */
export function formatTabTitle(title: string): string {
  return `● ${title} · Ma Sói`;
}

export class AttentionChannel {
  /**
   * Tiêu đề TRƯỚC khi ta sửa, hoặc null khi tiêu đề đang là của trang. Nhớ
   * riêng chứ không đọc lại `getTitle()` lúc trả: lần báo thứ hai khi vẫn ở
   * nền sẽ đọc ra tiêu đề đã sửa của lần thứ nhất và "trả lại" chính nó.
   */
  private original: string | null = null;
  private stopListening: (() => void) | null = null;

  constructor(private readonly ports: AttentionPorts) {}

  show(items: Attention[]): void {
    const first = items[0];
    if (!first) return;

    // Mỗi kênh bọc riêng: `vibrate` ném khi trang chưa có tương tác, còn
    // `new Notification` ném trên Android nếu không đi qua service worker.
    // Một kênh hỏng không được kéo theo tiêu đề tab.
    attempt(() => this.ports.vibrate?.(VIBRATE_PATTERN));

    if (!this.ports.isHidden()) return;

    attempt(() => {
      if (this.original === null) this.original = this.ports.getTitle();
      this.ports.setTitle(formatTabTitle(first.title));
      this.listen();
    });
    attempt(() => this.ports.notify?.(first.title, first.body));
  }

  /** Trả tiêu đề gốc nếu đang giữ. An toàn gọi nhiều lần. */
  clear(): void {
    if (this.original !== null) {
      this.ports.setTitle(this.original);
      this.original = null;
    }
  }

  dispose(): void {
    this.clear();
    this.stopListening?.();
    this.stopListening = null;
  }

  private listen(): void {
    if (this.stopListening) return;
    this.stopListening = this.ports.onVisible(() => {
      this.clear();
      this.stopListening?.();
      this.stopListening = null;
    });
  }
}

function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    // Cố ý nuốt: xem ghi chú ở `show`.
  }
}

/* ------------------------------------------------------------------------ */
/* Nối vào trình duyệt thật                                                  */
/* ------------------------------------------------------------------------ */

/** Thẻ để thông báo sau thay thế thông báo trước thay vì xếp chồng. */
const NOTIFICATION_TAG = "masoi-attention";

/** Dựng cổng từ DOM thật. Chỉ gọi trong effect, không bao giờ lúc render. */
export function browserAttentionPorts(doc: Document = document): AttentionPorts {
  const nav = doc.defaultView?.navigator ?? navigator;
  const canVibrate = typeof nav.vibrate === "function";
  const canNotify =
    typeof Notification !== "undefined" && Notification.permission === "granted";

  return {
    isHidden: () => doc.hidden,
    getTitle: () => doc.title,
    setTitle: (title) => {
      doc.title = title;
    },
    vibrate: canVibrate ? (pattern) => void nav.vibrate(pattern) : undefined,
    notify: canNotify ? (title, body) => void showNotification(nav, title, body) : undefined,
    onVisible: (callback) => {
      const handler = () => {
        if (!doc.hidden) callback();
      };
      doc.addEventListener("visibilitychange", handler);
      return () => doc.removeEventListener("visibilitychange", handler);
    },
  };
}

/**
 * Android bắt Notification đi qua service worker khi trang là PWA đã cài
 * (`new Notification` ném TypeError). Desktop thì cả hai đường đều được, và
 * đường service worker còn cho phép bấm vào thông báo để quay lại tab - xem
 * `notificationclick` trong `public/sw.js`.
 */
async function showNotification(nav: Navigator, title: string, body: string): Promise<void> {
  const options: NotificationOptions = { body, tag: NOTIFICATION_TAG, icon: "/icons/icon-192.png" };
  const registration = nav.serviceWorker?.controller
    ? await nav.serviceWorker.getRegistration()
    : undefined;
  if (registration) {
    await registration.showNotification(title, options);
    return;
  }
  const notice = new Notification(title, options);
  notice.onclick = () => {
    window.focus();
    notice.close();
  };
}

/* ------------------------------------------------------------------------ */
/* Xin quyền                                                                 */
/* ------------------------------------------------------------------------ */

/** Khoá localStorage: đã hỏi quyền Notification trên máy này chưa. */
export const PERMISSION_ASKED_KEY = "masoi.attention-asked";

/**
 * Hỏi đúng một lần. `permission` là `Notification.permission`, null khi
 * trình duyệt không có API. Trạng thái "default" nghĩa là người dùng đã
 * ĐÓNG hộp thoại mà không chọn - Chrome giữ "default" ở đó - nên hỏi lại mỗi
 * lần bấm Sẵn sàng là quấy rầy đúng người vừa từ chối một cách lịch sự.
 */
export function shouldAskNotificationPermission(
  permission: NotificationPermission | null,
  askedBefore: boolean,
): boolean {
  return permission === "default" && !askedBefore;
}

/**
 * Xin quyền Notification. Gọi từ một cử chỉ người dùng - nút "Sẵn sàng" hay
 * "Bắt đầu" - vì Safari từ chối thẳng khi không có cử chỉ. Không chờ kết
 * quả và không báo gì: được thì kênh 3 mở, không thì hai kênh còn lại vẫn
 * chạy.
 */
export function requestAttentionPermission(): void {
  if (typeof Notification === "undefined") return;
  if (!shouldAskNotificationPermission(Notification.permission, readAsked())) return;
  writeAsked();
  try {
    void Notification.requestPermission();
  } catch {
    // Trình duyệt cũ chỉ nhận callback; bỏ qua.
  }
}

function readAsked(): boolean {
  try {
    return localStorage.getItem(PERMISSION_ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAsked(): void {
  try {
    localStorage.setItem(PERMISSION_ASKED_KEY, "1");
  } catch {
    // localStorage bị chặn: hỏi lại lần sau cũng không sao.
  }
}
