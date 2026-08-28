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

export function legalVoteTargets(view: RoomSnapshot): string[] {
  const me = view.you?.id;
  return view.players.filter((p) => p.alive && p.id !== me).map((p) => p.id);
}

/**
 * Giá trị model dùng để nói "không treo ai". Phải nằm cùng trường với id người
 * chơi vì responseSchema của Gemini chỉ nhận một enum string duy nhất; id là
 * UUID (hoặc bot-<uuid>) nên không bao giờ đụng chuỗi này.
 */
export const NO_ELIMINATION_VOTE = "NO_ELIMINATION";

/** Tập giá trị hợp lệ cho voteTargetId: người còn sống, cộng lựa chọn không treo. */
export function legalVoteChoices(view: RoomSnapshot): string[] {
  return [...legalVoteTargets(view), NO_ELIMINATION_VOTE];
}

/**
 * Dạng engine hiểu. null ở đây là phiếu "Không treo ai" chứ không phải phiếu
 * trống - submitVote phân biệt hai thứ đó bằng undefined và null.
 */
export function engineVote(vote: PlannedVote): string | null {
  return vote.type === "PLAYER" ? vote.targetId : null;
}

/** Phiếu bot đã định ở pha thảo luận chỉ dùng được nếu vẫn còn hợp lệ lúc bỏ phiếu. */
export function usablePlannedVote(
  view: RoomSnapshot,
  planned: PlannedVote | undefined,
): PlannedVote | null {
  if (!planned) return null;
  // Không treo ai thì không có mục tiêu để mà hết hợp lệ giữa chừng.
  if (planned.type === "NO_ELIMINATION") return planned;
  return legalVoteTargets(view).includes(planned.targetId) ? planned : null;
}
