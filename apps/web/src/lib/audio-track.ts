"use client";

import type { Phase } from "@masoi/shared";

export type Track = "night" | "day" | "vote";

/**
 * Record<Phase, ...> chứ không phải object thường: thêm pha mới vào PHASES mà
 * quên khai báo ở đây là lỗi biên dịch, thay vì một pha im lặng không nhạc.
 *
 * NIGHT_RESULT và ELIMINATION cố ý dùng chung track với pha liền kề. Hai pha đó
 * chỉ dài 8 giây, cho chúng track riêng thì nhạc giật liên tục.
 */
const TRACK_BY_PHASE: Record<Phase, Track | null> = {
  LOBBY: "day",
  ROLE_REVEAL: "day",
  NIGHT: "night",
  NIGHT_RESULT: "day",
  DAY_DISCUSSION: "day",
  VOTING: "vote",
  ELIMINATION: "vote",
  CHECK_WIN: "vote",
  GAME_OVER: null,
};

export function trackFor(phase: Phase): Track | null {
  return TRACK_BY_PHASE[phase] ?? null;
}
