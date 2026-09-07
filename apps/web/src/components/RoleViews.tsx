"use client";

import { useCallback, useEffect, useState } from "react";
import { m } from "motion/react";
import { isWolfPack, ROLE_META, TEAM_LABELS, type Role, type RoomSnapshot, type Team } from "@masoi/shared";
import { myCursedNote } from "@/lib/cursed";
import { roleGoal } from "@/lib/role-goal";
import { ROLE_ICON_PATHS } from "@/lib/role-art";

/**
 * Bộ màu của thẻ vai theo phe.
 *
 * Bảng tra thay cho các biểu thức `isWolf ? ... : ...` rải khắp component: với
 * hai phe, "không phải Sói" đồng nghĩa với "phe làng" nên một biểu thức ba ngôi
 * còn đúng. Với phe thứ ba thì mỗi biểu thức đó là một chỗ để Thằng Hề hiện ra
 * dưới màu và nhãn của phe Dân Làng - tức là thẻ vai nói dối chính người vừa
 * nhận vai.
 */
const TEAM_SKIN: Record<Team, { card: string; halo: string; fill: string; label: string; title: string }> = {
  wolves: {
    card: "border-blood-500 bg-blood-600/10",
    halo: "bg-gradient-to-br from-blood-600/30 to-blood-900/25 ring-blood-500/35",
    fill: "fill-blood-300",
    label: "text-blood-400/90",
    title: "text-blood-400",
  },
  village: {
    card: "border-emerald-600/60 bg-emerald-900/10",
    halo: "bg-gradient-to-br from-emerald-600/25 to-emerald-900/25 ring-emerald-500/30",
    fill: "fill-emerald-200",
    label: "text-emerald-300/90",
    title: "text-emerald-300",
  },
  neutral: {
    card: "border-amber-500/60 bg-amber-900/10",
    halo: "bg-gradient-to-br from-amber-600/25 to-amber-900/25 ring-amber-500/30",
    fill: "fill-amber-200",
    label: "text-amber-300/90",
    title: "text-amber-300",
  },
};

/**
 * Mặt ngửa của thẻ vai.
 *
 * Bốn thứ, theo đúng thứ tự người chơi cần: mình là ai, làm được gì, để làm gì,
 * và đừng cho ai xem. Bản cũ chỉ có hai thứ đầu, nên người mới lật xong thẻ
 * "Thiên Thần Hộ Mệnh" là biết mình có hai lượt khiên nhưng vẫn không biết
 * mình đang chơi cho phe nào để thắng.
 *
 * Minh hoạ dùng chung `ROLE_ICON_PATHS` với bộ bài ở phòng chờ: thẻ vừa lật ra
 * phải là đúng cái thẻ vừa nhìn thấy trong bộ bài, không phải một hình khác.
 */
export function RoleCard({ role }: { role: Role | undefined }) {
  if (!role) {
    return (
      <div className="card text-center text-mist/85">Đang chờ server chia vai trò...</div>
    );
  }
  const meta = ROLE_META[role];
  const skin = TEAM_SKIN[meta.team];

  return (
    <div className={`card border-2 text-center ${skin.card}`}>
      <span className={`mx-auto grid h-20 w-20 place-items-center rounded-full ring-1 ${skin.halo}`}>
        <svg
          viewBox="0 0 512 512"
          aria-hidden="true"
          className={`h-11 w-11 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] ${skin.fill}`}
        >
          <path d={ROLE_ICON_PATHS[role]} />
        </svg>
      </span>

      <p className={`mt-3 text-[11px] font-bold uppercase tracking-[0.25em] ${skin.label}`}>
        Phe {TEAM_LABELS[meta.team]}
      </p>
      <h2 className={`mt-1 font-display text-3xl font-bold ${skin.title}`}>{meta.name}</h2>

      <div className="mt-4 space-y-2 text-left">
        <Line label="Kỹ năng">{meta.description}</Line>
        <Line label="Mục tiêu">{roleGoal(role)}</Line>
      </div>
    </div>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-white/[0.06] bg-night-900/50 px-3 py-2 text-sm text-mist/85">
      <span className="mr-1.5 text-[11px] font-bold uppercase tracking-wider text-mist/85">
        {label}
      </span>
      {children}
    </p>
  );
}

/**
 * Luật riêng của Kẻ Nguyền Rủa, chỉ hiện cho chính họ. Không bao giờ suy ra từ
 * người khác: snapshot của người khác không mang cờ cursedTurned.
 */
export function CursedNote({ snapshot }: { snapshot: RoomSnapshot }) {
  const note = myCursedNote(snapshot);
  if (!note) return null;
  return (
    <p className="rounded-lg border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
      🩸 {note}
    </p>
  );
}

export function RoleRevealView({ snapshot }: { snapshot: RoomSnapshot }) {
  const [revealed, setRevealed] = useState(false);
  const role = snapshot.you?.role;

  const hide = useCallback(() => setRevealed(false), []);

  /*
   * Lưới an toàn khi đang ngửa thẻ.
   *
   * Không phải thứ trang trí: mặt úp là cái nút, và ngay khi lật, mặt ấy quay
   * lưng lại - trình duyệt có thể thôi không bắn `pointerup` vào nó nữa. Nếu
   * chỉ trông vào handler trên nút thì có máy sẽ giữ thẻ ngửa vĩnh viễn sau
   * một lần nhấn, tức là quay về đúng cái hành vi vừa bỏ đi.
   *
   * `blur` và `visibilitychange` là phần còn lại của cùng một lời hứa: chuyển
   * app, khoá máy hay bị gọi điện thì thẻ phải úp trước khi màn hình rời khỏi
   * tay người chơi, chứ không phải nằm đó chờ người kế tiếp nhìn vào.
   */
  useEffect(() => {
    if (!revealed) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hide();
    };
    window.addEventListener("pointerup", hide);
    window.addEventListener("pointercancel", hide);
    window.addEventListener("blur", hide);
    window.addEventListener("contextmenu", hide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pointerup", hide);
      window.removeEventListener("pointercancel", hide);
      window.removeEventListener("blur", hide);
      window.removeEventListener("contextmenu", hide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [revealed, hide]);

  return (
    <div className="space-y-4">
      {/*
        * Lật thẻ chứ không đổi thẻ.
        *
        * Hai mặt xếp chồng trong cùng MỘT ô lưới, nên khung cao bằng mặt cao
        * hơn và không nhảy giữa chừng lúc lật. Đây là khoảnh khắc duy nhất
        * trong ván mà người chơi nhận thông tin không ai khác có, nên nó đáng
        * một nhịp riêng thay vì thay nội dung phắt một cái.
        *
        * Cố ý KHÔNG có chuyển cảnh toàn màn hình ở đây: mọi cảnh khác đều là
        * chuyện chung của cả làng, còn cái này là chuyện riêng, và một màn hình
        * lớn sáng rực đúng lúc người ngồi cạnh đang liếc sang là hỏng cả ván.
        */}
      <div className="grid [perspective:1200px]">
        <m.div
          className="col-start-1 row-start-1 grid [transform-style:preserve-3d]"
          initial={false}
          animate={{ rotateY: revealed ? 180 : 0 }}
          transition={{ duration: 0.62, ease: [0.32, 0.72, 0.24, 1] }}
        >
          <button
            type="button"
            aria-pressed={revealed}
            // `setPointerCapture` là thứ giữ cho cú lật sống được tới lúc thả
            // tay. Ngay khi thẻ quay quá 90 độ, `backface-visibility` rút mặt
            // úp khỏi hit-test và mặt ngửa nhảy lên làm đích - trình duyệt lập
            // tức bắn `pointerout` vào nút dù con trỏ chưa hề nhúc nhích. Bắt
            // pointer về nút thì mọi sự kiện của ngón/chuột ấy vẫn đi thẳng
            // vào đây bất kể bên dưới là mặt nào, nên thẻ ở yên cho tới
            // `pointerup` thật. (Cảm ứng đã có capture ngầm sẵn; đây là trả
            // cùng luật đó cho chuột.)
            onPointerDown={(e) => {
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Trình duyệt cũ không có capture: lưới `pointerup` ở `window`
                // bên dưới vẫn lo được phần úp thẻ.
              }
              setRevealed(true);
            }}
            onPointerUp={hide}
            onPointerCancel={hide}
            // Giữ lâu trên di động mở menu "sao chép ảnh/chia sẻ" và nhả tay ra
            // ngoài menu đó - chặn ở đây thì cái menu không bao giờ che mất thẻ
            // vừa ngửa, và thẻ úp lại ngay thay vì nằm dưới menu.
            onContextMenu={(e) => {
              e.preventDefault();
              hide();
            }}
            // Space/Enter phải theo đúng luật của chuột: giữ mới thấy, thả là
            // hết. `preventDefault` để Space không cuộn trang, `repeat` để giữ
            // lâu không bắn hàng chục lần setState.
            onKeyDown={(e) => {
              if (e.key !== " " && e.key !== "Enter") return;
              e.preventDefault();
              if (!e.repeat) setRevealed(true);
            }}
            onKeyUp={(e) => {
              if (e.key === " " || e.key === "Enter") hide();
            }}
            // Tab đi chỗ khác lúc đang giữ phím thì `keyup` rơi vào phần tử
            // khác, không ai úp thẻ lại nữa.
            onBlur={hide}
            // `touch-none`/`select-none`: giữ lâu là thao tác của thẻ này, không
            // phải cái mở đầu cho cuộn trang hay bôi đen chữ.
            className="col-start-1 row-start-1 w-full select-none touch-none rounded-2xl border-2 border-night-600 bg-night-800 py-16 text-center transition [backface-visibility:hidden] [-webkit-touch-callout:none] hover:border-blood-500 focus-visible:border-blood-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blood-500/70 focus-visible:ring-offset-2 focus-visible:ring-offset-night-900"
          >
            <div className="text-5xl" aria-hidden="true">
              🌙
            </div>
            <p className="mt-3 font-semibold text-white">Nhấn giữ để xem, thả ra để úp lại</p>
            <p className="text-sm text-mist/85">Không ai khác được nhìn thấy</p>
          </button>
          {/*
            * Úp thẻ phải úp cho CẢ trình đọc màn hình, không chỉ cho mắt.
            *
            * `backface-visibility:hidden` chỉ giấu pixel. Cây accessibility
            * không biết gì về xoay 3D, nên khi chưa ai giữ thẻ, một người dùng
            * screen reader vẫn nghe đọc trọn vai trò của mình - bí mật ấy rò ra
            * theo đường âm thanh, ngay giữa bàn, đúng cái mà nhấn-giữ-để-nhìn
            * sinh ra để chặn.
            *
            * `inert` gánh nốt phần bàn phím: mặt ngửa đang úp không được nằm
            * trong vòng Tab. Cố ý KHÔNG dùng `hidden`/`display:none` - hai thứ
            * đó rút mặt ngửa khỏi lưới và làm khung sụp lúc lật.
            */}
          <div
            aria-hidden={!revealed}
            inert={!revealed}
            className={`col-start-1 row-start-1 [backface-visibility:hidden] [transform:rotateY(180deg)] ${
              revealed ? "" : "pointer-events-none"
            }`}
          >
            <RoleCard role={role} />
          </div>
        </m.div>
      </div>

      {revealed && (
        <>
          {/*
            * Cảnh báo bảo mật đặt SAU thẻ chứ không phải trước: trước khi lật
            * thì chưa có gì để lộ, còn ngay sau khi lật mới đúng là lúc màn
            * hình đang mang bí mật và người chơi hay quay sang khoe.
            */}
          <p className="rounded-lg border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-xs text-amber-200/90">
            <span aria-hidden="true">🔒</span> Đây là thông tin chỉ mình bạn có. Đừng đưa màn hình
            cho người ngồi cạnh xem, và đừng chụp lại gửi vào nhóm chat.
          </p>
          <CursedNote snapshot={snapshot} />
          {role && isWolfPack(role) && (
            <div className="card">
              <p className="mb-2 text-sm font-semibold text-blood-400">Đồng bọn của bạn:</p>
              {(() => {
                const mates = snapshot.players.filter(
                  (p) => p.id !== snapshot.you?.id && p.role && isWolfPack(p.role),
                );
                return mates.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {mates.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-blood-500" />
                        {p.name}
                        {!p.alive && <span className="text-mist/85">(đã chết)</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-mist/85">Bạn là Ma Sói duy nhất.</p>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
