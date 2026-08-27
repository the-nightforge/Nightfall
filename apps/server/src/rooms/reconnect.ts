import type { Room } from "./store";

export interface ReconnectDependencies {
  findCachedRoom: (playerId: string) => Room | undefined;
  getPersistedRoomCode: (playerId: string) => Promise<string | null>;
  loadRoom: (code: string) => Promise<Room | null>;
  clearPersistedRoom: (playerId: string) => Promise<void>;
  saveRoom: (room: Room) => Promise<void>;
}

export async function reconnectPlayer(
  playerId: string,
  dependencies: ReconnectDependencies,
): Promise<Room | null> {
  let room = dependencies.findCachedRoom(playerId);

  if (!room) {
    const roomCode = await dependencies.getPersistedRoomCode(playerId);
    if (!roomCode) return null;
    room = (await dependencies.loadRoom(roomCode)) ?? undefined;
  }

  const member = room?.members.find((candidate) => candidate.playerId === playerId);
  if (!room || !member) {
    await dependencies.clearPersistedRoom(playerId);
    return null;
  }

  member.connected = true;
  await dependencies.saveRoom(room);
  return room;
}
