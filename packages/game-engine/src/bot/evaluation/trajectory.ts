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
    /**
     * Mục tiêu hợp lệ đêm nay THEO LOẠI hành động (`night.legalTargets`), chỉ
     * những loại được chào; `null` = không có lượt đêm. Đây là nguồn của mask
     * (loại, mục tiêu) — `legalActions` phẳng ở trên chỉ là hợp của nó.
     */
    nightLegalTargets: Record<string, string[]> | null;
    knownRoles: Record<string, Role>;
    seerResult: { targetId: string; isWolf: boolean } | null;
    belief: {
      playerId: string;
      suspicion: number;
      trust: number;
      wolfProbability: number;
      threat: number;
      credibility: number;
      influence: number;
      informationValue: number;
      claimedPowerRole: boolean;
      guardedBefore: boolean;
    }[];
    personality: BotDecisionTrace["personality"];
    /** Nạn nhân bầy đã chốt; chỉ Sói và Phù Thuỷ (sau khoá) thấy khác `null`. */
    nightWolfTarget: string | null;
    /** Chỉ Phù Thuỷ thấy `true`. */
    healUsed: boolean;
    poisonUsed: boolean;
    /** Chỉ Bảo Vệ thấy khác `null`. */
    guardPrevious: string | null;
    /** Công khai với cả bàn. */
    lastNightDeaths: string[];
    voteCounts: { players: Record<string, number>; noElimination: number };
    trialAccusedId: string | null;
  };
  legalActions: string[];
  candidates: BotDecisionTrace["candidates"];
  /**
   * `kind` là `NightActionKind` với quyết định NIGHT (`null` = bot không làm
   * gì), và `null` với mọi quyết định khác. Nhãn train là cặp (kind, target):
   * HEAL và POISON cùng một người là hai nước đi khác nhau.
   */
  selectedAction: { decision: string; targetId: string | null; label: string; kind: string | null };
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
      // Trace cũ không có assessment: 0 là "không có tín hiệu", đúng nghĩa với
      // cả bốn thang 0..1 này.
      wolfProbability: entry.wolfProbability ?? 0,
      threat: entry.threat ?? 0,
      credibility: entry.credibility ?? 0,
      influence: entry.influence ?? 0,
      informationValue: entry.informationValue ?? 0,
      claimedPowerRole: entry.claimedPowerRole ?? false,
      guardedBefore: entry.guardedBefore ?? false,
    }));
    belief.sort((left, right) => left.playerId.localeCompare(right.playerId));

    const snapshot = trace.knowledgeSnapshot;
    // Chỉ giữ loại hành động CÓ mục tiêu hoặc được chào rõ (SKIP của Phù Thuỷ):
    // engine khởi tạo đủ 10 khoá với mảng rỗng, và một khoá rỗng không phải
    // một lựa chọn.
    let nightLegalTargets: Record<string, string[]> | null = null;
    if (snapshot.nightLegalTargets) {
      nightLegalTargets = {};
      const offered = new Set(snapshot.nightLegalActions ?? []);
      for (const [kind, targets] of Object.entries(snapshot.nightLegalTargets)) {
        if (targets.length > 0 || offered.has(kind)) nightLegalTargets[kind] = [...targets].sort();
      }
    }

    lines.push({
      gameId: seed,
      seed,
      playerId: trace.botId,
      finalRole,
      turn: trace.round,
      phase: trace.phase,
      decision: trace.decision,
      observation: {
        aliveIds: [...snapshot.aliveIds].sort(),
        legalActions: [...legalActions],
        nightLegalTargets,
        knownRoles: { ...snapshot.knownRoles },
        seerResult: snapshot.seerResult ? { ...snapshot.seerResult } : null,
        belief,
        personality: { ...trace.personality },
        nightWolfTarget: snapshot.nightWolfTarget ?? null,
        healUsed: snapshot.healUsed ?? false,
        poisonUsed: snapshot.poisonUsed ?? false,
        guardPrevious: snapshot.guardPrevious ?? null,
        lastNightDeaths: [...(snapshot.lastNightDeaths ?? [])].sort(),
        voteCounts: snapshot.voteCounts
          ? {
              players: { ...snapshot.voteCounts.players },
              noElimination: snapshot.voteCounts.noElimination,
            }
          : { players: {}, noElimination: 0 },
        trialAccusedId: snapshot.trialAccusedId ?? null,
      },
      legalActions,
      candidates: trace.candidates.map((candidate) => ({ ...candidate })),
      selectedAction: {
        decision: trace.decision,
        targetId: trace.chosen.targetId,
        label: trace.chosen.label,
        // Trace cũ không có `actionKind`: với NIGHT thì `label` chính là kind
        // (BotRuntime ghi `night.action`), trừ "bỏ lượt" là không làm gì.
        kind:
          trace.decision === "NIGHT"
            ? (trace.chosen.actionKind ??
              (trace.chosen.targetId === null && trace.chosen.label === "bỏ lượt"
                ? null
                : trace.chosen.label))
            : null,
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
