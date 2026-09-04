import type { Role } from "@masoi/shared";
import { socialEdgeKey } from "../analysis/social-analysis";
import { MAX_BELIEF_SCORE } from "../belief/evidence";
import { voteLeader } from "../decision/claim-decision";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { sumTerms, type TraceTerm } from "../trace/trace";
import type { BotBrainState } from "../types";
import { nightEvidence, type BotRoleStrategy } from "./strategy";

/**
 * Sát Nhân: chơi để CÒN LẠI MỘT MÌNH.
 *
 * Ngược hẳn Thằng Hề ở mọi trục, và đó là lý do hai vai trung lập không được
 * dùng chung một file. Hề đi tìm sự chú ý và chấp nhận chết; Sát Nhân đi tìm sự
 * vô hình và phải sống tới người cuối cùng. Hai đòn bẩy:
 *
 * 1. **Ban đêm** - chọn đúng người mà làng sẽ KHÔNG treo hộ. Đó là người được
 *    tin nhất, và cũng là người lái được cuộc bỏ phiếu ngày mai. Người đang bị
 *    cả làng nghi thì để làng tự xử: mỗi bản án là một mạng mà Sát Nhân không
 *    phải trả bằng một đêm.
 * 2. **Ban ngày** - hùa theo đám đông. Đứng lạc lõng là cách Hề leo lên giá
 *    treo, nên nó cũng đúng là cách Sát Nhân bị treo.
 *
 * Ba điều nó KHÔNG được làm, và cả ba đều là ranh giới thông tin chứ không phải
 * một lựa chọn chiến thuật:
 *
 * - Không đọc `knownRoles` của ai ngoài chính mình. Engine chỉ cấp danh sách
 *   đồng bọn cho phe Sói; Sát Nhân không có bầy nào để mà biết.
 * - Không suy ra "ai là Sói" từ việc mình đâm ai và ai chết. Nó biết nạn nhân
 *   của CHÍNH nó, không biết nạn nhân của bầy Sói - và ghép hai cái chết trong
 *   một đêm thành một suy luận là dựng lại một sự thật mà nó không được cấp.
 * - Không nhắm đồng bọn: nó không có đồng bọn. `legalTargets.SERIAL_KILL` vì
 *   thế gồm CẢ Sói, và điều đó là đúng - một con Sói chết cũng là một người bớt
 *   đi giữa nó và chiến thắng.
 */

/**
 * Người mà chính Sát Nhân đã ra tay ĐÊM TRƯỚC và vẫn còn sống.
 *
 * Chỉ xảy ra khi nhát dao bị chặn (khiên của Bảo Vệ / Thiên Thần, hoặc bình cứu
 * của Phù Thuỷ). Khi đó Sát Nhân là người DUY NHẤT trên bàn biết rằng người kia
 * vừa được che chắn - và chỉ tay vào họ ngay hôm sau là tự khai ra rằng mình
 * biết một chuyện không ai biết.
 *
 * Đọc từ `previousNightActions` (nước đi của chính mình) chứ không từ memory:
 * memory ghi những gì BOT quan sát được từ bên ngoài, và cú đâm này thì không
 * ai quan sát được.
 */
function ownSurvivingVictims(
  previousNightActions: ReadonlyArray<{ action: string; targetId: string | null }>,
  aliveIds: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const move of previousNightActions) {
    if (move.action !== "SERIAL_KILL") continue;
    if (move.targetId && aliveIds.has(move.targetId)) out.add(move.targetId);
  }
  return out;
}

/**
 * Mức thù địch mà `fromId` hướng VÀO `toId` - một cạnh, đọc đúng chiều.
 *
 * KHÔNG dùng `incomingHostilityOf` cho việc này. Hàm kia trung bình mọi cạnh
 * đi VÀO một người, tức "cả làng đang công kích người đó bao nhiêu" - một phép
 * đo ảnh hưởng, và ba consumer hiện có (phiếu ban ngày, bầy Sói, Bảo Vệ) đều
 * cần đúng nghĩa ấy. Cái Sát Nhân cần thì ngược chiều hẳn: ứng viên đang công
 * kích CHÍNH NÓ bao nhiêu. Đọc nhầm chiều biến số hạng "tự vệ" thành ra ưu
 * tiên đâm người đang bị cả làng chửi - đúng người mà cùng bảng điểm ấy vừa
 * trừ điểm qua `crowdSuspicion`, và cũng đúng người làng sắp treo hộ.
 *
 * Ghép khoá bằng `socialEdgeKey` chứ không tự nối chuỗi: quy ước khoá là của
 * `social-analysis`, và một dấu `->` viết tay ở đây là một chỗ để trôi lệch.
 */
function hostilityToward(state: BotBrainState, fromId: string, toId: string): number {
  return state.relationships[socialEdgeKey(fromId, toId)]?.hostility ?? 0;
}

export function serialKillerStrategy(
  _role: Role = "SERIAL_KILLER",
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotRoleStrategy {
  const tuning = weights.serialKiller;

  return {
    role: "SERIAL_KILLER",

    decideNight(context, state, rng, probe) {
      const night = context.knowledge.night;
      if (!night || !night.legalActions.includes("SERIAL_KILL")) {
        probe?.fallback("không có lượt ra tay nào đang mở");
        return null;
      }

      const candidates = night.legalTargets.SERIAL_KILL;
      if (candidates.length === 0) {
        probe?.fallback("không còn ai để nhắm tới");
        return null;
      }

      const round = context.knowledge.round;

      /*
       * Cổng tái lập, cùng dạng với cổng của nhóm `claim` và nhóm `jester`.
       *
       * Cấu hình chưa bật hành vi Sát Nhân (v1-v7) thì hàm này chốt bằng một
       * luật TẤT ĐỊNH và không rút một số ngẫu nhiên nào - đó là điều kiện để
       * mọi ván tái lập khoá theo các phiên bản đó vẫn đúng từng bit.
       */
      if (tuning.nightThreatWeight === 0) {
        const fallback = [...candidates].sort((a, b) => a.localeCompare(b))[0];
        probe?.fallback("cấu hình chưa bật chiến thuật Sát Nhân");
        return {
          kind: "NIGHT_ACTION",
          action: "SERIAL_KILL",
          targetId: fallback,
          confidence: 0,
          evidence: [],
        };
      }

      const aliveIds = new Set(
        context.knowledge.players.filter((player) => player.alive).map((player) => player.id),
      );
      const shielded = ownSurvivingVictims(state.previousNightActions, aliveIds);

      const scored = candidates
        .map((targetId) => {
          const trust = state.trust[targetId]?.score ?? 0;
          const suspicion = state.suspicion[targetId]?.score ?? 0;
          const hostility = hostilityToward(state, targetId, context.knowledge.botId);

          const terms: TraceTerm[] = [
            { name: "trust", value: trust * tuning.nightTrustWeight },
            { name: "hostility", value: hostility * tuning.nightHostilityWeight },
            // Âm: làng đang nghi sẵn thì để làng tự treo, đừng tiêu một đêm.
            { name: "crowdSuspicion", value: -suspicion * tuning.nightSuspicionDiscount },
            {
              name: "shieldedBefore",
              value: shielded.has(targetId) ? -tuning.avoidOwnVictimWeight : 0,
            },
          ];
          const total = sumTerms(terms) * tuning.nightThreatWeight;
          probe?.candidate({ targetId, score: total, terms, evidenceIds: [] });
          return { targetId, score: total, trust, hostility };
        })
        // Phá hoà theo id để hai lần chạy cùng seed không đảo thứ tự.
        .sort((a, b) => b.score - a.score || a.targetId.localeCompare(b.targetId));

      const best = scored[0];

      /*
       * Một đêm bình yên, và nó là một ĐÒN chứ không phải sự do dự.
       *
       * Chỉ dám bỏ khi hai điều kiện cùng đúng: đã đủ muộn để một đêm trống
       * không lãng phí (hai mạng đầu đáng giá hơn mọi màn đánh lừa), và bảng
       * điểm đêm nay không chỉ ra ai đủ nguy hiểm - `best.score <= 0` nghĩa là
       * người đứng đầu cũng đang bị làng nghi hơn là được làng tin, tức là làng
       * đang tự làm việc hộ.
       *
       * Lượt rút số nằm SAU cổng tái lập ở trên, nên nó không tồn tại với v1-v7.
       */
      if (round >= tuning.quietNightFromRound && best.score <= 0) {
        const dare = tuning.quietNightChance * state.personality.riskTolerance;
        if (rng() < dare && night.legalActions.includes("SKIP")) {
          probe?.fallback("bỏ một đêm để làng tin rằng chỉ có bầy Sói đang giết người");
          return {
            kind: "NIGHT_ACTION",
            action: "SKIP",
            targetId: null,
            confidence: 0.5,
            evidence: [],
          };
        }
      }

      return {
        kind: "NIGHT_ACTION",
        action: "SERIAL_KILL",
        targetId: best.targetId,
        confidence: Math.min(1, Math.max(0, best.score / MAX_BELIEF_SCORE)),
        evidence: [
          nightEvidence(
            "ACCUSE",
            round,
            best.targetId,
            "được làng tin và lái được cuộc bỏ phiếu, nên làng sẽ không treo hộ",
            0,
            weights,
          ),
        ],
      };
    },

    /**
     * Ban ngày: đi CÙNG đám đông, và tránh chỉ vào người mình vừa đâm hụt.
     *
     * Không có thông tin riêng nào để thiên vị bằng - Sát Nhân không biết vai
     * của ai. Cái nó có là một mục tiêu duy nhất: đừng là người bị treo hôm
     * nay. Cả hai số hạng dưới đây phục vụ đúng mục tiêu đó, và cả hai đều rút
     * từ dữ liệu CÔNG KHAI (bảng kiểm phiếu) hoặc từ nước đi của chính nó.
     */
    voteBias(context, state) {
      const bias: Record<string, number> = {};

      // Cổng tái lập, cùng cổng với `decideNight`.
      if (tuning.bandwagonBonus === 0 && tuning.avoidOwnVictimWeight === 0) return bias;

      const knowledge = context.knowledge;
      const leader = voteLeader(knowledge.currentVoteCounts.players);
      const aliveIds = new Set(
        knowledge.players.filter((player) => player.alive).map((player) => player.id),
      );
      const shielded = ownSurvivingVictims(state.previousNightActions, aliveIds);

      for (const player of knowledge.players) {
        if (!player.alive || player.id === knowledge.botId) continue;
        const bandwagon = player.id === leader ? tuning.bandwagonBonus : 0;
        const avoid = shielded.has(player.id) ? -tuning.avoidOwnVictimWeight : 0;
        if (bandwagon !== 0 || avoid !== 0) bias[player.id] = bandwagon + avoid;
      }

      return bias;
    },
  };
}
