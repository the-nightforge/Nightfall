"use client";

import { m, AnimatePresence } from "motion/react";
import type { GameEventView } from "@masoi/shared";

interface Props {
  event: GameEventView | null | undefined;
}

export function EventEnvironment({ event }: Props) {
  if (!event) return null;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return <StaticTint eventId={event.id} />;
  }
  return (
    <AnimatePresence>
      <m.div
        key={event.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.8 }}
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        <EventLayer id={event.id} />
      </m.div>
    </AnimatePresence>
  );
}

function StaticTint({ eventId }: { eventId: string }) {
  const tint: Record<string, string> = {
    BLOOD_MOON: "bg-blood-600/25",
    MOONLESS_NIGHT: "bg-night-950/55",
    CLEARING_MIST: "bg-white/10 backdrop-blur-sm",
    CURFEW: "ring-2 ring-amber-500/30 ring-inset",
    BLOODY_HUNT: "bg-blood-600/15",
    WOLF_SHADOW: "bg-indigo-900/25",
    SILENT_NIGHT: "bg-slate-800/20",
    PEACEFUL_NIGHT: "bg-emerald-900/20",
    LAST_STAND: "bg-amber-900/18",
    HOWL_OF_THE_PACK: "bg-blood-900/15",
    DAY_OF_TRUTH: "bg-sky-900/15",
    JUDGMENT_DAY: "bg-amber-900/18",
    AMNESTY_DAY: "bg-white/8",
    MORNING_REPORT: "bg-sky-900/12",
    DEAD_CAN_SPEAK: "bg-violet-900/18",
  };
  return <div className={`absolute inset-0 ${tint[eventId] ?? ""}`} />;
}

function EventLayer({ id }: { id: string }) {
  switch (id) {
    case "BLOOD_MOON":
      return (
        <>
          <div className="absolute inset-0 bg-gradient-to-t from-blood-600/30 via-blood-900/10 to-transparent" />
          <m.div
            className="absolute -top-10 -right-10 h-72 w-72 rounded-full bg-gradient-to-br from-blood-400/35 to-blood-600/25 blur-2xl"
            animate={{ scale: [1, 1.12, 1], opacity: [0.6, 0.85, 0.6] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          />
          <m.div
            className="absolute left-1/2 top-[22%] h-28 w-28 -translate-x-1/2 rounded-full bg-blood-400/20 blur-xl"
            animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <m.div className="absolute inset-0 border-2 border-blood-500/15" animate={{ opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 1.5, repeat: Infinity }} />
          <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(700px 420px at 50% 28%, rgba(220,38,64,0.22), transparent 72%)" }} />
        </>
      );
    case "MOONLESS_NIGHT":
      return (
        <>
          <div className="absolute inset-0 bg-night-950/60 backdrop-brightness-[0.65]" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/30" />
          <m.div className="absolute inset-0 opacity-20" animate={{ opacity: [0.1, 0.25, 0.1] }} transition={{ duration: 4, repeat: Infinity }}>
            <div className="absolute inset-0" style={{ background: "repeating-linear-gradient(0deg, transparent 0 2px, rgba(255,255,255,0.02) 2px 3px)" }} />
          </m.div>
        </>
      );
    case "CLEARING_MIST":
      return (
        <>
          <m.div
            className="absolute inset-0 bg-white/[0.10] backdrop-blur-[2px]"
            animate={{ x: [-24, 24, -24] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          />
          <m.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 7, repeat: Infinity, ease: "linear" }}
          />
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white/12 via-white/6 to-transparent" />
          <Particles count={10} char="◦" color="text-white/25" duration={8} />
        </>
      );
    case "SILENT_NIGHT":
      return (
        <>
          <div className="absolute inset-0 bg-slate-900/20 backdrop-saturate-50" />
          <m.div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-5xl opacity-10" animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 3, repeat: Infinity }}>
            🔇
          </m.div>
          <Particles count={14} char="·" color="text-white/25" duration={7} />
          <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        </>
      );
    case "CURFEW":
      return (
        <>
          <div className="absolute inset-0 ring-[3px] ring-amber-500/30 ring-inset" />
          <m.div className="absolute inset-0 bg-amber-500/5" animate={{ opacity: [0.05, 0.12, 0.05] }} transition={{ duration: 1.5, repeat: Infinity }} />
          <m.div
            className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400/20"
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <m.div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 text-amber-300/30 text-3xl flex items-center justify-center" animate={{ rotate: 360 }} transition={{ duration: 8, repeat: Infinity, ease: "linear" }}>
            ◷
          </m.div>
          <m.div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" animate={{ x: ["-100%", "100%"] }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} />
        </>
      );
    case "AMNESTY_DAY":
      return (
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] via-sky-100/[0.03] to-transparent" />
          <m.div className="absolute left-1/2 top-[20%] -translate-x-1/2 text-4xl opacity-25" animate={{ y: [0, -8, 0], rotate: [-2, 2, -2] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
            🕊️
          </m.div>
          <Particles count={6} char="✦" color="text-white/20" duration={5} />
        </>
      );
    case "PEACEFUL_NIGHT":
      return (
        <>
          <div className="absolute inset-0 bg-emerald-900/15" />
          <m.div className="absolute inset-0 bg-gradient-to-t from-emerald-600/10 via-transparent to-transparent" animate={{ opacity: [0.4, 0.7, 0.4] }} transition={{ duration: 3, repeat: Infinity }} />
          <Particles count={12} char="✦" color="text-emerald-300/35" duration={9} />
          <m.div className="absolute left-1/2 top-[25%] -translate-x-1/2 text-2xl opacity-20" animate={{ scale: [1, 1.2, 1], rotate: [0, 5, 0] }} transition={{ duration: 4, repeat: Infinity }}>
            ☾
          </m.div>
        </>
      );
    case "BLOODY_HUNT":
      return (
        <>
          <m.div className="absolute inset-0 bg-blood-600/12" animate={{ opacity: [0.08, 0.18, 0.08] }} transition={{ duration: 1, repeat: Infinity }} />
          <div className="absolute inset-0" style={{ background: "repeating-linear-gradient(90deg, transparent 0 40px, rgba(220,38,64,0.04) 40px 41px)" }} />
          <m.div className="absolute left-[18%] top-[32%] text-blood-400/25 text-2xl rotate-12" animate={{ x: [0, 4, 0] }} transition={{ duration: 0.4, repeat: Infinity }}>🩸</m.div>
          <m.div className="absolute right-[20%] top-[28%] text-blood-400/20 text-xl -rotate-12" animate={{ x: [0, -4, 0] }} transition={{ duration: 0.5, repeat: Infinity }}>🩸</m.div>
        </>
      );
    case "WOLF_SHADOW":
      return (
        <>
          <m.div className="absolute inset-0 bg-indigo-950/25" animate={{ opacity: [0.18, 0.32, 0.18] }} transition={{ duration: 2.2, repeat: Infinity }} />
          <m.div className="absolute left-1/2 top-1/2 h-[130%] w-[65%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/25 blur-3xl" animate={{ scale: [1, 1.05, 1], x: [-8, 8, -8] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} />
          <m.div className="absolute left-[42%] top-[38%] text-3xl opacity-15 blur-[1px]" animate={{ x: [0, 12, 0], opacity: [0.1, 0.2, 0.1] }} transition={{ duration: 4, repeat: Infinity }}>
            🐾
          </m.div>
        </>
      );
    case "LAST_STAND":
      return (
        <>
          <div className="absolute inset-0 bg-gradient-to-t from-amber-600/18 via-amber-900/8 to-transparent" />
          <m.div className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-400/25" animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.2, 0.5] }} transition={{ duration: 2, repeat: Infinity }} />
          <m.div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-3xl" animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 1.5, repeat: Infinity }}>
            🛡️
          </m.div>
        </>
      );
    case "HOWL_OF_THE_PACK":
      return (
        <>
          <div className="absolute inset-0 bg-blood-900/10" />
          <m.div className="absolute left-1/2 top-[15%] -translate-x-1/2 text-5xl opacity-25" animate={{ scale: [1, 1.18, 1] }} transition={{ duration: 1.6, repeat: Infinity }}>
            🐺
          </m.div>
          {[0, 1, 2].map((i) => (
            <m.div key={i} className="absolute left-1/2 top-[18%] h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-blood-400/15" animate={{ scale: [0.8, 1.8], opacity: [0.4, 0] }} transition={{ duration: 2, repeat: Infinity, delay: i * 0.6 }} />
          ))}
        </>
      );
    case "DAY_OF_TRUTH":
      return (
        <>
          <div className="absolute inset-0 bg-sky-900/12 backdrop-contrast-110" />
          <m.div className="absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-400/15" animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }} transition={{ duration: 3, repeat: Infinity }} />
          <m.div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-4xl opacity-20" animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }}>
            👁️
          </m.div>
          <m.div className="absolute left-0 top-1/2 h-px w-full bg-gradient-to-r from-transparent via-sky-400/30 to-transparent" animate={{ y: [-60, 60, -60] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />
        </>
      );
    case "JUDGMENT_DAY":
      return (
        <>
          <div className="absolute inset-0 bg-amber-900/14 ring-1 ring-amber-500/20 ring-inset" />
          <m.div className="absolute left-1/2 top-[20%] -translate-x-1/2 text-4xl opacity-25" animate={{ rotate: [-3, 3, -3] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}>
            ⚖️
          </m.div>
          <div className="absolute left-1/2 top-[28%] h-px w-24 -translate-x-1/2 bg-amber-400/20" />
        </>
      );
    case "MORNING_REPORT":
      return (
        <>
          <div className="absolute inset-0 bg-sky-800/8" />
          <m.div className="absolute right-[12%] top-[18%] text-2xl opacity-20 rotate-3" animate={{ y: [0, -4, 0] }} transition={{ duration: 3, repeat: Infinity }}>
            📰
          </m.div>
          <m.div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-transparent via-sky-400/20 to-transparent" animate={{ x: ["-100%", "100%"] }} transition={{ duration: 3, repeat: Infinity, ease: "linear" }} />
        </>
      );
    case "DEAD_CAN_SPEAK":
      return (
        <>
          <div className="absolute inset-0 bg-violet-950/18" />
          <m.div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-5xl opacity-20 blur-[0.5px]" animate={{ y: [0, -10, 0], opacity: [0.15, 0.3, 0.15] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}>
            👻
          </m.div>
          <Particles count={8} char="·" color="text-violet-300/25" duration={6} />
        </>
      );
    default:
      return <div className="absolute inset-0 bg-amber-500/5" />;
  }
}

function Particles({ count, char, color, duration }: { count: number; char: string; color: string; duration: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <m.span
          key={i}
          className={`absolute select-none text-xs ${color}`}
          style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%` }}
          animate={{ y: [0, -18, 0], opacity: [0.2, 0.5, 0.2] }}
          transition={{ duration: duration + (i % 3), repeat: Infinity, delay: i * 0.4, ease: "easeInOut" }}
          aria-hidden="true"
        >
          {char}
        </m.span>
      ))}
    </>
  );
}
