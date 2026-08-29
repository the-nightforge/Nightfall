"use client";

import { useMemo } from "react";
import { AnimatePresence, m } from "motion/react";
import { MIN_PLAYERS_TO_START, ROLE_META, type RoomSnapshot } from "@masoi/shared";
import { assignAvatars, breathOffsetFor, tintFor } from "@/lib/avatar";
import { roleLabel } from "@/lib/cursed";
import { Avatar } from "./Avatar";

interface Props {
  snapshot: RoomSnapshot;
  /** Chỉ ở phòng chờ: trạng thái sẵn sàng, ô còn trống, và quyền loại người. */
  lobby?: { isHost: boolean; onKick: (playerId: string) => void };
}

/**
 * Cột người chơi.
 *
 * Cố ý KHÔNG phải PlayerGrid: lưới chọn mục tiêu nằm ở cột giữa, và đặt thêm
 * một lưới y hệt ở đây thì người chơi không biết cái nào bấm được. Ở đây là
 * danh sách dọc hẹp chỉ để theo dõi - ai còn sống, ai đang bị dồn phiếu - còn
 * mọi thao tác chọn người đều ở cột kia.
 */
export function RosterPanel({ snapshot, lobby }: Props) {
  const meId = snapshot.you?.id ?? null;
  const roster = snapshot.players.map((p) => p.id).join(",");
  const avatars = useMemo(() => assignAvatars(roster ? roster.split(",") : []), [roster]);

  const count = snapshot.players.length;
  const alive = snapshot.players.filter((p) => p.alive).length;
  // Ô trống có đánh số cho thấy còn thiếu bao nhiêu người, thay vì một dòng chữ
  // "cần thêm 4 người" mà mắt phải đọc mới biết.
  const emptySlots = lobby ? Math.max(0, MIN_PLAYERS_TO_START - count) : 0;

  return (
    <section className="card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-bold text-white">Người chơi</h3>
        <span className="shrink-0 text-xs text-mist/50">
          {lobby ? `${count}/${MIN_PLAYERS_TO_START}` : `${alive}/${count} sống`}
        </span>
      </div>

      <ul className="space-y-1">
        {snapshot.players.map((player) => {
          const votes = player.voteCount ?? 0;
          const isMe = player.id === meId;
          return (
            <li
              key={player.id}
              className={`group flex items-center gap-2 rounded-lg px-1.5 py-1 ${
                isMe ? "bg-indigo-500/10 ring-1 ring-indigo-500/30" : ""
              }`}
            >
              <span className="relative shrink-0">
                <Avatar
                  avatar={avatars[player.id]}
                  tint={tintFor(player.id)}
                  alive={player.alive}
                  breathOffset={breathOffsetFor(player.id)}
                  className="h-7 w-7 sm:h-8 sm:w-8"
                />
                {!player.alive && (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center">
                    <span className="h-[1.5px] w-6 rotate-45 rounded bg-blood-500/70" />
                  </span>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span
                    className={`block truncate text-sm font-semibold ${
                      player.alive ? "text-white" : "text-mist/60 line-through"
                    }`}
                  >
                    {player.name}
                  </span>
                  <span className="flex items-center gap-1">
                    {snapshot.hostId === player.id && (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-amber-300/90">
                        Chủ phòng
                      </span>
                    )}
                    {player.isBot && (
                      <span className="text-[9px] font-bold uppercase tracking-wide text-mist/60">
                        Bot
                      </span>
                    )}
                  {player.role && (
                    <span
                      className={`truncate rounded px-1 text-[9px] font-semibold ${
                        ROLE_META[player.role].team === "wolves"
                          ? "bg-blood-600/70 text-white"
                          : "bg-emerald-900/80 text-emerald-200"
                      }`}
                    >
                      {roleLabel(player)}
                    </span>
                  )}
                </span>
              </span>

              {lobby ? (
                <LobbyStatus
                  ready={player.isBot || (player.ready ?? false)}
                  offline={player.connected === false}
                />
              ) : (
                <AnimatePresence>
                  {votes > 0 && (
                    <m.span
                      key="votes"
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.12 } }}
                      transition={{ type: "spring", stiffness: 600, damping: 22 }}
                      className="grid h-5 min-w-[20px] shrink-0 place-items-center rounded-full bg-blood-600 px-1 text-[11px] font-bold text-white"
                    >
                      {votes}
                    </m.span>
                  )}
                </AnimatePresence>
              )}

              {lobby?.isHost && player.id !== meId && (
                <button
                  className="shrink-0 rounded px-1 text-xs text-mist/30 hover:bg-blood-600/20 hover:text-blood-400"
                  title={`Loại ${player.name}`}
                  onClick={() => lobby.onKick(player.id)}
                >
                  ✕
                </button>
              )}
            </li>
          );
        })}

        {Array.from({ length: emptySlots }, (_, i) => (
          <li
            key={`empty-${i}`}
            className="flex items-center gap-2 rounded-lg border border-dashed border-night-600/60 px-1.5 py-1"
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-night-800/60 text-xs font-bold text-mist/30 sm:h-8 sm:w-8">
              {count + i + 1}
            </span>
            <span className="text-sm text-mist/30">Đang chờ...</span>
          </li>
        ))}
      </ul>

      {snapshot.noEliminationVoteCount > 0 && (
        <p className="mt-2 border-t border-white/[0.06] pt-2 text-xs text-mist/60">
          Không treo ai: <b className="text-white">{snapshot.noEliminationVoteCount}</b>
        </p>
      )}
    </section>
  );
}

function LobbyStatus({ ready, offline }: { ready: boolean; offline: boolean }) {
  if (offline) {
    return <span className="shrink-0 text-[10px] font-semibold text-blood-400">Mất kết nối</span>;
  }
  return (
    <span
      className={`shrink-0 text-[10px] font-semibold ${ready ? "text-emerald-300" : "text-mist/60"}`}
    >
      {ready ? "Sẵn sàng" : "Chưa"}
    </span>
  );
}
