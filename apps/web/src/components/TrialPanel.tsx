"use client";

import { useMemo } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { assignAvatars, tintFor } from "@/lib/avatar";
import { Avatar } from "./Avatar";

interface Props {
  snapshot: RoomSnapshot;
  onFinalVote: (guilty: boolean) => void;
}

/**
 * Hai pha của phiên toà dùng chung một component: cả hai đều xoay quanh đúng
 * một bị cáo và cùng bảng phiếu sơ bộ, tách đôi chỉ tạo hai chỗ để lệch nhau.
 */
export function TrialPanel({ snapshot, onFinalVote }: Props) {
  const roster = snapshot.players.map((p) => p.id).join(",");
  const avatars = useMemo(() => assignAvatars(roster ? roster.split(",") : []), [roster]);

  const trial = snapshot.trial;
  if (!trial) return null;

  const dead = !snapshot.you?.alive;
  const isAccused = snapshot.you?.id === trial.accusedId;
  const isDefense = snapshot.phase === "DEFENSE";
  // Mẫu số là tổng phiếu ĐÃ BỎ hoặc ngưỡng kết án, lấy cái lớn hơn: chia cho
  // tổng phiếu thôi thì hai phiếu Treo trên hai phiếu đã bỏ trông như đã đủ án.
  const total = Math.max(trial.guiltyVotes + trial.innocentVotes, trial.guiltyRequired, 1);

  return (
    <div className="space-y-4">
      {/* Bị cáo là trung tâm của cả hai pha, nên trao hẳn cho họ một khu riêng. */}
      <div className="card border-amber-500/40 py-7 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-mist/50">
          {isDefense ? "Đang biện hộ" : "Bỏ phiếu xác nhận"}
        </p>
        <div className="mt-3 flex flex-col items-center gap-2">
          <Avatar
            avatar={avatars[trial.accusedId]}
            tint={tintFor(trial.accusedId)}
            alive
            className="h-20 w-20 ring-2 ring-amber-500/50"
          />
          <h3 className="font-display text-3xl font-bold text-white">{trial.accusedName}</h3>
        </div>
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
          <h3 className="mb-1 font-display text-xl font-bold text-white">
            {isAccused
              ? "Bạn không được bỏ phiếu cho chính mình"
              : dead
                ? "Bạn đã chết - không được bỏ phiếu"
                : `Treo cổ ${trial.accusedName}?`}
          </h3>
          <p className="mb-3 text-xs text-mist/60">
            Cần {trial.guiltyRequired} phiếu Treo để kết án. Không bỏ phiếu tính là Tha.
          </p>

          {/*
            * Thanh tương quan chứ không phải hai ô số rời: cái người chơi cần
            * biết là phe Treo đã tới ngưỡng chưa, và hai con số cạnh nhau bắt họ
            * tự làm phép trừ đó trong đầu.
            */}
          <div className="mt-1">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-night-800">
              <div
                className="bg-blood-500 transition-[width] duration-500"
                style={{ width: `${barWidth(trial.guiltyVotes, total)}%` }}
              />
              <div
                className="bg-emerald-500/80 transition-[width] duration-500"
                style={{ width: `${barWidth(trial.innocentVotes, total)}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-sm">
              <span className="font-bold text-blood-400">
                {trial.guiltyVotes} <span className="text-xs font-normal text-mist/60">Treo</span>
              </span>
              <span className="font-bold text-emerald-300">
                <span className="text-xs font-normal text-mist/60">Tha</span> {trial.innocentVotes}
              </span>
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
    </div>
  );
}

function barWidth(votes: number, total: number): number {
  return Math.round((votes / total) * 100);
}
