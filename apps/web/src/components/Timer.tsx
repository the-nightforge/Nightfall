"use client";

import { useEffect, useRef, useState } from "react";
import { serverNow } from "@/lib/clock";

const RADIUS = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const TICK_MS = 500;

function fmt(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Đồng hồ đếm ngược từ timestamp server, không tự tính logic game.
 *
 * Mốc so sánh là serverNow() chứ không phải Date.now(): endsAt là giờ server,
 * còn đồng hồ máy người chơi có thể lệch hàng chục giây.
 */
export function Timer({ endsAt }: { endsAt: number | null }) {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const msLeft = endsAt === null ? 0 : endsAt - now;
  const fraction = useCountdownFraction(endsAt, msLeft);
  const danger = endsAt !== null && msLeft <= 10_000;

  return (
    <div className="relative h-[52px] w-[52px] shrink-0">
      <svg viewBox="0 0 52 52" className="h-full w-full -rotate-90">
        <circle
          cx="26"
          cy="26"
          r={RADIUS}
          fill="none"
          strokeWidth="3"
          className="stroke-white/10"
        />
        {endsAt !== null && (
          <circle
            cx="26"
            cy="26"
            r={RADIUS}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className={danger ? "stroke-blood-500" : "stroke-mist/70"}
            style={{
              strokeDasharray: CIRCUMFERENCE,
              strokeDashoffset: CIRCUMFERENCE * (1 - fraction),
              // Vòng rút liên tục giữa hai nhịp 500ms, khỏi phải đánh thức máy
              // bốn lần mỗi giây chỉ để nó trông mượt.
              transition: `stroke-dashoffset ${TICK_MS}ms linear`,
            }}
          />
        )}
      </svg>
      <span
        className={`absolute inset-0 grid place-items-center font-mono text-[11px] font-bold tabular-nums ${
          endsAt === null ? "text-mist/60" : danger ? "text-blood-400 timer-danger-pulse" : "text-white"
        }`}
      >
        {endsAt === null ? "--:--" : fmt(msLeft)}
      </span>
    </div>
  );
}

/**
 * Phần vòng còn lại, 1 là đầy.
 *
 * Snapshot không nói pha bắt đầu lúc nào, nên tổng thời lượng lấy từ lần đầu
 * nhìn thấy endsAt này. Hệ quả có thật: nối lại giữa pha thì vòng bắt đầu đầy
 * rồi rút trong quãng còn lại. Chấp nhận được vì vòng chỉ là trang trí - con số
 * bên trong nó luôn đúng - và đổi lại không phải thêm trường vào protocol.
 * Cửa sổ Phù Thuỷ nới hạn chót giữa pha cũng tự có tổng mới nhờ endsAt đổi.
 */
function useCountdownFraction(endsAt: number | null, msLeft: number): number {
  const span = useRef<{ endsAt: number; total: number } | null>(null);

  if (endsAt === null) {
    span.current = null;
    return 0;
  }
  if (span.current?.endsAt !== endsAt) {
    span.current = { endsAt, total: Math.max(1_000, msLeft) };
  }
  return Math.min(1, Math.max(0, msLeft / span.current.total));
}
