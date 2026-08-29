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
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-mist/60">
        Đang bỏ phiếu · {openBallots.length} phiếu
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
              className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-night-800 px-2 py-1"
            >
              <Avatar avatar={avatars[b.voterId]} tint={tintFor(b.voterId)} alive className="h-5 w-5" />
              <span className="text-[11px] font-medium text-white">{voter?.name ?? "?"}</span>
              <span className="text-mist/30">→</span>
              {isNoElim ? (
                <span className="text-[11px] text-mist/60">🚫</span>
              ) : (
                <>
                  <Avatar avatar={avatars[targetId!]} tint={tintFor(targetId!)} alive className="h-5 w-5" />
                  <span className="text-[11px] text-mist/80">{target?.name ?? "?"}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
