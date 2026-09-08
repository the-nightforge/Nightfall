import type { NightState } from "@masoi/game-engine";

/**
 * Đêm "chưa ai làm gì", dùng chung cho mọi fixture test.
 *
 * Cùng lý do với `ROOM_SCAFFOLD`: `NightState` đã nở từ 8 lên 15 trường khi các
 * vai mở rộng vào game, và hơn mười file test vẫn chép lại bản 8 trường của
 * ngày xưa. Trải nó ở ĐẦU object literal để bài test tự khai đè lên.
 */
export const NIGHT_SCAFFOLD: NightState = {
  wolfVotes: {},
  killTarget: null,
  wolfSecondaryTarget: null,
  wolfCubRageTonight: false,
  wolvesLocked: false,
  guardTarget: null,
  healTonight: false,
  poisonTarget: null,
  witchSkipped: false,
  seerResults: {},
  sorcererResults: {},
  trackerTargets: {},
  trackerResults: {},
  detectiveTargets: null,
  detectiveResults: {},
};
