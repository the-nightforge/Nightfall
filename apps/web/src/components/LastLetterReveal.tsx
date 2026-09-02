"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import type { RoomSnapshot } from "@masoi/shared";
import {
  EMPTY_REVEAL_STATE,
  dismissReveal,
  nextReveal,
  observeSnapshot,
  pendingRevealCount,
  revealCard,
  revealMotion,
} from "@/lib/last-letter";

/**
 * Thẻ mở Phong thư sau cùng.
 *
 * KHÔNG phải modal, và đó là quyết định chính của component này. Một tấm phủ
 * toàn màn hình ở đây sẽ đè lên đúng thứ vừa xảy ra - "3 người không qua khỏi
 * đêm nay" và tên họ - trong khi lá thư chỉ có nghĩa KHI người đọc đã biết ai
 * vừa chết. Nó là một thẻ nằm DƯỚI nội dung pha, xuất hiện sau khi chuyển cảnh
 * đã chạy xong vì lớp phủ chuyển cảnh nằm trên cùng cây và tự tháo khi hết.
 *
 * MỘT thẻ tại một thời điểm. Nhiều người chết cùng đêm thì thư xếp HÀNG ĐỢI
 * theo thứ tự tử vong của engine, và bộ đếm nói còn bao nhiêu lá phía sau -
 * chồng ba thẻ lên nhau thì người chơi đọc lá cuối trước lá đầu.
 *
 * Cũng KHÔNG dùng toast: một lời nhắn cuối đời không được biến mất sau ba giây
 * chỉ vì người ta đang nhìn chỗ khác. Nó ở lại tới khi người đọc tự đóng.
 *
 * Danh tính người vừa chết đến từ `snapshot.lastLetter.opened` - tức là từ
 * server. Web không tự so danh sách người sống giữa hai snapshot để đoán ai vừa
 * chết; làm vậy là dựng một bản sao luật thứ hai ở đúng chỗ nó sai được nhiều nhất.
 *
 * Chỉ trình chiếu thư MỚI so với snapshot đầu tiên của phiên này. `opened` là
 * danh sách TÍCH LUỸ của cả ván, nên một người bấm F5 giữa trận sẽ nhận trọn xâu
 * thư đã mở từ đầu - trình chiếu lại tất cả là biến "mỗi thư mở một lần" thành
 * lời hứa chỉ đúng với người không bao giờ tải lại trang. Toàn bộ phép so đó
 * nằm trong `RevealState`, một cấu trúc thuần đã được test riêng.
 */
export function LastLetterReveal({ snapshot }: { snapshot: RoomSnapshot | null }) {
  const [state, setState] = useState(EMPTY_REVEAL_STATE);
  const reduced = useReducedMotion();

  /*
   * Đặt mốc từ snapshot THẬT đầu tiên, và dọn sạch khi về sảnh chờ.
   *
   * `observeSnapshot` tự trả về đúng object cũ khi không có gì đổi, nên effect
   * này không tự kích hoạt lại chính nó dù chạy theo từng snapshot.
   */
  useEffect(() => {
    setState((current) => observeSnapshot(current, snapshot));
  }, [snapshot]);

  const letter = nextReveal(state, snapshot);
  const remaining = pendingRevealCount(state, snapshot);

  if (!letter) return null;
  const card = revealCard(letter);

  return (
    <AnimatePresence mode="wait" initial={false}>
      <m.aside
        key={card.id}
        {...revealMotion(reduced === true)}
        className="card border-amber-500/30 bg-amber-950/15"
        aria-live="polite"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h4 className="font-display text-lg font-bold text-amber-200">{card.title}</h4>
          {remaining > 0 && (
            <span className="text-xs text-mist/70">còn {remaining} phong thư nữa</span>
          )}
        </div>

        {/* break-words: một lá thư viết liền không dấu cách không được đẩy ngang cả thẻ. */}
        <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-white">
          {card.text}
        </p>

        {/* Vòng niêm phong, KHÔNG phải vai trò: lá thư nói người này đã nghĩ gì
          * lúc còn sống, chứ không lật bài giúp ai. */}
        <p className="mt-2 text-xs text-mist/65">{card.sealedLabel}</p>

        <button
          className="btn-secondary mt-3 w-full sm:w-auto"
          onClick={() => setState((current) => dismissReveal(current, card.id))}
        >
          {remaining > 0 ? "Đọc phong thư tiếp theo" : "Đóng"}
        </button>
      </m.aside>
    </AnimatePresence>
  );
}
