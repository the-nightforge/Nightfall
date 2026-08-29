import { roleTeam, type Phase, type Role } from "@masoi/shared";
import type { BotBrainState, BotKnowledgeView, BotNightIntention } from "../types";
import type { BotDecisionTrace } from "../trace/trace";
import { MAX_BELIEF_SCORE } from "../belief/evidence";
import type { SelfPlayRecord } from "./selfplay";

/**
 * Kiểm ranh giới hiểu biết TRONG LÚC mô phỏng chạy.
 *
 * Kiểm sau khi ván xong là quá muộn: state cuối không cho biết một BOT đã từng
 * nhìn thấy gì ở vòng 3. Vì vậy mọi kiểm tra ở đây chạy tại các mốc chuyển pha,
 * trên đúng `BotKnowledgeView` mà BOT vừa nhận.
 *
 * Vi phạm KHÔNG ném. Ném sẽ dừng batch ở ván đầu tiên và giấu mất 299 ván còn
 * lại; chúng được gom, đếm, và làm đỏ test ở tầng khẳng định.
 */

export type InvariantId =
  /** BOT biết vai người khác ngoài phần luật cho phép. */
  | "ROLE_LEAK"
  /** Vai người chết lộ cho người còn sống trước `GAME_OVER`. */
  | "DEAD_ROLE_REVEALED"
  /** Sói biết đồng bọn sai luật, hoặc Sói đã chết vẫn giữ liên lạc với bầy. */
  | "WOLF_ALLY_SCOPE"
  /** Ai đó thấy kết quả soi không phải của mình. */
  | "SEER_RESULT_SCOPE"
  /** Hành động được gửi bởi hoặc cho người đã chết. */
  | "ACTION_BY_DEAD"
  /** Engine từ chối một nước đi do lõi sinh ra. */
  | "ILLEGAL_ACTION"
  /** Nhắm người chết khi luật không cho phép. */
  | "DEAD_TARGET"
  /** Evidence mang round lớn hơn round hiện tại. */
  | "FUTURE_EVIDENCE"
  /** Render lời thoại làm đổi nước đi. */
  | "SPEECH_CHANGED_ACTION"
  /** NaN, Infinity, hoặc xác suất ngoài `[0, 1]`. */
  | "NUMERIC_SANITY"
  /** Cùng seed cho ra khác nhau. */
  | "REPLAY_DIVERGENCE"
  /** Ván chạm trần số vòng. */
  | "ROUND_LIMIT";

export interface InvariantViolation {
  id: InvariantId;
  seed: string;
  /** Đủ để dựng lại chính xác ván này, một mình. */
  record: SelfPlayRecord;
  round: number;
  phase: Phase;
  playerId: string | null;
  expected: string;
  actual: string;
  /** Chuỗi sự kiện TỐI THIỂU dẫn tới vi phạm, không phải toàn bộ log. */
  events: string[];
}

/** Sự thật do runner nắm giữ, KHÔNG bao giờ đi ngược vào một `BotDecisionContext`. */
export interface GroundTruth {
  roles: Record<string, Role>;
  alive: Record<string, boolean>;
  /**
   * Sự kiện đang có hiệu lực, nếu có.
   *
   * Cần cho những bất biến mà một sự kiện được phép phá. Bóng Sói cố tình đảo
   * kết quả soi, nên nếu không có trường này thì kiểm tra "kết quả soi phải
   * khớp sự thật" sẽ tố cáo chính cái luật mà engine đang thi hành đúng.
   */
  activeEventId?: string | null;
}

export interface InvariantAuditor {
  readonly violations: InvariantViolation[];
  /** Ghi một dòng vào bộ đệm sự kiện gần đây, dùng làm ngữ cảnh khi có vi phạm. */
  note(line: string): void;
  checkKnowledge(knowledge: BotKnowledgeView, state: BotBrainState, truth: GroundTruth): void;
  checkNightAction(
    knowledge: BotKnowledgeView,
    intention: BotNightIntention,
    truth: GroundTruth,
  ): void;
  checkTrace(trace: BotDecisionTrace, truth: GroundTruth): void;
  report(
    id: InvariantId,
    detail: {
      round: number;
      phase: Phase;
      playerId: string | null;
      expected: string;
      actual: string;
    },
  ): void;
}

/** Số dòng ngữ cảnh giữ lại quanh một vi phạm. Toàn bộ log là quá nhiều để đọc. */
const CONTEXT_LINES = 12;

function isProbability(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function isWolfTeam(role: Role | undefined): boolean {
  return role !== undefined && roleTeam(role) === "wolves";
}

export function createInvariantAuditor(record: SelfPlayRecord): InvariantAuditor {
  const violations: InvariantViolation[] = [];
  const recent: string[] = [];
  /** Một vi phạm lặp lại mỗi vòng sẽ nhấn chìm báo cáo; ghi mỗi loại một lần / người. */
  const seen = new Set<string>();

  const auditor: InvariantAuditor = {
    violations,

    note(line) {
      recent.push(line);
      if (recent.length > CONTEXT_LINES) recent.shift();
    },

    report(id, detail) {
      const key = `${id}:${detail.playerId ?? "-"}:${detail.expected}`;
      if (seen.has(key)) return;
      seen.add(key);
      violations.push({
        id,
        seed: record.seed,
        record,
        round: detail.round,
        phase: detail.phase,
        playerId: detail.playerId,
        expected: detail.expected,
        actual: detail.actual,
        events: [...recent],
      });
    },

    checkKnowledge(knowledge, state, truth) {
      const self = knowledge.botId;
      const selfIsWolf = isWolfTeam(truth.roles[self]);
      const at = { round: knowledge.round, phase: knowledge.phase, playerId: self };

      // --- Ai được biết vai của ai ---
      for (const [otherId, role] of Object.entries(knowledge.knownRoles)) {
        if (otherId === self) continue;

        // Luật duy nhất cho phép biết vai người khác: cùng phe Sói. Kiểm theo
        // PHE chứ không theo mã vai - Sói Con và Kẻ Nguyền Rủa đã hoá Sói đều
        // hợp lệ, và một kiểm tra chỉ so với "WEREWOLF" sẽ báo động giả ở đúng
        // những cấu hình vai mà nó cần bảo vệ nhất.
        if (!selfIsWolf || !isWolfTeam(truth.roles[otherId])) {
          auditor.report("ROLE_LEAK", {
            ...at,
            expected: `${self} không được biết vai của ${otherId}`,
            actual: `biết ${otherId} là ${role}`,
          });
          continue;
        }

        // Sói đã chết mất liên lạc với bầy.
        if (!truth.alive[self]) {
          auditor.report("WOLF_ALLY_SCOPE", {
            ...at,
            expected: `${self} đã chết nên không còn thấy đồng bọn`,
            actual: `vẫn thấy ${otherId}`,
          });
        }

        // Vai phải khớp sự thật; một mã vai sai cũng là rò rỉ (sai lệch).
        if (role !== truth.roles[otherId]) {
          auditor.report("ROLE_LEAK", {
            ...at,
            expected: `${otherId} thật ra là ${truth.roles[otherId]}`,
            actual: `được báo là ${role}`,
          });
        }
      }

      // --- Vai người chết ẩn tới GAME_OVER ---
      if (knowledge.phase !== "GAME_OVER") {
        for (const [otherId, role] of Object.entries(knowledge.knownRoles)) {
          if (otherId === self || truth.alive[otherId]) continue;
          // Đồng bọn Sói đã chết vẫn được nhớ - Sói biết bầy của mình là ai,
          // sống hay chết. Mọi trường hợp khác là lộ vai người chết.
          if (selfIsWolf && isWolfTeam(truth.roles[otherId])) continue;
          auditor.report("DEAD_ROLE_REVEALED", {
            ...at,
            expected: `vai của người chết ${otherId} phải ẩn tới GAME_OVER`,
            actual: `${self} thấy ${role}`,
          });
        }
      }

      // --- Kết quả soi chỉ thuộc về người soi ---
      const result = knowledge.seerResult;
      if (result) {
        const canSee =
          truth.roles[self] === "SEER" || truth.roles[self] === "APPRENTICE_SEER";
        if (!canSee) {
          auditor.report("SEER_RESULT_SCOPE", {
            ...at,
            expected: `${self} không phải Tiên Tri nên không có kết quả soi`,
            actual: `nhận kết quả về ${result.targetId}`,
          });
        }
        // Bóng Sói đảo kết quả soi với xác suất 30%, nên trong đêm có sự kiện này
        // cả hai giá trị đều hợp lệ và không còn gì để đối chiếu. Chỉ miễn trừ
        // đúng phép so sánh với sự thật - kiểm tra "ai được cầm kết quả" ở trên
        // vẫn giữ nguyên hiệu lực.
        const seerResultMayLie = truth.activeEventId === "WOLF_SHADOW";
        if (!seerResultMayLie && result.isWolf !== isWolfTeam(truth.roles[result.targetId])) {
          auditor.report("SEER_RESULT_SCOPE", {
            ...at,
            expected: `kết quả soi ${result.targetId} phải khớp sự thật`,
            actual: `báo isWolf=${result.isWolf}`,
          });
        }
      }

      // --- Người chết không hành động ---
      if (!truth.alive[self] && knowledge.legalVoteChoices.length > 0) {
        auditor.report("ACTION_BY_DEAD", {
          ...at,
          expected: `${self} đã chết nên không được cấp lựa chọn phiếu`,
          actual: `có ${knowledge.legalVoteChoices.length} lựa chọn`,
        });
      }

      // --- Không nhắm người chết ---
      for (const choice of knowledge.legalVoteChoices) {
        if (choice.type !== "PLAYER") continue;
        if (truth.alive[choice.targetId]) continue;
        auditor.report("DEAD_TARGET", {
          ...at,
          expected: "không được chào mục tiêu đã chết",
          actual: `${choice.targetId} đã chết nhưng vẫn bầu được`,
        });
      }
      for (const targets of Object.values(knowledge.night?.legalTargets ?? {})) {
        for (const targetId of targets) {
          if (truth.alive[targetId]) continue;
          auditor.report("DEAD_TARGET", {
            ...at,
            expected: "mục tiêu đêm hợp lệ phải còn sống",
            actual: `${targetId} đã chết`,
          });
        }
      }

      // --- Không dùng bằng chứng từ tương lai ---
      //
      // Bắt cả một lớp bug tinh vi: một evidence mang round tương lai sẽ được
      // MIỄN DECAY vĩnh viễn, vì `age = max(0, round - lastUpdated)` kẹp ở 0.
      for (const table of [state.suspicion, state.trust]) {
        for (const [targetId, entry] of Object.entries(table)) {
          if (!Number.isFinite(entry.score)) {
            auditor.report("NUMERIC_SANITY", {
              ...at,
              expected: `belief của ${targetId} phải là số hữu hạn`,
              actual: String(entry.score),
            });
          }
          if (entry.score < 0 || entry.score > MAX_BELIEF_SCORE) {
            auditor.report("NUMERIC_SANITY", {
              ...at,
              expected: `belief của ${targetId} phải nằm trong [0, ${MAX_BELIEF_SCORE}]`,
              actual: String(entry.score),
            });
          }
          for (const reason of entry.reasons) {
            if (reason.round > knowledge.round) {
              auditor.report("FUTURE_EVIDENCE", {
                ...at,
                expected: `bằng chứng phải có round <= ${knowledge.round}`,
                actual: `${reason.id} mang round ${reason.round}`,
              });
            }
            if (!isProbability(reason.confidence)) {
              auditor.report("NUMERIC_SANITY", {
                ...at,
                expected: `confidence của ${reason.id} phải nằm trong [0, 1]`,
                actual: String(reason.confidence),
              });
            }
          }
        }
      }
    },

    checkNightAction(knowledge, intention, truth) {
      const at = {
        round: knowledge.round,
        phase: knowledge.phase,
        playerId: knowledge.botId,
      };

      if (!truth.alive[knowledge.botId]) {
        auditor.report("ACTION_BY_DEAD", {
          ...at,
          expected: "người chết không được hành động đêm",
          actual: `gửi ${intention.action}`,
        });
      }

      for (const targetId of [intention.targetId, intention.secondaryTargetId]) {
        if (!targetId) continue;
        if (!truth.alive[targetId]) {
          auditor.report("DEAD_TARGET", {
            ...at,
            expected: `mục tiêu của ${intention.action} phải còn sống`,
            actual: `${targetId} đã chết`,
          });
        }
      }

      if (!isProbability(intention.confidence)) {
        auditor.report("NUMERIC_SANITY", {
          ...at,
          expected: "confidence của nước đi đêm phải nằm trong [0, 1]",
          actual: String(intention.confidence),
        });
      }
    },

    checkTrace(trace, truth) {
      const at = { round: trace.round, phase: trace.phase, playerId: trace.botId };
      const selfIsWolf = isWolfTeam(truth.roles[trace.botId]);

      for (const [otherId, role] of Object.entries(trace.knowledgeSnapshot.knownRoles)) {
        if (otherId === trace.botId) continue;
        if (selfIsWolf && isWolfTeam(truth.roles[otherId])) continue;
        auditor.report("ROLE_LEAK", {
          ...at,
          expected: `trace của ${trace.botId} không được chứa vai của ${otherId}`,
          actual: `chứa ${role}`,
        });
      }

      for (const candidate of trace.candidates) {
        if (Number.isFinite(candidate.score)) continue;
        auditor.report("NUMERIC_SANITY", {
          ...at,
          expected: `điểm của ${candidate.targetId} phải là số hữu hạn`,
          actual: String(candidate.score),
        });
      }
    },
  };

  return auditor;
}
