"use client";

import { roleWonOutcome, type RoomSnapshot } from "@masoi/shared";

export type Cue = "howl" | "turn" | "death" | "ballot" | "win" | "lose";

/**
 * Tiếng cần phát khi snapshot đổi.
 *
 * Mọi tiếng định nghĩa theo CẠNH giữa hai snapshot chứ không theo trạng thái
 * của snapshot mới. Server chỉ gửi snapshot, không có luồng sự kiện, nên xét
 * theo trạng thái sẽ khiến mỗi lần resync sau khi rớt mạng phát lại tiếng của
 * việc đã xảy ra từ lâu.
 *
 * Thứ tự trả về cố định theo thứ tự khai báo bên dưới để test khẳng định được.
 */
export function cuesFor(prev: RoomSnapshot | null, next: RoomSnapshot): Cue[] {
  // Chưa có snapshot trước thì không có cạnh nào để so.
  if (!prev) return [];

  const cues: Cue[] = [];
  const changed = prev.round !== next.round || prev.phase !== next.phase;

  if (changed && next.phase === "NIGHT") cues.push("howl");
  // Một luật chung cho mọi lượt hành động. canAct của Phù Thuỷ lật sang true
  // đúng lúc bầy Sói chốt phiếu, và Thợ Săn được gọi bắn cũng là tới lượt, nên
  // không vai nào cần nhánh riêng.
  if (myTurnStarted(prev, next)) cues.push("turn");
  if (changed && diedThisPhase(next)) cues.push("death");
  // Hai vòng phiếu là hai cạnh khác nhau: hasVoted của vòng sơ bộ vẫn đúng
  // suốt phiên toà, nên riêng nó không bao giờ bắt được lá phiếu xác nhận.
  if ((!prev.hasVoted && next.hasVoted) || (!prev.trial?.hasVoted && next.trial?.hasVoted)) {
    cues.push("ballot");
  }

  const role = next.you?.role;
  if (changed && next.phase === "GAME_OVER" && next.winner && role) {
    // Hai đường thắng, đúng như `personalOutcome`: phe của mình về nhất, HOẶC
    // mình đã đạt điều kiện thắng riêng. Chỉ đọc phe sẽ phát tiếng thua vào
    // đúng lúc người chơi vừa thắng - và tiếng là thứ họ nghe trước cả khi kịp
    // đọc dòng chữ nào.
    const personalWin = (next.personalWins ?? []).some((win) => win.playerId === next.you?.id);
    /*
     * `roleWonOutcome`, KHÔNG phải `roleTeam(role) === next.winner`.
     *
     * Phép so cũ trả `false` cho chính Sát Nhân vừa thắng cả ván - phe của vai
     * đó là `neutral`, không phải `serial_killer` - nên nó sẽ phát tiếng THUA
     * vào đúng giây người chơi vừa thắng.
     *
     * Ván HOÀ phát tiếng thua cho mọi người, trừ ai có thắng lợi cá nhân. Đó là
     * lựa chọn có chủ đích: hoà nghĩa là không ai đạt được mục tiêu, và một
     * tiếng khải hoàn ở đó nói sai chuyện vừa xảy ra.
     */
    cues.push(personalWin || roleWonOutcome(role, next.winner) ? "win" : "lose");
  }

  return cues;
}

/** Vừa mở ra một lượt mà chính người xem phải hành động. */
function myTurnStarted(prev: RoomSnapshot, next: RoomSnapshot): boolean {
  const started = (was: boolean | undefined, now: boolean | undefined) =>
    was !== true && now === true;
  return (
    started(prev.night?.canAct, next.night?.canAct) ||
    started(prev.hunterShot?.canAct, next.hunterShot?.canAct) ||
    // Bị cáo được trao lượt nói độc quyền cũng là tới lượt mình.
    started(prev.trial?.canSpeak, next.trial?.canSpeak)
  );
}

function diedThisPhase(view: RoomSnapshot): boolean {
  if (view.phase === "NIGHT_RESULT") return view.lastNightDeaths.length > 0;
  if (view.phase === "ELIMINATION") return view.lastEliminated !== null;
  return false;
}
