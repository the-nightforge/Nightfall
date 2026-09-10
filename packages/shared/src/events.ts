/**
 * Danh sách Socket.IO events dùng chung client/server.
 * Client -> Server: `c:` prefix. Server -> Client: `s:` prefix.
 */
export const CLIENT_EVENTS = {
  ROOM_CREATE: "room:create",
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROOM_SET_READY: "room:set-ready",
  ROOM_KICK: "room:kick",
  ROOM_TRANSFER_HOST: "room:transfer-host",
  ROOM_UPDATE_CONFIG: "room:update-config",
  ROOM_ADD_BOT: "room:add-bot",
  ROOM_START: "room:start",
  ROOM_RESET: "room:reset",
  GAME_ACTION: "game:action",
  GAME_VOTE: "game:vote",
  GAME_FINAL_VOTE: "game:final-vote",
  GAME_HUNTER_SHOT: "game:hunter-shot",
  GAME_SKIP_DISCUSSION: "game:skip-discussion",
  GAME_DAY_OF_TRUTH_CLAIM: "game:day-of-truth-claim",
  GAME_DEAD_MESSAGE: "game:dead-message",
  GAME_LAST_LETTER_SET: "game:last-letter-set",
  ROOM_UPDATE_AVATAR: "room:update-avatar",
  CHAT_SEND: "chat:send",
  VOICE_TOKEN: "voice:token",
  VOICE_READY: "voice:ready",
} as const;

export const SERVER_EVENTS = {
  SNAPSHOT: "room:snapshot",
  CHAT_NEW: "chat:new",
  /**
   * Trả token join LiveKit.
   *
   * Dùng server event chứ không dùng ack callback: helper `handler` trong
   * ws.ts bọc `socket.on(event, (payload) => ...)` với ĐÚNG MỘT tham số, nên
   * ack của Socket.IO bị vứt đi. Đổi helper sẽ đụng cả 15 handler đang chạy.
   */
  VOICE_TOKEN: "voice:token",
  ERROR: "error",
} as const;

export interface VoiceTokenPayload {
  /** Dạng wss:// cho trình duyệt. */
  url: string;
  token: string;
  roomName: string;
}

export interface SocketError {
  message: string;
  code?: string;
}

export type GameEventId =
  | "CURFEW"
  | "SILENT_NIGHT"
  | "AMNESTY_DAY"
  | "CLEARING_MIST"
  | "PEACEFUL_NIGHT"
  | "JUDGMENT_DAY"
  | "LAST_STAND"
  | "DAY_OF_TRUTH"
  | "MOONLESS_NIGHT"
  | "BLOODY_HUNT"
  | "HOWL_OF_THE_PACK"
  | "BLOOD_MOON"
  | "WOLF_SHADOW"
  | "MORNING_REPORT"
  | "DEAD_CAN_SPEAK"
  | "SECRET_BALLOT"
  | "VIGILANT_NIGHT"
  | "OBITUARY";
