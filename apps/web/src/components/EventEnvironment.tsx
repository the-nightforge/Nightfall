"use client";

import { m, AnimatePresence, useReducedMotion } from "motion/react";
import type { GameEventView } from "@masoi/shared";
import { EventGlyph, type EventGlyphName } from "./EventGlyph";

interface Props {
  event: GameEventView | null | undefined;
}

/**
 * Nền của sự kiện đang diễn ra.
 *
 * Ba điều đã sửa so với bản trước, đều đo được:
 *
 * 1. `AnimatePresence` phải nằm NGOÀI phép thử `event`. Bản cũ viết
 *    `if (!event) return null` trước nó, nên khi sự kiện kết thúc thì cả
 *    AnimatePresence bị gỡ theo và `exit` không bao giờ chạy: đo được số lớp
 *    tụt 1 -> 0 ngay tại mốc 0ms, nền tắt phụt. Đổi hai sự kiện cho nhau thì
 *    lại mượt, nên trong ván nó ra một sự bất đối xứng khó chịu: vào thì êm,
 *    ra thì giật.
 *
 * 2. `mode="wait"` để chặn tích luỹ lớp. Ở chế độ mặc định, đổi sự kiện nhanh
 *    hơn thời gian `exit` thì các lớp đang thoát nằm chồng lên nhau - đo được
 *    15 lớp và 102 node DOM khi đổi mỗi 250ms, tất cả vẫn chạy animation
 *    `repeat: Infinity`. Trong ván thật sự kiện đổi theo pha nên chưa chạm
 *    phải, nhưng một loạt snapshot dồn lúc reconnect thì có.
 *
 * 3. Đọc `prefers-reduced-motion` bằng hook chứ không gọi `window.matchMedia`
 *    thẳng trong thân render. Bản cũ dựng ra hai cây khác nhau ở server và
 *    client, và không bao giờ phản ứng khi người dùng đổi thiết lập giữa phiên.
 */
export function EventEnvironment({ event }: Props) {
  const reduced = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      {event && (
        <m.div
          key={event.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          // Vào chậm hơn ra: sự kiện mới cần thời gian để mắt nhận ra, còn cái
          // vừa hết thì đứng lại càng lâu càng cản cái đang tới.
          transition={{ duration: reduced ? 0.2 : 0.7, ease: "easeOut" }}
          className="pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          {reduced ? <StaticTint eventId={event.id} /> : <EventLayer id={event.id} />}
        </m.div>
      )}
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

/*
 * Vì sao không còn thứ gì đặt ở `left-1/2 top-1/2`.
 *
 * Cả lớp này nằm ở z-index -10, tức sau MỌI thành phần giao diện. Chính giữa
 * màn hình là chỗ bàn chơi - lưới người chơi, bảng vai, khung chat - nên một
 * biểu tượng đặt ở đó bị che gần như hoàn toàn và người chơi không bao giờ
 * thấy. Phần duy nhất của nền còn lộ ra là dải trên, dải dưới và hai lề bên
 * khi màn rộng, nên mọi điểm nhấn dời hết về đó.
 *
 * Các lớp phủ toàn màn (gradient, tint) thì giữ nguyên: chúng vẫn ăn qua các
 * khe hở và qua những thẻ bài đang `backdrop-blur`.
 */

/** Điểm nhấn ở lề: đủ xa tâm để không bị bàn chơi che. */
const EDGE = {
  topLeft: "left-[6%] top-[8%]",
  topRight: "right-[7%] top-[9%]",
  bottomLeft: "bottom-[10%] left-[8%]",
  bottomRight: "bottom-[9%] right-[8%]",
} as const;

function Glyph({
  name,
  at,
  size,
  className,
}: {
  name: EventGlyphName;
  at: keyof typeof EDGE;
  size: string;
  className?: string;
}) {
  return <EventGlyph name={name} className={`absolute ${EDGE[at]} ${size} ${className ?? ""}`} />;
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
            className="absolute left-[12%] top-[14%] h-28 w-28 rounded-full bg-blood-400/20 blur-xl"
            animate={{ scale: [1, 1.2, 1], opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <m.div
            className="absolute inset-0 border-2 border-blood-500/15"
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          <div
            className="absolute inset-0 opacity-30"
            style={{ background: "radial-gradient(700px 420px at 50% 28%, rgba(220,38,64,0.22), transparent 72%)" }}
          />
        </>
      );
    case "MOONLESS_NIGHT":
      return (
        <>
          <div className="absolute inset-0 bg-night-950/60 backdrop-brightness-[0.65]" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/30" />
          <m.div
            className="absolute inset-0 opacity-20"
            animate={{ opacity: [0.1, 0.25, 0.1] }}
            transition={{ duration: 4, repeat: Infinity }}
          >
            <div
              className="absolute inset-0"
              style={{ background: "repeating-linear-gradient(0deg, transparent 0 2px, rgba(255,255,255,0.02) 2px 3px)" }}
            />
          </m.div>
          <Glyph name="moon" at="topRight" size="h-16 w-16" className="text-white/[0.07]" />
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
          <Motes count={10} size="h-1.5 w-1.5" color="bg-white/25" duration={8} />
        </>
      );
    case "SILENT_NIGHT":
      return (
        <>
          <div className="absolute inset-0 bg-slate-900/20 backdrop-saturate-50" />
          <Glyph name="silence" at="topRight" size="h-20 w-20" className="text-white/10" />
          <Motes count={14} size="h-1 w-1" color="bg-white/25" duration={7} />
          <div className="absolute inset-x-0 top-1/2 h-px bg-white/10" />
        </>
      );
    case "CURFEW":
      return (
        <>
          <div className="absolute inset-0 ring-[3px] ring-amber-500/30 ring-inset" />
          <m.div
            className="absolute inset-0 bg-amber-500/5"
            animate={{ opacity: [0.05, 0.12, 0.05] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          />
          <m.div
            className={`absolute ${EDGE.topRight} h-24 w-24 rounded-full border-2 border-amber-400/20`}
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <m.div
            className={`absolute ${EDGE.topRight} h-24 w-24 p-4 text-amber-300/30`}
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
          >
            <EventGlyph name="clock" className="h-full w-full" />
          </m.div>
          <m.div
            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          />
        </>
      );
    case "AMNESTY_DAY":
      return (
        <>
          <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] via-sky-100/[0.03] to-transparent" />
          <m.div
            className={`absolute ${EDGE.topRight} h-16 w-16 text-white/25`}
            animate={{ y: [0, -8, 0], rotate: [-2, 2, -2] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <EventGlyph name="flag" className="h-full w-full" />
          </m.div>
          <Motes count={6} size="h-1 w-1" color="bg-white/20" duration={5} />
        </>
      );
    case "PEACEFUL_NIGHT":
      return (
        <>
          <div className="absolute inset-0 bg-emerald-900/15" />
          <m.div
            className="absolute inset-0 bg-gradient-to-t from-emerald-600/10 via-transparent to-transparent"
            animate={{ opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
          <Motes count={12} size="h-1 w-1" color="bg-emerald-300/35" duration={9} />
          <m.div
            className={`absolute ${EDGE.topRight} h-14 w-14 text-emerald-200/20`}
            animate={{ scale: [1, 1.12, 1] }}
            transition={{ duration: 4, repeat: Infinity }}
          >
            <EventGlyph name="moon" className="h-full w-full" />
          </m.div>
        </>
      );
    case "BLOODY_HUNT":
      return (
        <>
          <m.div
            className="absolute inset-0 bg-blood-600/12"
            animate={{ opacity: [0.08, 0.18, 0.08] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
          <div
            className="absolute inset-0"
            style={{ background: "repeating-linear-gradient(90deg, transparent 0 40px, rgba(220,38,64,0.04) 40px 41px)" }}
          />
          <m.div
            className={`absolute ${EDGE.topLeft} h-10 w-10 rotate-12 text-blood-400/25`}
            animate={{ y: [0, 5, 0] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          >
            <EventGlyph name="blood" className="h-full w-full" />
          </m.div>
          <m.div
            className={`absolute ${EDGE.bottomRight} h-8 w-8 -rotate-12 text-blood-400/20`}
            animate={{ y: [0, 4, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          >
            <EventGlyph name="blood" className="h-full w-full" />
          </m.div>
        </>
      );
    case "WOLF_SHADOW":
      return (
        <>
          <m.div
            className="absolute inset-0 bg-indigo-950/25"
            animate={{ opacity: [0.18, 0.32, 0.18] }}
            transition={{ duration: 2.2, repeat: Infinity }}
          />
          {/* Vệt tối lớn thì giữ ở giữa: nó là một mảng mờ toàn màn, không phải
            * một biểu tượng cần đọc ra, nên bị thẻ bài che cũng không mất gì. */}
          <m.div
            className="absolute left-1/2 top-1/2 h-[130%] w-[65%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/25 blur-3xl"
            animate={{ scale: [1, 1.05, 1], x: [-8, 8, -8] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
          />
          <m.div
            className={`absolute ${EDGE.bottomLeft} h-16 w-16 text-black/25 blur-[1px]`}
            animate={{ x: [0, 12, 0], opacity: [0.5, 0.9, 0.5] }}
            transition={{ duration: 4, repeat: Infinity }}
          >
            <EventGlyph name="paw" className="h-full w-full" />
          </m.div>
        </>
      );
    case "LAST_STAND":
      return (
        <>
          <div className="absolute inset-0 bg-gradient-to-t from-amber-600/18 via-amber-900/8 to-transparent" />
          <m.div
            className={`absolute ${EDGE.bottomRight} h-24 w-24 rounded-full border-2 border-amber-400/25`}
            animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0.2, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
          />
          <m.div
            className={`absolute ${EDGE.bottomRight} h-24 w-24 p-6 text-amber-300/30`}
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <EventGlyph name="shield" className="h-full w-full" />
          </m.div>
        </>
      );
    case "HOWL_OF_THE_PACK":
      return (
        <>
          <div className="absolute inset-0 bg-blood-900/10" />
          <m.div
            className={`absolute ${EDGE.topRight} h-20 w-20 text-blood-400/25`}
            animate={{ scale: [1, 1.14, 1] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          >
            <EventGlyph name="wolf" className="h-full w-full" />
          </m.div>
          {[0, 1, 2].map((i) => (
            <m.div
              key={i}
              className={`absolute ${EDGE.topRight} h-20 w-20 rounded-full border border-blood-400/15`}
              animate={{ scale: [0.8, 1.8], opacity: [0.4, 0] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.6 }}
            />
          ))}
        </>
      );
    case "DAY_OF_TRUTH":
      return (
        <>
          <div className="absolute inset-0 bg-sky-900/12 backdrop-contrast-110" />
          <m.div
            className={`absolute ${EDGE.topRight} h-28 w-28 rounded-full border border-sky-400/15`}
            animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.5, 0.3] }}
            transition={{ duration: 3, repeat: Infinity }}
          />
          <m.div
            className={`absolute ${EDGE.topRight} h-28 w-28 p-7 text-sky-200/20`}
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <EventGlyph name="eye" className="h-full w-full" />
          </m.div>
          <m.div
            className="absolute left-0 top-1/2 h-px w-full bg-gradient-to-r from-transparent via-sky-400/30 to-transparent"
            animate={{ y: [-60, 60, -60] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      );
    case "JUDGMENT_DAY":
      return (
        <>
          <div className="absolute inset-0 bg-amber-900/14 ring-1 ring-amber-500/20 ring-inset" />
          <m.div
            className={`absolute ${EDGE.topRight} h-20 w-20 text-amber-200/25`}
            animate={{ rotate: [-3, 3, -3] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <EventGlyph name="scales" className="h-full w-full" />
          </m.div>
        </>
      );
    case "MORNING_REPORT":
      return (
        <>
          <div className="absolute inset-0 bg-sky-800/8" />
          <m.div
            className={`absolute ${EDGE.topRight} h-14 w-14 rotate-3 text-sky-200/20`}
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity }}
          >
            <EventGlyph name="report" className="h-full w-full" />
          </m.div>
          <m.div
            className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-transparent via-sky-400/20 to-transparent"
            animate={{ x: ["-100%", "100%"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          />
        </>
      );
    case "DEAD_CAN_SPEAK":
      return (
        <>
          <div className="absolute inset-0 bg-violet-950/18" />
          <m.div
            className={`absolute ${EDGE.bottomLeft} h-20 w-20 text-violet-200/20 blur-[0.5px]`}
            animate={{ y: [0, -10, 0], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <EventGlyph name="ghost" className="h-full w-full" />
          </m.div>
          <Motes count={8} size="h-1 w-1" color="bg-violet-300/25" duration={6} />
        </>
      );
    default:
      return <div className="absolute inset-0 bg-amber-500/5" />;
  }
}

/**
 * Bụi sáng lơ lửng.
 *
 * Là `div` bo tròn chứ không phải ký tự "◦" / "·" / "✦" như bản cũ: ba ký tự đó
 * nằm ở khối Geometric Shapes và Dingbats, không phải font nào cũng có, và font
 * dự phòng vẽ ra ba cỡ khác nhau - có máy thì mất hẳn thành ô vuông.
 *
 * Toạ độ tính bằng số nguyên tố nhân dồn chứ không random: random thì server và
 * client dựng ra hai bầu bụi khác nhau và React dựng lại cả nhánh.
 */
function Motes({
  count,
  size,
  color,
  duration,
}: {
  count: number;
  size: string;
  color: string;
  duration: number;
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <m.span
          key={i}
          className={`absolute rounded-full ${size} ${color}`}
          style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 100}%` }}
          animate={{ y: [0, -18, 0], opacity: [0.2, 0.5, 0.2] }}
          transition={{ duration: duration + (i % 3), repeat: Infinity, delay: i * 0.4, ease: "easeInOut" }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}
