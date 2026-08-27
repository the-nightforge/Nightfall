import type { Room, RoomStatus } from "./store";

export function roomEntryError(
  currentRoomCode: string | null,
  targetRoomCode: string,
  targetStatus: RoomStatus,
  alreadyMember: boolean,
): string | null {
  if (currentRoomCode && currentRoomCode !== targetRoomCode) {
    return "Bạn phải rời phòng hiện tại trước khi vào phòng khác";
  }
  if (targetStatus === "IN_GAME" && !alreadyMember) {
    return "Trận đấu đã bắt đầu";
  }
  return null;
}

export function allRequiredPlayersReady(room: Room): boolean {
  return room.members
    .filter((member) => !member.isBot && member.playerId !== room.hostId)
    .every((member) => member.ready);
}
