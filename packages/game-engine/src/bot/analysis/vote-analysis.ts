import type { DayVoteRecap, PublicVoteChoice, VoteMutation } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotEvidence, BotRng, PublicEvidenceKind } from "../types";

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
 * Không rule nào ở đây dùng phe thật của ai: role người chết vẫn ẩn tới hết
 * ván, nên "người bị treo hoá ra là Dân" không phải là một tín hiệu hợp lệ
 * trong Phase 1. Mọi kết luận chỉ dựa trên pattern công khai.
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
          "Đổi phiếu trong 20% thời gian cuối của vòng đề cử.",
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
