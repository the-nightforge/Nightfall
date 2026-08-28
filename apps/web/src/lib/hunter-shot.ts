import type { PlayerView, RoomSnapshot } from "@masoi/shared";

/** Client-side display filter only; the server remains authoritative. */
export function legalHunterShotTargets(snapshot: RoomSnapshot): PlayerView[] {
  if (
    !snapshot.hunterShot?.canAct
    || snapshot.hunterShot.resolved
    || snapshot.you?.role !== "HUNTER"
  ) {
    return [];
  }

  return snapshot.players.filter(
    (player) => player.alive && player.id !== snapshot.you?.id,
  );
}
