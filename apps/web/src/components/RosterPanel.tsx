"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import {
  MAX_PLAYERS_PER_ROOM,
  MIN_PLAYERS_TO_START,
  ROLE_META,
  type RoomSnapshot,
} from "@masoi/shared";
import { assignAvatars, breathOffsetFor, tintFor } from "@/lib/avatar";
import { useSpeakers } from "@/components/VoiceProvider";
import { roleLabel } from "@/lib/cursed";
import { Avatar } from "./Avatar";
import { AvatarPicker } from "./AvatarPicker";

interface Props {
  snapshot: RoomSnapshot;
  /** Chỉ ở phòng chờ: trạng thái sẵn sàng, ô còn trống, và quyền loại người. */
  lobby?: { isHost: boolean; onKick: (playerId: string) => void };
  onUpdateAvatar?: (avatarUrl: string | null) => void;
}

/**
 * Cột người chơi.
 *
 * Cố ý KHÔNG phải PlayerGrid: lưới chọn mục tiêu nằm ở cột giữa, và đặt thêm
 * một lưới y hệt ở đây thì người chơi không biết cái nào bấm được. Ở đây là
 * danh sách dọc hẹp chỉ để theo dõi - ai còn sống, ai đang bị dồn phiếu - còn
 * mọi thao tác chọn người đều ở cột kia.
 *
 * Cột chỉ rộng 15rem nên mỗi người chiếm hai dòng: dòng trên dành trọn chỗ
 * trống cho cái tên, dòng dưới là các nhãn được phép xuống hàng. Nhồi nhãn vào
 * cùng dòng với tên thì tên bị bóp lại còn đúng một chữ cái.
 */
export function RosterPanel({ snapshot, lobby, onUpdateAvatar }: Props) {
  const speakers = useSpeakers();
  const meId = snapshot.you?.id ?? null;
  const roster = snapshot.players.map((p) => p.id).join(",");
  const avatars = useMemo(() => assignAvatars(roster ? roster.split(",") : []), [roster]);
  const [showPicker, setShowPicker] = useState(false);

  const count = snapshot.players.length;
  const alive = snapshot.players.filter((p) => p.alive).length;
  // Ô trống có đánh số cho thấy còn thiếu bao nhiêu người, thay vì một dòng chữ
  // "cần thêm 4 người" mà mắt phải đọc mới biết.
  const emptySlots = lobby ? Math.max(0, MIN_PLAYERS_TO_START - count) : 0;

  return (
    <section className="card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-bold text-white">Người chơi</h3>
        {/* Đếm theo sức chứa phòng: "15/6" đọc như phòng đang quá tải. */}
        <span className="shrink-0 text-xs text-mist/50">
          {lobby ? `${count}/${MAX_PLAYERS_PER_ROOM}` : `${alive}/${count} sống`}
        </span>
      </div>

      <ul className="space-y-1">
        {snapshot.players.map((player) => {
          const votes = player.voteCount ?? 0;
          const isMe = player.id === meId;
          const isRoomHost = snapshot.hostId === player.id;
          // Bot vốn không có kết nối, nên connected=false của nó không phải sự cố.
          const offline = !player.isBot && player.connected === false;
          const hasTags = isRoomHost || player.isBot || !!player.role || offline;
          // Identity của LiveKit chính là playerId nên đối chiếu thẳng.
          const speaking = speakers.has(player.id);
          return (
            <li
              key={player.id}
              className={`group rounded-lg px-1.5 py-1 transition ${
                speaking
                  ? "bg-emerald-400/10 ring-1 ring-emerald-400/60"
                  : isMe
                    ? "bg-indigo-500/10 ring-1 ring-indigo-500/30"
                    : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="relative shrink-0">
                  <Avatar
                    avatar={player.avatarUrl ? player.avatarUrl : avatars[player.id]}
                    tint={tintFor(player.id)}
                    alive={player.alive}
                    breathOffset={breathOffsetFor(player.id)}
                    className="h-7 w-7 sm:h-8 sm:w-8"
                    isCustom={!!player.avatarUrl}
                  />
                  {!player.alive && (
                    <span className="pointer-events-none absolute inset-0 grid place-items-center">
                      <span className="h-[1.5px] w-6 rotate-45 rounded bg-blood-500/70" />
                    </span>
                  )}
                </span>

                <span
                  className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                    player.alive ? "text-white" : "text-mist/60 line-through"
                  }`}
                  title={player.name}
                >
                  {player.name}
                </span>

                {lobby ? (
                  !offline && <ReadyDot ready={player.isBot || (player.ready ?? false)} />
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
                    className="inline-flex shrink-0 items-center gap-0.5 rounded bg-blood-600/15 px-1.5 py-0.5 text-[10px] font-bold text-blood-400 hover:bg-blood-600/25"
                    aria-label={`Kick ${player.name}`}
                    onClick={() => lobby.onKick(player.id)}
                  >
                    <span aria-hidden="true">✕</span> Kick
                  </button>
                )}
              </div>

              {hasTags && (
                <div className="ml-9 mt-0.5 flex flex-wrap items-center gap-1 sm:ml-10">
                  {isRoomHost && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold text-amber-300">
                      <span aria-hidden="true">👑</span> Chủ phòng
                    </span>
                  )}
                  {player.isBot && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-slate-700/60 px-1 py-0.5 text-[9px] font-bold text-slate-200">
                      <span aria-hidden="true">🤖</span> Bot
                    </span>
                  )}
                  {player.role && (
                    <span
                      className={`max-w-full truncate rounded px-1 py-0.5 text-[9px] font-semibold ${
                        ROLE_META[player.role].team === "wolves"
                          ? "bg-blood-600/70 text-white"
                          : "bg-emerald-900/80 text-emerald-200"
                      }`}
                    >
                      {roleLabel(player)}
                    </span>
                  )}
                  {offline && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1 py-0.5 text-[9px] font-bold text-amber-300 ring-1 ring-amber-500/30">
                      <span aria-hidden="true">📴</span> Mất kết nối
                    </span>
                  )}
                </div>
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

      {onUpdateAvatar && snapshot.you && (
        <div className="mt-3 border-t border-white/[0.06] pt-3">
          <button
            type="button"
            className="w-full rounded-lg bg-white/5 px-3 py-1.5 text-xs font-semibold text-mist/80 hover:bg-white/10 hover:text-white"
            onClick={() => setShowPicker((v) => !v)}
          >
            {showPicker ? "Đóng" : "📷 Đổi ảnh đại diện"}
          </button>
          {showPicker && (
            <div className="mt-2">
              <AvatarPicker
                currentUrl={(snapshot.you as any)?.avatarUrl ?? null}
                onSave={(url) => {
                  onUpdateAvatar(url);
                  setShowPicker(false);
                }}
              />
            </div>
          )}
        </div>
      )}

      {snapshot.noEliminationVoteCount > 0 && (
        <p className="mt-2 border-t border-white/[0.06] pt-2 text-xs text-mist/60">
          Không treo ai: <b className="text-white">{snapshot.noEliminationVoteCount}</b>
        </p>
      )}
    </section>
  );
}

function ReadyDot({ ready }: { ready: boolean }) {
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
        ready ? "bg-emerald-600 text-white" : "bg-white/10 text-mist/60 ring-1 ring-white/10"
      }`}
      aria-label={ready ? "Sẵn sàng" : "Chưa sẵn sàng"}
      title={ready ? "Sẵn sàng" : "Chưa sẵn sàng"}
    >
      {ready ? "✓" : "○"}
    </span>
  );
}
