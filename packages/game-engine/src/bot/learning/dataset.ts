import { isRole, isWolfPack, type Role } from "@masoi/shared";
import { createSeededRng } from "../rng";
import type { BotTrajectory } from "../evaluation/trajectory";
import { TARGETING_DECISIONS, encodeObservation, type EncodeOptions } from "./observation";

/**
 * BOT_SELF_LEARNING §7 + §15 + §42: leak validator, dataset stats, game-level split.
 *
 * §7 nói rõ điều quan trọng nhất: dataset có rò rỉ phải bị TỪ CHỐI, không được
 * âm thầm xoá trường rồi train tiếp — vì làm vậy là giấu đi chính con bug đã tạo
 * ra nó. Vì vậy mọi hàm ở đây chỉ BÁO CÁO; không hàm nào sửa line.
 *
 * Bộ luật rò rỉ được suy từ ĐÚNG luật `botKnowledgeFor` của engine, và mọi vế
 * của nó kiểm được chỉ bằng bản thân line — không cần ground truth. Đó là điều
 * kiện để validator chạy được trên một file JSONL rời, kể cả file do một bản
 * build khác sinh ra.
 */

export type ViolationKind = "schema" | "leak" | "action";

export interface ObservationViolation {
  field: string;
  reason: string;
  kind: ViolationKind;
}

export interface ObservationLeakReport {
  valid: boolean;
  violations: ObservationViolation[];
}

/**
 * Khoá được phép có trong `observation`.
 *
 * Whitelist chứ không blacklist: một trường MỚI lọt vào observation là tình
 * huống nguy hiểm nhất (ai đó thêm feature "cho model mạnh hơn" và vô tình
 * thêm sự thật ẩn). Blacklist chỉ chặn được những cái tên đã nghĩ ra trước.
 */
const OBSERVATION_KEYS = new Set([
  "aliveIds",
  "legalActions",
  "knownRoles",
  "seerResult",
  "belief",
  "personality",
  // Mục tiêu hợp lệ tách theo loại hành động đêm. Đây là thứ engine ĐÃ cấp cho
  // đúng bot đó qua `night.legalTargets` — cùng nguồn với `legalActions`, chỉ
  // là chưa bị gộp mất loại, nên nó không mở thêm quyền nhìn nào.
  "nightLegalTargets",
]);

/** Chỉ hai vai này có `seerResult` — xem case `SEE` trong engine. */
const CAN_SCRY: ReadonlySet<string> = new Set(["SEER", "APPRENTICE_SEER"]);

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Kiểm MỘT line đọc từ JSONL. Nhận `unknown` có chủ đích: nguồn thật là một
 * file trên đĩa, và một validator chỉ chạy được sau khi dữ liệu đã được tin là
 * đúng kiểu thì không kiểm được gì.
 */
export function validateTrajectoryLine(value: unknown): ObservationLeakReport {
  const violations: ObservationViolation[] = [];
  const add = (field: string, reason: string, kind: ViolationKind): void => {
    violations.push({ field, reason, kind });
  };

  if (typeof value !== "object" || value === null) {
    return { valid: false, violations: [{ field: "", reason: "line không phải object", kind: "schema" }] };
  }
  const line = value as Record<string, unknown>;

  for (const key of ["gameId", "seed", "playerId", "phase", "decision", "finalWinner"]) {
    if (typeof line[key] !== "string") add(key, "thiếu hoặc không phải chuỗi", "schema");
  }
  if (!isFiniteNumber(line.turn)) add("turn", "thiếu hoặc không phải số", "schema");
  if (!isRole(line.finalRole)) add("finalRole", "không phải một vai bản build này hiểu", "schema");
  if (line.reward !== 1 && line.reward !== -1) {
    add("reward", "reward phải là +1 hoặc −1 (§20)", "schema");
  }
  if (!isStringArray(line.legalActions)) add("legalActions", "phải là mảng chuỗi", "schema");

  const observation = line.observation;
  if (typeof observation !== "object" || observation === null) {
    add("observation", "thiếu hoặc không phải object", "schema");
    return { valid: false, violations };
  }
  const obs = observation as Record<string, unknown>;

  for (const key of Object.keys(obs)) {
    if (!OBSERVATION_KEYS.has(key)) {
      // §44: nhãn cấp-ván (kết cục, vai thật) là REWARD, không bao giờ là input.
      add(`observation.${key}`, "trường ngoài schema observation — nghi rò rỉ", "leak");
    }
  }

  if (!isStringArray(obs.aliveIds)) add("observation.aliveIds", "phải là mảng chuỗi", "schema");
  if (!isStringArray(obs.legalActions)) {
    add("observation.legalActions", "phải là mảng chuỗi", "schema");
  }

  const playerId = typeof line.playerId === "string" ? line.playerId : "";
  const aliveIds = isStringArray(obs.aliveIds) ? obs.aliveIds : [];
  const alive = new Set(aliveIds);
  const knownRoles = obs.knownRoles;
  let selfRole: Role | null = null;

  if (typeof knownRoles !== "object" || knownRoles === null) {
    add("observation.knownRoles", "thiếu hoặc không phải object", "schema");
  } else {
    const roles = knownRoles as Record<string, unknown>;
    const rawSelf = roles[playerId];
    if (rawSelf === undefined) {
      add("observation.knownRoles", "thiếu vai của chính bot", "schema");
    } else if (!isRole(rawSelf)) {
      add("observation.knownRoles", "vai của chính bot không hợp lệ", "schema");
    } else {
      selfRole = rawSelf;
    }

    const selfAlive = alive.has(playerId);
    for (const [id, role] of Object.entries(roles)) {
      if (id === playerId) continue;
      if (!isRole(role)) {
        add(`observation.knownRoles.${id}`, "không phải một vai hợp lệ", "schema");
        continue;
      }
      // Ba đường HỢP PHÁP duy nhất để biết vai người khác, sao đúng
      // `GameEngine.botKnowledgeFor`:
      //   1. người đó đã CHẾT (revealRoleOnDeath / sổ tang),
      //   2. mình là Sói trong bầy còn sống, và người đó cũng trong bầy,
      //   3. mình là Tiên Tri Tập Sự còn sống, và người đó là Tiên Tri.
      const dead = !alive.has(id);
      const packmate = selfRole !== null && selfAlive && isWolfPack(selfRole) && isWolfPack(role);
      const apprenticeSeesSeer =
        selfRole === "APPRENTICE_SEER" && selfAlive && role === "SEER";
      if (!dead && !packmate && !apprenticeSeesSeer) {
        add(
          `observation.knownRoles.${id}`,
          `bot vai ${selfRole ?? "?"} không có quyền biết vai của người còn sống`,
          "leak",
        );
      }
    }
  }

  const seerResult = obs.seerResult;
  if (seerResult !== null && seerResult !== undefined) {
    if (typeof seerResult !== "object") {
      add("observation.seerResult", "phải là object hoặc null", "schema");
    } else if (selfRole !== null && !CAN_SCRY.has(selfRole)) {
      add("observation.seerResult", `vai ${selfRole} không có lượt soi`, "leak");
    }
  }

  const belief = obs.belief;
  if (!Array.isArray(belief)) {
    add("observation.belief", "phải là mảng", "schema");
  } else {
    for (const entry of belief) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        typeof (entry as { playerId?: unknown }).playerId !== "string" ||
        !isFiniteNumber((entry as { suspicion?: unknown }).suspicion) ||
        !isFiniteNumber((entry as { trust?: unknown }).trust)
      ) {
        add("observation.belief", "entry thiếu playerId/suspicion/trust hữu hạn", "schema");
        break;
      }
    }
  }

  const selected = line.selectedAction;
  if (typeof selected !== "object" || selected === null) {
    add("selectedAction", "thiếu hoặc không phải object", "schema");
  } else {
    const target = (selected as { targetId?: unknown }).targetId;
    if (target !== null && typeof target !== "string") {
      add("selectedAction.targetId", "phải là chuỗi hoặc null", "schema");
    } else if (
      typeof target === "string" &&
      isStringArray(line.legalActions) &&
      TARGETING_DECISIONS.has(String(line.decision)) &&
      !line.legalActions.includes(target)
    ) {
      // §42 "action belongs to legal set". FINAL_VOTE (treo/tha) và SPEECH
      // không chọn mục tiêu trong không gian này nên không bị ép luật.
      add("selectedAction.targetId", "hành động nằm ngoài tập hợp lệ", "action");
    }
  }

  return { valid: violations.length === 0, violations };
}

export interface DatasetStats {
  games: number;
  /** Một episode = một người chơi trong một ván. */
  episodes: number;
  timesteps: number;
  invalidObservations: number;
  invalidActions: number;
  leakViolations: number;
  /** Line không ánh xạ được thành nhãn hành động — không dùng được cho BC (§43). */
  unmappedActions: number;
  roleDistribution: Record<string, number>;
  phaseDistribution: Record<string, number>;
  decisionDistribution: Record<string, number>;
  /** Tần suất theo NHÃN hành động đã encode; chính là bảng mất cân bằng lớp (§43). */
  actionDistribution: Record<string, number>;
  rewardDistribution: { win: number; loss: number };
  /** Số timestep rơi vào từng phần sau khi chia theo ván (§15). */
  splitCounts: Record<DatasetSplit, number>;
  /** Đếm theo lý do, để một file hỏng nói được hỏng ở đâu chứ không chỉ hỏng bao nhiêu. */
  violationsByReason: Record<string, number>;
}

function bump(table: Record<string, number>, key: string): void {
  table[key] = (table[key] ?? 0) + 1;
}

/**
 * Bộ gom thống kê §42, nhận từng line MỘT.
 *
 * Tách khỏi `summarizeDataset` vì một dataset thật nặng vài GB: đọc cả file
 * thành một mảng là cách chắc chắn nhất để tầng kiểm chết đúng lúc nó cần chạy
 * nhất. Bộ gom chỉ giữ tập id ván/episode và mấy bảng đếm, nên chi phí bộ nhớ
 * không phụ thuộc số dòng.
 */
export interface DatasetSummarizer {
  add(line: unknown): void;
  finish(): DatasetStats;
}

export function createDatasetSummarizer(
  options: EncodeOptions & SplitOptions = {},
): DatasetSummarizer {
  const stats: DatasetStats = {
    games: 0,
    episodes: 0,
    timesteps: 0,
    invalidObservations: 0,
    invalidActions: 0,
    leakViolations: 0,
    unmappedActions: 0,
    roleDistribution: {},
    phaseDistribution: {},
    decisionDistribution: {},
    actionDistribution: {},
    rewardDistribution: { win: 0, loss: 0 },
    splitCounts: { train: 0, validation: 0, test: 0 },
    violationsByReason: {},
  };

  const games = new Set<string>();
  const episodes = new Set<string>();

  return {
    add(raw) {
      stats.timesteps += 1;
      const report = validateTrajectoryLine(raw);
      for (const violation of report.violations) {
        bump(
          stats.violationsByReason,
          `${violation.kind}: ${violation.field} — ${violation.reason}`,
        );
        if (violation.kind === "leak") stats.leakViolations += 1;
        if (violation.kind === "action") stats.invalidActions += 1;
        if (violation.kind === "schema") stats.invalidObservations += 1;
      }
      if (typeof raw !== "object" || raw === null) return;

      const line = raw as BotTrajectory;
      if (typeof line.gameId === "string") {
        games.add(line.gameId);
        stats.splitCounts[splitOf(line.gameId, options)] += 1;
        if (typeof line.playerId === "string") {
          episodes.add(`${line.gameId} ${line.playerId}`);
        }
      }
      if (typeof line.finalRole === "string") bump(stats.roleDistribution, line.finalRole);
      if (typeof line.phase === "string") bump(stats.phaseDistribution, line.phase);
      if (typeof line.decision === "string") bump(stats.decisionDistribution, line.decision);
      if (line.reward === 1) stats.rewardDistribution.win += 1;
      else if (line.reward === -1) stats.rewardDistribution.loss += 1;

      if (!report.valid) return;
      try {
        // Chạy luôn encoder: một line hợp schema nhưng không encode nổi (quá số
        // ghế) vẫn là một line không train được, và chỗ duy nhất phát hiện ra
        // điều đó là ở đây — trước khi train, không phải giữa lúc train.
        const encoded = encodeObservation(line, options);
        if (encoded.actionIndex === null) stats.unmappedActions += 1;
        else bump(stats.actionDistribution, String(encoded.actionIndex));
      } catch (error) {
        stats.invalidObservations += 1;
        bump(stats.violationsByReason, `schema: observation — ${(error as Error).message}`);
      }
    },
    finish() {
      stats.games = games.size;
      stats.episodes = episodes.size;
      return stats;
    },
  };
}

/** Thống kê §42 trên một tập line đã nằm sẵn trong bộ nhớ. */
export function summarizeDataset(
  lines: readonly unknown[],
  options: EncodeOptions & SplitOptions = {},
): DatasetStats {
  const summarizer = createDatasetSummarizer(options);
  for (const line of lines) summarizer.add(line);
  return summarizer.finish();
}

export type DatasetSplit = "train" | "validation" | "test";

export interface SplitOptions {
  /** Tỉ lệ ván train. §15 mặc định 70%. */
  train?: number;
  /** Tỉ lệ ván validation. §15 mặc định 15%; phần còn lại là test. */
  validation?: number;
  /** Hạt băm, để đổi cách chia mà không cần đổi dữ liệu. */
  seed?: string;
}

/**
 * §15: chia theo VÁN, không theo timestep.
 *
 * Băm `gameId` thay vì xáo danh sách: mỗi ván tự quyết định mình thuộc phần
 * nào, nên hai lần chạy trên hai tập line khác nhau của CÙNG một ván vẫn cho
 * cùng một phần — không có đường nào để một state của ván train rơi vào test.
 */
export function splitOf(gameId: string, options: SplitOptions = {}): DatasetSplit {
  const train = options.train ?? 0.7;
  const validation = options.validation ?? 0.15;
  // Rút một số từ `createSeededRng` thay vì chia thẳng `fnv1a32`: FNV-1a trên
  // các chuỗi chỉ khác nhau ở đuôi ("batch-1", "batch-2"…) cho các giá trị nằm
  // sát nhau ở BIT CAO, nên phép chia cho 2^32 dồn cả một batch vào một phần.
  // RNG đã có sẵn bước trộn khắc phục đúng chuyện đó, và nó đã được kiểm.
  const value = createSeededRng(`${options.seed ?? "split"}:${gameId}`)();
  if (value < train) return "train";
  if (value < train + validation) return "validation";
  return "test";
}

/** Gom line theo phần, giữ nguyên thứ tự đọc trong mỗi phần. */
export function splitTrajectories(
  lines: readonly BotTrajectory[],
  options: SplitOptions = {},
): Record<DatasetSplit, BotTrajectory[]> {
  const out: Record<DatasetSplit, BotTrajectory[]> = { train: [], validation: [], test: [] };
  for (const line of lines) out[splitOf(line.gameId, options)].push(line);
  return out;
}
