import type {
  BotBrainState,
  BotDecisionContext,
  BotNightIntention,
  BotRng,
} from "../types";
import type { Role } from "@masoi/shared";
import { incomingHostilityOf } from "../analysis/social-analysis";
import { MAX_BELIEF_SCORE } from "../belief/evidence";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { wolfBluffSeat } from "../decision/claim-decision";
import { fnv1a32 } from "../hash";
import { nightEvidence, type BotRoleStrategy } from "./strategy";
import { rankNightTargets } from "./night-scoring";
import { wolfThreatScore } from "./wolf-team-plan";

/** Vai thuộc bầy mà `knownRoles` của một con Sói còn sống liệt kê. */
function isPackRole(role: Role | undefined): boolean {
  return role === "WEREWOLF" || role === "WOLF_CUB";
}

/**
 * Đồng bọn mà con Sói này CÃI GIẢ ở vòng này, hoặc `null`.
 *
 * "Hai đứa này chưa từng nghi nhau" là tín hiệu người thật đọc ra sau hai ván,
 * và bot chưa từng định phát ra nó. Cuộc cãi giả là một lá phiếu nhẹ vào đồng
 * bọn ở vòng 1-2, đúng lúc nó rẻ nhất: chưa ai bầu hay công kích con Sói nào,
 * nên một phiếu lẻ không đưa được ai lên xử, mà cặp Sói từ đó có một lịch sử
 * từng nghi nhau.
 *
 * Bốn luật, tất cả CỤC BỘ và TẤT ĐỊNH - mọi con trong bầy tính ra cùng đáp án
 * từ dữ liệu cả bầy cùng thấy, không cần kênh đồng bộ, và KHÔNG rút RNG:
 *
 * 1. Cổng `fakeFightChance <= 0` đứng đầu: v1..v15 ra khỏi hàm mà không đọc
 *    thêm gì.
 * 2. Chỉ ở vòng `1..fakeFightUntilRound`, bầy còn >= 2, và chưa có áp lực
 *    công khai (phiếu hay công kích) lên bất kỳ con nào.
 * 3. Mỗi vòng đúng MỘT ghế mở miệng, chốt bằng hash như `wolfBluffSeat`, và
 *    không phải ghế đang bluff Tiên Tri vòng đó - một con vừa khai Tiên Tri
 *    vừa bầu đồng bọn là một lời "soi ra Sói" thật, tức bán đứng chứ không
 *    phải diễn.
 * 4. Canh bạc `chance x deceptionSkill` chốt bằng hash trên (bầy, vòng,
 *    deceptionSkill) thay vì `rng()`: hai lần hỏi trong cùng vòng (thảo luận
 *    rồi bỏ phiếu) phải cho cùng đáp án, nếu không con Sói tự mâu thuẫn giữa
 *    lời nói và lá phiếu. `deceptionSkill` là muối theo ván - cùng bầy cùng
 *    vòng ở hai ván khác seed vẫn ra hai kết quả khác nhau.
 *
 * EXPORT vì `selectVote` là nơi biến nó thành số hạng điểm.
 */
export function fakeFightTarget(
  context: BotDecisionContext,
  state: BotBrainState,
  weights: BotWeights,
): string | null {
  const chance = weights.deceptionRisk.fakeFightChance;
  if (chance <= 0) return null;

  const knowledge = context.knowledge;
  const round = knowledge.round;
  if (round < 1 || round > weights.deceptionRisk.fakeFightUntilRound) return null;

  const me = state.playerId;
  if (!isPackRole(knowledge.knownRoles[me])) return null;

  const alive = new Set(knowledge.players.filter((p) => p.alive).map((p) => p.id));
  // Cả bầy kể cả đã chết là KHOÁ của ván (như `wolfBluffSeat`); còn sống là
  // danh sách ghế.
  const roster = Object.entries(knowledge.knownRoles)
    .filter(([, role]) => isPackRole(role))
    .map(([id]) => id)
    .sort();
  const pack = roster.filter((id) => alive.has(id));
  if (pack.length < 2 || !pack.includes(me)) return null;

  for (const id of pack) {
    if ((knowledge.currentVoteCounts.players[id] ?? 0) > 0) return null;
    if (incomingHostilityOf(state, id) > 0) return null;
  }

  const key = roster.join(",");
  const bluffSeat = wolfBluffSeat(pack, roster, round);
  const seats = pack.filter((id) => id !== bluffSeat);
  if (seats.length === 0) return null;
  const accuser = seats[fnv1a32(`fake-fight|${key}|${round}`) % seats.length];
  if (accuser !== me) return null;

  const roll =
    (fnv1a32(`fake-fight-roll|${key}|${round}|${state.personality.deceptionSkill}`) % 10_000) /
    10_000;
  if (roll >= chance * state.personality.deceptionSkill) return null;

  const others = pack.filter((id) => id !== me);
  return others[fnv1a32(`fake-fight-target|${key}|${round}`) % others.length] ?? null;
}

/** Vai có thể lật ngược ván đấu nếu sống thêm một đêm. */
const POWER_ROLES = new Set(["SEER", "WITCH", "GUARD", "HUNTER"]);
void POWER_ROLES;

/**
 * Sói chọn nạn nhân theo mức NGUY HIỂM với phe Sói, không theo mức đáng ngờ.
 *
 * Đây là chỗ dễ sai nhất khi tái dùng lõi ban ngày: `suspicion` đo "ai giống
 * Sói", mà Sói thì đã biết ai là Sói rồi. Cắn người đang bị cả làng nghi là
 * lãng phí gấp đôi - làng sẽ tự treo người đó vào hôm sau, còn Sói thì mất một
 * đêm để giết một người vô hại với mình.
 *
 * PR 5b: công thức sống ở `wolf-team-plan.ts::wolfThreatScore` — nguồn DUY
 * NHẤT cho cả lượt cắn lẫn team plan, không còn hai bảng tự trôi.
 */

/**
 * `role` là tham số vì Sói Con dùng ĐÚNG chiến lược này: nó cắn cùng bầy, và
 * cơ chế "chết thì bầy được cắn hai" nằm ở engine chứ không ở lựa chọn của nó.
 * Truyền vai vào thay vì hard-code giữ cho `strategyFor(r).role === r` luôn đúng.
 */
export function werewolfStrategy(
  role: Role = "WEREWOLF",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  return {
    role,

    decideNight(context, state, rng, probe, policy): BotNightIntention | null {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("KILL")) {
        probe?.fallback("không có lượt cắn nào đang mở");
        return null;
      }

      const allies = new Set(
        Object.entries(context.knowledge.knownRoles)
          .filter(([, role]) => role === "WEREWOLF")
          .map(([id]) => id),
      );

      // Lọc đồng bọn lần nữa dù engine đã lọc. Hai lớp là có chủ đích: engine
      // bảo vệ luật, còn lớp này bảo vệ chiến thuật khỏi một thay đổi ở engine.
      const candidates = night.legalTargets.KILL.filter((id) => !allies.has(id));
      if (candidates.length === 0) {
        probe?.fallback("không còn mục tiêu nào ngoài bầy Sói");
        return null;
      }

      // `wolfThreatScore` thuần và không rút RNG, nên tính sẵn một lần cho từng
      // ứng viên: bảng term cần `score`, còn evidence cần `reason` của người thắng.
      const threatByTarget = new Map(
        candidates.map((targetId) => [targetId, wolfThreatScore(state, targetId, weights)]),
      );
      const scored = rankNightTargets(candidates, {
        weights,
        rng,
        probe,
        action: "KILL",
        policy,
        termsFor: (targetId) => [
          { name: "threat", value: threatByTarget.get(targetId)!.score },
        ],
      });

      const winner = scored[0];
      // Cuộc Săn Đẫm Máu và Sói Con phẫn nộ cùng mở một mục tiêu phụ; engine đã
      // gộp cả hai vào `bonusSecondTargetFor`, nên ở đây chỉ còn một điều kiện.
      // `scored` đã lọc đồng bọn nên con thứ hai cũng an toàn theo luật.
      const runnerUp =
        night.bonusSecondTargetFor === "KILL" ? (scored[1]?.targetId ?? null) : null;

      return {
        kind: "NIGHT_ACTION",
        action: "KILL",
        targetId: winner.targetId,
        secondaryTargetId: runnerUp,
        confidence: Math.min(1, Math.max(0, winner.score / MAX_BELIEF_SCORE)),
        evidence: [
          nightEvidence(
            "ACCUSE",
            context.knowledge.round,
            winner.targetId,
            threatByTarget.get(winner.targetId)!.reason,
            0,
            weights,
          ),
        ],
      };
    },

    voteBias(context) {
      const bias: Record<string, number> = {};
      for (const [playerId, role] of Object.entries(context.knowledge.knownRoles)) {
        if (playerId === context.knowledge.botId) continue;
        if (role === "WEREWOLF") bias[playerId] = weights.teammateProtection.voteBiasPenalty;
      }
      return bias;
    },
  };
}
