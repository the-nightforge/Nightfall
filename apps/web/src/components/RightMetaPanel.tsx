"use client";

import type { RoomSnapshot } from "@masoi/shared";

interface Props {
  snapshot: RoomSnapshot | null;
}

export function RightMetaPanel({ snapshot }: Props) {
  if (!snapshot || snapshot.phase === "LOBBY" || snapshot.phase === "GAME_OVER") return null;

  const hasEvent = !!snapshot.activeEvent;
  const hasNight = snapshot.lastNightDeaths.length > 0 || snapshot.phase === "NIGHT_RESULT" || snapshot.phase === "DAY_DISCUSSION";
  const isVoting = snapshot.phase === "VOTING" || snapshot.phase === "DEFENSE" || snapshot.phase === "FINAL_VOTE";

  if (!hasEvent && !hasNight && !isVoting) return null;

  return (
    <div className="hidden lg:block rounded-xl border border-night-600/50 bg-night-900/60 backdrop-blur">
      {hasEvent && snapshot.activeEvent && (
        <div className="border-b border-white/[0.06] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400/80">Sự kiện</p>
          <p className="truncate text-xs font-semibold text-amber-200">
            <span className="mr-1">{eventIcon(snapshot.activeEvent.id)}</span>
            {snapshot.activeEvent.name}
          </p>
          <p className="line-clamp-2 text-[11px] leading-snug text-mist/60">{snapshot.activeEvent.description}</p>
          {snapshot.activeEvent.announcement && (
            <p className="mt-1 rounded bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-100">
              {snapshot.activeEvent.announcement}
            </p>
          )}
        </div>
      )}
      {hasNight && (
        <div className="border-b border-white/[0.06] px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-mist/50">Đêm vừa rồi</p>
          {snapshot.lastNightDeaths.length > 0 ? (
            <p className="text-xs font-semibold text-blood-400">
              {snapshot.lastNightDeaths.map((d) => d.name).join(" · ")}{" "}
              <span className="font-normal text-mist/60">đã mất</span>
            </p>
          ) : (
            <p className="text-xs font-semibold text-emerald-300">Không ai chết</p>
          )}
          {snapshot.lastEliminated && (
            <p className="mt-1 text-[11px] text-mist/60">
              Treo cổ: <b className="text-white">{snapshot.lastEliminated.name}</b>
            </p>
          )}
        </div>
      )}
      {isVoting && (
        <div className="px-3 py-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-mist/50">Phiếu hiện tại</p>
          <p className="text-xs text-mist/80">
            {snapshot.phase === "VOTING" && <>Đang đề cử · {snapshot.openBallots?.length ?? 0} phiếu</>}
            {snapshot.phase === "DEFENSE" && snapshot.trial && <>Bị cáo: <b className="text-white">{snapshot.trial.accusedName}</b></>}
            {snapshot.phase === "FINAL_VOTE" && snapshot.trial && (
              <>Treo {snapshot.trial.guiltyVotes} · Tha {snapshot.trial.innocentVotes} · cần {snapshot.trial.guiltyRequired}</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}

function eventIcon(id: string): string {
  const map: Record<string, string> = {
    CURFEW: "⏳",
    SILENT_NIGHT: "🤫",
    AMNESTY_DAY: "🕊️",
    CLEARING_MIST: "🌫️",
    PEACEFUL_NIGHT: "✨",
    JUDGMENT_DAY: "⚖️",
    LAST_STAND: "🛡️",
    DAY_OF_TRUTH: "🔍",
    MOONLESS_NIGHT: "🌑",
    BLOODY_HUNT: "🩸",
    HOWL_OF_THE_PACK: "🐺",
    BLOOD_MOON: "🌕",
    WOLF_SHADOW: "👤",
    MORNING_REPORT: "📰",
    DEAD_CAN_SPEAK: "👻",
  };
  return map[id] ?? "⚡";
}
