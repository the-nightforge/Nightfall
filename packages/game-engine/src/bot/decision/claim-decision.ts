import { isPowerRole, isRole, roleTeam, type Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { fnv1a32 } from "../hash";
import { isHumanTable } from "../knowledge";
import type { BotBrainState, BotDecisionContext, BotMemory, BotRng } from "../types";
import { wolfBluffPick } from "./wolf-bluff";

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

  /*
   * Thằng Hề khai một vai CHỨC NĂNG, ngược hẳn logic của mọi vai khác ở hàm này.
   *
   * Lý lẽ nền của hàm - "khai vai chức năng là chỉ cho bầy Sói biết đêm nay cắn
   * ai" - vẫn đúng, chỉ là cái giá đó không còn là giá với Hề: bị chú ý là điều
   * nó muốn, và một cái chết ban đêm thì dù sao cũng không tính cho nó. Đổi lại
   * nó nhận đúng thứ cần: một lời khai kiểm chứng được, mà người thật sẽ đứng
   * lên phản bác.
   */
  if (role === "JESTER") {
    return { role: "SEER", reason: "Thằng Hề khai láo một vai chức năng để bị phản bác và bị treo" };
  }

  /*
   * Sát Nhân nấp sau Dân Làng, ngược hẳn Thằng Hề ngay trên.
   *
   * Cùng một lý lẽ nền của hàm này, đọc theo đúng chiều của nó: khai một vai
   * chức năng là tự chỉ vào mình, và Sát Nhân là vai duy nhất trên bàn KHÔNG
   * được để ai chỉ vào mình - nó phải sống tới người cuối cùng. Nó cũng không
   * có kết quả nào để đem ra đổi lấy sự chú ý đó.
   *
   * Nhánh tường minh dù kết quả trùng với đường mặc định ở cuối hàm: lý do khác
   * hẳn ("giấu vai chức năng khỏi bầy Sói" là lo lắng của phe làng), và một lý
   * do đúng là thứ người sửa sau đọc trước khi đổi luật.
   */
  if (role === "SERIAL_KILLER") {
    return { role: COVER, reason: "Sát Nhân phải sống tới cuối, nên nó nấp sau lá bài nhạt nhất bàn" };
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
 * KHÔNG có Thám Tử: `state.knownInformation.seerResults` chỉ được nạp từ
 * `knowledge.seerResult` (ở `BotRuntime.ingestSeerResult`) và từ lượt soi dòng
 * Tiên Tri của Sói Pháp Sư (ở `applyPrivateInformation`, cờ `seerLine`, không
 * có `isWolf`) - hai trường engine chỉ cấp cho hành động SEE và SORCERER_CHECK.
 * Kỹ năng của Thám Tử (`DETECTIVE_CHECK`) so hai người xem có cùng phe hay
 * không, không bao giờ chỉ đích danh một con Sói, nên nó không bao giờ tạo ra
 * một mục trong `seerResults` để mà khai. Tiên Tri Tập Sự vẫn ở đây vì nó thừa
 * kế đúng hành động SEE khi Tiên Tri chết.
 */
const INFORMANT_ROLES = new Set<Role>(["SEER", "APPRENTICE_SEER"]);

/** Vai chức năng mà một con Sói bị dồn có thể nấp sau. Thứ tự là thứ tự ưu tiên. */
const BLUFF_COVERS: readonly Role[] = ["GUARD", "WITCH", "HUNTER", "TRACKER"];

/**
 * "Vai chức năng" ở file này là ĐÚNG tập `isPowerRole` của `@masoi/shared`, tập
 * mà `claim-credibility.ts` cũng dùng.
 *
 * Trước đây mỗi file tự định nghĩa một tập riêng (`role !== "VILLAGER"` ở đây,
 * một `POWER_ROLES` chép tay ở kia) và chúng đã lệch nhau: `PRIEST` nằm trong
 * `BLUFF_COVERS` bên dưới nhưng KHÔNG nằm trong tập của mô hình uy tín, nên lời
 * nói dối an toàn nhất lại là lời mô hình không nhìn thấy. Một định nghĩa dùng
 * chung là cách duy nhất để chỗ QUYẾT ĐỊNH khai và chỗ ĐÁNH GIÁ lời khai không
 * bao giờ nói về hai thứ khác nhau.
 */

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

/**
 * Ai đang dẫn phiếu ngay lúc này, hoặc `null` khi chưa ai bị dồn.
 *
 * EXPORT vì `BotRuntime.ingestChat` phải đóng dấu `underFire` lên lời khai bằng
 * ĐÚNG định nghĩa này. Trước đây chỗ đó tự hỏi "có ít nhất một phiếu không",
 * một câu hỏi khác hẳn: từ vòng 3 trở đi gần như ai cũng cõng một phiếu lạc, nên
 * mô hình uy tín đọc mọi lời khai là "khai lúc bị dồn" và cắt tin cậy xuống một
 * phần tư đúng lúc lời khai có giá trị nhất. Hai chỗ, một hàm - không phải hai
 * cách cài đặt tình cờ giống nhau.
 */
export function voteLeader(counts: Record<string, number>): string | null {
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

/**
 * Tiên Tri có đang GIỮ kết quả soi vì bàn có người thật không.
 *
 * Bàn toàn bot: không bao giờ giữ - `seerRevealRound` của bàn bot đã được đo
 * là tốt nhất ở 0 (chú thích v2), và self-play của mọi preset phải giữ nguyên
 * từng bit. Bàn có người (`isHumanTable`): giữ tới `seerRevealRoundHuman`.
 * Không rút số ngẫu nhiên; `0` là tắt và thoát ngay ở phép so sánh đầu.
 *
 * EXPORT vì `planSpeech` phải giữ bằng chứng soi ra khỏi lời nói bằng ĐÚNG
 * điều kiện này (qua `holdSeerEvidence`), không phải một bản chép tay.
 */
export function seerHoldsForHumans(context: BotDecisionContext, weights: BotWeights): boolean {
  const revealRound = weights.deceptionRisk.seerRevealRoundHuman;
  if (revealRound <= 0) return false;
  if (context.knowledge.round >= revealRound) return false;
  return isHumanTable(context.knowledge, weights);
}

/** Vai đã có người công khai nhận, kể cả người đã chết. */
function alreadyClaimed(state: BotBrainState): Set<Role> {
  return new Set(state.claims.map((memory) => memory.data.role as Role));
}

/**
 * Ghế đứng ra khai láo ở vòng này, hoặc `null` khi bầy không còn ai đủ điều kiện.
 *
 * Trước đây luật là "con còn sống có id nhỏ nhất", và nó hỏng theo hai đường
 * cùng lúc: cả ván chỉ đúng một ghế mở miệng - bàn học được mặt kẻ nói dối sau
 * hai vòng - và khi ghế đó đã khai một lần rồi thì `state.myClaim` chặn nó lại,
 * nên bầy im hẳn tới cuối ván dù còn ba con chưa nói gì.
 *
 * Xoay theo vòng chữa cả hai. Vẫn là luật CỤC BỘ: hàm thuần, mọi con Sói tự
 * tính ra cùng đáp án từ dữ liệu cả bầy cùng thấy, không cần một kênh đồng bộ
 * nào. Và nó KHÔNG rút số ngẫu nhiên - đó là điều kiện để việc khôi phục theo
 * con trỏ RNG và việc chạy lại self-play theo seed không vỡ.
 *
 * `roster` (cả bầy, kể cả đã chết) là hạt, `seats` (còn sống và đủ điều kiện)
 * là thứ được chia dư. Tách hai vai trò này ra là có chủ đích: trộn danh sách
 * còn sống vào hạt sẽ làm ghế bluff nhảy lại mỗi lần một con Sói chết, tức
 * xoay theo TANG TÓC chứ không theo vòng.
 */
export function wolfBluffSeat(
  seats: readonly string[],
  roster: readonly string[],
  round: number,
): string | null {
  if (seats.length === 0) return null;
  const ordered = [...seats].sort();
  const key = [...roster].sort().join(",");
  return ordered[fnv1a32(`wolf-bluff|${key}|${round}`) % ordered.length] ?? null;
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
      // Guard `isRole`: ván cũ có thể mang vai đã xóa cứng, mà vai đó đi thẳng
      // thành lời phản bác công khai ở dưới.
      const claimedRole = challenger.data.role;
      if (isRole(claimedRole)) {
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
  //
  // Trước người thật thì CHƯA: xem `seerHoldsForHumans`. Chỉ nhánh chủ động
  // này bị chặn - bị dồn phiếu (UNDER_FIRE, phía dưới) hay bị mạo danh
  // (COUNTER, phía trên) thì Tiên Tri vẫn khai, vì lúc đó im lặng đắt hơn.
  if (!isWolf && INFORMANT_ROLES.has(role) && !seerHoldsForHumans(context, weights)) {
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

  // ---- Thằng Hề: khai láo để bị bắt bài ----
  //
  // Đứng TRƯỚC nhánh Sói khai láo chỉ vì hai nhánh loại trừ nhau (`isWolf`);
  // thứ tự giữa chúng không đổi kết quả của bất kỳ con BOT nào.
  //
  // Vai nhắm tới là một vai đã có NGƯỜI KHÁC nhận, nếu có: một lời khai đè lên
  // lời khai của người khác buộc bàn phải xử một trong hai, và Hề chỉ cần được
  // xử. Khi chưa ai khai gì thì nó tự mở màn bằng Tiên Tri - lời khai nặng
  // nhất, cũng là lời dễ bị người thật lật nhất.
  if (role === "JESTER" && knowledge.round >= weights.jester.bluffFromRound) {
    // Cổng tái lập: cấu hình chưa bật hành vi Hề thì thoát TRƯỚC khi rút số.
    if (weights.jester.bluffChance > 0) {
      const dare =
        weights.jester.bluffChance *
        state.personality.deceptionSkill *
        state.personality.riskTolerance;
      if (rng() < dare) {
        // Guard `isRole` cả hai chỗ: `isPowerRole` tra thẳng ROLE_META, và vai
        // đè lên đi thẳng thành lời khai công khai ở dưới.
        const collision = claimsInOrder(state).find(
          (memory) =>
            memory.actorId !== me &&
            alivePlayers.has(memory.actorId) &&
            isPowerRole(isRole(memory.data.role) ? memory.data.role : COVER),
        );
        const collidedRole =
          collision && isRole(collision.data.role) ? collision.data.role : "SEER";
        return {
          role: collidedRole,
          kind: collision ? "COUNTER" : "PROACTIVE",
          // Chỉ đích danh đúng người nó vừa bỏ phiếu: lời nói và lá phiếu của
          // Hề phải đi cùng nhau thì cáo buộc mới đủ nghiêm túc để bị phản đòn.
          accusedId: collision ? null : voteTargetId,
          counterTargetId: collision ? collision.actorId : null,
          reason: collision
            ? "Thằng Hề đè lên lời khai của người khác để bàn buộc phải xử một trong hai"
            : "Thằng Hề khai láo vai chức năng để tự đẩy mình lên giá treo",
        };
      }
    }
  }

  // ---- PROACTIVE: Sói khai láo ----
  if (isWolf && knowledge.round >= weights.claim.wolfBluffFromRound) {
    // Cả bầy, kể cả đã chết: đây là KHOÁ CỦA VÁN, không phải danh sách ứng viên.
    // `knownRoles` của một con Sói còn sống chứa đúng toàn bộ bầy suốt ván (xem
    // `Engine.botKnowledgeFor`), nên mọi con tính ra cùng một khoá, và khoá đó
    // không đổi khi một đồng bọn chết - ghế bluff xoay theo VÒNG chứ không giật
    // một nhịp mỗi lần bầy mất người.
    const roster = Object.entries(knowledge.knownRoles)
      .filter(([, known]) => roleTeam(known) === "wolves")
      .map(([id]) => id);
    // Đủ điều kiện = còn sống và CHƯA công khai nhận vai nào. Một con đã khai
    // rồi thì thoát ở `state.myClaim` phía trên và không bao giờ khai lần hai;
    // để nó trong danh sách nghĩa là mất trắng lượt bluff của cả vòng đó.
    const spoken = new Set(state.claims.map((memory) => memory.actorId));
    const pack = roster.filter((id) => alivePlayers.has(id) && !spoken.has(id));
    // Vòng xoay hash là PRIOR, không còn là đáp án cuối: `wolfBluffPick` pha nó
    // với điểm chiến lược của §17. `wolfBluffScoreShare = 0` (v1..v26) trả về
    // đúng ghế hash, nên nhánh này không lệch một bit ở các preset cũ.
    const hashSeat = wolfBluffSeat(pack, roster, knowledge.round);
    if (wolfBluffPick(knowledge, state, pack, hashSeat, weights) === me) {
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
    /*
     * Hề đang bị dồn thì IM. Nhánh này là "lôi lá bài cuối ra để sống", và với
     * Hề thì sống chính là thua - một lời bào chữa thuyết phục ở đây có thể phá
     * hỏng đúng cái nó vừa mất cả ván để dựng.
     *
     * Không phải là không nói gì: `planSpeech` vẫn đi tiếp xuống các nhánh
     * phản hồi và cáo buộc, nên Hề vẫn cãi cọ. Nó chỉ không đưa ra một lời khai
     * kiểm chứng được vào đúng lúc lời khai đó cứu được nó.
     */
    if (role === "JESTER") return null;

    if (!isWolf && isPowerRole(role)) {
      return {
        role,
        kind: "UNDER_FIRE",
        accusedId: null,
        counterTargetId: null,
        reason: "sắp bị treo nên lôi vai thật ra làm lá bài cuối",
      };
    }
    /*
     * Sát Nhân bị dồn thì NÓI DỐI y như một con Sói, và vì đúng một lý do: cả
     * hai đều đang mất mạng nếu phiên toà này thành bản án.
     *
     * Đây là chỗ nó ĐỐI XỨNG với Thằng Hề ngay trên. Hề im vì sống là thua; Sát
     * Nhân lôi lá bài cuối ra vì sống là toàn bộ ván của nó. Gộp hai vai trung
     * lập vào một nhánh - dù chúng cùng mang nhãn `neutral` - sẽ làm hỏng đúng
     * một trong hai.
     *
     * Không rút số ngẫu nhiên, đúng như nhánh Sói: một người sắp bị treo không
     * cân nhắc xem có nên tự cứu hay không.
     */
    if (isWolf || role === "SERIAL_KILLER") {
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
