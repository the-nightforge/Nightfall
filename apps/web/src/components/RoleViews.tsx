"use client";

import { useState } from "react";
import { m } from "motion/react";
import { ROLE_META, type Role, type RoomSnapshot } from "@masoi/shared";
import { myCursedNote } from "@/lib/cursed";

export function RoleCard({ role }: { role: Role | undefined }) {
  if (!role) {
    return (
      <div className="card text-center text-mist/60">
        Đang chờ server chia vai trò...
      </div>
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
      <div className="text-4xl">{isWolf ? "🐺" : "🌾"}</div>
      <h2 className={`mt-2 font-display text-3xl font-bold ${isWolf ? "text-blood-400" : "text-emerald-300"}`}>
        {meta.name}
      </h2>
      <p className="mt-1 text-sm text-mist/80">{meta.description}</p>
    </div>
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
            <div className="text-5xl">🌙</div>
            <p className="mt-3 font-semibold text-white">Chạm để xem vai trò của bạn</p>
            <p className="text-sm text-mist/60">Không ai khác được nhìn thấy</p>
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
                        {!p.alive && <span className="text-mist/50">(đã chết)</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-mist/60">Bạn là Ma Sói duy nhất.</p>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
