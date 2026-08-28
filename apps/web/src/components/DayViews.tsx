"use client";

import { useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { PlayerGrid } from "./PlayerGrid";
import { VoteHistoryPanel } from "./VoteHistoryPanel";

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
        <div
          className={`card py-7 text-center ${
            snapshot.lastNightDeaths.length > 0 ? "border-blood-500/40" : "border-emerald-500/30"
          }`}
        >
          <p className="text-xs uppercase tracking-[0.3em] text-mist/50">Trời đã sáng</p>
          {snapshot.lastNightDeaths.length > 0 ? (
            <>
              <h3 className="mt-2 font-display text-3xl font-bold text-blood-400">
                {snapshot.lastNightDeaths.length} người không qua khỏi đêm nay
              </h3>
              <p className="mt-3 text-lg font-semibold text-white">
                {snapshot.lastNightDeaths.map((d) => d.name).join(" · ")}
              </p>
            </>
          ) : (
            <h3 className="mt-2 font-display text-3xl font-bold text-emerald-300">
              Một đêm bình yên
            </h3>
          )}
        </div>
      )}

      {isVoting && (
        <div className={`card ${dead ? "opacity-70" : ""}`}>
          <h3 className="mb-1 font-display text-2xl font-bold text-white">
            {dead ? "Bạn đã chết" : "Ai là Ma Sói?"}
          </h3>
          {snapshot.you?.role === "MAYOR" && (
            <p className="mb-2 inline-block rounded-full border border-amber-500/40 bg-amber-950/40 px-3 py-1 text-xs font-bold text-amber-300">
              👑 Bạn là Thị Trưởng (Phiếu của bạn có trọng số x2)
            </p>
          )}
          <p className="mb-3 text-sm text-mist/60">
            {dead
              ? "Bạn theo dõi được nhưng không bỏ phiếu."
              : "Vòng này chỉ chọn ra bị cáo, chưa ai bị treo."}
          </p>
          {hasVoted && !dead && (
            <p className="mb-2 text-sm text-emerald-300">
              {myVote
                ? `Bạn đã bỏ phiếu cho ${snapshot.players.find((p) => p.id === myVote)?.name}.`
                : "Bạn đã chọn không treo ai."}
              {" Bạn vẫn có thể đổi phiếu tới khi hết giờ."}
            </p>
          )}
          <PlayerGrid
            snapshot={snapshot}
            selectable={!dead}
            selectedId={selected ?? myVote}
            onSelect={setSelected}
          />
          {!dead ? (
            <>
              <button
                className="btn-primary mt-3 w-full"
                disabled={!selected}
                onClick={() => selected && onVote(selected)}
              >
                {hasVoted ? "Đổi phiếu" : "Bỏ phiếu"}
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
        <div className="card py-7 text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-mist/50">Ban ngày</p>
          <h3 className="mt-2 font-display text-3xl font-bold text-amber-100">Thảo luận</h3>
          <p className="mx-auto mt-2 max-w-sm text-sm text-mist/70">
            Ai đáng ngờ? Buộc tội, bào chữa, và để ý ai đang im lặng.
          </p>

          {/*
            * Nhắc lại đêm vừa rồi ngay tại đây. Đây chính là dữ kiện cả làng đang
            * cãi nhau về, và snapshot vẫn gửi lastNightDeaths suốt pha thảo luận
            * chứ không chỉ ở pha công bố.
            */}
          <div className="mx-auto mt-5 max-w-sm rounded-xl border border-white/[0.06] bg-night-800/50 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.25em] text-mist/40">Đêm vừa rồi</p>
            {snapshot.lastNightDeaths.length > 0 ? (
              <p className="mt-1 font-semibold text-blood-400">
                {snapshot.lastNightDeaths.map((d) => d.name).join(" · ")}{" "}
                <span className="font-normal text-mist/60">đã chết</span>
              </p>
            ) : (
              <p className="mt-1 font-semibold text-emerald-300">Không ai chết</p>
            )}
          </div>
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
  const latestRecap = snapshot.dayVoteHistory.at(-1);
  return (
    <div className="space-y-4">
      <div className="card py-7 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-mist/50">Phán quyết của làng</p>
        {snapshot.lastEliminated ? (
          <>
            <h3 className="mt-2 font-display text-3xl font-bold text-blood-400">
              {snapshot.lastEliminated.name}
            </h3>
            <p className="mt-1 text-sm text-mist/70">đã bị treo cổ</p>
            {(() => {
              const p = snapshot.players.find((x) => x.id === snapshot.lastEliminated!.playerId);
              if (p?.role) {
                const wolf = p.role === "WEREWOLF";
                return (
                  <p
                    className={`mt-4 inline-block rounded-full px-4 py-1.5 font-display text-lg font-bold ${
                      wolf
                        ? "bg-emerald-900/50 text-emerald-300"
                        : "bg-blood-600/25 text-blood-400"
                    }`}
                  >
                    {wolf ? "Đúng là Ma Sói" : "Một dân làng vô tội"}
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
          <h3 className="mt-2 font-display text-3xl font-bold text-emerald-300">
            {snapshot.lastTrial.accused.name} được tha
          </h3>
          <p className="mt-1 text-sm text-mist/70">
            {snapshot.lastTrial.guilty} phiếu treo - {snapshot.lastTrial.innocent} phiếu tha
            {snapshot.lastTrial.abstain > 0 && `, ${snapshot.lastTrial.abstain} không bỏ phiếu`}.
          </p>
        </>
        ) : (
        // Không còn khẳng định hoà phiếu: không ai bị loại giờ có hai lý do
        // (hoà, hoặc "Không treo ai" thắng) mà snapshot không phân biệt.
          <h3 className="mt-2 font-display text-3xl font-bold text-white">Không ai bị loại hôm nay</h3>
        )}
      </div>
      {latestRecap && <VoteHistoryPanel recap={latestRecap} players={snapshot.players} />}
    </div>
  );
}
