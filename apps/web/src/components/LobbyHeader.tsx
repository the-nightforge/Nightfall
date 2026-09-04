"use client";

import { useState } from "react";
import { MAX_PLAYERS_PER_ROOM, MIN_PLAYERS_TO_START, type RoomSnapshot } from "@masoi/shared";
import { AvatarPicker } from "./AvatarPicker";
import { RoomInvite } from "./RoomInvite";

interface Props {
  snapshot: RoomSnapshot;
  code: string;
}

/**
 * Đầu trang của phòng chờ.
 *
 * Trước đây phòng chờ mở đầu bằng HAI tiêu đề: `PhaseBanner` in "Phòng chờ",
 * rồi ngay dưới nó thẻ thiết lập in "Ván sắp tới" kèm một bộ đếm người thứ hai
 * (bộ đếm thứ nhất nằm ở cột người chơi). Ba dòng nói cùng một chuyện, xếp
 * chồng lên nhau trong 200px đầu tiên của trang.
 *
 * Khối này gom chúng lại: tên phòng, mã phòng, số người và hai nút mời nằm cùng
 * một hàng, và `PhaseBanner` nhường chỗ trong pha LOBBY. Thẻ thiết lập bên dưới
 * chỉ còn nói về bộ bài.
 *
 * Nút đổi ảnh đại diện đứng ở đây chứ không ở cột người chơi: nó là việc riêng
 * của một người, không phải một thao tác quản lý danh sách, và đặt nó ngay dưới
 * danh sách thì nó đọc ra như "đổi ảnh cho người vừa chọn".
 */
export function LobbyHeader({ snapshot, code }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const count = snapshot.players.length;
  const missing = Math.max(0, MIN_PLAYERS_TO_START - count);
  const freeSeats = Math.max(0, MAX_PLAYERS_PER_ROOM - count);
  const host = snapshot.players.find((player) => player.id === snapshot.hostId);
  // Thanh tiến độ đo tới mốc BẮT ĐẦU được, không tới sức chứa phòng: câu hỏi
  // của phút này là "bấm được chưa", không phải "phòng đầy chưa".
  const progress = Math.min(100, Math.round((count / MIN_PLAYERS_TO_START) * 100));

  return (
    <section className="lobby-room-header">
      <div className="lobby-room-heading">
        <span className="lobby-room-moon" aria-hidden="true">
          <svg viewBox="0 0 32 32">
            <path d="M25.7 21.2A11.8 11.8 0 0 1 10.8 6.3 11.8 11.8 0 1 0 25.7 21.2Z" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="lobby-kicker">Phòng Ma Sói</p>
          <h1 className="font-display text-[28px] font-semibold leading-tight text-white sm:text-4xl">
            Trước giờ trăng lên
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-mist/80">
            <span>
              <b className="text-mist-bright">{count}</b>/{MAX_PLAYERS_PER_ROOM} người
            </span>
            <span aria-hidden="true" className="h-1 w-1 rounded-full bg-amber-300/50" />
            <span>
              Chủ phòng: <b className="text-amber-100">{host?.name ?? "Đang chuyển giao"}</b>
            </span>
          </div>
        </div>
      </div>

      <div className="lobby-room-invite">
        <RoomInvite code={code} size="lg" />
        {snapshot.you && (
          <button
            type="button"
            className="btn-tertiary ml-auto min-h-11"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((open) => !open)}
          >
            {pickerOpen ? "Đóng ảnh đại diện" : "Đổi ảnh đại diện"}
          </button>
        )}
      </div>

      {/*
        * Thanh tiến độ chỉ hiện khi CÒN THIẾU người.
        *
        * Đủ người rồi mà vẫn để một thanh đầy 100% nằm đó thì nó thành trang
        * trí, và mắt vẫn phải dừng lại đọc xem nó đang đo cái gì.
        */}
      {missing > 0 && (
        <div className="mt-5">
          <div
            className="h-1 overflow-hidden rounded-full bg-white/10"
            role="progressbar"
            aria-valuenow={count}
            aria-valuemin={0}
            aria-valuemax={MIN_PLAYERS_TO_START}
            aria-label={`${count} trên ${MIN_PLAYERS_TO_START} người tối thiểu`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-300 transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
          {/* 13px + mist-strong: câu này là hướng dẫn duy nhất nói phải LÀM gì
            * khi phòng chưa đủ người, mà ở 12px/mist-80% nó chìm dưới thanh
            * tiến độ ngay trên nó. */}
          <p className="mt-2 text-[13px] leading-relaxed text-mist-strong">
            Cần thêm <b className="text-white">{missing}</b> người để màn đêm bắt đầu
            {freeSeats > 0 ? " — hãy gửi mã phòng cho bạn bè." : "."}
          </p>
        </div>
      )}

      {pickerOpen && snapshot.you && (
        <div className="mt-4 border-t border-white/[0.08] pt-4">
          <AvatarPicker
            currentUrl={snapshot.you.avatarUrl ?? null}
            onDone={() => setPickerOpen(false)}
          />
        </div>
      )}
    </section>
  );
}
