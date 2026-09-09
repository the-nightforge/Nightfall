import { roleWonOutcome, type Role } from "@masoi/shared";
import type { BotDecisionTrace } from "../trace/trace";
import type { SelfPlayGame } from "./selfplay";

/**
 * PR 7 của BOT_AI_CONTINUE_UPGRADE (§22): trajectory export — mỗi quyết định
 * được trace thành MỘT dòng JSONL phục vụ tầng train sau này (PR 8).
 *
 * Nguồn dữ liệu: `BotDecisionTrace` (đã có đủ candidates/terms/belief/knowledge
 * snapshot, và đã bị kiểm bởi invariant `TRACE ⊆ knowledge`), cộng hai nhãn
 * cấp-ván: vai thật của CHÍNH bot và kết quả ván. Section 22 cấm placing hidden
 * information vào observation — ở đây thực thi bằng CẤU TRÚC:
 *
 * - `observation` chỉ gồm các trường có nguồn từ `knowledgeSnapshot` của trace
 *   (đã lọc theo quyền của bot trước khi ghi) + belief snapshot. Vai thật của
 *   người khác KHÔNG có đường vào đây: `knownRoles` trong snapshot là bảng
 *   engine cấp cho đúng bot đó, không phải GroundTruth.
 * - `finalRole` (vai thật của chính bot) và `finalWinner` là NHÃN cấp-ván cho
 *   tầng train, nằm ở CẤP MỘT của line, không bao giờ lẫn vào `observation`.
 * - `reward = ±1` theo đúng luật thắng: `roleWonOutcome` cho thắng theo phe,
 *   cộng thắng cá nhân (`personalWins` — Thằng Hề/Kẻ Báo Thù) — cùng quy ước
 *   với `metrics.ts`, không dựng lại luật.
 *
 * Tất định: cùng game → cùng chuỗi JSONL.
 */

export interface BotTrajectory {
  /** Nhận diện ván: chính là seed của ván self-play. */
  gameId: string;
  seed: string;
  playerId: string;
  /** Vai THẬT của bot — nhãn cấp-ván cho tầng train, KHÔNG nằm trong observation. */
  finalRole: Role;
  turn: number;
  phase: string;
  decision: string;
  /** Chỉ dữ liệu đã lọc theo quyền của bot (trace knowledge snapshot). */
  observation: {
    aliveIds: string[];
    legalActions: string[];
    knownRoles: Record<string, Role>;
    seerResult: { targetId: string; isWolf: boolean } | null;
    belief: { playerId: string; suspicion: number; trust: number }[];
    personality: BotDecisionTrace["personality"];
    /**
     * Mục tiêu hợp lệ TÁCH THEO từng loại hành động đêm; `null` ngoài lượt đêm.
     *
     * `legalActions` ở trên là HỢP của các tập này, và cái hợp đó xoá mất thứ
     * quyết định nước đi: một Phù Thuỷ thấy tập Cứu và tập Độc trộn làm một sẽ
     * được hỏi "chọn ai" mà không biết mình đang cứu hay đang giết — hai mục
     * tiêu ngược nhau dưới cùng một nhãn.
     */
    nightLegalTargets: Record<string, string[]> | null;
  };
  legalActions: string[];
  candidates: BotDecisionTrace["candidates"];
  selectedAction: { decision: string; targetId: string | null; label: string };
  /** +1 thắng / −1 thua theo đúng luật (kể cả thắng cá nhân vai trung lập). */
  reward: number;
  finalWinner: string;
}

/**
 * Tập hành động hợp lệ ĐÚNG với loại quyết định của line.
 *
 * `legalChoices` là tập BAN NGÀY; đọc nó cho một quyết định NIGHT sẽ ra mảng
 * rỗng và biến mọi hành động đêm thành "ngoài luật" với tầng kiểm dataset
 * (BOT_SELF_LEARNING §42). Ba loại quyết định CHỌN MỤC TIÊU có ba tập riêng;
 * `FINAL_VOTE` (treo/tha) và `SPEECH` không chọn mục tiêu trong không gian này
 * nên vẫn mang tập ban ngày để tham khảo, và tầng kiểm không ép luật cho chúng.
 *
 * Đêm gộp mục tiêu của MỌI loại hành động bot có: nó chọn cả loại lẫn mục tiêu
 * trong một lượt, nên hợp của các tập chính là tập nó được chọn.
 */
/** Sao chép sâu, để trajectory không giữ tham chiếu sống vào snapshot của trace. */
function copyNightLegalTargets(
  targets: Record<string, string[]> | null | undefined,
): Record<string, string[]> | null {
  if (!targets) return null;
  const copy: Record<string, string[]> = {};
  for (const [kind, list] of Object.entries(targets)) copy[kind] = [...list].sort();
  return copy;
}

function legalActionsFor(trace: BotDecisionTrace): string[] {
  const snapshot = trace.knowledgeSnapshot;
  if (trace.decision === "NIGHT") {
    const targets = new Set<string>();
    for (const list of Object.values(snapshot.nightLegalTargets ?? {})) {
      for (const target of list) targets.add(target);
    }
    return [...targets].sort();
  }
  if (trace.decision === "HUNTER_SHOT") return [...(snapshot.hunterLegalTargets ?? [])];
  return [...snapshot.legalChoices];
}

function rewardFor(game: SelfPlayGame, playerId: string, role: Role): number {
  const personalWon = (game.personalWins ?? []).some(
    (win) => win.playerId === playerId,
  );
  if (personalWon) return 1;
  // `winner === null` chỉ còn ở ván tràn trần `maxRounds` — không phe nào thắng
  // → mọi vai đều thua (±1 reward phải có, draw cũng không phải thắng, khớp
  // `roleWonOutcome` trả false cho draw).
  if (game.winner === null) return -1;
  return roleWonOutcome(role, game.winner) ? 1 : -1;
}

/**
 * Chuyển một ván self-play (có trace) thành danh sách trajectory — MỘT line
 * cho MỘT quyết định được trace. Ván không trace (traceGames cap) không sinh
 * line nào: danh sách rỗng là đúng, không bịa observation thay thế.
 */
export function gameToTrajectories(game: SelfPlayGame): BotTrajectory[] {
  const lines: BotTrajectory[] = [];
  const seed = game.record.seed;

  for (const trace of game.traces) {
    const finalRole = game.roles[trace.botId];
    if (!finalRole) continue;

    const legalActions = legalActionsFor(trace);

    const belief = Object.entries(trace.beliefAfter).map(([playerId, entry]) => ({
      playerId,
      suspicion: entry.suspicion,
      trust: entry.trust,
    }));
    belief.sort((left, right) => left.playerId.localeCompare(right.playerId));

    lines.push({
      gameId: seed,
      seed,
      playerId: trace.botId,
      finalRole,
      turn: trace.round,
      phase: trace.phase,
      decision: trace.decision,
      observation: {
        aliveIds: [...trace.knowledgeSnapshot.aliveIds].sort(),
        legalActions: [...legalActions],
        knownRoles: { ...trace.knowledgeSnapshot.knownRoles },
        seerResult: trace.knowledgeSnapshot.seerResult
          ? { ...trace.knowledgeSnapshot.seerResult }
          : null,
        belief,
        personality: { ...trace.personality },
        nightLegalTargets: copyNightLegalTargets(trace.knowledgeSnapshot.nightLegalTargets),
      },
      legalActions,
      candidates: trace.candidates.map((candidate) => ({ ...candidate })),
      selectedAction: {
        decision: trace.decision,
        targetId: trace.chosen.targetId,
        label: trace.chosen.label,
      },
      reward: rewardFor(game, trace.botId, finalRole),
      finalWinner: game.winner ?? "draw",
    });
  }

  return lines;
}

/** Một line một dòng JSON: mỗi lần gọi là một bản ghi ghi được vào file. */
export function serializeTrajectory(trajectory: BotTrajectory): string {
  return JSON.stringify(trajectory);
}
