"use client";

import type { RoomSnapshot } from "@masoi/shared";
import { eventIcon } from "@/lib/event-art";

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
      {/*
        * Chỉ NHẮC là có sự kiện, không chép lại nó.
        *
        * Bản cũ in đủ tên, mô tả và thông báo ở đây trong khi EventBanner cách
        * đó 300px đang in y hệt - người chơi đọc hai lần cùng một đoạn chữ rồi
        * đi tìm xem hai bên có khác nhau chỗ nào không. Toàn văn nằm ở thẻ sự
        * kiện, bấm vào là bung ra.
        */}
      {hasEvent && snapshot.activeEvent && (
        <div className="border-b border-white/[0.06] px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-400/80">Sự kiện</p>
          <p className="truncate text-xs font-semibold text-amber-200">
            <span className="mr-1" aria-hidden="true">{eventIcon(snapshot.activeEvent.id)}</span>
            {snapshot.activeEvent.name}
          </p>
          <p className="text-[11px] leading-snug text-mist/70">{beneficiaryLabel(snapshot.activeEvent.beneficiary)}</p>
        </div>
      )}
      {hasNight && (
        <div className="border-b border-white/[0.06] px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-widest text-mist/65">Đêm vừa rồi</p>
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
          <p className="text-[11px] font-bold uppercase tracking-widest text-mist/65">Phiếu hiện tại</p>
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

/** Ai được lợi, gọn trong một dòng. Chi tiết vì sao thì ở thẻ sự kiện. */
function beneficiaryLabel(beneficiary: "wolves" | "village" | "neutral"): string {
  if (beneficiary === "wolves") return "Có lợi cho phe Sói";
  if (beneficiary === "village") return "Có lợi cho phe Dân";
  return "Không nghiêng về phe nào";
}
