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
 * Nhịp đếm dùng chung cho cả vòng đồng hồ lẫn dòng chữ đếm ngược.
 *
 * Hai chỗ đọc CÙNG một hàm `serverNow()` và cùng một chu kỳ, nên chúng không
 * bao giờ lệch nhau một giây - thứ mà hai bộ đếm riêng gần như chắc chắn làm.
 */
function useServerTick(): number {
  const [now, setNow] = useState(() => serverNow());

  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  return now;
}

/**
 * Đồng hồ đếm ngược từ timestamp server, không tự tính logic game.
 *
 * Mốc so sánh là serverNow() chứ không phải Date.now(): endsAt là giờ server,
 * còn đồng hồ máy người chơi có thể lệch hàng chục giây.
 */
export function Timer({ endsAt }: { endsAt: number | null }) {
  const now = useServerTick();

  const msLeft = endsAt === null ? 0 : endsAt - now;
  const fraction = useCountdownFraction(endsAt, msLeft);
  /*
   * Hai nấc cảnh báo, không phải một.
   *
   * Bản cũ chỉ đổi màu ở mốc 10 giây - tức là lúc đã quá muộn để đổi phiếu hay
   * gõ nốt một câu. Nấc "sắp hết" ở 30 giây ngả sang hổ phách để mắt bắt được
   * mà không giật mình; nấc 10 giây mới sang đỏ. Cả hai đều KHÔNG nhấp nháy:
   * đây là một con số phải đọc được, và một cái đồng hồ chớp tắt trên nền tối
   * vừa chói vừa khó đọc hơn hẳn.
   */
  const danger = endsAt !== null && msLeft <= 10_000;
  const warning = endsAt !== null && !danger && msLeft <= 30_000;
  const ring = danger ? "stroke-blood-500" : warning ? "stroke-amber-400" : "stroke-mist/70";
  const label = endsAt === null ? "--:--" : fmt(msLeft);

  return (
    <div
      /*
       * role="timer" chứ không phải aria-live: một vùng live ở đây sẽ đọc lại
       * con số hai lần mỗi giây và nuốt mất mọi thông báo khác. Trình đọc màn
       * hình lấy được giá trị khi người dùng chủ động hỏi tới, còn thời điểm
       * đổi pha thì đã có thông báo riêng trong PhaseBanner.
       */
      role="timer"
      aria-label={
        endsAt === null ? "Pha này không có hạn giờ" : `Còn ${label} trước khi hết giờ`
      }
      title={endsAt === null ? "Pha này không có hạn giờ" : "Thời gian còn lại của pha"}
      className="relative h-14 w-14 shrink-0 lg:h-[68px] lg:w-[68px]"
    >
      <svg viewBox="0 0 52 52" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle
          cx="26"
          cy="26"
          r={RADIUS}
          fill="none"
          strokeWidth="3.5"
          className="stroke-white/10"
        />
        {endsAt !== null && (
          <circle
            cx="26"
            cy="26"
            r={RADIUS}
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
            className={ring}
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
        aria-hidden="true"
        className={`absolute inset-0 grid place-items-center font-mono text-[13px] font-bold tabular-nums lg:text-[15px] ${
          endsAt === null
            ? "text-mist/70"
            : danger
              ? "text-blood-400 timer-danger-pulse"
              : warning
                ? "text-amber-200"
                : "text-white"
        }`}
      >
        {label}
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
