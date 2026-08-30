"use client";

import { useEffect, useRef, type RefObject } from "react";
import { focusableWithin, inertOutside, trapIndex } from "./focus-trap";

interface Options {
  /** Bẫy chỉ sống khi lớp phủ đang hiện. */
  active: boolean;
  /**
   * Vùng giữ focus. Phần tử ĐẦU cũng là vùng Tab quay vòng; những phần tử sau
   * chỉ được miễn `inert` (tấm nền mờ bấm-để-đóng của tấm trượt chat).
   */
  roots: Array<RefObject<HTMLElement | null>>;
  /** Nơi focus rơi vào lúc mở. Thiếu thì lấy phần tử focus được đầu tiên. */
  initialFocus?: RefObject<HTMLElement | null>;
  /**
   * Nơi focus quay về lúc đóng, nếu khác chỗ cũ.
   *
   * Nút mở chat bị GỠ trong lúc tấm trượt mở, nên phần tử được nhớ lúc mở đã
   * không còn trong tài liệu lúc đóng - trả focus về nó là trả về hư không, và
   * trình duyệt đẩy focus về `body`. Ref này trỏ tới nút vừa được dựng lại.
   */
  restoreTo?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
}

/**
 * Biến một lớp phủ thành modal thật.
 *
 * `aria-modal="true"` chỉ là một lời khai với trình đọc màn hình; nó không giữ
 * Tab lại, không chặn chuột, và không ngăn Enter rơi xuống nút "Bỏ phiếu" nằm
 * dưới. Hook này mới là phần thi hành: Tab quay vòng, phần còn lại của trang
 * thành `inert`, Escape đóng, và focus trả về chỗ cũ.
 */
export function useModalFocus({ active, roots, initialFocus, restoreTo, onEscape }: Options): void {
  // Giữ trong ref để effect chỉ chạy lại theo `active`: mảng `roots` là literal
  // mới ở mỗi lần render, cho vào deps thì bẫy tháo ra dựng lại mỗi khung hình
  // và focus bị giật về đầu liên tục.
  const latest = useRef({ roots, initialFocus, restoreTo, onEscape });
  latest.current = { roots, initialFocus, restoreTo, onEscape };

  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const scope = latest.current.roots[0]?.current;
    if (!scope) return;

    // Nhớ TRƯỚC khi đụng vào inert: đặt inert lên tổ tiên của phần tử đang
    // focus sẽ làm trình duyệt bỏ focus khỏi nó ngay lập tức.
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const live = latest.current.roots
      .map((ref) => ref.current)
      .filter((el): el is HTMLElement => el !== null);
    const releaseInert = inertOutside(live);

    const target = latest.current.initialFocus?.current ?? focusableWithin(scope)[0] ?? scope;
    // preventScroll: lớp phủ đã che kín màn hình, một cú cuộn ngầm ở lớp dưới
    // chỉ để lộ ra khi cảnh tan đi là trang đã nhảy chỗ.
    target.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        latest.current.onEscape?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusableWithin(scope);
      if (items.length === 0) {
        // Không có gì để Tab tới thì cũng không được cho Tab đi ra ngoài.
        event.preventDefault();
        return;
      }
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = trapIndex(items.length, current, event.shiftKey);
      if (next < 0) return;
      event.preventDefault();
      items[next]?.focus();
    };

    // capture: bắt trước mọi handler của trang bên dưới, kể cả khi phần tử đang
    // focus nằm ngoài lớp phủ vì một lý do nào đó.
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Gỡ inert TRƯỚC khi trả focus: một phần tử còn inert thì focus() vào nó
      // không có tác dụng gì cả.
      releaseInert();
      // rAF để React kịp dựng lại nút đã bị gỡ trong lúc lớp phủ mở.
      requestAnimationFrame(() => {
        const back = latest.current.restoreTo?.current ?? previous;
        if (back && document.contains(back)) back.focus({ preventScroll: true });
      });
    };
  }, [active]);
}
