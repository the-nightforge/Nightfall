"use client";

import { ROLE_META, type RoomSnapshot } from "@masoi/shared";
import { getIdentity } from "@/lib/identity";

interface Props {
  snapshot: RoomSnapshot;
  selectable?: boolean;
  selectedId?: string | null;
  onSelect?: (playerId: string) => void;
  disabledIds?: string[];
  /** Bảo Vệ được tự bảo vệ mình, nên vài lưới đêm phải mở ô của chính người chơi. */
  allowSelf?: boolean;
}

export function PlayerGrid({
  snapshot,
  selectable,
  selectedId,
  onSelect,
  disabledIds = [],
  allowSelf = false,
}: Props) {
  const meId = getIdentity()?.playerId;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {snapshot.players.map((p) => {
        const isMe = p.id === meId;
        const dead = !p.alive;
        const disabled = !selectable || dead || (isMe && !allowSelf) || disabledIds.includes(p.id);
        const selected = selectedId === p.id;
        return (
          <button
            key={p.id}
            disabled={disabled}
            onClick={() => onSelect?.(p.id)}
            className={`relative rounded-lg border px-3 py-2 text-left transition
              ${dead ? "border-night-600 bg-night-950/70 opacity-50 line-through" : "border-night-600 bg-night-800"}
              ${selectable && !disabled ? "hover:border-blood-500 cursor-pointer" : ""}
              ${selected ? "border-blood-500 ring-1 ring-blood-500 bg-blood-600/20" : ""}`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className={`truncate text-sm font-semibold ${dead ? "text-mist/50" : "text-white"}`}>
                {p.name}
              </span>
              {(p.voteCount ?? 0) > 0 && (
                <span className="shrink-0 rounded-full bg-blood-600/80 px-1.5 text-xs font-bold text-white">
                  {p.voteCount}
                </span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              {isMe && <Tag cls="bg-indigo-800 text-indigo-200">Bạn</Tag>}
              {snapshot.hostId === p.id && <Tag cls="bg-amber-800/80 text-amber-200">Chủ phòng</Tag>}
              {!p.alive && <Tag cls="bg-night-700 text-mist/70">Đã chết</Tag>}
              {p.isBot && <Tag cls="bg-slate-700 text-slate-200">Bot</Tag>}
              {p.role && (
                <Tag cls={ROLE_META[p.role].team === "wolves" ? "bg-blood-600/70 text-white" : "bg-emerald-900/70 text-emerald-200"}>
                  {ROLE_META[p.role].name}
                </Tag>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function Tag({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`rounded px-1 py-0.5 text-[10px] font-semibold leading-none ${cls}`}>{children}</span>;
}
