import { roleTeam, type Role, type Team } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { normalizeSpeechText, openingOf } from "../conversation/fingerprint";
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
  /**
   * Nói lại đúng `(kiểu, mục tiêu)` của lần mình nói liền trước.
   *
   * @deprecated Giữ để so dọc với Phase 3. Nó KHÔNG đo lặp câu chữ: với ba mẫu
   * câu cố định của Phase 3, hai lượt `ACCUSE` nhắm hai người khác nhau đọc lên
   * gần như y hệt mà chỉ số này báo "không lặp". Dùng `exactRepetitionRate`,
   * `normalizedRepetitionRate` và `semanticRepetitionRate` thay cho nó.
   */
  speechRepetitionRate: Ratio;
  roundLimitRate: Ratio;

  // ---- Hội thoại (Phase 4) ----
  //
  // Ba chỉ số lặp đầu tiên cố tình CHỒNG LẤN nhau và đo ba thứ khác nhau. Một
  // BOT lách được cái này bằng cách đổi chữ sẽ hiện lên ở cái kia; đọc cả ba
  // cùng lúc mới ra bức tranh thật.

  /** Câu trùng NGUYÊN VĂN một câu trước đó của CÙNG BOT trong cùng ván. */
  exactRepetitionRate: Ratio;
  /** Trùng sau khi hạ chữ thường, bỏ dấu câu và bỏ từ đệm đầu câu. */
  normalizedRepetitionRate: Ratio;
  /** Trùng Ý ĐỊNH: cùng loại, mục tiêu, câu được đáp, topic và tập bằng chứng. */
  semanticRepetitionRate: Ratio;
  /** Ba token mở đầu trùng câu LIỀN TRƯỚC của cùng BOT. */
  repeatedOpeningRate: Ratio;
  /** Hai câu liên tiếp của cùng BOT nhắm cùng một người. */
  consecutiveSameTargetRate: Ratio;
  /** Câu có trả lời một message cụ thể. */
  replyRate: Ratio;
  /**
   * Câu hỏi nhắm thẳng vào ai đó và được người đó đáp lại.
   *
   * Không nên bằng 1: một quần thể trả lời mọi câu hỏi là một quần thể máy móc.
   */
  directQuestionResponseRate: Ratio;
  /** Trung bình số tin của một BOT trong một ngày mà nó CÓ nói. */
  messagesPerBotPerDay: number | null;
  /** Chuỗi đối đáp lồng nhau dài nhất thấy được. */
  maxDialogueChainLength: number;
  /** Lượt được mời nói mà BOT chọn im lặng. `null` khi không đo được. */
  silenceRate: Ratio;
  /** Câu do bảng mẫu sinh ra. Trong self-play luôn bằng 1 theo thiết kế. */
  fallbackTemplateRate: Ratio;

  // ---- Lời khai vai (Phase 5) ----

  /** Số lời khai trung bình mỗi ván. Thiết kế nhắm 2–4 ở bàn 12–14. */
  claimsPerGame: number | null;
  /** Tỉ lệ ván có ít nhất một lời phản bác. Phải `> 0` và `< 1`. */
  counterClaimRate: Ratio;
  /**
   * Phiếu chuyển sang người bị một lời khai chỉ mặt, trong vòng ngay sau đó.
   *
   * `≈ 0` nghĩa là mô hình uy tín chỉ là số chạy ngầm: người chơi sẽ không thấy
   * lời khai thay đổi được điều gì, và đó là hỏng đúng mục tiêu của Phase 5.
   */
  claimFollowRate: Ratio;
  /**
   * Trong những lần làng TIN một lời khai Tiên Tri, bao nhiêu lần người đó là
   * Tiên Tri thật.
   *
   * Chỉ số quan trọng nhất của Phase 5, và là chỉ số duy nhất chỉ tồn tại được
   * ở harness - chỉ đây mới biết vai thật để đối chiếu. Dưới 50% nghĩa là cơ
   * chế đang giúp Sói nhiều hơn giúp làng, tức phần Sói khai láo đã nuốt chửng
   * phần thông tin của làng.
   */
  claimAccuracy: Ratio;
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

/**
 * Có lá phiếu nào ĐỔI sang `targetId`, trong vòng của lời khai hoặc vòng ngay
 * sau đó, mà người bỏ phiếu thuộc phe làng - hay không.
 *
 * Chỉ xét phiếu ĐỔI (`changed`): một lá phiếu giữ nguyên không phải là làng
 * "chuyển sang" ai cả, nó là một lá đã có từ trước lời khai. Chỉ xét phiếu của
 * phe làng: một con Sói bỏ phiếu theo mục tiêu của một lời khai (bussing, hay
 * chính lời khai đó là của Sói) không phải là làng bị thuyết phục - đưa cả hai
 * phe vào chung một mẫu số sẽ làm `claimAccuracy` không còn đo được điều nó cần
 * đo.
 *
 * Quét TỚI (không quét lùi) từ vị trí lời khai: chỉ phiếu xảy ra SAU lời khai
 * mới là làng phản ứng lại nó, không phải trùng hợp ngẫu nhiên trước đó.
 */
function claimWasFollowed(
  events: readonly SelfPlayEvent[],
  fromIndex: number,
  claimRound: number,
  targetId: string,
  roles: Record<string, Role>,
): boolean {
  for (let index = fromIndex + 1; index < events.length; index += 1) {
    const event = events[index];
    if (event.kind !== "VOTE" || !event.changed) continue;
    if (event.targetId !== targetId) continue;
    if (event.round !== claimRound && event.round !== claimRound + 1) continue;
    const voterRole = roles[event.voterId];
    if (voterRole === undefined || roleTeam(voterRole) !== "village") continue;
    return true;
  }
  return false;
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
  let exactRepeats = 0;
  let normalizedRepeats = 0;
  let semanticRepeats = 0;
  let openingRepeats = 0;
  let sameTargetRuns = 0;
  let replies = 0;
  let directQuestionTotal = 0;
  let directQuestionAnswered = 0;
  let chainMax = 0;
  let silenceOpportunities = 0;
  let silentBotDays = 0;
  const botDaySamples: number[] = [];

  // ---- Lời khai vai (Phase 5) ----
  const claimCounts: number[] = [];
  let counterClaimGames = 0;
  /** Lời khai có chỉ mặt ai đó (`targetId !== null`) - mẫu số của `claimFollowRate`. */
  let claimPointTotal = 0;
  let claimPointFollowed = 0;
  /** Lời khai Tiên Tri (`claimedRole === "SEER"`) mà làng đã TIN - mẫu số của `claimAccuracy`. */
  let seerClaimsBelieved = 0;
  let seerClaimsAccurate = 0;

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
    /** Mọi câu một BOT đã nói trong ván này, theo ba dạng vân tay. */
    const saidExact = new Map<string, Set<string>>();
    const saidNormalized = new Map<string, Set<string>>();
    const saidSemantic = new Map<string, Set<string>>();
    const lastOpening = new Map<string, string | null>();
    const lastTarget = new Map<string, string | null>();
    /** Câu hỏi nhắm thẳng vào một người: messageId -> người được hỏi. */
    const directQuestions = new Map<string, string>();
    const answeredQuestions = new Set<string>();
    const perBotPerRound = new Map<string, number>();

    const remember = (
      table: Map<string, Set<string>>,
      actorId: string,
      key: string,
    ): boolean => {
      const seen = table.get(actorId) ?? new Set<string>();
      const repeated = seen.has(key);
      seen.add(key);
      table.set(actorId, seen);
      return repeated;
    };

    /** Ván này có ít nhất một lời phản bác (`COUNTER_CLAIM`) hay không. */
    let gameHasCounterClaim = false;
    let gameClaimCount = 0;

    for (const [eventIndex, event] of game.events.entries()) {
      if (event.kind === "SPEECH") {
        speechTotal += 1;
        const signature = `${event.speech}:${event.targetId ?? "-"}`;
        if (lastSpeech.get(event.actorId) === signature) speechRepeats += 1;
        lastSpeech.set(event.actorId, signature);

        // --- Lặp thật ---
        if (remember(saidExact, event.actorId, event.text)) exactRepeats += 1;
        if (remember(saidNormalized, event.actorId, normalizeSpeechText(event.text))) {
          normalizedRepeats += 1;
        }
        if (remember(saidSemantic, event.actorId, event.semanticFingerprint)) {
          semanticRepeats += 1;
        }

        const opening = openingOf(event.text);
        if (opening !== null && lastOpening.get(event.actorId) === opening) {
          openingRepeats += 1;
        }
        lastOpening.set(event.actorId, opening);

        if (event.targetId !== null && lastTarget.get(event.actorId) === event.targetId) {
          sameTargetRuns += 1;
        }
        lastTarget.set(event.actorId, event.targetId);

        // --- Mức độ đối thoại ---
        if (event.replyToMessageId !== null) {
          replies += 1;
          const asked = directQuestions.get(event.replyToMessageId);
          // Chỉ tính là ĐÃ ĐÁP khi đúng người được hỏi trả lời. Người thứ ba
          // xen vào không phải là câu hỏi được trả lời.
          if (asked === event.actorId) answeredQuestions.add(event.replyToMessageId);
        }
        if (
          (event.speech === "QUESTION" || event.speech === "ASK_EVIDENCE") &&
          event.targetId !== null
        ) {
          directQuestions.set(event.messageId, event.targetId);
        }

        chainMax = Math.max(chainMax, event.chainDepth);
        const dayKey = `${event.round}:${event.actorId}`;
        perBotPerRound.set(dayKey, (perBotPerRound.get(dayKey) ?? 0) + 1);

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

        // --- Lời khai vai (Phase 5) ---
        if (event.speech === "CLAIM_ROLE" || event.speech === "COUNTER_CLAIM") {
          gameClaimCount += 1;
          if (event.speech === "COUNTER_CLAIM") gameHasCounterClaim = true;

          if (event.targetId !== null) {
            claimPointTotal += 1;
            const followed = claimWasFollowed(
              game.events,
              eventIndex,
              event.round,
              event.targetId,
              game.roles,
            );
            if (followed) claimPointFollowed += 1;

            // `claimAccuracy` chỉ xét lời khai TIÊN TRI - `claimedRole` là vai
            // được KHAI, không phải vai thật; một con Sói khai láo cũng mang
            // "SEER" ở đây, và đó chính xác là trường hợp cần đối chiếu.
            if (event.claimedRole === "SEER" && followed) {
              seerClaimsBelieved += 1;
              if (game.roles[event.actorId] === "SEER") seerClaimsAccurate += 1;
            }
          }
        }

        continue;
      }

      if (event.kind === "COALITION") cohesionSamples.push(event.cohesion);
    }

    claimCounts.push(gameClaimCount);
    if (gameHasCounterClaim) counterClaimGames += 1;

    directQuestionTotal += directQuestions.size;
    directQuestionAnswered += answeredQuestions.size;
    for (const count of perBotPerRound.values()) botDaySamples.push(count);

    // --- Im lặng ---
    //
    // Mẫu số là số cặp (vòng, người CÒN SỐNG), không phải số người trên bàn:
    // một người chết ở vòng 2 không "im lặng" ở vòng 5. Không lọc theo sống
    // chết thì chỉ số này chỉ đo được số người đã chết.
    const diedAtRound = new Map<string, number>();
    for (const event of game.events) {
      if (event.kind !== "DEATH") continue;
      if (!diedAtRound.has(event.playerId)) diedAtRound.set(event.playerId, event.round);
    }
    for (let round = 1; round <= game.rounds; round += 1) {
      for (const playerId of Object.keys(game.roles)) {
        const died = diedAtRound.get(playerId);
        if (died !== undefined && died < round) continue;
        silenceOpportunities += 1;
        if (!perBotPerRound.has(`${round}:${playerId}`)) silentBotDays += 1;
      }
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

    exactRepetitionRate: ratio(exactRepeats, speechTotal),
    normalizedRepetitionRate: ratio(normalizedRepeats, speechTotal),
    semanticRepetitionRate: ratio(semanticRepeats, speechTotal),
    repeatedOpeningRate: ratio(openingRepeats, speechTotal),
    consecutiveSameTargetRate: ratio(sameTargetRuns, speechTotal),
    replyRate: ratio(replies, speechTotal),
    directQuestionResponseRate: ratio(directQuestionAnswered, directQuestionTotal),
    messagesPerBotPerDay: mean(botDaySamples),
    maxDialogueChainLength: chainMax,
    /**
     * Ngày mà một người còn sống không nói câu nào.
     *
     * Đo cùng lúc với các chỉ số lặp, và đó là điểm mấu chốt: cách dễ nhất để
     * ép mọi tỉ lệ lặp về 0 là bịt miệng BOT. Nếu `silenceRate` leo lên cùng
     * lúc các chỉ số lặp đẹp đi thì cơ chế chống lặp đang siết quá tay, và
     * không có chỉ số nào khác nhìn thấy điều đó.
     */
    silenceRate: ratio(silentBotDays, silenceOpportunities),
    /**
     * Trong self-play, con số này luôn bằng 1 THEO THIẾT KẾ.
     *
     * Nhân mô phỏng là thuần và không gọi mạng, nên mọi câu đều do bảng mẫu
     * sinh ra. Tỉ lệ thật của production được đo ở tầng server, nơi có nhà cung
     * cấp để mà hỏng.
     */
    fallbackTemplateRate: ratio(speechTotal, speechTotal),

    claimsPerGame: mean(claimCounts),
    counterClaimRate: ratio(counterClaimGames, games.length),
    claimFollowRate: ratio(claimPointFollowed, claimPointTotal),
    claimAccuracy: ratio(seerClaimsAccurate, seerClaimsBelieved),
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
