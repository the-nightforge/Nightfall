import type { DayVoteRecap, PublicVoteChoice } from "@masoi/shared";
import type {
  BotKnowledgeView,
  BotPlayerKnowledge,
  NightActionKind,
  NightKnowledge,
} from "./types";

/**
 * Deep copy cho `NightKnowledge`, cùng lý do với `copyDayVoteRecap`: lõi BOT
 * không được có tham chiếu sống vào state của engine. `legalTargets` là chỗ
 * nguy hiểm nhất - nó là mảng lồng trong object, nên copy nông vẫn để lộ mảng.
 */
export function copyNightKnowledge(night: NightKnowledge): NightKnowledge {
  const legalTargets = {} as Record<NightActionKind, string[]>;
  for (const [action, targets] of Object.entries(night.legalTargets)) {
    legalTargets[action as NightActionKind] = [...targets];
  }
  return { ...night, legalActions: [...night.legalActions], legalTargets };
}

/**
 * Ba trạng thái phiếu ban ngày được phân biệt bằng chính kiểu dữ liệu giống
 * `GameState.votes`: `undefined` là chưa bỏ phiếu, `null` là chọn không treo,
 * string là bỏ phiếu cho người đó. Gộp hai trạng thái đầu lại sẽ khiến BOT coi
 * một lá phiếu "không treo" có chủ đích là một người chưa bầu.
 */
export function toPublicVoteChoice(
  targetId: string | null | undefined,
): PublicVoteChoice | null {
  if (targetId === undefined) return null;
  return targetId === null ? { type: "NO_ELIMINATION" } : { type: "PLAYER", targetId };
}

/**
 * Deep copy để runtime của BOT không thể ghi ngược vào lịch sử authoritative
 * của engine. Recap là bằng chứng công khai; một tham chiếu chung sẽ biến một
 * bug trong lõi AI thành sửa đổi luật chơi.
 */
export function copyDayVoteRecap(recap: DayVoteRecap): DayVoteRecap {
  return {
    ...recap,
    mutations: recap.mutations.map((mutation) => ({
      ...mutation,
      previousChoice: mutation.previousChoice ? { ...mutation.previousChoice } : null,
      choice: { ...mutation.choice },
    })),
    finalBallots: recap.finalBallots.map((ballot) => ({
      voterId: ballot.voterId,
      choice: { ...ballot.choice },
    })),
    nomination: { ...recap.nomination },
    finalJudgment: recap.finalJudgment
      ? {
          ...recap.finalJudgment,
          ballots: recap.finalJudgment.ballots.map((ballot) => ({ ...ballot })),
        }
      : null,
  };
}

/**
 * Danh sách lựa chọn hợp lệ do engine cung cấp, không để BOT tự đoán luật.
 * `canVote` đã được engine tính từ phase và trạng thái sống của người xem, nên
 * hàm này không cần biết gì về state thật.
 */
export function buildLegalVoteChoices(
  canVote: boolean,
  aliveTargetIds: readonly string[],
): PublicVoteChoice[] {
  if (!canVote) return [];
  return [
    ...aliveTargetIds.map((targetId): PublicVoteChoice => ({ type: "PLAYER", targetId })),
    { type: "NO_ELIMINATION" },
  ];
}

/**
 * Đầu vào của knowledge view: mọi trường bí mật đã được lọc trước ở engine.
 * Module này cố tình không nhận `GameState`, nên không có đường nào để một
 * trường ẩn lọt vào view chỉ vì quên lọc ở đây.
 */
export interface BotKnowledgeInput {
  botId: string;
  round: number;
  phase: BotKnowledgeView["phase"];
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  selfRole: BotKnowledgeView["selfRole"];
  players: readonly BotPlayerKnowledge[];
  knownRoles: BotKnowledgeView["knownRoles"];
  /** Luật phòng, công khai với cả bàn. Xem `BotKnowledgeView.revealRoleOnDeath`. */
  revealRoleOnDeath: boolean;
  seerResult: BotKnowledgeView["seerResult"];
  /** Suy từ chính cấu hình phòng; xem `BotKnowledgeView.neutralRolesInPlay`. */
  neutralRolesInPlay: BotKnowledgeView["neutralRolesInPlay"];
  /** Engine đã quyết định vai này có được thấy gì; ở đây chỉ sao chép. */
  night: NightKnowledge | null;
  trialAccusedId: string | null;
  canFinalVote: boolean;
  hunterShot: { canAct: boolean; legalTargets: string[] } | null;
  publicVoteHistory: readonly DayVoteRecap[];
  currentVoteCounts: BotKnowledgeView["currentVoteCounts"];
  /** `undefined` là chưa bầu; engine đã quyết định người chết không có phiếu. */
  currentVote: string | null | undefined;
  /** Do engine tính sẵn, để chỗ này không dựng lại luật pha lần thứ hai. */
  legalVoteChoices: readonly PublicVoteChoice[];
  lastNightDeaths: readonly BotKnowledgeView["lastNightDeaths"][number][];
  /** Công khai với cả phòng; engine chỉ chuyển tiếp chứ không lọc gì thêm. */
  activeEventId: BotKnowledgeView["activeEventId"];
  /** Đã được engine lọc bỏ giá trị không phải vai hợp lệ. */
  dayOfTruthClaims: BotKnowledgeView["dayOfTruthClaims"];
}

export function buildBotKnowledgeView(input: BotKnowledgeInput): BotKnowledgeView {
  const myVote = toPublicVoteChoice(input.currentVote);
  return {
    botId: input.botId,
    round: input.round,
    phase: input.phase,
    phaseStartedAt: input.phaseStartedAt,
    phaseEndsAt: input.phaseEndsAt,
    selfRole: input.selfRole,
    players: input.players.map((player) => ({ ...player })),
    knownRoles: { ...input.knownRoles },
    revealRoleOnDeath: input.revealRoleOnDeath,
    seerResult: input.seerResult ? { ...input.seerResult } : null,
    neutralRolesInPlay: [...input.neutralRolesInPlay],
    night: input.night ? copyNightKnowledge(input.night) : null,
    trialAccusedId: input.trialAccusedId,
    canFinalVote: input.canFinalVote,
    hunterShot: input.hunterShot
      ? { canAct: input.hunterShot.canAct, legalTargets: [...input.hunterShot.legalTargets] }
      : null,
    publicVoteHistory: input.publicVoteHistory.map(copyDayVoteRecap),
    currentVoteCounts: {
      players: { ...input.currentVoteCounts.players },
      noElimination: input.currentVoteCounts.noElimination,
    },
    hasVoted: myVote !== null,
    myVote,
    legalVoteChoices: input.legalVoteChoices.map((choice) => ({ ...choice })),
    lastNightDeaths: input.lastNightDeaths.map((death) => ({ ...death })),
    activeEventId: input.activeEventId,
    dayOfTruthClaims: { ...input.dayOfTruthClaims },
  };
}
