"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START, type RoomSnapshot } from "@masoi/shared";
import { assignAvatars, breathOffsetFor, tintFor } from "@/lib/avatar";
import { listItemMotion } from "@/lib/motion";
import { useModalFocus } from "@/lib/useModalFocus";
import { CharacterPortrait } from "./CharacterPortrait";

interface Props {
  snapshot: RoomSnapshot;
  isHost: boolean;
  onKick: (playerId: string) => void;
}

export function LobbyPlayerGrid({ snapshot, isHost, onKick }: Props) {
  const meId = snapshot.you?.id ?? null;
  const rosterKey = snapshot.players.map((player) => player.id).join(",");
  const avatars = useMemo(
    () => assignAvatars(rosterKey ? rosterKey.split(",") : []),
    [rosterKey],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const selected = snapshot.players.find((player) => player.id === selectedId) ?? null;
  const count = snapshot.players.length;
  const freeSeats = Math.max(0, MAX_PLAYERS_PER_ROOM - count);
  const requiredSlots = Math.max(0, MIN_PLAYERS_TO_START - count);
  const emptySlots = Math.min(freeSeats, Math.max(requiredSlots, freeSeats > 0 ? 1 : 0));

  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selected, selectedId]);

  useModalFocus({
    active: selected !== null,
    roots: [sheetRef, backdropRef],
    initialFocus: closeRef,
    onEscape: () => setSelectedId(null),
  });

  return (
    <section className="lobby-player-board">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="lobby-kicker">Dân làng đã đến</p>
          <h2 className="font-display text-2xl font-semibold text-white sm:text-[28px]">
            Người chơi
          </h2>
        </div>
        <div className="text-right">
          <strong className="font-display text-3xl font-semibold text-amber-100">{count}</strong>
          <span className="ml-1 text-base text-mist/70">/ {MAX_PLAYERS_PER_ROOM}</span>
        </div>
      </div>

      <ul className="lobby-player-grid mt-5">
        <AnimatePresence initial={false}>
        {snapshot.players.map((player, index) => {
          const isMe = player.id === meId;
          const isRoomHost = snapshot.hostId === player.id;
          const offline = !player.isBot && player.connected === false;
          const ready = isRoomHost || player.isBot || player.ready === true;
          const canManage = isHost && !isMe;
          const tile = (
            <>
              <span className="relative mx-auto block w-fit">
                <CharacterPortrait
                  avatar={player.avatarUrl ? player.avatarUrl : avatars[player.id]}
                  tint={tintFor(player.id)}
                  alive={player.alive}
                  breathOffset={breathOffsetFor(player.id)}
                  className={`lobby-player-avatar ${
                    isRoomHost ? "lobby-player-avatar-host" : ""
                  } ${offline ? "grayscale" : ""}`}
                  isCustom={!!player.avatarUrl}
                />
                {isRoomHost && <HostCrown />}
                {isMe && <span className="lobby-you-badge">Bạn</span>}
                <StatusMark ready={ready} offline={offline} />
              </span>
              <span className="mt-3 block min-w-0 truncate text-center text-sm font-bold text-white" title={player.name}>
                {player.name}
              </span>
              <span
                className={`mt-1 block truncate text-center text-xs font-semibold ${
                  offline
                    ? "text-amber-300"
                    : isRoomHost
                      ? "text-amber-200"
                      : ready
                        ? "text-emerald-300"
                        : "text-mist/70"
                }`}
              >
                {offline
                  ? "Mất kết nối"
                  : isRoomHost
                    ? "Chủ phòng"
                    : ready
                      ? "Sẵn sàng"
                      : "Chưa sẵn sàng"}
              </span>
            </>
          );

          return (
            <m.li
              key={player.id}
              {...listItemMotion(index, snapshot.players.length)}
              exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.16 } }}
              layout
            >
              {canManage ? (
                <button
                  type="button"
                  className="lobby-player-tile w-full"
                  aria-label={`Mở thao tác với ${player.name}`}
                  aria-haspopup="dialog"
                  onClick={() => setSelectedId(player.id)}
                >
                  {tile}
                </button>
              ) : (
                <div className={`lobby-player-tile ${isMe ? "lobby-player-tile-you" : ""}`}>
                  {tile}
                </div>
              )}
            </m.li>
          );
        })}

        {Array.from({ length: emptySlots }, (_, index) => (
          <li key={`empty-${index}`}>
            <div
              className="lobby-empty-tile"
              style={{ "--slot-index": index } as React.CSSProperties}
            >
              <span className="lobby-empty-avatar" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M12 3v18M3 12h18" />
                </svg>
              </span>
              <span className="mt-3 block text-center text-xs font-semibold leading-snug text-mist/65">
                Đang chờ...
              </span>
            </div>
          </li>
        ))}
        </AnimatePresence>
      </ul>

      {freeSeats > emptySlots && (
        <p className="mt-4 text-center text-[13px] text-mist/65">
          Và còn {freeSeats - emptySlots} vị trí trong làng
        </p>
      )}

      {selected && (
        <div className="lobby-sheet-layer" aria-hidden="false">
          <button
            ref={backdropRef}
            type="button"
            className="absolute inset-0 cursor-default bg-black/60"
            aria-label="Đóng bảng thao tác người chơi"
            onClick={() => setSelectedId(null)}
          />
          <div
            ref={sheetRef}
            className="lobby-player-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lobby-player-sheet-title"
            tabIndex={-1}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20 sm:hidden" />
            <div className="flex items-center gap-3">
              <CharacterPortrait
                avatar={selected.avatarUrl ? selected.avatarUrl : avatars[selected.id]}
                tint={tintFor(selected.id)}
                alive={selected.alive}
                breathOffset={breathOffsetFor(selected.id)}
                className="h-12 w-12"
                isCustom={!!selected.avatarUrl}
              />
              <div className="min-w-0 flex-1">
                <h3 id="lobby-player-sheet-title" className="truncate text-base font-bold text-white">
                  {selected.name}
                </h3>
                <p className="text-sm text-mist/70">
                  {selected.isBot
                    ? "Bot đang trực trong phòng"
                    : selected.connected === false
                      ? "Đang mất kết nối"
                      : "Đang ở trong phòng"}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="grid h-11 w-11 place-items-center rounded-full text-xl text-mist transition hover:bg-white/10 hover:text-white"
                aria-label="Đóng"
                onClick={() => setSelectedId(null)}
              >
                ×
              </button>
            </div>
            <button
              type="button"
              className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl border border-blood-500/35 bg-blood-600/15 px-4 font-bold text-blood-400 transition hover:bg-blood-600/25"
              onClick={() => {
                onKick(selected.id);
                setSelectedId(null);
              }}
            >
              Mời khỏi phòng
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function HostCrown() {
  return (
    <span className="lobby-host-crown" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="m4 8 4 3 4-6 4 6 4-3-1.5 10h-13L4 8Zm2.2 12h11.6" />
      </svg>
    </span>
  );
}

function StatusMark({ ready, offline }: { ready: boolean; offline: boolean }) {
  return (
    <span className={`lobby-status-mark ${offline ? "is-offline" : ready ? "is-ready" : ""}`} aria-hidden="true">
      {offline ? (
        <svg viewBox="0 0 24 24"><path d="M5 5l14 14M8.5 16A5 5 0 0 1 16 8.5M6 9a8 8 0 0 1 9-3M18 15a8 8 0 0 1-3 3M12 20h.01" /></svg>
      ) : ready ? (
        <svg viewBox="0 0 24 24"><path d="m6.5 12.5 3.5 3.5 7.5-8" /></svg>
      ) : (
        <span className="block h-1.5 w-1.5 rounded-full bg-current" />
      )}
    </span>
  );
}
