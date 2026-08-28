import {
  MAX_PLAYERS_PER_ROOM,
  SERVER_EVENTS,
  validateRoomConfig,
  type RoomConfig,
} from "@masoi/shared";
import { prisma } from "../db";
import { getPlayerRoom, updateSessionRoom } from "../redis";
import { botName, generateRoomCode, newId } from "../util";
import { broadcastRoom, emitToPlayers } from "./broadcast";
import { buildSnapshot, resolveChat, pushChat } from "./snapshot";
import {
  createRoom,
  deletePersistedRoom,
  getRoom,
  loadRoomFromRedis,
  persistRoom,
  removeRoom,
  type Room,
  type RoomMember,
} from "./store";
import { getRoomSyncByPlayer, getRoomsCache } from "./index-helpers";
import { reconcileDiscussionSkip, startGame, resetToLobby } from "../game/machine";
import { allRequiredPlayersReady, roomEntryError } from "./rules";
import { withPlayerRoomLock } from "./player-room-lock";

export class RoomError extends Error {}

function assertMember(room: Room, playerId: string): RoomMember {
  const m = room.members.find((x) => x.playerId === playerId);
  if (!m) throw new RoomError("Bạn không ở trong phòng này");
  return m;
}

function assertHost(room: Room, playerId: string): void {
  if (room.hostId !== playerId) throw new RoomError("Chỉ chủ phòng mới được thực hiện hành động này");
}

export const roomService = {
  async create(playerId: string, name: string): Promise<Room> {
    return withPlayerRoomLock(playerId, async () => {
      if (await this.findRoomOf(playerId)) {
        throw new RoomError("Bạn phải rời phòng hiện tại trước khi tạo phòng khác");
      }
      let code = generateRoomCode();
      while (getRoom(code) || (await loadRoomFromRedis(code))) {
        code = generateRoomCode();
      }
      const member: RoomMember = {
        playerId,
        name,
        ready: false,
        connected: true,
        disconnectedAt: null,
        isBot: false,
      };
      const room = createRoom(code, member);
      try {
        await prisma.roomRecord.create({
          data: { id: newId(), code, hostName: name },
        });
      } catch {
        /* DB lỗi không chặn chơi */
      }
      await persistRoom(room);
      await updateSessionRoom(playerId, code);
      broadcastRoom(code);
      return room;
    });
  },

  async join(playerId: string, name: string, rawCode: string): Promise<Room> {
    return withPlayerRoomLock(playerId, async () => {
      const code = rawCode.trim().toUpperCase();
      const room = getRoom(code) ?? (await loadRoomFromRedis(code));
      if (!room) throw new RoomError("Không tìm thấy phòng");

      // Reconnect: đã là thành viên
      const existing = room.members.find((m) => m.playerId === playerId);
      const entryError = roomEntryError(await this.findRoomOf(playerId), code, room.status, !!existing);
      if (entryError) throw new RoomError(entryError);
      if (existing) {
        existing.connected = true;
        existing.disconnectedAt = null;
        existing.name = name;
      } else {
        if (room.members.length >= MAX_PLAYERS_PER_ROOM) throw new RoomError("Phòng đã đầy");
        const dupName = room.members.some(
          (m) => m.name.trim().localeCompare(name.trim(), "vi", { sensitivity: "accent" }) === 0,
        );
        if (dupName) throw new RoomError("Biệt danh đã có người trong phòng sử dụng");
        room.members.push({
          playerId,
          name,
          ready: false,
          connected: true,
          disconnectedAt: null,
          isBot: false,
        });
      }

      await persistRoom(room);
      await updateSessionRoom(playerId, code);
      broadcastRoom(code);
      return room;
    });
  },

  async leave(playerId: string): Promise<void> {
    await withPlayerRoomLock(playerId, async () => {
      const roomCode = await this.findRoomOf(playerId);
      if (!roomCode) return;
      const room = getRoom(roomCode);
      if (!room) return;

      room.members = room.members.filter((m) => m.playerId !== playerId);

      if (room.members.length === 0) {
        removeRoom(room.code);
        await updateSessionRoom(playerId, null);
        await deletePersistedRoom(room.code);
        try {
          await prisma.roomRecord.updateMany({
            where: { code: room.code, closedAt: null },
            data: { closedAt: new Date() },
          });
        } catch {
          /* ignore */
        }
        return;
      }

      if (room.hostId === playerId) {
        const next =
          room.members.find((m) => !m.isBot && m.connected) ??
          room.members.find((m) => !m.isBot) ??
          room.members[0];
        room.hostId = next.playerId;
      }

      // Rời giữa trận: đánh dấu chết để không treo game
      if (room.engine) {
        const p = room.engine.getState().players.find((pl) => pl.id === playerId);
        if (p && p.alive && room.status === "IN_GAME") {
          p.alive = false;
        }
      }
      const discussionAdvanced = reconcileDiscussionSkip(room);
      await updateSessionRoom(playerId, null);
      await persistRoom(room);
      if (!discussionAdvanced) broadcastRoom(room.code);
    });
  },

  async findRoomOf(playerId: string): Promise<string | null> {
    for (const room of [...getRoomsCache()]) {
      if (room.members.some((m) => m.playerId === playerId)) return room.code;
    }
    const persistedCode = await getPlayerRoom(playerId);
    if (!persistedCode) return null;
    const persistedRoom = getRoom(persistedCode) ?? (await loadRoomFromRedis(persistedCode));
    if (persistedRoom?.members.some((member) => member.playerId === playerId)) {
      return persistedRoom.code;
    }
    await updateSessionRoom(playerId, null);
    return null;
  },

  setReady(playerId: string, ready: boolean): void {
    const roomCode = getRoomSyncByPlayer(playerId);
    if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
    const room = getRoom(roomCode)!;
    const m = assertMember(room, playerId);
    if (room.status !== "LOBBY") throw new RoomError("Trận đấu đang diễn ra");
    if (m.isBot) throw new RoomError("Bot luôn sẵn sàng");
    m.ready = ready;
    void persistRoom(room).then(() => broadcastRoom(room.code));
  },

  async kick(hostId: string, targetId: string): Promise<void> {
    await withPlayerRoomLock(targetId, async () => {
      const roomCode = getRoomSyncByPlayer(hostId);
      if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
      const room = getRoom(roomCode)!;
      assertHost(room, hostId);
      if (room.status !== "LOBBY") throw new RoomError("Chỉ được loại người chơi trước khi bắt đầu");
      if (hostId === targetId) throw new RoomError("Không thể tự loại mình");
      const target = room.members.find((m) => m.playerId === targetId);
      if (!target) throw new RoomError("Người chơi không tồn tại");
      room.members = room.members.filter((m) => m.playerId !== targetId);
      await updateSessionRoom(targetId, null);
      await persistRoom(room);
      broadcastRoom(room.code);
    });
  },

  updateConfig(hostId: string, config: RoomConfig): void {
    const roomCode = getRoomSyncByPlayer(hostId);
    if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
    const room = getRoom(roomCode)!;
    assertHost(room, hostId);
    if (room.status !== "LOBBY") throw new RoomError("Không thể đổi cấu hình khi đang chơi");
    // Chỉ chặn cấu hình vô lý; điều kiện đủ người kiểm tra chặt lúc bắt đầu
    const totalSpecial =
      config.werewolves +
      (config.seer ? 1 : 0) +
      (config.guard ? 1 : 0) +
      (config.witch ? 1 : 0) +
      (config.hunter ? 1 : 0) +
      (config.cursed ? 1 : 0);
    if (room.members.length >= 6) {
      const err = validateRoomConfig(config, room.members.length);
      if (err) throw new RoomError(err);
    } else if (totalSpecial >= MAX_PLAYERS_PER_ROOM - 1) {
      throw new RoomError("Cấu hình vai trò không hợp lệ");
    }
    room.config = config;
    void persistRoom(room).then(() => broadcastRoom(room.code));
  },

  addBot(hostId: string): void {
    const roomCode = getRoomSyncByPlayer(hostId);
    if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
    const room = getRoom(roomCode)!;
    assertHost(room, hostId);
    if (room.status !== "LOBBY") throw new RoomError("Không thể thêm bot giữa trận");
    if (room.members.length >= MAX_PLAYERS_PER_ROOM) throw new RoomError("Phòng đã đầy");
    const botId = `bot-${newId()}`;
    room.members.push({
      playerId: botId,
      name: botName(room.members.map((m) => m.name)),
      ready: true,
      connected: false,
      isBot: true,
    });
    void persistRoom(room).then(() => broadcastRoom(room.code));
  },

  start(hostId: string): void {
    const roomCode = getRoomSyncByPlayer(hostId);
    if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
    const room = getRoom(roomCode)!;
    assertHost(room, hostId);
    if (room.status !== "LOBBY") throw new RoomError("Trận đấu đang diễn ra");
    const err = validateRoomConfig(room.config, room.members.length);
    if (err) throw new RoomError(err);
    if (!allRequiredPlayersReady(room)) {
      throw new RoomError("Vẫn còn người chơi chưa sẵn sàng");
    }
    startGame(room);
  },

  reset(hostId: string): void {
    const roomCode = getRoomSyncByPlayer(hostId);
    if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
    const room = getRoom(roomCode)!;
    assertHost(room, hostId);
    if (room.status !== "IN_GAME") throw new RoomError("Không có trận đấu nào để đặt lại");
    resetToLobby(room);
  },

  chat(playerId: string, text: string): void {
    const roomCode = getRoomSyncByPlayer(playerId);
    if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
    const room = getRoom(roomCode)!;
    const result = resolveChat(room, playerId);
    if (!result.ok) throw new RoomError(result.error);
    const sender = room.members.find((m) => m.playerId === playerId)!;
    const message = {
      id: newId(),
      channel: result.channel,
      playerId,
      playerName: sender.name,
      text,
      at: Date.now(),
    };
    pushChat(room, message);
    // Chỉ phát tới những người có quyền xem kênh này
    emitToPlayers(result.recipients, SERVER_EVENTS.CHAT_NEW, message);
    void persistRoom(room);
  },

  snapshotFor(playerId: string): ReturnType<typeof buildSnapshot> | null {
    const roomCode = getRoomSyncByPlayer(playerId);
    if (!roomCode) return null;
    return buildSnapshot(getRoom(roomCode)!, playerId);
  },
};
