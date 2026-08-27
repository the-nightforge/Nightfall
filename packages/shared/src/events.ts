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
  ROOM_UPDATE_CONFIG: "room:update-config",
  ROOM_ADD_BOT: "room:add-bot",
  ROOM_START: "room:start",
  ROOM_RESET: "room:reset",
  GAME_ACTION: "game:action",
  GAME_VOTE: "game:vote",
  CHAT_SEND: "chat:send",
} as const;

export const SERVER_EVENTS = {
  SNAPSHOT: "room:snapshot",
  CHAT_NEW: "chat:new",
  ERROR: "error",
} as const;

export interface SocketError {
  message: string;
  code?: string;
}
