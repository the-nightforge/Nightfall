import { z } from "zod";
import { CHAT_CHANNELS, PHASES, ROLES, roomConfigSchema } from "@masoi/shared";
import type {
  ChatMessage,
  DayVoteRecap,
  GameEventView,
  GamePhase,
  HunterShotRecap,
  NightRecap,
  PublicVoteChoice,
  Role,
  RoomConfig,
  VoteMutation,
  Winner,
} from "@masoi/shared";
import type { GameState } from "@masoi/game-engine";
import type {
  BotBrainState,
  BotEvidence,
  BotMemory,
  BotSpeechRecord,
  SocialEdge,
} from "@masoi/game-engine";
import type { PendingStep } from "../game/pending-step";
import type { PersistedBotSession } from "../bots/session-registry";
import type { PersistedDiscussionRun } from "../game/discussion-scheduler";
import type { RoomMember, RoomStatus } from "../rooms/store";

/**
 * Phiên bản của ĐỊNH DẠNG snapshot, không phải của game.
 *
 * Tăng khi hình dạng dữ liệu đổi theo kiểu không đọc ngược được. Snapshot mang
 * số khác số này không bao giờ được đoán nghĩa: nó bị cách ly và người chơi
 * được báo rõ, vì một ván bị đoán sai còn tệ hơn một ván mất hẳn.
 */
export const PERSISTENCE_VERSION = 1;

/**
 * Độ sâu validation, cố ý KHÔNG đồng đều:
 *
 *  - STRICT ở phần MANG QUYẾT ĐỊNH (pha, vòng, hạn chót, người chơi, phiếu,
 *    đêm, phiên toà, bước chờ, con trỏ RNG, khung brain): một giá trị rác ở
 *    đây làm máy trạng thái xử sai luật.
 *  - CẤU TRÚC ở phần HIỂN THỊ/LỊCH SỬ (recap đêm, lịch sử vote, lịch sử sự
 *    kiện, `reasons` của belief): một entry méo cùng lắm làm bảng tổng kết xấu.
 *    Một zod mirror đầy đủ cho chúng sẽ trôi lệch khỏi type nhanh hơn là bắt
 *    được lỗi thật.
 *
 * Chống trôi lệch bằng các phép kiểm tra gán ở CUỐI file: `tsc` hỏng ngay khi
 * ai đó thêm field vào `GameState` hay `BotBrainState` mà quên schema.
 */
const objectOf = <T>(): z.ZodType<T> =>
  z.custom<T>((value) => typeof value === "object" && value !== null);

const oneOf = <T extends string>(values: readonly string[]): z.ZodType<T> =>
  z.custom<T>((value) => typeof value === "string" && values.includes(value));

const gamePhaseSchema = oneOf<GamePhase>(PHASES.filter((phase) => phase !== "LOBBY"));
const roleSchema = oneOf<Role>(ROLES);
const winnerSchema = z.union([
  z.literal("wolves"),
  z.literal("village"),
  z.null(),
]) as z.ZodType<Winner>;

/**
 * `null` là một lá phiếu THẬT ("không treo ai"), khác hẳn key vắng mặt ("chưa
 * bỏ phiếu"). Schema phải giữ đủ ba trạng thái đó, nếu không thì một lần nạp
 * lại sẽ biến một quyết định thành một sự im lặng.
 */
const voteRecordSchema = z.record(z.string(), z.string().nullable());

const enginePlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: roleSchema,
  alive: z.boolean(),
  isBot: z.boolean(),
  cursedTurned: z.boolean().optional(),
});

const nightStateSchema = z.object({
  wolfVotes: voteRecordSchema,
  killTarget: z.string().nullable(),
  wolfSecondaryTarget: z.string().nullable(),
  wolfCubRageTonight: z.boolean(),
  wolvesLocked: z.boolean(),
  guardTarget: z.string().nullable(),
  guardianAngelTarget: z.string().nullable(),
  healTonight: z.boolean(),
  poisonTarget: z.string().nullable(),
  witchSkipped: z.boolean(),
  seerResults: z.record(
    z.string(),
    z.object({
      targetId: z.string(),
      isWolf: z.boolean(),
      secondaryTargetId: z.string().optional(),
      secondaryIsWolf: z.boolean().optional(),
      unknown: z.boolean().optional(),
    }),
  ),
  priestTarget: z.string().nullable(),
  priestSkipped: z.boolean(),
  detectiveTargets: z.object({ target1: z.string(), target2: z.string() }).nullable(),
  detectiveResults: z.record(
    z.string(),
    z.object({
      target1Id: z.string(),
      target2Id: z.string(),
      sameTeam: z.boolean(),
      unknown: z.boolean().optional(),
    }),
  ),
  priestResults: z.record(z.string(), z.object({ targetId: z.string(), isWolf: z.boolean() })),
});

const publicDeathSchema = z.object({ playerId: z.string(), name: z.string() });

export const gameStateSchema = z.object({
  phase: gamePhaseSchema,
  round: z.number().int().min(0),
  phaseEndsAt: z.number().nullable(),
  phaseStartedAt: z.number(),
  players: z.array(enginePlayerSchema),
  config: roomConfigSchema as unknown as z.ZodType<RoomConfig>,
  winner: winnerSchema,
  night: nightStateSchema,
  votes: voteRecordSchema,
  voteMutations: z.array(objectOf<VoteMutation>()),
  dayVoteHistory: z.array(objectOf<DayVoteRecap>()),
  guardPrevious: z.string().nullable(),
  guardianAngelPrevious: z.string().nullable(),
  guardianAngelCharges: z.record(z.string(), z.number()),
  priestHolyWaterUsed: z.record(z.string(), z.boolean()),
  apprenticeAwakened: z.boolean(),
  wolfCubRageNextNight: z.boolean(),
  healUsed: z.boolean(),
  poisonUsed: z.boolean(),
  lastNightDeaths: z.array(publicDeathSchema),
  nightHistory: z.array(objectOf<NightRecap>()),
  lastEliminated: publicDeathSchema.nullable(),
  trial: z
    .object({ accusedId: z.string(), finalVotes: z.record(z.string(), z.boolean()) })
    .nullable(),
  lastTrial: z
    .object({
      accused: z.object({ id: z.string(), name: z.string() }),
      guilty: z.number(),
      innocent: z.number(),
      abstain: z.number(),
      lynched: z.boolean(),
    })
    .nullable(),
  hunterReaction: z
    .object({
      hunterId: z.string(),
      source: z.union([z.literal("night"), z.literal("vote")]),
      resolved: z.boolean(),
    })
    .nullable(),
  hunterShots: z.array(objectOf<HunterShotRecap>()),
  activeEvent: objectOf<GameEventView>().nullable(),
  eventHistory: z.array(objectOf<GameEventView>()),
  log: z.array(z.string()),
  pendingLastStandVictim: z.object({ playerId: z.string(), dieRound: z.number() }).nullable(),
  bloodMoonArmed: z.boolean(),
  bloodMoonUsed: z.boolean(),
  deadCanSpeakUsed: z.boolean(),
  deadCanSpeakChosenId: z.string().nullable(),
  howlBonusDay: z.number().nullable(),
  dayOfTruthClaims: z.record(z.string(), z.string().nullable()),
});

// ---- Brain của BOT ----

const personalitySchema = z.object({
  aggressiveness: z.number(),
  talkativeness: z.number(),
  riskTolerance: z.number(),
  deceptionSkill: z.number(),
  analyticalSkill: z.number(),
  loyalty: z.number(),
  stubbornness: z.number(),
});

const beliefEntrySchema = z.object({
  score: z.number(),
  reasons: z.array(objectOf<BotEvidence>()),
  lastUpdatedRound: z.number(),
});

type NightActionKind = BotBrainState["previousNightActions"][number]["action"];

export const botBrainStateSchema = z.object({
  playerId: z.string(),
  personality: personalitySchema,
  suspicion: z.record(z.string(), beliefEntrySchema),
  trust: z.record(z.string(), beliefEntrySchema),
  knownInformation: z.object({
    knownRoles: z.record(z.string(), roleSchema),
    seerResults: z.array(objectOf<BotMemory>()),
  }),
  claims: z.array(objectOf<BotMemory>()),
  myClaim: z.object({ role: roleSchema, round: z.number() }).nullable(),
  memories: z.array(objectOf<BotMemory>()),
  relationships: z.record(z.string(), objectOf<SocialEdge>()),
  currentTheory: z.object({ summary: z.string(), evidenceIds: z.array(z.string()) }).nullable(),
  currentTargets: z.array(z.string()),
  confidence: z.number(),
  previousVotes: z.array(z.object({ round: z.number(), choice: objectOf<PublicVoteChoice>() })),
  previousNightActions: z.array(
    z.object({
      round: z.number(),
      action: oneOf<NightActionKind>([
        "KILL",
        "SEE",
        "GUARD",
        "HEAL",
        "POISON",
        "SKIP",
        "DETECTIVE_CHECK",
        "GUARDIAN_PROTECT",
        "PRIEST_BLESS",
      ]),
      targetId: z.string().nullable(),
    }),
  ),
  speechMemory: z.array(objectOf<BotSpeechRecord>()),
  speechSequence: z.number(),
  repliedMessageIds: z.array(z.string()),
  seenEventIds: z.array(z.string()),
  appliedClaimEvidenceIds: z.array(z.string()),
});

const botSessionSchema = z.object({
  seed: z.string(),
  playerIds: z.array(z.string()),
  brains: z.record(
    z.string(),
    z.object({ state: botBrainStateSchema, lastDecayRound: z.number() }),
  ),
  // Con trỏ là SỐ LẦN ĐÃ GỌI: âm hoặc không nguyên nghĩa là dữ liệu đã hỏng, và
  // tua tới một vị trí vô nghĩa cho ra một dòng số không ai tái lập được.
  cursors: z.record(z.string(), z.number().int().min(0)),
});

// ---- Phòng ----

const memberSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  ready: z.boolean(),
  connected: z.boolean(),
  disconnectedAt: z.number().nullable().optional(),
  isBot: z.boolean(),
  avatarUrl: z.string().nullable().optional(),
});

const chatMessageSchema = z.object({
  id: z.string(),
  channel: oneOf<ChatMessage["channel"]>(CHAT_CHANNELS),
  playerId: z.string(),
  playerName: z.string(),
  text: z.string(),
  at: z.number(),
});

const pendingStepSchema = z.object({
  name: oneOf<PendingStep["name"]>([
    "beginNight",
    "lockWolves",
    "endNight",
    "beginVoting",
    "endVoting",
    "beginFinalVote",
    "endFinalVote",
    "afterDeathResult",
    "timeoutHunterShot",
    "finishHunterShot",
  ]),
  token: z.string(),
  runAt: z.number(),
  source: z.union([z.literal("night"), z.literal("vote")]).optional(),
});

const discussionRunSchema = z.object({
  round: z.number(),
  phaseEndsAt: z.number().nullable(),
  total: z.number().int().min(0),
  lastAt: z.number(),
  spoken: z.record(z.string(), z.number()),
  lastSpokenAt: z.record(z.string(), z.number()),
  messageDepths: z.record(z.string(), z.number()),
  replyCounts: z.record(z.string(), z.number()),
});

const persistedRoomSchema = z.object({
  code: z.string(),
  hostId: z.string().nullable(),
  status: oneOf<RoomStatus>(["LOBBY", "IN_GAME"]),
  members: z.array(memberSchema),
  config: roomConfigSchema as unknown as z.ZodType<RoomConfig>,
  chatLog: z.array(chatMessageSchema),
  createdAt: z.number(),
  engineState: gameStateSchema.nullable(),
  gameId: z.string().nullable(),
  resultWritten: z.boolean(),
  pendingStep: pendingStepSchema.nullable(),
  phaseSeq: z.number().int().min(0),
  botSession: botSessionSchema.nullable(),
  governorCalls: z.number().int().min(0),
  discussionSkipVotes: z.array(z.string()),
  discussionRun: discussionRunSchema.nullable(),
});

export const roomEnvelopeSchema = z.object({
  persistenceVersion: z.literal(PERSISTENCE_VERSION),
  savedAt: z.number(),
  // Số thứ tự lần ghi. Cơ sở của compare-and-set: một lời ghi về muộn mang số
  // nhỏ hơn bản đang nằm trong Redis phải bị bỏ chứ không được đè.
  opSeq: z.number().int().min(0),
  room: persistedRoomSchema,
});

export type RoomEnvelopeV1 = z.infer<typeof roomEnvelopeSchema>;
export type PersistedRoom = z.infer<typeof persistedRoomSchema>;

// ---- Chống trôi lệch giữa schema và type ----
//
// Hai chiều là bắt buộc: một chiều bắt field THIẾU, chiều kia bắt field THỪA và
// sai kiểu. `tsc` hỏng ngay khi engine đổi hình dạng mà schema chưa theo kịp -
// rẻ hơn nhiều so với việc phát hiện lúc một ván thật không khôi phục được.
type Assignable<A, B> = [A] extends [B] ? true : never;

const _stateForward: Assignable<GameState, z.infer<typeof gameStateSchema>> = true;
const _stateBackward: Assignable<z.infer<typeof gameStateSchema>, GameState> = true;
const _brainForward: Assignable<BotBrainState, z.infer<typeof botBrainStateSchema>> = true;
const _brainBackward: Assignable<z.infer<typeof botBrainStateSchema>, BotBrainState> = true;
const _sessionForward: Assignable<PersistedBotSession, z.infer<typeof botSessionSchema>> = true;
const _sessionBackward: Assignable<z.infer<typeof botSessionSchema>, PersistedBotSession> = true;
const _stepForward: Assignable<PendingStep, z.infer<typeof pendingStepSchema>> = true;
const _stepBackward: Assignable<z.infer<typeof pendingStepSchema>, PendingStep> = true;
const _runForward: Assignable<PersistedDiscussionRun, z.infer<typeof discussionRunSchema>> = true;
const _runBackward: Assignable<z.infer<typeof discussionRunSchema>, PersistedDiscussionRun> = true;
const _memberForward: Assignable<RoomMember, z.infer<typeof memberSchema>> = true;
const _memberBackward: Assignable<z.infer<typeof memberSchema>, RoomMember> = true;

void _stateForward;
void _stateBackward;
void _brainForward;
void _brainBackward;
void _sessionForward;
void _sessionBackward;
void _stepForward;
void _stepBackward;
void _runForward;
void _runBackward;
void _memberForward;
void _memberBackward;
