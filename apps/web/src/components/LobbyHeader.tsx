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
  // Thanh tiến độ đo tới mốc BẮT ĐẦU được, không tới sức chứa phòng: câu hỏi
  // của phút này là "bấm được chưa", không phải "phòng đầy chưa".
  const progress = Math.min(100, Math.round((count / MIN_PLAYERS_TO_START) * 100));

  return (
    <section className="card space-y-4 p-4 lg:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          {/* Mã phòng KHÔNG lặp lại trong tiêu đề: nó đã là cái nút chép ở bên
            * phải, và in nó hai lần trên cùng một dòng thì người chơi phải nhìn
            * xem hai bản có khớp nhau không. */}
          <h1 className="font-display text-[26px] font-bold leading-tight text-white lg:text-3xl">
            Phòng chờ
          </h1>
          <p className="mt-1.5 text-sm text-mist/85">
            <b className="text-white">{count}</b>/{MAX_PLAYERS_PER_ROOM} người
            {freeSeats > 0 && <> · còn {freeSeats} chỗ trống</>}
          </p>
          {/* Đứng bên trái cùng cụm "phòng này là gì", không lửng lơ dưới hàng
            * nút mời: nó là việc của MÌNH, không phải một cách mời thêm người. */}
          {snapshot.you && (
            <button
              type="button"
              className="btn-tertiary -ml-3 mt-1"
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((open) => !open)}
            >
              <span aria-hidden="true">📷</span>
              {pickerOpen ? "Đóng ảnh đại diện" : "Đổi ảnh đại diện"}
            </button>
          )}
        </div>

        {/*
          * `shrink-0` KHÔNG được đứng một mình ở đây.
          *
          * Đo ở 320/360/390 thì bản cũ KHÔNG tràn ngang - ba control vừa đủ lọt
          * sau khi wrap. Nhưng nó vừa đủ một cách tình cờ: `shrink-0` cấm hẳn
          * việc co lại, nên kích thước cơ sở của item là bề rộng max-content của
          * cả cụm chưa wrap. Thêm một ký tự vào mã phòng hay một chữ vào nhãn
          * nút là nó tràn thật, không có gì đỡ.
          *
          * Chiếm trọn một dòng ở màn hẹp thì phần wrap bên trong mới có chỗ làm
          * việc (xem `RoomInvite`, nơi quyết định hai hàng xếp thế nào); từ sm
          * trở lên nó về lại nằm cạnh tiêu đề như cũ.
          */}
        <div className="w-full min-w-0 sm:w-auto sm:shrink-0">
          <RoomInvite code={code} size="lg" />
        </div>
      </div>

      {/*
        * Thanh tiến độ chỉ hiện khi CÒN THIẾU người.
        *
        * Đủ người rồi mà vẫn để một thanh đầy 100% nằm đó thì nó thành trang
        * trí, và mắt vẫn phải dừng lại đọc xem nó đang đo cái gì.
        */}
      {missing > 0 && (
        <div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-night-800"
            role="progressbar"
            aria-valuenow={count}
            aria-valuemin={0}
            aria-valuemax={MIN_PLAYERS_TO_START}
            aria-label={`${count} trên ${MIN_PLAYERS_TO_START} người tối thiểu`}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500/70 to-amber-400 transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-mist/80">
            Cần thêm <b className="text-white">{missing}</b> người nữa để bắt đầu — gửi mã{" "}
            <b className="font-mono tracking-wider text-white">{code}</b> cho bạn bè.
          </p>
        </div>
      )}

      {pickerOpen && snapshot.you && (
        <div className="border-t border-white/[0.08] pt-4">
          <AvatarPicker
            currentUrl={snapshot.you.avatarUrl ?? null}
            onDone={() => setPickerOpen(false)}
          />
        </div>
      )}
    </section>
  );
}
