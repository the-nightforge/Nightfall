"use client";

import { useEffect, type RefObject } from "react";

/**
 * Đo chiều cao THẬT của một tấm `fixed` và công bố nó cho cả trang.
 *
 * Dùng cho thanh "Bắt đầu trò chơi" của phòng chờ trên điện thoại. Tấm đó nổi
 * lên trên trang, nên trang phải tự chừa lại đúng bấy nhiêu chỗ ở đáy - và
 * "đúng bấy nhiêu" là một con số THAY ĐỔI: có lý do chặn thì thêm một dòng chữ,
 * lý do dài thì hai dòng, khách chỉ có nút Sẵn sàng thì không dòng nào. Bản cũ
 * đoán bằng một hằng số `11rem` trong CSS, và ở iPad 768x1024 - nơi câu "Bộ bài
 * cần 8 người, phòng đang có 10" xuống dòng - tấm cao hơn số đoán, nên nó phủ
 * mất nút "Luật và vai trò" ở cuối trang.
 *
 * Ghi lên `documentElement` chứ không lên một node cha, vì thứ cần đọc con số
 * này nằm ở ba chỗ khác nhau của cây DOM: `<main>` (chừa đệm đáy), nút chat nổi
 * và dock voice (nhấc mình lên khỏi thanh) - hai cái sau là anh em của `<main>`
 * chứ không nằm trong nó.
 *
 * `data-lobby-dock` là công tắc: nó chỉ có mặt khi thanh đang thực sự được dựng
 * (tức đang ở phòng chờ), nên CSS của các pha khác không phải biết gì về nó.
 */
export function useDockHeight(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = ref.current;
    const root = document.documentElement;
    if (!node) return;

    root.dataset.lobbyDock = "1";
    const publish = () => {
      root.style.setProperty("--lobby-dock-h", `${Math.round(node.offsetHeight)}px`);
    };
    publish();

    /*
     * ResizeObserver chứ không phải đo một lần lúc mount: chiều cao đổi khi câu
     * chặn đổi (người thứ tám vào phòng, host gạt sang Chaos), và những lần đó
     * không đi kèm một lần mount nào.
     */
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      delete root.dataset.lobbyDock;
      root.style.removeProperty("--lobby-dock-h");
    };
  }, [ref]);
}
