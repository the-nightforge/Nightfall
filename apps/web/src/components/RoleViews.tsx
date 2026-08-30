"use client";

import { useState } from "react";
import { m } from "motion/react";
import { ROLE_META, type Role, type RoomSnapshot } from "@masoi/shared";
import { myCursedNote } from "@/lib/cursed";
import { roleGoal } from "@/lib/role-goal";
import { ROLE_ICON_PATHS } from "@/lib/role-art";

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
      <div className="card text-center text-mist/70">Đang chờ server chia vai trò...</div>
    );
  }
  const meta = ROLE_META[role];
  const isWolf = meta.team === "wolves";

  return (
    <div
      className={`card border-2 text-center ${
        isWolf ? "border-blood-500 bg-blood-600/10" : "border-emerald-600/60 bg-emerald-900/10"
      }`}
    >
      <span
        className={`mx-auto grid h-20 w-20 place-items-center rounded-full ring-1 ${
          isWolf
            ? "bg-gradient-to-br from-blood-600/30 to-blood-900/25 ring-blood-500/35"
            : "bg-gradient-to-br from-emerald-600/25 to-emerald-900/25 ring-emerald-500/30"
        }`}
      >
        <svg
          viewBox="0 0 512 512"
          aria-hidden="true"
          className={`h-11 w-11 drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] ${
            isWolf ? "fill-blood-300" : "fill-emerald-200"
          }`}
        >
          <path d={ROLE_ICON_PATHS[role]} />
        </svg>
      </span>

      <p
        className={`mt-3 text-[11px] font-bold uppercase tracking-[0.25em] ${
          isWolf ? "text-blood-400/90" : "text-emerald-300/90"
        }`}
      >
        {isWolf ? "Phe Ma Sói" : "Phe Dân Làng"}
      </p>
      <h2
        className={`mt-1 font-display text-3xl font-bold ${
          isWolf ? "text-blood-400" : "text-emerald-300"
        }`}
      >
        {meta.name}
      </h2>

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
      <span className="mr-1.5 text-[11px] font-bold uppercase tracking-wider text-mist/70">
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
            onClick={() => setRevealed(true)}
            // pointer-events phải tắt tay: mặt quay lưng vẫn ăn click ở một số
            // trình duyệt, và khi đó thẻ đã lật vẫn bị mặt úp chặn mất.
            className={`col-start-1 row-start-1 w-full rounded-2xl border-2 border-night-600 bg-night-800 py-16 text-center transition [backface-visibility:hidden] hover:border-blood-500 ${
              revealed ? "pointer-events-none" : ""
            }`}
          >
            <div className="text-5xl" aria-hidden="true">
              🌙
            </div>
            <p className="mt-3 font-semibold text-white">Chạm để xem vai trò của bạn</p>
            <p className="text-sm text-mist/70">Không ai khác được nhìn thấy</p>
          </button>
          <div
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
          {role === "WEREWOLF" && (
            <div className="card">
              <p className="mb-2 text-sm font-semibold text-blood-400">Đồng bọn của bạn:</p>
              {(() => {
                const mates = snapshot.players.filter(
                  (p) => p.id !== snapshot.you?.id && p.role === "WEREWOLF",
                );
                return mates.length > 0 ? (
                  <ul className="space-y-1 text-sm">
                    {mates.map((p) => (
                      <li key={p.id} className="flex items-center gap-2">
                        <span className="inline-block h-2 w-2 rounded-full bg-blood-500" />
                        {p.name}
                        {!p.alive && <span className="text-mist/65">(đã chết)</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-mist/70">Bạn là Ma Sói duy nhất.</p>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
