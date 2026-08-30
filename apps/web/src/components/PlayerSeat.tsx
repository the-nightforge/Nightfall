"use client";

import { AnimatePresence, m } from "motion/react";
import { ROLE_META, type PlayerView } from "@masoi/shared";
import { roleLabel } from "@/lib/cursed";
import { breathOffsetFor } from "@/lib/avatar";
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
  /** Lớp phiếu bay cần đo vị trí ô này để biết bay tới đâu. */
  seatRef?: (el: HTMLButtonElement | null) => void;
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
  seatRef,
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
    <m.button
      ref={seatRef}
      type="button"
      disabled={disabled}
      onClick={onSelect}
      initial={false}
      animate={{ rotate: dead ? -6 : 0, y: dead ? 5 : 0, scale: dead ? 0.97 : 1 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={{ type: "spring", stiffness: 260, damping: 17 }}
      className={`relative flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border p-2 transition-colors
        ${frame}
        ${!disabled ? "cursor-pointer hover:border-blood-500/80" : "cursor-default"}`}
    >
      <AnimatePresence>
        {votes > 0 && (
          <m.span
            key="votes"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 600, damping: 22 }}
            className="absolute right-0 top-0 grid h-5 min-w-[20px] translate-x-1/3 -translate-y-1/3 place-items-center rounded-full bg-blood-600 px-1 text-[11px] font-bold text-white shadow shadow-black/50 motion-reduce:transition-none"
            aria-label={`${votes} phiếu`}
            role="status"
          >
            {votes}
          </m.span>
        )}
      </AnimatePresence>

      <span className="relative">
        <Avatar
          avatar={player.avatarUrl ? player.avatarUrl : avatar}
          tint={tint}
          alive={player.alive}
          breathOffset={breathOffsetFor(player.id)}
          className="h-16 w-16 sm:h-20 sm:w-20"
          isCustom={!!player.avatarUrl}
        />
        {dead && (
          // Gạch chéo vắt qua chân dung: chỉ làm mờ thì ở lưới 3 cột trên điện
          // thoại rất dễ nhìn nhầm thành ô chưa tải xong.
          <span className="pointer-events-none absolute inset-0 grid place-items-center">
            {/* Vạch kẻ từ trái sang, hơi trễ hơn cú đổ để đọc ra thành hai
              * nhịp: ô đổ xuống trước, dấu gạch đóng lại sau.
              *
              * initial phải khai tường minh: nút cha đặt initial={false} và
              * MotionContext truyền cờ đó xuống mọi con, kể cả con mới gắn vào
              * sau - thiếu dòng này thì vạch kẻ hiện phắt ra, không kẻ. */}
            <m.span
              className="h-[1.5px] w-10 origin-left rotate-45 rounded bg-blood-500/70"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.24, delay: 0.12, ease: "easeOut" }}
            />
          </span>
        )}
      </span>

      <span
        className={`w-full truncate text-center text-[11px] font-semibold leading-tight ${
          dead ? "text-mist/60 line-through" : "text-white"
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
    </m.button>
  );
}

function Tag({ children, cls }: { children: React.ReactNode; cls: string }) {
  return (
    <span className={`rounded px-1 py-[1px] text-[10px] font-semibold leading-tight ${cls}`}>
      {children}
    </span>
  );
}
