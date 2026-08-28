import { roleTeam, type Role, type Team } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { SelfPlayEvent, SelfPlayGame } from "./selfplay";

/**
 * Chỉ số chất lượng chơi, gom từ nhiều ván.
 *
 * Nguyên tắc duy nhất, áp cho mọi con số ở đây: **một tỉ lệ luôn đi kèm mẫu số
 * của nó**. Một báo cáo nói "Dân bỏ phiếu đúng 62%" mà không nói 62% của bao
 * nhiêu lá phiếu là một con số không kiểm chứng được, và tệ hơn, nó trông y hệt
 * một con số đáng tin. Mẫu số 0 cho ra `null`, không phải `0` và không phải
 * `NaN` - "chưa đo được" và "bằng không" là hai kết luận khác hẳn nhau.
 */

export interface Ratio {
  /** `null` khi mẫu số bằng 0. */
  value: number | null;
  numerator: number;
  denominator: number;
}

function ratio(numerator: number, denominator: number): Ratio {
  return {
    value: denominator === 0 ? null : numerator / denominator,
    numerator,
    denominator,
  };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export interface SelfPlayMetrics {
  games: number;
  finished: number;
  winRate: Record<Team, Ratio>;
  averageRounds: number | null;
  /** Phiếu chốt của một người phe làng nhắm trúng một con Sói thật. */
  villageVoteAccuracy: Ratio;
  /** Sói bỏ phiếu hoặc công khai tố đồng bọn. */
  wolfSelfSabotage: Ratio;
  /** Lá phiếu thay cho một lá đã bỏ trước đó trong cùng vòng. */
  voteChangeRate: Ratio;
  /** Mức đồng thuận trung bình: phiếu cho ứng viên dẫn đầu / số người bỏ phiếu. */
  consensus: number | null;
  /** Độ gắn kết trung bình của các nhóm mà BOT tự nhận ra. */
  coalitionCohesion: number | null;
  /** Bằng chứng đã quá cũ mà vẫn được mang theo một lá phiếu. */
  staleEvidenceRate: Ratio;
  /** PHẢI bằng 0. */
  knowledgeBoundaryViolations: number;
  /**
   * Nước đi lõi sinh ra mà engine TỪ CHỐI. Phải bằng 0.
   *
   * Tách khỏi `declinedTurns`: một lượt bị từ chối là lỗi của lõi, còn một lượt
   * chủ động bỏ là một quyết định. Gộp chúng lại thì Linh Mục giữ bình - nước đi
   * đúng của vai đó - sẽ được đếm y như một bug.
   */
  fallbackActions: number;
  /** Lượt mà vai CÓ hành động nhưng chủ động không dùng. Không phải lỗi. */
  declinedTurns: number;
  /** Nói lại đúng `(kiểu, mục tiêu)` của lần mình nói liền trước. */
  speechRepetitionRate: Ratio;
  roundLimitRate: Ratio;
}

export interface RoleMetrics {
  role: Role;
  /** Số ván có vai này trong bàn. */
  games: number;
  /** Số ván mà người mang vai này thuộc phe THẮNG. */
  wins: Ratio;
}

export interface TeamMetrics {
  team: Team;
  wins: Ratio;
  voteAccuracy: Ratio;
}

export interface SelfPlayMetricsBundle {
  overall: SelfPlayMetrics;
  byTeam: Record<Team, TeamMetrics>;
  byRole: RoleMetrics[];
}

/**
 * Bằng chứng được coi là *stale*.
 *
 * Không phải lỗi - trí nhớ dài là hợp lý, và một kết quả soi thì đáng nhớ mãi.
 * Nhưng tỉ lệ cao nghĩa là decay không làm việc, và BOT đang biện luận bằng
 * những chuyện không còn liên quan.
 */
const PERMANENT_KINDS = new Set(["SEER_RESULT_WOLF", "SEER_RESULT_CLEAR", "KNOWN_ALLY"]);

/** Phiếu CHỐT của mỗi người trong mỗi vòng; các lá trước đó đã bị thay. */
function finalVotesByRound(
  events: readonly SelfPlayEvent[],
): Map<number, Map<string, Extract<SelfPlayEvent, { kind: "VOTE" }>>> {
  const byRound = new Map<number, Map<string, Extract<SelfPlayEvent, { kind: "VOTE" }>>>();
  for (const event of events) {
    if (event.kind !== "VOTE") continue;
    const round = byRound.get(event.round) ?? new Map();
    // Ghi đè: sự kiện sau trong cùng vòng là lá phiếu mới hơn của cùng người.
    round.set(event.voterId, event);
    byRound.set(event.round, round);
  }
  return byRound;
}

export function collectMetrics(
  games: readonly SelfPlayGame[],
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): SelfPlayMetricsBundle {
  const staleAfter = weights.recency.staleAfterRounds;

  let finished = 0;
  let villageWins = 0;
  let wolfWins = 0;
  const roundCounts: number[] = [];

  let villageCorrect = 0;
  let villageVotes = 0;
  let wolfBetrayals = 0;
  let wolfSignals = 0;
  let voteChanges = 0;
  let voteTotal = 0;
  const consensusSamples: number[] = [];
  const cohesionSamples: number[] = [];
  let staleEvidence = 0;
  let evidenceTotal = 0;
  let boundaryViolations = 0;
  let fallbackActions = 0;
  let declinedTurns = 0;
  let speechRepeats = 0;
  let speechTotal = 0;
  let roundLimited = 0;

  const roleGames = new Map<Role, number>();
  const roleWins = new Map<Role, number>();
  const teamVoteCorrect: Record<Team, number> = { village: 0, wolves: 0 };
  const teamVoteTotal: Record<Team, number> = { village: 0, wolves: 0 };

  for (const game of games) {
    const teamOf = (playerId: string): Team | undefined => {
      const role = game.roles[playerId];
      return role === undefined ? undefined : roleTeam(role);
    };

    if (game.winner !== null) {
      finished += 1;
      if (game.winner === "village") villageWins += 1;
      if (game.winner === "wolves") wolfWins += 1;
      roundCounts.push(game.rounds);
    }

    if (game.violations.some((item) => item.id === "ROUND_LIMIT")) roundLimited += 1;
    boundaryViolations += game.violations.filter(
      (item) =>
        item.id === "ROLE_LEAK" ||
        item.id === "DEAD_ROLE_REVEALED" ||
        item.id === "WOLF_ALLY_SCOPE" ||
        item.id === "SEER_RESULT_SCOPE",
    ).length;
    fallbackActions += game.rejected;
    declinedTurns += game.skipped;

    // --- Vai và phe thắng ---
    //
    // Đếm theo VÁN, không theo người chơi. Một ván có hai con Sói không phải là
    // hai lần thắng của vai Sói; nếu đếm theo người thì tử số vượt mẫu số và
    // "tỉ lệ thắng" của vai Sói ra 200%.
    const seenRoles = new Set<Role>(Object.values(game.roles));
    for (const role of seenRoles) {
      roleGames.set(role, (roleGames.get(role) ?? 0) + 1);
      if (game.winner !== null && roleTeam(role) === game.winner) {
        roleWins.set(role, (roleWins.get(role) ?? 0) + 1);
      }
    }

    // --- Phiếu ---
    for (const event of game.events) {
      if (event.kind !== "VOTE") continue;
      voteTotal += 1;
      if (event.changed) voteChanges += 1;

      for (const item of event.evidence) {
        evidenceTotal += 1;
        if (PERMANENT_KINDS.has(item.kind)) continue;
        if (event.round - item.round > staleAfter) staleEvidence += 1;
      }
    }

    const byRound = finalVotesByRound(game.events);
    for (const [, voters] of byRound) {
      const tally = new Map<string, number>();
      for (const vote of voters.values()) {
        const key = vote.targetId ?? "\u0000none";
        tally.set(key, (tally.get(key) ?? 0) + 1);

        const voterTeam = teamOf(vote.voterId);
        if (voterTeam === undefined || vote.targetId === null) continue;
        const targetIsWolf = teamOf(vote.targetId) === "wolves";

        teamVoteTotal[voterTeam] += 1;
        if (targetIsWolf) teamVoteCorrect[voterTeam] += 1;

        if (voterTeam === "village") {
          villageVotes += 1;
          if (targetIsWolf) villageCorrect += 1;
        } else {
          wolfSignals += 1;
          if (targetIsWolf) wolfBetrayals += 1;
        }
      }

      if (voters.size > 0) {
        const leader = Math.max(...tally.values());
        consensusSamples.push(leader / voters.size);
      }
    }

    // --- Lời nói ---
    const lastSpeech = new Map<string, string>();
    for (const event of game.events) {
      if (event.kind === "SPEECH") {
        speechTotal += 1;
        const signature = `${event.speech}:${event.targetId ?? "-"}`;
        if (lastSpeech.get(event.actorId) === signature) speechRepeats += 1;
        lastSpeech.set(event.actorId, signature);

        // Sói công khai tố đồng bọn cũng là tự phá.
        const actorTeam = teamOf(event.actorId);
        if (
          actorTeam === "wolves" &&
          event.speech === "ACCUSE" &&
          event.targetId !== null &&
          teamOf(event.targetId) === "wolves"
        ) {
          wolfSignals += 1;
          wolfBetrayals += 1;
        } else if (actorTeam === "wolves" && event.speech === "ACCUSE") {
          wolfSignals += 1;
        }
        continue;
      }

      if (event.kind === "COALITION") cohesionSamples.push(event.cohesion);
    }
  }

  const overall: SelfPlayMetrics = {
    games: games.length,
    finished,
    winRate: {
      village: ratio(villageWins, finished),
      wolves: ratio(wolfWins, finished),
    },
    averageRounds: mean(roundCounts),
    villageVoteAccuracy: ratio(villageCorrect, villageVotes),
    wolfSelfSabotage: ratio(wolfBetrayals, wolfSignals),
    voteChangeRate: ratio(voteChanges, voteTotal),
    consensus: mean(consensusSamples),
    coalitionCohesion: mean(cohesionSamples),
    staleEvidenceRate: ratio(staleEvidence, evidenceTotal),
    knowledgeBoundaryViolations: boundaryViolations,
    fallbackActions,
    declinedTurns,
    speechRepetitionRate: ratio(speechRepeats, speechTotal),
    roundLimitRate: ratio(roundLimited, games.length),
  };

  const byTeam: Record<Team, TeamMetrics> = {
    village: {
      team: "village",
      wins: overall.winRate.village,
      voteAccuracy: ratio(teamVoteCorrect.village, teamVoteTotal.village),
    },
    wolves: {
      team: "wolves",
      wins: overall.winRate.wolves,
      voteAccuracy: ratio(teamVoteCorrect.wolves, teamVoteTotal.wolves),
    },
  };

  const byRole: RoleMetrics[] = [...roleGames.entries()]
    // Sắp xếp theo tên vai để hai lần chạy cho ra cùng thứ tự - thứ tự chèn của
    // Map phụ thuộc vào ván nào chạy trước, và đó là một nguồn khác biệt giả.
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, count]) => ({
      role,
      games: count,
      wins: ratio(roleWins.get(role) ?? 0, count),
    }));

  return { overall, byTeam, byRole };
}
