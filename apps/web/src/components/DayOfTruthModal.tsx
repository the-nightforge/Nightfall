"use client";
import { ROLE_META } from "@masoi/shared";
import type { RoomSnapshot } from "@masoi/shared";

interface Props {
  snapshot: RoomSnapshot;
  onClaim: (role: string | null) => void;
}

export function DayOfTruthModal({ snapshot, onClaim }: Props) {
  if (snapshot.activeEvent?.id !== "DAY_OF_TRUTH") return null;
  const roles = ["WEREWOLF","SEER","GUARD","WITCH","HUNTER","VILLAGER","WOLF_CUB","DETECTIVE","MAYOR"];
  const myClaim = snapshot.dayOfTruthClaims?.[snapshot.you?.id ?? ""];
  const hasClaimed = myClaim !== undefined;
  const claimLabel = (claim: string | null | undefined) => {
    if (claim === null) return "Không tiết lộ";
    if (claim === undefined) return "Chưa claim";
    const meta = (ROLE_META as any)[claim];
    return meta?.name ?? claim;
  };
  return (
    <div className="card border-amber-500/30 bg-amber-950/20">
      <h4 className="font-bold text-amber-200">Ngày Sự Thật — Chọn vai bạn muốn nhận</h4>
      <p className="text-xs text-mist/85">Có thể nhận đúng hoặc bluff, hệ thống không xác thực.</p>
      {hasClaimed && (
        <p className="mt-1 text-xs text-emerald-300">Bạn đã nhận: <b>{claimLabel(myClaim)}</b> (có thể đổi lại)</p>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {roles.map((r) => {
          const label = (ROLE_META as any)[r]?.name ?? r;
          return (
            <button key={r} onClick={() => onClaim(r)} className={`rounded px-2 py-1 text-xs font-semibold transition ${myClaim===r ? "bg-amber-500 text-white" : "bg-white/10 text-white hover:bg-white/15"}`}>{label}</button>
          );
        })}
        <button onClick={() => onClaim(null)} className={`rounded border px-2 py-1 text-xs ${myClaim===null ? "border-amber-500 bg-amber-500/20 text-amber-200" : "border-white/20 text-mist/85 hover:bg-white/5"}`}>Không tiết lộ</button>
      </div>
    </div>
  );
}
