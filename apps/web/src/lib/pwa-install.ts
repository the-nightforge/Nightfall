/**
 * Luật của lời mời cài ứng dụng.
 *
 * Tách hẳn khỏi component vì mọi quyết định ở đây đều phụ thuộc vào những thứ
 * chỉ có trên thiết bị thật: user agent của iPad, `display-mode` của một cửa sổ
 * đã cài, `navigator.standalone` mà chỉ Safari có. Nhốt chúng sau vài hàm thuần
 * nhận tham số thì test chạy được cả bốn tổ hợp mà không cần một chiếc iPhone.
 *
 * Không có "use client" ở đầu file: đây là hàm thuần và test chạy chúng bằng
 * node trần, không qua bundler.
 */

/**
 * `beforeinstallprompt` - sự kiện riêng của Chromium, không có trong lib.dom.
 *
 * Khai báo tại đây thay vì `any` ở chỗ dùng: `prompt()` và `userChoice` là
 * toàn bộ giao diện mà ta cần, và đánh máy sai một trong hai thì phải gãy lúc
 * biên dịch chứ không phải lúc người dùng bấm nút.
 */
export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

declare global {
  interface Navigator {
    /**
     * Safari iOS: `true` khi trang được mở từ biểu tượng trên màn hình chính.
     *
     * Không nằm trong chuẩn nào và không trình duyệt nào khác có, nên lib.dom
     * không khai. Khai ở đây thay vì ép kiểu tại chỗ dùng: `navigator` thật
     * mới là thứ được truyền vào `detectStandalone`, và nếu kiểu Navigator
     * không hề biết tới thuộc tính này thì mọi lần gọi đều phải đi vòng.
     */
    readonly standalone?: boolean;
  }
}

/** Khoá localStorage ghi nhớ việc người dùng đã đóng lời mời. */
export const DISMISS_KEY = "masoi.pwa-install-dismissed";

/** Chỗ script bắt sớm cất `BeforeInstallPromptEvent` lại trên `window`. */
export const PROMPT_BUFFER_KEY = "__masoiInstallPrompt";

/** Sự kiện nội bộ báo cho React biết là đã có thứ trong kho. */
export const PROMPT_READY_EVENT = "masoi:installprompt";

/**
 * Script bắt `beforeinstallprompt`, chạy TRƯỚC khi React hydrate.
 *
 * Đây không phải tối ưu, mà là điều kiện để tính năng chạy được. Đo trên chính
 * trang này: Chrome bắn `beforeinstallprompt` ở mốc ~35ms sau khi điều hướng,
 * lúc `document.readyState` đã là "complete" nhưng React thì còn chưa gắn
 * listener nào. Sự kiện đó không bắn lại: một `useEffect` đăng ký muộn hơn sẽ
 * không bao giờ thấy nó, và nút "Cài ứng dụng" sẽ không bao giờ hiện.
 *
 * Vì vậy phần bắt sự kiện phải là JavaScript trần nằm trong HTML đầu tiên. Nó
 * `preventDefault()` để giữ quyền gọi `prompt()` sau này, cất sự kiện lên
 * `window` rồi báo cho React bằng một sự kiện riêng.
 *
 * Giữ ở đây dưới dạng chuỗi để `layout.tsx` nhúng và test chạy được đúng đoạn
 * mã đang thực sự lên production, thay vì một bản chép tay hao hao.
 */
export const INSTALL_CAPTURE_SCRIPT = `(function(){
  var w = window;
  w.${PROMPT_BUFFER_KEY} = null;
  w.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    w.${PROMPT_BUFFER_KEY} = e;
    w.dispatchEvent(new Event(${JSON.stringify(PROMPT_READY_EVENT)}));
  });
  w.addEventListener("appinstalled", function () {
    w.${PROMPT_BUFFER_KEY} = null;
  });
})();`;

declare global {
  interface Window {
    /**
     * Kho chứa `BeforeInstallPromptEvent` do `INSTALL_CAPTURE_SCRIPT` đặt vào.
     *
     * Khai trên chính `Window` chứ không chỉ trên một kiểu phụ: `window` thật
     * mới là thứ được truyền vào hai hàm dưới, và một thuộc tính mà kiểu
     * `Window` không hề biết tới sẽ bắt mọi chỗ dùng phải ép kiểu.
     */
    __masoiInstallPrompt?: BeforeInstallPromptEvent | null;
  }
}

/** Cửa sổ có kho chứa sự kiện cài - phần mà React đọc lại. */
export interface PromptBuffer {
  [PROMPT_BUFFER_KEY]?: BeforeInstallPromptEvent | null;
}

/**
 * Xem trong kho có sự kiện cài không. KHÔNG lấy ra.
 *
 * Không lấy ra vì component này gắn/gỡ theo từng lần vào trang chủ, còn sự
 * kiện thì chỉ tới một lần cho cả phiên: đi vào phòng rồi quay ra mà kho đã bị
 * dọn thì lời mời biến mất không lý do. Kho chỉ được dọn khi sự kiện đã dùng
 * xong hoặc khi app đã được cài.
 */
export function readBufferedPrompt(win: PromptBuffer): BeforeInstallPromptEvent | null {
  return win[PROMPT_BUFFER_KEY] ?? null;
}

/** Dọn kho: sự kiện đã dùng xong, hoặc app đã cài. */
export function clearBufferedPrompt(win: PromptBuffer): void {
  win[PROMPT_BUFFER_KEY] = null;
}

/** Cờ trên `window`: đã đóng lời mời trong CHÍNH document này. */
export const SESSION_DISMISS_KEY = "__masoiInstallDismissed";

declare global {
  interface Window {
    /**
     * Đường lùi của `saveDismissed` khi localStorage bị chặn.
     *
     * Sống đúng bằng document: mất khi tải lại trang, nhưng còn nguyên khi đi
     * vào phòng rồi quay ra - và đó là ca cần chống. Component gắn/gỡ theo từng
     * lần vào trang chủ, còn kho `__masoiInstallPrompt` thì giữ sự kiện cho cả
     * phiên; không có cờ này thì mỗi lần mount lại là thẻ mời mọc lại đúng thứ
     * người ta vừa đóng.
     *
     * Đặt trên `window` chứ không phải biến module: cùng vòng đời với kho sự
     * kiện, và test dọn được giữa các ca mà không cần nạp lại module.
     */
    __masoiInstallDismissed?: boolean;
  }
}

/** Cửa sổ có cờ đóng trong phiên - phần mà `InstallPrompt` đọc và ghi. */
export interface DismissMemory {
  [SESSION_DISMISS_KEY]?: boolean;
}

/**
 * Đã đóng lời mời trong document này chưa.
 *
 * So sánh `=== true` chứ không ép kiểu: đây là một thuộc tính trần trên
 * `window`, và bất kỳ script nào cũng ghi được vào đó.
 */
export function readSessionDismissed(win: DismissMemory): boolean {
  return win[SESSION_DISMISS_KEY] === true;
}

/**
 * Nhớ lần đóng trong bộ nhớ của document này.
 *
 * Luôn gọi CÙNG `saveDismissed`, không thay thế nó: localStorage là đường
 * chính cho các phiên sau, cờ này chỉ là đường lùi để lần đóng không bị quên
 * ngay trong phiên đang mở khi storage bị chặn. Không bao giờ ném.
 */
export function markSessionDismissed(win: DismissMemory): void {
  win[SESSION_DISMISS_KEY] = true;
}

/** Phần `window` mà `detectStandalone` cần - đủ để test dựng bằng object literal. */
export interface StandaloneProbe {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { standalone?: boolean };
}

/**
 * Ứng dụng có đang chạy ở chế độ đã cài không.
 *
 * Hai đường vì hai họ trình duyệt trả lời hai kiểu: Chromium/Firefox dựng
 * `display-mode: standalone` thành một media query, còn Safari iOS đến giờ vẫn
 * chỉ có `navigator.standalone` - một thuộc tính không chuẩn và không tồn tại ở
 * bất kỳ nơi nào khác.
 *
 * `minimal-ui` và `fullscreen` cũng tính là đã cài: cả hai đều là cửa sổ ứng
 * dụng, và mời một người đã cài đi cài lại là lỗi khó chịu nhất ở đây.
 */
export function detectStandalone(win: StandaloneProbe): boolean {
  if (win.navigator?.standalone === true) return true;
  const mq = win.matchMedia;
  if (typeof mq !== "function") return false;
  for (const mode of ["standalone", "minimal-ui", "fullscreen"]) {
    try {
      if (mq(`(display-mode: ${mode})`).matches) return true;
    } catch {
      // Trình duyệt cũ ném khi gặp media query lạ; coi như không khớp.
      return false;
    }
  }
  return false;
}

/** Phần `navigator` mà `detectIOS` cần. */
export interface IOSProbe {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}

/**
 * Thiết bị này có phải iOS/iPadOS không.
 *
 * Chuỗi "iPad" không còn đủ: từ iPadOS 13 Safari trên iPad khai mình là
 * "Macintosh; Intel Mac OS X" để website desktop không đối xử với nó như điện
 * thoại. Cách phân biệt còn lại là số điểm chạm - một chiếc Mac thật báo 0.
 */
export function detectIOS(nav: IOSProbe): boolean {
  const ua = nav.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  const isMacLike = nav.platform === "MacIntel" || /Macintosh/.test(ua);
  return isMacLike && (nav.maxTouchPoints ?? 0) > 1;
}

export interface InviteInputs {
  /** Đang chạy trong cửa sổ ứng dụng đã cài. */
  standalone: boolean;
  /** iOS/iPadOS - nơi không có API nào mở được hộp thoại cài. */
  ios: boolean;
  /** Đã bắt được `beforeinstallprompt` và còn giữ được sự kiện đó. */
  hasPrompt: boolean;
  /**
   * Người dùng đã bấm đóng lời mời: ở một phiên trước (localStorage) hoặc
   * ngay trong document này (`readSessionDismissed`).
   */
  dismissed: boolean;
}

/**
 * - `hidden`    - không hiện gì cả.
 * - `prompt`    - hiện nút "Cài ứng dụng", bấm là mở hộp thoại thật.
 * - `ios-guide` - hiện hướng dẫn Chia sẻ -> Thêm vào Màn hình chính.
 */
export type InviteMode = "hidden" | "prompt" | "ios-guide";

/**
 * Có mời cài không, và mời kiểu gì.
 *
 * Thứ tự các nhánh dưới đây là thứ tự ưu tiên, không đổi chỗ được:
 *
 * 1. Đã cài rồi thì im lặng, kể cả khi trình duyệt vẫn bắn
 *    `beforeinstallprompt` - Chromium có bắn lại trong cửa sổ ứng dụng.
 * 2. Đã đóng thì im lặng.
 * 3. Có sự kiện thật thì mới hiện nút bấm được. Không bao giờ hiện một nút
 *    "Cài ứng dụng" mà bấm vào không có gì xảy ra.
 * 4. Còn lại, trên iOS thì hướng dẫn bằng tay.
 *
 * Chú ý nhánh 3 đứng TRƯỚC nhánh 4, dù hôm nay hai nhánh không gặp nhau: mọi
 * trình duyệt trên iOS đều chạy trên WebKit, và WebKit chưa bắn
 * `beforeinstallprompt` - kể cả Chrome hay Edge iOS. Thứ tự này là để ngày
 * nào đó một trình duyệt iOS bắn được sự kiện thật thì nút thật tự thắng
 * hướng dẫn tay, không phải vì đã có trình duyệt nào làm được vậy.
 */
export function inviteMode(inputs: InviteInputs): InviteMode {
  if (inputs.standalone) return "hidden";
  if (inputs.dismissed) return "hidden";
  if (inputs.hasPrompt) return "prompt";
  if (inputs.ios) return "ios-guide";
  return "hidden";
}

/**
 * Đã đóng lời mời chưa.
 *
 * `try` bắt đầu TRƯỚC cả việc đọc `globalThis.localStorage`, không phải chỉ
 * quanh `getItem`. Chính thuộc tính đó cũng ném được: Chrome khi người dùng
 * chặn cookie của bên thứ nhất, Safari ở một số cấu hình riêng tư, và WebView
 * doanh nghiệp bị khoá storage đều ném `SecurityError` ngay lúc ĐỌC
 * `localStorage`, trước khi có cơ hội gọi một phương thức nào. Bản đầu đặt
 * dòng đó ngoài `try` nên chỉ chống được nửa số trường hợp.
 *
 * Quên mất một lần đóng còn hơn là một trang chủ trắng.
 */
export function loadDismissed(storage?: Pick<Storage, "getItem">): boolean {
  try {
    const store = storage ?? globalThis.localStorage;
    return store?.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Nhớ rằng người dùng đã đóng lời mời.
 *
 * Nhớ VĨNH VIỄN chứ không hẹn ngày hiện lại. Ai muốn cài mà lỡ bấm đóng thì
 * vẫn còn menu của chính trình duyệt - còn một cái banner tự mọc lại sau bảy
 * ngày thì không có cách nào để nói "không" cho dứt điểm.
 */
export function saveDismissed(storage?: Pick<Storage, "setItem">): void {
  try {
    // Đọc `localStorage` nằm TRONG try - xem ghi chú ở `loadDismissed`.
    const store = storage ?? globalThis.localStorage;
    store?.setItem(DISMISS_KEY, "1");
  } catch {
    /*
     * Không lưu được thì thôi. Hàm này KHÔNG được ném: nó chạy ngay trên
     * đường bấm nút đóng, và một lỗi ở đây sẽ giết luôn phần ẩn thẻ mời đứng
     * sau nó - người dùng bấm đóng mà thẻ vẫn nằm nguyên đó.
     */
  }
}
