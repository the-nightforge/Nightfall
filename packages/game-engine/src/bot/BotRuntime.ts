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
import { strategyFor } from "./roles/registry";
import { decayAndPrune } from "./memory/memory-decay";
import { createBotBrainState, remember } from "./memory/memory-store";
import { createBotPersonality } from "./personality/personality";
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
} from "./types";

/** Đổi phiếu trong 20% cuối được ghi thành một memory riêng. */
const LATE_VOTE_RATIO = 0.8;
/** Trần lịch sử phiếu và lịch sử phát ngôn giữ trong state. */
const HISTORY_LIMIT = 60;

export interface BotRuntimeOptions {
  playerId: string;
  rng: BotRng;
  playerIds: readonly string[];
  /** Bỏ trống thì personality được sinh từ chính RNG đã seed. */
  personality?: BotPersonality;
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

function evidenceOf(
  kind: EvidenceKind,
  idSuffix: string,
  sourceId: string,
  actorId: string,
  targetId: string,
  round: number,
  weight: number,
  confidence: number,
  summary: string,
): BotEvidence {
  return {
    id: `${sourceId}:${kind}:${idSuffix}`,
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

  private readonly rng: BotRng;
  /**
   * Decay phải đúng một lần mỗi round. Nếu không, việc dựng lại context nhiều
   * lần trong cùng một pha sẽ bào mòn memory theo số lần scheduler chạy chứ
   * không theo thời gian trong ván.
   */
  private lastDecayRound = -1;

  constructor(options: BotRuntimeOptions) {
    this.rng = options.rng;
    const personality = options.personality ?? createBotPersonality(options.rng);
    this.state = createBotBrainState(options.playerId, personality, options.playerIds);
  }

  /** Nạp mọi quan sát công khai chưa thấy vào memory, belief và social graph. */
  observe(context: BotDecisionContext): void {
    const knowledge = context.knowledge;

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
      decayAndPrune(this.state, knowledge.round);
      decayBeliefs(this.state, knowledge.round);
      this.lastDecayRound = knowledge.round;
    }

    applyPrivateInformation(this.state, knowledge);
    this.adaptToDeaths(knowledge, previousKnownRoles);
  }

  /** Chốt phiếu deterministic từ belief hiện tại. */
  decideVote(context: BotDecisionContext): BotVoteIntention {
    const vote = selectVote(context, this.state, this.rng);

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
      if (this.state.previousVotes.length > HISTORY_LIMIT) this.state.previousVotes.shift();
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
    if (this.rng() > this.state.personality.talkativeness) return null;

    const spoken = new Set(this.state.speechMemory.flatMap((entry) => entry.sourceIds));
    const fresh = vote.evidence
      .filter((item) => !spoken.has(item.sourceId))
      .slice(0, 3)
      .map((item) => ({ ...item }));

    if (vote.choice.type !== "PLAYER") {
      return { kind: "WITHHOLD", confidence: vote.confidence, evidence: [] };
    }
    if (fresh.length === 0) {
      // Không có ý mới thì hỏi một câu, chứ không lặp lại đúng cáo buộc cũ.
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
    return strategyFor(context.knowledge.selfRole).decideNight(context, this.state, this.rng);
  }

  /** Phán quyết Treo/Tha ở phiên toà. */
  decideFinalVote(context: BotDecisionContext): BotFinalVoteIntention {
    return decideFinalVote(context, this.state, this.rng);
  }

  /** Phát bắn cuối của Thợ Săn; `targetId: null` là không bắn. */
  decideHunterShot(context: BotDecisionContext): BotHunterShotIntention {
    return decideHunterShot(context, this.state, this.rng);
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
        evidenceIds: entry.reasons.slice(-3).map((reason) => reason.id),
      };
    }

    remember(this.state, {
      id: `ROUND_SUMMARY:${sourceId}:${this.state.playerId}`,
      sourceId,
      round,
      phase: "DAY_DISCUSSION",
      type: "ROUND_SUMMARY",
      actorId: this.state.playerId,
      importance: 9,
      pinned: true,
      data: {
        theory: this.state.currentTheory?.summary ?? null,
        topSuspects: ranked.slice(0, 3).map(([id]) => id),
      },
    });
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

          applyEvidence(this.state, {
            id: `death-motive:${knowledge.round}:${actorId}:${death.playerId}`,
            kind: "ACCUSE",
            sourceId,
            actorId,
            targetId: death.playerId,
            weight: 6 * edge.hostility,
            confidence: 0.5,
            round: knowledge.round,
            summary: `từng công kích ${death.name} ngay trước khi người này chết`,
          });
        }
      }

      // Mất đồng đội Sói: chỉ ghi khi TRƯỚC ĐÓ thật sự biết người này là đồng bọn.
      const wasAlly = previousKnownRoles[death.playerId] === "WEREWOLF";
      if (wasAlly) {
        remember(this.state, {
          id: `ALLY_LOST:${sourceId}:${this.state.playerId}`,
          sourceId,
          round: knowledge.round,
          phase: knowledge.phase,
          type: "ALLY_LOST",
          actorId: this.state.playerId,
          targetId: death.playerId,
          importance: 10,
          pinned: true,
          data: { name: death.name },
        });
      }
    }
  }

  /** Ghi lại các source đã dùng để lần sau BOT không nói lại đúng luận điểm. */
  recordSpeech(speech: BotSpeechIntention, round: number): void {
    this.state.speechMemory.push({
      sourceIds: speech.evidence.map((item) => item.sourceId),
      round,
    });
    if (this.state.speechMemory.length > HISTORY_LIMIT) this.state.speechMemory.shift();
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
    remember(this.state, memory);
  }

  private ingestDeaths(knowledge: BotKnowledgeView): void {
    for (const death of knowledge.lastNightDeaths) {
      this.write(
        {
          type: "PLAYER_DIED",
          sourceId: `night-death:${knowledge.round}:${death.playerId}`,
          actorId: death.playerId,
          importance: 6,
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
        importance: 10,
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
      )) {
        if (item.kind === "VOTE_ALIGNMENT") {
          applySocialEvidence(this.state, item);
          continue;
        }
        applyEvidence(this.state, item);
        if (item.targetId) applySocialEvidence(this.state, item);
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
          importance: mutation.previousChoice === null ? 4 : 6,
        },
        knowledge,
      );
      if (mutation.previousChoice !== null && lateRatio(mutation) >= LATE_VOTE_RATIO) {
        this.write(
          {
            type: "LATE_VOTE",
            sourceId: mutation.id,
            actorId: mutation.voterId,
            targetId:
              mutation.choice.type === "PLAYER" ? mutation.choice.targetId : undefined,
            importance: 7,
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
          importance: 7,
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
          importance: 6,
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
    });
    for (const memory of memories) remember(this.state, memory);

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
            "ACCUSE",
            "social",
            memory.sourceId,
            memory.actorId,
            memory.targetId,
            round,
            4,
            0.45,
            "Công khai buộc tội người này.",
          ),
        );
        // Bị buộc tội là tín hiệu yếu về người bị nêu tên, không phải bằng
        // chứng cứng: weight thấp và luôn có nguồn là message ID thật.
        applyEvidence(
          this.state,
          evidenceOf(
            "ACCUSE",
            "belief",
            memory.sourceId,
            memory.targetId,
            memory.actorId,
            round,
            4,
            0.45,
            "Bị một người chơi khác công khai buộc tội.",
          ),
        );
        continue;
      }

      if (memory.type === "DEFEND") {
        applySocialEvidence(
          this.state,
          evidenceOf(
            "DEFEND",
            "social",
            memory.sourceId,
            memory.actorId,
            memory.targetId,
            round,
            3,
            0.4,
            "Công khai bênh vực người này.",
          ),
        );
        // Weight ÂM vì đây là bằng chứng gỡ tội: applyEvidence hạ nghi ngờ của
        // người được bênh, còn applyTrustEvidence đảo dấu nên tin tưởng tăng.
        const exculpatory = evidenceOf(
          "DEFEND",
          "belief",
          memory.sourceId,
          memory.targetId,
          memory.actorId,
          round,
          -3,
          0.4,
          "Được một người chơi khác công khai bênh vực.",
        );
        applyEvidence(this.state, exculpatory);
        applyTrustEvidence(this.state, exculpatory);
        continue;
      }

      if (memory.type === "COUNTER_CLAIM") {
        applySocialEvidence(
          this.state,
          evidenceOf(
            "COUNTER_CLAIM",
            "social",
            memory.sourceId,
            memory.actorId,
            memory.targetId,
            round,
            6,
            0.5,
            "Phản bác lời nhận vai của người này.",
          ),
        );
        applyEvidence(
          this.state,
          evidenceOf(
            "COUNTER_CLAIM",
            "belief",
            memory.sourceId,
            memory.targetId,
            memory.actorId,
            round,
            6,
            0.5,
            "Lời nhận vai bị người khác phản bác.",
          ),
        );
      }
    }
  }
}
