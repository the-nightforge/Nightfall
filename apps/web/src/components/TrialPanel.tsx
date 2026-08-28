"use client";

import type { RoomSnapshot } from "@masoi/shared";
import { PlayerGrid } from "./PlayerGrid";

interface Props {
  snapshot: RoomSnapshot;
  onFinalVote: (guilty: boolean) => void;
}

/**
 * Hai pha của phiên toà dùng chung một component: cả hai đều xoay quanh đúng
 * một bị cáo và cùng bảng phiếu sơ bộ, tách đôi chỉ tạo hai chỗ để lệch nhau.
 */
export function TrialPanel({ snapshot, onFinalVote }: Props) {
  const trial = snapshot.trial;
  if (!trial) return null;

  const dead = !snapshot.you?.alive;
  const isAccused = snapshot.you?.id === trial.accusedId;
  const isDefense = snapshot.phase === "DEFENSE";

  return (
    <div className="space-y-4">
      <div className="card border border-amber-500/40 text-center">
        <p className="text-2xl">⚖️</p>
        <p className="mt-1 text-sm text-mist/70">
          {isDefense ? "Đang biện hộ" : "Bỏ phiếu xác nhận"}
        </p>
        <p className="text-lg font-bold text-white">{trial.accusedName}</p>
        <p className="mt-1 text-xs text-mist/60">
          bị đề cử với{" "}
          {snapshot.players.find((p) => p.id === trial.accusedId)?.voteCount ?? 0} phiếu sơ bộ
        </p>
      </div>

      {isDefense ? (
        <div className="card text-center">
          {isAccused ? (
            <p className="font-semibold text-amber-200">
              Bạn đang bị buộc tội. Hãy tự bào chữa trong khung chat bên dưới.
            </p>
          ) : (
            <p className="text-sm text-mist/70">
              Chỉ <span className="font-semibold text-white">{trial.accusedName}</span> được nói lúc
              này. Hãy nghe rồi quyết.
            </p>
          )}
        </div>
      ) : (
        <div className={`card ${dead ? "opacity-70" : ""}`}>
          <h3 className="mb-1 font-bold text-white">
            {isAccused
              ? "Bạn không được bỏ phiếu cho chính mình"
              : dead
                ? "Bạn đã chết - không được bỏ phiếu"
                : `Treo cổ ${trial.accusedName}?`}
          </h3>
          <p className="mb-3 text-xs text-mist/60">
            Cần {trial.guiltyRequired} phiếu Treo để kết án. Không bỏ phiếu tính là Tha.
          </p>

          <div className="flex gap-2 text-center text-sm">
            <div className="flex-1 rounded-lg bg-night-800 px-3 py-2">
              <div className="text-lg font-bold text-blood-400">{trial.guiltyVotes}</div>
              <div className="text-xs text-mist/60">Treo</div>
            </div>
            <div className="flex-1 rounded-lg bg-night-800 px-3 py-2">
              <div className="text-lg font-bold text-emerald-300">{trial.innocentVotes}</div>
              <div className="text-xs text-mist/60">Tha</div>
            </div>
          </div>

          {trial.canVote ? (
            <div className="mt-3 flex gap-2">
              <button className="btn-primary flex-1" onClick={() => onFinalVote(true)}>
                Treo cổ
              </button>
              <button className="btn-secondary flex-1" onClick={() => onFinalVote(false)}>
                Tha
              </button>
            </div>
          ) : (
            // Đọc hasVoted chứ không dùng truthiness của myVote: myVote === false
            // là một phiếu Tha đã bỏ, không phải "chưa bỏ phiếu".
            trial.hasVoted && (
              <p className="mt-3 text-center text-sm text-emerald-300">
                Bạn đã chọn {trial.myVote ? "Treo cổ" : "Tha"}. Đang chờ người khác...
              </p>
            )
          )}
        </div>
      )}

      {/* Chỉ để đọc: số phiếu sơ bộ vẫn hiện, không ai chọn lại được ai. */}
      <PlayerGrid snapshot={snapshot} selectable={false} />
    </div>
  );
}
