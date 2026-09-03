import { roleTeam } from "./roles";
import type { Role } from "./roles";
import type { RoomConfig } from "./phases";
import type { BalanceWarningView } from "./snapshot";

/**
 * Sức nặng của mỗi vai, tính bằng "hơn một lá Dân Làng bao nhiêu".
 *
 * Bảng này KHÔNG còn là số đoán tay: nó hiệu chỉnh từ
 * `apps/server/scripts/role-power.ts`, chạy self-play so cặp trên đúng bộ seed -
 * mỗi preset chạy hai lần, một lần nguyên vẹn và một lần gỡ đúng một vai ra (ghế
 * trống thành Dân Làng), rồi lấy chênh lệch tỉ lệ thắng. Đó đúng bằng đại lượng
 * `calculateBalanceScore` cần, vì nó chỉ dùng bảng này để đo ĐỘ LỆCH của một bộ
 * bài so với preset chứ không chấm bộ bài một cách tuyệt đối.
 *
 * Số đo (150 ván/ô, mẫu = số preset chứa vai đó):
 *   WOLF_CUB +18.7% (7) · SEER +5.5% (10) · WITCH +2.4% (9) · HUNTER +2.1% (10)
 *   GUARD +2.0% (9) · DETECTIVE +1.9% (7) · MAYOR +1.9% (6)
 *   GUARDIAN_ANGEL -0.2% (3) · PRIEST -1.3% (2) · APPRENTICE_SEER -5.3% (2)
 *   CURSED -11.3% (2)
 *
 * Bảng KHÔNG chép thẳng số đo, và có hai lý do:
 *
 * 1. Đây là BOT đánh BOT. Lõi bot suy luận kém hơn người, mà phe làng thì sống
 *    bằng suy luận còn phe Sói chỉ cần giết - nên mọi preset đo ra 14-41% cho
 *    phe làng. Con số nói "bot khai thác được bao nhiêu từ vai này". Vai cần đọc
 *    vị và nói dối bị đo thấp hơn giá trị thật trên bàn người.
 * 2. Bốn dòng cuối chỉ có 2-3 mẫu, phần lớn rơi vào đúng hai preset tệ nhất cho
 *    phe làng. Chúng được kéo xuống theo hướng số đo, không bị lật hẳn theo nó.
 *
 * Thứ số đo nói chắc chắn và bảng cũ nói sai:
 * - Tiên Tri đứng RIÊNG một bậc trên đầu, còn Phù Thuỷ/Bảo Vệ/Thám Tử/Thợ Săn/
 *   Thị Trưởng là một bậc phẳng. Bảng cũ trải chúng ra 5/4/4/3/2 mà không có gì
 *   đỡ.
 * - Sói Con là lá mạnh nhất trong cả bộ bài, hơn hẳn một con Sói thường.
 * - Kẻ Nguyền Rủa là lá có HẠI cho phe làng, không phải lá lợi: nó ngồi ghế làng
 *   nhưng bị cắn thì đổi phe. Bảng cũ cho nó +3 và vì thế bật Kẻ Nguyền Rủa lên
 *   làm điểm cân bằng nghiêng về phía làng - ngược hẳn thực tế.
 */
export const ROLE_POWER: Record<Role, number> = {
  WEREWOLF: 5,
  WOLF_CUB: 6,
  SEER: 5,
  APPRENTICE_SEER: 1.5,
  DETECTIVE: 3,
  GUARD: 3,
  GUARDIAN_ANGEL: 2,
  PRIEST: 2,
  WITCH: 3,
  HUNTER: 3,
  MAYOR: 2.5,
  // Âm là có chủ ý, xem chú thích trên: bảng đo "đóng góp cho phe đang giữ lá
  // này", và lá này đóng góp âm cho phe làng.
  CURSED: -2,
  VILLAGER: 0.5,
  /**
   * 0, và con số này KHÔNG đi vào cả `villagePower` lẫn `wolfPower`: Thằng Hề
   * là vai trung lập nên nó không đóng góp cho phe nào (xem `villageRoles`).
   *
   * Ảnh hưởng thật của nó lên bảng cân bằng vẫn có và vẫn đúng dấu: bật Thằng
   * Hề là lấy mất một ghế Dân Làng, nên `villagePower` giảm đúng 0.5 - một lá
   * hơi bất lợi cho làng, đúng như bản chất của nó (làng mất một lá phiếu biết
   * suy luận và có thêm một người chủ động phá ngày).
   */
  JESTER: 0,
  /**
   * 0, và cùng lý do với Thằng Hề: bảng này đo "đóng góp cho phe đang giữ lá
   * này", mà Sát Nhân không giữ lá cho phe nào - `villageRoles`/`wolfRoles` lọc
   * theo `roleTeam` nên con số này không bao giờ được cộng vào đâu cả.
   *
   * ĐỌC ĐÚNG con số 0 này: nó KHÔNG nói "lá bài này vô hại". Nó nói "thang đo
   * hai phe không đo được lá bài này". Sát Nhân giết mỗi đêm và tự nó là một
   * bên thứ ba tranh phần thắng chung - ảnh hưởng thật của nó lên ván đấu lớn
   * hơn hẳn mọi lá trong bảng, và nó nằm ngoài thứ `calculateBalanceScore` biết
   * cách chấm. Vì vậy `generateWarnings` phát một cảnh báo RIÊNG khi lá này
   * được bật, thay vì để một điểm số 40-60 đứng ra bảo lãnh cho bộ bài.
   */
  SERIAL_KILLER: 0,
  /**
   * 0, và cùng lý do hình thức với hai vai trung lập trên: `villageRoles` và
   * `wolfRoles` lọc theo `roleTeam`, nên con số này không bao giờ được cộng vào
   * vế nào của phép trừ.
   *
   * ĐỌC ĐÚNG con số 0 này. Nó KHÔNG nói "lá bài này vô hại", và cũng không nói
   * "đã đo ra 0". Kẻ Báo Thù không giết ai và không có kỹ năng nào, nên phần
   * ảnh hưởng mà thang đo BẮT được là đúng một ghế Dân Làng bị lấy đi
   * (`villagePower` giảm 0.5) - y hệt Thằng Hề. Phần thang đo KHÔNG bắt được
   * thì lớn hơn thế: cả ván nó vận động để làng treo cổ MỘT người vô tội cụ
   * thể, tức một áp lực có hướng nhằm thẳng vào phe Dân, và một bảng cộng trừ
   * sức mạnh hai phe không có ô nào cho đại lượng đó. Chưa có batch self-play
   * nào đo vai này, nên `generateWarnings` nói thẳng giới hạn ấy thay vì để
   * một điểm số 40-60 đứng ra bảo lãnh.
   */
  EXECUTIONER: 0,
};

/**
 * Luật cân bằng sống ở `shared` chứ không ở `game-engine`, vì nó có ĐÚNG HAI
 * người dùng ở hai đầu: server dùng để CHẶN cấu hình lệch, còn sảnh chờ dùng để
 * xem trước tức thì lúc host bật/tắt vai.
 *
 * Trước đây mỗi bên giữ một bản chép tay (`apps/web/src/lib/balance.ts` ghi rõ
 * là nhân bản để né việc kéo `game-engine` vào bundle Next). Hai bản khớp nhau
 * ở thời điểm chép, nhưng chỉnh một bên là sảnh chờ báo "Cân bằng" trong khi
 * server chặn - lệch mà không ai thấy. `shared` chỉ phụ thuộc `zod` nên web
 * import được mà không đụng tới lõi engine hay bộ não BOT.
 */

const BASE_TIMINGS: Pick<
  RoomConfig,
  "nightSeconds" | "discussionSeconds" | "voteSeconds" | "defenseSeconds" | "finalVoteSeconds"
> = {
  nightSeconds: 30,
  discussionSeconds: 60,
  voteSeconds: 30,
  defenseSeconds: 25,
  finalVoteSeconds: 20,
};

function preset(overrides: Partial<RoomConfig>): RoomConfig {
  return {
    werewolves: 2,
    // Không preset nào chứa vai trung lập, và khai báo tường minh ở đây là cách
    // khẳng định điều đó: `isPresetDeck` so từng khoá, nên một bộ bài bật Hề
    // hay Sát Nhân không bao giờ được coi là "preset chuẩn".
    jester: false,
    serialKiller: false,
    executioner: false,
    seer: false,
    guard: false,
    witch: false,
    hunter: false,
    cursed: false,
    wolfCub: false,
    apprenticeSeer: false,
    detective: false,
    guardianAngel: false,
    priest: false,
    mayor: false,
    mode: "ranked",
    ...BASE_TIMINGS,
    ...overrides,
  } as RoomConfig;
}

// Spec §4 Presets 6-15 (from 2026-08-29 design)
// Deck details:
// 6: WEREWOLF x2, SEER, GUARD, HUNTER, VILLAGER
// 7: WEREWOLF x2, SEER, WITCH, HUNTER, MAYOR, VILLAGER
// 8: WEREWOLF x2, SEER, WITCH, GUARD, HUNTER, DETECTIVE, VILLAGER
// 9: WEREWOLF x2, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, VILLAGER
// 10: WEREWOLF x2, WOLF_CUB, CURSED, SEER, APPRENTICE_SEER, WITCH, GUARD, HUNTER, VILLAGER
// 11: WEREWOLF x2, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, VILLAGER x2
// 12: WEREWOLF x3, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, VILLAGER x2
// 13: WEREWOLF x3, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, VILLAGER x2
// 14: WEREWOLF x3, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, PRIEST, VILLAGER x2
// 15: WEREWOLF x3, WOLF_CUB, CURSED, SEER, APPRENTICE_SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, PRIEST, VILLAGER

export const PRESET_DECKS: Record<number, RoomConfig> = {
  6: preset({ werewolves: 2, seer: true, guard: true, hunter: true }),
  7: preset({ werewolves: 2, seer: true, witch: true, hunter: true, mayor: true }),
  8: preset({ werewolves: 2, seer: true, witch: true, guard: true, hunter: true, detective: true }),
  9: preset({ werewolves: 2, wolfCub: true, seer: true, witch: true, guard: true, detective: true, hunter: true }),
  10: preset({
    werewolves: 2,
    wolfCub: true,
    cursed: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    hunter: true,
  }),
  11: preset({
    werewolves: 2,
    wolfCub: true,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
  }),
  12: preset({
    werewolves: 3,
    wolfCub: true,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
  }),
  13: preset({
    werewolves: 3,
    wolfCub: true,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
  }),
  14: preset({
    werewolves: 3,
    wolfCub: true,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
    priest: true,
  }),
  15: preset({
    werewolves: 3,
    wolfCub: true,
    cursed: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
    priest: true,
  }),
};

/**
 * Cảnh báo "thang đo này không đo được lá bài đó".
 *
 * Hằng số chứ không phải một chuỗi viết thẳng trong hàm: web phải NHẬN RA đúng
 * cảnh báo này để đổi câu tiêu đề của thẻ cân bằng - một bộ bài mà lời phàn nàn
 * duy nhất là "có vai ngoài thang đo" thì KHÔNG "hơi lệch", nó chỉ nằm ngoài
 * tầm với của phép chấm. So khớp bằng một tiền tố chép tay ở phía web là chỗ để
 * hai bên trôi khỏi nhau ngay lần sửa câu chữ đầu tiên.
 */
export const UNMEASURED_EXECUTIONER_WARNING =
  "Bộ bài có Kẻ Báo Thù - một người chơi vận động cả ván để làng treo cổ đúng một người vô tội. BalanceScore chỉ chấm cán cân Dân/Sói nên nó KHÔNG đo được lá bài này.";

/**
 * Cùng loại với hằng số ngay trên và cùng lý do tồn tại, chỉ khác lá bài.
 */
export const UNMEASURED_NEUTRAL_WARNING =
  "Bộ bài có Sát Nhân - một bên thứ ba tranh phần thắng chung. BalanceScore chỉ chấm cán cân Dân/Sói nên nó KHÔNG đo được lá bài này.";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Danh sách vai đặc biệt theo cấu hình, CHƯA có Dân Làng lấp chỗ trống.
 *
 * Dùng chung giữa bộ chia bài (`buildRoleDeck`) và bộ chấm cân bằng: chấm điểm
 * một bộ bài khác với bộ bài thật sự được chia là cách chắc chắn nhất để bảng
 * cân bằng nói dối.
 */
export function specialRoleList(config: RoomConfig): Role[] {
  const roles: Role[] = [];
  for (let i = 0; i < config.werewolves; i++) roles.push("WEREWOLF");
  if (config.wolfCub) roles.push("WOLF_CUB");
  if (config.seer) roles.push("SEER");
  if (config.apprenticeSeer) roles.push("APPRENTICE_SEER");
  if (config.detective) roles.push("DETECTIVE");
  if (config.guard) roles.push("GUARD");
  if (config.guardianAngel) roles.push("GUARDIAN_ANGEL");
  if (config.priest) roles.push("PRIEST");
  if (config.witch) roles.push("WITCH");
  if (config.hunter) roles.push("HUNTER");
  if (config.mayor) roles.push("MAYOR");
  // Tối đa một Kẻ Nguyền Rủa mỗi ván: một lá duy nhất trong bộ bài.
  if (config.cursed) roles.push("CURSED");
  // Tối đa một Thằng Hề mỗi ván, cùng lý do và cùng cách: cấu hình là boolean
  // nên "tối đa 1" là tính chất của kiểu dữ liệu, không phải một phép kiểm tra
  // ai đó phải nhớ viết.
  if (config.jester) roles.push("JESTER");
  // Tối đa một Sát Nhân, cùng lý do và cùng cách với hai lá trên.
  if (config.serialKiller) roles.push("SERIAL_KILLER");
  // Tối đa một Kẻ Báo Thù, cùng lý do và cùng cách với ba lá trên.
  if (config.executioner) roles.push("EXECUTIONER");
  return roles;
}

function villagerCount(config: RoomConfig, playerCount: number): number {
  const count = playerCount - specialRoleList(config).length;
  return count < 0 ? 0 : count;
}

function deckRoles(config: RoomConfig, playerCount: number): Role[] {
  const roles = specialRoleList(config);
  const vCount = villagerCount(config, playerCount);
  for (let i = 0; i < vCount; i++) roles.push("VILLAGER");
  return roles;
}

function sumPower(roles: Role[]): number {
  return roles.reduce((acc, r) => acc + (ROLE_POWER[r] ?? 0), 0);
}

function wolfRoles(roles: Role[]): Role[] {
  return roles.filter((r) => roleTeam(r) === "wolves");
}

/**
 * Suy ra từ `roleTeam` chứ không phải "mọi thứ không phải Sói".
 *
 * Định nghĩa cũ (`r !== "WEREWOLF" && r !== "WOLF_CUB"`) trùng kết quả khi chỉ
 * có hai phe, nhưng nó xếp một vai TRUNG LẬP vào sức mạnh của làng - tức bảng
 * cân bằng sẽ tính Thằng Hề như một người sẽ cố giúp làng thắng, đúng ngược
 * điều nó làm. Vai trung lập không nằm ở cả hai vế, nên nó chỉ ảnh hưởng tới
 * điểm số qua đúng thứ nó thật sự lấy đi: một ghế Dân Làng.
 */
function villageRoles(roles: Role[]): Role[] {
  return roles.filter((r) => roleTeam(r) === "village");
}

function infoPower(roles: Role[]): number {
  return roles.reduce((acc, r) => {
    if (r === "SEER") return acc + ROLE_POWER["SEER"];
    if (r === "APPRENTICE_SEER") return acc + ROLE_POWER["APPRENTICE_SEER"];
    if (r === "DETECTIVE") return acc + ROLE_POWER["DETECTIVE"];
    return acc;
  }, 0);
}

export function calculateBalanceScore(
  config: RoomConfig,
  playerCount: number,
): { score: number; villagePower: number; wolfPower: number } {
  const roles = deckRoles(config, playerCount);
  const wolfPower = sumPower(wolfRoles(roles));
  const villagePower = sumPower(villageRoles(roles));

  const presetDeck = PRESET_DECKS[playerCount];
  let score: number;
  if (presetDeck) {
    const presetRoles = deckRoles(presetDeck, playerCount);
    const presetDiff = sumPower(villageRoles(presetRoles)) - sumPower(wolfRoles(presetRoles));
    const rawDiff = villagePower - wolfPower;
    // Scale factor: spec says 10, but diff-of-preset centers score at 50;
    // use 3 to make moderate deviations block near 40/60.
    const SCALE = 3;
    score = clamp(50 + (rawDiff - presetDiff) * SCALE, 0, 100);
  } else {
    score = clamp(50 + (villagePower - wolfPower) * 2, 0, 100);
  }
  // Round to 1 decimal
  score = Math.round(score * 10) / 10;
  return { score, villagePower, wolfPower };
}

export function generateWarnings(config: RoomConfig, playerCount: number): BalanceWarningView {
  const { score, villagePower, wolfPower } = calculateBalanceScore(config, playerCount);
  const warnings: string[] = [];
  let blocking = false;

  // Score thresholds
  if (score < 40 || score > 60) {
    warnings.push(`Cân bằng lệch: BalanceScore ${score} ngoài ngưỡng 40-60`);
    blocking = true;
  } else if (score < 45 || score > 55) {
    warnings.push(`Cảnh báo cân bằng: BalanceScore ${score} ngoài ngưỡng 45-55`);
  }

  /*
   * Sát Nhân nằm NGOÀI thang đo, nên điểm số không được đứng ra bảo lãnh.
   *
   * `calculateBalanceScore` chấm một BỘ BÀI HAI PHE: nó cộng sức mạnh của làng,
   * trừ sức mạnh của Sói, rồi so với preset. Một bên thứ ba giết mỗi đêm và
   * tranh phần thắng chung không xuất hiện ở vế nào trong phép trừ đó - điểm
   * vẫn ra 50 và vẫn nằm gọn trong ngưỡng 40-60, trong khi ván đấu đã là một
   * ván khác hẳn.
   *
   * Cảnh báo, KHÔNG chặn: bộ bài này hợp lệ và host được quyền mở nó. Thứ bị
   * chặn là việc đọc một con số 40-60 thành "đã cân bằng".
   */
  if (config.serialKiller) {
    warnings.push(UNMEASURED_NEUTRAL_WARNING);
  }

  /*
   * Kẻ Báo Thù cũng nằm ngoài thang đo, và vì một lý do KHÁC Sát Nhân - nên nó
   * là một cảnh báo riêng chứ không dùng chung câu chữ.
   *
   * Sát Nhân nằm ngoài vì nó là một bên thứ ba giết mỗi đêm. Kẻ Báo Thù thì
   * không giết ai: thứ nó làm là dồn phiếu và lời nói của cả ván vào việc treo
   * cổ MỘT người phe Dân. Phép trừ `villagePower - wolfPower` bắt được đúng một
   * phần của điều đó (một ghế Dân Làng mất đi) và bỏ sót phần còn lại, nên con
   * số vẫn nằm gọn trong 40-60 trong khi phe Dân đang gánh thêm một áp lực có
   * hướng mà không lá bài nào trong bảng mô tả được.
   *
   * Cảnh báo, KHÔNG chặn: bộ bài này hợp lệ và host được quyền mở nó. Thứ bị
   * chặn là việc đọc một con số 40-60 thành "đã cân bằng".
   */
  if (config.executioner) {
    warnings.push(UNMEASURED_EXECUTIONER_WARNING);
  }

  const presetDeck = PRESET_DECKS[playerCount];
  if (presetDeck) {
    const wolfCount = config.werewolves + (config.wolfCub ? 1 : 0);
    const presetWolfCount = presetDeck.werewolves + (presetDeck.wolfCub ? 1 : 0);
    const wolfRatio = playerCount > 0 ? wolfCount / playerCount : 0;
    const presetRatio = playerCount > 0 ? presetWolfCount / playerCount : 0;
    const ratioDiff = Math.abs(wolfRatio - presetRatio);
    if (ratioDiff > 0.15) {
      warnings.push(
        `Tỉ lệ Sói lệch ${(ratioDiff * 100).toFixed(1)}% so với preset chuẩn (${presetWolfCount}/${playerCount})`,
      );
      blocking = true;
    }

    const cfgInfo = infoPower(deckRoles(config, playerCount));
    const presetInfo = infoPower(deckRoles(presetDeck, playerCount));
    const infoDiff = Math.abs(cfgInfo - presetInfo);
    if (infoDiff >= 3) {
      warnings.push(`Năng lực soi lệch ${infoDiff.toFixed(1)} điểm so với preset chuẩn`);
      blocking = true;
    }
  } else {
    warnings.push(`Không có preset cho ${playerCount} người chơi`);
  }

  // Ensure at least one warning when blocking due to score but no other
  if (warnings.length === 0 && blocking) {
    warnings.push(`Cấu hình mất cân bằng`);
  }

  return { score, warnings, blocking, villagePower, wolfPower };
}
