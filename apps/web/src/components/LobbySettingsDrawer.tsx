"use client";

import { useRef, useState } from "react";
import type { RoomConfig, RoomSnapshot } from "@masoi/shared";
import type { Identity } from "@/lib/identity";
import { useModalFocus } from "@/lib/useModalFocus";
import { LobbySettings } from "./Lobby";

interface Props {
  snapshot: RoomSnapshot;
  identity: Identity;
  onUpdateConfig: (config: RoomConfig) => void;
}

/**
 * "Luật và vai trò": ba mục thiết lập của phòng chờ, gói vào một lớp phủ.
 *
 * Nội dung không đổi một dòng nào - bên trong vẫn đúng `LobbySettings` cũ với
 * thiết lập ván, bộ bài và cài đặt nâng cao, kể cả các trạng thái chỉ-xem của
 * người không phải chủ phòng. Thứ đổi là CHỖ ĐỨNG.
 *
 * Trước đây ba mục này nằm thẳng trong thanh điều khiển, và ngay cả khi đóng
 * hết thì ba hàng `<summary>` cao 64px vẫn ăn gần 200px cuối cột; mở một mục
 * ra là bộ bài 13 vai đẩy trang dài gấp đôi màn hình, kéo theo cả khung chat
 * lẫn nút Bắt đầu trôi khỏi tầm mắt. Nhưng đây là thứ chủ phòng chỉnh MỘT lần
 * lúc dựng ván rồi quên, còn chat và nút Bắt đầu thì cả phòng nhìn suốt thời
 * gian chờ - nên chúng đổi chỗ cho nhau: ở đây chỉ còn một cái nút cao 56px,
 * và toàn bộ chiều dài kia chuyển sang một lớp phủ tự cuộn.
 *
 * Lớp phủ đóng được bằng ba lối: nút ×, phím Escape, và bấm ra ngoài. Tấm nền
 * mờ là một `<button>` thật chứ không phải một `<div>` gắn onClick - nó cũng
 * là thứ trình đọc màn hình đọc ra được, và nó nằm trong `roots` của
 * `useModalFocus` để không bị chính bẫy focus đặt `inert` lên.
 */
export function LobbySettingsDrawer({ snapshot, identity, onUpdateConfig }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isHost = snapshot.hostId === identity.playerId;

  useModalFocus({
    active: open,
    roots: [panelRef, backdropRef],
    initialFocus: closeRef,
    restoreTo: triggerRef,
    onEscape: () => setOpen(false),
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="lobby-settings-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-bold text-white">Luật và vai trò</span>
          {/* Hai câu khác nhau vì hai quyền khác nhau: khách mở ra để ĐỌC đội
            * hình chủ phòng đã chọn, và nói trước điều đó thì họ không bấm vào
            * với kỳ vọng chỉnh được. */}
          <span className="mt-0.5 block truncate text-[13px] text-mist/85">
            {isHost ? "Thiết lập ván, bộ bài và cài đặt nâng cao" : "Xem đội hình và luật của phòng"}
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 text-lg text-mist/85">
          ⚙
        </span>
      </button>

      {open && (
        <div className="lobby-settings-layer">
          <button
            ref={backdropRef}
            type="button"
            className="absolute inset-0 cursor-default bg-black/60"
            aria-label="Đóng bảng luật và vai trò"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            className="lobby-settings-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lobby-settings-title"
            tabIndex={-1}
          >
            {/* Đầu lớp phủ đứng yên, chỉ thân cuộn: bộ bài 13 vai dài hơn màn
              * hình, và nút Đóng phải với tới được ở mọi vị trí cuộn. */}
            <div className="lobby-settings-drawer-head">
              <div className="min-w-0">
                <p className="lobby-kicker">Ván sắp tới</p>
                <h2
                  id="lobby-settings-title"
                  className="font-display text-xl font-semibold text-white"
                >
                  Luật và vai trò
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl text-mist transition hover:bg-white/10 hover:text-white"
                aria-label="Đóng"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="lobby-settings-drawer-body lobby-roster-scroll">
              <LobbySettings
                snapshot={snapshot}
                identity={identity}
                onUpdateConfig={onUpdateConfig}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
