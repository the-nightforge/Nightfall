"use client";
import type { RoomSnapshot } from "@masoi/shared";

interface Props {
  snapshot: RoomSnapshot;
  onClaim: (role: string | null) => void;
}

export function DayOfTruthModal({ snapshot, onClaim }: Props) {
  if (snapshot.activeEvent?.id !== "DAY_OF_TRUTH") return null;
  const roles = ["WEREWOLF","SEER","GUARD","WITCH","HUNTER","VILLAGER","WOLF_CUB","DETECTIVE","PRIEST","MAYOR"];
  const myClaim = snapshot.dayOfTruthClaims?.[snapshot.you?.id ?? ""];
  const hasClaimed = myClaim !== undefined;
  return (
    <div className="card border-amber-500/30 bg-amber-950/20">
      <h4 className="font-bold text-amber-200">Ngày Sự Thật — Chọn role bạn muốn claim</h4>
      <p className="text-xs text-mist/60">Claim có thể đúng hoặc sai, hệ thống không xác thực.</p>
      {hasClaimed && (
        <p className="mt-1 text-xs text-emerald-300">Bạn đã claim: <b>{myClaim ?? "Không tiết lộ"}</b> (có thể đổi lại)</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {roles.map((r) => (
          <button key={r} onClick={() => onClaim(r)} className={`rounded px-2 py-1 text-xs font-semibold transition ${myClaim===r ? "bg-amber-500 text-white" : "bg-white/10 text-white hover:bg-white/15"}`}>{r}</button>
        ))}
        <button onClick={() => onClaim(null)} className={`rounded border px-2 py-1 text-xs ${myClaim===null ? "border-amber-500 bg-amber-500/20 text-amber-200" : "border-white/20 text-mist/70 hover:bg-white/5"}`}>Không tiết lộ</button>
      </div>
    </div>
  );
}
