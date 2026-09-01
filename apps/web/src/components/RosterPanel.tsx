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
    /*
     * Trong ván thẻ này cao đúng bằng cột, và phần cuộn nằm ở danh sách bên
     * trong. Trước đây nó cao theo nội dung rồi `sticky` bám mép trên: một
     * phòng 6 người cho ra một thẻ cao chừng 320px lơ lửng ở góc trên trái của
     * màn 1440x900, cạnh một cột chat cao gấp ba. Phòng chờ vẫn để nội dung
     * quyết định chiều cao - ở đó cột này còn có bộ bài cuộn phía dưới.
     */
    <section className={`card p-3.5 lg:p-4 ${lobby ? "" : "lg:flex lg:h-full lg:min-h-0 lg:flex-col"}`}>
      <div className="mb-2.5 flex shrink-0 items-baseline justify-between gap-2">
        <h3 className="font-display text-lg font-bold text-white">Người chơi</h3>
        {/* Đếm theo sức chứa phòng: "15/6" đọc như phòng đang quá tải. */}
        <span className="shrink-0 text-sm font-semibold text-mist-strong">
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
      <ul
        className={`lobby-roster-scroll space-y-1 lg:overflow-y-auto lg:overscroll-contain lg:pr-1 ${
          lobby ? "lg:max-h-[calc(100dvh-16rem)]" : "lg:min-h-0 lg:flex-1"
        }`}
      >
        {snapshot.players.map((player) => {
          const votes = player.voteCount ?? 0;
          const isMe = player.id === meId;
          const isRoomHost = snapshot.hostId === player.id;
          // Bot vốn không có kết nối, nên connected=false của nó không phải sự cố.
          const offline = !player.isBot && player.connected === false;
          // null là "không tiết lộ" - vẫn là một lời khai, khác hẳn chưa khai.
          const claim = claims?.[player.id];
          const claimed = claims ? player.id in claims : false;
          const isPending = snapshot.pendingLastStandVictim?.playerId === player.id;
          /*
           * Bot KHÔNG còn nằm ở dòng nhãn.
           *
           * Một phòng thường có 4-5 bot, và một cột dọc hẹp lặp lại năm lần cái
           * nhãn "🤖 Bot" đọc ra như thể "bot" là thông tin quan trọng nhất về
           * mỗi người - trong khi thứ người chơi thật sự quét cột này để tìm là
           * ai còn sống và ai đang bị dồn phiếu. Nó xuống thành một dấu nhỏ ở
           * góc ảnh đại diện (có title + nhãn cho trình đọc màn hình), và nhờ
           * đó phần lớn các hàng bot rút từ hai dòng xuống còn một.
           */
          const hasTags = isRoomHost || !!player.role || offline || claimed || isPending;
          // Identity của LiveKit chính là playerId nên đối chiếu thẳng.
          const speaking = speakers.has(player.id);
          return (
            <li
              key={player.id}
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
                  {/*
                    * Dấu bot nằm ở GÓC ẢNH, không nằm trên dòng chữ.
                    *
                    * Cột này rộng 224-240px và đã phải chia cho ảnh, tên, huy
                    * hiệu phiếu; thêm một con chip chữ nữa là tên bị cắt cụt
                    * ("Trường Gia...") ở đúng những hàng mà người chơi cần đọc
                    * tên nhất. Đặt lên góc ảnh thì nó không lấy một pixel bề
                    * ngang nào của cái tên.
                    */}
                  {/*
                    * Đổi ảnh đại diện nằm NGAY TRÊN ảnh của chính mình.
                    *
                    * Trước đây nó là một nút chạy hết bề ngang ở đáy cột, cách
                    * hàng của người chơi cả một danh sách 15 người: đọc ra như
                    * một mục cài đặt của cả phòng chứ không phải "ảnh của tôi".
                    * Dán lên góc ảnh thì không còn phải đoán nó tác động lên
                    * ai. Chỉ mọc ra trên ảnh của người xem, và chỉ trong ván -
                    * ở phòng chờ chức năng này thuộc về LobbyHeader.
                    */}
                  {!lobby && isMe && (
                    <button
                      type="button"
                      className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-night-800 text-xs leading-none ring-1 ring-white/25 transition hover:bg-night-700 hover:ring-white/60"
                      aria-label="Đổi ảnh đại diện"
                      title="Đổi ảnh đại diện"
                      aria-expanded={showPicker}
                      onClick={() => setShowPicker((v) => !v)}
                    >
                      <span aria-hidden="true">📷</span>
                    </button>
                  )}
                  {player.isBot && (
                    <span
                      className="absolute -bottom-0.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full bg-night-900 text-[11px] leading-none ring-1 ring-white/25"
                      title="Bot - do máy điều khiển"
                      aria-label="Bot, do máy điều khiển"
                      role="img"
                    >
                      <span aria-hidden="true">🤖</span>
                    </span>
                  )}
                </span>

                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  {/*
                   * Người chết vẫn phải ĐỌC được: cột này là nơi tra "ai đã ra
                   * khỏi ván", nên một cái tên mờ tới mức đoán chữ thì đúng cái
                   * việc duy nhất của nó cũng hỏng. mist-strong đạt 7:1 trên nền
                   * thẻ, còn dấu hiệu "đã chết" nằm ở GẠCH NGANG cộng vạch chéo
                   * trên ảnh - hai tín hiệu không phải màu.
                   */}
                  <span
                    className={`min-w-0 truncate text-[15px] font-semibold ${
                      player.alive ? "text-white" : "text-mist-strong line-through"
                    }`}
                    title={player.name}
                  >
                    {player.name}
                  </span>
                  {/* Trình đọc màn hình không "thấy" được gạch ngang. */}
                  {!player.alive && <span className="sr-only">(đã chết)</span>}
                  {isMe && (
                    <span className="shrink-0 rounded bg-indigo-500/25 px-1 py-px text-xs font-bold leading-tight text-indigo-100 ring-1 ring-indigo-400/40">
                      Bạn
                    </span>
                  )}
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
                        className="grid h-[22px] min-w-[22px] shrink-0 place-items-center rounded-full bg-blood-600 px-1.5 text-xs font-bold text-white"
                        /*
                         * Một chấm đỏ chứa số "3" không tự nói nó là số phiếu -
                         * nó cũng có thể là tin nhắn chưa đọc hay số lần bị soi.
                         * title cho chuột, aria-label cho trình đọc màn hình.
                         */
                        title={`${votes} phiếu đang nhắm vào ${player.name}`}
                        aria-label={`${votes} phiếu`}
                        role="status"
                      >
                        {votes}
                      </m.span>
                    )}
                  </AnimatePresence>
                )}

                {lobby?.isHost && player.id !== meId && (
                  <button
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-blood-600/15 px-1.5 py-1 text-xs font-bold text-blood-400 transition hover:bg-blood-600/30 hover:text-blood-300"
                    aria-label={`Kick ${player.name}`}
                    onClick={() => lobby.onKick(player.id)}
                  >
                    <span aria-hidden="true">✕</span> Kick
                  </button>
                )}
              </div>

              {!lobby && isMe && showPicker && (
                <div className="mt-2 rounded-lg border border-white/10 bg-night-900/70 p-2">
                  <AvatarPicker
                    currentUrl={snapshot.you?.avatarUrl ?? null}
                    onDone={() => setShowPicker(false)}
                  />
                </div>
              )}

              {hasTags && (
                <div className="ml-[46px] mt-1 flex flex-wrap items-center gap-1 sm:ml-[50px]">
                  {isRoomHost && (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-200 ring-1 ring-amber-400/40">
                      <span aria-hidden="true">👑</span> Chủ phòng
                    </span>
                  )}
                  {player.role && (
                    <span
                      className={`max-w-full truncate rounded px-1.5 py-0.5 text-xs font-semibold ${
                        ROLE_META[player.role].team === "wolves"
                          ? "bg-blood-600/70 text-white"
                          : "bg-emerald-900/80 text-emerald-200"
                      }`}
                    >
                      {roleLabel(player)}
                    </span>
                  )}
                  {claimed && (
                    <span className="inline-flex max-w-full items-center gap-0.5 truncate rounded bg-sky-600/20 px-1.5 py-0.5 text-xs font-bold text-sky-200 ring-1 ring-sky-500/30">
                      <span aria-hidden="true">🔍</span>{" "}
                      {claim == null
                        ? "Không tiết lộ"
                        : ((ROLE_META as any)[claim]?.name ?? claim)}
                    </span>
                  )}
                  {offline && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-bold text-amber-300 ring-1 ring-amber-500/30">
                      <span aria-hidden="true">📴</span> Mất kết nối
                    </span>
                  )}
                  {isPending && (
                    <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-300 ring-1 ring-amber-500/30">
                      <span aria-hidden="true">🛡️</span> Tử Thủ
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
            style={{ "--slot-index": i } as React.CSSProperties}
            /* Viền và nền do `.lobby-slot-waiting` cầm (nó là thứ duy nhất
             * nhấp nháy), nên ở đây chỉ còn kiểu nét và bề dày. */
            className="lobby-slot-waiting flex items-center gap-2.5 rounded-lg border border-dashed px-2 py-1.5"
          >
            {/* Hai dòng chữ này KHÔNG mờ theo nhịp chờ nữa - xem chú thích ở
              * `.lobby-slot-waiting` trong globals.css. */}
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-night-800/70 text-sm font-bold text-mist/80 sm:h-10 sm:w-10">
              {count + i + 1}
            </span>
            <span className="text-sm text-mist-strong/80">Đang chờ người vào...</span>
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
        <p className="mt-2.5 shrink-0 border-t border-white/[0.08] pt-2.5 text-[13px] text-mist-strong">
          Còn <b className="text-white">{freeSeats}</b> chỗ trống · phòng nhận tối đa{" "}
          {MAX_PLAYERS_PER_ROOM} người
        </p>
      )}

      {snapshot.noEliminationVoteCount > 0 && (
        <p className="mt-2 shrink-0 border-t border-white/[0.08] pt-2 text-[13px] text-mist-strong">
          Không treo ai: <b className="text-white">{snapshot.noEliminationVoteCount}</b> phiếu
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
