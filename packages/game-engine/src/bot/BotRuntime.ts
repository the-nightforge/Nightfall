import type { DayVoteRecap, Role, VoteMutation } from "@masoi/shared";
import { analyzeChat } from "./analysis/chat-analysis";
import { applySocialEvidence } from "./analysis/social-analysis";
import { analyzeVoteRecap } from "./analysis/vote-analysis";
import { applyEvidence, applyTrustEvidence, decayBeliefs } from "./belief/belief-state";
import { applyPrivateInformation } from "./belief/private-info";
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

    const personality =
      options.personality ?? createBotPersonality(options.rng, this.weights);
    this.state = createBotBrainState(options.playerId, personality, options.playerIds);
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
    this.ingestRecaps(knowledge);
    this.ingestChat(context);

    // Decay TRƯỚC, thông tin riêng SAU.
    //
    // Thứ tự này quan trọng: nếu áp thông tin riêng trước rồi mới decay, kết quả
    // soi vừa ghi ở chính vòng này sẽ bị nguội ngay trong cùng một lượt observe.
    // Decay chỉ được phép chạm vào những gì đã cũ.
    if (this.lastDecayRound !== knowledge.round) {
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
    const speech = this.speechFor(context, vote, run.rng, run.probe);
    run.finish(context, "SPEECH", speech?.targetId ?? null, speech?.kind ?? "im lặng");
    return speech;
  }

  private speechFor(
    context: BotDecisionContext,
    vote: BotVoteIntention,
    rng: BotRng,
    probe: DecisionProbeCollector | undefined,
  ): BotSpeechIntention | null {
    if (rng() > this.state.personality.talkativeness) {
      probe?.fallback("không đủ hoạt ngôn để lên tiếng lượt này");
      return null;
    }

    const spoken = new Set(this.state.speechMemory.flatMap((entry) => entry.sourceIds));

    /**
     * Tiên Tri giữ kín kết quả soi trong những vòng đầu.
     *
     * Soi trúng Sói ngay đêm đầu rồi hô lên ở vòng 1 là cách nhanh nhất để chết
     * ở đêm 2: bầy Sói biết ngay ai là Tiên Tri, và một Tiên Tri chết mang theo
     * mọi thông tin nó sẽ có. Lá phiếu vẫn nhắm đúng người - thứ bị giữ lại là
     * LÝ DO, không phải hành động.
     */
    const revealRound = this.weights.deceptionRisk.seerRevealRound;
    const holdSeerEvidence = context.knowledge.round < revealRound;

    const fresh = vote.evidence
      .filter((item) => !spoken.has(item.sourceId))
      .filter(
        (item) =>
          !holdSeerEvidence ||
          (item.kind !== "SEER_RESULT_WOLF" && item.kind !== "SEER_RESULT_CLEAR"),
      )
      .slice(0, this.weights.limits.intentionEvidence)
      .map((item) => ({ ...item }));

    if (vote.choice.type !== "PLAYER") {
      probe?.fallback("phiếu không nhắm ai nên không có gì để cáo buộc");
      return { kind: "WITHHOLD", confidence: vote.confidence, evidence: [] };
    }
    if (fresh.length === 0) {
      // Không có ý mới thì hỏi một câu, chứ không lặp lại đúng cáo buộc cũ.
      probe?.fallback("mọi luận điểm đã nói rồi; hỏi thay vì lặp lại");
      return {
        kind: "QUESTION",
        targetId: vote.choice.targetId,
        confidence: vote.confidence,
        evidence: [],
      };
    }
    return {
      kind: "ACCUSE",
      targetId: vote.choice.targetId,
      confidence: vote.confidence,
      evidence: fresh,
    };
  }

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
      finish: (context, decision, targetId, label) => {
        sink.record({
          botId: this.state.playerId,
          round: context.knowledge.round,
          phase: context.knowledge.phase,
          decision,
          chosen: { targetId, label },
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

  /** Ghi lại các source đã dùng để lần sau BOT không nói lại đúng luận điểm. */
  recordSpeech(speech: BotSpeechIntention, round: number): void {
    this.state.speechMemory.push({
      sourceIds: speech.evidence.map((item) => item.sourceId),
      round,
    });
    if (this.state.speechMemory.length > this.weights.limits.history) {
      this.state.speechMemory.shift();
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
        if (item.kind === "VOTE_ALIGNMENT") {
          applySocialEvidence(this.state, item, this.weights);
          continue;
        }
        applyEvidence(this.state, item, this.weights);
        if (item.targetId) applySocialEvidence(this.state, item, this.weights);
      }
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
    for (const memory of memories) remember(this.state, memory, this.weights);

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
