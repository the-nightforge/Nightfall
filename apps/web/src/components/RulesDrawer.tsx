"use client";

import { useMemo, useRef, useState } from "react";
import type { RoomSnapshot, Team } from "@masoi/shared";
import { rulesLookup } from "@/lib/rules-lookup";
import { TEAM_TAG_CLASS } from "@/lib/team-tone";
import { useModalFocus } from "@/lib/useModalFocus";
import { RoleGlyph } from "./RoleGlyph";

interface Props {
  snapshot: RoomSnapshot;
}

const TEAM_NAME: Record<Team, string> = {
  wolves: "Phe Sói",
  village: "Phe Dân",
  neutral: "Trung lập",
};

/**
 * Nút "?" trên thanh đầu phòng, mở bảng tra luật giữa ván.
 *
 * Phòng chờ đã có "Luật và vai trò" để CHỈNH bộ bài; bảng này là bản chỉ-đọc
 * cho lúc ván đang chạy, khi thẻ hướng dẫn đã ẩn hoặc chưa từng bật và người
 * chơi đang bị dí phiếu mà không nhớ Bảo Vệ có tự bảo vệ được không. Bốn mục,
 * theo thứ tự người ta cần: đang ở pha nào và phải làm gì, vai của mình, sự
 * kiện đang chạy, rồi mới tới bộ bài của cả ván.
 *
 * Cùng lớp phủ với phòng chờ - cùng CSS, cùng ba lối đóng, cùng bẫy focus -
 * và không chặn đồng hồ: pha vẫn trôi phía sau, người mở bảng tự chịu.
 */
export function RulesDrawer({ snapshot }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const rules = useMemo(() => rulesLookup(snapshot), [snapshot]);

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
        /* Hình vẫn là ô vuông 36px, vùng chạm là 44px và do
         * `.room-topbar-icon` lo bằng một `::after` vô hình: nở thật bề ngang
         * ra 44 thì hàng đầu trang dài thêm và "Mã QR" rơi xuống hàng hai ở
         * 360px. Chiều cao 44px đến từ `.room-topbar button`. */
        className="rules-trigger room-topbar-icon inline-flex w-9 items-center justify-center rounded-lg border border-night-600 bg-night-800 text-sm font-bold text-mist"
        aria-label="Luật và vai trò"
        title="Luật và vai trò"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        ?
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
            aria-labelledby="rules-drawer-title"
            tabIndex={-1}
          >
            <div className="lobby-settings-drawer-head">
              <div className="min-w-0">
                <p className="lobby-kicker">Đang chơi</p>
                <h2 id="rules-drawer-title" className="font-display text-xl font-semibold text-white">
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

            <div className="lobby-settings-drawer-body lobby-roster-scroll space-y-5">
              <section aria-labelledby="rules-phase">
                <h3 id="rules-phase" className="lobby-kicker">
                  Bây giờ
                </h3>
                <p className="mt-1 text-base font-semibold text-white">{rules.phase.label}</p>
                <p className="mt-0.5 text-sm text-mist/85">{rules.phase.hint}</p>
              </section>

              {rules.myRole && (
                <section aria-labelledby="rules-me" className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                  <h3 id="rules-me" className="lobby-kicker">
                    Vai của bạn
                  </h3>
                  <div className="mt-2 flex items-start gap-3">
                    <RoleGlyph role={rules.myRole.role} team={rules.myRole.team} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-bold text-white">{rules.myRole.name}</span>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${TEAM_TAG_CLASS[rules.myRole.team]}`}>
                          {TEAM_NAME[rules.myRole.team]}
                        </span>
                      </p>
                      <p className="mt-1 text-sm text-mist/90">{rules.myRole.description}</p>
                      <p className="mt-1.5 text-sm text-mist/85">
                        <span className="font-semibold text-mist">Mục tiêu:</span> {rules.myRole.goal}
                      </p>
                      <p className="mt-1 text-xs text-mist/85">
                        {rules.myRole.actsAtNight ? "Có hành động ban đêm." : "Không có hành động ban đêm."}
                      </p>
                      {rules.myRole.note && (
                        <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-900/20 px-2.5 py-1.5 text-sm text-amber-100">
                          {rules.myRole.note}
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {rules.event && (
                <section aria-labelledby="rules-event">
                  <h3 id="rules-event" className="lobby-kicker">
                    Sự kiện đang chạy
                  </h3>
                  <p className="mt-1 text-base font-semibold text-white">{rules.event.name}</p>
                  <p className="mt-0.5 text-sm text-mist/85">{rules.event.description}</p>
                  {rules.event.announcement && (
                    <p className="mt-1 text-sm text-amber-100">{rules.event.announcement}</p>
                  )}
                </section>
              )}

              <section aria-labelledby="rules-deck">
                <h3 id="rules-deck" className="lobby-kicker">
                  Bộ bài của ván
                </h3>
                <ul className="mt-2 divide-y divide-white/[0.07]">
                  {rules.deck.map((card) => (
                    <li key={card.role} className="flex items-start gap-3 py-2.5">
                      <RoleGlyph role={card.role} team={card.team} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2">
                          <span className="font-semibold text-white">{card.name}</span>
                          {card.count > 1 && (
                            <span className="rounded bg-white/10 px-1.5 text-xs font-bold text-mist">
                              ×{card.count}
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-mist/85">{card.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
