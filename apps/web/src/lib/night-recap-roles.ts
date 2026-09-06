import type { NightRecap, RecapPlayer, RoomConfig } from "@masoi/shared";

/**
 * Vai nào ĐƯỢC KỂ trong dòng thời gian các đêm.
 *
 * Thuần tính toán, không React - cùng lý do với `game-over-summary`: đây là
 * logic có thể sai theo cách test bắt được, còn JSX thì không.
 *
 * Bản cũ trộn hai quy tắc vào một chỗ: Bảo Vệ / Tiên Tri / Phù Thuỷ LUÔN có
 * dòng, còn Thiên Thần / Thám Tử / Sói Pháp Sư chỉ hiện khi đêm đó có hành
 * động.
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
  sorcerer: boolean;
  serialKiller: boolean;
}

/**
 * Một lượt kiểm tra dòng Tiên Tri của Sói Pháp Sư trong một đêm đã chốt.
 *
 * Engine hiện chưa ghi lượt này vào `NightRecap` (nó chỉ phát `sorcererResult`
 * trực tiếp cho chính Sói Pháp Sư trong đêm), nên kiểu khai ở đây thay vì ở
 * `@masoi/shared`: khi engine bắt đầu ghi `sorcererChecks` vào recap thì hàm
 * `sorcererChecksOf` bên dưới đọc thẳng mà không phải sửa web.
 */
export interface SorcererCheck {
  sorcerer: RecapPlayer;
  target: RecapPlayer;
  isSeerLine: boolean;
}

/**
 * Các lượt kiểm tra Pháp Sư của một đêm, rỗng khi đêm đó không có.
 *
 * Đọc phòng thủ qua cast: recap ghi trước khi engine biết tới vai này không có
 * trường đó, và tra thẳng một key lạ vào kiểu `NightRecap` là lỗi biên dịch.
 */
export function sorcererChecksOf(night: NightRecap): SorcererCheck[] {
  const raw = night as unknown as { sorcererChecks?: SorcererCheck[] };
  return Array.isArray(raw.sorcererChecks) ? raw.sorcererChecks : [];
}

/**
 * `config` là nguồn đúng, lịch sử đêm là lưới an toàn.
 *
 * Hai vế nối bằng HOẶC chứ không phải chỉ đọc `config`: các cờ vai mở rộng đều
 * không bắt buộc, nên server cũ deploy lệch với web mới có thể gửi hành động
 * của Sói Pháp Sư mà thiếu cờ `sorcerer`. Ẩn mất một dòng CÓ dữ liệu thật là
 * hỏng nặng hơn thừa một dòng "không hành động".
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
    sorcerer: inPlay(config?.sorcerer, (night) => sorcererChecksOf(night).length > 0),
    // Cùng quy tắc với mọi vai khác: kể về một vai khi ván CÓ vai đó. Vế lịch
    // sử là lưới an toàn cho trường hợp server cũ gửi hành động mà thiếu cờ.
    serialKiller: inPlay(config?.serialKiller, (night) => night.serialKillerTarget != null),
  };
}
