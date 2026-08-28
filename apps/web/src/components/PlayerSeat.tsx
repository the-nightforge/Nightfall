"use client";

import { ROLE_META, type PlayerView } from "@masoi/shared";
import { roleLabel } from "@/lib/cursed";
import type { AvatarId } from "@/lib/avatar-art";
import { Avatar } from "./Avatar";

interface Props {
  player: PlayerView;
  avatar: AvatarId;
  tint: string;
  isMe: boolean;
  isHost: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect?: () => void;
}

/**
 * Một ô người chơi trong lưới.
 *
 * Màu viền chỉ nói MỘT chuyện tại một thời điểm, theo thứ tự ưu tiên: đang chọn
 * > đã chết > là mình > bình thường. Chồng nhiều màu lên cùng một ô thì không
 * màu nào còn nghĩa.
 */
export function PlayerSeat({
  player,
  avatar,
  tint,
  isMe,
  isHost,
  selected,
  disabled,
  onSelect,
}: Props) {
  const dead = !player.alive;
  const votes = player.voteCount ?? 0;

  const frame = selected
    ? "border-blood-500 bg-blood-600/15 ring-1 ring-blood-500"
    : dead
      ? "border-night-700/70 bg-night-950/60"
      : isMe
        ? "border-indigo-500/50 bg-night-800/60"
        : "border-night-600/70 bg-night-800/40";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={`relative flex flex-col items-center gap-1.5 rounded-xl border px-1.5 pb-2 pt-2.5 transition
        ${frame}
        ${!disabled ? "cursor-pointer hover:border-blood-500/80 active:scale-[0.97]" : "cursor-default"}`}
    >
      {votes > 0 && (
        <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-blood-600 px-1 text-[11px] font-bold text-white shadow shadow-black/50">
          {votes}
        </span>
      )}

      <span className="relative">
        <Avatar avatar={avatar} tint={tint} alive={player.alive} className="h-12 w-12" />
        {dead && (
          // Gạch chéo vắt qua chân dung: chỉ làm mờ thì ở lưới 3 cột trên điện
          // thoại rất dễ nhìn nhầm thành ô chưa tải xong.
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            <span className="h-[1.5px] w-10 rotate-45 rounded bg-blood-500/70" />
          </span>
        )}
      </span>

      <span
        className={`w-full truncate text-center text-[11px] font-semibold leading-tight ${
          dead ? "text-mist/40 line-through" : "text-white"
        }`}
      >
        {player.name}
      </span>

      <span className="flex flex-wrap items-center justify-center gap-1">
        {isMe && <Tag cls="bg-indigo-800/80 text-indigo-100">Bạn</Tag>}
        {isHost && <Tag cls="bg-amber-800/70 text-amber-100">Chủ</Tag>}
        {player.isBot && <Tag cls="bg-slate-700/80 text-slate-200">Bot</Tag>}
        {player.role && (
          <Tag
            cls={
              ROLE_META[player.role].team === "wolves"
                ? "bg-blood-600/80 text-white"
                : "bg-emerald-900/80 text-emerald-200"
            }
          >
            {roleLabel(player)}
          </Tag>
        )}
      </span>
    </button>
  );
}

function Tag({ children, cls }: { children: React.ReactNode; cls: string }) {
  return (
    <span className={`rounded px-1 py-[1px] text-[9px] font-semibold leading-tight ${cls}`}>
      {children}
    </span>
  );
}
