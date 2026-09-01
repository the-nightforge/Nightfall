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
  /** Vì sao ô này không bấm được; null khi cả lưới vốn chỉ để xem. */
  disabledReason?: string | null;
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
  disabledReason,
  onSelect,
  seatRef,
}: Props) {
  const dead = !player.alive;
  const votes = player.voteCount ?? 0;

  const frame = selected
    ? "border-blood-500 bg-blood-600/20 ring-2 ring-blood-500"
    : dead
      ? "border-night-600/60 bg-night-950/70"
      : isMe
        ? // Ô của chính mình phải nhận ra được từ đầu kia bàn: viền đặc cộng
          // một vòng trong, chứ không phải một sắc chàm nhạt hơn viền thường
          // đúng một nấc.
          "border-indigo-400 bg-indigo-500/10 ring-1 ring-indigo-400/50"
        : "border-night-600/70 bg-night-800/40";

  return (
    <m.button
      ref={seatRef}
      type="button"
      disabled={disabled}
      onClick={onSelect}
      aria-pressed={onSelect ? selected : undefined}
      initial={false}
      animate={{ rotate: dead ? -6 : 0, y: dead ? 5 : 0, scale: dead ? 0.97 : 1 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={{ type: "spring", stiffness: 260, damping: 17 }}
      /*
       * Ô tắt vẫn phải ĐỌC được: không hạ opacity, không làm nhạt chữ. Dấu hiệu
       * nằm ở con trỏ chuột và ở lời giải thích khi rê vào - còn nội dung thì
       * người chơi vẫn cần đọc y như mọi ô khác.
       */
      title={disabledReason ?? undefined}
      /*
       * min-height thay cho aspect-square.
       *
       * Ô vuông cứng thì chiều cao bị bề ngang cột quyết định, trong khi nội
       * dung bên trong lại co giãn theo số nhãn: thêm "Đã chọn" cạnh "Bạn" là
       * dòng nhãn xuống hai hàng và tràn ra ngoài khung, đè lên hàng ghế bên
       * dưới. Đặt sàn chiều cao thì ô vẫn gần vuông ở mọi cỡ cột thường gặp,
       * còn khi cần thì nó cao thêm - và cả hàng cao đều theo (lưới tự kéo các
       * ô cùng hàng bằng nhau).
       */
      className={`relative flex min-h-[7.25rem] flex-col items-center justify-center gap-1 rounded-xl border p-2 transition-colors sm:min-h-[9rem]
        ${frame}
        ${
          !disabled
            ? "cursor-pointer hover:border-blood-500/80 hover:bg-blood-600/10"
            : disabledReason
              ? "cursor-not-allowed"
              : "cursor-default"
        }`}
    >
      <AnimatePresence>
        {votes > 0 && (
          <m.span
            key="votes"
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ type: "spring", stiffness: 600, damping: 22 }}
            /*
             * Nằm TRONG ô, không còn thò ra ngoài góc.
             *
             * Cột giữa tự cuộn dọc, mà một phần tử tràn ra mép phải thì trình
             * duyệt sinh luôn thanh cuộn NGANG cho cả cột - chỉ vì một huy hiệu
             * lấn ra bảy pixel ở ô ngoài cùng.
             *
             * Và nó nói ra chữ "phiếu": một chấm đỏ chứa số 3 ở góc ô có thể là
             * số phiếu, số tin nhắn, hay số lần bị soi. Từ sm trở lên ô đủ rộng
             * cho cả chữ; dưới đó chỉ còn con số, và aria-label giữ nguyên nghĩa
             * cho trình đọc màn hình.
             */
            className="absolute right-1 top-1 inline-flex items-center gap-1 rounded-full bg-blood-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white shadow shadow-black/50 motion-reduce:transition-none"
            aria-label={`${votes} phiếu`}
            title={`${votes} phiếu đang nhắm vào ${player.name}`}
            role="status"
          >
            {votes}
            <span className="hidden font-semibold sm:inline">phiếu</span>
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
        title={player.name}
        className={`w-full truncate text-center text-[13px] font-semibold leading-tight sm:text-sm ${
          // Tên người chết vẫn đọc được: gạch ngang và vạch chéo trên chân dung
          // đã nói đủ là họ ra khỏi ván, không cần bóp thêm tương phản.
          dead ? "text-mist-strong line-through" : "text-white"
        }`}
      >
        {player.name}
      </span>

      <span className="flex flex-wrap items-center justify-center gap-1">
        {/* Trạng thái nói bằng CHỮ, không chỉ bằng màu viền: người không phân
          * biệt được đỏ với chàm vẫn phải biết ô nào đang được chọn và ai đã
          * ra khỏi ván. */}
        {selected && <Tag cls="bg-blood-600 text-white">✓ Đã chọn</Tag>}
        {dead && <Tag cls="bg-night-700 text-mist-bright">Đã chết</Tag>}
        {isMe && <Tag cls="bg-indigo-700 text-indigo-50">Bạn</Tag>}
        {isHost && <Tag cls="bg-amber-800/80 text-amber-100">Chủ</Tag>}
        {player.isBot && <Tag cls="bg-slate-700 text-slate-100">Bot</Tag>}
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
    <span className={`rounded px-1.5 py-[1px] text-[11px] font-semibold leading-tight ${cls}`}>
      {children}
    </span>
  );
}
