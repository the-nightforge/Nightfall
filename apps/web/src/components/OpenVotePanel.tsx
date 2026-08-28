"use client";

import type { RoomSnapshot } from "@masoi/shared";
import { formatOpenBallots } from "@/lib/vote-history";

/**
 * Ai đang bỏ phiếu cho ai, ngay trong lúc còn cãi được.
 *
 * Vòng đề cử là vòng tranh luận, và hành vi bỏ phiếu là bằng chứng chính của
 * thể loại này: ai châm ngòi, ai hùa theo, ai rút phiếu khi gió đổi. Giấu tới
 * recap thì thông tin vẫn lộ, chỉ là lộ sau khi nó hết tác dụng.
 *
 * Không render gì khi chưa ai bỏ phiếu: một khung rỗng chỉ chiếm chỗ trên điện
 * thoại, mà đây là chỗ ngay dưới lưới ghế.
 */
export function OpenVotePanel({ snapshot }: { snapshot: RoomSnapshot }) {
  const names = new Map(snapshot.players.map((player) => [player.id, player.name]));
  const lines = formatOpenBallots(snapshot.openBallots, names);
  if (lines.length === 0) return null;

  return (
    <div className="mt-3 border-t border-white/[0.08] pt-3">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-mist/60">
        Ai đang bỏ phiếu cho ai
      </p>
      <ol className="mt-1.5 space-y-1 text-sm text-mist/80">
        {lines.map((line, index) => (
          <li key={`${index}:${line}`}>{line}</li>
        ))}
      </ol>
    </div>
  );
}
