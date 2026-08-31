import type { Server, Socket } from "socket.io";
import { SERVER_EVENTS } from "@masoi/shared";
import { getRoom } from "./store";
import { buildSnapshot } from "./snapshot";

let ioRef: Server | null = null;
const socketsByPlayer = new Map<string, Set<Socket>>();

export function setIo(io: Server): void {
  ioRef = io;
}

export function trackSocket(playerId: string, socket: Socket): void {
  const set = socketsByPlayer.get(playerId) ?? new Set();
  set.add(socket);
  socketsByPlayer.set(playerId, set);
}

export function untrackSocket(playerId: string, socket: Socket): void {
  const set = socketsByPlayer.get(playerId);
  if (!set) return;
  set.delete(socket);
  if (set.size === 0) socketsByPlayer.delete(playerId);
}

export function hasConnection(playerId: string): boolean {
  return (socketsByPlayer.get(playerId)?.size ?? 0) > 0;
}

/**
 * Gửi snapshot CÁ NHÂN HÓA cho từng người chơi trong phòng.
 * Đây là điểm duy nhất dữ liệu trận đấu rời server - mỗi client chỉ nhận
 * phần họ được phép biết (vai trò bí mật đã được engine lọc sẵn).
 */
export function broadcastRoom(code: string): void {
  const room = getRoom(code);
  const io = ioRef;
  if (!room || !io) return;

  for (const member of room.members) {
    if (member.isBot) continue;
    const sockets = socketsByPlayer.get(member.playerId);
    if (!sockets || sockets.size === 0) continue;
    const snapshot = buildSnapshot(room, member.playerId);
    for (const s of sockets) {
      s.emit(SERVER_EVENTS.SNAPSHOT, snapshot);
    }
  }
}

/** Gửi tin nhắn chat tới đúng danh sách người nhận được phép. */
export function emitToPlayers(playerIds: string[], event: string, payload: unknown): void {
  const io = ioRef;
  if (!io) return;
  for (const pid of new Set(playerIds)) {
    const sockets = socketsByPlayer.get(pid);
    if (!sockets) continue;
    for (const s of sockets) {
      s.emit(event, payload);
    }
  }
}
