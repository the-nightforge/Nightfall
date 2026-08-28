import type { GameEventId, GameEventView } from "@masoi/shared";
import type { GameState } from "../types";
import { calculateMomentum } from "./momentum";

const RANKED_NEUTRAL_EVENT_CHANCE = 0.35;

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
  SHROUDED_ECLIPSE: {
    id: "SHROUDED_ECLIPSE",
    name: "Bóng Tối Bao Phủ",
    description: "Lần soi đầu tiên của Tiên Tri / Thám Tử nhận kết quả UNKNOWN.",
    targetPhase: "NIGHT",
    beneficiary: "wolves",
    power: 2,
  },
};

export function selectEvent(
  state: GameState,
  targetPhase: "NIGHT" | "DAY",
  rng: () => number = Math.random,
): GameEventView | null {
  const mode = state.config.mode ?? "ranked";
  const eventHistory = state.eventHistory ?? [];

  const eligibleEvents = Object.values(GAME_EVENTS).filter((event) => {
    if (event.targetPhase !== targetPhase) return false;
    if (eventHistory.some((h) => h.id === event.id)) return false;

    // Specific prerequisites
    if (event.id === "CLEARING_MIST" || event.id === "MOONLESS_NIGHT") {
      const seerAlive = state.players.some(
        (p) => p.alive && (p.role === "SEER" || (p.role === "APPRENTICE_SEER" && state.apprenticeAwakened)),
      );
      if (!seerAlive) return false;
    }

    if (event.id === "JUDGMENT_DAY") {
      const hasDetectiveResult = Object.keys(state.night.detectiveResults).length > 0;
      if (!hasDetectiveResult) return false;
    }

    return true;
  });

  if (eligibleEvents.length === 0) return null;

  if (mode === "chaos") {
    const randomIndex = Math.floor(rng() * eligibleEvents.length);
    const def = eligibleEvents[randomIndex];
    return {
      ...def,
      round: state.round,
    };
  }

  // Ranked Mode
  const momentum = calculateMomentum(state);
  const majorEventsCount = eventHistory.filter((h) => h.power >= 4).length;
  const totalEventsCount = eventHistory.length;

  if (totalEventsCount >= 3) return null;

  let targetBeneficiary: "village" | "wolves" | "neutral" | null = null;
  if (momentum >= 0.35) {
    targetBeneficiary = "village";
  } else if (momentum <= -0.35) {
    targetBeneficiary = "wolves";
  } else {
    targetBeneficiary = "neutral";
  }

  const candidateEvents = eligibleEvents.filter((event) => {
    if (event.beneficiary !== targetBeneficiary) return false;
    if (event.power >= 4 && majorEventsCount >= 1) return false;
    return true;
  });

  if (candidateEvents.length === 0) return null;
  if (targetBeneficiary === "neutral" && rng() >= RANKED_NEUTRAL_EVENT_CHANCE) return null;

  const chosen = candidateEvents[Math.floor(rng() * candidateEvents.length)];
  return {
    ...chosen,
    round: state.round,
  };
}
