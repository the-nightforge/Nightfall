"use client";

import type { RoomSnapshot } from "@masoi/shared";
import { Timer } from "./Timer";

const PHASE_LABEL: Record<string, { label: string; cls: string }> = {
  LOBBY: { label: "Phòng chờ", cls: "bg-night-700 text-mist" },
  ROLE_REVEAL: { label: "Xem vai trò", cls: "bg-indigo-900 text-indigo-200" },
  NIGHT: { label: "Ban đêm", cls: "bg-night-800 text-indigo-300 border border-indigo-500/40" },
  NIGHT_RESULT: { label: "Kết quả đêm", cls: "bg-night-800 text-mist" },
  DAY_DISCUSSION: { label: "Thảo luận", cls: "bg-amber-900/60 text-amber-200" },
  VOTING: {
    label: "Bỏ phiếu sơ bộ",
    cls: "bg-blood-600/40 text-blood-400 border border-blood-500/40",
  },
  DEFENSE: { label: "Biện hộ", cls: "bg-amber-900/60 text-amber-200 border border-amber-500/40" },
  FINAL_VOTE: {
    label: "Bỏ phiếu xác nhận",
    cls: "bg-blood-600/40 text-blood-400 border border-blood-500/40",
  },
  ELIMINATION: { label: "Công bố loại", cls: "bg-blood-600/40 text-blood-400" },
  HUNTER_SHOT: { label: "Thợ Săn phản kích", cls: "bg-amber-900 text-amber-200" },
  CHECK_WIN: { label: "Kiểm tra thắng", cls: "bg-night-700 text-mist" },
  GAME_OVER: { label: "Kết thúc", cls: "bg-emerald-900/50 text-emerald-300" },
};

export function PhaseBanner({ snapshot }: { snapshot: RoomSnapshot }) {
  const meta = PHASE_LABEL[snapshot.phase] ?? PHASE_LABEL.LOBBY;
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-night-600/60 bg-night-900/80 px-4 py-3">
      <div>
        <span className={`badge-phase ${meta.cls}`}>{meta.label}</span>
        {snapshot.round > 0 && (
          <span className="ml-2 text-sm text-mist/70">Ngày/Đêm thứ {snapshot.round}</span>
        )}
      </div>
      <Timer endsAt={snapshot.phaseEndsAt} />
    </div>
  );
}
