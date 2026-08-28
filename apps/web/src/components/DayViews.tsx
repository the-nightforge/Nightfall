"use client";

import { useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { roleLabel } from "@/lib/cursed";
import { PlayerGrid } from "./PlayerGrid";
import { HunterShotTimeline } from "./HunterShotTimeline";
import { NightRecapTimeline } from "./NightRecapTimeline";

interface Props {
  snapshot: RoomSnapshot;
  /** null nghĩa là "Không treo ai" - một lựa chọn, không phải huỷ phiếu. */
  onVote: (targetId: string | null) => void;
  onSkipDiscussion: (skip: boolean) => void;
}

export function DayView({ snapshot, onVote, onSkipDiscussion }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const isVoting = snapshot.phase === "VOTING";
  const dead = !snapshot.you?.alive;
  const myVote = snapshot.myVote;
  // Phải dùng cờ này chứ không dùng truthiness của myVote: một phiếu "không treo
  // ai" cũng có myVote === null, và khoá UI theo myVote sẽ để ngỏ lá phiếu đó.
  const hasVoted = snapshot.hasVoted;
  const discussionSkip = snapshot.discussionSkip;

  return (
    <div className="space-y-4">
      {snapshot.phase === "NIGHT_RESULT" && (
        <div className="card text-center">
          <p className="text-2xl">🌅</p>
          {snapshot.lastNightDeaths.length > 0 ? (
            <>
              <p className="font-semibold text-blood-400">Đêm qua {snapshot.lastNightDeaths.length} người đã mất:</p>
              <p className="mt-1 text-white">
                {snapshot.lastNightDeaths.map((d) => d.name).join(", ")}
              </p>
            </>
          ) : (
            <p className="mt-1 font-semibold text-emerald-300">
              Trời sáng, không ai mất tích. Một đêm bình yên!
            </p>
          )}
        </div>
      )}

      {isVoting && (
        <div className={`card ${dead ? "opacity-70" : ""}`}>
          <h3 className="mb-2 font-bold text-white">
            {dead ? "Bạn đã chết - không được bỏ phiếu" : "Chọn người bạn nghi là Ma Sói"}
          </h3>
          {hasVoted && !dead && (
            <p className="mb-2 text-sm text-emerald-300">
              {myVote
                ? `Bạn đã bỏ phiếu cho ${snapshot.players.find((p) => p.id === myVote)?.name}.`
                : "Bạn đã chọn không treo ai."}
              {" Đang chờ người khác..."}
            </p>
          )}
          <PlayerGrid
            snapshot={snapshot}
            selectable={!dead && !hasVoted}
            selectedId={selected ?? myVote}
            onSelect={setSelected}
          />
          {!dead && !hasVoted ? (
            <>
              <button
                className="btn-primary mt-3 w-full"
                disabled={!selected}
                onClick={() => selected && onVote(selected)}
              >
                Bỏ phiếu
              </button>
              <button className="btn-secondary mt-2 w-full" onClick={() => onVote(null)}>
                Không treo ai ({snapshot.noEliminationVoteCount} phiếu)
              </button>
            </>
          ) : (
            // Người chết và người đã vote chỉ theo dõi tiến độ, không có thao tác.
            <p className="mt-3 text-center text-xs text-mist/60">
              Không treo ai: {snapshot.noEliminationVoteCount} phiếu
            </p>
          )}
        </div>
      )}

      {snapshot.phase === "DAY_DISCUSSION" && (
        <div className="card text-center">
          <p className="text-2xl">☀️</p>
          <p className="font-semibold text-white">Thảo luận! Ai là Ma Sói?</p>
          <p className="text-sm text-mist/70">Dùng khung chat bên dưới để tranh luận.</p>
          {discussionSkip && (
            discussionSkip.canVote ? (
              <div className="mt-3">
                <button
                  className={discussionSkip.hasVoted ? "btn-secondary w-full" : "btn-primary w-full"}
                  onClick={() => onSkipDiscussion(!discussionSkip.hasVoted)}
                >
                  {discussionSkip.hasVoted ? "Huỷ skip" : "Skip thảo luận"}
                  {` (${discussionSkip.votes}/${discussionSkip.required})`}
                </button>
                <p className="mt-1 text-xs text-mist/50">
                  Cần toàn bộ người thật còn sống và đang online đồng ý.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-xs text-mist/60">
                Người chơi còn sống muốn skip: {discussionSkip.votes}/{discussionSkip.required}
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function EliminationView({ snapshot }: { snapshot: RoomSnapshot }) {
  return (
    <div className="card text-center">
      <p className="text-2xl">⚖️</p>
      {snapshot.lastEliminated ? (
        <>
          <p className="mt-1 font-semibold text-white">
            Làng đã quyết định loại <span className="text-blood-400">{snapshot.lastEliminated.name}</span>.
          </p>
          {(() => {
            const p = snapshot.players.find((x) => x.id === snapshot.lastEliminated!.playerId);
            if (p?.role) {
              const wolf = p.role === "WEREWOLF";
              return (
                <p className={`mt-1 text-sm font-semibold ${wolf ? "text-emerald-300" : "text-blood-400"}`}>
                  Hắn/Họ là... {wolf ? "MA SÓI!" : "Dân làng vô tội!"}
                </p>
              );
            }
            return null;
          })()}
        </>
      ) : snapshot.lastTrial ? (
        // Được tha là một kết cục riêng: lastEliminated === null không phân biệt
        // được nó với hoà phiếu hay "không treo ai" thắng.
        <>
          <p className="mt-1 font-semibold text-white">
            Làng đã tha <span className="text-emerald-300">{snapshot.lastTrial.accused.name}</span>.
          </p>
          <p className="mt-1 text-sm text-mist/70">
            {snapshot.lastTrial.guilty} phiếu treo - {snapshot.lastTrial.innocent} phiếu tha
            {snapshot.lastTrial.abstain > 0 && `, ${snapshot.lastTrial.abstain} không bỏ phiếu`}.
          </p>
        </>
      ) : (
        // Không còn khẳng định hoà phiếu: không ai bị loại giờ có hai lý do
        // (hoà, hoặc "Không treo ai" thắng) mà snapshot không phân biệt.
        <p className="mt-1 font-semibold text-white">Không ai bị loại hôm nay.</p>
      )}
    </div>
  );
}

export function GameOverView({
  snapshot,
  isHost,
  onReset,
  onLeave,
}: {
  snapshot: RoomSnapshot;
  isHost: boolean;
  onReset: () => void;
  onLeave: () => void;
}) {
  const wolvesWin = snapshot.winner === "wolves";
  return (
    <div className="space-y-4">
      <div className={`card border-2 text-center py-8 ${wolvesWin ? "border-blood-500 bg-blood-600/10" : "border-emerald-500/60 bg-emerald-900/10"}`}>
        <div className="text-5xl">{wolvesWin ? "🐺" : "🎉"}</div>
        <h2 className={`mt-3 text-2xl font-bold ${wolvesWin ? "text-blood-400" : "text-emerald-300"}`}>
          {wolvesWin ? "Phe Ma Sói chiến thắng!" : "Phe Dân Làng chiến thắng!"}
        </h2>
      </div>

      <div className="card">
        <h3 className="mb-2 font-semibold text-white">Vai trò của tất cả mọi người:</h3>
        <ul className="space-y-2 text-sm">
          {snapshot.players.map((p) => (
            <li key={p.id} className="flex items-center justify-between rounded-lg bg-night-800 px-3 py-2">
              <span className={p.alive ? "text-white" : "text-mist/50 line-through"}>{p.name}</span>
              <span className={p.role === "WEREWOLF" ? "font-semibold text-blood-400" : "text-emerald-300"}>
                {roleLabel(p)}
                {!p.alive && " (đã chết)"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <NightRecapTimeline nights={snapshot.nightHistory} />
      <HunterShotTimeline shots={snapshot.hunterShots} />

      <div className="flex gap-2">
        {isHost && <button className="btn-primary flex-1" onClick={onReset}>Chơi lại (về phòng chờ)</button>}
        <button className="btn-secondary flex-1" onClick={onLeave}>Rời phòng</button>
      </div>
      {!isHost && <p className="text-center text-xs text-mist/50">Chờ chủ phòng bấm chơi lại hoặc rời phòng.</p>}
    </div>
  );
}
