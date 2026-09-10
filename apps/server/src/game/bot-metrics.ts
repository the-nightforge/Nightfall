import {
  DEFAULT_BOT_WEIGHTS,
  collectMetrics,
  type BotWeights,
  type QuestionOutcome,
  type Ratio,
  type SelfPlayGame,
  type SelfPlayMetrics,
} from "@masoi/game-engine";
import type { Role, RoomConfig, Winner } from "@masoi/shared";
import { botBrain } from "../bots";
import { botSessionFor } from "../bots/session-registry";
import type { Room } from "../rooms/store";
import type { BotSpeechLogEvent } from "./bot-speech-log";

/**
 * Chỉ số giao tiếp của bot trong MỘT ván thật, tính lúc kết thúc bằng chính
 * `collectMetrics` của self-play. Một định nghĩa duy nhất: không chỉ số nào
 * ở đây được đếm lại bằng tay.
 *
 * Không chứa một chữ nào - không nội dung chat, không tên, không id người chơi.
 * Có test quét JSON để khoá điều đó.
 */

/** Tăng khi danh sách hay định nghĩa đổi; script cộng dồn chỉ cộng cùng phiên bản. */
export const BOT_METRICS_VERSION = 1;

/**
 * Các tỉ lệ được lưu. Chỉ những chỉ số tính thuần từ `SPEECH`,
 * `SPEECH_BLOCKED` và `QUESTION_OUTCOME` - ba loại sự kiện server ghi. Chỉ số
 * đọc lá phiếu (`claimFollowRate`, `claimAccuracy`, `wolfBluffBelievedRate`) và
 * `silenceRate` (cần danh sách bot còn sống từng vòng) cố ý vắng mặt.
 */
export const RATIO_KEYS = [
  "fromTemplateRate",
  "casualToneRate",
  "casualToneRateProvider",
  "exactRepetitionRate",
  "normalizedRepetitionRate",
  "semanticRepetitionRate",
  "crossBotRepetitionRate",
  "repeatedOpeningRate",
  "distinctOpeningRate",
  "consecutiveSameTargetRate",
  "replyRate",
  "directQuestionResponseRate",
  "counterClaimRate",
] as const satisfies readonly (keyof SelfPlayMetrics)[];

export type BotMetricsRatioKey = (typeof RATIO_KEYS)[number];

export interface BotMetrics {
  metricsVersion: number;
  weightsVersion: string;
  /** `botBrain().name`: tên nhà cung cấp, chuỗi `"a->b"`, hoặc tên randomBrain khi không có nhà cung cấp nào. */
  brain: string;
  players: number;
  bots: number;
  rounds: number;
  truncated: boolean;
  recorderErrors: number;
  /** `[tử số, mẫu số]`. */
  ratios: Record<BotMetricsRatioKey, [number, number]>;
  /** Số đếm thô của bảy ngăn; mẫu số là tổng các ngăn. */
  questionOutcomes: {
    bot: Record<QuestionOutcome, number>;
    human: Record<QuestionOutcome, number>;
  };
  blocked: Record<string, number>;
  /** `[tổng số câu, số cặp (vòng, bot) có nói]` - đủ để tính `messagesPerBotPerDay` sau khi cộng dồn. */
  botDays: [number, number];
  maxChain: number;
  claims: number;
  hadCounterClaim: boolean;
}

export interface BotMetricsInput {
  events: readonly BotSpeechLogEvent[];
  roles: Record<string, Role>;
  winner: Winner;
  rounds: number;
  personalWins?: SelfPlayGame["personalWins"];
  players: number;
  bots: number;
  weights: BotWeights;
  brain: string;
  truncated: boolean;
  recorderErrors: number;
  config: RoomConfig;
}

const pair = (ratio: Ratio): [number, number] => [ratio.numerator, ratio.denominator];

const counts = (table: Record<QuestionOutcome, Ratio>): Record<QuestionOutcome, number> =>
  Object.fromEntries(
    Object.entries(table).map(([key, ratio]) => [key, ratio.numerator]),
  ) as Record<QuestionOutcome, number>;

/** THUẦN: cùng đầu vào cho cùng kết quả. Ném nếu sổ méo - chỗ gọi bắt. */
export function buildBotMetrics(input: BotMetricsInput): BotMetrics {
  // `SelfPlayGame` tối thiểu: `collectMetrics` chỉ đọc events, roles, winner,
  // rounds, personalWins, rejected, skipped, violations. Các trường chỉ
  // self-play có thì để rỗng; `record` không được đọc.
  const game: SelfPlayGame = {
    record: {
      seed: "production",
      playerCount: input.players,
      config: input.config,
      weightsVersion: input.weights.version,
      maxRounds: input.rounds,
      events: false,
      speech: true,
    },
    winner: input.winner,
    rounds: input.rounds,
    actions: 0,
    rejected: 0,
    skipped: 0,
    events: [...input.events],
    violations: [],
    traces: [],
    roles: input.roles,
    personalWins: input.personalWins,
  };
  const m = collectMetrics([game], input.weights).overall;

  const lines = m.fromTemplateRate.denominator;
  const perBotDay = m.messagesPerBotPerDay;

  return {
    metricsVersion: BOT_METRICS_VERSION,
    weightsVersion: input.weights.version,
    brain: input.brain,
    players: input.players,
    bots: input.bots,
    rounds: input.rounds,
    truncated: input.truncated,
    recorderErrors: input.recorderErrors,
    ratios: Object.fromEntries(RATIO_KEYS.map((key) => [key, pair(m[key])])) as BotMetrics["ratios"],
    questionOutcomes: {
      bot: counts(m.directQuestionOutcomes),
      human: counts(m.humanQuestionOutcomes),
    },
    blocked: { ...m.speechBlockedByRoom },
    // `messagesPerBotPerDay` là trung bình. Suy ngược số cặp (vòng, bot) từ
    // chính output để cộng dồn đúng qua nhiều ván mà không đếm lại lần hai.
    botDays: perBotDay === null || perBotDay === 0 ? [0, 0] : [lines, Math.round(lines / perBotDay)],
    maxChain: m.maxDialogueChainLength,
    claims: m.claimsPerGame ?? 0,
    hadCounterClaim: m.counterClaimRate.numerator > 0,
  };
}

/**
 * `null` khi không có gì để đo: ván chưa xong, ván không có bot, hoặc ván không
 * có sổ từ đầu (envelope ghi trước khi có sổ - một sổ chỉ có nửa sau cho số sai
 * mà trông như đúng).
 */
export function botMetricsForRoom(room: Room): BotMetrics | null {
  const state = room.engine?.getState();
  if (!state || !state.winner || !room.speechLog) return null;
  const bots = room.members.filter((member) => member.isBot);
  if (bots.length === 0) return null;

  let weights: BotWeights = DEFAULT_BOT_WEIGHTS;
  try {
    weights = botSessionFor(room).runtimeFor(bots[0]!.playerId).weights;
  } catch {
    // Session đã bị dọn (hiếm): đo bằng mặc định, `weightsVersion` nói rõ điều đó.
  }

  return buildBotMetrics({
    events: room.speechLog,
    roles: Object.fromEntries(state.players.map((player) => [player.id, player.role])),
    winner: state.winner,
    rounds: state.round,
    personalWins: state.personalWins,
    players: state.players.length,
    bots: bots.length,
    weights,
    brain: botBrain().name,
    truncated: room.botSpeechLogTruncated ?? false,
    recorderErrors: room.recorderErrors ?? 0,
    config: room.config,
  });
}
