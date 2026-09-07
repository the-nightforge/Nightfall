"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PROMPT_READY_EVENT,
  clearBufferedPrompt,
  detectIOS,
  detectStandalone,
  inviteMode,
  loadDismissed,
  markSessionDismissed,
  readBufferedPrompt,
  readSessionDismissed,
  saveDismissed,
  type BeforeInstallPromptEvent,
  type InviteMode,
} from "@/lib/pwa-install";
import { WolfMark } from "./WolfMark";

/**
 * Lời mời cài ứng dụng lên màn hình chính.
 *
 * Một thẻ nằm TRONG luồng bố cục, không phải banner nổi. Trên điện thoại, một
 * dải cố định ở đáy màn hình đúng chỗ ngón cái với để bấm - tức là đúng chỗ
 * các nút của game - và cái giá của việc mời sai chỗ cao hơn nhiều so với việc
 * một số người không nhìn thấy lời mời.
 *
 * Toàn bộ luật "có mời không, mời kiểu gì" nằm ở `lib/pwa-install.ts`; ở đây
 * chỉ còn phần nối dây với trình duyệt và phần vẽ.
 */
export function InstallPrompt({ className }: { className?: string }) {
  /*
   * Khởi tạo "hidden" đúng bằng thứ server dựng ra.
   *
   * Mọi đầu vào của quyết định này (`matchMedia`, `navigator`, localStorage,
   * một sự kiện chưa xảy ra) đều không tồn tại lúc render trên server. Đọc
   * chúng trong lúc render là hydrate lệch; effect bên dưới mới bật lên sau.
   */
  const [mode, setMode] = useState<InviteMode>("hidden");
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const standalone = detectStandalone(window);
    const ios = detectIOS(navigator);
    /*
     * Hai nguồn "đã đóng", hỏi cả hai.
     *
     * localStorage là ký ức giữa các phiên; cờ trên `window` là ký ức của
     * riêng document này, cho trường hợp localStorage bị chặn và
     * `saveDismissed` không ghi được gì. Thiếu vế sau thì đi vào phòng rồi
     * quay ra là thẻ mời mọc lại, vì kho sự kiện vẫn còn nguyên.
     */
    const dismissed = loadDismissed() || readSessionDismissed(window);

    // Lượt đánh giá đầu: chưa có sự kiện cài nào, nên đây là lúc nhánh iOS lên.
    setMode(inviteMode({ standalone, ios, hasPrompt: false, dismissed }));
    if (standalone || dismissed) return;

    /*
     * Đọc KHO, không nghe thẳng `beforeinstallprompt`.
     *
     * Sự kiện đó thường đã bắn xong từ trước khi React kịp hydrate; thứ bắt
     * được nó là đoạn script trần trong `layout.tsx`. Xem
     * `INSTALL_CAPTURE_SCRIPT` trong `lib/pwa-install.ts`.
     *
     * Hỏi lại cờ phiên ở MỖI lần có sự kiện chứ không chỉ lúc gắn: người dùng
     * có thể bấm đóng sau khi hai listener dưới đã đăng ký, và Chromium vẫn
     * có thể bắn một `beforeinstallprompt` mới trong cùng document đó.
     */
    const syncFromBuffer = () => {
      if (readSessionDismissed(window)) return;
      const buffered = readBufferedPrompt(window);
      if (!buffered) return;
      setPrompt(buffered);
      setMode(inviteMode({ standalone, ios, hasPrompt: true, dismissed: false }));
    };

    // Kho có thể đã đầy từ trước lần render này - đọc ngay, đừng chỉ ngồi đợi.
    syncFromBuffer();

    /*
     * Đường dự phòng: nghe thẳng sự kiện.
     *
     * `INSTALL_CAPTURE_SCRIPT` đi qua hàng đợi script của Next, nên nó được
     * chạy sớm nhưng không sớm một cách CHẮC CHẮN - đo được là ~56ms, còn sự
     * kiện thì tới quanh đó. Nếu lần nào hàng đợi chậm hơn sự kiện thì listener
     * này là thứ đỡ lấy nó. Hai đường cùng bắt được một sự kiện là vô hại: cả
     * hai đều dẫn về đúng một `BeforeInstallPromptEvent`.
     */
    const onBeforeInstall = (event: Event) => {
      // Bắt buộc, nếu không thì `prompt()` sau này ném. Gọi hai lần vẫn không sao.
      event.preventDefault();
      if (readSessionDismissed(window)) return;
      setPrompt(event as BeforeInstallPromptEvent);
      setMode(inviteMode({ standalone, ios, hasPrompt: true, dismissed: false }));
    };

    /*
     * Cài xong thì lời mời biến mất NGAY, không đợi mở lại app.
     *
     * Trên desktop, cài xong là mở ra một cửa sổ ứng dụng riêng còn tab cũ vẫn
     * nằm đó - và tab đó sẽ ngồi mời người ta cài lại thứ vừa cài.
     */
    const onInstalled = () => {
      clearBufferedPrompt(window);
      setPrompt(null);
      setMode("hidden");
    };

    window.addEventListener(PROMPT_READY_EVENT, syncFromBuffer);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener(PROMPT_READY_EVENT, syncFromBuffer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!prompt || busy) return;
    setBusy(true);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      /*
       * Dùng xong là hết: một `BeforeInstallPromptEvent` chỉ gọi `prompt()`
       * được một lần. Dọn cả kho lẫn state, kể cả khi người dùng từ chối -
       * Chromium sẽ tự bắn sự kiện mới ở lần sau nếu còn muốn mời.
       */
      clearBufferedPrompt(window);
      setPrompt(null);
      setMode("hidden");
      /*
       * Từ chối trong hộp thoại của hệ thống KHÔNG được ghi vào localStorage.
       *
       * Đó là một câu trả lời cho lần này. Chỉ khi người ta chủ động bấm nút
       * đóng trên thẻ của ta thì mới là "đừng hỏi nữa".
       */
      if (outcome === "accepted") {
        markSessionDismissed(window);
        saveDismissed();
      }
    } catch {
      // Hộp thoại không mở được (sự kiện đã cũ, tab mất focus): thu lời mời lại
      // thay vì để một cái nút bấm mãi không ra gì.
      clearBufferedPrompt(window);
      setPrompt(null);
      setMode("hidden");
    } finally {
      setBusy(false);
    }
  }, [prompt, busy]);

  const dismiss = useCallback(() => {
    /*
     * Ghi vào CẢ HAI ký ức, và bỏ luôn sự kiện đang giữ.
     *
     * Bản đầu chỉ `saveDismissed()` rồi ẩn: đủ khi localStorage hoạt động,
     * nhưng khi nó bị chặn thì không còn ai nhớ lần đóng này - kho trên
     * `window` vẫn giữ sự kiện, và lần mount sau (đi vào phòng rồi quay ra)
     * đọc kho rồi mời lại đúng thứ vừa bị đóng. Cờ phiên chặn ca đó; dọn kho
     * và state để sự kiện cũ không còn chỗ nào để mọc lại từ.
     */
    markSessionDismissed(window);
    saveDismissed();
    clearBufferedPrompt(window);
    setPrompt(null);
    setMode("hidden");
  }, []);

  if (mode === "hidden") return null;

  return (
    <section
      aria-labelledby="pwa-install-title"
      className={`card flex items-start gap-3.5 ${className ?? ""}`}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[28%] border border-blood-500/30 bg-gradient-to-br from-blood-600/25 via-night-800 to-night-900"
      >
        <WolfMark className="h-3/5 w-3/5 fill-blood-400" />
      </span>

      <div className="min-w-0 flex-1">
        <h2 id="pwa-install-title" className="text-sm font-semibold text-mist-bright">
          Cài Ma Sói lên màn hình chính
        </h2>

        {mode === "prompt" ? (
          <>
            <p className="mt-1 text-[13px] leading-relaxed text-mist">
              Mở thẳng vào game, toàn màn hình, không thanh địa chỉ.
            </p>
            <button
              type="button"
              onClick={install}
              disabled={busy}
              /*
               * Nút viền, không phải nút đặc.
               *
               * CTA chính của trang chủ - "Tạo phòng mới" - là một khối xanh
               * trầm. Một nút đỏ đặc ở đây sẽ nổi hơn chính cái nút mà cả trang
               * này tồn tại để người ta bấm, và lời mời cài đặt thì không đáng
               * đứng trên đầu việc vào chơi.
               */
              className="mt-3 rounded-lg border border-blood-500/40 bg-blood-600/15 px-3.5 py-2 text-[13px] font-semibold text-mist-bright transition hover:border-blood-500/70 hover:bg-blood-600/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mist-bright disabled:opacity-60"
            >
              {busy ? "Đang mở..." : "Cài ứng dụng"}
            </button>
          </>
        ) : (
          /*
           * iOS: chữ, không nút.
           *
           * Không trình duyệt nào trên iOS cho website tự mở hộp thoại "Thêm
           * vào Màn hình chính". Một cái nút ở đây sẽ là một lời hứa suông, nên
           * chỗ này chỉ chỉ đường tới đúng nút Chia sẻ của hệ thống.
           *
           * Và chỉ tới CÁI NÚT, không tới CHỖ ĐỨNG của nó. `detectIOS` nhận cả
           * Chrome lẫn Firefox trên iOS, nơi Chia sẻ nằm trong menu ba chấm chứ
           * không nằm trên thanh công cụ; còn trên iPad thì thanh công cụ ở
           * TRÊN. Bản đầu viết "ở thanh dưới Safari" - đúng với đúng một cấu
           * hình, và một chỉ dẫn sai chỗ còn tệ hơn không có chỉ dẫn nào.
           */
          <p className="mt-1 text-[13px] leading-relaxed text-mist">
            Mở menu{" "}
            <span className="whitespace-nowrap font-semibold text-mist-strong">
              Chia sẻ{" "}
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="inline-block h-3.5 w-3.5 -translate-y-px fill-none stroke-current stroke-[1.8]"
              >
                <path d="M12 3v12M12 3l-3.4 3.4M12 3l3.4 3.4" strokeLinecap="round" />
                <path d="M5 12v7.5h14V12" strokeLinecap="round" />
              </svg>
            </span>{" "}
            của trình duyệt, sau đó chọn{" "}
            <span className="font-semibold text-mist-strong">Thêm vào Màn hình chính</span>.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Đóng lời mời cài ứng dụng"
        className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-mist/85 transition hover:bg-white/5 hover:text-mist-bright focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mist-bright"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className="h-4 w-4 fill-none stroke-current stroke-2"
        >
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </section>
  );
}
