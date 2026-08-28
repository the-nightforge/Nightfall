import { prisma } from "./db";
import { sha256 } from "./util";
import type { Socket, Server as SocketServer } from "socket.io";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  socketAuthSchema,
  chatSendPayload,
  createRoomPayload,
  joinRoomPayload,
  kickPayload,
  setReadyPayload,
  updateConfigPayload,
  startGamePayload,
  resetGamePayload,
  gameActionPayload,
  votePayload,
  skipDiscussionPayload,
  addBotPayload,
  hunterShotPayload,
} from "@masoi/shared";
import { config } from "./config";
import { GameError } from "@masoi/game-engine";
import { roomService, RoomError } from "./rooms/service";
import { getRoomSyncByPlayer } from "./rooms/index-helpers";
import { getRoom, loadRoomFromRedis, persistRoom } from "./rooms/store";
import { trackSocket, untrackSocket, broadcastRoom, hasConnection } from "./rooms/broadcast";
import {
  maybeEndVotingEarly,
  maybeEndWitchWindow,
  scheduleDiscussionSkipRecheck,
  submitDiscussionSkip,
  submitHunterShot,
} from "./game/machine";
import { getPlayerRoom, updateSessionRoom } from "./redis";
import { reconnectPlayer } from "./rooms/reconnect";

// ---- Rate limit đơn giản (sliding window trong bộ nhớ) ----
const actionLog = new Map<string, number[]>();

function allowAction(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const list = (actionLog.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) return false;
  list.push(now);
  actionLog.set(key, list);
  return true;
}

interface AuthedSocket extends Socket {
  data: { playerId: string };
}

export function setupSocket(io: SocketServer): void {
  // Xác thực ngay khi kết nối: playerId + token từ localStorage client
  io.use(async (socket, next) => {
    const parsed = socketAuthSchema.safeParse(socket.handshake.auth ?? {});
    if (!parsed.success) {
      next(new Error("Thiếu thông tin xác thực"));
      return;
    }
    try {
      const tokenHash = sha256(parsed.data.token);
      const player = await prisma.player.findUnique({ where: { tokenHash } });
      if (!player || player.id !== parsed.data.playerId) {
        next(new Error("Phiên đăng nhập không hợp lệ"));
        return;
      }
      (socket as AuthedSocket).data.playerId = player.id;
      next();
    } catch {
      next(new Error("Lỗi xác thực"));
    }
  });

  io.on("connection", (rawSocket) => {
    const socket = rawSocket as AuthedSocket;
    const playerId = socket.data.playerId;

    trackSocket(playerId, socket);

    const handleError = (err: unknown): void => {
      const message =
        err instanceof RoomError || err instanceof GameError
          ? err.message
          : "Có lỗi xảy ra, vui lòng thử lại";
      socket.emit(SERVER_EVENTS.ERROR, { message });
    };

    // Tự động rejo vào phòng cũ nếu còn session
    (async () => {
      const room = await reconnectPlayer(playerId, {
        findCachedRoom: (id) => {
          const roomCode = getRoomSyncByPlayer(id);
          return roomCode ? getRoom(roomCode) : undefined;
        },
        getPersistedRoomCode: getPlayerRoom,
        loadRoom: loadRoomFromRedis,
        clearPersistedRoom: (id) => updateSessionRoom(id, null),
        saveRoom: persistRoom,
      });
      if (room) {
        await socket.join(room.code);
        broadcastRoom(room.code);
      }
    })().catch(() => undefined);

    const handler = (event: string, fn: (payload: unknown) => Promise<void> | void) => {
      socket.on(event, async (payload: unknown) => {
        try {
          await fn(payload);
        } catch (err) {
          handleError(err);
        }
      });
    };

    handler(CLIENT_EVENTS.ROOM_CREATE, async () => {
      createRoomPayload.parse({});
      if (!allowAction(`create:${playerId}`, 3, 10_000)) throw new RoomError("Thao tác quá nhanh");
      const player = await prisma.player.findUnique({ where: { id: playerId } });
      if (!player) throw new RoomError("Không tìm thấy người chơi");
      const room = await roomService.create(playerId, player.nickname);
      await socket.join(room.code);
    });

    handler(CLIENT_EVENTS.ROOM_JOIN, async (payload) => {
      const { code } = joinRoomPayload.parse(payload);
      if (!allowAction(`join:${playerId}`, 5, 10_000)) throw new RoomError("Thao tác quá nhanh");
      const player = await prisma.player.findUnique({ where: { id: playerId } });
      if (!player) throw new RoomError("Không tìm thấy người chơi");
      const room = await roomService.join(playerId, player.nickname, code);
      await socket.join(room.code);
    });

    handler(CLIENT_EVENTS.ROOM_LEAVE, async () => {
      await socket.leave(getRoomSyncByPlayer(playerId) ?? "");
      await roomService.leave(playerId);
    });

    handler(CLIENT_EVENTS.ROOM_SET_READY, async (payload) => {
      const { ready } = setReadyPayload.parse(payload);
      roomService.setReady(playerId, ready);
    });

    handler(CLIENT_EVENTS.ROOM_KICK, async (payload) => {
      const { targetId } = kickPayload.parse(payload);
      await roomService.kick(playerId, targetId);
    });

    handler(CLIENT_EVENTS.ROOM_UPDATE_CONFIG, async (payload) => {
      const { config: cfg } = updateConfigPayload.parse(payload);
      roomService.updateConfig(playerId, cfg);
    });

    handler(CLIENT_EVENTS.ROOM_ADD_BOT, async (payload) => {
      addBotPayload.parse(payload);
      roomService.addBot(playerId);
    });

    handler(CLIENT_EVENTS.ROOM_START, async (payload) => {
      startGamePayload.parse(payload);
      roomService.start(playerId);
    });

    handler(CLIENT_EVENTS.ROOM_RESET, async (payload) => {
      resetGamePayload.parse(payload);
      roomService.reset(playerId);
    });

    handler(CLIENT_EVENTS.GAME_ACTION, async (payload) => {
      const parsed = gameActionPayload.parse(payload);
      if (!allowAction(`act:${playerId}`, 15, 3_000)) throw new RoomError("Thao tác quá nhanh");
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

      room.engine.submitNightAction(
        playerId,
        parsed.type,
        parsed.targetId ?? null,
      );
      maybeEndWitchWindow(room);
      broadcastRoom(roomCode);
      void import("./rooms/store").then((m) => m.persistRoom(room));
    });

    handler(CLIENT_EVENTS.GAME_VOTE, async (payload) => {
      const { targetId } = votePayload.parse(payload);
      if (!allowAction(`vote:${playerId}`, 10, 3_000)) throw new RoomError("Thao tác quá nhanh");
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

      room.engine.submitVote(playerId, targetId);
      maybeEndVotingEarly(room);
      broadcastRoom(roomCode);
      void import("./rooms/store").then((m) => m.persistRoom(room));
    });

    handler(CLIENT_EVENTS.GAME_SKIP_DISCUSSION, async (payload) => {
      const { skip } = skipDiscussionPayload.parse(payload);
      if (!allowAction(`skip-discussion:${playerId}`, 10, 3_000)) {
        throw new RoomError("Thao tác quá nhanh");
      }
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

      const error = submitDiscussionSkip(room, playerId, skip);
      if (error) throw new RoomError(error);
    });

    handler(CLIENT_EVENTS.GAME_HUNTER_SHOT, async (payload) => {
      const { targetId } = hunterShotPayload.parse(payload);
      if (!allowAction(`hunter-shot:${playerId}`, 3, 3_000)) {
        throw new RoomError("Thao tác quá nhanh");
      }
      const roomCode = getRoomSyncByPlayer(playerId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode);
      if (!room?.engine) throw new RoomError("Không có trận đấu đang chạy");

      submitHunterShot(room, playerId, targetId);
    });

    handler(CLIENT_EVENTS.CHAT_SEND, async (payload) => {
      const { text } = chatSendPayload.parse(payload);
      if (text.length > config.chatMaxLength) throw new RoomError("Tin nhắn quá dài");
      if (!allowAction(`chat:${playerId}`, config.chatRateLimitCount, config.chatRateLimitWindowMs)) {
        throw new RoomError("Bạn gửi tin nhắn quá nhanh, hãy chậm lại");
      }
      roomService.chat(playerId, text);
    });

    socket.on("disconnect", () => {
      untrackSocket(playerId, socket);
      const roomCode = getRoomSyncByPlayer(playerId);
      if (roomCode) {
        const room = getRoom(roomCode);
        const member = room?.members.find((m) => m.playerId === playerId);
        if (member) {
          // Một người có thể mở nhiều tab; chỉ coi là rớt khi không còn socket nào.
          member.connected = hasConnection(playerId);
          member.disconnectedAt = member.connected ? null : Date.now();
          if (room && !member.connected) scheduleDiscussionSkipRecheck(room);
        }
        broadcastRoom(roomCode);
      }
    });
  });
}
