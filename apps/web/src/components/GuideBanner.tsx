"use client";

import { useEffect, useRef } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { guideStepFor, type GuideStepContext } from "@/lib/guide-steps";

interface Props {
  snapshot: RoomSnapshot;
  /** Bước chuẩn bị bàn đang ở đâu - thứ snapshot không nói. Xem `guide-steps`. */
  context?: GuideStepContext;
  onDismiss: () => void;
}

/**
 * Thẻ hướng dẫn của ván đầu - một tấm thẻ nhỏ đứng dưới thanh pha, KHÔNG phải
 * modal.
 *
 * Nó không che gì, không chặn gì và không tự đóng: pha đổi thì chữ đổi, người
 * chơi đọc lúc nào cũng được và bấm "Ẩn hướng dẫn" là xong cả ván. Một modal
 * dài chặn giữa pha bỏ phiếu 30 giây là cách chắc chắn nhất để người mới lỡ
 * đúng lá phiếu đầu tiên của họ.
 *
 * `role="status"` với `aria-live="polite"` trên vùng đứng yên: trình đọc màn
 * hình nghe bước mới khi pha đổi, nhưng không bị cắt lời (đồng hồ có nhãn
 * riêng, không đọc mỗi giây).
 */
export function GuideBanner({ snapshot, context, onDismiss }: Props) {
  const step = guideStepFor(snapshot, context);
  /*
   * Nhấn nhẹ khi bước đổi: đổi viền vài giây thay vì nhấp nháy. Đọc theo
   * `title` chứ không theo pha - cùng pha nhưng bước khác (có lượt đêm / không
   * có) cũng là một điều mới đáng liếc.
   */
  const previous = useRef(step.title);
  const changed = previous.current !== step.title;
  useEffect(() => {
    previous.current = step.title;
  }, [step.title]);

  return (
    <section
      aria-label="Hướng dẫn ván đầu"
      className={`rounded-xl border px-3.5 py-3 transition-colors duration-500 ${
        changed ? "border-amber-400/60 bg-amber-500/[0.10]" : "border-amber-400/25 bg-amber-500/[0.06]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0" role="status" aria-live="polite">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-amber-200/80">
            <span aria-hidden="true">🧭 </span>
            Hướng dẫn · {step.title}
          </p>
          <p className="mt-1 text-sm leading-snug text-mist-bright">{step.body}</p>
          {step.tip && (
            <p className="mt-1 text-[13px] leading-snug text-amber-100/80">
              <span className="font-semibold text-amber-200">Lưu ý:</span> {step.tip}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md border border-white/10 bg-night-900/60 px-2 py-1 text-xs font-semibold text-mist-strong hover:text-white"
          aria-label="Ẩn hướng dẫn cho tới hết ván"
        >
          Ẩn
        </button>
      </div>
    </section>
  );
}
