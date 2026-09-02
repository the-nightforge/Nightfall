"use client";

import type { RoomSnapshot } from "@masoi/shared";
import { assignAvatars, tintFor } from "@/lib/avatar";
import { Avatar } from "./Avatar";
import { useMemo } from "react";

export function OpenVotePanel({ snapshot }: { snapshot: RoomSnapshot }) {
  const openBallots = snapshot.openBallots ?? [];
  if (openBallots.length === 0) return null;
  const playerMap = useMemo(() => new Map(snapshot.players.map((p) => [p.id, p])), [snapshot.players]);
  const avatars = useMemo(() => assignAvatars(snapshot.players.map((p) => p.id)), [snapshot.players]);

  return (
    <div className="mt-3 border-t border-white/[0.08] pt-3">
      {/* Con số "đã bỏ bao nhiêu trên bao nhiêu" nằm cạnh đồng hồ ở thanh pha;
        * ở đây chỉ còn việc nó vốn sinh ra để làm - ai đang bỏ cho ai. */}
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-mist-strong">
        Ai đang bỏ phiếu cho ai
      </p>
      <div className="flex flex-wrap gap-1.5">
        {openBallots.map((b) => {
          const voter = playerMap.get(b.voterId);
          const isNoElim = b.choice.type === "NO_ELIMINATION";
          const targetId = b.choice.type === "PLAYER" ? b.choice.targetId : null;
          const target = targetId ? playerMap.get(targetId) : null;
          return (
            <div
              key={b.voterId}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-night-800 px-2 py-1"
            >
              <Avatar avatar={avatars[b.voterId]} tint={tintFor(b.voterId)} alive className="h-6 w-6" />
              <span className="text-[13px] font-semibold text-white">{voter?.name ?? "?"}</span>
              <span aria-hidden="true" className="text-mist-strong">→</span>
              {isNoElim ? (
                <span className="text-[13px] text-mist-strong" title="Không treo ai">
                  <span aria-hidden="true">🚫</span>
                  <span className="sr-only">Không treo ai</span>
                </span>
              ) : (
                <>
                  <Avatar avatar={avatars[targetId!]} tint={tintFor(targetId!)} alive className="h-6 w-6" />
                  <span className="text-[13px] text-mist-bright">{target?.name ?? "?"}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
