import { roleTeam, type Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotBrainState, BotDecisionContext, BotMemory, BotRng } from "../types";

/**
 * Vai BOT công khai nhận trong Ngày Sự Thật.
 *
 * `null` là "không tiết lộ" - engine chấp nhận, nhưng lõi hiện không bao giờ
 * chọn nó: im lặng giữa một ngày cả làng cùng khai là tự chỉ vào mình, và nó
 * làm sự kiện mất hết sức nặng trong bàn nhiều BOT.
 */
export interface BotClaimIntention {
  role: Role | null;
  reason: string;
}

/**
 * Vai an toàn để nấp sau. Đây là lời nói dối của Sói và cũng là sự thật của
 * Dân Làng - đó chính là lý do nó nấp được.
 */
const COVER: Role = "VILLAGER";

/**
 * Ngày Sự Thật KHÔNG xác thực gì cả: engine chỉ ghi lại chuỗi người chơi gửi
 * lên. Nên câu hỏi ở đây không phải "vai của tôi là gì" mà là "nói ra thì được
 * gì và mất gì".
 *
 * Mặc định là giấu. Khai một vai chức năng ban ngày đồng nghĩa với việc chỉ cho
 * bầy Sói biết đêm nay cắn ai, và đổi lại làng chẳng có cách nào kiểm chứng.
 *
 * Ngoại lệ duy nhất là Tiên Tri đang CẦM một kết quả soi trúng Sói. Lúc đó lời
 * khai không còn là thông tin về bản thân mà là bằng chứng để treo đúng người
 * ngay hôm nay, và cái giá phải trả - chết đêm nay - đến sau khi đã thu được
 * giá trị. Soi ra người sạch thì không đủ: nó không chỉ được ai cả.
 */
export function decideRoleClaim(
  context: BotDecisionContext,
  state: BotBrainState,
): BotClaimIntention {
  const role = context.knowledge.selfRole;

  if (roleTeam(role) === "wolves") {
    return { role: COVER, reason: "Sói không bao giờ tự khai" };
  }

  const canSee = role === "SEER" || role === "APPRENTICE_SEER";
  const foundWolf = state.knownInformation.seerResults.some(
    (memory) => memory.data.isWolf === true,
  );
  if (canSee && foundWolf) {
    return { role, reason: "đang cầm một kết quả soi trúng Sói nên khai để làng dùng được" };
  }

  if (role === COVER) {
    return { role: COVER, reason: "nói thật vì sự thật cũng chính là chỗ nấp" };
  }

  return { role: COVER, reason: "giấu vai chức năng để không thành mục tiêu cắn đêm nay" };
}

export type ClaimKind = "PROACTIVE" | "UNDER_FIRE" | "COUNTER";

export interface BotChatClaimIntention {
  role: Role;
  kind: ClaimKind;
  /** Người mà lời khai chỉ mặt, hoặc `null` khi lời khai không chỉ ai. */
  accusedId: string | null;
  /** Chỉ `COUNTER`: người đang bị đè lên. */
  counterTargetId: string | null;
  reason: string;
}

/**
 * Vai có kết quả riêng chỉ được đích danh một người.
 *
 * KHÔNG có Thám Tử: `state.knownInformation.seerResults` chỉ được nạp ở đúng
 * một chỗ (`BotRuntime.ingestSeerResult`), và chỉ từ `knowledge.seerResult` -
 * trường engine chỉ cấp cho hành động SEE. Kỹ năng của Thám Tử
 * (`DETECTIVE_CHECK`) so hai người xem có cùng phe hay không, không bao giờ
 * chỉ đích danh một con Sói, nên nó không bao giờ tạo ra một mục trong
 * `seerResults` để mà khai. Tiên Tri Tập Sự vẫn ở đây vì nó thừa kế đúng hành
 * động SEE khi Tiên Tri chết.
 */
const INFORMANT_ROLES = new Set<Role>(["SEER", "APPRENTICE_SEER"]);

/** Vai chức năng mà một con Sói bị dồn có thể nấp sau. Thứ tự là thứ tự ưu tiên. */
const BLUFF_COVERS: readonly Role[] = ["GUARD", "WITCH", "HUNTER", "PRIEST"];

/**
 * Vai chức năng của phe làng - mọi vai trừ Dân Làng trần.
 *
 * Cùng khái niệm đã dùng ngầm ở `INFORMANT_ROLES` (một tập con) và ở nhánh
 * UNDER_FIRE bên dưới (`role !== "VILLAGER"`); đặt tên ra để COUNTER Case A
 * dùng lại thay vì tự định nghĩa một khái niệm "vai chức năng" thứ hai.
 */
function isPowerRole(role: Role): boolean {
  return role !== "VILLAGER";
}

/** `state.claims` theo thứ tự tất định, CŨ trước: vòng trước, rồi tới nguồn phát sinh. */
function claimsInOrder(state: BotBrainState): BotMemory[] {
  return [...state.claims].sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    return a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0;
  });
}

/**
 * `state.claims` theo thứ tự tất định, MỚI trước - đảo ngược `claimsInOrder`.
 *
 * Dùng cho COUNTER Case B: khi một Sói bị gọi tên hai lần trước khi tới lượt
 * nói, bàn đang phản ứng với lời buộc tội GẦN NHẤT, không phải lời đầu tiên.
 */
function claimsMostRecentFirst(state: BotBrainState): BotMemory[] {
  return claimsInOrder(state).reverse();
}

/** Ai đang dẫn phiếu ngay lúc này, hoặc `null` khi chưa ai bị dồn. */
function voteLeader(counts: Record<string, number>): string | null {
  let leader: string | null = null;
  let best = 0;
  // Duyệt theo khoá đã sắp: hoà phiếu không được phụ thuộc thứ tự chèn.
  for (const id of Object.keys(counts).sort()) {
    const votes = counts[id] ?? 0;
    if (votes > best) {
      leader = id;
      best = votes;
    }
  }
  return leader;
}

/** Vai đã có người công khai nhận, kể cả người đã chết. */
function alreadyClaimed(state: BotBrainState): Set<Role> {
  return new Set(state.claims.map((memory) => memory.data.role as Role));
}

/**
 * Lời khai tự phát trong khung chat.
 *
 * Tách khỏi `decideRoleClaim` (Ngày Sự Thật) vì hai câu hỏi khác nhau: sự kiện
 * hỏi "bị bắt khai thì khai gì", còn hàm này hỏi "có đáng mở miệng lúc này
 * không". Nhưng chúng chia sẻ đúng một lý lẽ nền — vai chức năng khai ban ngày
 * là tự xin bị cắn đêm nay — nên hai chỗ không được mâu thuẫn nhau.
 *
 * `null` là kết quả thường gặp nhất và là kết quả đúng: im lặng.
 */
export function decideChatClaim(
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
  // Mục tiêu Sói định treo hôm nay, truyền vào thay vì đọc `state.currentTargets`.
  // Trường đó chỉ được `decideVote` gán, không phải `observe`; hôm nay
  // `decideVote` luôn chạy trước `decideSpeech` nên nó tình cờ có giá trị, nhưng
  // thứ tự đó không được ghi ở đâu cả. Nếu ai đó đảo lại, đọc thẳng từ state sẽ
  // âm thầm cho Sói khai láo mà không chỉ đích danh ai — sai mà không test nào
  // đỏ. Tham số hoá để lỗi đó không thể xảy ra: `planSpeech` (Task 4) truyền
  // đúng ý định phiếu vừa chốt.
  voteTargetId: string | null,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotChatClaimIntention | null {
  // Cổng tái lập. Phải đứng TRƯỚC mọi lượt rút số: v1/v2/v3 đi qua đây và phải
  // ra khỏi hàm mà không đụng vào chuỗi RNG.
  if (weights.claim.accusationWeight <= 0) return null;

  // Một BOT, một vai, cả ván.
  if (state.myClaim !== null) return null;

  const knowledge = context.knowledge;
  const role = knowledge.selfRole;
  const me = state.playerId;
  const isWolf = roleTeam(role) === "wolves";
  const alivePlayers = new Set(knowledge.players.filter((p) => p.alive).map((p) => p.id));

  // ---- COUNTER: có người khác đang khai đúng vai thật của mình ----
  //
  // Đứng TRƯỚC cả hai nhánh PROACTIVE có chủ đích: một phản bác mang nhiều
  // thông tin hơn một lời khai trơn - nó vừa nói vai vừa chỉ mặt kẻ nói dối.
  // Tiên Tri thật gặp kẻ mạo danh thì phản bác chứ không khai như chưa có
  // chuyện gì. Không rút số ngẫu nhiên: đúng vai của mình hay không là một sự
  // thật, không phải một canh bạc.
  if (!isWolf && isPowerRole(role)) {
    // CŨ trước: kẻ mạo danh ĐẦU TIÊN là người đã gài lời khai giả; phản bác
    // đúng người đó, những lần lặp lại sau chỉ là tiếng vang của cùng một lời
    // nói dối chứ không phải một mối đe doạ mới.
    const impostor = claimsInOrder(state).find(
      (memory) =>
        memory.actorId !== me &&
        alivePlayers.has(memory.actorId) &&
        (memory.data.role as Role | undefined) === role,
    );
    if (impostor) {
      return {
        role,
        kind: "COUNTER",
        accusedId: impostor.targetId ?? null,
        counterTargetId: impostor.actorId,
        reason: "có người khác đang khai đúng vai thật của mình nên phải phản bác",
      };
    }
  }

  // ---- COUNTER: Sói bị đè - bị chỉ đích danh trong lời khai của người khác ----
  //
  // Đối xứng với nhánh trên: một con Sói đang bị một COUNTER_CLAIM khác gọi
  // tên (`targetId === me`) thì đáp trả bằng đúng vai người kia vừa nhận -
  // "không, tôi mới là Tiên Tri" - để câu chuyện rối lên thay vì để lời buộc
  // tội đứng một mình.
  if (isWolf) {
    // MỚI trước: đây là lời buộc tội cả bàn đang thật sự chú ý tới. Đáp lại một
    // lời gọi tên đã cũ trong khi một lời mới hơn đang treo lơ lửng đọc y như
    // đang trả lời nhầm tin nhắn - đúng cái tật hội thoại mà tính năng này sinh
    // ra để chữa.
    const challenger = claimsMostRecentFirst(state).find(
      (memory) => memory.targetId === me && alivePlayers.has(memory.actorId),
    );
    if (challenger) {
      const claimedRole = challenger.data.role as Role | undefined;
      if (claimedRole) {
        return {
          role: claimedRole,
          kind: "COUNTER",
          accusedId: null,
          counterTargetId: challenger.actorId,
          reason: "bị gọi tên trong lời khai của người khác nên phản bác lại bằng đúng vai họ vừa nhận",
        };
      }
    }
  }

  // ---- PROACTIVE: phe làng đang cầm một kết quả chỉ đích danh ----
  if (!isWolf && INFORMANT_ROLES.has(role)) {
    const hit = state.knownInformation.seerResults.find(
      (memory) => memory.data.isWolf === true && memory.targetId !== undefined,
    );
    if (hit?.targetId) {
      return {
        role,
        kind: "PROACTIVE",
        accusedId: hit.targetId,
        counterTargetId: null,
        reason: "đang cầm một kết quả soi trúng Sói nên khai để làng dùng được",
      };
    }
  }

  // ---- PROACTIVE: Sói khai láo ----
  if (isWolf && knowledge.round >= weights.claim.wolfBluffFromRound) {
    // Ai trong bầy đứng ra nói dối: con còn sống có id nhỏ nhất. Luật CỤC BỘ -
    // mọi con tự tính ra cùng đáp án mà không cần một kênh đồng bộ nào.
    const pack = Object.entries(knowledge.knownRoles)
      .filter(([id, known]) => alivePlayers.has(id) && roleTeam(known) === "wolves")
      .map(([id]) => id)
      .sort();
    if (pack[0] === me) {
      const dare =
        weights.claim.wolfBluffChance *
        state.personality.deceptionSkill *
        state.personality.riskTolerance;
      if (rng() < dare) {
        return {
          role: "SEER",
          kind: "PROACTIVE",
          // Người nó định treo hôm nay, do caller truyền vào (xem chú thích ở
          // tham số) để lời nói và lá phiếu không rời nhau.
          accusedId: voteTargetId,
          counterTargetId: null,
          reason: "cướp uy tín Tiên Tri trước khi người thật kịp lên tiếng",
        };
      }
    }
  }

  // ---- UNDER_FIRE: sắp bị treo ----
  const underFire =
    knowledge.trialAccusedId === me || voteLeader(knowledge.currentVoteCounts.players) === me;
  if (underFire) {
    if (!isWolf && isPowerRole(role)) {
      return {
        role,
        kind: "UNDER_FIRE",
        accusedId: null,
        counterTargetId: null,
        reason: "sắp bị treo nên lôi vai thật ra làm lá bài cuối",
      };
    }
    if (isWolf) {
      const taken = alreadyClaimed(state);
      const cover = BLUFF_COVERS.find((candidate) => !taken.has(candidate));
      if (cover) {
        return {
          role: cover,
          kind: "UNDER_FIRE",
          accusedId: null,
          counterTargetId: null,
          reason: "sắp bị treo nên nhận một vai chức năng chưa ai lấy",
        };
      }
    }
  }

  return null;
}
