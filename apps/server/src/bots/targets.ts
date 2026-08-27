import type { Role, RoomSnapshot } from "@masoi/shared";
import type { NightActionType } from "./types";

/** Vai chỉ có đúng một loại hành động đêm. Phù Thuỷ trả null vì có lựa chọn. */
export function soloNightAction(role: Role | undefined): NightActionType | null {
  switch (role) {
    case "WEREWOLF":
      return "KILL";
    case "SEER":
      return "SEE";
    case "GUARD":
      return "GUARD";
    default:
      return null;
  }
}

/**
 * Mục tiêu hợp lệ, khớp đúng các điều kiện engine kiểm tra trong
 * submitNightAction (packages/game-engine/src/engine.ts:144).
 */
export function legalNightTargets(view: RoomSnapshot, action: NightActionType): string[] {
  const me = view.you?.id;
  const alive = view.players.filter((p) => p.alive);

  switch (action) {
    case "KILL":
      // Sói thấy vai đồng bọn trong snapshot của mình nên lọc được
      return alive.filter((p) => p.id !== me && p.role !== "WEREWOLF").map((p) => p.id);
    case "SEE":
      return alive.filter((p) => p.id !== me).map((p) => p.id);
    case "GUARD":
      return alive.filter((p) => p.id !== view.night?.guardPrevious).map((p) => p.id);
    case "POISON":
      return alive.map((p) => p.id);
    case "HEAL":
      // Bình cứu cứu nạn nhân của đêm đó, không chỉ định mục tiêu
      return [];
  }
}

export function witchActions(view: RoomSnapshot): ("HEAL" | "POISON" | "SKIP")[] {
  const out: ("HEAL" | "POISON" | "SKIP")[] = [];
  if (!view.night?.healUsed) out.push("HEAL");
  if (!view.night?.poisonUsed) out.push("POISON");
  out.push("SKIP");
  return out;
}

export function legalVoteTargets(view: RoomSnapshot): string[] {
  const me = view.you?.id;
  return view.players.filter((p) => p.alive && p.id !== me).map((p) => p.id);
}

/** Phiếu bot đã định ở pha thảo luận chỉ dùng được nếu vẫn còn hợp lệ lúc bỏ phiếu. */
export function usablePlannedVote(view: RoomSnapshot, planned: string | undefined): string | null {
  if (!planned) return null;
  return legalVoteTargets(view).includes(planned) ? planned : null;
}
