"use client";

import type { Phase } from "@masoi/shared";

/**
 * Một track duy nhất cho cả ván.
 *
 * Trước đây có ba track đổi theo pha. Mỗi lần đổi pha là một lần crossfade, và
 * một ván có hàng chục lần đổi pha: nhạc bị cắt ngang liên tục, chưa kể ba file
 * là gần 4 MiB người chơi phải tải. Kiểu union giữ nguyên một nhánh chứ không
 * rút thành `string`, để thêm track thứ hai sau này vẫn là một thay đổi kiểu có
 * kiểm soát.
 */
export type Track = "theme";

/**
 * Record<Phase, ...> chứ không phải object thường: thêm pha mới vào PHASES mà
 * quên khai báo ở đây là lỗi biên dịch, thay vì một pha im lặng không nhạc.
 *
 * Mọi pha chơi được đều trả về CÙNG một giá trị, và đó là điều làm nên tính
 * liên tục: `audioEngine.setTrack` bỏ qua lời gọi trùng với track đang phát,
 * nên chuyển pha không đụng gì tới nguồn nhạc đang chạy.
 */
const TRACK_BY_PHASE: Record<Phase, Track | null> = {
  LOBBY: "theme",
  ROLE_REVEAL: "theme",
  NIGHT: "theme",
  NIGHT_RESULT: "theme",
  DAY_DISCUSSION: "theme",
  VOTING: "theme",
  DEFENSE: "theme",
  FINAL_VOTE: "theme",
  ELIMINATION: "theme",
  HUNTER_SHOT: "theme",
  CHECK_WIN: "theme",
  GAME_OVER: null,
};

export function trackFor(phase: Phase): Track | null {
  return TRACK_BY_PHASE[phase] ?? null;
}
