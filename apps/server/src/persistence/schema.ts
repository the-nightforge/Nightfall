import { z } from "zod";
import {
  CHAT_CHANNELS,
  PERSONAL_WIN_CONDITIONS,
  PHASES,
  ROLES,
  WINNERS,
  roomConfigSchema,
} from "@masoi/shared";
import type {
  ChatMessage,
  DayVoteRecap,
  GameEventView,
  GamePhase,
  HunterShotRecap,
  NightRecap,
  PersonalWin,
  PublicVoteChoice,
  Role,
  RoomConfig,
  Team,
  VoteMutation,
  Winner,
} from "@masoi/shared";
import type { GameState } from "@masoi/game-engine";
import type {
  BotBrainState,
  BotEvidence,
  BotMemory,
  BotSpeechRecord,
  PlayerProfile,
  SocialEdge,
} from "@masoi/game-engine";
import type { LastLetterRoomState } from "../game/last-letter";
import type { ArchivedChatMessage } from "../game/match-chat";
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
/**
 * Vai lạ RƠI VỀ Dân Làng thay vì làm cả snapshot trượt schema: ván đang chạy
 * lúc deploy bản xóa vai (Linh Mục/Bà Đồng) vẫn mang vai cũ trong `players`,
 * `personalWins`, `knownRoles` và `myClaim`. Ném ở đây là đưa cả phòng vào
 * `quarantine` trước cả khi guard VILLAGER của engine kịp chạy - guard đó giữ
 * nguyên như một lớp dự phòng.
 */
const roleSchema = oneOf<Role>(ROLES).catch("VILLAGER");
const teamSchema = oneOf<Team>(["wolves", "village", "neutral"]);
const personalWinConditionSchema = oneOf<PersonalWin["condition"]>(PERSONAL_WIN_CONDITIONS);
/**
 * Suy từ `WINNERS` chứ không chép tay bốn literal: một kết cục mới thêm vào
 * shared mà quên ở đây sẽ làm mọi ván đang chạy trượt schema rồi bị cách ly,
 * và nó chỉ lộ ra lúc một ván THẬT kết thúc đúng kiểu đó.
 */
const winnerSchema = z.union([oneOf<Exclude<Winner, null>>(WINNERS), z.null()]) as z.ZodType<Winner>;
/**
 * Config đọc từ SNAPSHOT nuốt key lạ thay vì trượt schema: phòng custom ghi
 * trước bản xóa vai còn mang `priest`/`medium`, mà `roomConfigSchema` là
 * `.strict()` - đúng cho payload socket, input sống phải bị từ chối thẳng.
 * Strict ở tầng này là đưa cả phòng vào `quarantine` ngay lúc LOAD, trước cả
 * khi `validateRoomConfig` kịp nhìn nó. Key lạ bị lược, và host chỉnh lại bộ
 * bài ở lần mở ván tiếp theo nếu số ghế lệch.
 */
const storedRoomConfigSchema = roomConfigSchema.strip() as unknown as z.ZodType<RoomConfig>;

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
  // OPTIONAL vì cùng lý do với `cursedTurned` ngay trên.
  doppelgangerTurned: z.boolean().optional(),
  // OPTIONAL vì cùng lý do với `cursedTurned` ngay trên: bắt buộc một trường
  // thêm sau là làm mọi snapshot đã ghi trước bản này trượt schema rồi rơi vào
  // `quarantine`. Constructor của engine chuẩn hoá về `false`.
  executionerTurned: z.boolean().optional(),
});

const nightStateSchema = z.object({
  wolfVotes: voteRecordSchema,
  killTarget: z.string().nullable(),
  wolfSecondaryTarget: z.string().nullable(),
  wolfCubRageTonight: z.boolean(),
  wolvesLocked: z.boolean(),
  guardTarget: z.string().nullable(),
  guardSecondTarget: z.string().nullable().optional(),
  guardianAngelTarget: z.string().nullable(),
  healTonight: z.boolean(),
  poisonTarget: z.string().nullable(),
  witchSkipped: z.boolean(),
  seerResults: z.record(
    z.string(),
    z.object({
      targetId: z.string(),
      isWolf: z.boolean(),
      // OPTIONAL vì đây là trường thêm sau: kết quả soi ghi trước bản này chỉ
      // có `isWolf`, và bắt buộc `team` sẽ làm mọi ván đang chạy trượt schema
      // ngay lúc deploy. Engine rơi về `isWolf` khi thiếu nó.
      team: teamSchema.optional(),
      secondaryTargetId: z.string().optional(),
      secondaryIsWolf: z.boolean().optional(),
      secondaryTeam: teamSchema.optional(),
      unknown: z.boolean().optional(),
    }),
  ),
  // `.default({})` chứ không phải bắt buộc: ảnh ghi trước bản có Sói Pháp Sư
  // thiếu key này, và bắt buộc ở đây là giết ván đang chạy ngay lúc deploy.
  // Output vẫn required nên phép kiểm Assignable với engine không vỡ; engine
  // `??=` + guard chuẩn hoá tiếp sau khi đọc.
  sorcererResults: z.record(z.string(), z.object({ targetId: z.string(), isSeerLine: z.boolean() })).default({}),
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
  // OPTIONAL vì đây là hai trường thêm sau. Bắt buộc chúng là mọi snapshot đã
  // ghi trước bản này trượt schema rồi rơi vào `quarantine` - tức giết sạch các
  // ván đang chạy ngay lúc deploy. Constructor của engine chuẩn hoá về
  // `null`/`false`, đúng trạng thái mà một ván không có Sát Nhân đang ở.
  serialKillerTarget: z.string().nullable().optional(),
  serialKillerSkipped: z.boolean().optional(),
});

const publicDeathSchema = z.object({ playerId: z.string(), name: z.string() });

export const gameStateSchema = z.object({
  phase: gamePhaseSchema,
  round: z.number().int().min(0),
  phaseEndsAt: z.number().nullable(),
  phaseStartedAt: z.number(),
  players: z.array(enginePlayerSchema),
  config: storedRoomConfigSchema,
  winner: winnerSchema,
  night: nightStateSchema,
  votes: voteRecordSchema,
  voteMutations: z.array(objectOf<VoteMutation>()),
  dayVoteHistory: z.array(objectOf<DayVoteRecap>()),
  guardPrevious: z.string().nullable(),
  guardSecondPrevious: z.string().nullable().optional(),
  guardianAngelPrevious: z.string().nullable(),
  guardianAngelCharges: z.record(z.string(), z.number()),
  // `.default({})` cùng lý do với `sorcererResults` ngay trên: ảnh bản cũ
  // thiếu khiên soi Alpha vẫn đọc được, output vẫn required cho tsc.
  alphaShieldUsed: z.record(z.string(), z.boolean()).default({}),
  apprenticeAwakened: z.boolean(),
  wolfCubRageNextNight: z.boolean(),
  healUsed: z.boolean(),
  poisonUsed: z.boolean(),
  lastNightDeaths: z.array(publicDeathSchema),
  nightHistory: z.array(objectOf<NightRecap>()),
  lastEliminated: publicDeathSchema.nullable(),
  trial: z
    .object({
      accusedId: z.string(),
      finalVotes: z.record(z.string(), z.boolean()),
      defenseStartedAt: z.number().optional(),
      defenseEndedAt: z.number().optional(),
    })
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
  elderBiteSurvived: z.boolean().optional(),
  firstDeadId: z.string().nullable().optional(),
  villagePowersLostRound: z.number().nullable().optional(),
  bloodMoonArmed: z.boolean(),
  bloodMoonUsed: z.boolean(),
  deadCanSpeakUsed: z.boolean(),
  deadCanSpeakChosenId: z.string().nullable(),
  /**
   * Người bị Sổ Tang xướng tên. Thiếu dòng này thì `z.object()` STRIP nó khi
   * đọc lại, và sau một lần restart giữa ván vai đã công khai lại ẩn đi - không
   * lỗi, không log, chỉ là thông tin bốc hơi.
   *
   * OPTIONAL vì cùng lý do với mọi trường thêm sau ở file này: bắt buộc nó là
   * làm mọi ảnh chụp ghi trước bản này trượt schema rồi rơi vào `quarantine`,
   * tức giết sạch các ván đang chạy ngay lúc deploy.
   */
  obituaryRevealedId: z.string().nullable().optional(),
  howlBonusDay: z.number().nullable(),
  dayOfTruthClaims: z.record(z.string(), z.string().nullable()),
  /**
   * STRICT chứ không phải `objectOf`: đây là dữ liệu MANG QUYẾT ĐỊNH - nó là
   * kết quả cuối cùng của một người chơi, và một mục méo sẽ hiện ra ở màn kết
   * thúc lẫn lịch sử trận mà không có gì sửa lại được.
   *
   * OPTIONAL vì cùng lý do với `kickedPlayerIds`/`startedAt` ở dưới: bắt buộc
   * một trường thêm sau là làm mọi snapshot đã ghi trước bản này trượt schema
   * rồi rơi vào `quarantine` - tức giết sạch các ván đang chạy ngay lúc deploy.
   * Constructor của engine chuẩn hoá về mảng rỗng.
   */
  /**
   * Nhiệm vụ của Kẻ Báo Thù: `executionerId` -> `targetId`.
   *
   * STRICT chứ không phải `objectOf`, cùng thang đo với `personalWins` ngay
   * dưới: đây là dữ liệu MANG QUYẾT ĐỊNH - nó là điều kiện thắng của một người
   * chơi, và một giá trị méo ở đây sẽ lặng lẽ khiến họ không bao giờ thắng
   * được, hoặc hoá Thằng Hề vào sai lúc.
   *
   * OPTIONAL vì cùng lý do với `personalWins`: bắt buộc một trường thêm sau là
   * giết sạch các ván đang chạy ngay lúc deploy. Constructor của engine chuẩn
   * hoá về object rỗng, tức "ván này không có ai mang nhiệm vụ" - đúng sự thật
   * của một ván ghi trước bản này. Và quan trọng: nó KHÔNG bốc lại mục tiêu,
   * nên một lần khôi phục không đổi nhiệm vụ của ai.
   */
  executionerTargets: z.record(z.string(), z.string()).optional(),
  personalWins: z
    .array(
      z.object({
        playerId: z.string(),
        name: z.string(),
        role: roleSchema,
        condition: personalWinConditionSchema,
        round: z.number().int().min(0),
      }),
    )
    .optional(),
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
        // Sói Pháp Sư soi dòng Tiên Tri; thay cặp Linh Mục/Bà Đồng đã xóa cứng.
        "SORCERER_CHECK",
        "SERIAL_KILL",
        // CHẾT nhưng GIỮ: snapshot ghi khi Linh Mục còn sống mang hai tên này
        // (tên cũ PRIEST_BLESS + tên thật HOLY_WATER), và xóa chúng là làm ván
        // đang chạy trượt schema lúc khôi phục. Cùng tiền lệ với enum `cause`
        // giữ "priest"/"priest_backfire" cho lịch sử cũ. Engine hiện tại không
        // bao giờ SINH ra chúng nữa.
        "HOLY_WATER",
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
  // Snapshot trước P1.1 không có hồ sơ; khôi phục thành bảng trống rồi bot
  // tự lập lại từ những gì nó thấy tiếp theo.
  profiles: z.record(z.string(), objectOf<PlayerProfile>()).default({}),
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

/**
 * Một dòng trong sổ chat của ván. `channel` để LỎNG ở `z.string()` chứ không
 * ràng vào `CHAT_CHANNELS` như `chatMessageSchema` ngay trên: sổ này chỉ để đọc
 * lại về sau, và một kênh mới thêm ở bản sau không được phép làm cả phòng đang
 * chạy trượt schema rồi bị cách ly.
 */
const archivedChatMessageSchema = z.object({
  seq: z.number().int().min(0),
  channel: z.string(),
  actorId: z.string(),
  actorName: z.string(),
  text: z.string(),
  round: z.number().int().min(0),
  phase: z.string(),
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

/**
 * Add-on "Phong thư sau cùng".
 *
 * Ở tầng CẤU TRÚC chứ không strict từng chữ, đúng thang đo đã khai ở đầu file:
 * một lá thư méo cùng lắm hiển thị xấu, nó không đẩy máy trạng thái đi sai luật.
 * Nhưng `openedAuthorIds` thì phải đúng - nó là chốt chống mở trùng, và một dãy
 * hỏng ở đây sẽ mở lại thư của người đã chết sau mỗi lần khởi động lại.
 */
const lastLetterStateSchema = z.object({
  drafts: z.record(
    z.string(),
    z.object({ text: z.string(), updatedRound: z.number() }),
  ),
  opened: z.array(
    z.object({
      id: z.string(),
      authorId: z.string(),
      authorName: z.string(),
      text: z.string(),
      sealedRound: z.number(),
      openedRound: z.number(),
      openedAt: z.number(),
    }),
  ),
  openedAuthorIds: z.array(z.string()),
});

const persistedRoomSchema = z.object({
  code: z.string(),
  hostId: z.string().nullable(),
  status: oneOf<RoomStatus>(["LOBBY", "IN_GAME"]),
  members: z.array(memberSchema),
  config: storedRoomConfigSchema,
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
  // OPTIONAL vì đây là trường thêm sau. Bắt buộc nó là mọi snapshot đã ghi
  // trước bản này hoá hỏng ngay lúc deploy - tức giết sạch các ván đang chạy,
  // đúng cái bẫy mà `restoreRoomFromEnvelope` đã ghi chú.
  kickedPlayerIds: z.array(z.string()).optional(),
  // OPTIONAL vì cùng lý do với `kickedPlayerIds` ngay trên: bắt buộc một
  // trường thêm sau là làm mọi snapshot đã ghi trước bản này trượt schema,
  // rơi vào `quarantine` và giết sạch các ván đang chạy ngay lúc deploy. Chỗ
  // đọc rơi về `createdAt`.
  startedAt: z.number().optional(),
  // OPTIONAL vì cùng lý do với hai trường ngay trên. Ván đang chạy lúc deploy
  // bản này đọc lên thành một phòng chưa ai viết thư - đúng trạng thái mà nó
  // thật sự đang ở.
  lastLetters: lastLetterStateSchema.optional(),
  // OPTIONAL vì cùng lý do với ba trường ngay trên. Ván đang chạy lúc deploy
  // bản này đọc lên với sổ chat rỗng: nó mất phần đã nói TRƯỚC lần restart đó,
  // chứ không phải hỏng cả phòng.
  matchChat: z.array(archivedChatMessageSchema).optional(),
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
const _lettersForward: Assignable<LastLetterRoomState, z.infer<typeof lastLetterStateSchema>> = true;
const _lettersBackward: Assignable<z.infer<typeof lastLetterStateSchema>, LastLetterRoomState> = true;
const _chatForward: Assignable<ArchivedChatMessage, z.infer<typeof archivedChatMessageSchema>> = true;
const _chatBackward: Assignable<z.infer<typeof archivedChatMessageSchema>, ArchivedChatMessage> = true;

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
void _lettersForward;
void _lettersBackward;
void _chatForward;
void _chatBackward;
