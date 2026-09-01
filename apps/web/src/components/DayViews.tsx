"use client";

import { useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { OpenVotePanel } from "./OpenVotePanel";
import { PlayerGrid } from "./PlayerGrid";
import { VoteHistoryPanel } from "./VoteHistoryPanel";
import { DayOfTruthModal } from "./DayOfTruthModal";
import { DeadWhisperPanel } from "./DeadWhisperPanel";
import { leaderLabel, voteProgressOf } from "@/lib/vote-progress";

interface Props {
  snapshot: RoomSnapshot;
  /** null nghĩa là "Không treo ai" - một lựa chọn, không phải huỷ phiếu. */
  onVote: (targetId: string | null) => void;
  onSkipDiscussion: (skip: boolean) => void;
  onDayOfTruthClaim?: (role: string | null) => void;
  onDeadMessage?: (text: string) => void;
}

export function DayView({
  snapshot,
  onVote,
  onSkipDiscussion,
  onDayOfTruthClaim,
  onDeadMessage,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const isVoting = snapshot.phase === "VOTING";
  const dead = !snapshot.you?.alive;
  const myVote = snapshot.myVote;
  // Phải dùng cờ này chứ không dùng truthiness của myVote: một phiếu "không treo
  // ai" cũng có myVote === null, và khoá UI theo myVote sẽ để ngỏ lá phiếu đó.
  const hasVoted = snapshot.hasVoted;
  const discussionSkip = snapshot.discussionSkip;
  const leader = isVoting ? leaderLabel(voteProgressOf(snapshot)) : null;

  return (
    <div className="space-y-4">
      {snapshot.phase === "NIGHT_RESULT" && (
        <div
          className={`card py-7 text-center ${
            snapshot.lastNightDeaths.length > 0 ? "border-blood-500/40" : "border-emerald-500/30"
          }`}
        >
          <p className="text-[13px] uppercase tracking-[0.3em] text-mist-strong">Trời đã sáng</p>
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
        /*
         * KHÔNG còn `opacity-70` cho người đã chết.
         *
         * Làm mờ cả thẻ là làm mờ luôn tên người chơi, số phiếu và lịch sử -
         * đúng những thứ mà người đã chết chỉ còn mỗi việc là ngồi đọc. Trạng
         * thái "bạn đã chết" nói bằng một dải riêng bên dưới, và mọi ô người
         * chơi thì đã tự tắt (disabled) sẵn.
         */
        <div className="card">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              {/*
                * Tên pha giữ nguyên kể cả khi người xem đã chết.
                *
                * Bản cũ đổi hẳn tiêu đề thành "Bạn đã chết": tình trạng riêng
                * của một người chiếm mất dòng chữ to nhất màn hình, và người
                * chơi mất luôn dấu hiệu rằng cả làng ĐANG bỏ phiếu.
                */}
              <h3 className="font-display text-2xl font-bold text-white lg:text-[1.75rem]">
                Ai là Ma Sói?
              </h3>
              <p className="mt-1 text-sm text-mist-strong">
                Vòng này chỉ chọn ra bị cáo, chưa ai bị treo.
              </p>
            </div>
            {/* Ai đang bị dồn phiếu - câu hỏi thứ hai của cả vòng, sau "còn bao
              * lâu". Trước đây phải tự nhẩm bằng cách quét hết các huy hiệu số
              * trên lưới. */}
            {leader && (
              <p className="shrink-0 rounded-lg border border-blood-500/30 bg-blood-600/15 px-2.5 py-1.5 text-[13px] font-semibold text-blood-400">
                <span className="mr-1" aria-hidden="true">🔥</span>
                {leader}
              </p>
            )}
          </div>

          {dead && (
            /* Trạng thái phụ: một dải trung tính, không phải tiêu đề. Biểu tượng
             * + chữ chứ không chỉ màu, và nói rõ CẢ hai vế - vẫn xem được, không
             * bỏ phiếu được. */
            <p className="mb-3 flex items-start gap-2 rounded-lg border border-white/10 bg-night-800/70 px-3 py-2 text-sm text-mist-bright">
              <span aria-hidden="true">👁</span>
              <span>
                <b className="font-semibold text-white">Bạn đã chết.</b> Bạn theo dõi được cả
                vòng bỏ phiếu nhưng không thể bỏ phiếu.
              </span>
            </p>
          )}
          {snapshot.you?.role === "MAYOR" && (
            <p className="mb-2 inline-block rounded-full border border-amber-500/40 bg-amber-950/40 px-3 py-1 text-[13px] font-bold text-amber-200">
              👑 Bạn là Thị Trưởng (Phiếu của bạn có trọng số x2)
            </p>
          )}
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
            <p className="mt-3 text-center text-sm text-mist-strong">
              Không treo ai: <b className="text-white">{snapshot.noEliminationVoteCount}</b> phiếu
            </p>
          )}
          <OpenVotePanel snapshot={snapshot} />
        </div>
      )}

      {snapshot.phase === "DAY_DISCUSSION" && (
        <div className="card py-7 text-center">
          <p className="text-[13px] uppercase tracking-[0.3em] text-mist-strong">Ban ngày</p>
          <h3 className="mt-2 font-display text-3xl font-bold text-amber-100">Thảo luận</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-mist-strong">
            Ai đáng ngờ? Buộc tội, bào chữa, và để ý ai đang im lặng.
          </p>

          {/*
            * Nhắc lại đêm vừa rồi ngay tại đây. Đây chính là dữ kiện cả làng đang
            * cãi nhau về, và snapshot vẫn gửi lastNightDeaths suốt pha thảo luận
            * chứ không chỉ ở pha công bố.
            */}
          <div className="mx-auto mt-5 max-w-sm rounded-xl border border-white/[0.06] bg-night-800/50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.25em] text-mist-strong">Đêm vừa rồi</p>
            {snapshot.lastNightDeaths.length > 0 ? (
              <p className="mt-1 font-semibold text-blood-400">
                {snapshot.lastNightDeaths.map((d) => d.name).join(" · ")}{" "}
                <span className="font-normal text-mist-strong">đã chết</span>
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
                <p className="mt-1 text-[13px] text-mist-strong">
                  Cần toàn bộ người thật còn sống và đang online đồng ý.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[13px] text-mist-strong">
                Người chơi còn sống muốn skip: {discussionSkip.votes}/{discussionSkip.required}
              </p>
            )
          )}
        </div>
      )}
      {snapshot.activeEvent?.id === "DAY_OF_TRUTH" && onDayOfTruthClaim && (
        <DayOfTruthModal snapshot={snapshot} onClaim={onDayOfTruthClaim} />
      )}
      {onDeadMessage && <DeadWhisperPanel snapshot={snapshot} onSend={onDeadMessage} />}
    </div>
  );
}

export function EliminationView({ snapshot }: { snapshot: RoomSnapshot }) {
  const latestRecap = snapshot.dayVoteHistory.at(-1);
  return (
    <div className="space-y-4">
      <div className="card py-7 text-center">
        <p className="text-[13px] uppercase tracking-[0.3em] text-mist-strong">Phán quyết của làng</p>
          {snapshot.lastEliminated ? (
          <>
            <h3 className="mt-2 font-display text-3xl font-bold text-blood-400">
              {snapshot.lastEliminated.name}
            </h3>
            <p className="mt-1 text-sm text-mist-strong">đã bị treo cổ</p>
            <p className="mt-3 text-[13px] text-mist-strong">Vai trò sẽ được tiết lộ khi ván đấu kết thúc.</p>
          </>
        ) : snapshot.lastTrial ? (
        // Được tha là một kết cục riêng: lastEliminated === null không phân biệt
        // được nó với hoà phiếu hay "không treo ai" thắng.
        <>
          <h3 className="mt-2 font-display text-3xl font-bold text-emerald-300">
            {snapshot.lastTrial.accused.name} được tha
          </h3>
          <p className="mt-1 text-sm text-mist-strong">
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
