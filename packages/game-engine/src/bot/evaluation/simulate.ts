import type { RoomConfig, Winner } from "@masoi/shared";
import { GameEngine } from "../../engine";
import { BotRuntime } from "../BotRuntime";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import { createSeededRng } from "../rng";
import type { BotDecisionContext } from "../types";

/**
 * Trần số vòng.
 *
 * Không có nó, một thay đổi làm luật bế tắc (ví dụ không ai bao giờ đủ phiếu
 * treo) sẽ treo cả test suite thay vì đỏ. Chạm trần là một VI PHẠM được báo
 * cáo, không phải một kết thúc bình thường.
 */
export const MAX_ROUNDS = 20;

export interface SimulationInput {
  seed: string;
  playerCount?: number;
  config?: Partial<RoomConfig>;
  /** Bỏ trống thì dùng cấu hình production; chỉ định để so hai bộ trọng số. */
  weights?: BotWeights;
}

export interface SimulationResult {
  seed: string;
  winner: Winner;
  rounds: number;
  /** Số hành động đêm và phiếu đã nộp thành công. */
  actions: number;
  /** Vi phạm phát hiện TRONG LÚC chạy; rỗng là đạt. */
  violations: string[];
}

export interface SimulationMetrics {
  games: number;
  villagerWins: number;
  wolfWins: number;
  unfinished: number;
  averageRounds: number;
  violations: string[];
}

function baseConfig(over: Partial<RoomConfig> = {}): RoomConfig {
  return {
    werewolves: 2,
    seer: true,
    guard: true,
    witch: true,
    hunter: false,
    cursed: false,
    nightSeconds: 30,
    discussionSeconds: 60,
    voteSeconds: 30,
    defenseSeconds: 20,
    finalVoteSeconds: 20,
    ...over,
  } as RoomConfig;
}

/**
 * Chạy trọn một ván bằng `GameEngine` THẬT, mọi người chơi là `BotRuntime`.
 *
 * Dùng engine thật chứ không phải mô hình rút gọn là điểm mấu chốt: một harness
 * tự mô phỏng luật sẽ chỉ chứng minh rằng harness khớp với chính nó. Ở đây,
 * engine vẫn là trọng tài, nên mọi nước đi bất hợp lệ đều bị ném ra và được ghi
 * lại thành vi phạm.
 */
export function simulateGame(input: SimulationInput): SimulationResult {
  const playerCount = input.playerCount ?? 8;
  const config = baseConfig(input.config);
  const weights = input.weights ?? DEFAULT_BOT_WEIGHTS;
  const violations: string[] = [];
  let actions = 0;

  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Người ${i + 1}`,
    isBot: true,
  }));

  // Chia lại vai bằng RNG đã gieo, để cùng seed cho cùng một ván từ đầu tới cuối.
  //
  // `sort()` TRƯỚC khi xáo là bắt buộc: `GameEngine.create` đã xáo bộ bài một
  // lần bằng nguồn ngẫu nhiên toàn cục, nên xáo tiếp một mảng đã ngẫu nhiên vẫn
  // ra kết quả ngẫu nhiên. Sắp xếp đưa nó về một thứ tự chuẩn để phép xáo có
  // gieo hạt bên dưới là nguồn ngẫu nhiên DUY NHẤT của ván.
  const setupRng = createSeededRng(`${input.seed}:setup`);
  const engine = GameEngine.create(players, config);
  const roles = engine.state.players.map((player) => player.role).sort();
  for (let i = roles.length - 1; i > 0; i -= 1) {
    const j = Math.floor(setupRng() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  engine.state.players.forEach((player, i) => {
    player.role = roles[i];
  });

  const runtimes = new Map<string, BotRuntime>();
  for (const player of engine.state.players) {
    runtimes.set(
      player.id,
      new BotRuntime({
        playerId: player.id,
        rng: createSeededRng(`${input.seed}:${player.id}`),
        playerIds: engine.state.players.map((p) => p.id),
        weights,
      }),
    );
  }

  const contextFor = (playerId: string): BotDecisionContext => ({
    knowledge: engine.botKnowledgeFor(playerId),
    visibleChat: [],
  });

  const observeAll = (): void => {
    for (const player of engine.state.players) {
      if (!player.alive) continue;
      runtimes.get(player.id)!.observe(contextFor(player.id));
    }
  };

  let now = 0;
  const tick = (ms: number): number => (now += ms);
  let rounds = 0;

  engine.setPhase("ROLE_REVEAL", 1_000, now);

  while (engine.state.winner === null && rounds < MAX_ROUNDS) {
    rounds += 1;

    // ---- ĐÊM ----
    engine.setPhase("NIGHT", config.nightSeconds * 1_000, tick(1_000));
    observeAll();

    for (const player of engine.state.players) {
      if (!player.alive) continue;
      const runtime = runtimes.get(player.id)!;
      const context = contextFor(player.id);
      const decision = runtime.decideNight(context);
      if (!decision) continue;

      try {
        engine.submitNightAction(player.id, decision.action, decision.targetId);
        actions += 1;
      } catch (error) {
        violations.push(
          `nước đi đêm bất hợp lệ của ${player.id} (${decision.action}): ${String(error)}`,
        );
      }
    }

    engine.lockWolves(createSeededRng(`${input.seed}:wolves:${rounds}`));

    // Phù Thuỷ hành động sau khi bầy Sói khoá phiếu - trước đó cô ta chưa biết
    // nạn nhân, đúng như luật engine.
    if (engine.witchPending()) {
      const witch = engine.alivePlayers().find((player) => player.role === "WITCH");
      if (witch) {
        const runtime = runtimes.get(witch.id)!;
        const context = contextFor(witch.id);
        runtime.observe(context);
        const decision = runtime.decideNight(context);
        if (decision) {
          try {
            engine.submitNightAction(witch.id, decision.action, decision.targetId);
            actions += 1;
          } catch (error) {
            violations.push(`nước đi Phù Thuỷ bất hợp lệ: ${String(error)}`);
          }
        }
      }
    }

    engine.resolveNight(tick(1_000));
    if (!settleHunter(engine, runtimes, contextFor, violations, tick)) break;
    if (finished(engine, tick)) break;

    // ---- NGÀY ----
    engine.setPhase("DAY_DISCUSSION", config.discussionSeconds * 1_000, tick(1_000));
    observeAll();

    engine.setPhase("VOTING", config.voteSeconds * 1_000, tick(1_000));
    observeAll();

    for (const player of engine.alivePlayers()) {
      const runtime = runtimes.get(player.id)!;
      const context = contextFor(player.id);
      const vote = runtime.decideVote(context);
      try {
        engine.submitVote(
          player.id,
          vote.choice.type === "PLAYER" ? vote.choice.targetId : null,
          tick(10),
        );
        actions += 1;
      } catch (error) {
        violations.push(`phiếu bất hợp lệ của ${player.id}: ${String(error)}`);
      }
    }

    const outcome = engine.resolveNomination(config.defenseSeconds * 1_000, tick(1_000));

    if (outcome.kind === "TRIAL") {
      engine.beginFinalVote(config.finalVoteSeconds * 1_000, tick(1_000));
      observeAll();

      for (const voter of engine.finalVoters()) {
        const runtime = runtimes.get(voter.id)!;
        try {
          engine.submitFinalVote(voter.id, runtime.decideFinalVote(contextFor(voter.id)).guilty);
          actions += 1;
        } catch (error) {
          violations.push(`phiếu xác nhận bất hợp lệ của ${voter.id}: ${String(error)}`);
        }
      }

      engine.resolveFinalVote(tick(1_000));
      if (!settleHunter(engine, runtimes, contextFor, violations, tick)) break;
    }

    for (const player of engine.state.players) {
      if (!player.alive) continue;
      runtimes.get(player.id)!.summarizeRound(engine.state.round);
    }

    if (finished(engine, tick)) break;
  }

  if (engine.state.winner === null) {
    violations.push(`ván không kết thúc trong ${MAX_ROUNDS} vòng`);
  }

  // Bất biến quan trọng nhất: không BOT nào được "biết" vai người khác ngoài
  // phần luật cho phép. Kiểm sau khi ván xong, khi mọi thứ đã xảy ra.
  for (const player of engine.state.players) {
    const known = runtimes.get(player.id)!.state.knownInformation.knownRoles;
    for (const [otherId, role] of Object.entries(known)) {
      if (otherId === player.id) continue;
      const truth = engine.state.players.find((p) => p.id === otherId);
      if (role !== "WEREWOLF" || truth?.role !== "WEREWOLF") {
        violations.push(`${player.id} biết vai của ${otherId} mà không được phép`);
      }
    }
  }

  return { seed: input.seed, winner: engine.state.winner, rounds, actions, violations };
}

/** Xử phát bắn Thợ Săn nếu đang treo. Trả `false` khi ván đã kết thúc. */
function settleHunter(
  engine: GameEngine,
  runtimes: Map<string, BotRuntime>,
  contextFor: (playerId: string) => BotDecisionContext,
  violations: string[],
  tick: (ms: number) => number,
): boolean {
  if (!engine.hasPendingHunterShot()) return true;

  engine.beginHunterShot(15_000, tick(1_000));
  const reaction = engine.state.hunterReaction;
  if (reaction && !reaction.resolved) {
    const runtime = runtimes.get(reaction.hunterId);
    if (runtime) {
      const context = contextFor(reaction.hunterId);
      runtime.observe(context);
      try {
        engine.submitHunterShot(reaction.hunterId, runtime.decideHunterShot(context).targetId);
      } catch (error) {
        violations.push(`phát bắn bất hợp lệ: ${String(error)}`);
      }
    }
  }
  engine.completeHunterReaction();
  return engine.state.winner === null;
}

function finished(engine: GameEngine, tick: (ms: number) => number): boolean {
  const winner = engine.checkWin();
  if (!winner) return false;
  engine.finishGame(winner, tick(1_000));
  return true;
}

/**
 * Số liệu MÔ TẢ để phát hiện hồi quy, không phải tuyên bố "BOT chơi hay".
 *
 * Thứ đáng lo là một phe thắng gần 100%: nó nghĩa là một bên không còn chơi
 * nữa. Cân bằng chính xác không phải mục tiêu của Phase 2.
 */
export function summarize(results: readonly SimulationResult[]): SimulationMetrics {
  return {
    games: results.length,
    villagerWins: results.filter((item) => item.winner === "village").length,
    wolfWins: results.filter((item) => item.winner === "wolves").length,
    unfinished: results.filter((item) => item.winner === null).length,
    averageRounds:
      results.reduce((sum, item) => sum + item.rounds, 0) / Math.max(1, results.length),
    violations: results.flatMap((item) => item.violations),
  };
}
