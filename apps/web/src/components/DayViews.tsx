"use client";

import { useEffect, useState } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { OpenVotePanel } from "./OpenVotePanel";
import { WeightDecidedNote } from "./WeightDecidedNote";
import { PlayerGrid } from "./PlayerGrid";
import { VoteHistoryPanel } from "./VoteHistoryPanel";
import { DayOfTruthModal } from "./DayOfTruthModal";
import { DeadWhisperPanel } from "./DeadWhisperPanel";
import { LastLetterComposer } from "./LastLetterComposer";
import { discussionSkipCopy } from "@/lib/discussion-skip-copy";
import { leaderLabel, voteProgressOf } from "@/lib/vote-progress";
import { PHASE_ACTION_ATTR } from "@/lib/phase-action";

interface Props {
  snapshot: RoomSnapshot;
  /** null nghĩa là "Không treo ai" - một lựa chọn, không phải huỷ phiếu. */
  onVote: (targetId: string | null) => void;
  onSkipDiscussion: (skip: boolean) => void;
  onDayOfTruthClaim?: (role: string | null) => void;
  onDeadMessage?: (text: string) => void;
  /** `null` là lệnh xoá thư. Vắng mặt nghĩa là trang chưa nối sự kiện này. */
  onLastLetter?: (text: string | null) => void;
}

export function DayView({
  snapshot,
  onVote,
  onSkipDiscussion,
  onDayOfTruthClaim,
  onDeadMessage,
  onLastLetter,
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
  const skipCopy = discussionSkip ? discussionSkipCopy(discussionSkip) : null;

  /*
   * Lá phiếu vừa gửi mà snapshot chưa xác nhận.
   *
   * Gửi phiếu là một event socket không có phản hồi trực tiếp: bằng chứng duy
   * nhất rằng máy chủ đã nhận là snapshot kế tiếp. Giữa hai mốc đó nút phải nói
   * là "đang gửi" và không được bấm lại - trước đây bấm nhanh ba cái là bắn ba
   * event y hệt nhau.
   *
   * KHÔNG đổi payload, không đổi tên event, không tự đoán kết quả: đây thuần
   * là trạng thái hiển thị của nút trong lúc chờ.
   */
  const [pending, setPending] = useState<{ target: string | null } | null>(null);

  useEffect(() => {
    if (!pending) return;
    // Snapshot đã mang đúng lá phiếu vừa gửi -> hết chờ.
    if (snapshot.hasVoted && snapshot.myVote === pending.target) {
      setPending(null);
      return;
    }
    /*
     * Chốt chặn: máy chủ có thể từ chối lá phiếu (hết giờ, vừa chết) và khi đó
     * snapshot không bao giờ khớp. Không có hạn này thì nút kẹt ở "đang gửi"
     * vĩnh viễn và người chơi mất luôn quyền bỏ phiếu ở vòng sau.
     */
    const timer = setTimeout(() => setPending(null), 4_000);
    return () => clearTimeout(timer);
  }, [pending, snapshot.hasVoted, snapshot.myVote]);

  // Sang pha hoặc sang vòng khác thì mọi thứ đang chờ đều hết nghĩa.
  useEffect(() => setPending(null), [snapshot.phase, snapshot.round]);

  const sending = pending !== null;
  // Ô đang sáng trên lưới: ý định chưa gửi, hoặc lá phiếu đã gửi nếu chưa đổi ý.
  const effectiveTarget = selected ?? myVote;
  const targetName = effectiveTarget
    ? (snapshot.players.find((p) => p.id === effectiveTarget)?.name ?? null)
    : null;
  // Đang trỏ đúng vào lá phiếu đã nằm trên bàn -> không có gì để gửi nữa.
  const alreadyCast = hasVoted && effectiveTarget === myVote;
  const noElimCast = hasVoted && myVote === null;

  const castVote = (target: string | null) => {
    if (sending) return;
    setPending({ target });
    onVote(target);
  };

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
        <div
          className="card outline-none focus-visible:ring-2 focus-visible:ring-blood-500/60"
          // Mốc mà nút "Bỏ phiếu ngay" trong tấm trượt chat cuộn tới và đặt
          // focus. `tabIndex={-1}`: nhận focus bằng script, không chen vào Tab.
          {...{ [PHASE_ACTION_ATTR]: "" }}
          tabIndex={-1}
        >
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

          {snapshot.you?.role === "MAYOR" && (
            <p className="mb-2 inline-block rounded-full border border-amber-500/40 bg-amber-950/40 px-3 py-1 text-[13px] font-bold text-amber-200">
              👑 Bạn là Thị Trưởng (Phiếu của bạn có trọng số x2)
            </p>
          )}
          {hasVoted && !dead && (
            <p className="mb-2 text-sm text-emerald-300">
              Bạn vẫn có thể đổi phiếu tới khi hết giờ.
            </p>
          )}
          <PlayerGrid
            snapshot={snapshot}
            selectable={!dead}
            selectedId={effectiveTarget}
            confirmedId={hasVoted ? myVote : null}
            onSelect={setSelected}
          />
          {!dead ? (
            <>
              {/*
                * Nút chính nói ĐÚNG chuyện đang xảy ra, không phải một chữ
                * "Bỏ phiếu" đứng yên qua mọi trạng thái:
                *
                *   chưa chọn ai  -> xám, "Chọn một người để bỏ phiếu"
                *   đã chọn       -> đỏ,  "Bỏ phiếu cho <tên>"
                *   đang gửi      -> vòng quay, khoá lại để không bắn trùng
                *   đã gửi xong   -> xanh, "Đã bỏ phiếu cho <tên>"
                *
                * Trạng thái tắt KHÔNG dùng `disabled:opacity-40` mặc định của
                * `.btn`: nền đỏ mờ đi đọc ra như một nút hỏng. Nó đổi hẳn sang
                * xám trung tính mà chữ vẫn rõ - cùng cách `.btn-cta` xử lý.
                */}
              <button
                className={`mt-3 w-full ${
                  alreadyCast && !sending
                    ? "btn border border-emerald-500/45 bg-emerald-600/15 text-emerald-200 disabled:cursor-default disabled:opacity-100"
                    : // Trạng thái tắt phải trông như một CHỖ TRỐNG chờ được
                      // điền, không phải một cái nút khác: nền gần như trong
                      // suốt + viền mảnh, tách hẳn khỏi nút "Không treo ai"
                      // ngay bên dưới - cái đó đặc, có nền, và bấm được.
                      "btn-primary disabled:bg-white/[0.04] disabled:text-mist-strong disabled:opacity-100 disabled:shadow-none disabled:ring-1 disabled:ring-inset disabled:ring-white/10"
                }`}
                disabled={sending || !effectiveTarget || alreadyCast}
                aria-busy={sending}
                onClick={() => effectiveTarget && castVote(effectiveTarget)}
              >
                {sending && pending?.target !== null ? (
                  <>
                    <span className="gate-spinner" aria-hidden="true" />
                    Đang gửi phiếu...
                  </>
                ) : alreadyCast && targetName ? (
                  <>
                    <span aria-hidden="true">✓</span>
                    {/* Tên tối đa 20 ký tự nhưng nút thì hẹp dần theo cột: cắt
                      * ở đây thay vì để nó đẩy toang thẻ. */}
                    <span className="min-w-0 truncate">Đã bỏ phiếu cho {targetName}</span>
                  </>
                ) : !effectiveTarget ? (
                  "Chọn một người để bỏ phiếu"
                ) : (
                  <span className="min-w-0 truncate">
                    {hasVoted ? "Đổi phiếu sang" : "Bỏ phiếu cho"} {targetName}
                  </span>
                )}
              </button>
              <button
                className={`mt-2 w-full ${
                  noElimCast && !sending
                    ? "btn border border-emerald-500/45 bg-emerald-600/15 text-emerald-200 disabled:cursor-default disabled:opacity-100"
                    : "btn-secondary"
                }`}
                disabled={sending || noElimCast}
                aria-busy={sending}
                onClick={() => castVote(null)}
              >
                {sending && pending?.target === null ? (
                  <>
                    <span className="gate-spinner" aria-hidden="true" />
                    Đang gửi phiếu...
                  </>
                ) : (
                  <>
                    {noElimCast && <span aria-hidden="true">✓</span>}
                    {noElimCast ? "Đã chọn không treo ai" : "Không treo ai"} (
                    {snapshot.noEliminationVoteCount} phiếu)
                  </>
                )}
              </button>
            </>
          ) : (
            /*
              * Người chết: chỗ của nút bấm là chỗ phải giải thích vì sao không
              * có nút bấm. Một nút tắt trơ ra ở đây không nói được điều đó, mà
              * một dòng chữ nhỏ ở đầu thẻ thì đọc xong đã quên khi cuộn tới
              * lưới người chơi.
              */
            <div className="mt-3">
              <p className="flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-night-800/70 px-3 py-2.5 text-center text-sm text-mist-bright">
                <span aria-hidden="true">👁</span>
                Bạn đã chết và chỉ có thể theo dõi - không bỏ phiếu được.
              </p>
              <p className="mt-2 text-center text-sm text-mist-strong">
                Không treo ai: <b className="text-white">{snapshot.noEliminationVoteCount}</b> phiếu
              </p>
            </div>
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
            /*
              * Bỏ qua thảo luận là hành động HẠNG HAI của pha này.
              *
              * Bản cũ cho nó `.btn-primary` toàn chiều ngang: một mảng đỏ máu -
              * cùng sắc với nút "Treo cổ" và với đồng hồ lúc sắp hết giờ - nằm
              * ngay dưới dòng "Ai đáng ngờ?", nên thứ nổi nhất trong cả pha
              * thảo luận lại là cái nút bỏ qua chính pha đó. Nó cũng không có
              * gì nguy hiểm để mà mang màu nguy hiểm: bấm nhầm thì bấm lại là
              * rút, và một mình một phiếu thì không bỏ qua được gì.
              *
              * `.btn-secondary` (viền + nền xanh xám trung tính, đã có sẵn
              * hover/active) cộng bề ngang chặn ở 20rem: vẫn là một cái nút
              * bấm được thoải mái, nhưng không còn cạnh tranh với tên pha ở
              * trên hay đồng hồ trên thanh pha.
              */
            <div className="mt-4">
              {skipCopy?.status && (
                <p
                  className={`mx-auto mb-2 flex max-w-xs items-center justify-center gap-1.5 text-[13px] font-semibold ${
                    discussionSkip.hasVoted ? "text-emerald-300" : "text-mist-strong"
                  }`}
                  role="status"
                >
                  {discussionSkip.hasVoted && <span aria-hidden="true">✓</span>}
                  {skipCopy.status}
                </p>
              )}
              {skipCopy?.button && (
                <button
                  type="button"
                  className="btn-secondary mx-auto w-full max-w-xs"
                  onClick={() => onSkipDiscussion(!discussionSkip.hasVoted)}
                >
                  {skipCopy.button}
                </button>
              )}
              <p className="mx-auto mt-2 max-w-xs text-[13px] text-mist-strong">{skipCopy?.hint}</p>
            </div>
          )}
        </div>
      )}
      {snapshot.activeEvent?.id === "DAY_OF_TRUTH" && onDayOfTruthClaim && (
        <DayOfTruthModal snapshot={snapshot} onClaim={onDayOfTruthClaim} />
      )}
      {onDeadMessage && <DeadWhisperPanel snapshot={snapshot} onSend={onDeadMessage} />}
      {/* Hai cơ chế RỜI NHAU, dù đứng cạnh nhau ở đây: Tiếng Vọng là một lượt
        * ẩn danh của người CHẾT do sự kiện bốc, còn phong thư là của người còn
        * SỐNG và ghi danh. Không dùng chung lượt, không dùng chung trạng thái;
        * mỗi cái tự gác điều kiện hiện ra của mình. */}
      {onLastLetter && <LastLetterComposer snapshot={snapshot} onSave={onLastLetter} />}
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
        {/* Ngoài sân khấu Phiên toà sống, đây là màn phán quyết duy nhất mà một
          * người chơi có thể gặp - lời giải thích phải có mặt ở cả hai. */}
        {snapshot.lastTrial?.yourWeightDecided === true && (
          <div className="mt-4 text-left">
            <WeightDecidedNote lynched={snapshot.lastEliminated !== null} />
          </div>
        )}
      </div>
      {latestRecap && <VoteHistoryPanel recap={latestRecap} players={snapshot.players} />}
    </div>
  );
}
