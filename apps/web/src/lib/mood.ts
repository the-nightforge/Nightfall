"use client";

import type { Phase } from "@masoi/shared";

/** Không khí của sân khấu. Quyết định nền, không quyết định nội dung nào cả. */
export const MOODS = ["dusk", "night", "dawn", "day", "trial", "over"] as const;
export type Mood = (typeof MOODS)[number];

/**
 * Record<Phase, ...> chứ không phải object thường: thêm pha mới vào PHASES mà
 * quên khai báo ở đây là lỗi biên dịch, thay vì một pha rơi về nền mặc định
 * không ai để ý. Cùng lý do với TRACK_BY_PHASE bên audio-track.
 *
 * Sáu pha quanh phiên toà dùng chung một không khí: chúng là một mạch liên tục
 * từ lúc đề cử tới lúc công bố, đổi nền giữa chừng chỉ làm nhấp nháy.
 */
const MOOD_BY_PHASE: Record<Phase, Mood> = {
  LOBBY: "dusk",
  // Lật vai là khoảnh khắc bí mật, thuộc về đêm chứ không phải phòng chờ.
  ROLE_REVEAL: "night",
  NIGHT: "night",
  NIGHT_RESULT: "dawn",
  DAY_DISCUSSION: "day",
  VOTING: "trial",
  DEFENSE: "trial",
  FINAL_VOTE: "trial",
  ELIMINATION: "trial",
  HUNTER_SHOT: "trial",
  CHECK_WIN: "trial",
  GAME_OVER: "over",
};

export function moodFor(phase: Phase): Mood {
  return MOOD_BY_PHASE[phase];
}
