import { PHASES, ROLE_META, ROLES, isRole, type Role, type Team } from "@masoi/shared";
import { NIGHT_ACTION_KINDS } from "../types";
import { MAX_ROUNDS } from "../evaluation/selfplay";
import type { BotTrajectory } from "../evaluation/trajectory";

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
 * Ba loại quyết định CHỌN MỘT NGƯỜI — đúng những loại mà không gian hành động
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
  "knownWolfTeam",
  "knownVillageTeam",
  "seerSeenWolf",
  "seerSeenClean",
  "legalTarget",
  // Hợp lệ cho TỪNG loại hành động đêm. `legalTarget` ở trên là hợp của chúng,
  // và cái hợp đó không phân biệt được "cứu người này" với "giết người này".
  ...NIGHT_ACTION_KINDS.map((kind) => `nightLegal:${kind}` as const),
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
  /** `mask[i]` = chọn ghế `i` là hợp lệ; phần tử CUỐI là `NO_TARGET_ACTION`. */
  mask: boolean[];
  /**
   * Chỉ số hành động bot đã chọn — nhãn cho behavior cloning.
   *
   * `null` khi hành động không ánh xạ được vào không gian này (SPEECH,
   * FINAL_VOTE, hoặc một mục tiêu ngoài tập hợp lệ). `null` là "không có nhãn", không phải
   * "hành động 0": một nhãn bịa ra sẽ dạy model chính xác điều sai.
   */
  actionIndex: number | null;
}

/** Chiều của vector observation ứng với một `maxSeats`. */
export function observationSize(maxSeats: number = DEFAULT_MAX_SEATS): number {
  return globalFeatureNames().length + maxSeats * SEAT_FEATURE_NAMES.length;
}

/** Chiều của không gian hành động: mỗi ghế một hành động, cộng "không treo ai". */
export function actionSize(maxSeats: number = DEFAULT_MAX_SEATS): number {
  return maxSeats + 1;
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
    // Loại hành động đêm nào ĐANG mở. Vai đã có trong vector, nhưng vai không
    // đủ: Phù Thuỷ có hai hành động đêm với hai mục tiêu ngược nhau.
    ...NIGHT_ACTION_KINDS.map((kind) => `nightKindOpen:${kind}`),
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

  const alive = new Set(line.observation.aliveIds);
  const legal = new Set(line.legalActions);
  const belief = new Map(line.observation.belief.map((entry) => [entry.playerId, entry]));
  const selfRole = selfRoleOf(line);
  const seer = line.observation.seerResult;

  const features: number[] = [
    clamp(line.turn / MAX_ROUNDS, 0, 1),
    seats.length === 0 ? 0 : alive.size / seats.length,
  ];
  for (const phase of PHASES) features.push(line.phase === phase ? 1 : 0);
  for (const kind of DECISION_KINDS) features.push(line.decision === kind ? 1 : 0);
  for (const role of ROLES) features.push(selfRole === role ? 1 : 0);
  const personality = line.observation.personality;
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

  const nightTargets = line.observation.nightLegalTargets ?? {};
  const nightLegalBy = new Map<string, Set<string>>(
    NIGHT_ACTION_KINDS.map((kind) => [kind, new Set(nightTargets[kind] ?? [])]),
  );
  for (const kind of NIGHT_ACTION_KINDS) {
    features.push((nightLegalBy.get(kind)?.size ?? 0) > 0 ? 1 : 0);
  }

  for (let seat = 0; seat < maxSeats; seat += 1) {
    const id = seats[seat];
    if (id === undefined) {
      // Ghế trống của một ván ít người: 0 ở mọi chiều, kể cả `alive`.
      for (let i = 0; i < SEAT_FEATURE_NAMES.length; i += 1) features.push(0);
      continue;
    }
    const entry = belief.get(id);
    const known = line.observation.knownRoles[id];
    const knownTeam = known !== undefined && isRole(known) ? ROLE_TEAM[known] : null;
    features.push(
      id === line.playerId ? 1 : 0,
      alive.has(id) ? 1 : 0,
      clamp((entry?.suspicion ?? 0) / BELIEF_SCALE, -1, 1),
      clamp((entry?.trust ?? 0) / BELIEF_SCALE, -1, 1),
      knownTeam === "wolves" ? 1 : 0,
      knownTeam === "village" ? 1 : 0,
      seer !== null && seer.targetId === id && seer.isWolf ? 1 : 0,
      seer !== null && seer.targetId === id && !seer.isWolf ? 1 : 0,
      legal.has(id) ? 1 : 0,
    );
    for (const kind of NIGHT_ACTION_KINDS) {
      features.push(nightLegalBy.get(kind)?.has(id) ? 1 : 0);
    }
  }

  const mask: boolean[] = [];
  for (let seat = 0; seat < maxSeats; seat += 1) {
    const id = seats[seat];
    mask.push(id !== undefined && legal.has(id));
  }
  mask.push(legal.has(NO_TARGET_ACTION));

  return { features, seats, mask, actionIndex: encodeAction(line, seats, maxSeats) };
}

/**
 * Hành động đã chọn → chỉ số trong không gian hành động.
 *
 * Chỉ trả một chỉ số khi hành động đó THẬT SỰ hợp lệ theo `legalActions` của
 * chính line ấy. Một nhãn trỏ vào ô mà mask đang tắt là một mẫu train dạy model
 * chọn nước bất hợp lệ, nên ở đây nó thành `null` và tầng dataset đếm nó vào
 * `invalidActions` (§42).
 */
function encodeAction(line: BotTrajectory, seats: readonly string[], maxSeats: number): number | null {
  if (!TARGETING_DECISIONS.has(line.decision)) return null;
  const legal = new Set(line.legalActions);
  const target = line.selectedAction.targetId;
  if (target === null) return legal.has(NO_TARGET_ACTION) ? maxSeats : null;
  if (!legal.has(target)) return null;
  const seat = seats.indexOf(target);
  return seat >= 0 && seat < maxSeats ? seat : null;
}
