import { roleTeam, type Role } from "@masoi/shared";
import type { StrategicPlanner, StrategyContext } from "./planner";
import type { VoteScoringFrame } from "../decision/vote-decision";
import type { RoleBelief } from "../belief/role-belief";
import { sumTerms, type TraceTerm } from "../trace/trace";

/**
 * PR 3 của BOT_AI_CONTINUE_UPGRADE (§10/§11/§35): counterfactual MỘT BƯỚC có
 * CẤU TRÚC — vươn `selectVote` từ "điểm ngay bây giờ" sang expectedOutcome.
 *
 * Câu hỏi mỗi thành phần trả lời (spec §10), tất cả đọc từ projection PR 1
 * (`RoleBelief`) chứ không từ raw suspicion:
 *
 * - `teamValue`  : treo trúng phe Sói thì pha sau làng lợi bao nhiêu?
 * - `survivalValue`: treo NHẦM thì làng mất một ghế — đắt cỡ nào khi còn ít ghế?
 * - `informationValue`: người bị treo còn là NGUỒN DỮ LIỆU (reasons trong
 *   belief) mà làng đang khan dữ liệu thì mất thêm phần đó.
 *
 * Khác v20 (`lookAheadVotePlanner`): v20 gộp cả ba ý vào một số hạng `futureRisk`
 * với proxy `1 − suspicion/100`; v21 tách thành phần và dùng P(wolf-team) đã
 * chuẩn hoá theo composition, kể cả vai Sói Pháp Sư trong khối Sói. Khi preset
 * khai nhóm `counterfactual`, planner này THAY planner look-ahead (chỉ một lớp
 * counterfactual tại một thời điểm — hai lớp chồng nhau là đếm đôi).
 *
 * Nhánh Sói (`wolfSideGain = 0` ở v21): cả ba thành phần = 0 → wrapper trả
 * nguyên evaluation gốc, bảng điểm Sói byte-identical v18. Nhờ vậy bench
 * A/B đo đúng MỘT thay đổi: nhánh làng.
 *
 * Tất định: không RNG. Σterms === score được giữ vì mỗi thành phần là MỘT term
 * có tên cộng vào bảng của scorer gốc.
 */

export interface ExpectedOutcome {
  teamValue: number;
  survivalValue: number;
  informationValue: number;
  /** P(phe Sói) của mục tiêu — đã dùng để tính các thành phần trên. */
  wolfProbability: number;
}

export interface CounterfactualVotePlannerOptions {
  beliefs: Record<string, RoleBelief>;
}

export function expectedOutcomeFor(
  targetId: string,
  ctx: StrategyContext<VoteScoringFrame>,
  beliefs: Record<string, RoleBelief>,
): ExpectedOutcome {
  const tuning = ctx.frame?.weights.counterfactual;
  if (!tuning) {
    return { teamValue: 0, survivalValue: 0, informationValue: 0, wolfProbability: 0 };
  }

  const belief = beliefs[targetId];
  const wolfProbability = belief
    ? Object.entries(belief.probabilities)
        .filter(([role]) => roleTeam(role as Role) === "wolves")
        .reduce((sum, [, probability]) => sum + probability, 0)
    : 0;
  const innocentProbability = 1 - wolfProbability;

  const selfIsWolf = wolfSideIsWolf(ctx);
  if (selfIsWolf && tuning.wolfSideGain === 0) {
    return { teamValue: 0, survivalValue: 0, informationValue: 0, wolfProbability };
  }

  // Áp lực sĩ số — cùng phép đo mà cổng abstain của `selectVote` dùng, nên
  // "câu hỏi còn bao nhiêu mạng" được trả lời MỘT cách trong cả file.
  const players = ctx.context.knowledge.players;
  const total = players.length;
  const alive = players.filter((player) => player.alive).length;
  const pressure = total === 0 ? 0 : clampUnit(1 - alive / total);

  /*
   * Nhánh Sói (v22): hai bên của một lá phiếu, đo bằng xác suất đã ghim.
   *
   * - teamValue: bỏ phiếu người KHÔNG phải Sói (innocentProb) khi làng còn
   *   đông-thêm-được là tiến — mỗi ghế làng bớt đưa Sói gần hoà số hơn.
   * - survivalValue: phiếu vào người có P(wolf) cao là RỦI RO — tệ nhất là vào
   *   ĐỒNG BỌN (P=1 qua KNOWN_ALLY ghim), phạt tối đa cùng thang
   *   `mislynchSurvivalCost` của nhánh làng.
   * - informationValue = 0: "mất nguồn dữ liệu làng" không phải lợi ích mà Sói
   *   nên được thưởng trực tiếp — đó là tác dụng phụ, để phiếu nói thay.
   */
  if (selfIsWolf) {
    return {
      teamValue: tuning.wolfSideGain * innocentProbability * pressure,
      survivalValue: -tuning.mislynchSurvivalCost * wolfProbability * pressure,
      informationValue: 0,
      wolfProbability,
    };
  }

  // Team value: treo trúng Sói là một ghế Sói bớt — giá trị ròng dương, scaled
  // theo xác suất; phần "nhầm người được làng tin" đã nằm trong survivalValue.
  const teamValue = tuning.teamValueGain * wolfProbability;

  // Survival value: treo nhầm là mất một ghế LÀNG khi làng đã mỏng. Chỉ phần
  // vô tội mới phải trả giá này (trúng Sói thì không "mất" gì so với đêm cắn).
  const survivalValue = -tuning.mislynchSurvivalCost * innocentProbability * pressure;

  // Information value: người có evidence reasons là một nguồn dữ liệu đang sống;
  // làng khan nguồn (ít người còn mang bằng chứng) thì treo nhầm nguồn là đắt.
  let informationValue = 0;
  const reasons = ctx.state.suspicion[targetId]?.reasons.length ?? 0;
  if (reasons > 0) {
    const aliveIds = players
      .filter((player) => player.alive && player.id !== targetId)
      .map((player) => player.id);
    let bearing = 0;
    for (const id of aliveIds) {
      if ((ctx.state.suspicion[id]?.reasons.length ?? 0) > 0) bearing += 1;
    }
    const scarcity = aliveIds.length === 0 ? 0 : 1 - bearing / aliveIds.length;
    informationValue = -tuning.evidenceLossCost * innocentProbability * scarcity;
  }

  return { teamValue, survivalValue, informationValue, wolfProbability };
}

/**
 * Bọc planner immediate-utility: cộng ba term named vào CUỐI bảng điểm. Risk
 * = 0 (Sói ở v21, hoặc preset không khai nhóm) → trả nguyên bản gốc, kể cả
 * thứ tự term.
 */
export function counterfactualVotePlanner(
  base: StrategicPlanner<VoteScoringFrame>,
  beliefs: Record<string, RoleBelief>,
): StrategicPlanner<VoteScoringFrame> {
  return {
    name: "counterfactual-v1",
    evaluate(candidate, ctx) {
      const baseEvaluation = base.evaluate(candidate, ctx);
      const outcome = expectedOutcomeFor(candidate, ctx, beliefs);
      if (
        outcome.teamValue === 0 &&
        outcome.survivalValue === 0 &&
        outcome.informationValue === 0
      ) {
        return baseEvaluation;
      }
      const terms: TraceTerm[] = [
        ...baseEvaluation.terms,
        { name: "teamValue", value: outcome.teamValue },
        { name: "survivalValue", value: outcome.survivalValue },
        { name: "informationValue", value: outcome.informationValue },
      ];
      return { ...baseEvaluation, terms, score: sumTerms(terms) };
    },
  };
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function wolfSideIsWolf(ctx: StrategyContext<VoteScoringFrame>): boolean {
  const selfRole = ctx.context.knowledge.selfRole;
  return selfRole === "WEREWOLF" || selfRole === "WOLF_CUB";
}
