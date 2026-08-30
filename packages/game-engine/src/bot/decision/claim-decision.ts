import { roleTeam, type Role } from "@masoi/shared";
import type { BotBrainState, BotDecisionContext } from "../types";

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
