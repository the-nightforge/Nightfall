"use client";

import { useState } from "react";
import { ROLE_META, type Role, type RoomSnapshot } from "@masoi/shared";

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
      <h2 className={`mt-2 text-2xl font-bold ${isWolf ? "text-blood-400" : "text-emerald-300"}`}>
        {meta.name}
      </h2>
      <p className="mt-1 text-sm text-mist/80">{meta.description}</p>
    </div>
  );
}

export function RoleRevealView({ snapshot }: { snapshot: RoomSnapshot }) {
  const [revealed, setRevealed] = useState(false);
  const role = snapshot.you?.role;

  return (
    <div className="space-y-4">
      {!revealed ? (
        <button
          onClick={() => setRevealed(true)}
          className="w-full rounded-2xl border-2 border-night-600 bg-night-800 py-16 text-center transition hover:border-blood-500"
        >
          <div className="text-5xl">🌙</div>
          <p className="mt-3 font-semibold text-white">Chạm để xem vai trò của bạn</p>
          <p className="text-sm text-mist/60">Không ai khác được nhìn thấy</p>
        </button>
      ) : (
        <>
          <RoleCard role={role} />
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
