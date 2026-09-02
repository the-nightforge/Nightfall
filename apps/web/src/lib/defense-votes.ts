import type { DayVoteRecap, RoomSnapshot } from "@masoi/shared";

export interface DefenseVoteSummary {
  /** Số phiếu sơ bộ đã dồn vào bị cáo. */
  votes: number;
  /** Ai đã bỏ những phiếu đó. Rỗng khi chỉ biết con số. */
  voterIds: string[];
  /**
   * Có biết TÊN người bỏ phiếu hay không.
   *
   * false thì màn biện hộ chỉ in con số. Đây là trường hợp thật chứ không phải
   * phòng thủ thừa: web và server deploy rời nhau (Vercel với Render), nên một
   * client mới hoàn toàn có thể đang nói chuyện với một server chưa gửi
   * `finalBallots`, và ván khôi phục từ bản lưu cũ cũng thiếu trường đó.
   */
  hasVoters: boolean;
  /** Vòng của phiên bỏ phiếu đã đề cử ra bị cáo; null khi không có recap. */
  round: number | null;
}

/**
 * Phiếu nhắm vào bị cáo, tách khỏi phần lịch sử còn lại.
 *
 * Nguồn số liệu là `finalBallots` của recap - trạng thái CHỐT của vòng đề cử -
 * chứ không phải `mutations`: một người đổi phiếu ba lần sẽ xuất hiện ba lần
 * trong mutations, và đếm ở đó thì "3 phiếu" có thể chỉ là một người đổi ý.
 *
 * `voteCount` trong snapshot là đường lui: engine giữ nó cho cả pha DEFENSE nên
 * con số luôn có, kể cả khi danh tính người bỏ phiếu thì không.
 */
export function summarizeDefenseVotes(
  recap: DayVoteRecap | undefined,
  accusedId: string,
  players: RoomSnapshot["players"],
): DefenseVoteSummary {
  const fallback = players.find((player) => player.id === accusedId)?.voteCount ?? 0;
  const ballots = recap?.finalBallots ?? [];
  const voterIds = ballots
    .filter((ballot) => ballot.choice.type === "PLAYER" && ballot.choice.targetId === accusedId)
    .map((ballot) => ballot.voterId);

  if (voterIds.length === 0) {
    return { votes: fallback, voterIds: [], hasVoters: false, round: recap?.round ?? null };
  }
  return {
    votes: voterIds.length,
    voterIds,
    hasVoters: true,
    round: recap?.round ?? null,
  };
}

/**
 * Recap của vòng đã đề cử ra bị cáo hiện tại.
 *
 * Tìm theo `nomination` thay vì lấy phần tử cuối mảng: phiên toà mở ra từ đúng
 * vòng đề cử ĐÓ, và ván nào có hai phiên xử trong một ngày thì phần tử cuối là
 * vòng vừa xử xong, không phải vòng đang xử. Vẫn lùi về phần tử cuối khi không
 * khớp - `nomination` là trường mới, ván cũ khôi phục lại có thể không có.
 */
export function nominationRecapFor(
  history: DayVoteRecap[],
  accusedId: string,
): DayVoteRecap | undefined {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const recap = history[i];
    if (recap.nomination?.kind === "TRIAL" && recap.nomination.accusedId === accusedId) {
      return recap;
    }
  }
  return history.at(-1);
}
