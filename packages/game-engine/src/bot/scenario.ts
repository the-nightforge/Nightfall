import { BotRuntime } from "./BotRuntime";
import { createSeededRng } from "./rng";
import type {
  BotBrainState,
  BotDecisionContext,
  BotSpeechIntention,
  BotVoteIntention,
} from "./types";

export interface BotScenarioInput {
  seed: string;
  playerId: string;
  playerIds: readonly string[];
  /** Các context đã lọc, theo đúng thứ tự BOT sẽ gặp trong ván. */
  steps: readonly BotDecisionContext[];
}

export interface BotScenarioDecision {
  vote: BotVoteIntention;
  speech: BotSpeechIntention | null;
}

export interface BotScenarioResult {
  decisions: BotScenarioDecision[];
  state: BotBrainState;
}

/**
 * Chạy một BOT thuần qua một chuỗi context để kiểm tra invariant và tính tái
 * lập trên nhiều seed.
 *
 * Đây KHÔNG phải công cụ đo cân bằng phe: nó không mô phỏng cả ván, không có
 * đối thủ, và kết quả của nó không được dùng để tuyên bố win rate. Simulation
 * cân bằng thuộc Phase 5.
 */
export function runBotScenario(input: BotScenarioInput): BotScenarioResult {
  const runtime = new BotRuntime({
    playerId: input.playerId,
    rng: createSeededRng(input.seed),
    playerIds: input.playerIds,
  });

  const decisions: BotScenarioDecision[] = [];
  for (const step of input.steps) {
    runtime.observe(step);
    const vote = runtime.decideVote(step);
    const speech = runtime.decideSpeech(step, vote);
    if (speech) runtime.recordSpeech(speech, step.knowledge.round);
    decisions.push({ vote, speech });
  }

  return { decisions, state: runtime.state };
}
