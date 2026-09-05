import { isPowerRole, type DayVoteRecap, type PublicVoteChoice, type VoteMutation } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotEvidence, BotMemory, BotRng, PublicEvidenceKind } from "../types";

/**
 * "Không treo ai" là một ứng viên ngang hàng với người chơi trong bảng kiểm
 * phiếu, nên nó cần một khoá riêng. Ký tự NUL không thể là một player id, nên
 * khoá này không bao giờ đụng độ.
 *
 * Viết bằng escape chứ không dán byte NUL thật vào source: một byte NUL khiến
 * git coi cả file là binary và mọi diff sau đó biến mất khỏi code review.
 */
const NO_ELIMINATION_KEY = "\u0000no-elimination";

function choiceKey(choice: PublicVoteChoice): string {
  return choice.type === "PLAYER" ? choice.targetId : NO_ELIMINATION_KEY;
}

function targetOf(choice: PublicVoteChoice): string | undefined {
  return choice.type === "PLAYER" ? choice.targetId : undefined;
}

interface LeaderInfo {
  /** Sắp xếp để thứ tự chèn của Map không lọt vào kết quả. */
  top: string[];
  count: number;
}

function leadersOf(tally: Map<string, number>): LeaderInfo {
  let count = 0;
  let top: string[] = [];
  for (const [key, value] of tally) {
    if (value <= 0) continue;
    if (value > count) {
      count = value;
      top = [key];
    } else if (value === count) {
      top.push(key);
    }
  }
  return { top: top.sort(), count };
}

function elapsedRatio(mutation: VoteMutation): number {
  const span = mutation.phaseEndsAt - mutation.phaseStartedAt;
  if (span <= 0) return 0;
  const ratio = (mutation.castAt - mutation.phaseStartedAt) / span;
  return Math.min(1, Math.max(0, ratio));
}

function evidenceOf(
  weights: BotWeights,
  kind: PublicEvidenceKind,
  sourceId: string,
  actorId: string,
  targetId: string | undefined,
  round: number,
  summary: string,
  idSuffix = "",
): BotEvidence {
  const { weight, confidence } = weights.evidence[kind];
  return {
    id: `${sourceId}:${kind}${idSuffix}`,
    kind,
    sourceId,
    actorId,
    targetId,
    weight,
    confidence,
    round,
    summary,
  };
}

/** Mỗi cử tri chốt ở mutation cuối cùng của mình trong vòng. */
function finalMutationByVoter(mutations: readonly VoteMutation[]): Map<string, VoteMutation> {
  const latest = new Map<string, VoteMutation>();
  for (const mutation of mutations) {
    const current = latest.get(mutation.voterId);
    if (!current || mutation.sequence > current.sequence) latest.set(mutation.voterId, mutation);
  }
  return latest;
}

/**
 * Đọc lại một vòng đề cử đã công khai và rút ra bằng chứng hành vi.
 *
 * Không rule nào ở đây dùng phe thật của ai. Mọi kết luận chỉ dựa trên pattern
 * công khai, và ranh giới đó là cố ý: luật mặc định giấu vai người chết tới hết
 * ván, nên "người bị treo hoá ra là Dân" không phải một tín hiệu tồn tại. Biến
 * thể luật `revealRoleOnDeath` làm nó tồn tại, và nó sống ở MỘT chỗ khác -
 * `verdict-review.ts` - chứ không trộn vào đây.
 *
 * `analyticalSkill` không bao giờ bóp méo hard fact: một BOT kém quan sát chỉ
 * bỏ sót candidate, chứ không đổi actor, target hay nguồn của bằng chứng.
 */
export function analyzeVoteRecap(
  recap: DayVoteRecap,
  analyticalSkill: number,
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotEvidence[] {
  const found: BotEvidence[] = [];
  const notice = (candidate: BotEvidence) => {
    if (rng() < analyticalSkill) found.push(candidate);
  };

  const tally = new Map<string, number>();
  const ordered = [...recap.mutations].sort((left, right) => left.sequence - right.sequence);

  for (const mutation of ordered) {
    const before = leadersOf(tally);
    const newKey = choiceKey(mutation.choice);
    const previousKey = mutation.previousChoice ? choiceKey(mutation.previousChoice) : null;

    if (previousKey !== null) tally.set(previousKey, (tally.get(previousKey) ?? 0) - 1);
    tally.set(newKey, (tally.get(newKey) ?? 0) + 1);

    const after = leadersOf(tally);
    const target = targetOf(mutation.choice);
    // Chọn "không treo ai" là một hành động khoan dung: nó không được tính là
    // phá hoà hay theo đuôi, vì cả hai rule đó mô tả áp lực đẩy người lên giá
    // treo cổ. SAVE_VOTE đã loại nhánh này sẵn ở dưới.
    const targetsPlayer = mutation.choice.type === "PLAYER";
    const brokeTie =
      targetsPlayer &&
      before.top.length > 1 &&
      after.top.length === 1 &&
      after.top[0] === newKey;

    if (previousKey !== null && elapsedRatio(mutation) >= weights.voteHistory.lateSwitchRatio) {
      notice(
        evidenceOf(
          weights,
          "LATE_SWITCH",
          mutation.id,
          mutation.voterId,
          target,
          recap.round,
          // Nội suy từ chính trọng số: đây là lý do BOT nói ra cho người chơi
          // nghe, nên nó không được mâu thuẫn với ngưỡng đã dùng để kết luận.
          `Đổi phiếu trong ${Math.round(
            (1 - weights.voteHistory.lateSwitchRatio) * 100,
          )}% thời gian cuối của vòng đề cử.`,
        ),
      );
    }

    if (brokeTie) {
      notice(
        evidenceOf(
          weights,
          "TIE_BREAK",
          mutation.id,
          mutation.voterId,
          target,
          recap.round,
          "Lá phiếu này phá thế hoà và tự mình chọn ra người dẫn đầu.",
        ),
      );
    }

    const leftLeader =
      previousKey !== null &&
      previousKey !== NO_ELIMINATION_KEY &&
      before.top.length === 1 &&
      before.top[0] === previousKey;
    if (leftLeader && after.top.length === 1 && after.top[0] !== previousKey) {
      notice(
        evidenceOf(
          weights,
          "SAVE_VOTE",
          mutation.id,
          mutation.voterId,
          target,
          recap.round,
          "Rời người đang dẫn đầu và đẩy một người khác vượt lên.",
        ),
      );
    }

    if (
      targetsPlayer &&
      !brokeTie &&
      before.top.length === 1 &&
      before.top[0] === newKey &&
      before.count >= weights.voteHistory.minBandwagonLead
    ) {
      notice(
        evidenceOf(
          weights,
          "BANDWAGON",
          mutation.id,
          mutation.voterId,
          target,
          recap.round,
          "Nhảy vào bỏ phiếu cho người đã dẫn phiếu sẵn.",
        ),
      );
    }
  }

  const latest = finalMutationByVoter(recap.mutations);
  const ballots = recap.finalBallots.filter((ballot) => ballot.choice.type === "PLAYER");
  for (const left of ballots) {
    for (const right of ballots) {
      if (left.voterId === right.voterId) continue;
      if (choiceKey(left.choice) !== choiceKey(right.choice)) continue;
      const leftMutation = latest.get(left.voterId);
      const rightMutation = latest.get(right.voterId);
      if (!leftMutation || !rightMutation) continue;
      // Nguồn là lá phiếu thật đã chốt sau cùng của cặp, không phải một id tổng
      // hợp: mọi evidence phải trỏ tới một sự kiện có thật trong recap.
      const source =
        leftMutation.sequence >= rightMutation.sequence ? leftMutation : rightMutation;
      notice(
        evidenceOf(
          weights,
          "VOTE_ALIGNMENT",
          source.id,
          left.voterId,
          right.voterId,
          recap.round,
          "Hai người chốt cùng một mục tiêu trong vòng đề cử.",
          `:${left.voterId}:${right.voterId}`,
        ),
      );
    }
  }

  return found;
}

export interface AvoidanceInput {
  /** Recap của mọi vòng đã công khai, thứ tự tuỳ ý. */
  history: readonly DayVoteRecap[];
  /** Vòng vừa khép - mốc mà chuỗi vòng liên tiếp được đếm ngược từ đó. */
  round: number;
  /** Những người còn đáng xét, thường là người còn sống. */
  playerIds: readonly string[];
}

/** Nguồn của một mảnh né tránh: dấu "đã đọc recap vòng này" mà `BotRuntime` ghi. */
export function avoidanceSourceId(round: number): string {
  return `recap:${round}`;
}

/**
 * Né tránh suốt nhiều vòng liên tiếp - tín hiệu mà người chơi thật đọc ra
 * nhau bằng mắt thường ("anh im suốt ba vòng rồi") còn bot thì mù.
 *
 * Hai hình dạng, mỗi hình dạng một mảnh riêng:
 *
 * - `throwaway`: có mặt bỏ phiếu đủ mọi vòng, nhưng phiếu cuối vòng nào cũng
 *   là phiếu trắng hoặc một phiếu LẺ - nhắm vào người mà không ai khác nhắm.
 *   Đó là hình dạng của một người không muốn đứng vào bất kỳ cáo buộc nào.
 * - `untouched`: có mặt bỏ phiếu đủ mọi vòng, mà không nhận một phiếu nào và
 *   không bị đưa ra xử. Không phải hành vi của chính người đó, nhưng là hình
 *   dạng của một người đang chơi để không bị nhìn thấy.
 *
 * "Có mặt" = có ít nhất một mutation trong vòng. Người vắng mặt một vòng thì
 * không bị tính, vì né là một lựa chọn và người vắng mặt không chọn gì cả.
 *
 * Thoát ra TRƯỚC khi rút số ngẫu nhiên khi weight tắt: các preset cũ giữ
 * nguyên dòng RNG và vì thế tái lập được từng bit.
 */
export function analyzeAvoidance(
  input: AvoidanceInput,
  analyticalSkill: number,
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotEvidence[] {
  if (weights.evidence.AVOIDANCE.weight <= 0) return [];

  const span = weights.voteHistory.avoidanceRounds;
  const recaps: DayVoteRecap[] = [];
  for (let round = input.round - span + 1; round <= input.round; round += 1) {
    const recap = input.history.find((item) => item.round === round);
    if (!recap) return [];
    recaps.push(recap);
  }

  const found: BotEvidence[] = [];
  const notice = (candidate: BotEvidence) => {
    if (rng() < analyticalSkill) found.push(candidate);
  };
  const sourceId = avoidanceSourceId(input.round);

  // Sắp để thứ tự trong `playerIds` (thứ tự roster, hay thứ tự Map) không
  // quyết định thứ tự rút RNG.
  for (const playerId of [...input.playerIds].sort()) {
    let throwaway = true;
    let untouched = true;
    let present = true;

    for (const recap of recaps) {
      if (!recap.mutations.some((mutation) => mutation.voterId === playerId)) {
        present = false;
        break;
      }
      const own = recap.finalBallots.find((ballot) => ballot.voterId === playerId);
      const ownTarget = own && own.choice.type === "PLAYER" ? own.choice.targetId : null;
      if (ownTarget !== null) {
        const joined = recap.finalBallots.some(
          (ballot) =>
            ballot.voterId !== playerId &&
            ballot.choice.type === "PLAYER" &&
            ballot.choice.targetId === ownTarget,
        );
        if (joined) throwaway = false;
      }
      const received = recap.finalBallots.some(
        (ballot) => ballot.choice.type === "PLAYER" && ballot.choice.targetId === playerId,
      );
      const tried = recap.nomination.kind === "TRIAL" && recap.nomination.accusedId === playerId;
      if (received || tried) untouched = false;
    }
    if (!present) continue;

    if (throwaway) {
      notice(
        evidenceOf(
          weights,
          "AVOIDANCE",
          sourceId,
          playerId,
          undefined,
          input.round,
          `${span} vòng liền chỉ bỏ phiếu trắng hoặc phiếu lẻ, chưa từng đứng vào một cáo buộc nào.`,
          `:throwaway:${playerId}`,
        ),
      );
    }
    if (untouched) {
      notice(
        evidenceOf(
          weights,
          "AVOIDANCE",
          sourceId,
          playerId,
          undefined,
          input.round,
          `${span} vòng liền không ai đụng tới, dù vẫn có mặt bỏ phiếu đều.`,
          `:untouched:${playerId}`,
        ),
      );
    }
  }

  return found;
}

export interface DefenseReviewInput {
  round: number;
  accusedId: string;
  /** Số câu bị cáo đã nói trong lượt bào chữa, kể cả câu parser không hiểu. */
  spoken: number;
  /** Memory parse được từ đúng những câu đó (của bị cáo). */
  statements: readonly BotMemory[];
  /** Bị cáo đã khai vai từ TRƯỚC phiên toà. */
  claimedBefore: boolean;
}

/** Nguồn của một mảnh bào chữa: memory `NOMINATED` mà `writeRecapMemories` ghi. */
export function defenseSourceId(round: number): string {
  return `${round}:nomination:result`;
}

/**
 * Chấm lượt bào chữa của bị cáo, SAU khi lượt đó đã khép.
 *
 * Ba hình dạng kém, ưu tiên theo thứ tự và tối đa MỘT mảnh mỗi phiên toà:
 *
 * - `silent`: không nói một lời nào. Người vô tội bị dồn thường không im.
 * - `deflect`: không tự bào chữa gì, chỉ chỉ sang người khác. Nhắm vào người
 *   bị chỉ sang, để bot còn biết lời cáo buộc đó ra đời trong hoàn cảnh nào.
 * - `grab` ("nhận vơ"): LẦN ĐẦU khai một vai chức năng đúng lúc bị đưa lên
 *   xử. Khai Dân thường thì không tính - không ai nhận vơ cái vai chẳng có gì.
 *
 * Bảo thủ ở chỗ: bị cáo có nói mà parser không hiểu gì thì KHÔNG có tín hiệu.
 * Một bot phạt người ta vì chính nó không hiểu là một bot ngu theo đúng nghĩa
 * người chơi hay dùng.
 *
 * Cùng cổng weight/RNG với `analyzeAvoidance`.
 */
export function analyzeDefense(
  input: DefenseReviewInput,
  analyticalSkill: number,
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotEvidence[] {
  if (weights.evidence.DEFENSE_QUALITY.weight <= 0) return [];

  const sourceId = defenseSourceId(input.round);
  const own = input.statements.filter((memory) => memory.actorId === input.accusedId);
  const claims = own.filter(
    (memory) => memory.type === "ROLE_CLAIM" || memory.type === "COUNTER_CLAIM",
  );
  const accusations = own
    .filter(
      (memory) =>
        memory.type === "ACCUSE" &&
        memory.targetId !== undefined &&
        memory.targetId !== input.accusedId,
    )
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));

  let candidate: BotEvidence | null = null;
  if (input.spoken === 0) {
    candidate = evidenceOf(
      weights,
      "DEFENSE_QUALITY",
      sourceId,
      input.accusedId,
      undefined,
      input.round,
      "Bị đưa ra xử mà không nói một lời nào để tự bào chữa.",
      ":silent",
    );
  } else if (claims.length === 0 && accusations.length > 0) {
    const target = accusations[0]!.targetId!;
    candidate = evidenceOf(
      weights,
      "DEFENSE_QUALITY",
      sourceId,
      input.accusedId,
      target,
      input.round,
      "Lượt bào chữa chỉ dùng để chỉ sang người khác, không nói gì về mình.",
      `:deflect:${target}`,
    );
  } else if (
    !input.claimedBefore &&
    claims.some((memory) => {
      const role = memory.data.role;
      return typeof role === "string" && isPowerRole(role as Parameters<typeof isPowerRole>[0]);
    })
  ) {
    candidate = evidenceOf(
      weights,
      "DEFENSE_QUALITY",
      sourceId,
      input.accusedId,
      undefined,
      input.round,
      "Chỉ nhận vai chức năng khi đã bị đưa lên giá treo cổ, chưa từng nói trước đó.",
      ":grab",
    );
  }

  if (!candidate) return [];
  return rng() < analyticalSkill ? [candidate] : [];
}
