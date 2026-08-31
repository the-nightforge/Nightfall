"use client";

import { AnimatePresence, m } from "motion/react";
import type { Phase, RoomSnapshot } from "@masoi/shared";
import { moodFor } from "@/lib/mood";
import { Timer } from "./Timer";

interface PhaseMeta {
  label: string;
  /** Màu nhấn cho chấm và tên pha. Nền đã do Backdrop lo, ở đây chỉ cần một điểm nhấn. */
  accent: string;
  dot: string;
}

const PHASE_META: Record<Phase, PhaseMeta> = {
  LOBBY: { label: "Phòng chờ", accent: "text-mist", dot: "bg-mist/60" },
  ROLE_REVEAL: { label: "Xem vai trò", accent: "text-indigo-200", dot: "bg-indigo-400" },
  NIGHT: { label: "Ban đêm", accent: "text-indigo-200", dot: "bg-indigo-400" },
  NIGHT_RESULT: { label: "Trời sáng", accent: "text-amber-200", dot: "bg-amber-400" },
  DAY_DISCUSSION: { label: "Thảo luận", accent: "text-amber-100", dot: "bg-amber-300" },
  VOTING: { label: "Bỏ phiếu sơ bộ", accent: "text-blood-400", dot: "bg-blood-500" },
  DEFENSE: { label: "Biện hộ", accent: "text-amber-200", dot: "bg-amber-400" },
  FINAL_VOTE: { label: "Bỏ phiếu xác nhận", accent: "text-blood-400", dot: "bg-blood-500" },
  ELIMINATION: { label: "Công bố loại", accent: "text-blood-400", dot: "bg-blood-500" },
  HUNTER_SHOT: { label: "Thợ Săn phản kích", accent: "text-amber-200", dot: "bg-amber-400" },
  CHECK_WIN: { label: "Kiểm tra thắng", accent: "text-mist", dot: "bg-mist/60" },
  GAME_OVER: { label: "Kết thúc", accent: "text-emerald-300", dot: "bg-emerald-400" },
};

export function PhaseBanner({ snapshot }: { snapshot: RoomSnapshot }) {
  const meta = PHASE_META[snapshot.phase];
  // "Đêm thứ 2" đọc tự nhiên hơn "Ngày/Đêm thứ 2", và không khí đã biết đang là
  // ban đêm hay ban ngày nên không cần thêm bảng tra thứ hai.
  const unit = moodFor(snapshot.phase) === "night" ? "Đêm" : "Ngày";

  return (
    <div className="card flex items-center justify-between gap-3 py-3">
      {/*
        * Thông báo đổi pha cho trình đọc màn hình.
        *
        * Tên pha bên dưới đổi qua AnimatePresence: node cũ bị THÁO, node mới
        * được CHÈN. Với mắt đó là một chuyển cảnh; với trình đọc màn hình thì
        * không có gì xảy ra cả - một vùng vừa bị tháo khỏi DOM không thông báo
        * được gì. Vì vậy vùng này phải đứng yên và chỉ đổi chữ bên trong, chứ
        * không phải gắn aria-live thẳng lên <h2> trong AnimatePresence.
        *
        * Lớp phủ chuyển cảnh KHÔNG thay thế được chỗ này: nó tự tắt hẳn khi hệ
        * điều hành bật prefers-reduced-motion (xem `playbackMode`), nên đúng
        * nhóm người cần được nghe thông báo nhất lại là nhóm mất nó. Nó cũng
        * chỉ phủ một phần các cạnh chuyển pha.
        */}
      <p className="sr-only" aria-live="polite">
        {snapshot.round > 0 ? `${meta.label}, ${unit} thứ ${snapshot.round}` : meta.label}
      </p>

      {/* Tên pha là thứ đổi nghĩa cả màn hình, nên nó được một nhịp riêng. */}
      <AnimatePresence mode="wait" initial={false}>
        <m.div
          key={snapshot.phase}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 6, transition: { duration: 0.1 } }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="min-w-0"
        >
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot} animate-pulseSlow`} />
            <h2 className={`truncate font-display text-2xl font-bold leading-tight ${meta.accent}`}>
              {meta.label}
            </h2>
          </div>
          {snapshot.round > 0 && (
            <p className="mt-0.5 pl-3.5 text-xs uppercase tracking-[0.2em] text-mist/65">
              {unit} thứ {snapshot.round}
            </p>
          )}
        </m.div>
      </AnimatePresence>
      {/*
        * Không hạn giờ thì KHÔNG dựng đồng hồ. Bản cũ luôn vẽ vòng đếm rồi in
        * "--:--" vào giữa - trong phòng chờ nó trông y hệt một đồng hồ đã hỏng,
        * và người chơi đi hỏi bao giờ nó chạy.
        */}
      {snapshot.phaseEndsAt !== null && <Timer endsAt={snapshot.phaseEndsAt} />}
    </div>
  );
}
