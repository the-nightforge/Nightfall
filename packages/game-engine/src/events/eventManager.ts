import type { GameEventId, GameEventView } from "@masoi/shared";
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
  PEACEFUL_NIGHT: {
    id: "PEACEFUL_NIGHT",
    name: "Đêm Bình Yên",
    description: "Phe Sói bị tước lượt cắn chính trong đêm đó (tối đa 1 lần/ván).",
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
    description: "Công khai NGUYÊN NHÂN của từng cái chết đêm qua (cắn, độc, dao, Nước thánh).",
    targetPhase: "DAY",
    beneficiary: "neutral",
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
    if (event.beneficiary === "wolves") return acc + event.power;
    if (event.beneficiary === "village") return acc - event.power;
    return acc;
  }, 0);
}

/**
 * Trần độ nghiêng: quá mốc này thì phe đang dẫn bị loại khỏi lượt bốc kế tiếp.
 *
 * `power` chạy từ 1 tới 4, nên mốc 3 nghĩa là "một sự kiện mạnh dẫn trước là
 * hết phần" - độ nghiêng thực tế không vượt quá 2 + 4 = 6.
 */
const TILT_LIMIT = 3;

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

    if (event.id === "JUDGMENT_DAY") {
      const hasDetectiveResult = Object.keys(state.night.detectiveResults).length > 0;
      if (!hasDetectiveResult) return false;
    }

    if (event.id === "BLOODY_HUNT") {
      if (state.night.wolfCubRageTonight || state.wolfCubRageNextNight) return false;
    }

    if (event.id === "LAST_STAND" || event.id === "PEACEFUL_NIGHT") {
      if (state.night.wolfCubRageTonight || state.wolfCubRageNextNight) return false;
    }

    if (event.id === "BLOOD_MOON") {
      if (state.bloodMoonUsed || state.bloodMoonArmed) return false;
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
