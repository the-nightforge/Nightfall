import { isWolfPack, type GameEventId, type GameEventView } from "@masoi/shared";
import type { GameState } from "../types";

export interface GameEventDefinition {
  id: GameEventId;
  name: string;
  description: string;
  targetPhase: "NIGHT" | "DAY";
  beneficiary: "wolves" | "village" | "neutral";
  power: number;
}

export const GAME_EVENTS: Record<GameEventId, GameEventDefinition> = {
  CURFEW: {
    id: "CURFEW",
    name: "Lệnh Giới Nghiêm",
    description: "Thời lượng thảo luận ban ngày giảm 50%.",
    targetPhase: "DAY",
    beneficiary: "neutral",
    power: 1,
  },
  SILENT_NIGHT: {
    id: "SILENT_NIGHT",
    name: "Đêm Tĩnh Lặng",
    description: "Kênh chat ban đêm của phe Sói bị tắt; Sói chỉ biểu quyết bằng vote mục tiêu.",
    targetPhase: "NIGHT",
    beneficiary: "neutral",
    power: 1,
  },
  AMNESTY_DAY: {
    id: "AMNESTY_DAY",
    name: "Ngày Hòa Hoãn",
    description: "Bỏ qua phiên biểu quyết ban ngày; sau thảo luận chuyển thẳng sang Đêm.",
    targetPhase: "DAY",
    beneficiary: "neutral",
    power: 2,
  },
  CLEARING_MIST: {
    id: "CLEARING_MIST",
    name: "Màn Sương Tan",
    description: "Tiên Tri (hoặc Tiên Tri Tập Sự đã thức tỉnh) được soi 2 người trong 1 đêm.",
    targetPhase: "NIGHT",
    beneficiary: "village",
    power: 3,
  },
  VIGILANT_NIGHT: {
    id: "VIGILANT_NIGHT",
    name: "Đêm Cảnh Giác",
    description: "Bảo Vệ được che 2 người trong 1 đêm.",
    targetPhase: "NIGHT",
    beneficiary: "village",
    /*
     * Lá đêm thứ TƯ của phe làng, và đó là cả lý do nó tồn tại.
     *
     * Mỗi sự kiện chỉ nổ một lần cả ván, nên ba lá đêm của làng cạn trước bốn
     * lá của bầy Sói: từ khoảng vòng 5 trở đi, nhóm bốc ban đêm không còn gì
     * ngoài sự kiện phe Sói. `balancedPool` không cứu được chuyện đó - nó lọc
     * đúng, chỉ là không còn gì để lọc.
     *
     * Gương đúng Màn Sương Tan (soi 2 người, power 3) nên cùng giá, và cùng một
     * hàng rào: không còn Bảo Vệ sống thì không bốc.
     */
    power: 3,
  },
  PEACEFUL_NIGHT: {
    id: "PEACEFUL_NIGHT",
    name: "Đêm Bình Yên",
    description: "Phe Sói bị tước toàn bộ lượt cắn trong đêm đó (tối đa 1 lần/ván).",
    targetPhase: "NIGHT",
    beneficiary: "village",
    power: 4,
  },
  JUDGMENT_DAY: {
    id: "JUDGMENT_DAY",
    name: "Ngày Phán Xét",
    description: "Công khai kết quả soi gần nhất của Thám Tử cho toàn bộ người chơi ở đầu ngày.",
    targetPhase: "DAY",
    beneficiary: "village",
    power: 3,
  },
  LAST_STAND: {
    id: "LAST_STAND",
    name: "Tử Thủ",
    description: "Nạn nhân bị Sói cắn sống tới hết ngày hôm sau.",
    targetPhase: "NIGHT",
    beneficiary: "village",
    power: 3,
  },
  DAY_OF_TRUTH: {
    id: "DAY_OF_TRUTH",
    name: "Ngày Sự Thật",
    description: "Mỗi người công khai claim vai (không xác thực) trong ngày.",
    targetPhase: "DAY",
    beneficiary: "village",
    power: 2,
  },
  MOONLESS_NIGHT: {
    id: "MOONLESS_NIGHT",
    name: "Đêm Không Trăng",
    description: "Tiên Tri và Tiên Tri Tập Sự bị khóa kỹ năng soi trong đêm đó.",
    targetPhase: "NIGHT",
    beneficiary: "wolves",
    power: 3,
  },
  BLOODY_HUNT: {
    id: "BLOODY_HUNT",
    name: "Cuộc Săn Đẫm Máu",
    description: "Sói được chọn thêm 1 mục tiêu phụ với 50% tỉ lệ thành công (tối đa 1 lần/ván).",
    targetPhase: "NIGHT",
    beneficiary: "wolves",
    power: 4,
  },
  HOWL_OF_THE_PACK: {
    id: "HOWL_OF_THE_PACK",
    name: "Tiếng Hú Bầy Sói",
    description: "Cộng 1 phiếu ẩn cho phe Sói ở cả đề cử lẫn phiên toà ngày kế tiếp.",
    targetPhase: "DAY",
    beneficiary: "wolves",
    // 1 chứ không phải 3: phiếu ẩn giờ đi vào cả `finalVoteTally` nên nó đổi
    // được bản án, nhưng đúng MỘT phiếu và chỉ trong một ngày. Con số này có
    // người đọc (`balancedPool`), nên nó phải là giá thật chứ không phải giá
    // niêm yết.
    power: 1,
  },
  BLOOD_MOON: {
    id: "BLOOD_MOON",
    name: "Trăng Máu",
    description: "Nếu đêm nay 0 chết do Sói cắn, đêm sau 20% xuyên 1 khiên.",
    targetPhase: "NIGHT",
    beneficiary: "wolves",
    power: 3,
  },
  WOLF_SHADOW: {
    id: "WOLF_SHADOW",
    name: "Bóng Sói",
    description: "30% đảo kết quả soi của Tiên Tri.",
    targetPhase: "NIGHT",
    beneficiary: "wolves",
    power: 3,
  },
  MORNING_REPORT: {
    id: "MORNING_REPORT",
    name: "Bản Tin Bình Minh",
    description: "Công khai NGUYÊN NHÂN của từng cái chết đêm qua (cắn, độc, dao trong đêm).",
    targetPhase: "DAY",
    beneficiary: "neutral",
    power: 2,
  },
  SECRET_BALLOT: {
    id: "SECRET_BALLOT",
    name: "Phiếu Kín",
    description: "Danh tính lá phiếu bị giấu trong vòng đề cử; chỉ thấy tổng số phiếu.",
    targetPhase: "DAY",
    beneficiary: "wolves",
    /*
     * Sự kiện ngày THẬT đầu tiên của phe Sói.
     *
     * Bầy Sói bàn bạc ở kênh riêng nên không mất gì khi phiếu đóng lại; phe làng
     * thì mất công cụ ban ngày lớn nhất của mình - đọc ai bầu ai, ai đổi phiếu
     * phút chót, ai bám đuôi ai. Trước sự kiện này bảng ngày là Sói 1 điểm (một
     * phiếu ẩn) đấu làng 5, tức bầy Sói gom toàn bộ sức mạnh vào ban đêm.
     *
     * 2 chứ không phải 3: nó không giết ai và không giấu KẾT QUẢ, chỉ giấu danh
     * tính trong lúc bỏ phiếu. Phiên toà sau đó vẫn diễn ra công khai.
     */
    power: 2,
  },
  DEAD_CAN_SPEAK: {
    id: "DEAD_CAN_SPEAK",
    name: "Tiếng Vọng Người Chết",
    description: "Một người chết gửi 1 tin nhắn ẩn danh 120 ký tự.",
    targetPhase: "DAY",
    beneficiary: "neutral",
    power: 2,
  },
};

/**
 * Độ nghiêng tích luỹ của các sự kiện đã nổ, dương là đang lợi cho phe Sói.
 *
 * `power` và `beneficiary` khai báo trên từng sự kiện từ đầu nhưng chưa có ai
 * đọc - bộ chọn bốc đều tay trong nhóm hợp lệ, nên một phòng chaos hoàn toàn có
 * thể ăn Đêm Không Trăng, Bóng Sói rồi Trăng Máu liên tiếp mà không có gì cản.
 */
function eventTilt(history: readonly GameEventView[]): number {
  return history.reduce((acc, event) => {
    const points = event.power * (event.targetPhase === "NIGHT" ? NIGHT_TILT_WEIGHT : 1);
    if (event.beneficiary === "wolves") return acc + points;
    if (event.beneficiary === "village") return acc - points;
    return acc;
  }, 0);
}

/**
 * Sự kiện ĐÊM nặng gấp đôi sự kiện ngày trong phép cân.
 *
 * Đêm đổi AI CHẾT, ngày phần lớn đổi AI BIẾT GÌ. Cộng hai thứ đó vào cùng một
 * con số nghĩa là Ngày Phán Xét (-3, một mẩu thông tin) trả tiền cho Cuộc Săn
 * Đẫm Máu (+4, một cái xác) - phe làng tiêu quota vào thứ để biết rồi bị tính
 * giá như thứ để sống.
 *
 * Hằng số chứ không phải số ma, và nó là NÚM CHỈNH: con số 2 chọn trên giấy,
 * chỉ selfplay mới nói được nó đúng chưa. Sửa nó thì sửa `TILT_LIMIT` cùng lúc,
 * hai con số này chỉ có nghĩa khi đi cùng nhau.
 */
const NIGHT_TILT_WEIGHT = 2;

/**
 * Trần độ nghiêng: quá mốc này thì phe đang dẫn bị loại khỏi lượt bốc kế tiếp.
 *
 * 6 chứ không phải 3 vì `NIGHT_TILT_WEIGHT` vừa nhân đôi thang đo: giữ mốc 3
 * thì một sự kiện đêm bất kỳ (power 3 x 2 = 6) là chạm trần ngay lần đầu, và
 * luật cân bằng biến thành luật luân phiên cứng.
 */
const TILT_LIMIT = 6;

/**
 * Nhóm bốc đã lọc theo độ nghiêng. Sự kiện trung lập luôn được giữ.
 *
 * Lọc rỗng thì trả lại nguyên nhóm ban đầu: một luật cân bằng không được phép
 * biến thành "chaos hết sự kiện". Thà nghiêng thêm một nấc còn hơn tắt hẳn tính
 * năng mà người chơi vừa bật.
 */
function balancedPool(
  eligible: GameEventDefinition[],
  history: readonly GameEventView[],
): GameEventDefinition[] {
  const tilt = eventTilt(history);
  if (Math.abs(tilt) < TILT_LIMIT) return eligible;
  const leader = tilt > 0 ? "wolves" : "village";
  const filtered = eligible.filter((event) => event.beneficiary !== leader);
  return filtered.length > 0 ? filtered : eligible;
}

export function selectEvent(
  state: GameState,
  targetPhase: "NIGHT" | "DAY",
  rng: () => number = Math.random,
): GameEventView | null {
  // Chỉ chế độ chaos mới có sự kiện. Ranked cố ý không có, và "cố ý" ở đây
  // nghĩa là không có nhánh chọn nào cho nó - từng có một bộ chọn theo momentum
  // nằm sau lần return này và không bao giờ chạy được.
  if ((state.config.mode ?? "ranked") !== "chaos") return null;
  const eventHistory = state.eventHistory ?? [];

  const eligibleEvents = Object.values(GAME_EVENTS).filter((event) => {
    if (event.targetPhase !== targetPhase) return false;
    if (eventHistory.some((h) => h.id === event.id)) return false;

    // Specific prerequisites
    // Cả ba đều là sự kiện CHỈ tác động lên lượt soi, nên cùng một hàng rào.
    // Bóng Sói từng đứng ngoài danh sách này: nó vẫn nổ khi không còn ai soi,
    // không làm gì cả, và cộng 3 điểm nghiêng cho phe Sói - tức tự khoá các sự
    // kiện Sói thật ở những đêm sau. Một sự kiện phe Sói làm hại phe Sói.
    if (
      event.id === "CLEARING_MIST" ||
      event.id === "MOONLESS_NIGHT" ||
      event.id === "WOLF_SHADOW"
    ) {
      const seerAlive = state.players.some(
        (p) => p.alive && (p.role === "SEER" || (p.role === "APPRENTICE_SEER" && state.apprenticeAwakened)),
      );
      if (!seerAlive) return false;
    }

    // Đêm Tĩnh Lặng tắt kênh chat của bầy Sói - mà bot không bao giờ chat đêm
    // (`scheduleNightBots` chỉ nộp hành động). Một bầy toàn bot vì thế không mất
    // gì cả: sự kiện nổ, đốt một slot đêm, và không ai ở bàn cảm thấy khác biệt.
    //
    // Đây là hàng rào ĐÚNG thay vì đổi nhãn `neutral`: nhãn nói sự kiện có lợi
    // cho ai, còn vấn đề ở đây là có ai chịu tác động không.
    if (event.id === "VIGILANT_NIGHT") {
      const guardAlive = state.players.some((p) => p.alive && p.role === "GUARD");
      if (!guardAlive) return false;
      // Bảo Vệ không tự che và không che lại người đêm trước, nên cần đủ HAI
      // người khác ngoài hai điều kiện đó - dưới mức ấy mục tiêu thứ hai chắc
      // chắn trùng mục tiêu chính và engine ném đúng vào cú trùng.
      const guardedBefore = [state.guardPrevious, state.guardSecondPrevious];
      const reachable = state.players.filter(
        (p) => p.alive && p.role !== "GUARD" && !guardedBefore.includes(p.id),
      );
      if (reachable.length < 2) return false;
    }

    if (event.id === "SILENT_NIGHT") {
      const humanWolfAlive = state.players.some(
        (p) => p.alive && !p.isBot && isWolfPack(p.role),
      );
      if (!humanWolfAlive) return false;
    }

    if (event.id === "JUDGMENT_DAY") {
      const hasDetectiveResult = Object.keys(state.night.detectiveResults).length > 0;
      if (!hasDetectiveResult) return false;
    }

    if (event.id === "BLOODY_HUNT") {
      if (state.night.wolfCubRageTonight || state.wolfCubRageNextNight) return false;
    }

    // Tử Thủ thì vẫn loại: nó hoãn cái chết của MỘT nạn nhân, mà đêm nổi giận
    // có hai - `resolveNight` sẽ hoãn người đầu rồi giết thẳng người sau, và
    // một sự kiện cứu người mà cứu nửa vời thì đọc như một con bug.
    //
    // Đêm Bình Yên thì ngược lại, giờ nó tước CẢ hai lượt cắn nên đêm nổi giận
    // là đúng lúc cần nó nhất. Trước đây nó bị loại ở đây vì chỉ tước được lượt
    // chính, để lại lượt phụ vẫn cắn - đêm nổi giận vì thế vừa sát thương gấp
    // đôi vừa không có cửa cứu.
    if (event.id === "LAST_STAND") {
      if (state.night.wolfCubRageTonight || state.wolfCubRageNextNight) return false;
    }

    if (event.id === "BLOOD_MOON") {
      if (state.bloodMoonUsed || state.bloodMoonArmed) return false;
    }

    if (event.id === "MORNING_REPORT") {
      /*
       * Bản tin bán NGUYÊN NHÂN của những cái chết đêm qua. Một đêm không ai
       * chết thì nó chỉ đọc lại "không ai thiệt mạng" - điều cả phòng đã nhìn
       * suốt NIGHT_RESULT - mà vẫn tiêu 2 điểm nghiêng và đốt suất
       * một-lần-mỗi-ván của sự kiện.
       *
       * Đọc ĐÚNG nguồn mà bản tin sẽ đọc (`nightHistory.at(-1)` trong
       * `startDay`): `resolveNight` đẩy đêm vừa xong vào đó TRƯỚC khi
       * `startDay` chọn sự kiện, nên hàng rào này và câu bản tin luôn nhìn cùng
       * một đêm. Nhánh "không có dữ liệu đêm trước" cũng rỗng nghĩa y hệt, nên
       * cùng một hàng rào chặn cả hai.
       */
      const lastNight = state.nightHistory.at(-1);
      if (!lastNight || lastNight.deaths.length === 0) return false;
    }

    if (event.id === "DEAD_CAN_SPEAK") {
      if (state.deadCanSpeakUsed) return false;
      const hasDead = state.players.some((p) => !p.alive);
      if (!hasDead) return false;
    }

    // KHÔNG có chốt "không lặp lại hai lần liền" cho Ngày Hoà Hoãn hay Bản Tin
    // Bình Minh: dòng `eventHistory.some(...)` ngay đầu bộ lọc đã cho mỗi sự
    // kiện đúng một lần cả ván, nên một chốt như vậy không bao giờ chạy tới.

    return true;
  });

  if (eligibleEvents.length === 0) return null;
  if (rng() >= 0.6) return null;

  const pool = balancedPool(eligibleEvents, eventHistory);
  const def = pool[Math.floor(rng() * pool.length)];
  return {
    ...def,
    round: state.round,
  };
}
