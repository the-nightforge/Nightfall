import {
  DEAD_MESSAGE_MAX_LENGTH,
  ROLE_META,
  midGameDeathCauseClause,
  type GameEventId,
  type GameEventView,
} from "@masoi/shared";
import type { GameState } from "../types";

/**
 * Hiệu ứng lúc MỞ NGÀY của từng sự kiện ban ngày: đổi state và/hoặc gắn
 * `announcement` cho bản công khai. Sự kiện không có mục ở đây đi qua nguyên vẹn.
 *
 * Thêm một sự kiện ngày = thêm một mục vào bảng, không sửa `startDay`. Lệnh Giới
 * Nghiêm là ngoại lệ và vẫn nằm ở `startDay`: nó đổi độ dài pha TRƯỚC `setPhase`.
 */
type DayStartHandler = (state: GameState, event: GameEventView, rng: () => number) => GameEventView;

const nameOf = (state: GameState, id: string): string =>
  state.players.find((p) => p.id === id)?.name ?? "?";

const DAY_START: Partial<Record<GameEventId, DayStartHandler>> = {
  JUDGMENT_DAY: (state, event) => {
    const lastResult = Object.values(state.night.detectiveResults).at(-1);
    if (!lastResult) return event;
    const announcement = `Kết quả Thám Tử: ${nameOf(state, lastResult.target1Id)} và ${nameOf(state, lastResult.target2Id)} là ${lastResult.sameTeam ? "CÙNG PHE" : "KHÁC PHE"}!`;
    return { ...event, announcement };
  },

  MORNING_REPORT: (state, event) => {
    /*
     * Bản tin nói NGUYÊN NHÂN, không đọc lại danh sách người chết.
     *
     * `lastNightDeaths` đã công khai cho cả phòng suốt NIGHT_RESULT lẫn
     * DAY_DISCUSSION, nên một bản tin đọc lại tên người chết là hai điểm
     * `power` đổi lấy một dòng chữ ai cũng đang nhìn thấy. `cause` thì ngược
     * lại: `nightHistory` chỉ lộ ra client ở GAME_OVER, nên giữa ván nó là bí
     * mật thật - và nó tách được nhát cắn của bầy Sói khỏi Bình Độc của Phù
     * Thuỷ hay nhát dao trong đêm.
     *
     * `midGameDeathCauseClause` chứ không phải bảng vế đầy đủ: hai cause của
     * Linh Mục xác nhận một lá bài chứ không tả một cái chết - xem chú thích
     * ở chính hàm đó.
     *
     * Trung lập thật chứ không phải nhãn dán: làng đọc được bàn cờ, nhưng bầy
     * Sói cũng biết cú cắn của mình có trúng không hay vừa bị một tay giết
     * khác cướp mất mục tiêu.
     */
    const lastNight = state.nightHistory.at(-1);
    let announcement: string;
    if (!lastNight) {
      announcement = `Bản tin bình minh: không có dữ liệu đêm trước.`;
    } else if (lastNight.deaths.length === 0) {
      announcement = `Đêm ${lastNight.round}: không ai thiệt mạng.`;
    } else {
      const clauses = lastNight.deaths.map(
        (death) => `${death.player.name} ${midGameDeathCauseClause(death.cause)}`,
      );
      announcement = `Đêm ${lastNight.round}: ${clauses.join("; ")}.`;
    }
    return { ...event, announcement };
  },

  OBITUARY: (state, event, rng) => {
    /*
     * Bốc MỘT người đã chết và công khai vai của họ.
     *
     * Bốc bằng `rng` được truyền vào chứ không phải `Math.random`: mọi thứ
     * trong engine phải phát lại được từ seed, và `replayGame` của harness
     * đo lường dựa vào đúng tính chất đó.
     *
     * `selectEvent` đã đòi có người chết, nhưng `customEvent` đi vòng qua nó
     * (test dùng chính đường đó), nên nhánh rỗng vẫn phải trả lời tử tế.
     */
    const dead = state.players.filter((p) => !p.alive);
    const chosen = dead[Math.floor(rng() * dead.length)];
    if (!chosen) return { ...event, announcement: `Sổ Tang: chưa có ai để ghi.` };
    state.obituaryRevealedId = chosen.id;
    return { ...event, announcement: `Sổ Tang: ${chosen.name} là ${ROLE_META[chosen.role].name}.` };
  },

  DEAD_CAN_SPEAK: (state, event, rng) => {
    // Bốc linh hồn NGAY tại đây thay vì để ai nhanh tay thì được: một cuộc
    // đua giữa người thật và BOT thì BOT luôn thắng, và người thắng đua lại
    // đổi theo độ trễ mạng chứ không theo ván đấu.
    //
    // `selectEvent` đã đòi có người chết, nhưng `customEvent` đi vòng qua nó
    // nên hàng rào phải nằm ở đây.
    const ghosts = state.players.filter((player) => !player.alive);
    state.deadCanSpeakChosenId =
      ghosts.length > 0 ? ghosts[Math.floor(rng() * ghosts.length)].id : null;
    return {
      ...event,
      announcement: `Tiếng Vọng Người Chết: một linh hồn có thể gửi lời nhắn ${DEAD_MESSAGE_MAX_LENGTH} ký tự ẩn danh.`,
    };
  },

  HOWL_OF_THE_PACK: (state, event) => {
    state.howlBonusDay = state.round + 1;
    return event;
  },
};

export function applyDayEventStart(
  state: GameState,
  event: GameEventView | null,
  rng: () => number,
): GameEventView | null {
  if (!event) return null;
  const handler = DAY_START[event.id];
  return handler ? handler(state, event, rng) : event;
}
