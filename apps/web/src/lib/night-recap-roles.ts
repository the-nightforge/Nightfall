import type { NightRecap, RoomConfig } from "@masoi/shared";

/**
 * Vai nào ĐƯỢC KỂ trong dòng thời gian các đêm.
 *
 * Thuần tính toán, không React - cùng lý do với `game-over-summary`: đây là
 * logic có thể sai theo cách test bắt được, còn JSX thì không.
 *
 * Bản cũ trộn hai quy tắc vào một chỗ: Bảo Vệ / Tiên Tri / Phù Thuỷ LUÔN có
 * dòng, còn Thiên Thần / Thám Tử / Linh Mục chỉ hiện khi đêm đó có hành động.
 * Cả hai đều sai, theo hai hướng ngược nhau - ván không bật Bảo Vệ vẫn in "Bảo
 * Vệ: không hành động", còn đêm Thiên Thần ngồi im thì vai đó biến mất hẳn, và
 * người đọc không phân biệt được "không có vai này" với "có nhưng không dùng".
 *
 * Quy tắc duy nhất ở đây: kể về một vai khi ván CÓ vai đó.
 */
export interface RecapRoles {
  guard: boolean;
  guardianAngel: boolean;
  seer: boolean;
  detective: boolean;
  witch: boolean;
  priest: boolean;
  serialKiller: boolean;
}

/**
 * `config` là nguồn đúng, lịch sử đêm là lưới an toàn.
 *
 * Hai vế nối bằng HOẶC chứ không phải chỉ đọc `config`: các cờ vai mở rộng đều
 * không bắt buộc, nên server cũ deploy lệch với web mới có thể gửi hành động
 * của Linh Mục mà thiếu cờ `priest`. Ẩn mất một dòng CÓ dữ liệu thật là hỏng
 * nặng hơn thừa một dòng "không hành động".
 */
export function rolesInRecap(nights: NightRecap[], config?: RoomConfig): RecapRoles {
  const seen = (has: (night: NightRecap) => boolean) => nights.some(has);
  const inPlay = (flag: boolean | undefined, has: (night: NightRecap) => boolean) =>
    flag === true || seen(has);

  return {
    guard: inPlay(config?.guard, (night) => night.guardTarget != null),
    guardianAngel: inPlay(config?.guardianAngel, (night) => night.guardianAngelTarget != null),
    // Tiên Tri Tập Sự thừa kế kỹ năng soi, nên lượt soi của nó cũng rơi vào
    // `seerChecks`: một ván chỉ bật Tập Sự vẫn phải có dòng Tiên Tri.
    seer:
      config?.apprenticeSeer === true || inPlay(config?.seer, (night) => night.seerChecks.length > 0),
    detective: inPlay(config?.detective, (night) => (night.detectiveChecks?.length ?? 0) > 0),
    witch: inPlay(
      config?.witch,
      (night) => night.witch.usedHeal || night.witch.poisonTarget != null,
    ),
    priest: inPlay(config?.priest, (night) => night.priest != null),
    // Cùng quy tắc với mọi vai khác: kể về một vai khi ván CÓ vai đó. Vế lịch
    // sử là lưới an toàn cho trường hợp server cũ gửi hành động mà thiếu cờ.
    serialKiller: inPlay(config?.serialKiller, (night) => night.serialKillerTarget != null),
  };
}

/**
 * Đêm mà Linh Mục đã đổ Nước thánh, tính TRƯỚC đêm đang vẽ. `null` là chưa dùng.
 *
 * Linh Mục chỉ có MỘT bình cả ván, nên "không hành động" là câu trả lời sai cho
 * một đêm im lặng: im vì còn giữ bình và im vì đã dùng hết là hai chuyện khác
 * hẳn nhau. Suy ra từ chính lịch sử đêm, không nhắc lại luật số bình ở đây -
 * luật đó nằm trong engine và chỉ nên có một bản.
 */
export function priestSpentRound(nights: NightRecap[], index: number): number | null {
  for (let i = 0; i < index && i < nights.length; i += 1) {
    if (nights[i].priest) return nights[i].round;
  }
  return null;
}
