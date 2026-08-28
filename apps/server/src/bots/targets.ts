import type { Role, RoomSnapshot } from "@masoi/shared";
import type { NightActionType, PlannedVote } from "./types";

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
  // Không có nạn nhân thì engine từ chối HEAL, nên đừng chào nó cho bot.
  if (!view.night?.healUsed && view.night?.wolfTarget) out.push("HEAL");
  if (!view.night?.poisonUsed) out.push("POISON");
  out.push("SKIP");
  return out;
}

/** Mục tiêu phản kích hợp lệ của đúng bot Thợ Săn đang có quyền hành động. */
export function legalHunterTargets(view: RoomSnapshot): string[] {
  if (!view.hunterShot?.canAct || view.hunterShot.resolved || view.you?.role !== "HUNTER") {
    return [];
  }
  return view.players
    .filter((player) => player.alive && player.id !== view.you?.id)
    .map((player) => player.id);
}

/**
 * Phiếu xác nhận suy ra tại chỗ, không gọi mạng.
 *
 * Chỉ là ĐƯỜNG LUI khi chuỗi não hỏng hoặc lỡ hạn - quyết định thật đi qua
 * decideFinalVote, vốn có đọc lời biện hộ.
 */
export function derivedFinalVote(
  view: RoomSnapshot,
  myNomination: PlannedVote | undefined,
): boolean {
  const accusedId = view.trial?.accusedId;
  if (!accusedId) return false;
  const accused = view.players.find((p) => p.id === accusedId);
  // Sói thấy vai đồng bọn trong snapshot của chính mình, đúng như legalNightTargets dùng.
  if (view.you?.role === "WEREWOLF" && accused?.role === "WEREWOLF") return false;
  if (myNomination?.type === "NO_ELIMINATION") return false;
  // Mặc định Treo. Nếu đường lui chỉ treo người mà chính bot đã đề cử, một làng
  // bot rải phiếu sẽ không bao giờ đạt đa số tuyệt đối, không ai bị treo, và Sói
  // thắng bằng bào mòn mỗi lần nhà cung cấp gặp sự cố.
  return true;
}

/**
 * Dạng engine hiểu. null ở đây là phiếu "Không treo ai" chứ không phải phiếu
 * trống - submitVote phân biệt hai thứ đó bằng undefined và null.
 *
 * Không còn helper "mục tiêu hợp lệ ban ngày" ở đây: từ Phase 1, lá phiếu ban
 * ngày do lõi deterministic chọn trong `legalVoteChoices` của chính engine, nên
 * một bản sao luật ở tầng server chỉ là thứ để trôi lệch.
 */
export function engineVote(vote: PlannedVote): string | null {
  return vote.type === "PLAYER" ? vote.targetId : null;
}
