"use client";

import { roleTeam, type RoomSnapshot } from "@masoi/shared";

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
  // canAct của Phù Thuỷ lật sang true đúng lúc bầy Sói chốt phiếu, nên luật
  // chung này tự đúng với lượt đi sau của cô ta mà không cần nhánh riêng.
  if (prev.night?.canAct !== true && next.night?.canAct === true) cues.push("turn");
  if (changed && diedThisPhase(next)) cues.push("death");
  if (!prev.hasVoted && next.hasVoted) cues.push("ballot");

  const role = next.you?.role;
  if (changed && next.phase === "GAME_OVER" && next.winner && role) {
    cues.push(roleTeam(role) === next.winner ? "win" : "lose");
  }

  return cues;
}

function diedThisPhase(view: RoomSnapshot): boolean {
  if (view.phase === "NIGHT_RESULT") return view.lastNightDeaths.length > 0;
  if (view.phase === "ELIMINATION") return view.lastEliminated !== null;
  return false;
}
