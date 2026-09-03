import {
  MAX_PLAYERS_PER_ROOM,
  MIN_PLAYERS_TO_START,
  UNMEASURED_NEUTRAL_WARNING,
  type BalanceWarningView,
} from "@masoi/shared";

/**
 * Dịch cảnh báo cân bằng sang tiếng người.
 *
 * `generateWarnings` ở `@masoi/shared` là luật CHUNG của server và web: server
 * chặn `room:start` theo đúng chuỗi nó trả về, nên câu chữ ở đó không được đụng
 * vào. Nhưng chuỗi đó viết cho người sửa engine đọc - "BalanceScore 58 ngoài
 * ngưỡng 45-55" nói đúng chuyện gì đang xảy ra mà không nói được người chơi
 * phải LÀM GÌ, và nó là dòng chữ to nhất trong thẻ cảnh báo của phòng chờ.
 *
 * Module này chỉ đổi lớp hiển thị: nhận nguyên vẹn kết quả của luật rồi trả về
 * một câu hành động cho mỗi cảnh báo, và giữ lại bản kỹ thuật trong `technical`
 * để đặt vào tooltip cùng mục "Chi tiết kỹ thuật". Không có luật nào ở đây -
 * `blocking` đi thẳng từ đầu vào ra đầu ra.
 *
 * Thuần tính toán, không React, nên bộ test `tsx --test src/lib/*.test.ts` phủ
 * được.
 */

export interface BalanceCopy {
  /** Đúng bằng `blocking` của đầu vào. Không diễn giải lại. */
  blocking: boolean;
  /**
   * Cảnh báo này có đang thực sự CHẶN nút bắt đầu không.
   *
   * `blocking` là phán quyết của luật cân bằng; `blocksStart` là hệ quả của nó ở
   * chế độ đang chơi. Chaos bỏ qua chặn cân bằng (server cũng vậy), nên ở đó một
   * đội hình lệch vẫn đáng cảnh báo nhưng không được xưng là đang chặn - in
   * "Đội hình chưa vào trận được" ngay trên một nút "Bắt đầu trận đấu" đang sáng
   * thì một trong hai câu đang nói dối.
   */
  blocksStart: boolean;
  /** Câu tiêu đề của thẻ cảnh báo. */
  headline: string;
  /** Mỗi cảnh báo một câu hành động, giữ nguyên thứ tự. */
  advice: string[];
  /** Bản gốc của engine, để tooltip và mục chi tiết. Rỗng khi không có cảnh báo. */
  technical: string[];
}

/**
 * Phe nào đang được lợi, đọc từ điểm số.
 *
 * Cùng mốc 50 mà `calculateBalanceScore` lấy làm tâm, và cùng khoảng 45-55 mà
 * `BalanceMeter` gọi là "Cân bằng" - ba chỗ lệch nhau thì người chơi thấy kim
 * nằm giữa vùng xanh trong khi chữ bên dưới bảo là lệch.
 */
function tiltAdvice(score: number): string {
  if (score > 55) {
    return "Đội hình đang nghiêng về phe Dân Làng. Hãy thêm một vai cho phe Ma Sói, hoặc tắt bớt một vai chức năng.";
  }
  if (score < 45) {
    return "Đội hình đang nghiêng về phe Ma Sói. Hãy bật thêm một vai chức năng cho phe Dân Làng, hoặc bớt một Ma Sói.";
  }
  // Ngoài 40-60 thì luôn rơi vào một trong hai nhánh trên; nhánh này chỉ để hàm
  // toàn phần, không phụ thuộc vào việc ngưỡng ở shared có đổi hay không.
  return "Đội hình đang lệch nhẹ so với bộ bài chuẩn. Bật hoặc tắt một vai là đủ để cân lại.";
}

/** Một cảnh báo gốc -> một câu hành động. Không nhận ra thì trả nguyên văn. */
function friendly(warning: string, score: number, playerCount: number): string {
  if (warning.startsWith("Cân bằng lệch") || warning.startsWith("Cảnh báo cân bằng")) {
    return tiltAdvice(score);
  }
  if (warning.startsWith("Tỉ lệ Sói lệch")) {
    return "Số Ma Sói đang lệch nhiều so với bộ bài chuẩn cho số người hiện tại. Hãy chỉnh lại số Ma Sói.";
  }
  if (warning.startsWith("Năng lực soi lệch")) {
    return "Các vai soi tin (Tiên Tri, Học Việc, Thám Tử) đang lệch so với bộ bài chuẩn. Hãy bật hoặc tắt bớt một vai soi.";
  }
  if (warning.startsWith("Không có preset")) {
    /*
     * `PRESET_DECKS` phủ đúng 6..15 - tức là trọn khoảng người chơi hợp lệ - nên
     * cảnh báo này chỉ nổ khi phòng CHƯA ĐỦ người, không bao giờ vì thừa người.
     * Bản cũ nói "Bạn vẫn chơi được", hứa đúng cái điều mà `validateRoomConfig`
     * đang từ chối ngay dòng bên cạnh.
     *
     * `Lobby` giờ giấu hẳn thẻ cân bằng dưới mốc đó (xem `deckStage`), nên câu
     * này gần như không còn đường ra màn hình; nó ở lại để nếu ngưỡng của engine
     * đổi thì chữ vẫn đúng thay vì sai một cách tự tin.
     */
    return `Phòng cần ${MIN_PLAYERS_TO_START}-${MAX_PLAYERS_PER_ROOM} người mới có bộ bài chuẩn; hiện mới có ${playerCount}.`;
  }
  if (warning.startsWith("Cấu hình mất cân bằng")) {
    return tiltAdvice(score);
  }
  if (warning === UNMEASURED_NEUTRAL_WARNING) {
    /*
     * KHÔNG có lời khuyên "hãy chỉnh lại X" ở đây, và đó là điểm mấu chốt: bộ
     * bài này không lệch, nó chỉ nằm ngoài thứ mà điểm số biết cách chấm. Một
     * câu bảo host bật thêm một vai làng sẽ khiến họ đi sửa một bộ bài không hỏng.
     */
    return "Ván có Sát Nhân: một bên thứ ba giết mỗi đêm và tranh phần thắng chung. Điểm cân bằng chỉ chấm cán cân Dân/Sói, nên nó không nói được gì về lá bài này.";
  }
  return warning;
}

export function balanceCopy(
  balance: BalanceWarningView,
  playerCount: number,
  /** Bỏ trống là Ranked - mặc định chặt hơn, khớp với `config.mode ?? "ranked"`. */
  mode: "ranked" | "chaos" = "ranked",
): BalanceCopy {
  const blocksStart = balance.blocking && mode === "ranked";
  /*
   * Cảnh báo "ngoài thang đo" KHÔNG phải một lời phàn nàn về đội hình.
   *
   * Nếu nó là cảnh báo duy nhất thì tiêu đề "Đội hình hơi lệch" nói sai: bộ bài
   * đó cân đúng như mọi bộ bài khác, chỉ là phép chấm không với tới một lá của
   * nó. Một host đọc câu đó sẽ đi sửa một thứ không hỏng.
   */
  const tiltWarnings = balance.warnings.filter(
    (warning) => warning !== UNMEASURED_NEUTRAL_WARNING,
  );
  const advice: string[] = [];
  for (const warning of balance.warnings) {
    const line = friendly(warning, balance.score, playerCount);
    // Hai cảnh báo gốc có thể quy về cùng một lời khuyên (điểm lệch + tỉ lệ Sói
    // lệch đều bảo "chỉnh số Ma Sói"); in hai lần là bắt đọc lại y nguyên.
    if (!advice.includes(line)) advice.push(line);
  }
  return {
    blocking: balance.blocking,
    blocksStart,
    headline: blocksStart
      ? "Đội hình chưa vào trận được"
      : tiltWarnings.length === 0
        ? "Bộ bài có vai ngoài thang đo"
        : "Đội hình hơi lệch",
    advice,
    technical: [...balance.warnings],
  };
}
