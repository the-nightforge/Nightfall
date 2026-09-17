import { MAX_BELIEF_SCORE } from "../belief/evidence";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { FinalVotePolicyModel } from "../policy/policy-model";
import type { DecisionProbe } from "../trace/trace";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotRng,
} from "../types";
import { voteThreshold } from "./vote-decision";

export interface BotFinalVoteIntention {
  kind: "FINAL_VOTE";
  guilty: boolean;
  confidence: number;
  evidence: BotEvidence[];
}

export interface BotHunterShotIntention {
  kind: "HUNTER_SHOT";
  targetId: string | null;
  confidence: number;
  evidence: BotEvidence[];
}

/**
 * Hợp đồng dữ liệu của phiên toà (spec 2026-09-14-final-vote-action-space D8):
 * `BotRuntime.decideFinalVote` ghi `chosen.targetId = trialAccusedId` cho CẢ hai
 * nước và phân biệt bằng `chosen.label` — encoder và shaping là consumer của
 * hai chuỗi này. Tách thành hằng số dùng chung: một lần đổi chữ hiển thị mà
 * quên một chỗ sẽ lật toàn bộ nhãn sang "tha" mà không ai thấy.
 */
export const FINAL_VOTE_GUILTY_LABEL = "treo";
export const FINAL_VOTE_SPARE_LABEL = "tha";

/** Một nhánh hard-rule của phiên toà đã chốt đáp án, trước mọi phép đọc belief. */
export interface FinalVoteHardRule {
  guilty: boolean;
  reason: string;
}

export function isKnownAlly(context: BotDecisionContext, playerId: string): boolean {
  const knowledge = context.knowledge;
  const selfIsWolf = knowledge.knownRoles[knowledge.botId] === "WEREWOLF";
  return selfIsWolf && knowledge.knownRoles[playerId] === "WEREWOLF";
}

/**
 * Năm nhánh hard-rule của phiên toà, đứng TRƯỚC mọi phép đọc belief và không
 * đổi (spec 2026-09-14 D3): Sói không treo đồng bọn, Hề luôn tha, Sát Nhân luôn
 * treo, Báo Thù theo mục tiêu, không bị cáo → tha. Policy học được chỉ quyết
 * phần belief-driven cuối; `null` ở đây nghĩa là "tới lượt policy/teacher".
 *
 * Tách khỏi `decideFinalVote` để `BotRuntime` biết khi nào được hỏi policy mà
 * không phải đọc probe (probe vắng mặt khi trace tắt).
 */
export function finalVoteHardRule(context: BotDecisionContext): FinalVoteHardRule | null {
  const accusedId = context.knowledge.trialAccusedId;

  if (!accusedId) {
    return { guilty: false, reason: "không có bị cáo nào đang bị xử" };
  }

  // Sói không bao giờ giúp treo đồng bọn, bất kể bằng chứng công khai nói gì.
  if (isKnownAlly(context, accusedId)) {
    return { guilty: false, reason: "bị cáo là đồng đội Sói do engine xác nhận" };
  }

  /*
   * Thằng Hề luôn bỏ THA, và đó là một nước đi chứ không phải một sự lười.
   *
   * Bị cáo không được bỏ phiếu cho chính mình (engine chặn), nên lá phiếu này
   * luôn nói về NGƯỜI KHÁC - tức về một cái giá treo mà Hề không được đứng
   * trên. Kéo phiên toà đó về không có hai cái lợi cùng lúc: ngày hôm nay chưa
   * tiêu xong nên Hề còn cơ hội, và một người khăng khăng tha kẻ mà cả làng vừa
   * đồng thuận đưa ra xử chính là người bị soi kỹ nhất vào ngày mai.
   *
   * Đứng ngay sau nhánh Sói và TRƯỚC mọi phép đọc belief: với Hề, bằng chứng
   * công khai nói gì cũng không đổi được câu trả lời.
   */
  if (context.knowledge.selfRole === "JESTER") {
    return {
      guilty: false,
      reason:
        "Thằng Hề không giúp treo ai khác: mỗi phiên toà của người khác là một ngày mất trắng",
    };
  }

  /*
   * Sát Nhân luôn bỏ TREO, và đó là một nước đi chứ không phải sự thờ ơ.
   *
   * Bị cáo không được bỏ phiếu cho chính mình (engine chặn), nên lá phiếu này
   * luôn nói về NGƯỜI KHÁC - tức về một người bớt đi giữa Sát Nhân và điều kiện
   * thắng của nó, mà nó không phải trả bằng một đêm. Vế thứ hai quan trọng
   * không kém: tới được phiên toà nghĩa là đa số bàn đã đồng thuận, và người
   * khăng khăng tha kẻ mà cả làng vừa đưa ra xử chính là người bị soi kỹ nhất
   * vào ngày mai.
   *
   * ĐỐI XỨNG với nhánh Thằng Hề ngay trên, và ngược dấu: Hề kéo mọi phiên toà
   * của người khác về không để giữ lấy ngày cho mình.
   *
   * Đứng TRƯỚC mọi phép đọc belief: với Sát Nhân, bằng chứng công khai nói gì
   * cũng không đổi được câu trả lời.
   */
  if (context.knowledge.selfRole === "SERIAL_KILLER") {
    return {
      guilty: true,
      reason: "Sát Nhân bỏ Treo: mỗi bản án là một người bớt đi mà nó không phải tự tay giết",
    };
  }

  /*
   * Kẻ Báo Thù bỏ TREO khi bị cáo chính là mục tiêu của nó - và CHỈ khi đó.
   *
   * Đây là toàn bộ điều kiện thắng của vai này gói trong một lá phiếu, nên nó
   * đứng trên mọi phép đọc belief: bằng chứng công khai nói gì cũng không đổi
   * được câu trả lời cho đúng một cái tên.
   *
   * KHÁC hẳn hai nhánh trung lập ở trên, và chỗ khác nhau là điều quan trọng
   * nhất của nhánh này: Hề bỏ Tha cho MỌI bị cáo và Sát Nhân bỏ Treo cho MỌI
   * bị cáo, còn ở đây chỉ có một cái tên được đối xử đặc biệt. Với mọi bị cáo
   * khác, Kẻ Báo Thù rơi xuống đúng bảng điểm mà cả làng đang dùng - một người
   * bỏ Treo cho tất cả hoặc Tha cho tất cả là một người bị đọc vị sau hai
   * phiên toà, và nó thì cần sống tới phiên toà của mục tiêu.
   *
   * Không có nhánh nào cho "chính mình bị xử": engine không cho bị cáo bỏ
   * phiếu về phiên toà của mình (`canFinalVote` loại `accusedId === botId`),
   * nên lá phiếu này luôn nói về người khác. Việc tự bảo vệ khi bị xử nằm ở
   * `decideDefenseSpeech`, và ở đó Kẻ Báo Thù đi đúng đường `SURVIVE` mặc
   * định - KHÔNG dùng nhánh bất cần của Thằng Hề.
   */
  if (
    context.knowledge.selfRole === "EXECUTIONER" &&
    context.knowledge.executionerTargetId === accusedId
  ) {
    return {
      guilty: true,
      reason: "Kẻ Báo Thù kết tội mục tiêu của mình: đây là toàn bộ điều kiện thắng của nó",
    };
  }

  return null;
}
/**
 * Treo hay Tha — teacher heuristic của phiên toà.
 *
 * Mặc định là TREO (harness Task 9: mặc định THA làm làng thua 30/30 vì vòng
 * lặp chết — không ai bị kết án nên không có lịch sử phiếu để sinh bằng chứng).
 * Tới được phiên toà nghĩa là đa số làng ĐÃ chỉ vào người này, nên luật đúng
 * là TREO trừ khi có lý do TÍCH CỰC để tin người này vô tội.
 *
 * Năm nhánh hard-rule (`finalVoteHardRule`) đứng trước và không đổi; phần
 * belief-driven cuối (`trust < suspicion + spareTrustMargin`) là phần duy nhất
 * policy học được được phép quyết — qua `policy`, thiếu hoặc lỗi thì teacher
 * này chính là nước lui (fail-closed).
 */
export function decideFinalVote(
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
  probe?: DecisionProbe,
  policy?: FinalVotePolicyModel,
): BotFinalVoteIntention {
  const accusedId = context.knowledge.trialAccusedId;
  void rng;

  const hard = finalVoteHardRule(context);
  if (hard) {
    probe?.fallback(hard.reason);
    return { kind: "FINAL_VOTE", guilty: hard.guilty, confidence: 1, evidence: [] };
  }
  // Tới đây `accusedId` chắc chắn khác null (nhánh "không bị cáo" đã return).
  const accused = accusedId as string;

  const entry = state.suspicion[accused];
  const suspicion = entry?.score ?? 0;
  const trust = state.trust[accused]?.score ?? 0;

  // Chỉ tin tưởng CÓ CƠ SỞ mới cứu được bị cáo. `trust` chỉ lên cao khi có
  // nguồn thật: kết quả soi, hoặc nhiều lần được người khác bênh.
  const teacherGuilty = trust < suspicion + weights.confidence.spareTrustMargin;

  if (probe) {
    probe.candidate({
      targetId: accused,
      score: suspicion + weights.confidence.spareTrustMargin - trust,
      terms: [
        { name: "suspicion", value: suspicion },
        { name: "spareTrustMargin", value: weights.confidence.spareTrustMargin },
        { name: "trust", value: -trust },
      ],
      evidenceIds: (entry?.reasons ?? []).map((item) => item.id),
    });
  }

  // Policy chỉ quyết phần belief-driven này; mọi nhánh hard-rule đã đứng trước
  // và không tới được đây. `null` hoặc ném = giữ teacher.
  let guilty = teacherGuilty;
  if (policy) {
    try {
      const picked = policy.selectVerdict(
        [{ targetId: accused, score: suspicion + weights.confidence.spareTrustMargin - trust }],
        { context, state, rng },
        probe,
      );
      if (picked !== null && picked !== undefined) guilty = picked.guilty;
    } catch {
      guilty = teacherGuilty;
    }
  }

  return {
    kind: "FINAL_VOTE",
    guilty,
    confidence: Math.min(1, Math.abs(trust - suspicion) / MAX_BELIEF_SCORE),
    // Chỉ mang theo lý do khi thật sự kết tội; một phiếu Tha không cần bằng chứng.
    evidence: guilty
      ? (entry?.reasons ?? [])
          .slice(-weights.limits.intentionEvidence)
          .map((item) => ({ ...item }))
      : [],
  };
}

/**
 * Phát bắn cuối của Thợ Săn.
 *
 * `null` là kết quả tốt và thường gặp: bắn bừa lúc chết là cách nhanh nhất để
 * phe làng tự sát, vì Thợ Săn chết thường có nghĩa là họ đang thiếu thông tin
 * nhất chứ không phải nhiều nhất.
 */
export function decideHunterShot(
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
  probe?: DecisionProbe,
): BotHunterShotIntention {
  const shot = context.knowledge.hunterShot;
  void rng;

  if (!shot || !shot.canAct) {
    probe?.fallback("không có lượt phản kích nào đang mở");
    return { kind: "HUNTER_SHOT", targetId: null, confidence: 1, evidence: [] };
  }

  const threshold =
    voteThreshold(state.personality, weights) + weights.confidence.hunterMargin;

  const eligible = shot.legalTargets.filter(
    (id) => id !== context.knowledge.botId && !isKnownAlly(context, id),
  );

  if (probe) {
    for (const targetId of eligible) {
      const suspicion = state.suspicion[targetId]?.score ?? 0;
      probe.candidate({
        targetId,
        score: suspicion,
        terms: [{ name: "suspicion", value: suspicion }],
        evidenceIds: (state.suspicion[targetId]?.reasons ?? []).map((item) => item.id),
      });
    }
  }

  const scored = eligible
    .map((targetId) => ({ targetId, score: state.suspicion[targetId]?.score ?? 0 }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

  if (scored.length === 0) {
    // Không bắn là kết quả TỐT và thường gặp, không phải một lượt hỏng.
    probe?.fallback(`không ai vượt ngưỡng bắn ${threshold.toFixed(2)}`);
    return { kind: "HUNTER_SHOT", targetId: null, confidence: 1, evidence: [] };
  }

  const winner = scored[0];
  return {
    kind: "HUNTER_SHOT",
    targetId: winner.targetId,
    confidence: Math.min(1, winner.score / MAX_BELIEF_SCORE),
    evidence: (state.suspicion[winner.targetId]?.reasons ?? [])
      .slice(-weights.limits.intentionEvidence)
      .map((item) => ({ ...item })),
  };
}
