"use client";

import { AnimatePresence, m } from "motion/react";
import type { GameEventView } from "@masoi/shared";

interface Props {
  event: GameEventView | null | undefined;
}

const BENEFICIARY_BADGE: Record<"wolves" | "village" | "neutral", { label: string; cls: string }> = {
  wolves: { label: "Phe Sói", cls: "bg-blood-900/60 text-blood-300 border-blood-500/40" },
  village: { label: "Phe Dân", cls: "bg-emerald-900/60 text-emerald-300 border-emerald-500/40" },
  neutral: { label: "Trung Lập", cls: "bg-night-700/60 text-indigo-200 border-indigo-500/40" },
};

const EVENT_ICONS: Record<string, string> = {
  CURFEW: "⏳",
  SILENT_NIGHT: "🤫",
  AMNESTY_DAY: "🕊️",
  CLEARING_MIST: "🌫️",
  PEACEFUL_NIGHT: "✨",
  JUDGMENT_DAY: "⚖️",
  LAST_STAND: "🛡️",
  DAY_OF_TRUTH: "🔍",
  MOONLESS_NIGHT: "🌑",
  BLOODY_HUNT: "🩸",
  HOWL_OF_THE_PACK: "🐺",
  BLOOD_MOON: "🌕",
  WOLF_SHADOW: "👤",
  MORNING_REPORT: "📰",
  DEAD_CAN_SPEAK: "👻",
};

export function EventBanner({ event }: Props) {
  if (!event) return null;

  const icon = EVENT_ICONS[event.id] ?? "⚡";
  const badge = BENEFICIARY_BADGE[event.beneficiary];

  return (
    <AnimatePresence>
      <m.div
        key={event.id}
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-night-900/90 to-amber-950/40 px-4 py-3 shadow-lg shadow-amber-950/20"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <m.span
              animate={event.power >= 4 ? { scale: [1, 1.1, 1], rotate: [0, -3, 3, 0] } : undefined}
              transition={event.power >= 4 ? { duration: 0.6, ease: "easeInOut", repeat: 1 } : undefined}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-xl motion-reduce:animate-none"
            >
              {icon}
            </m.span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">
                  Sự kiện trận đấu
                </span>
                <span
                  className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${badge.cls}`}
                >
                  {badge.label}
                </span>
                <span className="inline-block rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">
                  Cấp độ {event.power}
                </span>
              </div>
              <h4 className="font-display text-base font-bold text-amber-200">{event.name}</h4>
              <p className="mt-0.5 text-xs text-mist/80">{event.description}</p>
              {event.announcement && (
                <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm font-bold text-amber-100">
                  {event.announcement}
                </p>
              )}
            </div>
          </div>
        </div>
      </m.div>
    </AnimatePresence>
  );
}
