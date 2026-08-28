"use client";

import { useState } from "react";
import { MIN_PLAYERS_TO_START, validateRoomConfig, type RoomConfig, type RoomSnapshot } from "@masoi/shared";
import type { Identity } from "@/lib/identity";

interface Props {
  snapshot: RoomSnapshot;
  identity: Identity;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onKick: (playerId: string) => void;
  onAddBot: () => void;
  onLeave: () => void;
  onUpdateConfig: (config: RoomConfig) => void;
}

export function Lobby({ snapshot, identity, onReady, onStart, onKick, onAddBot, onLeave, onUpdateConfig }: Props) {
  const isHost = snapshot.hostId === identity.playerId;
  const me = snapshot.players.find((p) => p.id === identity.playerId);
  const count = snapshot.players.length;
  const configError = validateRoomConfig(snapshot.config, count);
  const myReady = me?.ready ?? false;
  const unreadyGuests = snapshot.players.filter(
    (player) => !player.isBot && player.id !== snapshot.hostId && !player.ready,
  );

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-white">Người chơi ({count})</h2>
          <span className="text-xs text-mist/60">Cần tối thiểu {MIN_PLAYERS_TO_START} người</span>
        </div>
        <ul className="space-y-2">
          {snapshot.players.map((p) => (
            <li
              key={p.id}
              className={`flex items-center justify-between rounded-lg px-3 py-2 ${snapshot.hostId === p.id ? "bg-night-800 border border-amber-700/40" : "bg-night-800"}`}
            >
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${me?.id === p.id ? "bg-indigo-400" : "bg-night-600"}`} />
                <span className="text-sm font-semibold text-white">{p.name}</span>
                {snapshot.hostId === p.id && (
                  <span className="rounded bg-amber-800/80 px-1.5 text-[10px] font-bold text-amber-200">CHỦ PHÒNG</span>
                )}
                {p.isBot && <span className="rounded bg-slate-700 px-1.5 text-[10px] font-bold text-slate-200">BOT</span>}
                {!p.alive && <span />}
              </div>
              <div className="flex items-center gap-2">
                {p.isBot ? (
                  <span className="text-xs text-emerald-300">Sẵn sàng</span>
                ) : (
                  <span className={`text-xs font-semibold ${p.ready ? "text-emerald-300" : "text-mist/50"}`}>
                    {p.ready ? "Sẵn sàng" : `Chưa sẵn sàng${p.connected === false ? " (mất kết nối)" : ""}`}
                  </span>
                )}
                {isHost && p.id !== identity.playerId && (
                  <button
                    className="rounded px-2 py-1 text-xs text-blood-400 hover:bg-blood-600/20"
                    onClick={() => onKick(p.id)}
                  >
                    Loại
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        {isHost ? (
          <>
            <button
              className="btn-primary w-full"
              onClick={onStart}
              disabled={!!configError || count < MIN_PLAYERS_TO_START || unreadyGuests.length > 0}
            >
              Bắt đầu trận đấu
            </button>
            <button className="btn-secondary w-full" onClick={onAddBot} disabled={count >= 15}>
              + Thêm bot (để test một mình)
            </button>
          </>
        ) : (
          <button className="btn-primary w-full" onClick={() => onReady(!myReady)}>
            {myReady ? "Huỷ sẵn sàng" : "Tôi đã sẵn sàng!"}
          </button>
        )}
        {configError && count >= MIN_PLAYERS_TO_START && (
          <p className="text-center text-xs text-blood-400">{configError}</p>
        )}
        {count < MIN_PLAYERS_TO_START && (
          <p className="text-center text-xs text-mist/50">
            Chờ thêm {MIN_PLAYERS_TO_START - count} người nữa để bắt đầu.
          </p>
        )}
        {isHost && count >= MIN_PLAYERS_TO_START && unreadyGuests.length > 0 && (
          <p className="text-center text-xs text-amber-300">
            Chờ {unreadyGuests.map((player) => player.name).join(", ")} sẵn sàng.
          </p>
        )}
        <button className="btn-secondary w-full" onClick={onLeave}>Rời phòng</button>
      </div>

      {isHost && (
        <HostConfig config={snapshot.config} onSave={onUpdateConfig} />
      )}
    </div>
  );
}

function HostConfig({ config, onSave }: { config: RoomConfig; onSave: (c: RoomConfig) => void }) {
  const [draft, setDraft] = useState<RoomConfig>(config);
  const [dirty, setDirty] = useState(false);

  const set = (patch: Partial<RoomConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  return (
    <details className="card">
      <summary className="cursor-pointer font-semibold text-white">⚙️ Cấu hình vai trò &amp; thời gian</summary>
      <div className="mt-3 space-y-3 text-sm">
        <label className="flex items-center justify-between gap-3">
          <span>Ma Sói</span>
          <select
            className="input w-24"
            value={draft.werewolves}
            onChange={(e) => set({ werewolves: Number(e.target.value) })}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </label>
        {(
          [
            ["seer", "Tiên Tri"],
            ["guard", "Bảo Vệ"],
            ["witch", "Phù Thủy"],
            ["hunter", "Thợ Săn"],
            ["cursed", "Kẻ Nguyền Rủa"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-3">
            <span>{label}</span>
            <input
              type="checkbox"
              className="h-5 w-5 accent-blood-500"
              checked={draft[key]}
              onChange={(e) => set({ [key]: e.target.checked } as Partial<RoomConfig>)}
            />
          </label>
        ))}
        {(
          [
            // Khoảng hợp lệ phải khớp roomConfigSchema; đặc biệt finalVoteSeconds
            // có cận dưới 15 vì chuỗi não bot mất tới 13 giây.
            ["nightSeconds", "Thời gian đêm (giây)", 15, 120],
            ["discussionSeconds", "Thời gian thảo luận (giây)", 30, 300],
            ["voteSeconds", "Thời gian bỏ phiếu sơ bộ (giây)", 15, 120],
            ["defenseSeconds", "Thời gian biện hộ (giây)", 10, 60],
            ["finalVoteSeconds", "Thời gian bỏ phiếu xác nhận (giây)", 15, 60],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key} className="block">
            <span className="text-mist/80">{label}</span>
            <input
              type="number"
              className="input mt-1"
              min={min}
              max={max}
              value={draft[key]}
              onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<RoomConfig>)}
            />
          </label>
        ))}
        <button
          className="btn-primary w-full"
          disabled={!dirty}
          onClick={() => {
            onSave(draft);
            setDirty(false);
          }}
        >
          Lưu cấu hình
        </button>
      </div>
    </details>
  );
}
