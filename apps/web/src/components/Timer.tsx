"use client";

import { useEffect, useState } from "react";
import { serverNow } from "@/lib/clock";

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
    const t = setInterval(() => setNow(serverNow()), 500);
    return () => clearInterval(t);
  }, []);

  if (!endsAt) return <span className="font-mono text-lg">--:--</span>;
  const msLeft = endsAt - now;
  const danger = msLeft <= 10_000;
  return (
    <span className={`font-mono text-lg font-bold ${danger ? "text-blood-400 animate-pulse" : "text-white"}`}>
      {fmt(msLeft)}
    </span>
  );
}
