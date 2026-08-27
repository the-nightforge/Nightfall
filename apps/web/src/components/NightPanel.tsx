"use client";

import { useState } from "react";
import { ROLE_META, type RoomSnapshot } from "@masoi/shared";
import { PlayerGrid } from "./PlayerGrid";

interface Props {
  snapshot: RoomSnapshot;
  onAction: (type: string, targetId?: string | null) => void;
}

export function NightPanel({ snapshot, onAction }: Props) {
  const role = snapshot.you?.role;
  const night = snapshot.night;
  const [selected, setSelected] = useState<string | null>(null);
  const [poisoning, setPoisoning] = useState(false);

  if (!snapshot.you?.alive) {
    return (
      <div className="card text-center text-mist/60">
        <p className="text-2xl">💀</p>
        Bạn đã chết. Hãy trò chuyện cùng những người chết khác ở khung chat bên dưới.
      </div>
    );
  }

  const meta = role ? ROLE_META[role] : null;

  // Dân thường: chỉ ngủ
  if (!meta?.nightOrder) {
    return (
      <div className="card text-center">
        <p className="text-2xl">😴</p>
        <p className="mt-2 font-semibold text-white">Đêm đã xuống...</p>
        <p className="text-sm text-mist/70">Bạn nhắm mắt ngủ và chờ buổi sáng.</p>
      </div>
    );
  }

  const acted = night?.acted ?? false;
  const aliveOthers = () => (
    <PlayerGrid
      snapshot={snapshot}
      selectable={!acted}
      selectedId={selected}
      onSelect={setSelected}
    />
  );

  return (
    <div className="space-y-4">
      <div className={`card ${acted ? "opacity-80" : ""}`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className={`font-bold ${meta.team === "wolves" ? "text-blood-400" : "text-indigo-300"}`}>
            Vai trò của bạn: {meta.name}
          </h3>
          {acted && <span className="badge-phase bg-emerald-900/60 text-emerald-300">Đã hành động</span>}
        </div>

        {/* MA SÓI */}
        {role === "WEREWOLF" && (
          <>
            {night?.wolfTarget && (
              <p className="mb-2 text-sm text-blood-400">
                Cả bọn đang nhắm vào:{" "}
                <b>{snapshot.players.find((p) => p.id === night.wolfTarget)?.name ?? "?"}</b>
              </p>
            )}
            {aliveOthers()}
            <button
              className="btn-primary mt-3 w-full"
              disabled={!selected || acted}
              onClick={() => selected && onAction("KILL", selected)}
            >
              Cắn mục tiêu
            </button>
          </>
        )}

        {/* TIÊN TRI */}
        {role === "SEER" && (
          <>
            {night?.seerResult && (
              <p className="mb-2 rounded-lg bg-night-800 p-2 text-sm">
                Kết quả soi gần nhất: <b>{night.seerResult.targetName}</b> là{" "}
                <b className={night.seerResult.isWolf ? "text-blood-400" : "text-emerald-300"}>
                  {night.seerResult.isWolf ? "Ma Sói!" : "Phe làng"}
                </b>
              </p>
            )}
            {aliveOthers()}
            <button
              className="btn-primary mt-3 w-full"
              disabled={!selected || acted}
              onClick={() => selected && onAction("SEE", selected)}
            >
              Soi người này
            </button>
          </>
        )}

        {/* BẢO VỆ */}
        {role === "GUARD" && (
          <>
            <p className="mb-2 text-sm text-mist/70">
              Không thể bảo vệ cùng một người hai đêm liên tiếp.
            </p>
            {aliveOthers()}
            <button
              className="btn-primary mt-3 w-full"
              disabled={!selected || acted}
              onClick={() => selected && onAction("GUARD", selected)}
            >
              Bảo vệ người này
            </button>
          </>
        )}

        {/* PHÙ THỦY */}
        {role === "WITCH" && (
          <div className="space-y-3">
            <div className="flex gap-2 text-sm">
              <span className={`rounded px-2 py-1 ${night?.healUsed ? "bg-night-700 text-mist/40 line-through" : "bg-emerald-900/50 text-emerald-300"}`}>
                Bình cứu: {night?.healUsed ? "đã dùng" : "còn"}
              </span>
              <span className={`rounded px-2 py-1 ${night?.poisonUsed ? "bg-night-700 text-mist/40 line-through" : "bg-blood-600/30 text-blood-400"}`}>
                Bình độc: {night?.poisonUsed ? "đã dùng" : "còn"}
              </span>
            </div>

            {!night?.healUsed && (
              <button
                className="btn-secondary w-full border border-emerald-600/50"
                disabled={acted}
                onClick={() => onAction("HEAL", null)}
              >
                🧪 Dùng bình cứu (cứu nạn nhân đêm nay)
              </button>
            )}

            {!night?.poisonUsed && (
              <>
                {!poisoning ? (
                  <button
                    className="btn-secondary w-full border border-blood-500/50"
                    onClick={() => setPoisoning(true)}
                  >
                    ☠️ Chọn người để đầu độc
                  </button>
                ) : (
                  <>
                    {aliveOthers()}
                    <div className="mt-3 flex gap-2">
                      <button
                        className="btn-primary flex-1"
                        disabled={!selected || acted}
                        onClick={() => selected && onAction("POISON", selected)}
                      >
                        Đầu độc
                      </button>
                      <button className="btn-secondary flex-1" onClick={() => setPoisoning(false)}>
                        Huỷ
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
