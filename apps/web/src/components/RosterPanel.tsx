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
import { listItemMotion } from "@/lib/motion";
import { Avatar } from "./Avatar";
import { AvatarPicker } from "./AvatarPicker";

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
 *
 * Cột hẹp nên mỗi người chiếm hai dòng: dòng trên dành trọn chỗ trống cho cái
 * tên, dòng dưới là các nhãn được phép xuống hàng. Nhồi nhãn vào cùng dòng với
 * tên thì tên bị bóp lại còn đúng một chữ cái.
 *
 * Nút đổi ảnh đại diện chỉ còn ở đây trong lúc ĐANG CHƠI. Ở phòng chờ nó lên
 * `LobbyHeader`: nó là việc riêng của một người chứ không phải thao tác quản lý
 * danh sách, mà nằm ngay dưới danh sách thì nó đọc ra như "đổi ảnh cho người
 * vừa chọn" - và nó cũng đẩy phần cuộn của danh sách 15 người xuống dưới.
 */
export function RosterPanel({ snapshot, lobby }: Props) {
  const speakers = useSpeakers();
  const meId = snapshot.you?.id ?? null;
  const roster = snapshot.players.map((p) => p.id).join(",");
  const avatars = useMemo(() => assignAvatars(roster ? roster.split(",") : []), [roster]);
  const [showPicker, setShowPicker] = useState(false);

  const count = snapshot.players.length;
  const alive = snapshot.players.filter((p) => p.alive).length;
  // Ô trống có đánh số cho thấy còn thiếu bao nhiêu người để BẮT ĐẦU, thay vì
  // một dòng chữ "cần thêm 4 người" mà mắt phải đọc mới biết. Sức chứa thật của
  // phòng (15) nằm ở dòng chân thẻ - chỉ vẽ tới 6 ô mà không nói gì thêm thì
  // phòng đọc ra như chỉ nhận được sáu người.
  const emptySlots = lobby ? Math.max(0, MIN_PLAYERS_TO_START - count) : 0;
  const freeSeats = Math.max(0, MAX_PLAYERS_PER_ROOM - count);
  // Lời khai Ngày Sự Thật chỉ dán lên cột này trong đúng sự kiện đó.
  const claims =
    snapshot.activeEvent?.id === "DAY_OF_TRUTH" ? snapshot.dayOfTruthClaims : undefined;

  return (
    <section className="card p-3.5 lg:p-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-white">Người chơi</h3>
        {/* Đếm theo sức chứa phòng: "15/6" đọc như phòng đang quá tải. */}
        <span className="shrink-0 text-sm font-semibold text-mist/85">
          {lobby ? `${count}/${MAX_PLAYERS_PER_ROOM}` : `${alive}/${count} sống`}
        </span>
      </div>

      {/*
        * Vùng cuộn riêng cho danh sách.
        *
        * Phòng chứa tới 15 người, còn cột này thì `sticky` theo màn hình: không
        * bó chiều cao lại thì một phòng đầy đẩy thẻ dài quá khung nhìn và mấy
        * người cuối không bao giờ thấy được. Chỉ bó từ lg - dưới đó cột nằm
        * trong dòng chảy của trang và cuộn cùng trang là đúng.
        */}
      <ul className="lobby-roster-scroll space-y-1 lg:max-h-[calc(100dvh-16rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
        {snapshot.players.map((player, index) => {
          const votes = player.voteCount ?? 0;
          const isMe = player.id === meId;
          const isRoomHost = snapshot.hostId === player.id;
          // Bot vốn không có kết nối, nên connected=false của nó không phải sự cố.
          const offline = !player.isBot && player.connected === false;
          // null là "không tiết lộ" - vẫn là một lời khai, khác hẳn chưa khai.
          const claim = claims?.[player.id];
          const claimed = claims ? player.id in claims : false;
          const isPending = snapshot.pendingLastStandVictim?.playerId === player.id;
          const hasTags = isRoomHost || player.isBot || !!player.role || offline || claimed || isPending;
          // Identity của LiveKit chính là playerId nên đối chiếu thẳng.
          const speaking = speakers.has(player.id);
          return (
            <m.li
              key={player.id}
              {...listItemMotion(index, snapshot.players.length)}
              className={`group rounded-lg px-2 py-1.5 transition ${
                speaking
                  ? "bg-emerald-400/10 ring-1 ring-emerald-400/60"
                  : isMe
                    ? "bg-indigo-500/10 ring-1 ring-indigo-500/30"
                    : ""
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="relative shrink-0">
                  <Avatar
                    avatar={player.avatarUrl ? player.avatarUrl : avatars[player.id]}
                    tint={tintFor(player.id)}
                    alive={player.alive}
                    breathOffset={breathOffsetFor(player.id)}
                    /*
                     * Vòng vàng quanh ảnh của chủ phòng.
                     *
                     * Cái vương miện ở dòng nhãn bên dưới là chữ cao 10px nằm
                     * lẫn giữa các nhãn khác; ở cỡ đó nó không đọc ra được từ
                     * khoảng cách ngồi chơi thật. Vòng sáng quanh ảnh thì thấy
                     * ngay cả khi chỉ liếc qua cột.
                     */
                    className={`h-9 w-9 sm:h-10 sm:w-10 ${
                      isRoomHost ? "ring-2 ring-amber-400/70 ring-offset-1 ring-offset-night-900" : ""
                    }`}
                    isCustom={!!player.avatarUrl}
                  />
                  {!player.alive && (
                    <span className="pointer-events-none absolute inset-0 grid place-items-center">
                      <span className="h-[1.5px] w-7 rotate-45 rounded bg-blood-500/70" />
                    </span>
                  )}
                </span>

                <span
                  className={`min-w-0 flex-1 truncate text-[15px] font-semibold ${
                    player.alive ? "text-white" : "text-mist/70 line-through"
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
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-blood-600/15 px-1.5 py-1 text-[11px] font-bold text-blood-400 transition hover:bg-blood-600/30 hover:text-blood-300"
                    aria-label={`Kick ${player.name}`}
                    onClick={() => lobby.onKick(player.id)}
                  >
                    <span aria-hidden="true">✕</span> Kick
                  </button>
                )}
              </div>

              {hasTags && (
                <div className="ml-[46px] mt-1 flex flex-wrap items-center gap-1 sm:ml-[50px]">
                  {isRoomHost && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-200 ring-1 ring-amber-400/40">
                      <span aria-hidden="true">👑</span> Chủ phòng
                    </span>
                  )}
                  {player.isBot && (
                    <span className="inline-flex items-center gap-1 rounded bg-slate-700/70 px-1.5 py-0.5 text-[11px] font-bold text-slate-100">
                      <span aria-hidden="true">🤖</span> Bot
                    </span>
                  )}
                  {player.role && (
                    <span
                      className={`max-w-full truncate rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        ROLE_META[player.role].team === "wolves"
                          ? "bg-blood-600/70 text-white"
                          : "bg-emerald-900/80 text-emerald-200"
                      }`}
                    >
                      {roleLabel(player)}
                    </span>
                  )}
                  {claimed && (
                    <span className="inline-flex max-w-full items-center gap-0.5 truncate rounded bg-sky-600/20 px-1.5 py-0.5 text-[11px] font-bold text-sky-200 ring-1 ring-sky-500/30">
                      <span aria-hidden="true">🔍</span>{" "}
                      {claim == null
                        ? "Không tiết lộ"
                        : ((ROLE_META as any)[claim]?.name ?? claim)}
                    </span>
                  )}
                  {offline && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-300 ring-1 ring-amber-500/30">
                      <span aria-hidden="true">📴</span> Mất kết nối
                    </span>
                  )}
                  {isPending && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[11px] font-bold text-amber-300 ring-1 ring-amber-500/30">
                      <span aria-hidden="true">🛡️</span> Tử Thủ
                    </span>
                  )}
                </div>
              )}
            </m.li>
          );
        })}

        {Array.from({ length: emptySlots }, (_, i) => (
          <li
            key={`empty-${i}`}
            style={{ "--slot-index": i } as React.CSSProperties}
            className="lobby-slot-waiting flex items-center gap-2.5 rounded-lg border border-dashed border-night-600/70 px-2 py-1.5"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-night-800/70 text-sm font-bold text-mist/50 sm:h-10 sm:w-10">
              {count + i + 1}
            </span>
            <span className="text-sm text-mist/60">Đang chờ người vào...</span>
          </li>
        ))}
      </ul>

      {/*
        * Sức chứa thật của phòng, nói bằng chữ.
        *
        * Danh sách chỉ vẽ ô trống tới mốc bắt đầu được (6), nên nếu dừng ở đó
        * thì một phòng 4 người trông như đã lấp hai phần ba - trong khi thực tế
        * còn mười một chỗ. Dòng này là chỗ duy nhất nói ra con số đó.
        */}
      {lobby && freeSeats > 0 && (
        <p className="mt-2.5 border-t border-white/[0.08] pt-2.5 text-xs text-mist/75">
          Còn <b className="text-white">{freeSeats}</b> chỗ trống · phòng nhận tối đa{" "}
          {MAX_PLAYERS_PER_ROOM} người
        </p>
      )}

      {/* Ở phòng chờ nút này nằm trên `LobbyHeader`; đây là bản dùng trong ván. */}
      {!lobby && snapshot.you && (
        <div className="mt-3 border-t border-white/[0.08] pt-3">
          <button
            type="button"
            className="btn-tertiary w-full"
            aria-expanded={showPicker}
            onClick={() => setShowPicker((v) => !v)}
          >
            {showPicker ? "Đóng" : "📷 Đổi ảnh đại diện"}
          </button>
          {showPicker && (
            <div className="mt-2">
              <AvatarPicker
                currentUrl={snapshot.you?.avatarUrl ?? null}
                onDone={() => setShowPicker(false)}
              />
            </div>
          )}
        </div>
      )}

      {snapshot.noEliminationVoteCount > 0 && (
        <p className="mt-2 border-t border-white/[0.08] pt-2 text-xs text-mist/75">
          Không treo ai: <b className="text-white">{snapshot.noEliminationVoteCount}</b>
        </p>
      )}
    </section>
  );
}

function ReadyDot({ ready }: { ready: boolean }) {
  return (
    <span
      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
        ready
          ? "bg-emerald-600 text-white"
          : "bg-white/[0.08] text-mist/75 ring-1 ring-white/15"
      }`}
      aria-label={ready ? "Sẵn sàng" : "Chưa sẵn sàng"}
      title={ready ? "Sẵn sàng" : "Chưa sẵn sàng"}
    >
      {ready ? "✓" : "○"}
    </span>
  );
}
