import { roleTeam, type Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotBrainState, BotEvidence, BotKnowledgeView } from "../types";
import { applyEvidence, applyTrustEvidence } from "./belief-state";
import { MAX_BELIEF_SCORE } from "./evidence";

/**
 * Đưa thông tin RIÊNG của vai vào belief.
 *
 * Phase 1 ghi kết quả soi thành memory pinned rồi dừng ở đó, nên Tiên Tri soi
 * trúng Sói xong vẫn bỏ phiếu y như chưa soi - thông tin đắt nhất trong ván
 * không ảnh hưởng gì tới quyết định. Hàm này nối phần còn thiếu.
 *
 * Nguồn duy nhất được chấp nhận là `BotKnowledgeView`, tức thứ engine đã lọc
 * theo quyền của chính bot. Không có đường nào để một claim trong chat đi vào
 * đây: claim là lời nói, và nó được xử lý ở chat-analysis với sức nặng rất khác.
 */

/**
 * Ghim điểm thay vì để nó cộng dồn.
 *
 * `observe()` chạy nhiều lần mỗi vòng, và thông tin riêng là một sự thật CỐ
 * ĐỊNH chứ không phải một quan sát mới mỗi lần. Nếu để `updateBelief` cộng dồn
 * thì niềm tin của bot phụ thuộc vào việc scheduler gọi observe mấy lần - một
 * biến số không liên quan gì tới ván đấu, và đủ để phá tính tái lập.
 *
 * Evidence vẫn được áp trước đó vì nó là thứ ghi `reasons`, và `reasons` mới là
 * cái cho entry quyền miễn decay.
 */
function pinScore(
  entries: Record<string, { score: number; lastUpdatedRound: number }>,
  playerId: string,
  score: number,
  round: number,
): void {
  const entry = entries[playerId];
  if (!entry) return;
  entry.score = score;
  entry.lastUpdatedRound = round;
}

function seerSourceId(targetId: string): string {
  return `seer:${targetId}`;
}

/** Một vai mà bot biết CHẮC thuộc về ai, kèm nguồn để dựng bằng chứng. */
interface ProvenRoleHolder {
  holderId: string;
  holderName: string;
  role: Role;
  sourceId: string;
  /** Vì sao bot biết - đi thẳng vào `summary` của bằng chứng. */
  because: string;
}

function provenRoleHolders(knowledge: BotKnowledgeView): ProvenRoleHolder[] {
  const found: ProvenRoleHolder[] = [];

  const medium = knowledge.mediumResult;
  if (medium) {
    found.push({
      holderId: medium.targetId,
      holderName: medium.targetName,
      role: medium.role,
      sourceId: `medium:${medium.targetId}`,
      because: `hồn ${medium.targetName} mới là vai đó`,
    });
  }

  /*
   * Tiên Tri Tập Sự đọc thẳng từ `knownRoles`, không cần một trường riêng:
   * engine đã đặt Tiên Tri vào đó cho đúng người xem này, y hệt cách Sói thấy
   * bầy của mình.
   */
  if (knowledge.selfRole === "APPRENTICE_SEER") {
    for (const [playerId, role] of Object.entries(knowledge.knownRoles)) {
      if (playerId === knowledge.botId || role !== "SEER") continue;
      const name = knowledge.players.find((player) => player.id === playerId)?.name ?? playerId;
      found.push({
        holderId: playerId,
        holderName: name,
        role: "SEER",
        sourceId: `mentor:${playerId}`,
        because: `${name} mới là Tiên Tri thật`,
      });
    }
  }

  return found;
}

/**
 * Ai còn sống mà đang nhận `known.role` thì đang nói dối.
 *
 * Bỏ qua Dân Làng và mọi vai phe Sói: hai người cùng khai "Dân Làng" không mâu
 * thuẫn, và không ai đi khai mình là Sói. Mọi vai còn lại là lá đơn trong bộ
 * bài (cấu hình phòng bật/tắt bằng boolean), nên hai người cùng nhận là một
 * mâu thuẫn thật.
 */
function flagFalseClaimants(
  state: BotBrainState,
  knowledge: BotKnowledgeView,
  weights: BotWeights,
  known: ProvenRoleHolder,
): void {
  if (known.role === "VILLAGER" || roleTeam(known.role) === "wolves") return;

  const aliveIds = new Set(
    knowledge.players.filter((player) => player.alive).map((player) => player.id),
  );

  for (const claim of state.claims) {
    if (claim.actorId === knowledge.botId || claim.actorId === known.holderId) continue;
    if (!aliveIds.has(claim.actorId)) continue;
    if (claim.data.role !== known.role) continue;

    ensureSource(state, known.sourceId);
    applyEvidence(
      state,
      evidenceFor(
        {
          // Khoá theo CẶP (nguồn, người khai): một bot có nhiều nguồn khác nhau
          // sinh nhiều mâu thuẫn khác nhau, và chúng không được đè lên nhau.
          id: `false-claim:${known.sourceId}:${claim.actorId}`,
          kind: "PROVEN_FALSE_CLAIM",
          sourceId: known.sourceId,
          actorId: claim.actorId,
          weight: weights.privateInfo.provenFalseClaim,
          summary: `${known.because}, nên lời khai này là dối`,
        },
        knowledge.round,
      ),
      weights,
    );
  }
}

function allySourceId(allyId: string): string {
  return `ally:${allyId}`;
}

/**
 * Đăng ký một source tổng hợp.
 *
 * `validateEvidence` từ chối mọi evidence có source chưa từng thấy - đó là hàng
 * rào chống bịa bằng chứng của Phase 1 và không được nới. Thông tin riêng không
 * đến từ một message hay mutation nào, nên nó cần một source ID ổn định do
 * chính lõi phát ra: khoá theo target, để áp lại nhiều lần vẫn là cùng một
 * nguồn thay vì một chuỗi nguồn mới mỗi lần observe.
 */
function ensureSource(state: BotBrainState, sourceId: string): void {
  if (!state.seenEventIds.includes(sourceId)) state.seenEventIds.push(sourceId);
}

function evidenceFor(
  over: Pick<BotEvidence, "id" | "kind" | "sourceId" | "actorId" | "weight" | "summary"> &
    Partial<BotEvidence>,
  round: number,
): BotEvidence {
  return { confidence: 1, round, targetId: undefined, ...over };
}

export function applyPrivateInformation(
  state: BotBrainState,
  knowledge: BotKnowledgeView,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): void {
  const round = knowledge.round;
  const result = knowledge.seerResult;

  /*
   * LỜI KHAI BỊ CHỨNG MINH LÀ DỐI.
   *
   * Hai vai đi vào đây bằng hai đường nhưng cùng một suy luận: bot biết CHẮC
   * một vai thuộc về ai, và một người CÒN SỐNG khác đang nhận đúng vai đó.
   *  - Bà Đồng: gọi hồn đọc ra vai thật của một cái xác.
   *  - Tiên Tri Tập Sự: được chỉ mặt Tiên Tri từ đêm 1.
   *
   * Gộp một chỗ chứ không chép đôi: phần dễ trôi lệch nhất là bộ điều kiện loại
   * trừ, không phải phần áp bằng chứng.
   */
  for (const known of provenRoleHolders(knowledge)) {
    flagFalseClaimants(state, knowledge, weights, known);
  }
  if (result) {
    const sourceId = seerSourceId(result.targetId);
    ensureSource(state, sourceId);

    if (result.isWolf) {
      // Đẩy thẳng lên trần thay vì cộng dồn: soi trúng Sói là chắc chắn, và một
      // giá trị cố định khiến việc áp lại nhiều lần trong cùng một vòng là
      // idempotent.
      applyEvidence(
        state,
        evidenceFor(
          {
            id: `seer-wolf:${result.targetId}`,
            kind: "SEER_RESULT_WOLF",
            sourceId,
            actorId: result.targetId,
            weight: weights.privateInfo.seerWolf,
            summary: `soi ra ${result.targetName} là Sói`,
          },
          round,
        ),
        weights,
      );
      pinScore(state.suspicion, result.targetId, MAX_BELIEF_SCORE, round);
    } else {
      /*
       * "Không phải Sói" và "người của làng" là HAI điều khác nhau, và chỉ điều
       * đầu tiên là thứ lượt soi vừa chứng minh.
       *
       * Một mục tiêu TRUNG LẬP vẫn được xoá sạch nghi ngờ - nó thật sự không
       * phải Sói, nên treo nó là tiêu một ngày của làng. Nhưng nó KHÔNG được
       * ghim tin tưởng lên trần như một người làng: nó không chơi cho làng, và
       * một Tiên Tri đi bảo lãnh cho nó bằng uy tín của mình sẽ trả giá đúng
       * lúc nó bắt đầu phá. `neutralClear` vì thế nhẹ hơn `seerClear`.
       */
      const neutral = result.team === "neutral";
      /*
       * Cùng một kết quả soi, HAI kết luận trái ngược - vì câu hỏi đã đổi.
       *
       * Trong một ván chỉ có Thằng Hề, "trung lập" nghĩa là "không phải Sói và
       * không giết ai": treo nó là phí một ngày, nên nhánh dưới xoá nghi ngờ.
       * Trong một ván CÓ Sát Nhân thì đúng cái nhãn ấy là ứng viên số một cho
       * kẻ đang giết người mỗi đêm, và một Tiên Tri đem uy tín ra bảo lãnh cho
       * nó là đang bảo lãnh cho hung thủ.
       *
       * Điều kiện đọc từ BỘ BÀI, thứ cả phòng nhìn thấy ở sảnh chờ - không phải
       * từ một suy luận nào về người bị soi. Tiên Tri KHÔNG phân biệt được hai
       * vai trung lập, và mã dưới đây cũng không: nó chỉ nói "trong ván này,
       * một kẻ trung lập là một mối nguy".
       */
      const neutralIsLethal =
        neutral && knowledge.neutralRolesInPlay.includes("SERIAL_KILLER");

      if (neutralIsLethal) {
        applyEvidence(
          state,
          evidenceFor(
            {
              id: `seer-neutral-threat:${result.targetId}`,
              kind: "SEER_RESULT_CLEAR",
              sourceId,
              actorId: result.targetId,
              weight: weights.privateInfo.neutralKillerSuspicion,
              summary: `soi ra ${result.targetName} thuộc phe trung lập - ván này có Sát Nhân`,
            },
            round,
          ),
          weights,
        );
        // Ghim cả hai đầu, đúng mốc: không tin tưởng, và một mức nghi ngờ đủ
        // cao để BOT dám đề cử nhưng chưa phải là chắc chắn.
        pinScore(state.trust, result.targetId, 0, round);
        pinScore(
          state.suspicion,
          result.targetId,
          weights.privateInfo.neutralKillerSuspicion,
          round,
        );
      } else {
        applyTrustEvidence(
          state,
          evidenceFor(
            {
              id: `seer-clear:${result.targetId}`,
              kind: "SEER_RESULT_CLEAR",
              sourceId,
              actorId: result.targetId,
              weight: neutral
                ? weights.privateInfo.neutralClear
                : weights.privateInfo.seerClear,
              summary: neutral
                ? `soi ra ${result.targetName} thuộc phe trung lập`
                : `soi ra ${result.targetName} không phải Sói`,
            },
            round,
          ),
          weights,
        );
        /*
         * GHIM cả hai nhánh, chỉ khác MỐC.
         *
         * `pinScore` không phải một chi tiết trang trí: nó là thứ làm cho việc áp
         * lại cùng một kết quả trở nên idempotent, và `observe()` thì chạy nhiều
         * lần mỗi vòng. Bản đầu của nhánh trung lập chỉ bỏ lời gọi ghim đi - với
         * ý đúng là "đừng lên trần" - nhưng hệ quả là `applyTrustEvidence` cộng
         * dồn mỗi lần gọi: cùng một lượt soi cho ra 29.88 → 59.76 → 89.64 → 100
         * chỉ vì scheduler gọi bốn lần, trong khi danh sách bằng chứng vẫn đúng
         * một mục.
         *
         * Mốc thấp hơn trần giữ nguyên điều cần giữ: "không phải Sói" KHÁC
         * "đồng đội thuộc phe Dân".
         */
        pinScore(
          state.trust,
          result.targetId,
          neutral ? weights.privateInfo.neutralClearTrust : MAX_BELIEF_SCORE,
          round,
        );
        // Đã biết chắc không phải Sói thì mọi nghi ngờ tích trước đó là rác.
        pinScore(state.suspicion, result.targetId, 0, round);
      }
    }
  }

  // Chỉ Sói mới có đồng đội. Cổng này KHÔNG thừa: biến thể luật
  // `revealRoleOnDeath` đưa vai người chết vào `knownRoles` cho mọi người, nên
  // không có nó thì một bot phe làng đọc thấy một cái xác Sói và ghim
  // `trust = 100` / `suspicion = 0` lên đúng kẻ vừa bị lộ mặt - và `KNOWN_ALLY`
  // được miễn decay nên nó không bao giờ tự gỡ. Ngược hẳn dấu của sự thật.
  if (roleTeam(knowledge.selfRole) !== "wolves") return;

  for (const [playerId, role] of Object.entries(knowledge.knownRoles)) {
    if (playerId === state.playerId) continue;
    if (role !== "WEREWOLF") continue;

    const sourceId = allySourceId(playerId);
    ensureSource(state, sourceId);
    applyTrustEvidence(
      state,
      evidenceFor(
        {
          id: `ally:${playerId}`,
          kind: "KNOWN_ALLY",
          sourceId,
          actorId: playerId,
          weight: weights.privateInfo.knownAlly,
          summary: "đồng đội Sói do engine xác nhận",
        },
        round,
      ),
      weights,
    );
    pinScore(state.trust, playerId, MAX_BELIEF_SCORE, round);
    pinScore(state.suspicion, playerId, 0, round);
  }
}
