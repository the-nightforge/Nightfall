import { ROLE_META, sameFaction, type Role } from "@masoi/shared";
import type { BotDecisionTrace } from "../trace/trace";
import type { SelfPlayGame } from "./selfplay";

/**
 * Nhãn shaping (spec 2026-09-11-shaping-reward-design D2): "nước đi có trúng
 * phe địch không" — tín hiệu từng-quyết-định có nguồn từ luật game, cho tầng
 * train PPO (A = R − b + α·L). Đo trên 500 ván: E[L|win] − E[L|loss] = +0.34 ±
 * 0.02 ở VOTE làng, +0.43 ± 0.02 ở FINAL_VOTE làng, và IM LẶNG ở FINAL_VOTE
 * Sói (+0.014 ± 0.027) — vì vậy việc có nhãn hay không phải chính xác đến từng
 * loại quyết định.
 *
 * Đây là NHÃN cho tầng train, cùng bản chất với `reward`/`finalRole` — KHÔNG
 * phải observation. Không đường nào đưa nó vào `BotDecisionContext`.
 *
 * Vai trung lập không cùng phe với ai (`sameFaction`) và có điều kiện thắng
 * riêng, nên nhãn phe-hoá là sai bản chất của chúng → null. NIGHT cũng null:
 * với Sói "cắn trúng phe địch" tầm thường (mục tiêu đêm không bao giờ là Sói),
 * nhãn đêm có giá trị là một định nghĩa theo threat — việc riêng sau v1 (D3).
 */

const SHAPED_DECISIONS: ReadonlySet<string> = new Set(["VOTE", "FINAL_VOTE", "HUNTER_SHOT"]);

export function shapingLabelFor(game: SelfPlayGame, trace: BotDecisionTrace): number | null {
  if (!SHAPED_DECISIONS.has(trace.decision)) return null;

  const actorRole: Role | undefined = game.roles[trace.botId];
  const targetId = trace.chosen.targetId;
  if (!actorRole || !targetId) return null;
  const targetRole: Role | undefined = game.roles[targetId];
  if (!targetRole) return null;
  if (ROLE_META[actorRole].team === "neutral" || ROLE_META[targetRole].team === "neutral") {
    return null;
  }

  const enemy = !sameFaction(actorRole, targetRole);
  if (trace.decision === "FINAL_VOTE") {
    // Bị cáo cố định; quyết định là treo/tha. Thưởng sự NHẤT QUÁN giữa phán
    // quyết và phe của bị cáo (BotRuntime.decideFinalVote ghi label "treo"/"tha").
    return (trace.chosen.label === "treo") === enemy ? 1 : -1;
  }
  return enemy ? 1 : -1;
}
