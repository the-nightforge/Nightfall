"use client";

import { useState } from "react";
import { ROLE_META, type RoomSnapshot } from "@masoi/shared";
import { PlayerGrid } from "./PlayerGrid";
import { canActAtNight } from "@/lib/night-role";

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
  if (!meta || !canActAtNight(role)) {
    return (
      <div className="card text-center">
        <p className="text-2xl">😴</p>
        <p className="mt-2 font-semibold text-white">Đêm đã xuống...</p>
        <p className="text-sm text-mist/70">Bạn nhắm mắt ngủ và chờ buổi sáng.</p>
      </div>
    );
  }

  const acted = night?.acted ?? false;
  const locked = night?.wolvesLocked ?? false;
  const nameOf = (id: string | null | undefined) =>
    snapshot.players.find((p) => p.id === id)?.name ?? "?";
  const aliveOthers = (opts?: { selectable?: boolean; disabledIds?: string[]; allowSelf?: boolean }) => (
    <PlayerGrid
      snapshot={snapshot}
      selectable={opts?.selectable ?? !acted}
      selectedId={selected}
      onSelect={setSelected}
      disabledIds={opts?.disabledIds}
      allowSelf={opts?.allowSelf}
    />
  );

  // Sói bỏ phiếu chứ không chốt, nên nhãn "Đã hành động" của các vai khác sẽ nói sai.
  const showActedBadge = acted && role !== "WEREWOLF";

  return (
    <div className="space-y-4">
      <div className={`card ${acted ? "opacity-80" : ""}`}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className={`font-bold ${meta.team === "wolves" ? "text-blood-400" : "text-indigo-300"}`}>
            Vai trò của bạn: {meta.name}
          </h3>
          {showActedBadge && <span className="badge-phase bg-emerald-900/60 text-emerald-300">Đã hành động</span>}
        </div>

        {/* MA SÓI */}
        {role === "WEREWOLF" && (
          <>
            <WolfTally snapshot={snapshot} nameOf={nameOf} />
            {locked ? (
              <p className="mb-2 rounded-lg bg-night-800 p-2 text-sm text-blood-400">
                {night?.wolfTarget ? (
                  <>
                    Bầy sói đã chốt: <b>{nameOf(night.wolfTarget)}</b>.
                  </>
                ) : (
                  "Bầy sói đã chốt: đêm nay không cắn ai."
                )}
              </p>
            ) : (
              <>
                {aliveOthers({
                  selectable: true,
                  disabledIds: snapshot.players.filter((p) => p.role === "WEREWOLF").map((p) => p.id),
                })}
                <button
                  className="btn-primary mt-3 w-full"
                  disabled={!selected}
                  onClick={() => selected && onAction("KILL", selected)}
                >
                  {acted ? "Đổi phiếu cắn" : "Bầu cắn mục tiêu"}
                </button>
                <button className="btn-secondary mt-2 w-full" onClick={() => onAction("SKIP", null)}>
                  Bầu không cắn đêm nay
                </button>
                <p className="mt-2 text-center text-xs text-mist/50">
                  Phiếu chốt khi hết giờ. Hoà phiếu sẽ bốc ngẫu nhiên trong nhóm dẫn đầu.
                </p>
              </>
            )}
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
              Bạn có thể tự bảo vệ mình, nhưng không thể bảo vệ cùng một người hai đêm liên tiếp.
              {night?.guardPrevious && (
                <>
                  {" "}
                  Đêm trước bạn đã đỡ <b className="text-white">{nameOf(night.guardPrevious)}</b>.
                </>
              )}
            </p>
            {aliveOthers({
              allowSelf: true,
              disabledIds: night?.guardPrevious ? [night.guardPrevious] : undefined,
            })}
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
              <span
                className={`rounded px-2 py-1 ${night?.healUsed ? "bg-night-700 text-mist/40 line-through" : "bg-emerald-900/50 text-emerald-300"}`}
              >
                Bình cứu: {night?.healUsed ? "đã dùng" : "còn"}
              </span>
              <span
                className={`rounded px-2 py-1 ${night?.poisonUsed ? "bg-night-700 text-mist/40 line-through" : "bg-blood-600/30 text-blood-400"}`}
              >
                Bình độc: {night?.poisonUsed ? "đã dùng" : "còn"}
              </span>
            </div>

            {!locked ? (
              <p className="rounded-lg bg-night-800 p-3 text-center text-sm text-mist/70">
                🌙 Bầy sói đang chọn con mồi. Chờ chúng ra tay xong bạn mới quyết định
                có cứu hay không.
              </p>
            ) : (
              <>
                <p className="rounded-lg bg-night-800 p-2 text-sm">
                  {night?.wolfTarget ? (
                    <>
                      Đêm nay bầy sói cắn <b className="text-blood-400">{nameOf(night.wolfTarget)}</b>.
                    </>
                  ) : (
                    "Đêm nay bầy sói không cắn ai."
                  )}
                </p>

                {!night?.healUsed && night?.wolfTarget && (
                  <button
                    className="btn-secondary w-full border border-emerald-600/50"
                    disabled={acted}
                    onClick={() => onAction("HEAL", null)}
                  >
                    🧪 Cứu {nameOf(night.wolfTarget)}
                  </button>
                )}

                {!night?.poisonUsed && (
                  <>
                    {!poisoning ? (
                      <button
                        className="btn-secondary w-full border border-blood-500/50"
                        disabled={acted}
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

                <button
                  className="btn-secondary w-full"
                  disabled={acted}
                  onClick={() => onAction("SKIP", null)}
                >
                  Không dùng thuốc đêm nay
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Bảng phiếu cắn của bầy sói: ai đang dẫn, còn bao nhiêu sói chưa bầu. */
function WolfTally({
  snapshot,
  nameOf,
}: {
  snapshot: RoomSnapshot;
  nameOf: (id: string | null | undefined) => string;
}) {
  const night = snapshot.night;
  const counts = night?.wolfVoteCounts ?? {};
  const skip = night?.wolfSkipVotes ?? 0;
  const required = night?.wolfVotesRequired ?? 0;
  const cast = Object.values(counts).reduce((sum, n) => sum + n, 0) + skip;
  const voted = night?.acted === true;
  const rows = [
    ...Object.entries(counts).map(([id, count]) => ({
      label: nameOf(id),
      count,
      mine: voted && night?.myWolfVote === id,
    })),
    ...(skip > 0
      ? [{ label: "Không cắn", count: skip, mine: voted && night?.myWolfVote === null }]
      : []),
  ].sort((left, right) => right.count - left.count);

  return (
    <div className="mb-3 rounded-lg bg-night-800 p-2 text-sm">
      <p className="mb-1 text-xs text-mist/60">
        Phiếu cắn: {cast}/{required} sói đã bầu
      </p>
      {rows.length === 0 ? (
        <p className="text-mist/50">Chưa sói nào bầu.</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.label} className="flex justify-between gap-2">
              <span className={row.mine ? "font-semibold text-blood-400" : "text-mist/80"}>
                {row.label}
                {row.mine && " (phiếu của bạn)"}
              </span>
              <span className="text-mist/60">{row.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
