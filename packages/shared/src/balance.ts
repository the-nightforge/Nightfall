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
 * Hiệu chỉnh lại 2026-09-04, SAU khi bảng preset đổi - bảng cũ đo trên bộ preset
 * cũ nên mọi con số trong đó đã hết hiệu lực. Chạy hai lượt để tách tín hiệu
 * khỏi nhiễu (neo SEER = 5, cột "đo" là giá trị script gợi ý):
 *
 *   vai              đo@300  đo@600  cũ -> mới   mẫu
 *   WOLF_CUB            6.4     9.2    6 -> 7      2
 *   SEER                5.0     5.0    5 -> 5      8   (neo)
 *   WITCH               3.0     3.0    3 -> 3      8
 *   GUARD               2.7     2.5    3 -> 2.5    8
 *   APPRENTICE_SEER     2.9     1.9  1.5 -> 2      2
 *   PRIEST              1.1     1.9    2 -> 1.5    2
 *   HUNTER              1.4     1.2    3 -> 2      8
 *   GUARDIAN_ANGEL      1.0     1.0    2 -> 1.5    3
 *   DETECTIVE           1.0     1.0    3 -> 2      7
 *   MAYOR               0.8     0.7  2.5 -> 1.5    5
 *   CURSED             -3.7    -4.6   -2 -> -3     2
 *
 * Bảng KHÔNG chép thẳng số đo, và có hai lý do - cùng hai lý do như lần trước:
 *
 * 1. Đây là BOT đánh BOT. Con số nói "lõi bot khai thác được bao nhiêu từ vai
 *    này", không phải "người chơi khai thác được bao nhiêu". Vai sống bằng đọc
 *    vị và phối hợp bị đo thấp nhất: Thị Trưởng đo ra 0.7 (lá phiếu x2 gần như
 *    vô dụng với bot vì chúng không hùa theo ai), Thợ Săn 1.2 (bot bắn kém),
 *    Thám Tử 1.0 (bot không nối được chuỗi suy luận từ kết quả "khác phe").
 *    Ba dòng đó vì thế bị hãm lại quanh 1.5-2 thay vì thả về đúng số đo.
 * 2. Bốn dòng có ĐÚNG 2 mẫu - Sói Con, Tiên Tri Tập Sự, Linh Mục, Kẻ Nguyền Rủa
 *    - cũng đúng là bốn dòng lệch nhiều nhất giữa hai lượt (Sói Con lệch 2.8
 *    điểm). Gấp đôi số ván KHÔNG làm chúng ổn định, vì bất ổn đến từ chỗ chỉ có
 *    2 preset chứa vai đó chứ không phải từ số ván. Chúng chỉ được dịch một nấc
 *    theo hướng số đo.
 *
 * Cảnh báo cho lần hiệu chỉnh sau: Sói Con tụt từ 7 mẫu xuống 2 vì bảng preset
 * mới chỉ còn để nó ở preset 9 và 10. Lá mạnh nhất bộ bài giờ là lá được đo thưa
 * nhất. Muốn đo nó cho ra hồn thì phải cho script chạy cả những bộ bài KHÔNG
 * phải preset, chứ không phải chạy thêm ván.
 *
 * Thứ số đo nói chắc chắn:
 * - Tiên Tri đứng RIÊNG một bậc trên đầu vế làng; Phù Thuỷ là bậc thứ hai; phần
 *   còn lại của vế làng dồn thành một bậc phẳng quanh 1.5-2.5.
 * - Sói Con là lá mạnh nhất cả bộ bài, hơn hẳn một con Sói thường.
 * - Kẻ Nguyền Rủa là lá có HẠI cho phe làng, và hại nặng hơn bảng cũ nghĩ.
 * - Thám Tử và Tiên Tri Tập Sự đáng giá GẦN BẰNG NHAU. Bảng cũ xếp chúng cách
 *   nhau gấp đôi (3 với 1.5), và chính vì thế `infoPower` từng chặn "gỡ Thám Tử"
 *   mà cho qua "gỡ Tiên Tri Tập Sự". Với bảng này thì cả hai đều lệch 2.0 điểm,
 *   tức đều DƯỚI ngưỡng 3 và đều cho qua. Đó là hệ quả có ý thức: ngưỡng giữ
 *   nguyên để bảng nói đúng số đo, thay vì vặn số cho vừa một ngưỡng cũ.
 */
export const ROLE_POWER: Record<Role, number> = {
  WEREWOLF: 5,
  WOLF_CUB: 7,
  SEER: 5,
  APPRENTICE_SEER: 2,
  DETECTIVE: 2,
  GUARD: 2.5,
  GUARDIAN_ANGEL: 1.5,
  PRIEST: 1.5,
  WITCH: 3,
  HUNTER: 2,
  MAYOR: 1.5,
  // Âm là có chủ ý, xem chú thích trên: bảng đo "đóng góp cho phe đang giữ lá
  // này", và lá này đóng góp âm cho phe làng.
  //
  // Đừng thả nó xuống đúng số đo (-3.7 tới -4.6) mà không kiểm lại preset 10:
  // bộ bài đó có cả Kẻ Nguyền Rủa lẫn Sói Con, và ở -3 nó đã sát mép với
  // `villagePower` 12.5 so với `wolfPower` 12. Thêm một nấc âm nữa là chính
  // preset tự kêu ở phép kiểm "sức mạnh làng thấp hơn phe Sói" - trong khi nó
  // đo ra 45.0% cho phe làng, tức một báo động giả do bảng chứ không do bộ bài.
  CURSED: -3,
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

/*
 * Preset 8-15, hiệu chỉnh 2026-09-04 từ self-play trên chính `PRESET_DECKS`.
 *
 * Bảng cũ (spec 2026-08-29) đo ra 7-47% cho phe làng, và tệ dần theo cỡ phòng:
 * 12 người ra 7.3%, 15 người ra 13.7%. Nguyên nhân là SỐ SÓI, không phải vế
 * làng - mọi preset từ 9 người trở lên thừa đúng một con.
 *
 *   n  | sói cũ  | làng cũ | sói mới | làng mới
 *    8 | 2       |  47.3%  | 2       |  52.3%   (giữ nguyên)
 *    9 | 2+Con   |  16.3%  | 1+Con   |  52.0%
 *   10 | 2+Con   |  16.7%  | 1+Con   |  45.0%
 *   11 | 2+Con   |  29.3%  | 3       |  35.0%
 *   12 | 3+Con   |   7.3%  | 3       |  38.0%
 *   13 | 3+Con   |  15.0%  | 3       |  40.7%
 *   14 | 3+Con   |  15.7%  | 3       |  50.0%
 *   15 | 3+Con   |  13.7%  | 3       |  42.7%
 *
 * CẢNH BÁO 2026-09-04, ĐỌC TRƯỚC KHI TIN MỘT CON SỐ NÀO Ở TRÊN: cả cột "cũ" lẫn
 * cột "mới" trong bảng ấy đo với `speech: false`, và chế độ đó KHÔNG phải trò
 * chơi mà phòng thật đang chạy.
 *
 * Lời nói của BOT không phải lớp trang trí phủ lên một quyết định đã chốt. Nó
 * đi qua `chat-analysis -> claim-credibility -> applyEvidence`, tức nó nuôi
 * thẳng vào belief và đổi phiếu. `role-power.ts` tắt speech "chỉ để chạy nhanh
 * hơn", với lý do "lõi quyết trước, câu chữ dựng sau" - lý do đó SAI. Đo lại
 * cùng preset, 300 ván mỗi ô:
 *
 *   n  | speech tắt | speech BẬT | Δ
 *    8 |    42.7    |    45.0    |  +2.3
 *    9 |    42.7    |    50.0    |  +7.3
 *   10 |    49.7    |    58.0    |  +8.3
 *   11 |    37.3    |    41.0    |  +3.7
 *   12 |    48.0    |    69.7    | +21.7
 *   13 |    42.3    |    46.0    |  +3.7
 *   14 |    34.7    |    51.3    | +16.7
 *   15 |    40.0    |    63.7    | +23.7
 *
 * Δ chạy từ +2.3 tới +23.7 nên KHÔNG quy về một hệ số bù được: một bảng đo
 * speech-tắt không dịch được sang phòng thật bằng bất kỳ phép cộng nào.
 *
 * Với `speech: true`, 600 ván/ô, chính bảng preset dưới đây đo ra:
 *
 *   n  |  8   |  9   |  10  |  11  |  12  |  13  |  14  |  15
 *   %  | 51.0 | 51.2 | 49.3 | 36.0 | 41.0 | 43.8 | 47.2 | 53.5
 *
 * Tức bảng này ĐANG ở trong dải, và cỡ phòng lệch thật sự là 11 người (36.0) -
 * không phải 10 và 12 như bảng speech-tắt tố cáo. Một lượt "sửa" theo bảng
 * speech-tắt đã thử gỡ Kẻ Nguyền Rủa khỏi preset 10 và hạ preset 12 xuống 2 Sói;
 * đo lại với speech bật thì hai bộ ấy vọt lên 62.0% và 70.8%, nên cả hai đã được
 * TRẢ LẠI. Preset 15 giữ thay đổi (bỏ Kẻ Nguyền Rủa): 44.0 -> 53.5, đó là lần
 * duy nhất trong ba lần mà số đo đúng chế độ cũng đồng ý.
 *
 * Hai điều cần biết trước khi chỉnh tiếp bảng này:
 *
 * 1. ĐO VỚI `speech: true`. Xem ngay trên. Sàn nhiễu khi đó vẫn quanh ±3 với
 *    600-900 ván (3 seed family x 200-300), nên hiệu ứng số Sói (20-30 điểm)
 *    tin được, còn hiệu ứng thêm/bớt một vai làng (0-8 điểm) thì vẫn KHÔNG.
 *    Ghi chú cũ "sàn nhiễu ±5, cá biệt ±9" là hiện vật của việc chạy một lượt
 *    300 ván trên một seed base duy nhất.
 * 2. Đây là BOT đánh BOT, và bot làng bỏ phiếu trúng Sói chỉ 40-47%. Người thật
 *    đọc vị tốt hơn, nên chỉnh cho self-play chạm đúng 50% là đẩy phòng người
 *    sang phía làng. Dải 35-55% ở đây là cố ý chừa khoảng đó.
 * 3. Harness self-play KHÔNG chạy pha DEFENSE: `runSelfPlay` đi thẳng từ
 *    `resolveNomination` sang `beginFinalVote`, nên `decideDefense` chưa từng
 *    chạy trong một ván đo nào. Mọi con số ở đây vì thế đo một ván mà bị cáo
 *    không được tự bào chữa.
 *
 * Sói Con vì thế chỉ còn ở preset 9 và 10. Ở 11 và 15 nó đắt hơn hẳn một con
 * Sói thường (11 người: 30.5% với Con so với 40.5% không Con), và `ROLE_POWER`
 * cũng đã ghi nó là lá mạnh nhất bộ bài. Nó vẫn bật được trong bộ bài tuỳ chỉnh.
 *
 * Preset 6 và 7 đã GỠ HẲN: `MIN_PLAYERS_TO_START` lên 8 nên không phòng nào với
 * tới chúng nữa, và cả hai đều không cân bằng được (xem chú thích ở hằng số đó).
 *
 * Deck details:
 * 8: WEREWOLF x2, SEER, WITCH, GUARD, HUNTER, DETECTIVE, VILLAGER
 * 9: WEREWOLF, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, VILLAGER x2
 * 10: WEREWOLF, WOLF_CUB, CURSED, SEER, APPRENTICE_SEER, WITCH, GUARD, HUNTER, VILLAGER x2
 * 11: WEREWOLF x3, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, VILLAGER x2
 * 12: WEREWOLF x3, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, VILLAGER x3
 * 13: WEREWOLF x3, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, VILLAGER x3
 * 14: WEREWOLF x3, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, PRIEST, VILLAGER x3
 * 15: WEREWOLF x3, SEER, APPRENTICE_SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, PRIEST, VILLAGER x3
 */

export const PRESET_DECKS: Record<number, RoomConfig> = {
  8: preset({ werewolves: 2, seer: true, witch: true, guard: true, hunter: true, detective: true }),
  9: preset({ werewolves: 1, wolfCub: true, seer: true, witch: true, guard: true, detective: true, hunter: true }),
  10: preset({
    werewolves: 1,
    wolfCub: true,
    cursed: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    hunter: true,
  }),
  11: preset({
    werewolves: 3,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
  }),
  12: preset({
    werewolves: 3,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
  }),
  13: preset({
    werewolves: 3,
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

  /*
   * NGƯỠNG BẤT ĐỐI XỨNG: chỉ chặn phía Sói.
   *
   * `score` chấm ĐỘ LỆCH so với preset cùng cỡ phòng, nên một ngưỡng đối xứng
   * "40-60" phát biểu rằng preset đứng đúng giữa. Nó không đứng đúng giữa: đo
   * lại 900 ván/cỡ phòng (3 seed family x 300) cho phe làng 33-45%, tức chính
   * preset đã nghiêng về phe Sói. Với neo lệch như vậy, cận TRÊN chặn đúng
   * những bộ bài đã kéo ván về gần 50% - bộ 12 người 2 Sói đo ra 47.9% mà ăn
   * điểm 66.5 và bị chặn, trong khi bộ 12 người "2 Sói + Sói Con" đo ra 30.2%
   * thì ăn 44 điểm và đi qua. Thước đo khi đó không gác cân bằng nữa, nó cưỡng
   * chế độ lệch của chính preset.
   *
   * Cận DƯỚI ở lại nguyên vẹn và vẫn chặn: một bộ bài lệch về phe Sói so với
   * một preset vốn đã lệch về phe Sói thì lệch gấp đôi, và đó đúng là thứ phải
   * chặn. Cận trên hạ xuống mức cảnh báo - host vẫn được báo là bộ bài nghiêng
   * về làng, chỉ không bị khoá phòng vì điều đó nữa.
   */
  if (score < 40) {
    warnings.push(`Cân bằng lệch về phe Sói: BalanceScore ${score} dưới ngưỡng 40`);
    blocking = true;
  } else if (score > 60) {
    warnings.push(`Bộ bài nghiêng về phe Dân: BalanceScore ${score} trên ngưỡng 60`);
  } else if (score < 45 || score > 55) {
    warnings.push(`Cảnh báo cân bằng: BalanceScore ${score} ngoài ngưỡng 45-55`);
  }

  /*
   * MỐC TUYỆT ĐỐI - hai phép kiểm KHÔNG đọc `PRESET_DECKS`.
   *
   * Mọi thứ còn lại trong hàm này, kể cả `score`, đều chấm bộ bài bằng độ lệch
   * so với preset cùng cỡ phòng. Hệ quả toán học: một preset luôn ra đúng 50 và
   * không bao giờ tự tố cáo được mình. Bảng preset trước 2026-09-04 vì thế được
   * cấp chứng nhận "Cân bằng" ở cả 9 cỡ phòng trong khi đo thực tế trải từ 7%
   * tới 47%, và preset 10 người còn có `villagePower` 14 < `wolfPower` 16 mà
   * vẫn 50 điểm. Thước đo không nhìn thấy được cái thước.
   *
   * Hai mốc dưới đây suy thẳng từ luật, nên chúng còn hiệu lực kể cả khi bảng
   * preset sai.
   *
   * Cả hai CHỈ cảnh báo, không chặn: chúng là hàng rào chống bảng preset trôi
   * lệch, không phải một luật mới cho bộ bài tuỳ chỉnh, và bật `blocking` ở đây
   * sẽ khoá luôn những phòng đang chạy được hôm nay.
   */
  const wolfCount = config.werewolves + (config.wolfCub ? 1 : 0);
  if (wolfCount > 0) {
    /*
     * Ngân sách sai lầm của phe làng, chia cho số Sói phải treo.
     *
     * `checkWin` cho phe Sói thắng khi `sói >= số người còn lại`, nên phe làng
     * chịu được đúng `playerCount - 2 * sói` ca chết ngoài bầy trước khi chạm
     * thế cân bằng - và mỗi đêm tiêu một ca trong số đó mà không cần làng bỏ
     * phiếu sai lần nào. Chia cho số Sói vì đó là số lần làng BẮT BUỘC phải
     * treo trúng.
     *
     * Ngưỡng 1.5 đọc ra từ số đo: ba preset cũ tệ nhất (6, 9, 12 người) đều
     * đúng bằng 1.00. Bảng preset hiện tại thấp nhất là 1.67 (11 người).
     *
     * ponytail: mốc này chỉ mô hình hoá SỐ HỌC của thế cân bằng, nên nó bắt
     * được 4 trong 5 preset cũ tệ nhất mà trượt preset 15 người (ngân sách
     * 1.75, `villagePower` 23.5 > `wolfPower` 21, mà đo ra 13.7%). Nó mù với
     * chất lượng bầy Sói (Sói Con đáng giá trọn một con Sói) và với việc thông
     * tin loãng dần theo cỡ phòng. Đừng vặn ngưỡng lên 1.8 để vá chỗ đó: làm
     * thế là báo oan chính preset 11 người đang dùng. Muốn chặt hơn thì cần một
     * bài đo tỉ lệ thắng thật sự - `runBatch` trên từng preset, so với một dải
     * đã tuyên bố - chứ không phải một con số suy từ luật.
     */
    const budgetPerWolf = (playerCount - 2 * wolfCount) / wolfCount;
    if (budgetPerWolf < 1.5) {
      warnings.push(
        `Phe làng chỉ chịu được ${budgetPerWolf.toFixed(2)} ca chết cho mỗi Sói phải treo (dưới ngưỡng 1.5)`,
      );
    }
  }
  if (villagePower < wolfPower) {
    warnings.push(`Sức mạnh phe làng (${villagePower}) thấp hơn phe Sói (${wolfPower})`);
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
