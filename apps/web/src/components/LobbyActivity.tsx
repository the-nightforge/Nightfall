"use client";

import { useEffect, useRef, useState } from "react";
import { MIN_PLAYERS_TO_START, type RoomSnapshot } from "@masoi/shared";
import {
  captureLobbyPresence,
  deriveLobbyActivity,
  lobbyWaitingLine,
  type LobbyPresence,
} from "@/lib/lobby-activity";

export function LobbyActivity({ snapshot }: { snapshot: RoomSnapshot }) {
  const previous = useRef<LobbyPresence>(captureLobbyPresence(snapshot));
  const [activity, setActivity] = useState<string[]>([]);
  const unreadyCount = snapshot.players.filter(
    (player) => !player.isBot && player.id !== snapshot.hostId && !player.ready,
  ).length;
  const waiting = lobbyWaitingLine({
    playerCount: snapshot.players.length,
    minimumPlayers: MIN_PLAYERS_TO_START,
    unreadyCount,
  });

  useEffect(() => {
    const next = captureLobbyPresence(snapshot);
    const fresh = deriveLobbyActivity(previous.current, next);
    previous.current = next;
    if (fresh.length > 0) setActivity((current) => [...fresh, ...current].slice(0, 3));
  }, [snapshot]);

  return (
    <section className="lobby-activity" aria-label="Diễn biến phòng chờ">
      <div className="flex items-start gap-3">
        <span className="lobby-moon-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-mist-bright">{waiting}</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-mist/80">
            {activity[0] ?? "Trăng đang lên sau rặng cây. Hãy gọi những dân làng còn lại."}
          </p>
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {activity[0] ?? waiting}
      </span>
    </section>
  );
}

