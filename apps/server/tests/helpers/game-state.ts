import type { GameState } from "@masoi/game-engine";
import { DEFAULT_ROOM_CONFIG } from "@masoi/shared";
import { NIGHT_SCAFFOLD } from "./night";

/**
 * Một `GameState` "chưa có gì xảy ra", dùng chung cho mọi fixture test.
 *
 * `GameState` có 36 trường; gần như bài test nào cũng chỉ quan tâm ba bốn cái
 * (pha, người chơi, phiếu) nhưng vẫn phải chép đủ phần còn lại. Chép tay thì
 * mỗi lần engine mọc thêm một trường là hai chục file phải sửa - và vì test của
 * server chưa từng được typecheck, chúng lặng lẽ không sửa.
 *
 * Trải nó ở ĐẦU object literal để bài test tự khai đè lên.
 */
export const GAME_STATE_SCAFFOLD: GameState = {
  phase: "NIGHT",
  round: 1,
  phaseEndsAt: null,
  phaseStartedAt: 0,
  players: [],
  config: { ...DEFAULT_ROOM_CONFIG },
  winner: null,
  night: { ...NIGHT_SCAFFOLD },
  votes: {},
  voteMutations: [],
  dayVoteHistory: [],
  guardPrevious: null,
  alphaShieldUsed: {},
  apprenticeAwakened: false,
  wolfCubRageNextNight: false,
  healUsed: false,
  poisonUsed: false,
  lastNightDeaths: [],
  nightHistory: [],
  lastEliminated: null,
  trial: null,
  lastTrial: null,
  hunterReaction: null,
  hunterShots: [],
  activeEvent: null,
  eventHistory: [],
  log: [],
  pendingLastStandVictim: null,
  bloodMoonArmed: false,
  bloodMoonUsed: false,
  deadCanSpeakUsed: false,
  deadCanSpeakChosenId: null,
  howlBonusDay: null,
  dayOfTruthClaims: {},
};
