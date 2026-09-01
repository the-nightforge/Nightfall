import type { RoomSnapshot } from "@masoi/shared";

/**
 * Tiến độ vòng bỏ phiếu ban ngày, dạng ĐỌC ĐƯỢC.
 *
 * Thuần trình bày: không quyết định gì, không đổi gì, chỉ đọc lại những con số
 * mà snapshot đã gửi sẵn. Luật đếm phiếu, ngưỡng kết án và thời điểm chốt vòng
 * nằm hết ở server - ở đây chỉ là chuyện nói cho người chơi biết chuyện đang
 * tới đâu.
 */
export interface VoteProgress {
  /**
   * Số người ĐÃ bỏ phiếu, hoặc null khi không biết.
   *
   * `openBallots` là trường không bắt buộc (web và server deploy rời nhau, xem
   * chú thích trong snapshot.ts), nên client mới chạy với server cũ sẽ không có
   * nó. Trong trường hợp đó phải nói "không biết" chứ KHÔNG được suy ra từ tổng
   * voteCount: phiếu Thị Trưởng có trọng số x2, nên tổng phiếu không phải là số
   * người đã bỏ - "8/6 người đã bỏ phiếu" là một câu vô nghĩa.
   */
  cast: number | null;
  /** Số người còn sống, tức là số người được quyền bỏ phiếu. */
  eligible: number;
  /** Ai đang bị dồn phiếu nhất; null khi chưa ai có phiếu nào. */
  leader: { name: string; votes: number; tied: boolean } | null;
}

export function voteProgressOf(snapshot: RoomSnapshot): VoteProgress {
  const eligible = snapshot.players.filter((p) => p.alive).length;
  const cast = snapshot.openBallots ? snapshot.openBallots.length : null;

  let top = 0;
  let leaders: string[] = [];
  for (const player of snapshot.players) {
    const votes = player.voteCount ?? 0;
    if (votes <= 0) continue;
    if (votes > top) {
      top = votes;
      leaders = [player.name];
    } else if (votes === top) {
      leaders.push(player.name);
    }
  }

  return {
    cast,
    eligible,
    leader:
      leaders.length > 0
        ? { name: leaders[0], votes: top, tied: leaders.length > 1 }
        : null,
  };
}

/**
 * Câu mô tả người đang dẫn đầu.
 *
 * Hoà phiếu là một tình huống có thật và phải nói ra: ở vòng đề cử, "đang hoà"
 * đọc ra hoàn toàn khác "đang có một người sắp bị đưa ra toà".
 */
export function leaderLabel(progress: VoteProgress): string | null {
  if (!progress.leader) return null;
  const { name, votes, tied } = progress.leader;
  return tied
    ? `Đang hoà ở ${votes} phiếu`
    : `${name} đang dẫn với ${votes} phiếu`;
}
