import type { PublicVoteChoice, RoomSnapshot } from "@masoi/shared";

/**
 * Khoá đại diện lá phiếu "Không treo ai". Nó có số phiếu riêng nhưng không có
 * ghế nào trong lưới, nên chỗ vẽ phải tự bỏ qua khoá này chứ không tra ghế.
 */
export const NO_ELIMINATION_KEY = "__no-elimination__";

export interface VoteFlight {
  /**
   * Ghế xuất phát của lá phiếu.
   *
   * null khi không biết người bỏ: server cũ chưa gửi openBallots. Lúc đó lá
   * phiếu rơi thẳng xuống ghế đích thay vì bay từ đâu tới - vẫn thấy được là có
   * thêm phiếu, chỉ không nói được của ai.
   */
  voterId: string | null;
  /** id người bị bỏ phiếu, hoặc NO_ELIMINATION_KEY. */
  targetKey: string;
}

function keyOf(choice: PublicVoteChoice): string {
  return choice.type === "PLAYER" ? choice.targetId : NO_ELIMINATION_KEY;
}

function tallyOf(snapshot: RoomSnapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const player of snapshot.players) {
    if (player.voteCount) counts.set(player.id, player.voteCount);
  }
  if (snapshot.noEliminationVoteCount) {
    counts.set(NO_ELIMINATION_KEY, snapshot.noEliminationVoteCount);
  }
  return counts;
}

type Ballots = NonNullable<RoomSnapshot["openBallots"]>;

/** Lá phiếu vừa đặt hoặc vừa chuyển chỗ, đọc từ danh tính công khai. */
function namedFlights(before: Ballots, after: Ballots): VoteFlight[] {
  const previous = new Map(before.map((ballot) => [ballot.voterId, keyOf(ballot.choice)]));
  const flights: VoteFlight[] = [];
  for (const ballot of after) {
    const targetKey = keyOf(ballot.choice);
    // Giữ nguyên ý định thì không bay lại: snapshot được đẩy vì mọi thay đổi
    // trong phòng, không riêng gì phiếu.
    if (previous.get(ballot.voterId) === targetKey) continue;
    flights.push({ voterId: ballot.voterId, targetKey });
  }
  return flights;
}

/**
 * Đường lui khi không có danh tính: chỉ đọc phần CHÊNH của số phiếu.
 *
 * Một ô tăng bao nhiêu cũng chỉ MỘT lá, vì phiếu Thị Trưởng nặng x2 vẫn là một
 * thao tác và bắn hai token cho một lá thì vừa sai vừa rối.
 */
function anonymousFlights(prev: RoomSnapshot, next: RoomSnapshot): VoteFlight[] {
  const before = tallyOf(prev);
  const flights: VoteFlight[] = [];
  for (const [key, count] of tallyOf(next)) {
    if (count <= (before.get(key) ?? 0)) continue;
    flights.push({ voterId: null, targetKey: key });
  }
  return flights;
}

/**
 * Những lá phiếu vừa hạ xuống giữa hai snapshot.
 *
 * Không sinh gì khi đổi vòng hoặc đổi pha: lúc đó số phiếu về 0 vì ván sang
 * chặng mới, không phải vì có ai rút phiếu.
 */
export function voteFlightsFor(
  prev: RoomSnapshot | null,
  next: RoomSnapshot,
): VoteFlight[] {
  if (!prev) return [];
  if (next.phase !== "VOTING") return [];
  if (prev.phase !== next.phase || prev.round !== next.round) return [];

  // Phải có danh tính ở CẢ HAI đầu mới so được. Server vừa deploy giữa vòng thì
  // bên trước rỗng còn bên sau đầy, so thẳng sẽ bắn lại toàn bộ phiếu đã có.
  if (prev.openBallots && next.openBallots) {
    return namedFlights(prev.openBallots, next.openBallots);
  }
  return anonymousFlights(prev, next);
}
