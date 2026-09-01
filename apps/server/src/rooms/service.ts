import {
  MAX_PLAYERS_PER_ROOM,
  SERVER_EVENTS,
  validateRoomConfig,
  type RoomConfig,
} from "@masoi/shared";
import { generateWarnings } from "@masoi/game-engine";
import { resolveMemberAvatar } from "../avatar/legacy";
import { prisma } from "../db";
import { getPlayerRoom, updateSessionRoom } from "../redis";
import { destroyVoiceRoom, dropVoiceParticipant } from "../voice/service";
import { botName, generateRoomCode, newId } from "../util";
import { broadcastRoom, emitToPlayers } from "./broadcast";
import { buildSnapshot, resolveChat, pushChat } from "./snapshot";
import {
  allRooms,
  createRoom,
  deletePersistedRoom,
  getRoom,
  loadRoomFromRedis,
  persistRoom,
  removeRoom,
  setAbandonCheckTimer,
  type Room,
  type RoomMember,
} from "./store";
import { getRoomSyncByPlayer } from "./index-helpers";
import { reconcileDiscussionSkip, startGame, resetToLobby } from "../game/machine";
import { DISCONNECT_GRACE_MS } from "../game/discussion-skip";
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

/**
 * Chủ phòng rớt mạng quá lâu ngay ở màn kết thúc: không ai bấm được "Chơi lại"
 * thì cả phòng ngồi nhìn màn hình đó mãi mãi, vì bấm reset vốn chỉ dành cho
 * chủ phòng. Quá mốc ân hạn dùng chung với vote skip thảo luận thì coi như chủ
 * phòng đã bỏ đi, ai còn nối cũng bấm được.
 */
function hostAbandonedGameOver(room: Room): boolean {
  if (room.engine?.state.phase !== "GAME_OVER") return false;
  const host = room.members.find((m) => m.playerId === room.hostId);
  if (!host || host.connected) return false;
  return Date.now() - (host.disconnectedAt ?? 0) >= DISCONNECT_GRACE_MS;
}

/**
 * Phòng toàn bot (addBot không giới hạn số lượng) mất luôn người chơi thật
 * duy nhất: không ai, kể cả bot, bấm được "Chơi lại", và không có job dọn
 * phòng định kỳ nào. Reset về sảnh chờ khi không còn ai để mà "out" nhầm,
 * thay vì để phòng treo IN_GAME vĩnh viễn.
 *
 * Chỉ gọi qua scheduleAbandonedRoomCheck, KHÔNG gọi thẳng lúc vừa rớt mạng:
 * ngay tại thời điểm đó ai cũng vừa mất kết nối, gọi sớm là xoá ván chỉ vì
 * một lần tải lại trang.
 */
export function resetIfAbandoned(room: Room): void {
  if (room.status !== "IN_GAME") return;
  if (room.members.some((m) => !m.isBot && m.connected)) return;
  resetToLobby(room);
}

/**
 * Hẹn kiểm tra lại sau đúng khoảng ân hạn dùng chung với vote skip thảo luận:
 * ai đã quay lại thì resetIfAbandoned tự bỏ qua.
 *
 * Dùng setAbandonCheckTimer (bucket riêng), KHÔNG dùng setRoomTimer: mọi lần
 * chuyển pha trong machine.ts đều gọi clearRoomTimers xoá sạch bucket đó, nên
 * lịch kiểm tra bỏ hoang sẽ bị xoá theo trước khi kịp chạy.
 */
export function scheduleAbandonedRoomCheck(room: Room): void {
  if (room.status !== "IN_GAME") return;
  setAbandonCheckTimer(room.code, () => resetIfAbandoned(room), DISCONNECT_GRACE_MS + 500);
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
      const playerRecord = await prisma.player.findUnique({ where: { id: playerId } });
      const member: RoomMember = {
        playerId,
        name,
        ready: false,
        connected: true,
        disconnectedAt: null,
        isBot: false,
        avatarUrl: await resolveMemberAvatar(playerRecord),
      };
      const room = createRoom(code, member);
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
      const player = await prisma.player.findUnique({ where: { id: playerId } });
      const avatarUrl = await resolveMemberAvatar(player);
      if (existing) {
        existing.connected = true;
        existing.disconnectedAt = null;
        existing.name = name;
        existing.avatarUrl = avatarUrl ?? existing.avatarUrl ?? null;
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
          avatarUrl,
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
      // Rời phòng KHÔNG đi qua machine.sync(), nên phải đá khỏi voice ngay tại
      // đây. Bỏ sót chỗ này là để lại một cái mic ma: người rời giữa ván bị
      // đánh dấu đã chết rồi bị loại khỏi room.members, nên vòng đồng bộ theo
      // thành viên không bao giờ chạm tới họ nữa - họ nghe và nói được với
      // người sống tới hết ván.
      void dropVoiceParticipant(room.code, playerId, "rời phòng");

      // Rời hẳn là dứt khoát, không như rớt mạng còn cửa quay lại, nên kiểm
      // tra bỏ hoang NGAY TẠI ĐÂY, trước khi gán lại host: nếu không, người
      // thật cuối cùng rời đi khiến room.members[0] (một bot) bị gán làm host
      // trước, rồi resetIfAbandoned mới đưa phòng về LOBBY - kết quả là một
      // phòng LOBBY do bot làm host, không ai bấm "Bắt đầu" được và không bao
      // giờ bị dọn.
      resetIfAbandoned(room);

      // LOBBY toàn bot cũng vô dụng y hệt phòng rỗng: không còn ai để bấm "Bắt
      // đầu", và người mới join sau đó cũng không tự thành host. Xoá hẳn thay
      // vì rơi xuống room.members[0] và gán nhầm một bot làm host.
      const noRealPlayerLeft = room.members.every((m) => m.isBot);
      if (room.members.length === 0 || (room.status === "LOBBY" && noRealPlayerLeft)) {
        removeRoom(room.code);
        await updateSessionRoom(playerId, null);
        await deletePersistedRoom(room.code);
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
    for (const room of [...allRooms()]) {
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
      // Bị đuổi cũng không đi qua sync(): người bị đuổi vẫn nói được vào phòng
      // vừa đuổi họ nếu không đá khỏi voice ở đây.
      void dropVoiceParticipant(room.code, targetId, "bị đuổi");
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
    // Balance check before basic validation so BALANCE_UNSTABLE is surfaced for ranked mode (only when lobby has enough players)
    if (room.members.length >= 6) {
      const balance = generateWarnings(config, room.members.length);
      if (balance.blocking && (config.mode ?? "ranked") === "ranked") {
        throw new RoomError("BALANCE_UNSTABLE: " + balance.warnings.join("; "));
      }
    }
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
    const voiceTurnedOff = room.config.voice === true && config.voice !== true;
    room.config = config;
    // Host tắt voice giữa phòng chờ: xoá hẳn room, mọi người rơi về text.
    if (voiceTurnedOff) void destroyVoiceRoom(room.code, "host tắt voice");
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
    if (room.members.length >= 6) {
      const balance = generateWarnings(room.config, room.members.length);
      if (balance.blocking && (room.config.mode ?? "ranked") === "ranked") {
        throw new RoomError("BALANCE_UNSTABLE: " + balance.warnings.join("; "));
      }
    }
    const err = validateRoomConfig(room.config, room.members.length);
    if (err) throw new RoomError(err);
    if (!allRequiredPlayersReady(room)) {
      throw new RoomError("Vẫn còn người chơi chưa sẵn sàng");
    }
    startGame(room);
  },

  reset(playerId: string): void {
    const roomCode = getRoomSyncByPlayer(playerId);
    if (!roomCode) throw new RoomError("Bạn chưa vào phòng nào");
    const room = getRoom(roomCode)!;
    if (room.hostId !== playerId && !hostAbandonedGameOver(room)) assertHost(room, playerId);
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
