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
    BLOOD_MOON: "bg-blood-600/15",
    MOONLESS_NIGHT: "bg-night-950/40",
    CLEARING_MIST: "bg-white/5 backdrop-blur-sm",
    CURFEW: "ring-2 ring-amber-500/20 ring-inset",
    BLOODY_HUNT: "bg-blood-600/10",
    WOLF_SHADOW: "bg-indigo-900/15",
    SILENT_NIGHT: "bg-slate-800/10",
    PEACEFUL_NIGHT: "bg-emerald-900/12",
    LAST_STAND: "bg-amber-900/10",
    HOWL_OF_THE_PACK: "bg-blood-900/8",
    DAY_OF_TRUTH: "bg-sky-900/10",
    JUDGMENT_DAY: "bg-amber-900/10",
    AMNESTY_DAY: "bg-white/5",
    MORNING_REPORT: "bg-sky-900/8",
    DEAD_CAN_SPEAK: "bg-violet-900/12",
  };
  return <div className={`absolute inset-0 ${tint[eventId] ?? ""}`} />;
}

function EventLayer({ id }: { id: string }) {
  switch (id) {
    case "BLOOD_MOON":
      return (
        <>
          <div className="absolute inset-0 bg-gradient-to-t from-blood-600/20 via-transparent to-transparent" />
          <m.div
            className="absolute -top-10 -right-10 h-64 w-64 rounded-full bg-gradient-to-br from-blood-400/30 to-blood-600/20 blur-2xl"
            animate={{ scale: [1, 1.08, 1], opacity: [0.5, 0.7, 0.5] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
          <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(600px 400px at 50% 30%, rgba(220,38,64,0.15), transparent 70%)" }} />
        </>
      );
    case "MOONLESS_NIGHT":
      return <div className="absolute inset-0 bg-night-950/50 backdrop-brightness-75" />;
    case "CLEARING_MIST":
      return (
        <>
          <m.div
            className="absolute inset-0 bg-white/[0.06] backdrop-blur-[1px]"
            animate={{ x: [-20, 20, -20] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
          />
          <m.div
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          />
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
