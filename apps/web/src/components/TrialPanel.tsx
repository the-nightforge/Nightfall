"use client";

import { useMemo } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { assignAvatars, breathOffsetFor, tintFor } from "@/lib/avatar";
import { nominationRecapFor } from "@/lib/defense-votes";
import { Avatar } from "./Avatar";
import { DefenseVotePanel } from "./DefenseVotePanel";

interface Props {
  snapshot: RoomSnapshot;
  onFinalVote: (guilty: boolean) => void;
  /**
   * Sân khấu "Phiên toà sống" đang hiện ngay phía trên.
   *
   * Khi bật, sân khấu đã sở hữu khối bị cáo (avatar, tên, chặng, trạng thái
   * quyền nói) và cả bảng số Treo/Tha kèm ngưỡng kết án. Thẻ này bỏ đúng hai
   * phần đó đi - in lần thứ hai thì người chơi phải tự đối chiếu hai bảng số
   * giống hệt nhau xem có chỗ nào lệch không, và hai cái nút quyết định bị đẩy
   * xuống dưới một màn cuộn.
   *
   * Những gì Ở LẠI đây thì luôn ở lại, bật hay tắt: hai cái nút, phù hiệu Thị
   * Trưởng, dòng "không bỏ phiếu tính là Tha", và khối "Vì sao bị đề cử".
   */
  liveStage?: boolean;
}

/**
 * Hai pha của phiên toà dùng chung một component: cả hai đều xoay quanh đúng
 * một bị cáo và cùng bảng phiếu sơ bộ, tách đôi chỉ tạo hai chỗ để lệch nhau.
 */
export function TrialPanel({ snapshot, onFinalVote, liveStage = false }: Props) {
  const roster = snapshot.players.map((p) => p.id).join(",");
  const avatars = useMemo(() => assignAvatars(roster ? roster.split(",") : []), [roster]);

  const trial = snapshot.trial;
  const recap = useMemo(
    () => (trial ? nominationRecapFor(snapshot.dayVoteHistory, trial.accusedId) : undefined),
    [snapshot.dayVoteHistory, trial],
  );
  if (!trial) return null;

  const dead = !snapshot.you?.alive;
  const isAccused = snapshot.you?.id === trial.accusedId;
  const isDefense = snapshot.phase === "DEFENSE";
  // `canSpeak` do server tính (engine.trialViewFor): pha đúng, đúng bị cáo, và
  // còn sống. Không tự ghép lại ba điều kiện đó ở đây - một bị cáo chết giữa
  // pha vẫn là `isAccused` nhưng không còn được nói.
  const myTurn = isDefense && trial.canSpeak;
  // Mẫu số là tổng phiếu ĐÃ BỎ hoặc ngưỡng kết án, lấy cái lớn hơn: chia cho
  // tổng phiếu thôi thì hai phiếu Treo trên hai phiếu đã bỏ trông như đã đủ án.
  const total = Math.max(trial.guiltyVotes + trial.innocentVotes, trial.guiltyRequired, 1);

  return (
    <div className="space-y-3">
      {/* Bị cáo là trung tâm của cả hai pha, nên trao hẳn cho họ một khu riêng -
        * trừ khi "Phiên toà sống" đang dựng đúng khu đó ngay phía trên. */}
      {!liveStage && (
      <div
        className={`card py-6 text-center ${
          myTurn
            ? // Đến lượt mình thì khối này phải NỔI hơn, nhưng bằng viền và một
              // quầng mỏng chứ không bằng một mảng màu đặc: cả pha chỉ kéo dài
              // 25 giây và bị cáo phải đọc chữ trong đó, không phải nheo mắt.
              "border-amber-400/60 shadow-[0_0_0_1px_rgba(251,191,36,0.18),0_18px_40px_-24px_rgba(251,191,36,0.55)]"
            : "border-amber-500/40"
        }`}
      >
        {/*
          * Nhãn pha ở amber-300 chứ không phải mist/65.
          *
          * mist ở 65% đo được khoảng 3.1:1 trên nền thẻ - dưới ngưỡng AA cho
          * chữ thường, và đây lại đúng là dòng trả lời câu hỏi "màn hình này
          * đang là chuyện gì". amber-300 lên khoảng 9:1 và buộc luôn nhãn vào
          * cùng sắc với viền thẻ.
          */}
        <p className="text-xs font-bold uppercase tracking-[0.3em] text-amber-300">
          {isDefense ? "Đang biện hộ" : "Bỏ phiếu xác nhận"}
        </p>
        <div className="mt-3 flex flex-col items-center gap-2">
          <Avatar
            avatar={avatars[trial.accusedId]}
            tint={tintFor(trial.accusedId)}
            alive
            breathOffset={breathOffsetFor(trial.accusedId)}
            className="h-20 w-20 ring-2 ring-amber-500/50"
          />
          {/* break-words: một cái tên dài không dấu cách phải xuống dòng chứ
            * không được đẩy toang thẻ ở cột giữa 1024px. */}
          <h3 className="max-w-full break-words font-display text-3xl font-bold leading-tight text-white">
            {isDefense && (
              <span aria-hidden="true" className="mr-2">
                🎙
              </span>
            )}
            {trial.accusedName}
          </h3>
        </div>
        {/*
          * Dòng số phiếu ở mist-strong, và số thì trắng đậm.
          *
          * Ở mist/60 cũ nó là dòng chữ nhạt nhất thẻ trong khi nó mang đúng cái
          * lý do người kia đứng đó. Con số tách ra một bậc nữa để quét được mà
          * không phải đọc cả câu.
          */}
        <p className="mt-1.5 text-sm text-mist-strong">
          Bị đề cử với{" "}
          <b className="font-bold text-white">
            {snapshot.players.find((p) => p.id === trial.accusedId)?.voteCount ?? 0} phiếu
          </b>{" "}
          sơ bộ
        </p>

        {/*
          * Trạng thái quyền nói nằm NGAY trong khối bị cáo.
          *
          * Bản cũ để nó ở một thẻ riêng bên dưới bảng lịch sử phiếu, tức là
          * cách câu hỏi "tôi có được nói không" đúng một màn cuộn. Đây cũng là
          * chỗ duy nhất trong pha này có con số đếm ngược dạng chữ - vòng đồng
          * hồ vẫn ở nguyên trên thanh pha như mọi pha khác, nhưng bị cáo lúc
          * này đang nhìn xuống ô nhập chứ không nhìn lên đầu màn.
          */}
        {isDefense && (
          <p
            className={`mx-auto mt-3 flex max-w-md flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm leading-snug ${
              myTurn
                ? "border-amber-400/45 bg-amber-500/[0.12] font-semibold text-amber-100"
                : "border-white/10 bg-night-800/60 text-mist-bright"
            }`}
            role="status"
          >
            <span>
              {myTurn ? (
                <>
                  <span aria-hidden="true" className="mr-1">
                    🎙
                  </span>
                  Đến lượt bạn biện hộ
                </>
              ) : dead ? (
                <>Bạn đã chết — chỉ {trial.accusedName} được nói lúc này</>
              ) : (
                <>Hãy lắng nghe — chỉ {trial.accusedName} được nói lúc này</>
              )}
            </span>
          </p>
        )}
      </div>
      )}

      {/*
        * CẢ HAI pha của phiên toà dùng chung một khối: tóm tắt ở trên, lịch sử
        * đầy đủ gấp lại trong một khối bung ra.
        *
        * Vòng xác nhận trước đây dán thẳng bảng lịch sử đầy đủ vào giữa màn -
        * hai ba chục con chip "A → B" nằm ngay trên đúng hai cái nút Treo/Tha,
        * và câu hỏi của cả pha ("có đủ lý do treo người này không") phải tự
        * quét lấy giữa một đám chip đồng hạng. Đó là cùng một vấn đề mà màn
        * biện hộ đã giải rồi, nên nó dùng lại lời giải đó chứ không có lời giải
        * thứ hai. Ai muốn truy dấu ai đổi phiếu lúc nào thì mở khối bung ra -
        * dữ liệu còn nguyên, chỉ không còn tranh chỗ với quyết định.
        */}
      <DefenseVotePanel
        recap={recap}
        players={snapshot.players}
        accusedId={trial.accusedId}
        accusedName={trial.accusedName}
      />

      {!isDefense && (
        <div className={`card ${dead ? "opacity-70" : ""}`}>
          <h3 className="mb-1 font-display text-xl font-bold text-white">
            {isAccused
              ? "Bạn không được bỏ phiếu cho chính mình"
              : dead
                ? "Bạn đã chết - không được bỏ phiếu"
                : `Treo cổ ${trial.accusedName}?`}
          </h3>
          {snapshot.you?.role === "MAYOR" && (
            <p className="mb-2 inline-block rounded-full border border-amber-500/40 bg-amber-950/40 px-3 py-1 text-[13px] font-bold text-amber-200">
              👑 Bạn là Thị Trưởng (Phiếu của bạn có trọng số x2)
            </p>
          )}
          {/* 13px chứ không phải 12px: đây là luật quyết định kết cục của cả
            * pha, không phải một dòng chú thích dưới chân thẻ.
            *
            * Ngưỡng kết án lùi lên sân khấu khi sân khấu đang bật - nó ở đó
            * cạnh chính bảng số mà nó nói về. Vế "không bỏ phiếu tính là Tha"
            * thì ở LẠI: đó là luật của hai cái nút ngay bên dưới, không phải
            * một con số trên bảng đếm. */}
          <p className="mb-3 text-[13px] text-mist-strong">
            {!liveStage && <>Cần {trial.guiltyRequired} phiếu Treo để kết án. </>}
            Không bỏ phiếu tính là Tha.
          </p>

          {/*
            * Thanh tương quan chứ không phải hai ô số rời: cái người chơi cần
            * biết là phe Treo đã tới ngưỡng chưa, và hai con số cạnh nhau bắt họ
            * tự làm phép trừ đó trong đầu.
            */}
          {!liveStage && (
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
                {trial.guiltyVotes} <span className="text-xs font-normal text-mist-strong">Treo</span>
              </span>
              <span className="font-bold text-emerald-300">
                <span className="text-xs font-normal text-mist-strong">Tha</span> {trial.innocentVotes}
              </span>
            </div>
          </div>
          )}

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
