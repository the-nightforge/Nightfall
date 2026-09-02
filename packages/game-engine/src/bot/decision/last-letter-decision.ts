import { LAST_LETTER_MAX_LENGTH, roleTeam } from "@masoi/shared";
import type { BotBrainState, BotDecisionContext } from "../types";

/** Lá thư BOT sẽ niêm phong, hoặc `null` là không viết gì. */
export interface BotLastLetterIntention {
  /** Nội dung đã sẵn sàng để lưu; luôn nằm trong trần độ dài. */
  text: string | null;
  /** Giải thích nội bộ, cho trace và log. KHÔNG bao giờ đi vào lá thư. */
  reason: string;
}

/**
 * Nội dung Phong thư sau cùng của một BOT.
 *
 * TẤT ĐỊNH TUYỆT ĐỐI: không nhận `rng`, không đọc đồng hồ, không gọi nhà cung
 * cấp. Cùng `state` và cùng `context` luôn cho ra đúng một chuỗi. Đây không phải
 * sự cầu kỳ - một lá thư đổi chữ giữa hai lần chạy cùng seed sẽ làm mọi bài
 * self-play và mọi lần tái lập ván trở nên vô nghĩa.
 *
 * VÌ SAO KHÔNG DÙNG LLM. Lá thư mở ra là cả làng đọc, và nó không thể rút lại.
 * Một câu do nhà cung cấp viết ra thì không ai kiểm được nó có vô tình nhắc tới
 * thứ mà vai này không được biết hay không; bảng mẫu ở đây thì kiểm được bằng
 * chính test.
 *
 * ĐƯỜNG RÒ mà hàm này phải bịt, theo từng vai:
 *  - Dân làng chỉ đọc `state.suspicion`, tức thứ dựng từ hành vi CÔNG KHAI mà cả
 *    làng cũng thấy. Không chạm `knownInformation`.
 *  - Tiên Tri được ghi kết quả THỰC SỰ đã soi, và chỉ kết quả đó - `seerResult`
 *    do engine cấp, không phải `knownRoles` (thứ có thể mang cả suy diễn khác).
 *  - Sói được vu oan hoặc gỡ tội cho đồng bọn, nhưng KHÔNG được viết tên đồng
 *    bọn ra: một lá thư chỉ đúng vào người ngoài phe đã là hành động bảo vệ rồi.
 */
export function decideLastLetter(
  context: BotDecisionContext,
  state: BotBrainState,
): BotLastLetterIntention {
  const { knowledge } = context;

  // Cùng hai hàng rào mà người thật gặp ở server. Lặp lại ở đây không phải để
  // thay server gác - server vẫn từ chối - mà để scheduler không phải đoán, và
  // để một BOT đã chết không tiêu một lượt gọi nào.
  if (knowledge.phase !== "DAY_DISCUSSION") {
    return { text: null, reason: "ngoài pha thảo luận thì không viết được" };
  }
  const self = knowledge.players.find((player) => player.id === knowledge.botId);
  if (!self?.alive) {
    return { text: null, reason: "đã chết thì không viết được nữa" };
  }

  // Chỉ Sói mới có đồng bọn để mà che. Gác theo phe của CHÍNH BOT chứ không chỉ
  // theo nội dung `knownRoles`: một vai phe làng lỡ có entry nào trong bảng đó
  // cũng không được để nó lặng lẽ gạt một người ra khỏi diện tình nghi.
  const allies =
    roleTeam(knowledge.selfRole) === "wolves"
      ? wolfAllies(knowledge.knownRoles, knowledge.botId)
      : new Set<string>();
  const suspect = topSuspect(context, state, allies);

  // Tiên Tri có kết quả soi thì đó là thứ đáng để lại nhất cả ván, hơn hẳn một
  // linh cảm. Không có kết quả thì viết như mọi người khác - tuyệt đối không
  // bịa ra một lần soi chưa từng xảy ra.
  const seen = knowledge.seerResult;
  if (knowledge.selfRole === "SEER" && seen) {
    return {
      text: seen.isWolf
        ? fit("Tôi đã soi ", seen.targetName, ", kết quả là Sói. Hãy tin dòng này.")
        : fit("Tôi đã soi ", seen.targetName, ", trong sạch. Đừng phí phiếu vào đó."),
      reason: "kết quả soi thật, thứ đáng để lại nhất",
    };
  }

  if (!suspect) {
    // Im lặng là một quyết định thật. Một lá thư chỉ bừa vào ai đó vẫn đủ sức
    // đẩy làng treo nhầm, mà người viết thì đã chết nên không phải chịu gì.
    return { text: null, reason: "chưa nghi ai đủ để nói ra" };
  }

  if (allies.size > 0) {
    return {
      text: fit("Chốt lại một câu: ", suspect.name, " là người tôi ngờ nhất."),
      reason: "chỉ sang người ngoài phe, đồng bọn không bao giờ bị nêu tên",
    };
  }

  return {
    text: fit("Nếu bạn đọc được dòng này thì tôi đã chết. Hãy để mắt tới ", suspect.name, "."),
    reason: "người bị nghi nhất trong số còn sống",
  };
}

/**
 * Đồng bọn Sói mà engine đã cấp cho BOT này, KHÔNG kể chính nó.
 *
 * Chỉ được gọi khi BOT thuộc phe Sói; chỗ gọi gác điều đó.
 */
function wolfAllies(knownRoles: Record<string, string>, botId: string): Set<string> {
  const allies = new Set<string>();
  for (const [id, role] of Object.entries(knownRoles)) {
    if (id === botId) continue;
    if (roleTeam(role as never) === "wolves") allies.add(id);
  }
  return allies;
}

/**
 * Người bị nghi nhất mà lá thư được phép nêu tên.
 *
 * Loại chính mình (một lời tự tố chẳng nói lên điều gì), loại người đã chết
 * (chỉ vào họ thì chẳng treo được ai), và loại đồng bọn Sói.
 *
 * Phân định hoà bằng `id` chứ không bằng thứ tự duyệt: hai lần chạy cùng seed
 * phải chọn đúng một người, kể cả khi bảng nghi ngờ được dựng theo thứ tự khác.
 */
function topSuspect(
  context: BotDecisionContext,
  state: BotBrainState,
  allies: ReadonlySet<string>,
): { id: string; name: string } | null {
  const ranked = context.knowledge.players
    .filter((player) => player.alive)
    .filter((player) => player.id !== context.knowledge.botId)
    .filter((player) => !allies.has(player.id))
    .map((player) => ({
      id: player.id,
      name: player.name,
      score: state.suspicion[player.id]?.score ?? 0,
    }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const top = ranked[0];
  return top && top.score > 0 ? { id: top.id, name: top.name } : null;
}

/**
 * Ghép câu sao cho không bao giờ vượt trần.
 *
 * Cắt BIỆT DANH chứ không cắt cả câu: một lá thư bị chặt cụt ở giữa đọc ra như
 * lỗi kỹ thuật, còn một cái tên dài bị rút gọn thì vẫn còn nhận ra được. Lát
 * `slice` cuối là lưới an toàn cho ca biệt danh dài tới mức câu khung đã hết chỗ.
 */
function fit(prefix: string, name: string, suffix: string): string {
  const budget = LAST_LETTER_MAX_LENGTH - prefix.length - suffix.length;
  const shown = name.length <= budget ? name : `${name.slice(0, Math.max(1, budget - 1))}…`;
  return `${prefix}${shown}${suffix}`.slice(0, LAST_LETTER_MAX_LENGTH);
}
