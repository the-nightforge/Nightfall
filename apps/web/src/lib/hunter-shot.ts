import type { HunterShotView, PlayerView, RoomSnapshot } from "@masoi/shared";

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

export function hunterShotOutcomeText(reaction: HunterShotView): string | null {
  if (!reaction.resolved) return null;
  return reaction.target
    ? `Thợ Săn ${reaction.hunterName} đã bắn ${reaction.target.name}.`
    : `Thợ Săn ${reaction.hunterName} đã không bắn ai.`;
}
