import { isRole, roleTeam, type Role, type Team } from "@masoi/shared";
import type { BotBrainState, BotKnowledgeView } from "../types";
import { MAX_BELIEF_SCORE } from "./evidence";

/**
 * PR 1 của BOT_AI_CONTINUE_UPGRADE (§5-§7, §33): lớp belief XÁC SUẤT theo VAI.
 *
 * Lõi hiện hành tích luỹ scalar `suspicion/trust` (thang 0..100, đã qua decay,
 * đã có evidence reasons). Projection ở đây KHÔNG thay thế scalar đó — nó đọc
 * scalar + knownRoles + pin soi + claims và chiếu thành P(role | evidence) cho
 * từng player. Bảng này là VIEW thuần: không state mới, không decay mới, không
 * đụng decision (§33 "Do not immediately change action selection").
 *
 * Tại sao projection thay vì state mới: mọi thứ xác định P(role) đã nằm trong
 * `BotBrainState` + `BotKnowledgeView`, đều được decay/ghim đúng chỗ. Một bản
 * copy xác suất sống riêng sẽ phải tự decay, tự ghi nguồn, tự chống observe-lặp
 * — ba cái đó đã có chủ, và nhân bản là cách chắc chắn nhất để hai hệ lệch nhau.
 *
 * Mapping scalar → xác suất, theo §33 ("P(Wolf) dẫn ra suspicion"):
 *
 *   P(wolf-team) = prior + (suspicion/100) × (1 − prior)
 *
 * `prior` là tỉ lệ ghế phe Sói trong composition của ván (2/8 = 0.25 ở preset
 * chuẩn). Người KHÔNG có bằng chứng đứng ở prior — "chưa thấy gì" là "xác suất
 * bằng prior", không phải "chắc chắn không phải Sói". Người có bằng chứng đi từ
 * prior về hai đầu, giữ nguyên monotone của scalar nên mọi thứ tự mà decision
 * đang đọc từ `suspicion` đều nhìn được qua `getWolfProbability`.
 *
 * Ràng buộc vai (§7) được tôn trọng qua composition do engine cấp — module này
 * không hard-code số lượng vai nào. Vai đã LỘ (knownRoles) thành certain; kết
 * quả soi của chính bot ghim theo PHE (isWolf), vì soi trả `team` chứ không trả
 * vai cụ thể — khối lượng đó chia giữa các vai phe Sói hiện diện trong deck.
 *
 * Evidence KHÔNG đếm đôi: scalar suspicion đã hấp thụ mọi bằng chứng (kể cả
 * claim, qua `claim-credibility`). Claim ở đây chỉ làm MỘT việc: phân bổ lại
 * khối lượng không-Sói ưu tiên cho vai được khai. Bởi vậy một lời khai láo
 * không tự biến người khai thành Sói — việc đó là của scalar.
 */

export interface RoleBelief {
  playerId: string;
  /** P(role) chuẩn hoá, chỉ gồm vai có trong pool của ván này. */
  probabilities: Record<string, number>;
  /**
   * Độ tin của BẢN PHÂN PHỐI: 1 khi certain (vai lộ / ghim soi), thấp hơn khi
   * là suy diễn. Đây là confidence của belief, KHÔNG phải của một vai riêng.
   */
  confidence: number;
  /** Nguồn gần nhất đụng tới player này, hoặc `undefined` khi chỉ có prior. */
  updatedAtEventId?: string;
}

export interface RoleBeliefInput {
  knowledge: BotKnowledgeView;
  state: BotBrainState;
  /**
   * Vai → số ghế trong bộ bài của ván (CÔNG KHAI: suy từ `RoomConfig` mà cả
   * phòng thấy ở sảnh chờ). Thiếu — knowledge cũ, record self-play cũ — thì
   * dùng fallback pool tối giản.
   */
  roleComposition?: Record<string, number>;
}

/** API đọc của spec §5, thích ứng với kiểu thật của project. */
export function getRoleProbability(
  beliefs: Record<string, RoleBelief>,
  playerId: string,
  role: string,
): number {
  return beliefs[playerId]?.probabilities[role] ?? 0;
}

export function getTeamProbability(
  beliefs: Record<string, RoleBelief>,
  playerId: string,
  team: Team,
): number {
  const belief = beliefs[playerId];
  if (!belief) return 0;
  let total = 0;
  for (const [role, probability] of Object.entries(belief.probabilities)) {
    if (roleTeam(role as Role) === team) total += probability;
  }
  return total;
}

/** `P(wolf-team)` — mọi vai `roleTeam === "wolves"`, gồm Sói Pháp Sư. */
export function getWolfProbability(
  beliefs: Record<string, RoleBelief>,
  playerId: string,
): number {
  return getTeamProbability(beliefs, playerId, "wolves");
}

/**
 * Pool từ composition; fallback cho knowledge cũ: Sói + Dân + mọi vai public
 * lọt mắt (neutralRolesInPlay, knownRoles). Không bao giờ rỗng.
 */
function poolOf(input: RoleBeliefInput): Record<string, number> {
  if (input.roleComposition) {
    const pool: Record<string, number> = {};
    for (const [role, count] of Object.entries(input.roleComposition)) {
      if (count > 0) pool[role] = count;
    }
    if (Object.keys(pool).length > 0) return pool;
  }

  const knowledge = input.knowledge;
  const pool: Record<string, number> = { WEREWOLF: 1, VILLAGER: 1 };
  for (const role of knowledge.neutralRolesInPlay) pool[role] = 1;
  for (const role of Object.values(knowledge.knownRoles)) pool[role] = 1;
  if (isRole(knowledge.selfRole)) pool[knowledge.selfRole] = 1;
  return pool;
}

function normalize(dist: Record<string, number>): Record<string, number> {
  const total = Object.values(dist).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return dist;
  const out: Record<string, number> = {};
  for (const [role, value] of Object.entries(dist)) out[role] = value / total;
  return out;
}

function topConfidenceOf(playerId: string, state: BotBrainState): number {
  const reasons = state.suspicion[playerId]?.reasons ?? [];
  return reasons.reduce((max, item) => Math.max(max, item.confidence), 0);
}

function latestSourceOf(playerId: string, state: BotBrainState): string | undefined {
  const reasons = state.suspicion[playerId]?.reasons ?? [];
  return reasons.at(-1)?.sourceId;
}

/**
 * Chiếu P(role) cho MỘT player chưa certain. `wolfRoles` là các vai phe Sói
 * còn trong pool; `nonWolfPool` là phần còn lại với trọng số composition.
 */
function uncertainBelief(
  playerId: string,
  input: RoleBeliefInput,
  pool: Record<string, number>,
): RoleBelief {
  const { knowledge, state } = input;
  const totalSeats = Object.values(pool).reduce((sum, value) => sum + value, 0);
  const wolfSeats = Object.entries(pool)
    .filter(([role]) => roleTeam(role as Role) === "wolves")
    .reduce((sum, [, count]) => sum + count, 0);
  const prior = totalSeats > 0 ? wolfSeats / totalSeats : 0;

  const suspicion = state.suspicion[playerId];
  const scalar = (suspicion?.score ?? 0) / MAX_BELIEF_SCORE;
  const hasEvidence = (suspicion?.reasons.length ?? 0) > 0;
  // Không bằng chứng = đứng nguyên ở prior; có bằng chứng = đi từ prior theo
  // scalar, vẫn không vượt 1. Monotone với scalar.
  const wolfMass = hasEvidence ? prior + scalar * (1 - prior) : prior;

  const wolfRoles = Object.keys(pool).filter((role) => roleTeam(role as Role) === "wolves");
  const probabilities: Record<string, number> = {};
  if (wolfMass > 0 && wolfRoles.length > 0) {
    // Khối lượng Sói chia giữa các vai phe Sói theo composition (WEREWOLF nhiều
    // ghế hơn ALPHA_WOLF thì nhận phần lớn hơn).
    const wolfWeight = wolfRoles.reduce((sum, role) => sum + pool[role]!, 0);
    for (const role of wolfRoles) {
      probabilities[role] = wolfMass * (pool[role]! / wolfWeight);
    }
  }

  // Phần không-Sói: chia theo composition, vai được claim nhận ưu tiên x3.
  const nonWolfRoles = Object.keys(pool).filter((role) => roleTeam(role as Role) !== "wolves");
  const remaining = 1 - wolfMass;
  if (nonWolfRoles.length > 0 && remaining > 0) {
    const claimed = new Set<string>(
      state.claims
        .filter((claim) => claim.actorId === playerId)
        .map((claim) => claim.data.role)
        .filter((role): role is string => typeof role === "string" && isRole(role)),
    );
    const weights = nonWolfRoles.map((role) => ({
      role,
      weight: pool[role]! * (claimed.has(role) ? 3 : 1),
    }));
    const weightSum = weights.reduce((sum, item) => sum + item.weight, 0);
    for (const item of weights) {
      probabilities[item.role] = (probabilities[item.role] ?? 0) + remaining * (item.weight / weightSum);
    }
  }

  return {
    playerId,
    probabilities: normalize(probabilities),
    confidence: hasEvidence ? Math.min(1, 0.25 + 0.5 * topConfidenceOf(playerId, state)) : 0.2,
    updatedAtEventId: latestSourceOf(playerId, state),
  };
}

/**
 * Chiếu toàn bộ roster thành bảng P(role). Thuần: cùng input → cùng bảng, không
 * RNG, không đụng state.
 */
export function projectRoleBeliefs(
  input: RoleBeliefInput,
): Record<string, RoleBelief> {
  const { knowledge, state } = input;
  const pool = poolOf(input);

  // Vai đã LỘ cho bot này: vai mình, knownRoles engine cấp (gồm vai mình, đồng
  // bọn Sói, và vai người chết khi luật/lộ cho phép). Mỗi vai chỉ đủ certain
  // cho MỘT người: engine không cấp hai người cùng một vai, còn projection không
  // được tự suy thêm.
  const certain = new Map<string, string>();
  if (isRole(knowledge.selfRole)) certain.set(knowledge.botId, knowledge.selfRole);
  for (const [playerId, role] of Object.entries(knowledge.knownRoles)) {
    if (isRole(role) && !certain.has(playerId)) certain.set(playerId, role);
  }

  // Pin soi của CHÍNH bot: ghim theo PHE (soi trả `team`), trừ khi người đó đã
  // certain bằng vai lộ — certain thắng vì nó nói đúng VAI.
  const seerPin = new Map<string, boolean>();
  if (knowledge.seerResult && !certain.has(knowledge.seerResult.targetId)) {
    seerPin.set(knowledge.seerResult.targetId, knowledge.seerResult.isWolf);
  }

  const beliefs: Record<string, RoleBelief> = {};
  for (const player of knowledge.players) {
    const certainRole = certain.get(player.id);
    if (certainRole !== undefined) {
      beliefs[player.id] = {
        playerId: player.id,
        probabilities: { [certainRole]: 1 },
        confidence: 1,
      };
      continue;
    }

    const pinnedWolf = seerPin.get(player.id);
    if (pinnedWolf !== undefined) {
      const probabilities: Record<string, number> = {};
      const wolfRoles = Object.keys(pool).filter((role) => roleTeam(role as Role) === "wolves");
      const restRoles = Object.keys(pool).filter((role) => roleTeam(role as Role) !== "wolves");
      if (pinnedWolf) {
        const weightSum = wolfRoles.reduce((sum, role) => sum + pool[role]!, 0);
        for (const role of wolfRoles) {
          probabilities[role] = pool[role]! / weightSum;
        }
      } else {
        const weightSum = restRoles.reduce((sum, role) => sum + pool[role]!, 0);
        for (const role of restRoles) {
          probabilities[role] = pool[role]! / weightSum;
        }
      }
      beliefs[player.id] = {
        playerId: player.id,
        probabilities: normalize(probabilities),
        confidence: 1,
        updatedAtEventId: `seer:${player.id}`,
      };
      continue;
    }

    beliefs[player.id] = uncertainBelief(player.id, input, pool);
  }

  return beliefs;
}
