"use client";
import type { RoomSnapshot } from "@masoi/shared";

interface Props {
  snapshot: RoomSnapshot;
  onClaim: (role: string | null) => void;
}

export function DayOfTruthModal({ snapshot, onClaim }: Props) {
  if (snapshot.activeEvent?.id !== "DAY_OF_TRUTH") return null;
  const roles = ["WEREWOLF","SEER","GUARD","WITCH","HUNTER","VILLAGER","WOLF_CUB","DETECTIVE","PRIEST","MAYOR"];
  return (
    <div className="card border-amber-500/30 bg-amber-950/20">
      <h4 className="font-bold text-amber-200">Ngày Sự Thật — Chọn role bạn muốn claim</h4>
      <p className="text-xs text-mist/60">Claim có thể đúng hoặc sai, hệ thống không xác thực.</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {roles.map((r) => (
          <button key={r} onClick={() => onClaim(r)} className="rounded bg-white/10 px-2 py-1 text-xs text-white hover:bg-white/15">{r}</button>
        ))}
        <button onClick={() => onClaim(null)} className="rounded border border-white/20 px-2 py-1 text-xs text-mist/70">Không tiết lộ</button>
      </div>
    </div>
  );
}
