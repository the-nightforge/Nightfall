"use client";

import { useMemo } from "react";
import { AnimatePresence, m } from "motion/react";
import { ROLE_META, type RoomSnapshot } from "@masoi/shared";
import { assignAvatars, tintFor } from "@/lib/avatar";
import { roleLabel } from "@/lib/cursed";
import { Avatar } from "./Avatar";

/**
 * Bảng theo dõi người chơi ở cột phụ.
 *
 * Cố ý KHÔNG phải PlayerGrid: bố cục hai cột làm lưới chọn mục tiêu nằm ở cột
 * nội dung, và đặt thêm một lưới y hệt ở cột phụ thì người chơi không biết cái
 * nào bấm được. Ở đây là danh sách dọc chỉ để đọc - ai còn sống, ai đang bị dồn
 * phiếu - còn mọi thao tác chọn người đều ở cột kia.
 */
export function RosterPanel({ snapshot }: { snapshot: RoomSnapshot }) {
  const meId = snapshot.you?.id ?? null;
  const roster = snapshot.players.map((p) => p.id).join(",");
  const avatars = useMemo(() => assignAvatars(roster ? roster.split(",") : []), [roster]);

  const alive = snapshot.players.filter((p) => p.alive).length;

  return (
    <section className="card p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-display text-base font-bold text-white">Người chơi</h3>
        <span className="text-xs text-mist/50">
          {alive}/{snapshot.players.length} còn sống
        </span>
      </div>

      <ul className="space-y-1">
        {snapshot.players.map((player) => {
          const votes = player.voteCount ?? 0;
          const isMe = player.id === meId;
          return (
            <li
              key={player.id}
              className={`flex items-center gap-2 rounded-lg px-1.5 py-1 ${
                isMe ? "bg-indigo-500/10 ring-1 ring-indigo-500/30" : ""
              }`}
            >
              <span className="relative shrink-0">
                <Avatar
                  avatar={avatars[player.id]}
                  tint={tintFor(player.id)}
                  alive={player.alive}
                  className="h-8 w-8"
                />
                {!player.alive && (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center">
                    <span className="h-[1.5px] w-6 rotate-45 rounded bg-blood-500/70" />
                  </span>
                )}
              </span>

              <span
                className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                  player.alive ? "text-white" : "text-mist/40 line-through"
                }`}
              >
                {player.name}
              </span>

              {player.role && (
                <span
                  className={`shrink-0 truncate rounded px-1 py-0.5 text-[9px] font-semibold ${
                    ROLE_META[player.role].team === "wolves"
                      ? "bg-blood-600/70 text-white"
                      : "bg-emerald-900/80 text-emerald-200"
                  }`}
                >
                  {roleLabel(player)}
                </span>
              )}
              {snapshot.hostId === player.id && (
                <span className="shrink-0 rounded bg-amber-800/70 px-1 py-0.5 text-[9px] font-semibold text-amber-100">
                  Chủ
                </span>
              )}

              {/* Số phiếu là thứ duy nhất ở đây thay đổi liên tục, nên nó có nhịp riêng. */}
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
            </li>
          );
        })}
      </ul>

      {snapshot.noEliminationVoteCount > 0 && (
        <p className="mt-2 border-t border-white/[0.06] pt-2 text-xs text-mist/60">
          Không treo ai:{" "}
          <b className="text-white">{snapshot.noEliminationVoteCount} phiếu</b>
        </p>
      )}
    </section>
  );
}
