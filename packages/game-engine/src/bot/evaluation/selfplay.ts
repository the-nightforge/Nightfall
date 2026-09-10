import {
  isRole,
  isWolfPack,
  ROLE_META,
  type GamePhase,
  type PersonalWin,
  type Phase,
  type Role,
  type RoomConfig,
  type Winner,
} from "@masoi/shared";
import { GameEngine } from "../../engine";
import { detectCoalitions } from "../analysis/coalition";
import { BotRuntime, type LearnedDecisions } from "../BotRuntime";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { LearnedPolicy } from "../learning/mlp";
import { judgeChainPosition, type ChainBlockReason } from "../conversation/chain-limits";
import {
  DEFENSE_MAX_SPEECHES_PER_BOT,
  planDefenseCommentary,
  planDefenseSpeakers,
  shouldSpeakInDefense,
} from "../decision/defense-scheduler";
import { witchPoisonThreshold } from "../roles/witch";
import {
  speechShapeFingerprint,
  speechSemanticFingerprint,
  speechTextFingerprint,
} from "../conversation/fingerprint";
import { recentOpenings, recentTextFingerprints } from "../conversation/speech-memory";
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
/**
 * Ghế nào chơi bằng policy học được.
 *
 * Phe đọc theo `isWolfPack(role)`; vai trung lập tính về phía làng, cùng quy
 * ước với mọi tầng đo khác trong harness.
 */
export type LearnedSeats = "all" | "village" | "wolves";

export interface SelfPlayRecord {
  seed: string;
  playerCount: number;
  config: RoomConfig;
  weightsVersion: string;
  maxRounds: number;
  events: boolean;
  speech: boolean;
  /**
   * Vòng speech DEFENSE thật có chạy trong ván này không.
   *
   * Optional vì record cũ không có trường này; vắng mặt là `false` (hành vi
   * cũ). `replayGame` đọc đúng trường này nên một ván defense-on chạy lại ra
   * defense-on.
   */
  defense?: boolean;
  /**
   * Số ghế đầu được gắn cờ `isBot: false` - vẫn do bot điều khiển.
   *
   * Tồn tại để self-play đo được các nhánh "bàn có người thật" (P2: Tiên Tri
   * giấu kết quả, Sói bán đồng đội sớm hơn), vốn chỉ mở khi
   * `countHumansAlive >= humanTableThreshold`. Không có nó, mọi ghế là bot và
   * những nhánh đó không bao giờ chạy trong harness. Optional vì record cũ
   * không có trường này; vắng mặt là 0.
   */
  humanSeats?: number;
  /**
   * Id của policy học được đã chơi ván này; vắng mặt = heuristic thuần.
   *
   * Chỉ có ID chứ không có trọng số: một record phải nhỏ và đọc được, còn
   * `replayGame` thì đòi đúng policy đó được cấp lại — cùng luật với
   * `weightsVersion`.
   */
  learnedPolicyId?: string;
  learnedSeats?: LearnedSeats;
  /** Nhiệt độ lấy mẫu đã dùng; vắng = 0 (argmax). `replayGame` cần nó để tái lập. */
  learnedTemperature?: number;
  /** Vắng = `"both"`. Xem `BotRuntimeOptions.learnedDecisions`. */
  learnedDecisions?: LearnedDecisions;
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
  /**
   * Chạy vòng speech DEFENSE thật sau `resolveNomination` ra TRIAL.
   *
   * `true` = đo mới (mọi bot sống được nói — bị cáo qua `decideDefense`,
   * phi-bị-cáo qua phán quyết Treo/Tha sắp bỏ, bot chưa đủ tin thì im — tối
   * đa 2 lượt/bot, rồi mới `beginFinalVote`); `false`/vắng mặt = hành vi cũ
   * byte-for-byte (đi thẳng `resolveNomination` -> `beginFinalVote`,
   * `trialDefense` null).
   */
  defense?: boolean;
  /** Thu trace mọi quyết định. Tốn bộ nhớ; mặc định tắt. */
  trace?: boolean;
  /**
   * Ghi kèm observation lúc chơi vào mỗi trace. Xem
   * `BotRuntimeOptions.traceLiveInput`; chỉ có nghĩa khi `trace` bật.
   */
  traceLiveInput?: boolean;
  /** Policy học được (MLP) cắm vào BotRuntime. Vắng = heuristic thuần. */
  learnedPolicy?: LearnedPolicy;
  /** Ghế nào dùng policy; mặc định `"all"`. Xem `LearnedSeats`. */
  learnedSeats?: LearnedSeats;
  /** Xem `BotRuntimeOptions.learnedTemperature`. Mặc định 0 (argmax). */
  learnedTemperature?: number;
  /** Xem `BotRuntimeOptions.learnedDecisions`. Mặc định `"both"`. */
  learnedDecisions?: LearnedDecisions;
  /** Xem `SelfPlayRecord.humanSeats`. Mặc định 0. */
  humanSeats?: number;
}

/** Vì sao phòng không cho phát một câu. `BUDGET` là hạn mức riêng của bot. */
export type SpeechBlockReason = "BUDGET" | ChainBlockReason;

/**
 * Bảy số phận của một câu hỏi trực tiếp, RỜI NHAU và phủ kín.
 *
 * - `ANSWERED`: người được hỏi đã phát một câu đáp đúng message đó.
 * - `NOT_PARSED`: người được hỏi đã đọc chat có câu đó mà parser không sinh
 *   ra memory nào trỏ tới họ - bot không biết mình bị hỏi.
 * - `BLOCKED_ROOM`: bot đã định đáp, nhưng phòng chặn (hạn mức, chuỗi, số
 *   phản hồi). Xem `SPEECH_BLOCKED`.
 * - `NO_TURN`: bot hiểu câu hỏi nhưng không còn lượt nói nào sau đó trong
 *   vòng (hết hạn mức trước khi tới lượt, hoặc vòng hết lượt hội thoại).
 * - `DECLINED_SPOKE_OTHER`: bot hiểu, có lượt, và chọn nói chuyện KHÁC.
 * - `DECLINED_SILENT`: bot hiểu, có lượt, và chọn im - né theo tính cách
 *   hoặc chiến thuật (`responseProbability`, khai vai ưu tiên, đã nói ý đó).
 * - `UNDETERMINED`: người được hỏi không còn quan sát chat sau câu hỏi (đã
 *   chết, hoặc ván kết thúc) nên không có bằng chứng để xếp vào đâu.
 *
 * Hai nhóm `DECLINED_*` là quyết định của planner (tất định, theo tính cách),
 * KHÔNG phải lỗi. Harness không phân biệt được RNG-né với khai-vai-ưu-tiên mà
 * không đụng vào RNG, nên nó dừng ở mức "bot đã có cơ hội và không chọn đáp".
 */
export type QuestionOutcome =
  | "ANSWERED"
  | "NOT_PARSED"
  | "BLOCKED_ROOM"
  | "NO_TURN"
  | "DECLINED_SPOKE_OTHER"
  | "DECLINED_SILENT"
  | "UNDETERMINED";

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
      /**
       * Trục nội dung của ý định, hoặc `null`.
       *
       * Cần cho dataset speech policy (COMMUNICATION §26): từ PR 4, `topic` là
       * thứ DUY NHẤT phân biệt một câu lảng (`DEFLECT` -> `PROCESS`) với một
       * câu đáp thẳng - hai cái cùng `kind: "REPLY"`. Thiếu nó thì nhãn của hai
       * chiến thuật khác hẳn nhau trùng khít lên nhau.
       */
      topic: BotSpeechIntention["topic"] | null;
      /** Văn bản đã phát. Không đo được lặp thật nếu không có nó. */
      text: string;
      textFingerprint: string;
      /**
       * Vân tay của KHUNG CÂU - cùng câu, khác tên người, cùng một giá trị.
       *
       * Cái duy nhất đo được `crossBotRepetitionRate`. `textFingerprint` không
       * đo được: hai BOT nói cùng một khuôn về hai người khác nhau cho ra hai
       * vân tay khác nhau, nên chỉ số lặp báo "không lặp" đúng lúc cả bàn đang
       * nói y hệt nhau.
       *
       * Báo cáo JSON cũ không mang trường này; thiếu nó thì bỏ qua câu đó.
       */
      shapeFingerprint?: string;
      semanticFingerprint: string;
      evidenceSourceIds: string[];
      /**
       * Câu này do bảng mẫu sinh ra (true) hay do nhà cung cấp (false).
       *
       * Trong self-play luôn true - nhân mô phỏng không gọi mạng. Trường tồn
       * tại để `fromTemplateRate` là một phép ĐẾM trên từng câu thay vì một
       * hằng số, và để một bản ghi nhập từ production đọc được cùng một số đo.
       */
      fromTemplate: boolean;
      /**
       * Vai mà ý định `CLAIM_ROLE`/`COUNTER_CLAIM` này khai, hoặc `null` với mọi
       * speech act khác.
       *
       * KHÔNG phải vai thật của người nói - một con Sói khai láo mang
       * `claimedRole: "SEER"`. Chỉ tầng ĐO đọc trường này; lõi quyết định đã
       * xong việc trước khi tới đây. Cần cho `claimAccuracy` (metrics.ts):
       * không có nó, tầng đo không biết một `SPEECH` có phải là lời khai Tiên
       * Tri hay không mà không phải đoán lại từ `speech.kind`.
       */
      claimedRole: Role | null;
    }
  | {
      /**
       * Một ý định đã được lõi chốt nhưng CĂN PHÒNG không cho phát.
       *
       * Ba lý do, tất cả là luật của phòng chứ không phải của bot: hết hạn mức
       * câu trong vòng, chuỗi đối đáp đã đủ sâu, câu được đáp đã nhận đủ phản
       * hồi. Ghi lại để "im lặng" tách được khỏi "bị chặn" - trước đó hai thứ
       * này trông y hệt nhau trong log.
       */
      kind: "SPEECH_BLOCKED";
      round: number;
      actorId: string;
      speech: BotSpeechIntention["kind"];
      replyToMessageId: string | null;
      reason: SpeechBlockReason;
    }
  | {
      /**
       * Số phận của MỘT câu hỏi nhắm thẳng vào một người, chốt ở cuối vòng.
       *
       * Xem `QuestionOutcome`. Harness chỉ gán nguyên nhân khi có bằng chứng
       * đọc được từ chính state/lịch của nó; không đủ bằng chứng thì
       * `UNDETERMINED`, không đoán.
       */
      kind: "QUESTION_OUTCOME";
      round: number;
      messageId: string;
      askerId: string;
      targetId: string;
      outcome: QuestionOutcome;
    }
  | {
      /**
       * Một đêm Phù Thuỷ CÒN bình độc mà không dùng.
       *
       * `topSuspectId`/`topSuspicion` là người cô ta nghi nhất theo belief của
       * chính cô ta lúc đó; `threshold` là ngưỡng dùng bình đêm đó (đã tính
       * chiết khấu làng mỏng). Tầng đo đối chiếu với vai thật để tách "giữ
       * đúng" khỏi "bỏ lỡ": không có dòng này, mọi bình còn nguyên cuối ván đều
       * bị đếm chung một rọ.
       */
      kind: "WITCH_HOLD";
      round: number;
      actorId: string;
      topSuspectId: string | null;
      topSuspicion: number;
      threshold: number;
      /**
       * Có mục tiêu ĐÃ vượt ngưỡng nghi ngờ nhưng bị chặn vì tin tưởng còn cao
       * (`witchPoisonTrustVeto`). Đây là trường hợp duy nhất mà "giữ bình" là
       * một quyết định giữa hai tín hiệu mâu thuẫn, không phải thiếu bằng chứng.
       */
      vetoedByTrust: boolean;
    }
  | { kind: "NOMINATION"; round: number; accusedId: string | null }
  | {
      /**
       * Cửa sổ DEFENSE của một phiên toà, chốt ngay sau `beginFinalVote`.
       *
       * Chỉ ghi khi harness bật `defense` — đường cũ không có event này nên
       * ván cũ giữ nguyên byte-for-byte. `endedAt` luôn là số (khác null) vì
       * `beginFinalVote` vừa chốt nó; test khoá thứ tự
       * defense-speeches -> beginFinalVote -> observe -> decideFinalVote đọc
       * trực tiếp ở đây thay vì suy từ sự có mặt của speech.
       */
      kind: "DEFENSE_WINDOW";
      round: number;
      accusedId: string;
      startedAt: number;
      endedAt: number;
    }
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
  /**
   * Thắng lợi CÁ NHÂN mà engine đã ghi nhận trong ván này.
   *
   * Cần thiết vì `winner` không nói được điều đó: một vai trung lập thắng bằng
   * một điều kiện riêng, nên mọi tầng đo suy thắng-thua từ `winner` sẽ luôn
   * chấm nó là thua. Chép nguyên từ `engine.personalWins()` chứ không dựng lại
   * từ `events`: đọc lại một cái chết "lynch" rồi TỰ KẾT LUẬN ai thắng là dựng
   * một bản sao thứ hai của luật, và bản sao đó sẽ trôi lệch khỏi engine.
   *
   * Optional vì `SelfPlayGame` được ghi thẳng ra JSON bởi
   * `npm run selfplay -- --out`: báo cáo lưu trước bản này không có trường đó,
   * và tầng đo phải đọc được chúng.
   */
  personalWins?: PersonalWin[];
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
    avoidOpenings?: readonly string[];
    avoidShapes?: readonly string[];
  },
): string {
  const target = speech.targetId ? nameOf(speech.targetId) : "người đó";
  const author = speech.replyToActorId ? nameOf(speech.replyToActorId) : target;
  // Nguồn chữ vai DUY NHẤT là ROLE_META - cùng bảng UI dùng để hiển thị. Một
  // định danh Role thô ("SEER") không phải tiếng Việt và bộ phân tích chat
  // (`roleAtStart`) không đọc được nó; nhánh tối giản này vẫn phải sinh ra câu
  // có thể đọc ngược, dù chỉ dùng khi hội thoại tắt. Ván cũ có thể mang vai đã
  // bị xóa cứng (PRIEST/MEDIUM) nên guard `isRole`, rơi về "dân làng".
  const roleName =
    speech.claimedRole && isRole(speech.claimedRole)
      ? ROLE_META[speech.claimedRole].name
      : "dân làng";

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
      return `Tôi là ${roleName}.`;
    case "COUNTER_CLAIM":
      return `${target} không thể là ${roleName}, tôi mới là ${roleName}.`;
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
  const events = input.events ?? false;
  const record: SelfPlayRecord = {
    seed: input.seed,
    playerCount: input.playerCount ?? 8,
    /*
     * Bật sự kiện là bật CHẾ ĐỘ CHAOS, không chỉ đổi đường vào pha.
     *
     * `selectEvent` mở đầu bằng `if (mode !== "chaos") return null`. Trước dòng
     * này, `--events` chỉ khiến runner gọi `startNight`/`startDay` thay cho
     * `enterPhase` - đúng đường dẫn có thể bốc sự kiện, nhưng bốc ra null ở mọi
     * lần gọi vì bộ bài preset để `mode: "ranked"`. Report vì thế ghi
     * `events: true` bên cạnh `mode: "ranked"`, và không ván nào có sự kiện nào.
     *
     * Hệ quả: cả hệ thống sự kiện chưa từng được self-play đo, kể cả các núm
     * cân bằng (`NIGHT_TILT_WEIGHT`, `TILT_LIMIT`) vốn nói rõ là cần đo.
     */
    config: baseConfig(events ? { ...input.config, mode: "chaos" } : input.config),
    weightsVersion: weights.version,
    maxRounds: input.maxRounds ?? MAX_ROUNDS,
    events,
    speech: input.speech ?? true,
    defense: input.defense === true,
    humanSeats: input.humanSeats ?? 0,
    // Bỏ hẳn hai khoá khi không có policy, thay vì để `undefined`: record được
    // ghi thẳng ra JSON, và một record heuristic phải giống hệt record trước
    // bản này — `Object.keys` của nó là một hợp đồng có test canh.
    ...(input.learnedPolicy
      ? {
          learnedPolicyId: input.learnedPolicy.id,
          learnedSeats: input.learnedSeats ?? "all",
          learnedTemperature: input.learnedTemperature ?? 0,
          // Chỉ ghi khi KHÁC mặc định: record là hợp đồng JSON có test canh khoá.
          ...(input.learnedDecisions && input.learnedDecisions !== "both"
            ? { learnedDecisions: input.learnedDecisions }
            : {}),
        }
      : {}),
  };

  const config = record.config;
  const auditor = createInvariantAuditor(record);
  const log: SelfPlayEvent[] = [];
  const collector = input.trace ? createTraceCollector() : undefined;
  let actions = 0;
  let rejected = 0;
  let skipped = 0;

  // Ghế "người" chỉ khác ở cờ: vẫn là bot điều khiển. Xem `humanSeats`.
  const humanSeats = record.humanSeats ?? 0;
  const players = Array.from({ length: record.playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Người ${i + 1}`,
    isBot: i >= humanSeats,
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

  const learnedSeats = input.learnedSeats ?? "all";
  const runtimes = new Map<string, BotRuntime>();
  for (const player of engine.state.players) {
    // Ghế không thuộc phe được chọn nhận `undefined` chứ không nhận một policy
    // bị vô hiệu hoá: `BotRuntime` không có `learnedPolicy` là đường heuristic
    // hiện hành, byte một, và đó chính là phía đối chứng của benchmark.
    const usesLearned =
      input.learnedPolicy !== undefined &&
      (learnedSeats === "all" || (learnedSeats === "wolves") === isWolfPack(player.role));
    runtimes.set(
      player.id,
      new BotRuntime({
        playerId: player.id,
        rng: createSeededRng(`${input.seed}:${player.id}`),
        playerIds: engine.state.players.map((p) => p.id),
        weights,
        trace: collector as BotTraceSink | undefined,
        traceLiveInput: input.traceLiveInput === true,
        learnedPolicy: usesLearned ? input.learnedPolicy : undefined,
        learnedTemperature: input.learnedTemperature,
        learnedDecisions: input.learnedDecisions,
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
  /**
   * Khung câu mà CẢ PHÒNG vừa dùng, cửa sổ `roomShapeWindow` câu gần nhất.
   *
   * Sống ở harness chứ không ở lõi, cùng lý do với `chainDepthOf`/`repliesTo`:
   * đây là luật của CĂN PHÒNG, và một BOT không biết cả bàn vừa nói những khung
   * câu nào. Nó chỉ đi vào tầng CÂU CHỮ - ý định đã chốt xong trước đó - nên nó
   * không đổi được nước đi nào, chỉ đổi cách nói.
   */
  const roomShapes: string[] = [];
  /** Tên hiển thị của mọi ghế, để xoá tên khỏi khung câu. Không đổi trong ván. */
  const allNames = engine.state.players.map((player) => player.name);
  const rememberShape = (text: string): void => {
    const window = weights.conversation.roomShapeWindow;
    if (window <= 0) return;
    roomShapes.push(speechShapeFingerprint(text, allNames));
    if (roomShapes.length > window) roomShapes.shift();
  };
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
   * Sổ theo dõi câu hỏi trực tiếp của vòng hiện tại.
   *
   * CHỈ ĐỌC: mọi móc ghi vào sổ này đều đứng sau một lời gọi đã có sẵn
   * (`observe`, `decideSpeech`, `emitSpeech`) và không rút RNG, không đổi
   * state của bot. Cùng seed cho cùng ván - có hay không có sổ này.
   *
   * `recognized === null` nghĩa là người được hỏi CHƯA quan sát chat nào có
   * câu đó, nên chưa nói được gì về parser.
   */
  interface PendingQuestion {
    messageId: string;
    askerId: string;
    targetId: string;
    round: number;
    recognized: boolean | null;
    /** Số lần `decideSpeech` của người được hỏi SAU khi câu đã hiện trong chat. */
    turns: number;
    blocked: SpeechBlockReason | null;
    answered: boolean;
    spokeOther: boolean;
  }
  const pendingQuestions = new Map<string, PendingQuestion>();
  const chatHas = (messageId: string): boolean => chat.some((m) => m.id === messageId);

  /** Sau mỗi `observe`: parser của người được hỏi có nhận ra câu hỏi không. */
  const noteObserved = (playerId: string, context: BotDecisionContext): void => {
    for (const question of pendingQuestions.values()) {
      if (question.targetId !== playerId || question.recognized !== null) continue;
      if (!context.visibleChat.some((m) => m.id === question.messageId)) continue;
      const state = runtimes.get(playerId)!.state;
      question.recognized = state.memories.some(
        (memory) => memory.sourceId === question.messageId && memory.targetId === playerId,
      );
    }
  };

  /** Trước mỗi `decideSpeech`: người được hỏi có thêm một cơ hội đáp. */
  const noteSpeechTurn = (playerId: string): void => {
    for (const question of pendingQuestions.values()) {
      if (question.targetId === playerId && chatHas(question.messageId)) question.turns += 1;
    }
  };

  /** Chốt số phận mọi câu hỏi của vòng rồi xoá sổ. Xem `QuestionOutcome`. */
  const settleQuestions = (): void => {
    for (const question of pendingQuestions.values()) {
      let outcome: QuestionOutcome;
      if (question.answered) outcome = "ANSWERED";
      else if (question.blocked !== null) outcome = "BLOCKED_ROOM";
      else if (question.recognized === null) outcome = "UNDETERMINED";
      else if (!question.recognized) outcome = "NOT_PARSED";
      else if (question.turns === 0) outcome = "NO_TURN";
      else outcome = question.spokeOther ? "DECLINED_SPOKE_OTHER" : "DECLINED_SILENT";
      log.push({
        kind: "QUESTION_OUTCOME",
        round: question.round,
        messageId: question.messageId,
        askerId: question.askerId,
        targetId: question.targetId,
        outcome,
      });
    }
    pendingQuestions.clear();
  };

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
    const blockReason: SpeechBlockReason | null = !hasBudget(playerId)
      ? "BUDGET"
      : position.blockedBy;

    if (blockReason !== null) {
      runtimes.get(playerId)!.recordSpeech(speech, round);
      log.push({
        kind: "SPEECH_BLOCKED",
        round,
        actorId: playerId,
        speech: speech.kind,
        replyToMessageId: speech.replyToMessageId ?? null,
        reason: blockReason,
      });
      const asked = speech.replyToMessageId
        ? pendingQuestions.get(speech.replyToMessageId)
        : undefined;
      if (asked && asked.targetId === playerId) asked.blocked = blockReason;
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
          // Cùng luật với server: không mở đầu như năm lượt vừa rồi của chính mình.
          avoidOpenings: recentOpenings(runtimes.get(playerId)!.state),
          // Và không lặp khung câu người khác vừa nói. Rỗng khi knob tắt.
          avoidShapes: roomShapes,
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
    rememberShape(text);

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
      topic: speech.topic ?? null,
      text,
      textFingerprint: speechTextFingerprint(text),
      // Ghi ở đây chứ không để tầng đo tự tính: chỉ chỗ này mới có danh sách
      // tên của ván, và một phép xoá tên thứ hai ở `metrics.ts` là một chỗ sẽ
      // trôi lệch khỏi phép mà `renderSpeechTemplate` thật sự dùng để né.
      shapeFingerprint: speechShapeFingerprint(text, allNames),
      semanticFingerprint: speechSemanticFingerprint(speech),
      evidenceSourceIds: speech.evidence.map((item) => item.sourceId),
      fromTemplate: true,
      claimedRole: speech.claimedRole ?? null,
    });

    // Sổ câu hỏi: câu này ĐÁP một câu hỏi đang chờ, hay là chuyện khác của
    // chính người được hỏi? Chỉ tính khi câu hỏi đã hiện trong chat chung -
    // một câu nói ra trước khi thấy câu hỏi không phải là "chọn nói việc khác".
    for (const question of pendingQuestions.values()) {
      if (question.targetId !== playerId || !chatHas(question.messageId)) continue;
      if (speech.replyToMessageId === question.messageId) question.answered = true;
      else question.spokeOther = true;
    }
    if (
      (speech.kind === "QUESTION" || speech.kind === "ASK_EVIDENCE") &&
      speech.targetId !== undefined &&
      speech.targetId !== playerId
    ) {
      pendingQuestions.set(messageId, {
        messageId,
        askerId: playerId,
        targetId: speech.targetId,
        round,
        recognized: null,
        turns: 0,
        blocked: null,
        answered: false,
        spokeOther: false,
      });
    }

    sink.push({ id: messageId, actorId: playerId, text, at: now });
  };

  /**
   * Vòng speech DEFENSE: mọi bot CÒN SỐNG (kể cả bị cáo) được lên tiếng, tối
   * đa 2 lượt/bot, bot chưa đủ tin thì im.
   *
   * Thứ tự lượt dùng chung `planDefenseSpeakers` với phòng thật (cùng seed
   * cho cùng thứ tự). Bị cáo + Hề đi qua `decideDefense` như cũ (Hề giữ
   * INDIFFERENT/HUMOR); bot khác bàn về bị cáo theo đúng phán quyết Treo/Tha
   * sắp bỏ (`decideFinalVote` + `planDefenseCommentary`), và im khi
   * `confidence` bằng 0 (belief rỗng/trung tính).
   *
   * Thứ tự gọi là: defense speeches -> `beginFinalVote` (chốt `endedAt`) ->
   * observe -> `decideFinalVote`. Hàm này chỉ làm bước đầu; chỗ gọi phải
   * `beginFinalVote` NGAY sau rồi `observeAll` để `ingestDefenseReview`
   * (đòi `endedAt !== null`) thấy được window ở lần observe sau đó.
   *
   * Ngân sách vòng của ban ngày đã cạn sau thảo luận DAY (cùng `round`), nên
   * mở sổ riêng cho DEFENSE bằng cách xoá `spokenThisRound`: trần chống spam
   * ở đây là cap 2 lượt/bot của vòng này, vẫn đi qua mọi cổng còn lại của
   * `emitSpeech` (chain-limits, scope). Không tick đồng hồ giả trong vòng:
   * mọi câu mang `at` bằng mốc mở cửa sổ, nằm gọn trong
   * `[startedAt, endedAt]` mà `ingestDefenseReview` lọc.
   *
   * Ngữ nghĩa lượt được giữ: trong một lượt, các bot không thấy câu của nhau
   * (chat chung chỉ nhận sau khi hết lượt), đúng như bản inline Task 1.
   */
  const runDefenseDiscussion = (): void => {
    spokenThisRound.clear();
    const accusedId = engine.state.trial?.accusedId;
    if (!accusedId) return;
    const aliveIds = engine.alivePlayers().map((player) => player.id);
    const defenseRng = createSeededRng(`${input.seed}:defense:${engine.state.round}`);
    const slots = planDefenseSpeakers(
      aliveIds,
      accusedId,
      defenseRng,
      DEFENSE_MAX_SPEECHES_PER_BOT,
    );
    const poolSize = aliveIds.includes(accusedId) ? aliveIds.length : aliveIds.length + 1;
    const spokenBy = new Map<string, number>();
    for (let turn = 0; turn < DEFENSE_MAX_SPEECHES_PER_BOT; turn += 1) {
      const turnChat: BotChatObservation[] = [];
      const turnSlots = slots.slice(turn * poolSize, (turn + 1) * poolSize);
      for (const speakerId of turnSlots) {
        if ((spokenBy.get(speakerId) ?? 0) >= DEFENSE_MAX_SPEECHES_PER_BOT) continue;
        const runtime = runtimes.get(speakerId)!;
        const context = contextFor(speakerId);
        runtime.observe(context);
        noteObserved(speakerId, context);
        if (speakerId === accusedId || context.knowledge.selfRole === "JESTER") {
          const defense = runtime.decideDefense(context);
          spokenBy.set(speakerId, (spokenBy.get(speakerId) ?? 0) + 1);
          emitSpeech(speakerId, defense.intention, turnChat);
        } else {
          const verdict = runtime.decideFinalVote(context);
          if (!shouldSpeakInDefense(verdict.confidence)) continue;
          const speech = planDefenseCommentary({
            context,
            guilty: verdict.guilty,
            accusedId,
            confidence: verdict.confidence,
            evidence: verdict.evidence,
            style: runtime.style,
          });
          spokenBy.set(speakerId, (spokenBy.get(speakerId) ?? 0) + 1);
          emitSpeech(speakerId, speech, turnChat);
        }
      }
      if (turnChat.length === 0) break;
      chat.push(...turnChat);
    }
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

  /**
   * Lượt SEE đã rút khiên Alpha, khoá `"${ownerId}:${targetId}"`.
   *
   * Khiên ép lượt SEE đầu lên Sói Alpha về làng, và auditor không biết khiên
   * nên tố cáo oan (xem `GroundTruth.alphaShieldedSeerResults`). Chụp tình
   * trạng khiên trước mỗi lần nộp và đối chiếu sau: khiên rút đồng bộ trong
   * `submitNightAction`, nên "chưa vỡ trước, vỡ sau" là đúng lượt này rút.
   */
  const alphaShieldedSeerResults = new Set<string>();

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
      alphaShieldedSeerResults,
      // Suy từ chính state của engine, không phải một bản ghi chép tay ở
      // harness: ba cờ dưới đều được bật CÙNG LÚC với dòng ghi đè `player.role`,
      // nên chúng không thể lệch khỏi vai. Xem `GroundTruth.roleChangedIds`.
      roleChangedIds: new Set(
        engine.state.players
          .filter(
            (player) =>
              player.cursedTurned || player.traitorTurned || player.doppelgangerTurned,
          )
          .map((player) => player.id),
      ),
    };
  };

  const contextFor = (playerId: string): BotDecisionContext => ({
    // Khi defense TẮT, harness đi thẳng `resolveNomination` -> `beginFinalVote`,
    // KHÔNG chạy pha DEFENSE, nên bị cáo chưa từng được mở miệng. Engine vẫn ghi
    // một cửa sổ bào chữa (dài đúng một tick), và để nguyên thì mọi bị cáo đều bị
    // chấm "im lặng" ở FINAL_VOTE - một tín hiệu mà harness tự bịa ra. Xoá cửa sổ
    // để lõi thấy đúng điều đã xảy ra: không có lượt bào chữa nào.
    //
    // Khi defense BẬT (`defense: true`), vòng speech DEFENSE chạy thật trước
    // `beginFinalVote`, nên giữ nguyên cửa sổ thật của engine để
    // `ingestDefenseReview` chấm được lời trong window ở lần observe sau
    // `beginFinalVote` (đòi `endedAt !== null`).
    knowledge:
      input.defense === true
        ? { ...engine.botKnowledgeFor(playerId) }
        : { ...engine.botKnowledgeFor(playerId), trialDefense: null },
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
      noteObserved(player.id, context);
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
    castAt: number,
  ): void => {
    const targetId = vote.choice.type === "PLAYER" ? vote.choice.targetId ?? null : null;
    const previous = engine.state.votes[playerId];
    if (previous !== undefined && previous === targetId) return;

    try {
      engine.submitVote(playerId, targetId, castAt);
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

  /**
   * Bước đồng hồ giả cho MỘT người trong MỘT lượt bỏ phiếu.
   *
   * Trước dòng này mọi lá phiếu dùng `tick(10)`, nên cả pha bỏ phiếu 15-120
   * giây gói gọn trong 0.2 giây đồng hồ giả: `elapsedRatio` ra ~0.001 trong khi
   * `voteHistory.lateSwitchRatio` là 0.8. Hệ quả là 25% số phiếu là phiếu ĐỔI
   * mà chưa lá nào trong lịch sử self-play bị tính là đổi muộn - `LATE_SWITCH`
   * chưa từng chạy trong một ván đo nào.
   *
   * Chia NỬA pha cho số người còn sống, và tiêu một bước cho MỖI người - kể cả
   * người giữ nguyên phiếu. Tính bước theo lá phiếu thật sự nộp thì lượt cân
   * nhắc lại (chỉ ~1/4 số người đổi ý) co lại vào đầu nửa sau và vẫn không
   * chạm tới phần đuôi.
   *
   * ponytail: người đi sau trong danh sách ghế luôn bỏ phiếu muộn hơn người đi
   * trước, nên trong MỘT ván thì ai bị gắn nhãn "đổi muộn" là do thứ tự ghế.
   * Ghế được xáo theo `${seed}:setup` nên nó không dồn về một người qua nhiều
   * ván. Cần đúng hơn thì rải offset theo `roundRng` thay vì theo thứ tự.
   */
  const voteStepMs = (): number =>
    Math.max(
      1,
      Math.floor((config.voteSeconds * 1_000) / 2 / Math.max(1, engine.alivePlayers().length)),
    );

  /**
   * Phù Thuỷ còn bình độc mà đêm nay không dùng: ghi lại cô ta đang nghi ai
   * nhất và ngưỡng là bao nhiêu. Chỉ đọc state của chính cô ta - đúng thứ mà
   * trace cũng đọc - nên không có rò rỉ nào ở đây.
   */
  const recordWitchHold = (
    witchId: string,
    context: BotDecisionContext,
    action: NightActionKind | null,
  ): void => {
    const night = context.knowledge.night;
    if (!night || !night.legalActions.includes("POISON") || action === "POISON") return;
    const state = runtimes.get(witchId)!.state;
    const threshold = witchPoisonThreshold(context.knowledge, weights);
    let topSuspectId: string | null = null;
    let topSuspicion = 0;
    let vetoedByTrust = false;
    for (const targetId of [...night.legalTargets.POISON].sort()) {
      if (targetId === witchId) continue;
      const score = state.suspicion[targetId]?.score ?? 0;
      if (topSuspectId === null || score > topSuspicion) {
        topSuspectId = targetId;
        topSuspicion = score;
      }
      if (
        score >= threshold &&
        (state.trust[targetId]?.score ?? 0) >= weights.roleThresholds.witchPoisonTrustVeto
      ) {
        vetoedByTrust = true;
      }
    }
    log.push({
      kind: "WITCH_HOLD",
      round: engine.state.round,
      actorId: witchId,
      topSuspectId,
      topSuspicion,
      threshold,
      vetoedByTrust,
    });
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

      // Khiên Alpha rút NGAY trong `submitNightAction` (kết quả soi hiện ra
      // trong snapshot của chính lần nộp), nên phải chụp tình trạng khiên
      // TRƯỚC khi nộp rồi mới biết lượt này có rút khiên không. Đọc sau khi
      // nộp thì khiên đã vỡ và mọi lượt soi lên Alpha đều trông như "đã có
      // người rút trước" - đúng lỗi mà bản đầu của hook này mắc phải.
      const seeConsumesAlphaShield =
        decision.action === "SEE" &&
        decision.targetId &&
        engine.state.players.find((p) => p.id === decision.targetId)?.role === "ALPHA_WOLF" &&
        !engine.state.alphaShieldUsed[decision.targetId];
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
        // Khiên Alpha: lượt SEE này vừa rút khiên và bị ép về làng trong
        // chính lần nộp. Chỉ mục tiêu chính (khiên không đè lên mục tiêu
        // phụ của Màn Sương Tan). Khoá thừa vô hại (kết quả đúng không bao
        // giờ chạm phép so với sự thật), khoá thiếu thì thành báo động giả.
        if (seeConsumesAlphaShield && decision.targetId) {
          alphaShieldedSeerResults.add(`${player.id}:${decision.targetId}`);
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
        recordWitchHold(witch.id, context, decision?.action ?? null);
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
    // Lượt đầu rải trên NỬA ĐẦU của pha, lượt cân nhắc lại trên nửa sau.
    const firstPassStep = voteStepMs();
    for (const player of engine.alivePlayers()) {
      const runtime = runtimes.get(player.id)!;
      const context = contextFor(player.id);
      const before = engine.state.votes[player.id];
      const vote = runtime.decideVote(context);
      void before;

      castVote(player.id, vote, tick(firstPassStep));
      lastVote.set(player.id, vote);

      if (!record.speech) continue;
      if (!hasBudget(player.id)) continue;

      // Chụp nước đi TRƯỚC khi sinh lời nói, rồi so lại sau khi render.
      //
      // Đây là bất biến trung tâm của cả hai phase trước: provider chỉ diễn đạt,
      // không quyết định. Kiểm nó bằng cách so sánh chứ không bằng cách tin vào
      // chữ ký hàm - một `readonly` trong TypeScript biến mất lúc chạy.
      const sealed = JSON.stringify(vote.choice);
      noteSpeechTurn(player.id);
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
        noteObserved(player.id, context);

        const sealed = JSON.stringify(ballot.choice);
        noteSpeechTurn(player.id);
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
    const secondPassStep = voteStepMs();
    for (const player of engine.alivePlayers()) {
      const runtime = runtimes.get(player.id)!;
      const context = contextFor(player.id);
      runtime.observe(context);
      noteObserved(player.id, context);
      castVote(player.id, runtime.decideVote(context), tick(secondPassStep));
    }
    // Mọi người sống đã đọc hết chat của vòng: đủ bằng chứng để chốt số phận
    // từng câu hỏi. Trigger chỉ sống một vòng (`triggerFreshnessRounds`), nên
    // không câu nào còn được đáp ở vòng sau.
    settleQuestions();

    const outcome = engine.resolveNomination(config.defenseSeconds * 1_000, tick(1_000));
    log.push({
      kind: "NOMINATION",
      round: engine.state.round,
      accusedId: outcome.kind === "TRIAL" ? outcome.accusedId : null,
    });

    if (outcome.kind === "TRIAL") {
      // `defense: true` mà `speech` tắt: vòng speech bỏ qua nhưng cửa sổ
      // DEFENSE vẫn thật (không null) và ingest chấm window rỗng — chủ đích,
      // để đo được riêng ảnh hưởng của "có cửa sổ" khỏi "có lời nói".
      if (input.defense === true && record.speech) {
        runDefenseDiscussion();
      }
      engine.beginFinalVote(config.finalVoteSeconds * 1_000, tick(1_000));
      if (input.defense === true) {
        const trial = engine.state.trial;
        log.push({
          kind: "DEFENSE_WINDOW",
          round: engine.state.round,
          accusedId: outcome.accusedId,
          startedAt: trial?.defenseStartedAt ?? now,
          endedAt: trial?.defenseEndedAt ?? now,
        });
      }
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

  // Ván đo DEFENSE không chạy vai trung lập: preset đo đã tắt cả ba, lọt vào
  // đây là leak cấu hình phải fail-fast thay vì cho ra số lẫn vai. Chỉ áp khi
  // `defense: true` để hành vi cũ (test Hề/Sát Nhân/Báo Thù chạy không cờ)
  // giữ nguyên byte-for-byte.
  if (input.defense === true) {
    for (const player of engine.state.players) {
      if (
        player.role === "JESTER" ||
        player.role === "SERIAL_KILLER" ||
        player.role === "EXECUTIONER"
      ) {
        throw new Error(`neutral leak trong van do: ${player.role} (${player.id})`);
      }
    }
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
    // Bản SAO, không phải tham chiếu sống vào state của engine - cùng lý do
    // với mọi thứ khác đi ra khỏi một ván đã kết thúc.
    personalWins: engine.personalWins().map((win) => ({ ...win })),
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
    /*
     * Đứng NGAY TRƯỚC khi ván được chốt, đúng vị trí mà `checkWinOrContinue`
     * bên server đặt nó: đợt chết và chuỗi Thợ Săn đi kèm đã xử xong.
     *
     * Thứ tự bên trong `settleAndCheckWin` nằm ở engine chứ không chép lại ở
     * đây - đó chính là chỗ hai bản chép tay đã lệch nhau một lần.
     */
    const winner = engine.settleAndCheckWin();

    if (!winner) return false;
    engine.finishGame(winner, tick(1_000));
    return true;
  }
}

/** Dựng lại CHÍNH XÁC một ván từ record của nó, không cần batch. */
export function replayGame(
  record: SelfPlayRecord,
  weights?: BotWeights,
  learnedPolicy?: LearnedPolicy,
): SelfPlayGame {
  if (weights && weights.version !== record.weightsVersion) {
    throw new Error(
      `Record cần trọng số phiên bản "${record.weightsVersion}" nhưng nhận "${weights.version}"`,
    );
  }
  // Cùng luật với `weightsVersion`: dựng lại một ván bằng một policy KHÁC cho
  // ra một ván khác, và một ván khác mang tên seed cũ là thứ tệ hơn một lỗi.
  if (record.learnedPolicyId !== undefined) {
    if (!learnedPolicy) {
      throw new Error(
        `Record cần learnedPolicy "${record.learnedPolicyId}" nhưng không được cấp`,
      );
    }
    if (learnedPolicy.id !== record.learnedPolicyId) {
      throw new Error(
        `Record cần learnedPolicy "${record.learnedPolicyId}" nhưng nhận "${learnedPolicy.id}"`,
      );
    }
  }
  return runSelfPlay({
    seed: record.seed,
    playerCount: record.playerCount,
    config: record.config,
    weights,
    maxRounds: record.maxRounds,
    events: record.events,
    speech: record.speech,
    defense: record.defense,
    humanSeats: record.humanSeats,
    learnedPolicy,
    learnedSeats: record.learnedSeats,
    learnedTemperature: record.learnedTemperature,
    learnedDecisions: record.learnedDecisions,
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
  if (record.defense) flags.push("--defense");
  if ((record.humanSeats ?? 0) > 0) flags.push(`--humans ${record.humanSeats}`);
  return `npm run selfplay -- ${flags.join(" ")}`;
}
