"use client";

import { m, AnimatePresence } from "motion/react";
import type { GameEventView } from "@masoi/shared";

interface Props {
  event: GameEventView | null | undefined;
}

export function EventEnvironment({ event }: Props) {
  if (!event) return null;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    // Still show static tint without particles
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
          <div className="absolute inset-0 opacity-30" style={{ background: "radial-gradient(700px 420px at 50% 28%, rgba(220,38,64,0.22), transparent 72%)" }} />
        </>
      );
    case "MOONLESS_NIGHT":
      return <div className="absolute inset-0 bg-night-950/50 backdrop-brightness-75" />;
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
          <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-white/10 via-white/5 to-transparent" />
        </>
      );
    case "SILENT_NIGHT":
      return (
        <>
          <div className="absolute inset-0 bg-slate-900/15 backdrop-saturate-50" />
          <Particles count={14} char="·" color="text-white/20" duration={7} />
        </>
      );
    case "CURFEW":
      return <div className="absolute inset-0 ring-[3px] ring-amber-500/25 ring-inset animate-pulse" />;
    case "AMNESTY_DAY":
      return <div className="absolute inset-0 bg-gradient-to-b from-white/[0.04] to-transparent" />;
    case "PEACEFUL_NIGHT":
      return (
        <>
          <div className="absolute inset-0 bg-emerald-900/10" />
          <Particles count={10} char="✦" color="text-emerald-300/30" duration={9} />
        </>
      );
    case "BLOODY_HUNT":
      return (
        <>
          <m.div className="absolute inset-0 bg-blood-600/10" animate={{ opacity: [0.08, 0.15, 0.08] }} transition={{ duration: 1.2, repeat: Infinity }} />
          <div className="absolute inset-0" style={{ background: "repeating-linear-gradient(90deg, transparent 0 40px, rgba(220,38,64,0.03) 40px 41px)" }} />
        </>
      );
    case "WOLF_SHADOW":
      return (
        <m.div className="absolute inset-0 bg-indigo-950/20" animate={{ opacity: [0.15, 0.25, 0.15] }} transition={{ duration: 2.5, repeat: Infinity }}>
          <div className="absolute left-1/2 top-1/2 h-[120%] w-[60%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/20 blur-3xl" />
        </m.div>
      );
    case "LAST_STAND":
      return <div className="absolute inset-0 bg-gradient-to-t from-amber-600/12 via-transparent to-transparent" />;
    case "HOWL_OF_THE_PACK":
      return (
        <>
          <div className="absolute inset-0 bg-blood-900/8" />
          <m.div className="absolute left-1/2 top-[18%] -translate-x-1/2 text-4xl opacity-20" animate={{ scale: [1, 1.15, 1] }} transition={{ duration: 1.8, repeat: Infinity }}>
            🐺
          </m.div>
        </>
      );
    case "DAY_OF_TRUTH":
      return <div className="absolute inset-0 bg-sky-900/8 backdrop-contrast-110" />;
    case "JUDGMENT_DAY":
      return <div className="absolute inset-0 bg-amber-900/10 ring-1 ring-amber-500/20 ring-inset" />;
    case "MORNING_REPORT":
      return <div className="absolute inset-0 bg-sky-800/5" />;
    case "DEAD_CAN_SPEAK":
      return (
        <>
          <div className="absolute inset-0 bg-violet-950/15" />
          <Particles count={8} char="👻" color="text-violet-300/20" duration={6} />
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
