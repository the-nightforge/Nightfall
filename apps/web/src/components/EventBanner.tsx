"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import type { GameEventView } from "@masoi/shared";
import { eventIcon } from "@/lib/event-art";

interface Props {
  event: GameEventView | null | undefined;
}

const BENEFICIARY_BADGE: Record<"wolves" | "village" | "neutral", { label: string; cls: string }> = {
  wolves: { label: "Phe Sói", cls: "bg-blood-900/60 text-blood-300 border-blood-500/40" },
  village: { label: "Phe Dân", cls: "bg-emerald-900/60 text-emerald-300 border-emerald-500/40" },
  neutral: { label: "Trung Lập", cls: "bg-night-700/60 text-indigo-200 border-indigo-500/40" },
};

/**
 * Bao lâu thì thẻ tự thu lại. Đủ để đọc hết mô tả dài nhất một lượt bình thường,
 * chưa đủ để thành đồ đạc thường trực chiếm một phần tư màn hình điện thoại
 * suốt cả vòng.
 */
const COLLAPSE_AFTER_MS = 12_000;

/**
 * Thẻ sự kiện đang có hiệu lực.
 *
 * Sự kiện được thông báo lớn đúng MỘT lần, bằng đoạn chuyển cảnh của họ nó
 * (xem cinematic-transition.ts). Thẻ này là bản lưu: mở rộng trong quãng đầu để
 * ai vừa vào kịp đọc, rồi thu về một dòng. Bấm vào là bung lại - luật của sự
 * kiện đổi cách chơi cả vòng, nên không bao giờ được biến mất hẳn.
 *
 * Bản cũ luôn mở hết cỡ, và cùng lúc RightMetaPanel bên phải in lại y nguyên
 * tên, mô tả và thông báo - hai bản sao của cùng một đoạn chữ nằm cách nhau
 * 300px. Giờ cột phải chỉ giữ tên và phe hưởng lợi, phần chữ nằm ở đây.
 */
export function EventBanner({ event }: Props) {
  // Khoá theo lần kích hoạt chứ không theo id: cùng một sự kiện ở vòng sau là
  // một lần kích hoạt mới và đáng được mở lại.
  const activation = event ? `${event.id}:${event.round}` : null;
  const [openFor, setOpenFor] = useState<string | null>(activation);

  useEffect(() => {
    if (!activation) return;
    setOpenFor(activation);
    const timer = setTimeout(
      () => setOpenFor((current) => (current === activation ? null : current)),
      COLLAPSE_AFTER_MS,
    );
    return () => clearTimeout(timer);
  }, [activation]);

  if (!event) return null;

  const expanded = openFor === activation;
  const badge = BENEFICIARY_BADGE[event.beneficiary];

  return (
    <AnimatePresence>
      <m.div
        key={event.id}
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-night-900/90 to-amber-950/40 shadow-lg shadow-amber-950/20"
      >
        <button
          type="button"
          onClick={() => setOpenFor(expanded ? null : activation)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-3 px-4 py-3 text-left"
        >
          <m.span
            animate={event.power >= 4 ? { scale: [1, 1.1, 1], rotate: [0, -3, 3, 0] } : undefined}
            transition={event.power >= 4 ? { duration: 0.6, ease: "easeInOut", repeat: 1 } : undefined}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-xl motion-reduce:animate-none"
            aria-hidden="true"
          >
            {eventIcon(event.id)}
          </m.span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-widest text-amber-400">
                Sự kiện trận đấu
              </span>
              <span
                className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${badge.cls}`}
              >
                {badge.label}
              </span>
              <span className="inline-block rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                Cấp độ {event.power}
              </span>
            </span>
            <span className="block truncate font-display text-base font-bold text-amber-200">
              {event.name}
            </span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-amber-300/80">
            {expanded ? "Thu gọn ▴" : "Chi tiết ▾"}
          </span>
        </button>

        {expanded && (
          <div className="px-4 pb-3 pl-[3.25rem]">
            <p className="text-xs text-mist/80">{event.description}</p>
            {event.announcement && (
              <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm font-bold text-amber-100">
                {event.announcement}
              </p>
            )}
          </div>
        )}
      </m.div>
    </AnimatePresence>
  );
}
