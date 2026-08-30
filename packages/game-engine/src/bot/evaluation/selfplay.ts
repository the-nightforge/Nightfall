import type { GamePhase, Phase, Role, RoomConfig, Winner } from "@masoi/shared";
import { GameEngine } from "../../engine";
import { detectCoalitions } from "../analysis/coalition";
import { BotRuntime } from "../BotRuntime";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { judgeChainPosition } from "../conversation/chain-limits";
import {
  speechSemanticFingerprint,
  speechTextFingerprint,
} from "../conversation/fingerprint";
import { recentTextFingerprints } from "../conversation/speech-memory";
import { renderSpeechTemplate } from "../conversation/templates";
import { createSeededRng } from "../rng";
import type { BotDecisionTrace, BotTraceSink } from "../trace/trace";
import { createTraceCollector } from "../trace/trace";
import {
  createInvariantAuditor,
  type GroundTruth,
  type InvariantViolation,
} from "./invariants";
import { assertSpeechScope } from "../types";
import type {
  BotChatObservation,
  BotDecisionContext,
  BotEvidence,
  BotSpeechIntention,
  BotVoteIntention,
  NightActionKind,
} from "../types";

/**
 * Nhân mô phỏng BOT tự chơi.
 *
 * THUẦN: không `fs`, không `process`, không `Date.now`. Runner có I/O nằm ở
 * `apps/server/scripts/selfplay.ts`; ranh giới đó là lý do nhân này chạy được
 * bên trong test của engine.
 *
 * Dùng `GameEngine` THẬT chứ không phải một mô hình rút gọn. Một harness tự mô
 * phỏng luật sẽ chỉ chứng minh rằng harness khớp với chính nó; ở đây engine vẫn
 * là trọng tài, nên mọi nước đi bất hợp lệ đều bị ném ra và được ghi lại.
 */

/** Trần số vòng mặc định. Chạm trần là VI PHẠM, không phải kết thúc bình thường. */
export const MAX_ROUNDS = 20;

/**
 * Đủ để dựng lại CHÍNH XÁC một ván, một mình, không cần batch.
 *
 * Đây là thứ được in ra cho mỗi seed thất bại. Một báo cáo lỗi không kèm đủ dữ
 * liệu để chạy lại là một báo cáo không hành động được.
 */
export interface SelfPlayRecord {
  seed: string;
  playerCount: number;
  config: RoomConfig;
  weightsVersion: string;
  maxRounds: number;
  events: boolean;
  speech: boolean;
}

export interface SelfPlayInput {
  seed: string;
  playerCount?: number;
  config?: Partial<RoomConfig>;
  weights?: BotWeights;
  maxRounds?: number;
  /** Bật sự kiện cân bằng động. Mặc định tắt. */
  events?: boolean;
  /** Cho BOT nói và nghe nhau. Mặc định BẬT. */
  speech?: boolean;
  /** Thu trace mọi quyết định. Tốn bộ nhớ; mặc định tắt. */
  trace?: boolean;
}

export type SelfPlayEvent =
  | { kind: "PHASE"; round: number; phase: Phase }
  | {
      kind: "NIGHT_ACTION";
      round: number;
      actorId: string;
      action: NightActionKind;
      targetId: string | null;
    }
  | { kind: "SKIP"; round: number; actorId: string; at: "NIGHT" | "HUNTER_SHOT" }
  | {
      kind: "VOTE";
      round: number;
      voterId: string;
      targetId: string | null;
      /** Lá phiếu này thay cho một lá đã bỏ trước đó trong cùng vòng. */
      changed: boolean;
      evidence: Array<{ round: number; kind: BotEvidence["kind"] }>;
    }
  | {
      kind: "SPEECH";
      round: number;
      actorId: string;
      /** ID của chính câu này trong chat, để đo chuỗi đối đáp. */
      messageId: string;
      speech: BotSpeechIntention["kind"];
      targetId: string | null;
      replyToMessageId: string | null;
      /** 0 là tự mở lời; n là câu thứ n trong một chuỗi đối đáp. */
      chainDepth: number;
      tone: BotSpeechIntention["tone"];
      /** Văn bản đã phát. Không đo được lặp thật nếu không có nó. */
      text: string;
      textFingerprint: string;
      semanticFingerprint: string;
      evidenceSourceIds: string[];
    }
  | { kind: "NOMINATION"; round: number; accusedId: string | null }
  | { kind: "FINAL_VOTE"; round: number; voterId: string; guilty: boolean }
  | { kind: "HUNTER_SHOT"; round: number; hunterId: string; targetId: string | null }
  | { kind: "DEATH"; round: number; playerId: string; cause: string }
  | { kind: "COALITION"; round: number; observerId: string; size: number; cohesion: number }
  | { kind: "REJECTED"; round: number; actorId: string; detail: string };

export interface SelfPlayGame {
  record: SelfPlayRecord;
  winner: Winner;
  rounds: number;
  /** Hành động được engine CHẤP NHẬN. */
  actions: number;
  /** Nước đi bị engine từ chối, cộng với lượt bot chủ động bỏ. */
  rejected: number;
  skipped: number;
  events: SelfPlayEvent[];
  /**
   * Vi phạm bất biến phát hiện TRONG LÚC chạy; rỗng là đạt.
   *
   * Mỗi phần tử mang đủ `record` để chạy lại đúng ván đã sinh ra nó.
   */
  violations: InvariantViolation[];
  traces: BotDecisionTrace[];
  /**
   * Sự thật về vai, chụp sau khi ván kết thúc.
   *
   * CHỈ dành cho tầng ĐO và tầng KIỂM BẤT BIẾN. Không đường nào đưa nó ngược
   * vào một `BotDecisionContext`: BOT phải chơi mù đúng như người thật.
   */
  roles: Record<string, Role>;
}

function baseConfig(over: Partial<RoomConfig> = {}): RoomConfig {
  return {
    werewolves: 2,
    seer: true,
    guard: true,
    witch: true,
    hunter: false,
    cursed: false,
    nightSeconds: 30,
    discussionSeconds: 60,
    voteSeconds: 30,
    defenseSeconds: 20,
    finalVoteSeconds: 20,
    ...over,
  } as RoomConfig;
}

/**
 * Câu nói tương ứng với một ý định, sinh bằng template THUẦN.
 *
 * Không LLM, không mạng, không ngẫu nhiên. Quan trọng hơn: nó không THÊM thông
 * tin - chỉ nêu lại đúng `kind` và `targetId` mà lõi đã quyết. Nhờ vậy nó không
 * thể là đường để một quyết định bị đổi bởi lời nói.
 */
export function renderIntentionText(
  speech: BotSpeechIntention,
  nameOf: (playerId: string) => string,
  variation?: {
    seedTag: string;
    botId: string;
    round: number;
    seq: number;
    avoidFingerprints?: readonly string[];
  },
): string {
  const target = speech.targetId ? nameOf(speech.targetId) : "người đó";
  const author = speech.replyToActorId ? nameOf(speech.replyToActorId) : target;

  // Bảng mẫu đầy đủ khi chỗ gọi cho biết đây là lượt nói thứ mấy của ai. Nhánh
  // dưới là dạng tối giản một-câu-một-loại, giữ lại cho các test khẳng định
  // đúng một chuỗi cố định.
  if (variation) {
    return renderSpeechTemplate({
      intention: speech,
      targetName: speech.targetId ? target : null,
      replyToName: speech.replyToActorId ? author : null,
      ...variation,
    });
  }

  switch (speech.kind) {
    case "ACCUSE":
      return `Tôi nghi ${target}.`;
    case "QUESTION":
      return `${target} giải thích đi.`;
    case "WITHHOLD":
      return "Tôi chưa đủ căn cứ.";
    case "REPLY":
      return `${author}, tôi trả lời đây.`;
    case "AGREE":
      return `Tôi cũng thấy vậy về ${target}.`;
    case "DISAGREE":
      return `Tôi không đồng ý về ${target}.`;
    case "CHALLENGE":
      return `${author} nói rõ xem nào.`;
    case "DEFEND":
      return `Đừng treo ${target} vội.`;
    case "ASK_EVIDENCE":
      return `${author} có căn cứ gì không?`;
    case "CHANGE_MIND":
      return `Tôi đổi ý về ${target}.`;
    case "REACTION":
      return "Ừ.";
    case "HUMOR":
      return "Thôi tôi im.";
    case "CLAIM_ROLE":
      return `Tôi là ${speech.claimedRole ?? "dân làng"}.`;
    case "COUNTER_CLAIM":
      return `${target} không thể là ${speech.claimedRole ?? "dân làng"}, tôi mới là ${speech.claimedRole ?? "dân làng"}.`;
    default: {
      // Không bao giờ chạy tới. Tồn tại để việc thêm một speech act mà quên
      // nhánh render là một LỖI BIÊN DỊCH, chứ không phải một `undefined` lặng
      // lẽ chảy vào chat log.
      const unreachable: never = speech.kind;
      throw new Error(`Speech act chưa có mẫu diễn đạt: ${String(unreachable)}`);
    }
  }
}

/**
 * Chạy trọn một ván.
 *
 * Mọi nguồn ngẫu nhiên đều được gieo hạt và TÁCH LUỒNG: engine có stream riêng
 * theo vòng, mỗi BOT có stream riêng theo id. Dùng chung một stream sẽ khiến
 * việc thêm một quyết định của BOT làm đổi luôn kết quả xáo bài của engine, và
 * "cùng seed cho cùng ván" chỉ còn đúng cho tới lần sửa chiến thuật kế tiếp.
 */
export function runSelfPlay(input: SelfPlayInput): SelfPlayGame {
  const weights = input.weights ?? DEFAULT_BOT_WEIGHTS;
  const record: SelfPlayRecord = {
    seed: input.seed,
    playerCount: input.playerCount ?? 8,
    config: baseConfig(input.config),
    weightsVersion: weights.version,
    maxRounds: input.maxRounds ?? MAX_ROUNDS,
    events: input.events ?? false,
    speech: input.speech ?? true,
  };

  const config = record.config;
  const auditor = createInvariantAuditor(record);
  const log: SelfPlayEvent[] = [];
  const collector = input.trace ? createTraceCollector() : undefined;
  let actions = 0;
  let rejected = 0;
  let skipped = 0;

  const players = Array.from({ length: record.playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Người ${i + 1}`,
    isBot: true,
  }));

  // Engine nhận rng đã gieo, nên không còn cần mẹo sort-rồi-xáo-lại của Phase 2.
  const engine = GameEngine.create(
    players,
    config,
    0,
    createSeededRng(`${input.seed}:setup`),
  );

  const nameOf = (playerId: string): string =>
    engine.state.players.find((p) => p.id === playerId)?.name ?? playerId;

  const runtimes = new Map<string, BotRuntime>();
  for (const player of engine.state.players) {
    runtimes.set(
      player.id,
      new BotRuntime({
        playerId: player.id,
        rng: createSeededRng(`${input.seed}:${player.id}`),
        playerIds: engine.state.players.map((p) => p.id),
        weights,
        trace: collector as BotTraceSink | undefined,
      }),
    );
  }

  /** Chat công khai; mọi BOT còn sống đọc được ở lần `observe` kế tiếp. */
  const chat: BotChatObservation[] = [];
  let chatSequence = 0;

  /**
   * Kế toán hội thoại của một vòng.
   *
   * Ba con số này là toàn bộ thứ giữ cho một cuộc trò chuyện không biến thành
   * hai con BOT đáp qua đáp lại tới hết pha. Chúng sống ở harness chứ không ở
   * lõi vì chúng là luật của CĂN PHÒNG, không phải của một BOT: một BOT không
   * biết và không cần biết cả phòng đã nói bao nhiêu câu.
   */
  /** Cấu hình có bật hội thoại Phase 4 hay không; v1/v2 là `false`. */
  const conversational = weights.conversation.triggerFreshnessRounds > 0;
  const chainDepthOf = new Map<string, number>();
  const repliesTo = new Map<string, number>();
  const spokenThisRound = new Map<string, number>();
  const lastLineOf = new Map<string, string>();
  /** Lá phiếu đã chốt ở lượt đầu; các lượt nói sau chỉ ĐỌC nó. */
  const lastVote = new Map<string, BotVoteIntention>();
  let conversationRound = -1;

  const resetRoundBudget = (round: number): void => {
    if (conversationRound === round) return;
    conversationRound = round;
    spokenThisRound.clear();
  };

  const hasBudget = (playerId: string): boolean =>
    (spokenThisRound.get(playerId) ?? 0) < weights.conversation.messagesPerBotPerRound;

  /**
   * Phát một câu, hoặc từ chối nó vì đã chạm một trong các trần.
   *
   * Từ chối vẫn GHI vào trí nhớ của BOT. Nếu không, con BOT sẽ thấy đúng cái
   * trigger đó ở lượt sau và cố đáp lại lần nữa, mãi mãi - trần của phòng sẽ
   * biến thành một vòng lặp bận thay vì một giới hạn.
   */
  const emitSpeech = (
    playerId: string,
    speech: BotSpeechIntention,
    sink: BotChatObservation[],
  ): void => {
    const round = engine.state.round;
    resetRoundBudget(round);

    // Hai trần của CHUỖI đến từ một hàm chung với scheduler phía server, nên
    // "chuỗi sâu nhất là 3" đo được ở đây nói đúng về căn phòng thật. Ngân sách
    // mỗi BOT thì vẫn là chuyện riêng của harness: nhịp của nó khác production.
    const position = judgeChainPosition(
      speech.replyToMessageId,
      { depthOf: chainDepthOf, repliesTo },
      weights.conversation,
    );
    const depth = position.depth;
    const replies = position.parentReplies;
    const blocked = !hasBudget(playerId) || position.blockedBy !== null;

    if (blocked) {
      runtimes.get(playerId)!.recordSpeech(speech, round);
      return;
    }

    // Ranh giới của LỜI NÓI, kiểm ngay tại điểm phát.
    //
    // `checkKnowledge` chỉ soi state và knowledge; nó không nhìn thấy một ý
    // định trỏ tới một message mà BOT chưa từng thấy. Mà đó chính là kiểu rò rỉ
    // mà tầng hội thoại mới có thể tạo ra.
    const outOfScope = assertSpeechScope(speech, {
      players: engine.state.players,
      chat,
      seenSourceIds: runtimes.get(playerId)!.state.seenEventIds,
    });
    if (outOfScope.length > 0) {
      auditor.report("SPEECH_SCOPE", {
        round,
        phase: engine.state.phase,
        playerId,
        expected: "mọi ID và nguồn bằng chứng trong lời nói đều nằm trong tầm nhìn đã lọc",
        actual: outOfScope.join("; "),
      });
    }

    chatSequence += 1;
    const messageId = `chat:${round}:${chatSequence}`;
    // Bảng mẫu phong phú CHỈ dùng khi cấu hình bật hội thoại.
    //
    // v1 và v2 là hai mốc đóng băng, và văn bản mà BOT phát ra là đầu vào của
    // `chat-analysis`, tức nó đổi belief, đổi phiếu, đổi kết quả ván. Cho chúng
    // dùng bảng mẫu mới sẽ làm trôi lệch chính những con số mà báo cáo Phase 3
    // dựa vào - và làm nó lặng lẽ, vì không có gì trong bảng đó nói rằng câu
    // chữ là một tham số của mô phỏng.
    const text = conversational
      ? renderIntentionText(speech, nameOf, {
          seedTag: input.seed,
          botId: playerId,
          round,
          seq: chatSequence,
          avoidFingerprints: recentTextFingerprints(runtimes.get(playerId)!.state, 3),
        })
      : renderIntentionText(speech, nameOf);

    // Chỉ áp cho cấu hình BẬT hội thoại.
    //
    // Đây là một bất biến về CHẤT LƯỢNG, không phải về an toàn. v1 và v2 lặp
    // nguyên văn là chuyện đã biết - đó đúng là khuyết điểm mà Phase 4 sinh ra
    // để sửa - nên bắt chúng phải đạt tiêu chuẩn mới chỉ tạo ra một batch "bẩn"
    // mà không nói thêm điều gì. Các bất biến an toàn (`ROLE_LEAK`,
    // `SPEECH_SCOPE`, ...) thì áp cho mọi cấu hình, không có ngoại lệ.
    if (conversational && lastLineOf.get(playerId) === text) {
      auditor.report("SPEECH_VERBATIM_REPEAT", {
        round,
        phase: engine.state.phase,
        playerId,
        expected: "không nói lại nguyên văn câu liền trước của chính mình",
        actual: text,
      });
    }
    lastLineOf.set(playerId, text);

    runtimes.get(playerId)!.recordSpeech(speech, round, text);
    chainDepthOf.set(messageId, depth);
    spokenThisRound.set(playerId, (spokenThisRound.get(playerId) ?? 0) + 1);
    if (speech.replyToMessageId !== undefined) {
      repliesTo.set(speech.replyToMessageId, replies + 1);
    }

    log.push({
      kind: "SPEECH",
      round,
      actorId: playerId,
      messageId,
      speech: speech.kind,
      targetId: speech.targetId ?? null,
      replyToMessageId: speech.replyToMessageId ?? null,
      chainDepth: depth,
      tone: speech.tone,
      text,
      textFingerprint: speechTextFingerprint(text),
      semanticFingerprint: speechSemanticFingerprint(speech),
      evidenceSourceIds: speech.evidence.map((item) => item.sourceId),
    });

    sink.push({ id: messageId, actorId: playerId, text, at: now });
  };

  /**
   * Sự thật, chụp lại mỗi lần cần kiểm.
   *
   * CHỈ tầng kiểm bất biến đọc nó. Không đường nào đưa nó ngược vào một
   * `BotDecisionContext`: nếu có, harness sẽ tự chứng minh rằng BOT không rò rỉ
   * bằng cách chính nó rò rỉ.
   */
  /**
   * Kết quả soi sinh ra trong một đêm có Bóng Sói.
   *
   * Engine đảo chúng với xác suất 30% và không đánh dấu gì - đánh dấu sẽ là một
   * rò rỉ thật, vì Tiên Tri sẽ biết kết quả của mình không đáng tin. Harness
   * biết đêm nào có sự kiện, nên nó ghi lại ở đây và chỉ tầng kiểm bất biến đọc.
   */
  const shadowedSeerResults = new Set<string>();

  const groundTruth = (): GroundTruth => {
    const roles: Record<string, Role> = {};
    const alive: Record<string, boolean> = {};
    for (const player of engine.state.players) {
      roles[player.id] = player.role;
      alive[player.id] = player.alive;
    }
    return {
      roles,
      alive,
      activeEventId: engine.state.activeEvent?.id ?? null,
      shadowedSeerResults,
    };
  };

  const contextFor = (playerId: string): BotDecisionContext => ({
    knowledge: engine.botKnowledgeFor(playerId),
    // Bản sao: runtime không được giữ tham chiếu sống vào lịch sử chung.
    visibleChat: chat.map((message) => ({ ...message })),
  });

  const observeAll = (): void => {
    const truth = groundTruth();
    for (const player of engine.state.players) {
      if (!player.alive) continue;
      const runtime = runtimes.get(player.id)!;
      const context = contextFor(player.id);
      auditor.checkKnowledge(context.knowledge, runtime.state, truth);
      runtime.observe(context);
      auditor.checkKnowledge(context.knowledge, runtime.state, truth);
    }
  };

  let now = 0;
  const tick = (ms: number): number => (now += ms);
  let rounds = 0;

  const enterPhase = (phase: GamePhase, durationMs: number): void => {
    engine.setPhase(phase, durationMs, tick(1_000));
    log.push({ kind: "PHASE", round: engine.state.round, phase });
  };

  /**
   * Một nước đi bị engine từ chối.
   *
   * Ghi thành vi phạm CÓ CẤU TRÚC chứ không phải một chuỗi: một dòng text không
   * cho biết seed nào tái hiện được nó, và đó đúng là thứ duy nhất cần khi đọc
   * báo cáo của một batch 300 ván.
   */
  const reportRejected = (actorId: string, detail: string): void => {
    rejected += 1;
    log.push({ kind: "REJECTED", round: engine.state.round, actorId, detail });
    auditor.note(`REJECTED ${actorId}: ${detail}`);
    auditor.report("ILLEGAL_ACTION", {
      round: engine.state.round,
      phase: engine.state.phase,
      playerId: actorId,
      expected: "mọi nước đi lõi sinh ra đều phải hợp lệ với engine",
      actual: detail,
    });
  };

  /**
   * Nộp một lá phiếu, ghi lại việc nó có phải là một lần ĐỔI Ý hay không.
   *
   * `engine.submitVote` là no-op khi gửi lại đúng lựa chọn cũ, nên chỗ này lọc
   * trước để log không đầy những "lá phiếu" chưa từng tồn tại.
   */
  const castVote = (
    playerId: string,
    vote: { choice: { type: string; targetId?: string }; evidence: BotEvidence[] },
  ): void => {
    const targetId = vote.choice.type === "PLAYER" ? vote.choice.targetId ?? null : null;
    const previous = engine.state.votes[playerId];
    if (previous !== undefined && previous === targetId) return;

    try {
      engine.submitVote(playerId, targetId, tick(10));
      actions += 1;
      log.push({
        kind: "VOTE",
        round: engine.state.round,
        voterId: playerId,
        targetId,
        changed: previous !== undefined,
        evidence: vote.evidence.map((item) => ({ round: item.round, kind: item.kind })),
      });
    } catch (error) {
      reportRejected(playerId, `phiếu bất hợp lệ: ${String(error)}`);
    }
  };

  const recordDeaths = (deaths: ReadonlyArray<{ playerId: string; cause?: string }>): void => {
    for (const death of deaths) {
      log.push({
        kind: "DEATH",
        round: engine.state.round,
        playerId: death.playerId,
        cause: death.cause ?? "unknown",
      });
    }
  };

  engine.setPhase("ROLE_REVEAL", 1_000, now);

  while (engine.state.winner === null && rounds < record.maxRounds) {
    rounds += 1;
    const roundRng = createSeededRng(`${input.seed}:engine:${rounds}`);

    // ---- ĐÊM ----
    if (record.events) {
      engine.startNight(config.nightSeconds * 1_000, tick(1_000), roundRng);
      log.push({ kind: "PHASE", round: engine.state.round, phase: "NIGHT" });
    } else {
      enterPhase("NIGHT", config.nightSeconds * 1_000);
    }
    observeAll();

    for (const player of engine.state.players) {
      if (!player.alive) continue;
      const runtime = runtimes.get(player.id)!;
      const nightContext = contextFor(player.id);
      const decision = runtime.decideNight(nightContext);
      if (!decision) {
        // Chỉ tính là BỎ LƯỢT khi vai đó THẬT SỰ có lượt.
        //
        // Engine trả `night: null` cho mọi vai không hành động đêm, và Dân Làng
        // chiếm phần lớn bàn. Đếm họ vào đây khiến chỉ số "action fallback"
        // phình lên theo sĩ số ván chứ không theo chất lượng chơi - nó sẽ báo
        // ~13 lượt hỏng mỗi ván trong khi con số thật là gần 0.
        if (nightContext.knowledge.night !== null) {
          skipped += 1;
          log.push({
            kind: "SKIP",
            round: engine.state.round,
            actorId: player.id,
            at: "NIGHT",
          });
        }
        continue;
      }
      auditor.checkNightAction(nightContext.knowledge, decision, groundTruth());

      try {
        // `secondaryTargetId` là BẮT BUỘC với Thám Tử: engine đòi đúng hai người.
        // Harness Phase 2 bỏ quên tham số này, nhưng không ván mô phỏng nào bật
        // Thám Tử nên lượt đêm của vai đó im lặng mất trắng suốt.
        //
        // Tham số rng thứ 5 KHÔNG được bỏ trống. Sự kiện Bóng Sói đảo kết quả
        // soi với xác suất 30% (engine.ts), mà mặc định của tham số này là nguồn
        // ngẫu nhiên toàn cục - bỏ trống thì cùng một seed cho ra hai ván khác
        // nhau, đủ để `replayGame` lệch khỏi bản gốc chừng một phần ba số lần
        // chạy. (Đừng viết tên hàm ngẫu nhiên đó ra đây: bot-rng-personality
        // quét chuỗi trong src/bot và không phân biệt code với chú thích.)
        //
        // Dùng dòng riêng thay vì `roundRng`: `roundRng` còn được resolveNight
        // và startDay rút tiếp, nên chen một lượt rút vào giữa sẽ đẩy lệch mọi
        // lượt rút sau đó và làm đổi kết quả của những ván đã ghi lại.
        engine.submitNightAction(
          player.id,
          decision.action,
          decision.targetId,
          decision.secondaryTargetId ?? null,
          createSeededRng(`${input.seed}:night:${rounds}:${player.id}`),
        );
        actions += 1;
        // Ghi lại NGAY: sự kiện chỉ sống một vòng, còn kết quả soi sống tới hết
        // ván. Đây là khoảnh khắc duy nhất biết được cả hai.
        if (engine.state.activeEvent?.id === "WOLF_SHADOW") {
          for (const targetId of [decision.targetId, decision.secondaryTargetId]) {
            if (targetId) shadowedSeerResults.add(`${player.id}:${targetId}`);
          }
        }
        log.push({
          kind: "NIGHT_ACTION",
          round: engine.state.round,
          actorId: player.id,
          action: decision.action,
          targetId: decision.targetId,
        });
      } catch (error) {
        reportRejected(
          player.id,
          `nước đi đêm bất hợp lệ (${decision.action}): ${String(error)}`,
        );
      }
    }

    engine.lockWolves(createSeededRng(`${input.seed}:wolves:${rounds}`));

    // Phù Thuỷ hành động SAU khi bầy Sói khoá phiếu - trước đó cô ta chưa biết
    // nạn nhân, đúng như luật engine.
    if (engine.witchPending()) {
      const witch = engine.alivePlayers().find((player) => player.role === "WITCH");
      if (witch) {
        const runtime = runtimes.get(witch.id)!;
        const context = contextFor(witch.id);
        runtime.observe(context);
        const decision = runtime.decideNight(context);
        if (decision) {
          try {
            // Phù Thuỷ hôm nay không chạm nhánh dùng rng nào trong engine, nhưng
            // cứ gieo sẵn cho khỏi thành quả bom hẹn giờ như lượt soi ở trên.
            engine.submitNightAction(
              witch.id,
              decision.action,
              decision.targetId,
              null,
              createSeededRng(`${input.seed}:night:${rounds}:${witch.id}`),
            );
            actions += 1;
            log.push({
              kind: "NIGHT_ACTION",
              round: engine.state.round,
              actorId: witch.id,
              action: decision.action,
              targetId: decision.targetId,
            });
          } catch (error) {
            reportRejected(witch.id, `nước đi Phù Thuỷ bất hợp lệ: ${String(error)}`);
          }
        } else {
          skipped += 1;
        }
      }
    }

    recordDeaths(engine.resolveNight(tick(1_000), roundRng));
    if (!settleHunter()) break;
    if (finished()) break;

    // ---- NGÀY ----
    if (record.events) {
      engine.startDay(config.discussionSeconds * 1_000, tick(1_000), roundRng);
      log.push({ kind: "PHASE", round: engine.state.round, phase: "DAY_DISCUSSION" });
    } else {
      enterPhase("DAY_DISCUSSION", config.discussionSeconds * 1_000);
    }
    observeAll();

    enterPhase("VOTING", config.voteSeconds * 1_000);
    observeAll();

    resetRoundBudget(engine.state.round);
    const spoken: BotChatObservation[] = [];
    for (const player of engine.alivePlayers()) {
      const runtime = runtimes.get(player.id)!;
      const context = contextFor(player.id);
      const before = engine.state.votes[player.id];
      const vote = runtime.decideVote(context);
      void before;

      castVote(player.id, vote);
      lastVote.set(player.id, vote);

      if (!record.speech) continue;
      if (!hasBudget(player.id)) continue;

      // Chụp nước đi TRƯỚC khi sinh lời nói, rồi so lại sau khi render.
      //
      // Đây là bất biến trung tâm của cả hai phase trước: provider chỉ diễn đạt,
      // không quyết định. Kiểm nó bằng cách so sánh chứ không bằng cách tin vào
      // chữ ký hàm - một `readonly` trong TypeScript biến mất lúc chạy.
      const sealed = JSON.stringify(vote.choice);
      const speech = runtime.decideSpeech(context, vote);
      if (speech) {
        const text = renderIntentionText(speech, nameOf);
        if (JSON.stringify(vote.choice) !== sealed) {
          auditor.report("SPEECH_CHANGED_ACTION", {
            round: engine.state.round,
            phase: engine.state.phase,
            playerId: player.id,
            expected: `lá phiếu vẫn là ${sealed} sau khi sinh lời nói`,
            actual: `${JSON.stringify(vote.choice)} (câu nói: "${text}")`,
          });
        }
      }
      if (!speech) continue;
      emitSpeech(player.id, speech, spoken);
    }
    // Đẩy vào chat chung SAU vòng lặp: trong một pha thảo luận thật, không ai
    // nghe được câu của người nói sau mình rồi mới quyết định.
    chat.push(...spoken);

    // ---- CÁC LƯỢT HỘI THOẠI TIẾP THEO ----
    //
    // Lượt đầu ở trên là lượt "tự phát biểu": chưa ai nói gì trong vòng này nên
    // không có gì để đáp. Những lượt sau mới là hội thoại thật - BOT đọc câu
    // vừa rồi của người khác và quyết định có nói lại hay không.
    //
    // Lá phiếu KHÔNG được quyết lại ở đây. Nó đã chốt ở lượt đầu, và hỏi lại
    // sẽ tiêu thêm số ngẫu nhiên của chính dòng RNG mà lượt đầu đã dùng, tức
    // làm lệch mọi ván đã ghi lại. Đây cũng là điều đúng về mặt luật: lời nói
    // không đổi được nước đi.
    for (let turn = 1; record.speech && turn < weights.conversation.selfPlayTurnsPerRound; turn += 1) {
      const later: BotChatObservation[] = [];
      for (const player of engine.alivePlayers()) {
        const ballot = lastVote.get(player.id);
        if (!ballot) continue;
        if (!hasBudget(player.id)) continue;

        const runtime = runtimes.get(player.id)!;
        const context = contextFor(player.id);
        runtime.observe(context);

        const sealed = JSON.stringify(ballot.choice);
        const speech = runtime.decideSpeech(context, ballot);
        if (!speech) continue;
        if (JSON.stringify(ballot.choice) !== sealed) {
          auditor.report("SPEECH_CHANGED_ACTION", {
            round: engine.state.round,
            phase: engine.state.phase,
            playerId: player.id,
            expected: `lá phiếu vẫn là ${sealed} sau khi sinh lời nói`,
            actual: JSON.stringify(ballot.choice),
          });
        }
        emitSpeech(player.id, speech, later);
      }
      if (later.length === 0) break;
      chat.push(...later);
    }

    // ---- LƯỢT CÂN NHẮC LẠI ----
    //
    // Không có lượt này, mỗi BOT bỏ đúng một lá phiếu mỗi vòng và KHÔNG BAO GIỜ
    // đổi ý. Hậu quả không chỉ là một chỉ số bằng 0: cả `myVote`, `voteHysteresis`
    // và nhánh "giữ mục tiêu cũ" trong `selectVote` chưa từng chạy trong mô
    // phỏng, tức Phase 1 đã dựng quyền đổi phiếu rồi không ván nào kiểm nó.
    //
    // Ở đây BOT thấy bảng kiểm phiếu sơ bộ và những câu vừa nói, rồi quyết lại.
    // Đổi phiếu là hành vi THẬT của người chơi, không phải nhiễu thêm vào.
    for (const player of engine.alivePlayers()) {
      const runtime = runtimes.get(player.id)!;
      const context = contextFor(player.id);
      runtime.observe(context);
      castVote(player.id, runtime.decideVote(context));
    }

    const outcome = engine.resolveNomination(config.defenseSeconds * 1_000, tick(1_000));
    log.push({
      kind: "NOMINATION",
      round: engine.state.round,
      accusedId: outcome.kind === "TRIAL" ? outcome.accusedId : null,
    });

    if (outcome.kind === "TRIAL") {
      engine.beginFinalVote(config.finalVoteSeconds * 1_000, tick(1_000));
      observeAll();

      for (const voter of engine.finalVoters()) {
        const runtime = runtimes.get(voter.id)!;
        const verdict = runtime.decideFinalVote(contextFor(voter.id));
        try {
          engine.submitFinalVote(voter.id, verdict.guilty);
          actions += 1;
          log.push({
            kind: "FINAL_VOTE",
            round: engine.state.round,
            voterId: voter.id,
            guilty: verdict.guilty,
          });
        } catch (error) {
          reportRejected(voter.id, `phiếu xác nhận bất hợp lệ: ${String(error)}`);
        }
      }

      const lynched = engine.resolveFinalVote(tick(1_000));
      if (lynched) recordDeaths([{ playerId: lynched.playerId, cause: "lynch" }]);
      if (!settleHunter()) break;
    }

    for (const player of engine.state.players) {
      if (!player.alive) continue;
      const runtime = runtimes.get(player.id)!;
      runtime.summarizeRound(engine.state.round);
      log.push(...coalitionEvents(runtime, engine.state.round));
    }

    if (finished()) break;
  }

  if (engine.state.winner === null) {
    auditor.report("ROUND_LIMIT", {
      round: rounds,
      phase: engine.state.phase,
      playerId: null,
      expected: `ván phải kết thúc trong ${record.maxRounds} vòng`,
      actual: `còn ${engine.alivePlayers().length} người sống, chưa có phe thắng`,
    });
  }

  // Trace được kiểm SAU cùng: nó là bản ghi của những gì đã xảy ra, nên kiểm nó
  // trong lúc chạy chỉ lặp lại đúng khẳng định mà `checkKnowledge` vừa làm.
  const finalTruth = groundTruth();
  for (const trace of collector?.traces ?? []) auditor.checkTrace(trace, finalTruth);

  return {
    record,
    winner: engine.state.winner,
    rounds,
    actions,
    rejected,
    skipped,
    events: log,
    violations: auditor.violations,
    traces: collector?.traces ?? [],
    roles: finalTruth.roles,
  };

  // ---- helpers đóng gói engine/log ----

  function coalitionEvents(runtime: BotRuntime, round: number): SelfPlayEvent[] {
    return detectCoalitions(runtime.state, undefined, runtime.weights).map((group) => ({
      kind: "COALITION" as const,
      round,
      observerId: runtime.state.playerId,
      size: group.memberIds.length,
      cohesion: group.cohesion,
    }));
  }

  /** Xử phát bắn Thợ Săn nếu đang treo. Trả `false` khi ván đã kết thúc. */
  function settleHunter(): boolean {
    if (!engine.hasPendingHunterShot()) return true;

    engine.beginHunterShot(15_000, tick(1_000));
    const reaction = engine.state.hunterReaction;
    if (reaction && !reaction.resolved) {
      const runtime = runtimes.get(reaction.hunterId);
      if (runtime) {
        const context = contextFor(reaction.hunterId);
        runtime.observe(context);
        const shot = runtime.decideHunterShot(context);
        try {
          engine.submitHunterShot(reaction.hunterId, shot.targetId);
          log.push({
            kind: "HUNTER_SHOT",
            round: engine.state.round,
            hunterId: reaction.hunterId,
            targetId: shot.targetId,
          });
          if (shot.targetId) {
            recordDeaths([{ playerId: shot.targetId, cause: "hunter" }]);
          } else {
            skipped += 1;
          }
        } catch (error) {
          reportRejected(reaction.hunterId, `phát bắn bất hợp lệ: ${String(error)}`);
        }
      }
    }
    engine.completeHunterReaction();
    return engine.state.winner === null;
  }

  function finished(): boolean {
    const winner = engine.checkWin();
    if (!winner) return false;
    engine.finishGame(winner, tick(1_000));
    return true;
  }
}

/** Dựng lại CHÍNH XÁC một ván từ record của nó, không cần batch. */
export function replayGame(record: SelfPlayRecord, weights?: BotWeights): SelfPlayGame {
  if (weights && weights.version !== record.weightsVersion) {
    throw new Error(
      `Record cần trọng số phiên bản "${record.weightsVersion}" nhưng nhận "${weights.version}"`,
    );
  }
  return runSelfPlay({
    seed: record.seed,
    playerCount: record.playerCount,
    config: record.config,
    weights,
    maxRounds: record.maxRounds,
    events: record.events,
    speech: record.speech,
  });
}

/** Câu lệnh chạy lại một seed hỏng, đủ để dán thẳng vào terminal. */
export function replayCommand(record: SelfPlayRecord): string {
  const flags = [
    `--seed ${record.seed}`,
    "--games 1",
    `--players ${record.playerCount}`,
    `--weights ${record.weightsVersion}`,
    `--max-rounds ${record.maxRounds}`,
  ];
  if (record.events) flags.push("--events");
  if (!record.speech) flags.push("--no-speech");
  return `npm run selfplay -- ${flags.join(" ")}`;
}
