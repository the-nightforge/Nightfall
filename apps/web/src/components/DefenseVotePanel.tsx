"use client";

import { useId, useMemo, useState } from "react";
import type { DayVoteRecap, RoomSnapshot } from "@masoi/shared";
import { assignAvatars, tintFor } from "@/lib/avatar";
import { summarizeDefenseVotes } from "@/lib/defense-votes";
import { Avatar } from "./Avatar";
import { VoteHistoryPanel } from "./VoteHistoryPanel";

interface Props {
  recap: DayVoteRecap | undefined;
  players: RoomSnapshot["players"];
  accusedId: string;
  accusedName: string;
}

/**
 * Vì sao người này bị đề cử.
 *
 * Bản cũ dán thẳng toàn bộ lịch sử phiếu vào giữa màn biện hộ: hai ba chục con
 * chip "A → B" xếp ngang nhau, trong đó những phiếu THẬT SỰ đưa bị cáo ra toà
 * trông y hệt mọi phiếu khác. Câu hỏi duy nhất của pha này - ai đã đẩy người
 * đó ra đây - phải tự quét lấy giữa một đám chip đồng hạng.
 *
 * Giờ nó là một câu trả lời sẵn ở trên, còn lịch sử đầy đủ lùi vào một khối
 * bung ra: vẫn còn đủ cho ai muốn truy dấu ai đổi phiếu lúc nào, nhưng không
 * còn cạnh tranh với chính lời biện hộ.
 *
 * Dùng ở CẢ pha biện hộ lẫn pha bỏ phiếu xác nhận. Hai pha đó hỏi hai câu khác
 * nhau ("nghe gì" và "treo hay tha") nhưng cùng cần đúng một nền: ai bị đề cử,
 * bao nhiêu phiếu, và những phiếu đó của ai. Vòng xác nhận từng có bảng lịch sử
 * đầy đủ của riêng nó, và đó chính là đám chip đồng hạng ở trên, chỉ đổi chỗ
 * xuống ngay trên hai cái nút quyết định.
 */
export function DefenseVotePanel({ recap, players, accusedId, accusedName }: Props) {
  const [open, setOpen] = useState(false);
  // aria-controls cần một id THẬT và duy nhất: khối này xuất hiện ở cả pha biện
  // hộ lẫn pha bỏ phiếu xác nhận, và một chuỗi id viết cứng sẽ trùng nhau ngay
  // khi hai bản cùng nằm trên trang.
  const historyId = useId();
  const summary = useMemo(
    () => summarizeDefenseVotes(recap, accusedId, players),
    [recap, accusedId, players],
  );
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const avatars = useMemo(() => assignAvatars(players.map((p) => p.id)), [players]);

  return (
    <section className="card space-y-3" aria-label="Phiếu đã đề cử người này">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-amber-300">
          Vì sao bị đề cử
        </p>
        {summary.round !== null && (
          <span className="shrink-0 rounded-full bg-night-800 px-2 py-0.5 text-[13px] font-semibold text-mist-bright ring-1 ring-white/10">
            Bỏ phiếu sơ bộ · Vòng {summary.round}
          </span>
        )}
      </div>

      {/* min-w-0 + truncate: một cái tên 20 ký tự không được đẩy con số phiếu
        * ra khỏi thẻ, mà con số mới là thứ phải đọc được trước. */}
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <b className="min-w-0 max-w-full truncate font-display text-xl font-bold text-white">
          {accusedName}
        </b>
        <span className="shrink-0 rounded-md border border-blood-500/40 bg-blood-950/40 px-2 py-0.5 text-sm font-bold text-blood-400">
          {summary.votes} phiếu
        </span>
      </p>

      {summary.hasVoters ? (
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-mist-strong">Người bỏ phiếu</p>
          {/* Cuộn trong vùng của mình khi phòng đông: 15 người là trần một
            * phòng, và 15 chip có avatar sẽ cao hơn cả khối bị cáo phía trên. */}
          <ul className="lobby-roster-scroll flex max-h-28 flex-wrap gap-1.5 overflow-y-auto overscroll-contain pr-1">
            {summary.voterIds.map((voterId) => (
              <li
                key={voterId}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-500/[0.12] py-1 pl-1 pr-2.5"
              >
                <Avatar
                  avatar={avatars[voterId]}
                  tint={tintFor(voterId)}
                  alive={playerMap.get(voterId)?.alive ?? true}
                  className="h-6 w-6 shrink-0"
                />
                <span className="max-w-[8rem] truncate text-[13px] font-semibold text-amber-100">
                  {playerMap.get(voterId)?.name ?? "Đã rời phòng"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        // Không có danh tính thì nói thẳng là không có, chứ không bịa ra một
        // danh sách rỗng trông như "không ai bỏ phiếu".
        <p className="text-[13px] text-mist-strong">
          Vòng này không lưu danh tính người bỏ phiếu, chỉ còn lại con số.
        </p>
      )}

      {recap && (
        <div className="border-t border-white/[0.08] pt-2.5">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={historyId}
            className="btn-tertiary -mx-1 w-full justify-between"
          >
            <span>Xem toàn bộ lịch sử bỏ phiếu</span>
            {/* Mũi tên đổi theo trạng thái mở/đóng, và nó là thứ DUY NHẤT ở đây
              * mang nghĩa bằng hình - nên nhãn chữ giữ nguyên ở cả hai trạng
              * thái và `aria-expanded` mới là phần trình đọc màn hình nghe. */}
            <span aria-hidden="true">{open ? "▴" : "▾"}</span>
          </button>
          {/*
            * Luôn dựng, chỉ ẩn bằng `hidden`.
            *
            * `aria-controls` trỏ tới một node không tồn tại là một liên kết
            * gãy: lúc đóng thì id kia không có chủ, và trình đọc màn hình chỉ
            * đọc được một cái nút hứa hẹn điều khiển một thứ không có thật.
            * `hidden` giữ node lại trong tài liệu mà vẫn đưa nó ra khỏi cây
            * trợ năng lẫn thứ tự Tab.
            */}
          <div id={historyId} hidden={!open} className="mt-2.5">
            <VoteHistoryPanel
              recap={recap}
              players={players}
              highlightTargetId={accusedId}
              bare
            />
          </div>
        </div>
      )}
    </section>
  );
}
