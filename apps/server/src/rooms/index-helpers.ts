import { allRooms } from "./store";

export function getRoomSyncByPlayer(playerId: string): string | null {
  for (const room of allRooms()) {
    if (room.members.some((m) => m.playerId === playerId)) return room.code;
  }
  return null;
}
