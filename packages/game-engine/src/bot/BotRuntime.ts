import { isRole, roleTeam, type DayVoteRecap, type Role, type VoteMutation } from "@masoi/shared";
import { analyzeChat } from "./analysis/chat-analysis";
import { claimEvidence } from "./analysis/claim-credibility";
import { applySocialEvidence } from "./analysis/social-analysis";
import {
  analyzeAvoidance,
  analyzeDefense,
  analyzeVoteRecap,
  avoidanceSourceId,
  defenseSourceId,
} from "./analysis/vote-analysis";
import {
  analyzeRevealedVerdict,
  finalBallotSourceId,
  lynchedIdOf,
} from "./analysis/verdict-review";
import { applyEvidence, applyTrustEvidence, decayBeliefs } from "./belief/belief-state";
import { observeProfile } from "./belief/player-profile";
import { applyPrivateInformation } from "./belief/private-info";
import {
  decideRoleClaim,
  voteLeader,
  type BotClaimIntention,
} from "./decision/claim-decision";
import {
  decideDefenseSpeech,
  type BotDefenseIntention,
} from "./decision/defense-decision";
import { decideGhostWhisper, type BotGhostWhisperIntention } from "./decision/ghost-decision";
import {
  decideLastLetter,
  type BotLastLetterIntention,
} from "./decision/last-letter-decision";
import { selectVote } from "./decision/vote-decision";
import {
  decideFinalVote,
  decideHunterShot,
  type BotFinalVoteIntention,
  type BotHunterShotIntention,
} from "./decision/trial-decision";
import {
  DEFAULT_BOT_WEIGHTS,
  validateWeights,
  type BotWeights,
} from "./config/weights";
import { markReplied, recordSpeechIntention } from "./conversation/speech-memory";
import { planSpeech } from "./conversation/speech-planner";
import { deriveSpeechStyle, type BotSpeechStyle } from "./personality/speech-style";
import { strategyFor } from "./roles/registry";
import { decayAndPrune } from "./memory/memory-decay";
import { createBotBrainState, remember } from "./memory/memory-store";
import { createBotPersonality } from "./personality/personality";
import {
  createDecisionProbe,
  wrapRngForTrace,
  type BeliefSnapshot,
  type BotTraceSink,
  type DecisionProbeCollector,
  type TraceDecisionKind,
  type TraceKnowledgeSnapshot,
} from "./trace/trace";
import type {
  BotBrainState,
  BotDecisionContext,
  BotEvidence,
  BotKnowledgeView,
  BotMemory,
  BotMemoryType,
  BotNightIntention,
  BotPersonality,
  BotRng,
  BotSpeechIntention,
  BotVoteIntention,
  EvidenceKind,
  PublicEvidenceKind,
} from "./types";

export interface BotRuntimeOptions {
  playerId: string;
  rng: BotRng;
  playerIds: readonly string[];
  /** Bỏ trống thì personality được sinh từ chính RNG đã seed. */
  personality?: BotPersonality;
  /** Bỏ trống thì dùng cấu hình production hiện hành. */
  weights?: BotWeights;
  /**
   * Bỏ trống là TẮT trace, và tắt nghĩa là không cấp phát gì và không bọc RNG.
   * Production để trống; test và self-play truyền vào.
   */
  trace?: BotTraceSink;
  /**
   * Brain đã lưu từ trước khi process chết.
   *
   * Có nó thì constructor KHÔNG gọi `createBotPersonality` nữa: lời gọi đó tiêu
   * một số của RNG, nên gọi lại sẽ đẩy con trỏ lệch đi một nhịp và mọi quyết
   * định sau đó trôi khỏi dòng số gốc - đúng thứ mà việc khôi phục phải tránh.
   */
  state?: BotBrainState;
  /**
   * Đi kèm `state`. Thiếu nó thì memory bị bào mòn thêm một lần ở vòng đang
   * chơi, vì runtime tưởng vòng này chưa decay lần nào.
   */
  lastDecayRound?: number;
}

interface MemoryDraft {
  type: BotMemoryType;
  sourceId: string;
  actorId: string;
  targetId?: string;
  importance: number;
  pinned?: boolean;
  data?: Record<string, unknown>;
}

/**
 * Bằng chứng rút ra từ một câu nói.
 *
 * `weight` và `confidence` KHÔNG còn là tham số: chúng đến từ bảng
 * `weights.evidence`, cùng bảng mà `vote-analysis` dùng. Trước Phase 3 các cặp
 * số này bị chép lại ngay tại chỗ gọi, nên `ACCUSE (4, 0.45)` tồn tại hai bản
 * và không có gì buộc chúng phải bằng nhau.
 *
 * `sign` là thứ duy nhất chỗ gọi còn quyết định: `-1` biến một bằng chứng thành
 * bằng chứng GỠ TỘI, và `applyTrustEvidence` đảo dấu lần nữa nên tin tưởng tăng.
 */
function evidenceOf(
  weights: BotWeights,
  kind: EvidenceKind & PublicEvidenceKind,
  idSuffix: string,
  sourceId: string,
  actorId: string,
  targetId: string,
  round: number,
  summary: string,
  sign: 1 | -1 = 1,
): BotEvidence {
  const { weight, confidence } = weights.evidence[kind];
  return {
    id: `${sourceId}:${kind}:${idSuffix}`,
    kind,
    sourceId,
    actorId,
    targetId,
    weight: weight * sign,
    confidence,
    round,
    summary,
  };
}

/**
 * Ảnh chụp knowledge cho trace.
 *
 * Mọi trường là bản SAO của `BotKnowledgeView`, thứ engine đã lọc theo quyền của
 * chính bot. Không trường nào được dựng lại từ nguồn khác, nên ràng buộc
 * "trace ⊆ knowledge view" đúng theo kiến trúc chứ không theo kỷ luật: không có
 * chỗ nào ở đây để một bí mật lọt vào, kể cả khi ai đó muốn.
 */
function snapshotKnowledge(knowledge: BotKnowledgeView): TraceKnowledgeSnapshot {
  return {
    aliveIds: knowledge.players.filter((player) => player.alive).map((player) => player.id),
    legalChoices: knowledge.legalVoteChoices.map((choice) =>
      choice.type === "PLAYER" ? choice.targetId : "NO_ELIMINATION",
    ),
    knownRoles: { ...knowledge.knownRoles },
    seerResult: knowledge.seerResult
      ? { targetId: knowledge.seerResult.targetId, isWolf: knowledge.seerResult.isWolf }
      : null,
  };
}

function lateRatio(mutation: VoteMutation): number {
  const span = mutation.phaseEndsAt - mutation.phaseStartedAt;
  if (span <= 0) return 0;
  return (mutation.castAt - mutation.phaseStartedAt) / span;
}

/**
 * Một BOT: nhận context đã lọc, cập nhật nhận thức riêng, rồi chốt phiếu và ý
 * định phát ngôn.
 *
 * Runtime không giữ bất kỳ tham chiếu nào tới `GameState` hay `Room`; nó chỉ
 * thấy đúng những gì `GameEngine.botKnowledgeFor` cho phép, nên nhận thức của
 * nó có thể sai - và đó là điều mong muốn.
 */
export class BotRuntime {
  readonly state: BotBrainState;
  /** Cấu hình đã kiểm; mọi module quyết định nhận đúng đối tượng này. */
  readonly weights: BotWeights;

  private readonly rng: BotRng;
  private readonly trace: BotTraceSink | undefined;
  /**
   * Belief trước và sau lần `observe` gần nhất.
   *
   * Chụp ở `observe` chứ không ở lúc quyết định, vì `selectVote` và các strategy
   * chỉ ĐỌC belief - "trước và sau" của chúng luôn giống nhau và không nói lên
   * điều gì. Thứ thật sự đổi belief là quan sát, nên đó mới là cặp ảnh đáng ghi.
   */
  private beliefBefore: BeliefSnapshot = {};
  private beliefAfter: BeliefSnapshot = {};
  /**
   * Decay phải đúng một lần mỗi round. Nếu không, việc dựng lại context nhiều
   * lần trong cùng một pha sẽ bào mòn memory theo số lần scheduler chạy chứ
   * không theo thời gian trong ván.
   */
  private lastDecayRound = -1;

  constructor(options: BotRuntimeOptions) {
    this.rng = options.rng;
    this.trace = options.trace;
    this.weights = options.weights ?? DEFAULT_BOT_WEIGHTS;

    // Kiểm ngay tại constructor, không phải ở vòng 7 của ván thứ 214. Một NaN
    // lọt qua sẽ không ném - nó chỉ làm mọi phép so sánh trả về false, và BOT
    // bỏ lượt suốt ván mà không có lỗi nào để lần theo.
    const problems = validateWeights(this.weights);
    if (problems.length > 0) {
      throw new Error(`Cấu hình trọng số BOT không hợp lệ: ${problems.join("; ")}`);
    }

    if (options.state) {
      this.state = options.state;
      // Snapshot ghi trước P1.1 không có hồ sơ; schema server đã điền bảng
      // trống, nhưng đường khôi phục không qua zod (test, harness) thì chưa.
      this.state.profiles ??= {};
      this.lastDecayRound = options.lastDecayRound ?? -1;
    } else {
      const personality =
        options.personality ?? createBotPersonality(options.rng, this.weights);
      this.state = createBotBrainState(options.playerId, personality, options.playerIds);
    }
    // Dẫn xuất từ personality ĐANG nằm trong state, không phải từ biến cục bộ:
    // ở nhánh khôi phục không có biến đó, và hai nguồn sẽ trôi lệch nhau.
    this.style = deriveSpeechStyle(this.state.personality);
  }

  /**
   * Ảnh chụp đủ để dựng lại đúng con BOT này sau khi server khởi động lại.
   *
   * `style` và `weights` KHÔNG có mặt: cả hai là hàm thuần của những thứ đã nằm
   * trong ảnh (personality, bảng cấu hình), nên lưu thêm chỉ tạo ra một nguồn
   * sự thật thứ hai để trôi lệch.
   */
  serialize(): { state: BotBrainState; lastDecayRound: number } {
    return { state: this.state, lastDecayRound: this.lastDecayRound };
  }

  /** Nạp mọi quan sát công khai chưa thấy vào memory, belief và social graph. */
  observe(context: BotDecisionContext): void {
    const knowledge = context.knowledge;
    if (this.trace) this.beliefBefore = this.snapshotBelief();

    // Chụp lại TRƯỚC khi ghi đè. Engine gỡ đồng bọn đã chết khỏi `knownRoles`,
    // nên nếu đọc sau dòng dưới thì bot không bao giờ biết mình vừa mất ai -
    // đúng cái nó cần biết nhất.
    const previousKnownRoles = { ...this.state.knownInformation.knownRoles };

    // Self knowledge và đồng đội Sói nằm riêng, không trộn vào suspicion: đó là
    // sự thật, không phải suy đoán có bằng chứng.
    this.state.knownInformation.knownRoles = { ...knowledge.knownRoles };

    this.ingestDeaths(knowledge);
    this.ingestSeerResult(knowledge);
    this.ingestRoleClaims(knowledge);
    this.ingestRecaps(knowledge);
    // Phải chạy SAU `ingestRecaps`: nguồn của mỗi mảnh là lá phiếu Treo/Tha đã
    // được ghi thành memory ở đó, và `applyEvidence` từ chối nguồn chưa thấy.
    this.ingestVerdictReviews(knowledge);
    this.ingestChat(context);
    // SAU `ingestChat` (lời khai mới nhất đã vào `claims`) và SAU `ingestSeerResult`.
    this.ingestClaimVerdicts(knowledge);
    // Phải chạy SAU `ingestRecaps` (nguồn là memory `NOMINATED` của vòng này)
    // và SAU `ingestChat` (lời khai trước phiên toà đã nằm trong `claims`).
    this.ingestDefenseReview(context);

    // Phải chạy SAU `ingestDeaths`, `ingestRecaps` và `ingestChat`: cả ba đẩy
    // `sourceId` vào `seenEventIds`, và `claimEvidence` neo vào đúng những id
    // đó. Đảo thứ tự thì mọi mảnh bằng chứng bị bỏ lặng lẽ.
    //
    // `claimEvidence` là hàm THUẦN: nó tính lại toàn bộ `state.claims` mỗi lần
    // được gọi, không tự nhớ đã phát cái gì. Nhưng `observe()` chạy nhiều lần
    // một vòng - vào đêm, vào ngày, mỗi lượt bỏ phiếu, mỗi lượt thảo luận - nên
    // nếu áp thẳng kết quả mỗi lần, cùng một mảnh bằng chứng bị cộng dồn vào
    // belief nhiều lần trong một vòng và bão hoà thang suspicion/trust gần như
    // ngay lập tức. Mỗi mảnh mang một `id` tất định
    // (`${sourceId}:${kind}:${idSuffix}`), nên chặn trùng ở ĐÂY - nơi áp dụng -
    // chứ không trong `claimEvidence`, để hàm đó vẫn thuần và gọi lại được bao
    // nhiêu lần cũng an toàn.
    for (const item of claimEvidence(
      {
        claims: this.state.claims,
        round: knowledge.round,
        lastNightDeaths: knowledge.lastNightDeaths,
        publicVoteHistory: knowledge.publicVoteHistory,
        seenEventIds: this.state.seenEventIds,
        profiles: this.state.profiles,
      },
      this.weights,
    )) {
      if (this.state.appliedClaimEvidenceIds.includes(item.id)) continue;
      this.state.appliedClaimEvidenceIds.push(item.id);
      if (this.state.appliedClaimEvidenceIds.length > this.weights.limits.seenEvents) {
        this.state.appliedClaimEvidenceIds.shift();
      }

      applyEvidence(this.state, item, this.weights);
      // Chỉ mảnh GỠ TỘI (weight < 0) mới chạm trust, đúng tiền lệ đã có ở
      // `ingestChat`: `ACCUSE` (weight > 0) chỉ qua `applyEvidence`, còn
      // `DEFEND` (weight < 0) qua cả hai. Buộc tội không tự nó đốt trust của
      // người bị buộc tội - trust chỉ giảm vì THIẾU bằng chứng gỡ tội, không
      // phải vì ai đó lên tiếng tố cáo.
      if (item.weight < 0) applyTrustEvidence(this.state, item, this.weights);
    }

    // Decay TRƯỚC, thông tin riêng SAU.
    //
    // Thứ tự này quan trọng: nếu áp thông tin riêng trước rồi mới decay, kết quả
    // soi vừa ghi ở chính vòng này sẽ bị nguội ngay trong cùng một lượt observe.
    // Decay chỉ được phép chạm vào những gì đã cũ.
    if (this.lastDecayRound !== knowledge.round) {
      // Chốt sổ vòng TRƯỚC vào hồ sơ trước khi làm nguội gì cả: đây là "cuối
      // mỗi vòng" của hồ sơ, và nó chỉ chạy đúng một lần nhờ cùng cái cổng.
      this.recordAggression(knowledge);
      decayAndPrune(this.state, knowledge.round, undefined, this.weights);
      decayBeliefs(this.state, knowledge.round, this.weights);
      this.lastDecayRound = knowledge.round;
    }

    applyPrivateInformation(this.state, knowledge, this.weights);
    this.adaptToDeaths(knowledge, previousKnownRoles);

    if (this.trace) this.beliefAfter = this.snapshotBelief();
  }

  /** Chốt phiếu deterministic từ belief hiện tại. */
  decideVote(context: BotDecisionContext): BotVoteIntention {
    const run = this.beginTracedDecision();
    const vote = selectVote(context, this.state, run.rng, this.weights, run.probe);
    run.finish(context, "VOTE", vote.choice.type === "PLAYER" ? vote.choice.targetId : null, {
      PLAYER: "bầu",
      NO_ELIMINATION: "không treo ai",
    }[vote.choice.type]);

    this.state.currentTargets =
      vote.choice.type === "PLAYER" ? [vote.choice.targetId] : [];
    this.state.confidence = vote.confidence;

    const round = context.knowledge.round;
    const last = this.state.previousVotes.at(-1);
    const changed =
      !last ||
      last.round !== round ||
      last.choice.type !== vote.choice.type ||
      (last.choice.type === "PLAYER" &&
        vote.choice.type === "PLAYER" &&
        last.choice.targetId !== vote.choice.targetId);
    if (changed) {
      this.state.previousVotes.push({ round, choice: { ...vote.choice } });
      if (this.state.previousVotes.length > this.weights.limits.history) {
        this.state.previousVotes.shift();
      }
    }

    return vote;
  }

  /**
   * Ý định phát ngôn cho một phiếu đã chốt. `null` nghĩa là im lặng.
   *
   * Speech không bao giờ được mang bằng chứng mà lõi chưa từng thấy, và không
   * bao giờ đổi được mục tiêu của phiếu: LLM sau đó chỉ diễn đạt lại đúng ý
   * định này.
   */
  decideSpeech(
    context: BotDecisionContext,
    vote: BotVoteIntention,
  ): BotSpeechIntention | null {
    const run = this.beginTracedDecision();
    const speech = planSpeech({
      context,
      state: this.state,
      vote,
      style: this.style,
      rng: run.rng,
      weights: this.weights,
      probe: run.probe,
    });
    run.finish(
      context,
      "SPEECH",
      speech?.targetId ?? null,
      speech?.kind ?? "im lặng",
      speech?.reason,
    );
    return speech;
  }

  /**
   * Trọn lượt tự bào chữa: nói GÌ, và với thái độ nào.
   *
   * Thay cho cặp "hỏi lõi có nên khai vai + một đường lui viết ở scheduler"
   * (`decideDefenseClaim` cũ, đã xoá). Đường lui đó là một quyết định gameplay
   * nằm ngoài lõi, và vì nằm ngoài lõi nên nó không nhìn thấy vai - kết quả là
   * mọi bị cáo, kể cả Thằng Hề, đều được dựng thành một người đang cố sống.
   *
   * `stance` đi kèm chứ không suy ra được từ `intention`: hai vai có thể cùng
   * chọn im lặng vì hai lý do trái ngược, và tầng diễn đạt cần biết lý do nào
   * để viết đúng chỉ thị.
   */
  decideDefense(context: BotDecisionContext): BotDefenseIntention {
    const run = this.beginTracedDecision();
    const defense = decideDefenseSpeech(context, this.state, run.rng, this.style, this.weights);
    run.finish(
      context,
      "SPEECH",
      defense.intention.targetId ?? null,
      defense.intention.kind,
      defense.intention.reason,
    );
    return defense;
  }

  /**
   * Phong cách nói, dẫn xuất một lần từ personality.
   *
   * Tính một lần trong constructor chứ không mỗi lượt: nó là hàm thuần nên kết
   * quả không đổi, và một BOT đổi giọng giữa ván là một bug chứ không phải một
   * tính năng.
   */
  readonly style: BotSpeechStyle;

  /**
   * Nước đi đêm, uỷ quyền cho chiến lược của đúng vai.
   *
   * `null` là chủ động bỏ lượt và là kết quả hợp lệ. Runtime KHÔNG có đường lui
   * ngẫu nhiên ở đây: một nước đi ngẫu nhiên không tái lập được, và đó chính là
   * thứ Phase 1 đã bỏ công gỡ khỏi ban ngày.
   */
  decideNight(context: BotDecisionContext): BotNightIntention | null {
    const run = this.beginTracedDecision();
    const night = strategyFor(context.knowledge.selfRole, this.weights).decideNight(
      context,
      this.state,
      run.rng,
      run.probe,
    );
    run.finish(context, "NIGHT", night?.targetId ?? null, night?.action ?? "bỏ lượt");

    if (night) {
      const round = context.knowledge.round;
      // Chỉ ghi một lần mỗi vòng: `decideNight` có thể được gọi lại khi lượt
      // của Phù Thuỷ mở ra sau lúc bầy Sói khoá phiếu.
      const last = this.state.previousNightActions.at(-1);
      if (!last || last.round !== round || last.action !== night.action) {
        this.state.previousNightActions.push({
          round,
          action: night.action,
          targetId: night.targetId,
        });
        if (this.state.previousNightActions.length > this.weights.limits.history) {
          this.state.previousNightActions.shift();
        }
      }
    }

    return night;
  }

  /** Phán quyết Treo/Tha ở phiên toà. */
  decideFinalVote(context: BotDecisionContext): BotFinalVoteIntention {
    const run = this.beginTracedDecision();
    const verdict = decideFinalVote(context, this.state, run.rng, this.weights, run.probe);
    run.finish(
      context,
      "FINAL_VOTE",
      context.knowledge.trialAccusedId,
      verdict.guilty ? "treo" : "tha",
    );
    return verdict;
  }

  /**
   * Vai công khai nhận trong Ngày Sự Thật.
   *
   * Không đi qua `beginTracedDecision`: đây không phải một lượt chọn mục tiêu
   * nên nó không có candidate nào để ghi, và nó không rút RNG - thêm nó vào
   * trace chỉ làm bẩn chuỗi rút số mà mọi test tái lập đang dựa vào.
   */
  decideRoleClaim(context: BotDecisionContext): BotClaimIntention {
    return decideRoleClaim(context, this.state);
  }

  /**
   * Người mà linh hồn sẽ nói tới trong Tiếng Vọng Người Chết.
   *
   * Cùng lý do với `decideRoleClaim` mà không đi qua trace: không có candidate
   * để ghi và không rút RNG.
   */
  decideGhostWhisper(context: BotDecisionContext): BotGhostWhisperIntention {
    return decideGhostWhisper(context, this.state);
  }

  /**
   * Nội dung Phong thư sau cùng.
   *
   * Cũng không đi qua trace và không rút RNG, cùng lý do với hai hàm trên - và
   * ở đây nó còn là một RÀNG BUỘC: lá thư phải tái lập được từ đúng state, nên
   * nó không được phép tiêu một số nào của dòng RNG.
   */
  decideLastLetter(context: BotDecisionContext): BotLastLetterIntention {
    return decideLastLetter(context, this.state);
  }

  /** Phát bắn cuối của Thợ Săn; `targetId: null` là không bắn. */
  decideHunterShot(context: BotDecisionContext): BotHunterShotIntention {
    const run = this.beginTracedDecision();
    const shot = decideHunterShot(context, this.state, run.rng, this.weights, run.probe);
    run.finish(context, "HUNTER_SHOT", shot.targetId, shot.targetId ? "bắn" : "không bắn");
    return shot;
  }

  // ---- Trace ----

  /**
   * Chuẩn bị một lượt quyết định có thể ghi lại được.
   *
   * Khi `trace` là `undefined`, hàm này trả về đúng `this.rng` và một `finish`
   * rỗng: không probe, không mảng `rngDraws`, không object trace nào được cấp
   * phát. Đó là toàn bộ chi phí của trace ở production.
   */
  private beginTracedDecision(): {
    rng: BotRng;
    probe: DecisionProbeCollector | undefined;
    finish: (
      context: BotDecisionContext,
      decision: TraceDecisionKind,
      targetId: string | null,
      label: string,
      reason?: string,
    ) => void;
  } {
    if (!this.trace) {
      return { rng: this.rng, probe: undefined, finish: () => {} };
    }

    const sink = this.trace;
    const draws: number[] = [];
    const probe = createDecisionProbe();
    const rng = wrapRngForTrace(this.rng, draws);

    return {
      rng,
      probe,
      finish: (context, decision, targetId, label, reason) => {
        sink.record({
          botId: this.state.playerId,
          round: context.knowledge.round,
          phase: context.knowledge.phase,
          decision,
          // Bỏ hẳn khoá khi không có lý do, thay vì để `reason: undefined`:
          // `JSON.stringify` đằng nào cũng bỏ nó, nên giữ nó ở đây chỉ làm hai
          // đường - trong bộ nhớ và trên đĩa - khác nhau mà không ai được gì.
          chosen: reason === undefined ? { targetId, label } : { targetId, label, reason },
          candidates: probe.candidates,
          beliefBefore: this.beliefBefore,
          beliefAfter: this.beliefAfter,
          personality: { ...this.state.personality },
          rngDraws: draws,
          fallbackReason: probe.fallbackReason,
          knowledgeSnapshot: snapshotKnowledge(context.knowledge),
        });
      },
    };
  }

  private snapshotBelief(): BeliefSnapshot {
    const snapshot: BeliefSnapshot = {};
    for (const id of Object.keys(this.state.suspicion).sort()) {
      snapshot[id] = {
        suspicion: this.state.suspicion[id]?.score ?? 0,
        trust: this.state.trust[id]?.score ?? 0,
      };
    }
    return snapshot;
  }

  /**
   * Chốt lại một vòng: ghi tóm tắt và cập nhật giả thuyết đang giữ.
   *
   * Tách khỏi `observe` vì nó phải chạy đúng một lần khi vòng KẾT THÚC, còn
   * `observe` chạy nhiều lần trong vòng. Gọi lại cùng một vòng là no-op.
   */
  summarizeRound(round: number): void {
    const sourceId = `round-summary:${round}`;
    if (this.state.memories.some((memory) => memory.sourceId === sourceId)) return;

    const ranked = Object.entries(this.state.suspicion)
      // Chỉ nghi ngờ CÓ BẰNG CHỨNG mới được vào giả thuyết. Một điểm số không
      // có lý do là thứ không giải thích được cho ai, kể cả cho chính bot.
      .filter(([, entry]) => entry.reasons.length > 0)
      .sort(
        (a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]),
      );

    if (ranked.length > 0) {
      const [suspectId, entry] = ranked[0];
      this.state.currentTheory = {
        summary: `nghi ${suspectId} nhất sau vòng ${round}`,
        evidenceIds: entry.reasons
          .slice(-this.weights.limits.intentionEvidence)
          .map((reason) => reason.id),
      };
    }

    remember(
      this.state,
      {
        id: `ROUND_SUMMARY:${sourceId}:${this.state.playerId}`,
        sourceId,
        round,
        phase: "DAY_DISCUSSION",
        type: "ROUND_SUMMARY",
        actorId: this.state.playerId,
        importance: this.weights.memoryImportance.roundSummary,
        pinned: true,
        data: {
          theory: this.state.currentTheory?.summary ?? null,
          topSuspects: ranked.slice(0, this.weights.limits.topSuspects).map(([id]) => id),
        },
      },
      this.weights,
    );
  }

  /**
   * Đổi cách chơi khi có người chết.
   *
   * Hai suy luận, cả hai đều rẻ và đều đúng thường xuyên:
   * - Ai từng công kích nạn nhân thì đáng nghi hơn - "ai muốn người đó chết".
   * - Sói mất đồng bọn thì phải chơi khác: ít đẩy phiếu lộ liễu hơn.
   */
  private adaptToDeaths(
    knowledge: BotKnowledgeView,
    previousKnownRoles: Record<string, Role>,
  ): void {
    for (const death of knowledge.lastNightDeaths) {
      const sourceId = `night-death:${knowledge.round}:${death.playerId}`;

      // Chỉ suy luận từ cái chết của người mình TIN. Một người ai cũng nghi bị
      // giết không nói lên điều gì: cả làng đều có động cơ.
      const victimTrust = this.state.trust[death.playerId]?.score ?? 0;
      if (victimTrust > 0) {
        for (const [key, edge] of Object.entries(this.state.relationships)) {
          if (!key.endsWith(`->${death.playerId}`)) continue;
          if (edge.hostility <= 0) continue;

          const actorId = key.slice(0, key.indexOf("->"));
          if (actorId === this.state.playerId) continue;

          applyEvidence(
            this.state,
            {
              id: `death-motive:${knowledge.round}:${actorId}:${death.playerId}`,
              kind: "ACCUSE",
              sourceId,
              actorId,
              targetId: death.playerId,
              weight: this.weights.social.deathMotiveWeight * edge.hostility,
              confidence: this.weights.social.deathMotiveConfidence,
              round: knowledge.round,
              summary: `từng công kích ${death.name} ngay trước khi người này chết`,
            },
            this.weights,
          );
        }
      }

      // Mất đồng đội Sói: chỉ ghi khi TRƯỚC ĐÓ thật sự biết người này là đồng bọn.
      const wasAlly = previousKnownRoles[death.playerId] === "WEREWOLF";
      if (wasAlly) {
        remember(
          this.state,
          {
            id: `ALLY_LOST:${sourceId}:${this.state.playerId}`,
            sourceId,
            round: knowledge.round,
            phase: knowledge.phase,
            type: "ALLY_LOST",
            actorId: this.state.playerId,
            targetId: death.playerId,
            importance: this.weights.memoryImportance.allyLost,
            pinned: true,
            data: { name: death.name },
          },
          this.weights,
        );
      }
    }
  }

  /**
   * Ghi lại một lượt nói.
   *
   * `text` là tuỳ chọn: lõi chốt ý định, còn câu chữ do bảng mẫu hoặc nhà cung
   * cấp sinh ra ở tầng trên. Khi chỗ gọi biết văn bản thật thì truyền vào, và
   * bản ghi có thêm vân tay văn bản - thứ duy nhất phát hiện được hai câu khác
   * ý định nhưng đọc lên y hệt nhau.
   *
   * `markReplied` chạy ở đây chứ không ở planner: một ý định được tính là "đã
   * đáp" khi nó thật sự được PHÁT, không phải khi nó được nghĩ ra rồi bị bỏ.
   */
  recordSpeech(speech: BotSpeechIntention, round: number, text?: string): void {
    // Cam kết lời khai vào state ngay khi ý định được ghi nhận, không đợi câu
    // chữ. Nếu đợi, hai checkpoint sát nhau sẽ cùng thấy `myClaim === null` và
    // BOT khai hai lần trong một vòng.
    if (
      (speech.kind === "CLAIM_ROLE" || speech.kind === "COUNTER_CLAIM") &&
      speech.claimedRole &&
      this.state.myClaim === null
    ) {
      this.state.myClaim = { role: speech.claimedRole, round };
    }
    recordSpeechIntention(this.state, speech, round, this.weights, text);
    if (speech.replyToMessageId) {
      markReplied(this.state, speech.replyToMessageId, this.weights);
    }
  }

  /**
   * Một ý định đã được xét nhưng CĂN PHÒNG không cho phát.
   *
   * Xảy ra khi câu được đáp đã nhận đủ phản hồi, hoặc chuỗi đã đủ sâu - hai
   * trần mà chỉ chỗ giữ sổ của phòng mới biết. BOT thì cần biết đúng một điều:
   * chuyện này đã xử lý xong, đừng đề nghị lại. Không có bước này, con BOT sẽ
   * thấy lại đúng trigger đó ở checkpoint sau và cố đáp lần nữa - mãi mãi, và
   * trần của phòng biến thành một vòng lặp bận thay vì một giới hạn.
   *
   * KHÔNG ghi bản ghi phát ngôn. Một bản ghi cho câu chưa từng phát ra làm hỏng
   * hai thứ cùng lúc: `speechCountInRound` tưởng BOT đã nói, và cửa sổ chống
   * lặp bị chiếm chỗ bởi một câu không ai nghe thấy.
   */
  declineSpeech(speech: BotSpeechIntention): void {
    if (speech.replyToMessageId) {
      markReplied(this.state, speech.replyToMessageId, this.weights);
    }
  }

  // ---- Ingest helpers ----

  private write(draft: MemoryDraft, knowledge: BotKnowledgeView): void {
    const memory: BotMemory = {
      id: `${draft.type}:${draft.sourceId}:${draft.actorId}`,
      sourceId: draft.sourceId,
      round: knowledge.round,
      phase: knowledge.phase,
      type: draft.type,
      actorId: draft.actorId,
      targetId: draft.targetId,
      importance: draft.importance,
      pinned: draft.pinned ?? false,
      data: draft.data ?? {},
    };
    remember(this.state, memory, this.weights);
  }

  private ingestDeaths(knowledge: BotKnowledgeView): void {
    for (const death of knowledge.lastNightDeaths) {
      this.write(
        {
          type: "PLAYER_DIED",
          sourceId: `night-death:${knowledge.round}:${death.playerId}`,
          actorId: death.playerId,
          importance: this.weights.memoryImportance.playerDied,
          data: { name: death.name },
        },
        knowledge,
      );
    }
  }

  private ingestSeerResult(knowledge: BotKnowledgeView): void {
    const result = knowledge.seerResult;
    if (!result) return;
    this.write(
      {
        type: "SEER_RESULT",
        // Một mục tiêu chỉ cần soi một lần; khoá theo target giữ kết quả ổn
        // định qua các round thay vì nhân bản mỗi lần dựng context.
        sourceId: `seer:${result.targetId}`,
        actorId: knowledge.botId,
        targetId: result.targetId,
        importance: this.weights.memoryImportance.seerResult,
        pinned: true,
        data: { isWolf: result.isWolf },
      },
      knowledge,
    );
  }

  /**
   * Lời khai của Ngày Sự Thật, nạp thẳng thành `ROLE_CLAIM`.
   *
   * Cùng loại memory mà `chat-analysis` sinh ra khi ai đó tự nhận vai bằng lời,
   * nên nó chảy vào đúng bộ máy đã có - `werewolf.threatScore` không cần biết
   * lời khai đến từ ô chat hay từ bảng claim.
   *
   * `sourceId` KHÔNG chứa vòng đang quan sát: sự kiện chỉ nổ một lần mỗi ván,
   * còn bảng claim thì còn lại tới cuối. Gắn vòng vào sẽ đẻ một memory mới mỗi
   * vòng cho cùng một lời khai. Nhưng nó CÓ chứa vai, nên người lật claim để
   * lại hai memory - và đó là chuyện đúng, vì họ thật sự đã nói cả hai câu.
   */
  private ingestRoleClaims(knowledge: BotKnowledgeView): void {
    for (const [playerId, role] of Object.entries(knowledge.dayOfTruthClaims)) {
      // "Không tiết lộ" không phải một lời khai; nó không nói gì để mà nhớ.
      if (role === null) continue;
      this.write(
        {
          type: "ROLE_CLAIM",
          sourceId: `day-of-truth:${playerId}:${role}`,
          actorId: playerId,
          importance: this.weights.memoryImportance.roleClaim,
          pinned: true,
          data: { role },
        },
        knowledge,
      );
    }
  }

  private ingestRecaps(knowledge: BotKnowledgeView): void {
    for (const recap of knowledge.publicVoteHistory) {
      const marker = `recap:${recap.round}`;
      if (this.state.seenEventIds.includes(marker)) continue;

      this.writeRecapMemories(recap, knowledge);
      // Memory được ghi trước khi áp bằng chứng: `applyEvidence` từ chối mọi
      // source chưa từng thấy, nên thứ tự này là bắt buộc chứ không tuỳ ý.
      this.state.seenEventIds.push(marker);

      for (const item of analyzeVoteRecap(
        recap,
        this.state.personality.analyticalSkill,
        this.rng,
        this.weights,
      )) {
        // `seenEventIds` là hàng đợi có trần: một ván rất dài có thể đã đẩy cả
        // nguồn của mảnh này lẫn marker `recap:` ở trên ra khỏi bộ nhớ. `remember`
        // ở `writeRecapMemories` chỉ đăng ký lại nguồn của memory BỊ CẮT, không
        // phải của memory còn nguyên, nên nguồn mất là nguồn của bằng chứng đã
        // được áp khi còn tươi - bỏ qua thay vì làm sập lượt của bot. Cùng lý do
        // với guard của `ingestVerdictReviews`.
        if (!this.state.seenEventIds.includes(item.sourceId)) continue;
        if (item.kind === "VOTE_ALIGNMENT") {
          applySocialEvidence(this.state, item, this.weights);
          continue;
        }
        applyEvidence(this.state, item, this.weights);
        if (item.targetId) applySocialEvidence(this.state, item, this.weights);
      }

      // Né tránh được đọc trên CHUỖI vòng, nên nó sống ở đây - nơi mỗi recap
      // được xử lý đúng một lần - chứ không trong `analyzeVoteRecap` vốn chỉ
      // nhìn một vòng. Nguồn là chính `marker` vừa đẩy vào `seenEventIds`.
      for (const item of analyzeAvoidance(
        {
          history: knowledge.publicVoteHistory.filter((item) => item.round <= recap.round),
          round: recap.round,
          // Không xét chính mình: `applyEvidence` vốn bỏ qua, nhưng một memory
          // "tôi né tránh" cũng vô nghĩa.
          playerIds: knowledge.players
            .filter((player) => player.alive && player.id !== this.state.playerId)
            .map((player) => player.id),
        },
        this.state.personality.analyticalSkill,
        this.rng,
        this.weights,
      )) {
        this.write(
          {
            type: "AVOIDANCE",
            sourceId: avoidanceSourceId(recap.round),
            actorId: item.actorId,
            importance: this.weights.memoryImportance.avoidance,
            data: { reason: item.id.slice(item.sourceId.length + 1) },
          },
          knowledge,
        );
        applyEvidence(this.state, item, this.weights);
      }
    }
  }

  /**
   * Chấm lượt bào chữa của bị cáo, đúng một lần mỗi phiên toà, SAU khi lượt
   * đó đã khép (`trialDefense.endedAt` khác `null`).
   *
   * Lời trong cửa sổ DEFENSE (mọi người sống đều được nói) được đọc lại ở
   * FINAL_VOTE từ `visibleChat`, lọc theo cửa sổ thời gian mà engine công bố
   * và theo người còn sống (người chết đã bị `visibleChat` loại ở thượng
   * nguồn). Không có cửa sổ (harness self-play, record cũ) thì không chấm gì:
   * sự vắng mặt của dữ liệu chính là cái cổng, y như `ingestVerdictReviews`.
   *
   * Parse lại bằng `analyzeChat` chứ không lục `memories`: hàm đó thuần, rẻ,
   * và `memories` có thể đã bị cắt ngân sách. Kết quả parse ở đây KHÔNG ghi
   * vào memory - `ingestChat` đã ghi những câu đó rồi.
   */
  private ingestDefenseReview(context: BotDecisionContext): void {
    const knowledge = context.knowledge;
    const accusedId = knowledge.trialAccusedId;
    const window = knowledge.trialDefense;
    if (!accusedId || !window || window.endedAt === null) return;

    const marker = `defense-review:${knowledge.round}`;
    if (this.state.seenEventIds.includes(marker)) return;
    // Recap của vòng này chưa vào thì chưa có nguồn để neo; đừng đánh dấu, lần
    // observe sau sẽ thử lại.
    const sourceId = defenseSourceId(knowledge.round);
    if (!this.state.seenEventIds.includes(sourceId)) return;
    this.state.seenEventIds.push(marker);

    const aliveIds = new Set(
      knowledge.players.filter((player) => player.alive).map((player) => player.id),
    );
    const said = context.visibleChat.filter(
      (message) =>
        aliveIds.has(message.actorId) &&
        message.at >= window.startedAt &&
        message.at <= (window.endedAt as number),
    );
    const saidIds = new Set(said.map((message) => message.id));
    const statements = analyzeChat(said, knowledge.players, {
      round: knowledge.round,
      phase: "DEFENSE",
      weights: this.weights,
    });
    const claimedBefore = this.state.claims.some(
      (claim) => claim.actorId === accusedId && !saidIds.has(claim.sourceId),
    );

    for (const item of analyzeDefense(
      { round: knowledge.round, accusedId, spoken: said.length, statements, claimedBefore },
      this.state.personality.analyticalSkill,
      this.rng,
      this.weights,
    )) {
      this.write(
        {
          type: "DEFENSE_QUALITY",
          sourceId,
          actorId: accusedId,
          targetId: item.targetId,
          importance: this.weights.memoryImportance.defenseQuality,
          data: { reason: item.id.slice(sourceId.length + 1) },
        },
        knowledge,
      );
      applyEvidence(this.state, item, this.weights);
    }
  }

  /**
   * Chấm lại những phiên toà mà vai của người bị treo đã lộ.
   *
   * Chỉ chạy được khi biến thể luật `revealRoleOnDeath` bật - luật mặc định
   * không đưa vai người chết vào `knownRoles`, nên `role` dưới đây luôn
   * `undefined` và vòng lặp không làm gì. Không có nhánh nào phải thêm cho luật
   * mặc định: sự vắng mặt của dữ liệu CHÍNH LÀ cái cổng.
   *
   * Đánh dấu theo VÒNG chứ không theo lá phiếu: một phiên toà được chấm đúng
   * một lần, còn `observe()` thì chạy nhiều lần mỗi vòng và `updateBelief` cộng
   * dồn. Chỉ đánh dấu khi đã thật sự có vai để chấm, nếu không một lần
   * `observe()` chạy trước lúc lộ vai sẽ nuốt mất cả phiên toà.
   */
  private ingestVerdictReviews(knowledge: BotKnowledgeView): void {
    // Gác theo LUẬT chứ không theo sự có mặt của vai trong `knownRoles`: một
    // con Sói vẫn nhớ vai của đồng bọn vừa bị treo kể cả khi cờ tắt, và chấm
    // lại phán quyết dựa trên thông tin riêng đó sẽ (a) đổi hành vi của luật
    // mặc định, (b) làm bài đo A/B mất đúng cái tính "chỉ đổi một biến" là lý
    // do duy nhất nó tồn tại.
    if (knowledge.revealRoleOnDeath !== true) return;

    for (const recap of knowledge.publicVoteHistory) {
      const accusedId = lynchedIdOf(recap);
      if (accusedId === null) continue;

      const role = knowledge.knownRoles[accusedId];
      if (role === undefined) continue;

      const marker = `verdict-review:${recap.round}`;
      if (this.state.seenEventIds.includes(marker)) continue;
      this.state.seenEventIds.push(marker);

      for (const item of analyzeRevealedVerdict(
        recap,
        role,
        this.state.personality.analyticalSkill,
        this.rng,
        this.weights,
      )) {
        // `seenEventIds` là hàng đợi có trần: một ván rất dài có thể đã đẩy lá
        // phiếu này ra khỏi bộ nhớ, và lúc đó `validateEvidence` sẽ ném. Bỏ
        // qua mảnh mất nguồn thay vì làm sập lượt của bot.
        if (!this.state.seenEventIds.includes(finalBallotSourceId(recap.round, item.actorId))) {
          continue;
        }
        applyEvidence(this.state, item, this.weights);
        // Cả hai chiều đều chạm trust, khác với đường claim ở `observe()`. Ở đó
        // một lời buộc tội không được phép tự nó đốt trust của người bị tố. Ở
        // đây thì không có ai tố ai: sự thật đã lộ, và một phán đoán sai đã
        // được kiểm chứng thì đúng là một lý do để tin người đó ít đi.
        applyTrustEvidence(this.state, item, this.weights);
        // Hồ sơ: một phán đoán đã kiểm chứng là một mẫu về độ chính xác.
        observeProfile(
          this.state,
          item.actorId,
          "accuracy",
          item.kind === "VERDICT_HIT" ? 1 : 0,
          recap.round,
        );
      }
    }
  }

  /**
   * Lời khai vai bị KIỂM CHỨNG: vai của người khai đã lộ (`knownRoles`, tức
   * `revealRoleOnDeath` hoặc đồng bọn Sói) hoặc chính bot đã soi người đó.
   *
   * Chỉ chạm HỒ SƠ (bluffRate), không chạm belief: belief về người đó hoặc
   * đã ghim bởi kết quả soi, hoặc vô nghĩa vì họ đã chết. Thứ còn lại đáng
   * nhớ là "người này từng khai láo" - và `claim-credibility` đọc nó khi họ
   * khai lần nữa. Mỗi lời khai chấm đúng một lần (dấu trong `seenEventIds`).
   */
  private ingestClaimVerdicts(knowledge: BotKnowledgeView): void {
    for (const claim of this.state.claims) {
      if (claim.actorId === this.state.playerId) continue;
      const role = claim.data.role;
      // Ván cũ/memory chép tay có thể mang vai đã bị xóa cứng (PRIEST/MEDIUM):
      // `roleTeam` tra thẳng ROLE_META nên phải guard, bỏ qua lặng lẽ.
      if (typeof role !== "string" || !isRole(role)) continue;

      let bluffed: boolean | null = null;
      const known = knowledge.knownRoles[claim.actorId];
      if (known !== undefined) {
        bluffed = known !== role;
      } else {
        const seen = this.state.knownInformation.seerResults.find(
          (memory) => memory.targetId === claim.actorId,
        );
        if (seen && typeof seen.data.isWolf === "boolean") {
          bluffed = (roleTeam(role) === "wolves") !== seen.data.isWolf;
        }
      }
      if (bluffed === null) continue;

      const marker = `profile:claim:${claim.sourceId}:${claim.actorId}`;
      if (this.state.seenEventIds.includes(marker)) continue;
      this.state.seenEventIds.push(marker);
      observeProfile(this.state, claim.actorId, "bluff", bluffed ? 1 : 0, knowledge.round);
    }
  }

  /**
   * Cuối mỗi vòng: ai đã công khai buộc tội ai đó trong vòng vừa qua.
   *
   * Một mẫu `1`/`0` cho MỖI người còn sống, kể cả người im lặng - im lặng
   * cũng là dữ liệu về một người. Đọc từ memory `ACCUSE` của vòng trước, thứ
   * `ingestChat` ghi từ lời nói; phiếu bầu không tính, vì ai cũng phải bỏ
   * phiếu còn mở miệng tố người khác thì không.
   */
  private recordAggression(knowledge: BotKnowledgeView): void {
    const previous = knowledge.round - 1;
    if (previous < 1) return;
    for (const player of knowledge.players) {
      if (!player.alive || player.id === this.state.playerId) continue;
      const accused = this.state.memories.some(
        (memory) =>
          memory.type === "ACCUSE" && memory.actorId === player.id && memory.round === previous,
      );
      observeProfile(this.state, player.id, "aggro", accused ? 1 : 0, previous);
    }
  }

  private writeRecapMemories(recap: DayVoteRecap, knowledge: BotKnowledgeView): void {
    for (const mutation of recap.mutations) {
      this.write(
        {
          type: mutation.previousChoice === null ? "VOTE_CAST" : "VOTE_CHANGED",
          sourceId: mutation.id,
          actorId: mutation.voterId,
          targetId:
            mutation.choice.type === "PLAYER" ? mutation.choice.targetId : undefined,
          importance:
            mutation.previousChoice === null
              ? this.weights.memoryImportance.voteCast
              : this.weights.memoryImportance.voteChanged,
        },
        knowledge,
      );
      if (
        mutation.previousChoice !== null &&
        lateRatio(mutation) >= this.weights.voteHistory.lateSwitchRatio
      ) {
        this.write(
          {
            type: "LATE_VOTE",
            sourceId: mutation.id,
            actorId: mutation.voterId,
            targetId:
              mutation.choice.type === "PLAYER" ? mutation.choice.targetId : undefined,
            importance: this.weights.memoryImportance.lateVote,
          },
          knowledge,
        );
      }
    }

    if (recap.nomination.kind === "TRIAL") {
      this.write(
        {
          type: "NOMINATED",
          sourceId: `${recap.round}:nomination:result`,
          actorId: recap.nomination.accusedId,
          importance: this.weights.memoryImportance.nominated,
        },
        knowledge,
      );
    }

    for (const ballot of recap.finalJudgment?.ballots ?? []) {
      this.write(
        {
          type: "FINAL_JUDGMENT",
          sourceId: `${recap.round}:final:${ballot.voterId}`,
          actorId: ballot.voterId,
          importance: this.weights.memoryImportance.finalJudgment,
          data: { guilty: ballot.guilty },
        },
        knowledge,
      );
    }
  }

  private ingestChat(context: BotDecisionContext): void {
    const knowledge = context.knowledge;
    // Set thay vì includes trong vòng lặp: seenEventIds dài dần theo cả ván, và
    // đây là đường chạy lại ở mọi checkpoint bỏ phiếu của mọi BOT.
    const seen = new Set(this.state.seenEventIds);
    const fresh = context.visibleChat.filter((message) => !seen.has(message.id));
    if (fresh.length === 0) return;

    const memories = analyzeChat(fresh, knowledge.players, {
      round: knowledge.round,
      phase: knowledge.phase,
      weights: this.weights,
    });
    for (const memory of memories) {
      // Người khai có đang bị dồn phiếu ngay lúc mở miệng không. Ghi Ở ĐÂY chứ
      // không tính lại sau: bảng phiếu đổi liên tục, và một tín hiệu về THỜI
      // ĐIỂM mà lại đọc trạng thái của tương lai thì không còn là tín hiệu.
      //
      // "Bị dồn" = ĐANG DẪN PHIẾU, dùng chung `voteLeader` với `decideChatClaim`.
      // Không phải "có ít nhất một phiếu": một phiếu phản đối lạc không phải áp
      // lực, và từ vòng 3 trở đi hầu như ai cũng có một phiếu như thế.
      //
      // Đóng dấu cho CẢ `COUNTER_CLAIM`: một câu phản bác cũng là một lời khai
      // vai, và `claim-credibility` giờ chấm điểm cả hai loại.
      if (memory.type === "ROLE_CLAIM" || memory.type === "COUNTER_CLAIM") {
        memory.data.underFire = voteLeader(knowledge.currentVoteCounts.players) === memory.actorId;
      }
      remember(this.state, memory, this.weights);
    }

    // Kể cả câu bị parser bỏ qua cũng được đánh dấu đã đọc, để lần observe sau
    // không phân tích lại cùng một tin nhắn.
    for (const message of fresh) {
      if (!seen.has(message.id)) {
        seen.add(message.id);
        this.state.seenEventIds.push(message.id);
      }
    }

    for (const memory of memories) {
      if (!memory.targetId) continue;
      const round = memory.round;

      if (memory.type === "ACCUSE") {
        applySocialEvidence(
          this.state,
          evidenceOf(
            this.weights,
            "ACCUSE",
            "social",
            memory.sourceId,
            memory.actorId,
            memory.targetId,
            round,
            "Công khai buộc tội người này.",
          ),
          this.weights,
        );
        // Bị buộc tội là tín hiệu yếu về người bị nêu tên, không phải bằng
        // chứng cứng: weight thấp và luôn có nguồn là message ID thật.
        applyEvidence(
          this.state,
          evidenceOf(
            this.weights,
            "ACCUSE",
            "belief",
            memory.sourceId,
            memory.targetId,
            memory.actorId,
            round,
            "Bị một người chơi khác công khai buộc tội.",
          ),
          this.weights,
        );
        continue;
      }

      if (memory.type === "DEFEND") {
        applySocialEvidence(
          this.state,
          evidenceOf(
            this.weights,
            "DEFEND",
            "social",
            memory.sourceId,
            memory.actorId,
            memory.targetId,
            round,
            "Công khai bênh vực người này.",
          ),
          this.weights,
        );
        // Weight ÂM vì đây là bằng chứng gỡ tội: applyEvidence hạ nghi ngờ của
        // người được bênh, còn applyTrustEvidence đảo dấu nên tin tưởng tăng.
        const exculpatory = evidenceOf(
          this.weights,
          "DEFEND",
          "belief",
          memory.sourceId,
          memory.targetId,
          memory.actorId,
          round,
          "Được một người chơi khác công khai bênh vực.",
          -1,
        );
        applyEvidence(this.state, exculpatory, this.weights);
        applyTrustEvidence(this.state, exculpatory, this.weights);
        continue;
      }

      if (memory.type === "COUNTER_CLAIM") {
        applySocialEvidence(
          this.state,
          evidenceOf(
            this.weights,
            "COUNTER_CLAIM",
            "social",
            memory.sourceId,
            memory.actorId,
            memory.targetId,
            round,
            "Phản bác lời nhận vai của người này.",
          ),
          this.weights,
        );
        applyEvidence(
          this.state,
          evidenceOf(
            this.weights,
            "COUNTER_CLAIM",
            "belief",
            memory.sourceId,
            memory.targetId,
            memory.actorId,
            round,
            "Lời nhận vai bị người khác phản bác.",
          ),
          this.weights,
        );
      }
    }
  }
}
