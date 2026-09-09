import { PHASES, ROLE_META, ROLES, isRole, type Role, type Team } from "@masoi/shared";
import { MAX_ROUNDS } from "../evaluation/selfplay";
import type { BotTrajectory } from "../evaluation/trajectory";
import type { NightActionKind } from "../types";

/**
 * BOT_SELF_LEARNING §8-§13: observation encoder + action encoder + action mask.
 *
 * Đầu vào DUY NHẤT là một line `BotTrajectory` — thứ đã đi qua knowledge view
 * của chính bot đó (§6). Encoder KHÔNG nhận `GameState`, không nhận
 * `SelfPlayGame`, không nhận bảng `roles`: cùng lý do với `buildBotKnowledgeView`,
 * một trường ẩn không có ĐƯỜNG NÀO vào đây, kể cả khi ai đó muốn.
 *
 * Tất định (§54 "Observation encoder is deterministic"): cùng line → cùng
 * vector. Không đọc đồng hồ, không rút RNG, và không phụ thuộc thứ tự khoá của
 * object — mọi danh sách đều được sort trước khi dùng.
 */

/** Token hành động "không treo ai", do `snapshotKnowledge` sinh ra. */
export const NO_TARGET_ACTION = "NO_ELIMINATION";

/** Khớp `TraceDecisionKind`; giữ thành mảng để one-hot có thứ tự cố định. */
export const DECISION_KINDS = [
  "VOTE",
  "NIGHT",
  "FINAL_VOTE",
  "HUNTER_SHOT",
  "SPEECH",
] as const;

/**
 * Ba loại quyết định CHỌN MỘT NƯỚC ĐI — đúng những loại mà không gian hành động
 * ở đây mô tả được.
 *
 * `FINAL_VOTE` là treo/tha và `SPEECH` là một hành vi lời nói: cả hai có
 * `targetId` nhưng targetId ấy KHÔNG phải một nước đi trong không gian này. Ánh
 * xạ chúng vào ghế sẽ sinh ra nhãn train nói "bot đã bầu người này" cho một
 * lượt bot chỉ vừa nhắc tên người đó — sai theo đúng cách khó phát hiện nhất.
 */
export const TARGETING_DECISIONS: ReadonlySet<string> = new Set([
  "VOTE",
  "NIGHT",
  "HUNTER_SHOT",
]);

/**
 * Loại hành động BAN NGÀY (bầu, bắn): một mục tiêu hoặc "không ai".
 *
 * Tên riêng để không trùng với bất kỳ `NightActionKind` nào; một quyết định
 * ban ngày luôn dùng đúng loại này.
 */
export const DAY_ACTION_KIND = "CHOOSE";

/**
 * Mọi `NightActionKind` engine hiểu, theo thứ tự cố định.
 *
 * `satisfies Record<NightActionKind, 0>` ép danh sách này khớp CHÍNH XÁC với
 * union trong `types.ts`: thêm một loại hành động đêm mới vào engine mà quên
 * ở đây là lỗi biên dịch, không phải một hành động im lặng không mã hoá được.
 */
const NIGHT_KIND_TABLE = {
  KILL: 0,
  SEE: 0,
  GUARD: 0,
  HEAL: 0,
  POISON: 0,
  SKIP: 0,
  DETECTIVE_CHECK: 0,
  SORCERER_CHECK: 0,
  SERIAL_KILL: 0,
  TRACK: 0,
} as const satisfies Record<NightActionKind, 0>;

export const NIGHT_ACTION_KINDS = Object.keys(NIGHT_KIND_TABLE) as NightActionKind[];

/**
 * Trục "loại" của không gian hành động: ban ngày + mọi loại đêm.
 *
 * Không gian hành động là tích (loại × ô): chỉ số = `kind × (maxSeats + 1) + ô`,
 * ô cuối của mỗi loại là "không mục tiêu". HEAL và POISON cùng một người là
 * hai chỉ số khác nhau, và "giữ thuốc" (SKIP, không mục tiêu) là một chỉ số
 * thật chứ không phải một dòng bị bỏ vì không có nhãn. Đó là toàn bộ lý do có
 * trục này: một policy chỉ chọn ghế thì khi cắm vào runtime không nói được nó
 * muốn LÀM GÌ với ghế đó.
 */
export const ACTION_KINDS: readonly string[] = [DAY_ACTION_KIND, ...NIGHT_ACTION_KINDS];

/**
 * Trần số ghế của một vector.
 *
 * Phải có trần vì tensor cần chiều cố định; nhưng KHÔNG hard-code số người mỗi
 * ván (§12) — ván 8 người và ván 15 người dùng chung encoder, ghế thừa là 0.
 * Vượt trần thì NÉM: cắt bớt người chơi là làm hỏng dữ liệu train trong im lặng.
 */
export const DEFAULT_MAX_SEATS = 16;

/** Thang chuẩn hoá belief: điểm nghi/tin của lõi bot chạy quanh 0..100. */
const BELIEF_SCALE = 100;

/** Đặc trưng của MỘT ghế, đúng thứ tự chúng nằm trong vector. */
const SEAT_FEATURE_NAMES = [
  "isSelf",
  "alive",
  "suspicion",
  "trust",
  "wolfProbability",
  "threat",
  "credibility",
  "influence",
  "knownWolfTeam",
  "knownVillageTeam",
  "knownNeutralTeam",
  "seerSeenWolf",
  "seerSeenClean",
  "legalTarget",
  "isWolfTarget",
  "diedLastNight",
  "voteShare",
  "isAccused",
  "isGuardPrevious",
  // Ba đầu vào riêng của scorer đêm (reports/train-policy-0002.md).
  "informationValue",
  "claimedPowerRole",
  "guardedBefore",
] as const;

/** Phe của từng vai, tra sẵn một lần thay vì đọc `ROLE_META` trong vòng lặp. */
const ROLE_TEAM = Object.fromEntries(
  ROLES.map((role) => [role, ROLE_META[role].team]),
) as Record<Role, Team>;

export interface EncodedObservation {
  /** Vector đặc trưng, chiều cố định theo `maxSeats`. */
  features: number[];
  /**
   * Ghế → playerId. Ghế 0 LUÔN là chính bot (§9: biểu diễn tương đối).
   *
   * Không có bảng này thì `mask`/`actionIndex` chỉ là những con số: mọi tầng
   * đọc ngược từ chỉ số ra người chơi đều cần đúng nó.
   */
  seats: string[];
  /** `mask[i]` = hành động `i` hợp lệ; xem `decodeAction` để đọc ngược `i`. */
  mask: boolean[];
  /**
   * Chỉ số hành động bot đã chọn — nhãn cho behavior cloning.
   *
   * `null` khi hành động không ánh xạ được vào không gian này (SPEECH,
   * FINAL_VOTE, hoặc một nước đi ngoài tập hợp lệ). `null` là "không có nhãn",
   * không phải "hành động 0": một nhãn bịa ra sẽ dạy model chính xác điều sai.
   */
  actionIndex: number | null;
}

/** Một nước đi đã giải mã từ chỉ số hành động. */
export interface DecodedAction {
  /** `DAY_ACTION_KIND` hoặc một `NightActionKind`. */
  kind: string;
  /** `null` = ô "không mục tiêu" (không treo ai / giữ thuốc / không bắn). */
  targetId: string | null;
}

/** Chiều của vector observation ứng với một `maxSeats`. */
export function observationSize(maxSeats: number = DEFAULT_MAX_SEATS): number {
  return globalFeatureNames().length + maxSeats * SEAT_FEATURE_NAMES.length;
}

/** Số ô của MỘT loại hành động: mỗi ghế một ô, cộng "không mục tiêu". */
export function slotsPerKind(maxSeats: number = DEFAULT_MAX_SEATS): number {
  return maxSeats + 1;
}

/** Chiều của không gian hành động: (loại × ô). */
export function actionSize(maxSeats: number = DEFAULT_MAX_SEATS): number {
  return ACTION_KINDS.length * slotsPerKind(maxSeats);
}

/** Chỉ số hành động của cặp (loại, ô). Ném khi loại không tồn tại. */
export function actionIndexOf(
  kind: string,
  slot: number,
  maxSeats: number = DEFAULT_MAX_SEATS,
): number {
  const kindIndex = ACTION_KINDS.indexOf(kind);
  if (kindIndex < 0) throw new Error(`loại hành động không tồn tại: ${kind}`);
  return kindIndex * slotsPerKind(maxSeats) + slot;
}

/**
 * Đọc ngược một chỉ số hành động ra (loại, mục tiêu) bằng bảng ghế của chính
 * observation đó. Ném khi chỉ số ngoài không gian — một policy trả về chỉ số
 * như vậy là bug ở policy, không phải một nước đi "gần đúng".
 */
export function decodeAction(
  index: number,
  seats: readonly string[],
  maxSeats: number = DEFAULT_MAX_SEATS,
): DecodedAction {
  const slots = slotsPerKind(maxSeats);
  const kind = ACTION_KINDS[Math.floor(index / slots)];
  if (!Number.isInteger(index) || index < 0 || kind === undefined) {
    throw new Error(`chỉ số hành động ${index} ngoài không gian ${actionSize(maxSeats)}`);
  }
  const slot = index % slots;
  if (slot === maxSeats) return { kind, targetId: null };
  const targetId = seats[slot];
  if (targetId === undefined) throw new Error(`ô ${slot} không có người chơi`);
  return { kind, targetId };
}

/** Tên từng hành động, cùng thứ tự với `mask`. */
export function actionNames(maxSeats: number = DEFAULT_MAX_SEATS): string[] {
  const names: string[] = [];
  for (const kind of ACTION_KINDS) {
    for (let seat = 0; seat < maxSeats; seat += 1) names.push(`${kind}:seat${seat}`);
    names.push(`${kind}:none`);
  }
  return names;
}

function globalFeatureNames(): string[] {
  return [
    "round",
    "aliveShare",
    // Lấy thẳng enum của engine (§11) — không chép tay danh sách pha lần hai.
    ...PHASES.map((phase) => `phase:${phase}`),
    ...DECISION_KINDS.map((kind) => `decision:${kind}`),
    // Role embedding (§10) lấy từ đúng bộ bài engine hiểu.
    ...ROLES.map((role) => `selfRole:${role}`),
    "personality:aggressiveness",
    "personality:talkativeness",
    "personality:riskTolerance",
    "personality:deceptionSkill",
    "personality:analyticalSkill",
    "personality:loyalty",
    "personality:stubbornness",
    "noEliminationLegal",
    // Loại hành động được chào lượt này. Mask đã chặn logits, nhưng model cần
    // THẤY nó để biết mình đang ở lượt gì (Phù Thuỷ còn bình nào, Sói cắn
    // hay theo dõi) trước khi tính điểm ghế.
    ...ACTION_KINDS.map((kind) => `legalKind:${kind}`),
    "healUsed",
    "poisonUsed",
    "noEliminationVoteShare",
  ];
}

/**
 * Tên từng chiều, cùng thứ tự với `features`.
 *
 * Tồn tại để một vector sai được ĐỌC ra chứ không phải đoán: khi behavior
 * cloning học nhầm, câu hỏi đầu tiên luôn là "chiều nào đang bật".
 */
export function observationFeatureNames(maxSeats: number = DEFAULT_MAX_SEATS): string[] {
  const names = globalFeatureNames();
  for (let seat = 0; seat < maxSeats; seat += 1) {
    for (const feature of SEAT_FEATURE_NAMES) names.push(`seat${seat}:${feature}`);
  }
  return names;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Thứ tự ghế CHÍNH TẮC: sort theo id rồi XOAY để chính bot đứng ghế 0.
 *
 * §9 cấm model học "player-1 luôn quan trọng". Xoay một danh sách đã sort giữ
 * nguyên thứ tự tương đối của cả bàn nhưng bỏ hẳn ý nghĩa tuyệt đối của id — và
 * với UUID ngẫu nhiên thì sort chỉ còn là một hoán vị tất định, đúng thứ cần.
 * Ghế 0 là "tôi" ở mọi ván, mọi vai, mọi số người.
 *
 * ponytail: chưa dùng thứ tự ghế THẬT của phòng (knowledge view không phơi ra
 * `seatIndex`); nâng lên nếu benchmark cho thấy quan hệ trái/phải có giá.
 */
export function canonicalSeats(line: BotTrajectory): string[] {
  const ids = new Set<string>([line.playerId]);
  for (const id of line.observation.aliveIds) ids.add(id);
  for (const entry of line.observation.belief) ids.add(entry.playerId);
  for (const id of Object.keys(line.observation.knownRoles)) ids.add(id);
  for (const action of line.legalActions) {
    if (action !== NO_TARGET_ACTION) ids.add(action);
  }
  for (const id of line.observation.lastNightDeaths ?? []) ids.add(id);
  if (line.observation.nightWolfTarget) ids.add(line.observation.nightWolfTarget);

  const sorted = [...ids].sort((left, right) => left.localeCompare(right));
  const selfAt = sorted.indexOf(line.playerId);
  return [...sorted.slice(selfAt), ...sorted.slice(0, selfAt)];
}

/**
 * §13: logits của hành động bất hợp lệ về `-Infinity`, tức xác suất 0 sau
 * softmax. Trả mảng MỚI — che tại chỗ sẽ làm hỏng logits gốc mà tầng gọi còn
 * dùng để log.
 */
export function maskLogits(logits: readonly number[], mask: readonly boolean[]): number[] {
  return logits.map((value, index) => (mask[index] === true ? value : Number.NEGATIVE_INFINITY));
}

/** Vai của CHÍNH bot lúc quyết định, đọc từ knowledge view của chính nó. */
export function selfRoleOf(line: BotTrajectory): Role | null {
  const role = line.observation.knownRoles[line.playerId];
  return role !== undefined && isRole(role) ? role : null;
}

/**
 * Mục tiêu hợp lệ THEO LOẠI cho line này — nguồn của mask và của nhãn.
 *
 * Ban ngày (VOTE/HUNTER_SHOT) chỉ có một loại `CHOOSE`; ban đêm là bảng
 * `nightLegalTargets` của observation, với hai quy ước engine không viết vào
 * bảng: HEAL không kèm mục tiêu (engine tự cứu nạn nhân bầy — bot thấy nạn
 * nhân qua `nightWolfTarget`, và `BotNightIntention` của Phù Thuỷ gửi
 * `targetId: null`), và SKIP là "không mục tiêu". "Không mục tiêu" của ban
 * ngày là `NO_ELIMINATION`; Thợ Săn luôn được không bắn.
 *
 * Map rỗng = line này KHÔNG có lượt (vai không có hành động đêm vẫn được gọi
 * `decideNight`, và ghi một trace "bỏ lượt"): không phải một nước đi, không
 * có nhãn, và cũng không phải vi phạm.
 */
export function legalMoves(line: BotTrajectory): Map<string, { targets: Set<string>; none: boolean }> {
  const moves = new Map<string, { targets: Set<string>; none: boolean }>();
  if (line.decision === "NIGHT") {
    const table = line.observation.nightLegalTargets;
    if (!table) return moves;
    for (const [kind, targets] of Object.entries(table)) {
      const entry = { targets: new Set(targets), none: kind === "HEAL" || kind === "SKIP" };
      moves.set(kind, entry);
    }
    // Không làm gì luôn là một nước đi hợp lệ ở lượt đêm — bot trả `null` là
    // thế — và nó phải có một ô thật, nếu không mọi lượt "giữ thuốc" đều thành
    // dòng không nhãn và policy học được sẽ không bao giờ giữ thuốc.
    const skip = moves.get("SKIP") ?? { targets: new Set<string>(), none: true };
    skip.none = true;
    moves.set("SKIP", skip);
    return moves;
  }
  if (!TARGETING_DECISIONS.has(line.decision)) return moves;
  const targets = new Set(line.legalActions.filter((action) => action !== NO_TARGET_ACTION));
  const none = line.legalActions.includes(NO_TARGET_ACTION) || line.decision === "HUNTER_SHOT";
  moves.set(DAY_ACTION_KIND, { targets, none });
  return moves;
}

export interface EncodeOptions {
  maxSeats?: number;
}

export function encodeObservation(
  line: BotTrajectory,
  options: EncodeOptions = {},
): EncodedObservation {
  const maxSeats = options.maxSeats ?? DEFAULT_MAX_SEATS;
  const seats = canonicalSeats(line);
  if (seats.length > maxSeats) {
    throw new Error(
      `observation có ${seats.length} ghế, vượt maxSeats=${maxSeats}; tăng maxSeats thay vì cắt bớt người chơi`,
    );
  }

  const observation = line.observation;
  const alive = new Set(observation.aliveIds);
  const legal = new Set(line.legalActions);
  const belief = new Map(observation.belief.map((entry) => [entry.playerId, entry]));
  const selfRole = selfRoleOf(line);
  const seer = observation.seerResult;
  const moves = legalMoves(line);
  const deaths = new Set(observation.lastNightDeaths ?? []);
  const voteCounts = observation.voteCounts ?? { players: {}, noElimination: 0 };
  const voters = Math.max(alive.size, 1);

  const features: number[] = [
    clamp(line.turn / MAX_ROUNDS, 0, 1),
    seats.length === 0 ? 0 : alive.size / seats.length,
  ];
  for (const phase of PHASES) features.push(line.phase === phase ? 1 : 0);
  for (const kind of DECISION_KINDS) features.push(line.decision === kind ? 1 : 0);
  for (const role of ROLES) features.push(selfRole === role ? 1 : 0);
  const personality = observation.personality;
  features.push(
    personality.aggressiveness,
    personality.talkativeness,
    personality.riskTolerance,
    personality.deceptionSkill,
    personality.analyticalSkill,
    personality.loyalty,
    personality.stubbornness,
  );
  features.push(legal.has(NO_TARGET_ACTION) ? 1 : 0);
  for (const kind of ACTION_KINDS) features.push(moves.has(kind) ? 1 : 0);
  features.push(
    observation.healUsed === true ? 1 : 0,
    observation.poisonUsed === true ? 1 : 0,
    clamp(voteCounts.noElimination / voters, 0, 1),
  );

  for (let seat = 0; seat < maxSeats; seat += 1) {
    const id = seats[seat];
    if (id === undefined) {
      // Ghế trống của một ván ít người: 0 ở mọi chiều, kể cả `alive`.
      for (let i = 0; i < SEAT_FEATURE_NAMES.length; i += 1) features.push(0);
      continue;
    }
    const entry = belief.get(id);
    const known = observation.knownRoles[id];
    const knownTeam = known !== undefined && isRole(known) ? ROLE_TEAM[known] : null;
    features.push(
      id === line.playerId ? 1 : 0,
      alive.has(id) ? 1 : 0,
      clamp((entry?.suspicion ?? 0) / BELIEF_SCALE, -1, 1),
      clamp((entry?.trust ?? 0) / BELIEF_SCALE, -1, 1),
      clamp(entry?.wolfProbability ?? 0, 0, 1),
      clamp(entry?.threat ?? 0, 0, 1),
      clamp(entry?.credibility ?? 0, 0, 1),
      clamp(entry?.influence ?? 0, 0, 1),
      knownTeam === "wolves" ? 1 : 0,
      knownTeam === "village" ? 1 : 0,
      knownTeam === "neutral" ? 1 : 0,
      seer !== null && seer.targetId === id && seer.isWolf ? 1 : 0,
      seer !== null && seer.targetId === id && !seer.isWolf ? 1 : 0,
      legal.has(id) ? 1 : 0,
      observation.nightWolfTarget === id ? 1 : 0,
      deaths.has(id) ? 1 : 0,
      clamp((voteCounts.players[id] ?? 0) / voters, 0, 1),
      observation.trialAccusedId === id ? 1 : 0,
      observation.guardPrevious === id ? 1 : 0,
      clamp((entry?.informationValue ?? 0) / BELIEF_SCALE, -1, 1),
      entry?.claimedPowerRole === true ? 1 : 0,
      entry?.guardedBefore === true ? 1 : 0,
    );
  }

  const slots = slotsPerKind(maxSeats);
  const mask: boolean[] = new Array<boolean>(ACTION_KINDS.length * slots).fill(false);
  for (const [kind, move] of moves) {
    const base = ACTION_KINDS.indexOf(kind) * slots;
    // Một loại engine không biết là dữ liệu của một bản build khác; không có ô
    // cho nó, và encodeAction cũng sẽ trả null cho nhãn của nó.
    if (base < 0) continue;
    for (let seat = 0; seat < seats.length; seat += 1) {
      if (move.targets.has(seats[seat]!)) mask[base + seat] = true;
    }
    if (move.none) mask[base + maxSeats] = true;
  }

  return { features, seats, mask, actionIndex: encodeAction(line, seats, maxSeats, moves, mask) };
}

/**
 * Hành động đã chọn → chỉ số trong không gian hành động.
 *
 * Chỉ trả một chỉ số khi hành động đó THẬT SỰ hợp lệ theo mask của chính line
 * ấy. Một nhãn trỏ vào ô mà mask đang tắt là một mẫu train dạy model chọn nước
 * bất hợp lệ, nên ở đây nó thành `null` và tầng dataset đếm nó vào
 * `invalidActions` (§42).
 */
function encodeAction(
  line: BotTrajectory,
  seats: readonly string[],
  maxSeats: number,
  moves: ReadonlyMap<string, { targets: Set<string>; none: boolean }>,
  mask: readonly boolean[],
): number | null {
  if (!TARGETING_DECISIONS.has(line.decision)) return null;
  const target = line.selectedAction.targetId;
  let kind: string;
  if (line.decision === "NIGHT") {
    // `kind: null` là bot không làm gì — cùng một ô với SKIP tường minh.
    kind = line.selectedAction.kind ?? "SKIP";
    if (kind === "SKIP" && target !== null) return null;
  } else {
    kind = DAY_ACTION_KIND;
  }
  if (!moves.has(kind)) return null;
  const kindIndex = ACTION_KINDS.indexOf(kind);
  if (kindIndex < 0) return null;
  const slot = target === null ? maxSeats : seats.indexOf(target);
  if (slot < 0 || slot > maxSeats) return null;
  const index = kindIndex * slotsPerKind(maxSeats) + slot;
  return mask[index] === true ? index : null;
}
