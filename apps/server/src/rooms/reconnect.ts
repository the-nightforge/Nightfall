import type { Room, RoomLoadOutcome } from "./store";

export interface ReconnectDependencies {
  findCachedRoom: (playerId: string) => Room | undefined;
  getPersistedRoomCode: (playerId: string) => Promise<string | null>;
  loadRoom: (code: string) => Promise<RoomLoadOutcome>;
  clearPersistedRoom: (playerId: string) => Promise<void>;
  saveRoom: (room: Room) => Promise<void>;
}

/**
 * Kết quả nối lại.
 *
 * `unavailable` và `corrupt` KHÔNG được gộp vào `none`: cả hai đều là "chưa
 * biết", còn `none` là "chắc chắn không có". Chỉ `none` mới được phép xoá
 * đường về phòng của người chơi, và chỉ hai cái kia mới cần nói với họ một câu.
 */
export type ReconnectOutcome =
  | { status: "joined"; room: Room }
  | { status: "none" }
  | { status: "unavailable" }
  | { status: "corrupt" };

export async function reconnectPlayer(
  playerId: string,
  dependencies: ReconnectDependencies,
): Promise<ReconnectOutcome> {
  const cached = dependencies.findCachedRoom(playerId);
  let room = cached;

  if (!room) {
    const roomCode = await dependencies.getPersistedRoomCode(playerId);
    if (!roomCode) return { status: "none" };

    const loaded = await dependencies.loadRoom(roomCode);
    // Không đọc được thì giữ nguyên mọi thứ: người chơi thử lại sau vài giây là
    // về đúng phòng cũ, còn xoá mapping ở đây là mất hẳn đường về.
    if (loaded.status === "unavailable") return { status: "unavailable" };
    if (loaded.status === "corrupt") {
      await dependencies.clearPersistedRoom(playerId);
      return { status: "corrupt" };
    }
    if (loaded.status === "missing") {
      await dependencies.clearPersistedRoom(playerId);
      return { status: "none" };
    }
    room = loaded.room;
  }

  const member = room.members.find((candidate) => candidate.playerId === playerId);
  if (!member) {
    await dependencies.clearPersistedRoom(playerId);
    return { status: "none" };
  }

  member.connected = true;
  member.disconnectedAt = null;
  await dependencies.saveRoom(room);
  return { status: "joined", room };
}
