import {
  ROLE_META,
  roleTeam,
  type GamePhase,
  type NightRecap,
  type RecapPlayer,
  type Role,
  type RoomConfig,
  type Winner,
} from "@masoi/shared";
import { assignRoles, type AssignInput } from "./assignRoles";
import {
  GameError,
  type DeathInfo,
  type EnginePlayer,
  type GameState,
  type PublicDeath,
} from "./types";

export interface SeerResultView {
  targetId: string;
  targetName: string;
  isWolf: boolean;
}

export interface NightInfoView {
  canAct: boolean;
  acted: boolean;
  wolvesLocked: boolean;
  wolfTarget: string | null;
  wolfVoteCounts?: Record<string, number>;
  wolfSkipVotes?: number;
  wolfVotesRequired?: number;
  myWolfVote?: string | null;
  guardPrevious?: string | null;
  seerResult: SeerResultView | null;
  healUsed: boolean;
  poisonUsed: boolean;
}

export interface PlayerGameView {
  phase: GamePhase;
  round: number;
  phaseEndsAt: number | null;
  winner: Winner;
  you: {
    id: string;
    role: Role | undefined;
    alive: boolean;
  } | null;
  players: {
    id: string;
    name: string;
    alive: boolean;
    isBot: boolean;
    role?: Role;
    voteCount: number;
  }[];
  nightInfo: NightInfoView | null;
  /**
   * Đã gửi phiếu hay chưa. Cần cờ riêng vì myVote === null có hai nghĩa:
   * chưa vote, hoặc đã chọn "Không treo ai".
   */
  hasVoted: boolean;
  myVote: string | null;
  /** Số phiếu "Không treo ai", tách khỏi PlayerView.voteCount. */
  noEliminationVoteCount: number;
  votesRevealed: boolean;
  lastNightDeaths: PublicDeath[];
  nightHistory: NightRecap[];
  lastEliminated: PublicDeath | null;
  log: string[];
}

const recapPlayer = (player: EnginePlayer | undefined): RecapPlayer | null =>
  player ? { id: player.id, name: player.name } : null;

function emptyNight(): GameState["night"] {
  return {
    wolfVotes: {},
    killTarget: null,
    wolvesLocked: false,
    guardTarget: null,
    healTonight: false,
    poisonTarget: null,
    witchSkipped: false,
    seerResults: {},
  };
}

/**
 * Engine thuần, không phụ thuộc socket/DB.
 * Server giữ quyền sở hữu trạng thái; client chỉ nhận view đã làm sạch.
 */
export class GameEngine {
  readonly state: GameState;

  constructor(state: GameState) {
    this.state = state;
    this.state.nightHistory ??= [];
    this.state.night.wolfVotes ??= {};
    this.state.night.wolvesLocked ??= false;
    this.state.night.witchSkipped ??= false;
  }

  /** Trạng thái thô (plain object, dùng để serialize qua Redis). */
  getState(): GameState {
    return this.state;
  }

  static create(
    players: AssignInput[],
    config: RoomConfig,
    now = Date.now(),
  ): GameEngine {
    const roles = assignRoles(players, config);
    const state: GameState = {
      phase: "ROLE_REVEAL",
      round: 0,
      phaseEndsAt: now + 10_000,
      players: players.map((p) => ({
        ...p,
        role: roles[p.id],
        alive: true,
      })),
      config,
      winner: null,
      night: emptyNight(),
      votes: {},
      guardPrevious: null,
      healUsed: false,
      poisonUsed: false,
      lastNightDeaths: [],
      nightHistory: [],
      lastEliminated: null,
      log: [],
    };
    return new GameEngine(state);
  }

  // ---- Helpers ----

  player(id: string) {
    return this.state.players.find((p) => p.id === id);
  }

  mustPlayer(id: string) {
    const p = this.player(id);
    if (!p) throw new GameError("Người chơi không tồn tại trong trận");
    return p;
  }

  alivePlayers() {
    return this.state.players.filter((p) => p.alive);
  }

  aliveWolves() {
    return this.alivePlayers().filter((p) => roleTeam(p.role) === "wolves");
  }

  aliveWolfsTargets(): string[] {
    return this.alivePlayers()
      .filter((p) => roleTeam(p.role) === "wolves")
      .map((p) => p.id);
  }

  setPhase(phase: GamePhase, durationMs: number, now = Date.now()) {
    this.state.phase = phase;
    this.state.phaseEndsAt = now + durationMs;
    if (phase === "NIGHT") {
      this.state.round += 1;
      this.state.night = emptyNight();
      this.state.votes = {};
      this.state.lastNightDeaths = [];
    }
    if (phase === "DAY_DISCUSSION") {
      this.state.votes = {};
    }
    if (phase === "VOTING") {
      this.state.votes = {};
    }
  }

  // ---- Hành động ban đêm ----

  submitNightAction(playerId: string, type: "KILL" | "SEE" | "GUARD" | "HEAL" | "POISON" | "SKIP", targetId: string | null): void {
    const st = this.state;
    if (st.phase !== "NIGHT") throw new GameError("Chỉ được hành động vào ban đêm");
    const p = this.mustPlayer(playerId);
    if (!p.alive) throw new GameError("Người chết không thể hành động");

    const target = targetId ? this.player(targetId) : undefined;
    if (targetId && !target) throw new GameError("Mục tiêu không tồn tại");
    if (target && !target.alive) throw new GameError("Mục tiêu đã chết");

    const isWitchMedicine = type === "HEAL" || type === "POISON";
    if (isWitchMedicine && p.role !== "WITCH") {
      throw new GameError("Chỉ Phù Thủy mới được dùng thuốc");
    }
    // Phù Thuỷ đi sau bầy Sói: chỉ hành động khi đã biết nạn nhân đêm nay.
    if (p.role === "WITCH" && !st.night.wolvesLocked) {
      throw new GameError("Chưa tới lượt Phù Thủy");
    }
    if ((isWitchMedicine || (type === "SKIP" && p.role === "WITCH")) && st.night.witchSkipped) {
      throw new GameError("Phù Thủy đã bỏ qua dùng thuốc đêm nay");
    }
    if ((type === "KILL" || (type === "SKIP" && roleTeam(p.role) === "wolves")) && st.night.wolvesLocked) {
      throw new GameError("Bầy Sói đã chốt mục tiêu đêm nay");
    }

    switch (type) {
      case "KILL": {
        if (roleTeam(p.role) !== "wolves") throw new GameError("Chỉ Ma Sói mới được cắn");
        if (!targetId || !target) throw new GameError("Hãy chọn một mục tiêu để cắn");
        if (roleTeam(target.role) === "wolves") throw new GameError("Không thể cắn đồng bọn");
        // Một phiếu, không phải quyết định cuối: Sói được đổi ý tới lúc khoá phiếu.
        st.night.wolfVotes[playerId] = targetId;
        break;
      }
      case "SEE": {
        if (p.role !== "SEER") throw new GameError("Chỉ Tiên Tri mới được soi");
        if (!targetId || !target) throw new GameError("Hãy chọn một người để soi");
        if (targetId === playerId) throw new GameError("Không thể soi chính mình");
        st.night.seerResults[playerId] = { targetId, isWolf: roleTeam(target.role) === "wolves" };
        break;
      }
      case "GUARD": {
        if (p.role !== "GUARD") throw new GameError("Chỉ Bảo Vệ mới được bảo vệ");
        if (!targetId || !target) throw new GameError("Hãy chọn một người để bảo vệ");
        if (targetId === st.guardPrevious) {
          throw new GameError("Không thể bảo vệ cùng một người hai đêm liên tiếp");
        }
        st.night.guardTarget = targetId;
        break;
      }
      case "HEAL": {
        if (st.healUsed) throw new GameError("Bình cứu đã được sử dụng");
        if (!st.night.killTarget) throw new GameError("Đêm nay không có ai bị cắn để cứu");
        // HEAL là quyết định cứu nạn nhân đêm nay, không cần chỉ định mục tiêu
        st.night.healTonight = true;
        break;
      }
      case "POISON": {
        if (st.poisonUsed) throw new GameError("Bình độc đã được sử dụng");
        if (!targetId || !target) throw new GameError("Hãy chọn một người để đầu độc");
        st.night.poisonTarget = targetId;
        break;
      }
      case "SKIP": {
        if (targetId !== null) throw new GameError("Bỏ qua hành động không cần mục tiêu");
        if (p.role === "WITCH") {
          st.night.witchSkipped = true;
        } else if (roleTeam(p.role) === "wolves") {
          st.night.wolfVotes[playerId] = null;
        } else {
          throw new GameError("Chỉ Phù Thủy hoặc Ma Sói mới được bỏ qua hành động");
        }
        break;
      }
      default:
        throw new GameError("Hành động không hợp lệ");
    }
  }

  hasNightAction(role: Role): boolean {
    return ROLE_META[role].nightOrder !== undefined;
  }

  /** Mọi Sói còn sống đã bỏ phiếu cắn (kể cả phiếu "không cắn"). */
  allWolvesVoted(): boolean {
    const wolves = this.aliveWolves();
    if (wolves.length === 0) return true;
    return wolves.every((w) => this.state.night.wolfVotes[w.id] !== undefined);
  }

  /**
   * Kiểm phiếu cắn của bầy Sói. Phiếu "không cắn" là một ứng viên ngang hàng
   * với người chơi chứ không phải phiếu trắng, đúng như luật bỏ phiếu ban ngày.
   */
  wolfVoteTally(): { players: Record<string, number>; skip: number } {
    const players: Record<string, number> = {};
    let skip = 0;
    const alive = new Set(this.aliveWolves().map((w) => w.id));
    for (const [wolfId, targetId] of Object.entries(this.state.night.wolfVotes)) {
      if (!alive.has(wolfId)) continue;
      if (targetId === null) skip += 1;
      else players[targetId] = (players[targetId] ?? 0) + 1;
    }
    return { players, skip };
  }

  /**
   * Chốt nạn nhân của bầy Sói. Hoà phiếu bốc ngẫu nhiên trong nhóm dẫn đầu:
   * với cấu hình mặc định hai Sói, hoà 1-1 xảy ra liên tục và nếu hoà đồng
   * nghĩa với không cắn thì một Sói bất đồng phủ quyết được cả đêm.
   */
  lockWolves(rng: () => number = Math.random): string | null {
    const st = this.state;
    st.night.wolvesLocked = true;
    const tally = this.wolfVoteTally();
    const alive = new Set(this.alivePlayers().map((p) => p.id));
    const candidates: (string | null)[] = [];
    let best = 0;
    const consider = (choice: string | null, count: number) => {
      if (count < best || count === 0) return;
      if (count > best) {
        best = count;
        candidates.length = 0;
      }
      candidates.push(choice);
    };
    for (const [targetId, count] of Object.entries(tally.players)) {
      if (alive.has(targetId)) consider(targetId, count);
    }
    consider(null, tally.skip);

    st.night.killTarget =
      candidates.length === 0 ? null : candidates[Math.floor(rng() * candidates.length)];
    return st.night.killTarget;
  }

  /** Phù Thuỷ còn lượt đi sau khi bầy Sói chốt hay không. */
  witchPending(): boolean {
    const witch = this.alivePlayers().find((p) => p.role === "WITCH");
    if (!witch) return false;
    const st = this.state;
    if (st.night.witchSkipped || st.night.healTonight || st.night.poisonTarget) return false;
    // Bình cứu chỉ dùng được khi đêm nay thật sự có nạn nhân bị cắn.
    const canHeal = !st.healUsed && st.night.killTarget !== null;
    return canHeal || !st.poisonUsed;
  }

  /** Nới hạn của pha hiện tại; dùng để mở cửa sổ riêng cho Phù Thuỷ. */
  extendPhase(durationMs: number, now = Date.now()): void {
    this.state.phaseEndsAt = now + durationMs;
  }

  /** Xử lý toàn bộ hành động ban đêm theo thứ tự: Bảo Vệ -> Sói -> Phù Thủy. */
  resolveNight(now = Date.now()): DeathInfo[] {
    const st = this.state;
    if (st.phase !== "NIGHT") throw new GameError("Chỉ xử lý đêm khi đang trong pha NIGHT");

    // Đêm kết thúc mà chưa ai khoá phiếu Sói thì chốt ngay tại đây: mọi lối vào
    // resolveNight đều phải thấy cùng một killTarget đã kiểm phiếu.
    if (!st.night.wolvesLocked) this.lockWolves();

    const deaths: DeathInfo[] = [];
    const addDeath = (death: DeathInfo): void => {
      if (!deaths.some((item) => item.playerId === death.playerId)) {
        deaths.push(death);
      }
    };

    // 1. Xác định nạn nhân bị cắn
    let healApplied = false;
    if (st.night.killTarget) {
      const victim = this.player(st.night.killTarget);
      if (victim && victim.alive) {
        const guarded = st.night.guardTarget === victim.id;
        healApplied = st.night.healTonight && !st.healUsed;
        if (!guarded && !healApplied) {
          addDeath({ playerId: victim.id, name: victim.name, cause: "wolf" });
        }
      }
    }

    // Bình cứu chỉ mất khi có nạn nhân thật để cứu. Tiêu hao cả khi Bảo Vệ đã
    // đỡ sẵn là có chủ ý: nếu không, việc bình còn nguyên sẽ tố cho Phù Thuỷ
    // biết đêm đó ai được Bảo Vệ chọn.
    if (healApplied) st.healUsed = true;

    // 2. Bình độc: đâm xuyên mọi protection
    if (st.night.poisonTarget && !st.poisonUsed) {
      const victim = this.player(st.night.poisonTarget);
      if (victim && victim.alive) {
        addDeath({ playerId: victim.id, name: victim.name, cause: "poison" });
        st.poisonUsed = true;
      }
    }

    // 3. Cập nhật trạng thái
    st.guardPrevious = st.night.guardTarget;
    st.lastNightDeaths = deaths.map((d) => ({ playerId: d.playerId, name: d.name }));
    for (const d of deaths) {
      const p = this.player(d.playerId);
      if (p) p.alive = false;
    }
    st.log.push(
      deaths.length === 0
        ? `Đêm ${st.round}: bình yên vô sự.`
        : `Đêm ${st.round}: ${deaths.length} người đã mất.`,
    );

    const wolfTarget = recapPlayer(st.night.killTarget ? this.player(st.night.killTarget) : undefined);
    const usedHeal = healApplied;
    const recap: NightRecap = {
      round: st.round,
      wolfTarget,
      guardTarget: recapPlayer(st.night.guardTarget ? this.player(st.night.guardTarget) : undefined),
      seerChecks: Object.entries(st.night.seerResults).flatMap(([seerId, result]) => {
        const seer = recapPlayer(this.player(seerId));
        const target = recapPlayer(this.player(result.targetId));
        return seer && target ? [{ seer, target, isWolf: result.isWolf }] : [];
      }),
      witch: {
        usedHeal,
        healedTarget: usedHeal ? wolfTarget : null,
        poisonTarget: recapPlayer(st.night.poisonTarget ? this.player(st.night.poisonTarget) : undefined),
      },
      deaths: deaths.map((death) => ({
        player: { id: death.playerId, name: death.name },
        cause: death.cause,
      })),
    };
    st.nightHistory.push(recap);

    st.phase = "NIGHT_RESULT";
    st.phaseEndsAt = now + 8_000;
    return deaths;
  }

  // ---- Bình chọn ban ngày ----

  /** targetId null nghĩa là chọn "Không treo ai", không phải bỏ trống phiếu. */
  submitVote(voterId: string, targetId: string | null): void {
    const st = this.state;
    if (st.phase !== "VOTING") throw new GameError("Chỉ được bỏ phiếu trong pha bỏ phiếu");
    const voter = this.mustPlayer(voterId);
    if (!voter.alive) throw new GameError("Người chết không được bỏ phiếu");
    // So với undefined, không dùng truthiness: một phiếu không treo đã lưu là
    // null, và coi nó như chưa vote sẽ cho phép đổi phiếu vòng qua luật này.
    if (st.votes[voterId] !== undefined) throw new GameError("Bạn đã bỏ phiếu");
    if (targetId !== null) {
      const target = this.player(targetId);
      if (!target) throw new GameError("Mục tiêu không tồn tại");
      if (!target.alive) throw new GameError("Không thể bỏ phiếu cho người đã chết");
    }
    st.votes[voterId] = targetId;
  }

  allAliveVoted(): boolean {
    return this.alivePlayers().every((p) => this.state.votes[p.id] !== undefined);
  }

  /**
   * Tách phiếu người chơi khỏi phiếu không treo. Gộp chung vào một Record sẽ
   * cần một id giả cho lựa chọn không treo, và id đó sẽ rò ra snapshot cùng UI.
   */
  voteTally(): { players: Record<string, number>; noElimination: number } {
    const players: Record<string, number> = {};
    let noElimination = 0;
    for (const targetId of Object.values(this.state.votes)) {
      if (targetId === null) noElimination += 1;
      else players[targetId] = (players[targetId] ?? 0) + 1;
    }
    return { players, noElimination };
  }

  /** Trả về người bị loại; hoà phiếu trả về null (không ai bị loại). */
  resolveVote(now = Date.now()): PublicDeath | null {
    const st = this.state;
    if (st.phase !== "VOTING") throw new GameError("Chỉ xử lý phiếu khi đang bỏ phiếu");
    // "Không treo ai" là một ứng viên ngang hàng với người chơi, không phải
    // phiếu trắng bị bỏ qua: nó phải thắng được và phải hoà được.
    const tally = this.voteTally();
    type VoteCandidate =
      | { type: "PLAYER"; targetId: string; count: number }
      | { type: "NO_ELIMINATION"; count: number };
    const candidates: VoteCandidate[] = Object.entries(tally.players).map(
      ([targetId, count]) => ({ type: "PLAYER", targetId, count }),
    );
    if (tally.noElimination > 0) {
      candidates.push({ type: "NO_ELIMINATION", count: tally.noElimination });
    }
    candidates.sort((left, right) => right.count - left.count);

    const leader = candidates[0];
    const secondCount = candidates[1]?.count ?? -1;
    const uniqueLeader = leader !== undefined && leader.count > secondCount;
    let eliminated: PublicDeath | null = null;

    if (uniqueLeader && leader.type === "PLAYER") {
      const p = this.player(leader.targetId);
      if (p && p.alive) {
        p.alive = false;
        eliminated = { playerId: p.id, name: p.name };
      }
    }

    st.lastEliminated = eliminated;
    // Ba kết cục khác nhau về ý nghĩa nên log phải phân biệt được, dù UI gộp
    // hai nhánh không có nạn nhân vào cùng một câu.
    if (eliminated) st.log.push(`Dân làng đã loại ${eliminated.name}.`);
    else if (uniqueLeader && leader.type === "NO_ELIMINATION") {
      st.log.push("Dân làng quyết định không treo ai.");
    } else st.log.push("Hoà phiếu, không ai bị loại.");
    st.phase = "ELIMINATION";
    st.phaseEndsAt = now + 8_000;
    return eliminated;
  }

  // ---- Điều kiện thắng ----

  checkWin(): Winner {
    const st = this.state;
    const wolvesAlive = this.aliveWolves().length;
    const othersAlive = this.alivePlayers().length - wolvesAlive;
    if (wolvesAlive === 0) return "village";
    if (wolvesAlive >= othersAlive) return "wolves";
    return null;
  }

  finishGame(winner: Exclude<Winner, null>, now = Date.now()) {
    this.state.winner = winner;
    this.state.phase = "GAME_OVER";
    this.state.phaseEndsAt = now + 30_000;
    this.state.log.push(winner === "wolves" ? "Phe Ma Sói chiến thắng!" : "Phe Dân Làng chiến thắng!");
  }

  // ---- View ----

  /**
   * Khối hành động đêm của một vai. Chỉ Sói và Phù Thuỷ được biết nạn nhân, và
   * Phù Thuỷ chỉ biết sau khi bầy Sói khoá phiếu - trước đó cô ta còn đang chờ lượt.
   */
  private nightInfoFor(viewer: EnginePlayer, seerResult: SeerResultView | null): NightInfoView {
    const st = this.state;
    const locked = st.night.wolvesLocked;
    const isWolf = roleTeam(viewer.role) === "wolves";
    const isWitch = viewer.role === "WITCH";
    const tally = isWolf ? this.wolfVoteTally() : null;

    return {
      canAct: isWitch ? locked : isWolf ? !locked : true,
      acted: isWolf
        ? st.night.wolfVotes[viewer.id] !== undefined
        : viewer.role === "SEER"
          ? st.night.seerResults[viewer.id] !== undefined
          : viewer.role === "GUARD"
            ? st.night.guardTarget !== null
            : st.night.witchSkipped || st.night.healTonight || st.night.poisonTarget !== null,
      wolvesLocked: locked,
      wolfTarget: (isWolf || isWitch) && locked ? st.night.killTarget : null,
      wolfVoteCounts: tally ? tally.players : undefined,
      wolfSkipVotes: tally ? tally.skip : undefined,
      wolfVotesRequired: isWolf ? this.aliveWolves().length : undefined,
      myWolfVote: isWolf ? st.night.wolfVotes[viewer.id] ?? null : undefined,
      guardPrevious: viewer.role === "GUARD" ? st.guardPrevious : undefined,
      seerResult,
      healUsed: st.healUsed,
      poisonUsed: st.poisonUsed,
    };
  }

  snapshotFor(viewerId: string): PlayerGameView {
    const st = this.state;
    const viewer = this.player(viewerId);
    const revealAll = st.phase === "GAME_OVER" || (viewer !== undefined && !viewer.alive);
    // Sói luôn biết đồng bọn của mình
    const viewerIsWolf = viewer !== undefined && viewer.alive && roleTeam(viewer.role) === "wolves";

    const tally = this.voteTally();
    const showVoteCounts = st.phase === "VOTING" || revealAll;
    // Người chết không có phiếu nào để mà "đã bỏ", nên hasVoted của họ luôn false.
    const hasVoted = viewer?.alive === true && st.votes[viewerId] !== undefined;
    const playersView = st.players.map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      isBot: p.isBot,
      role: revealAll
        ? p.role
        : viewerIsWolf && p.id !== viewerId && roleTeam(p.role) === "wolves"
          ? p.role
          : undefined,
      voteCount: showVoteCounts ? tally.players[p.id] ?? 0 : 0,
    }));

    const seerResultEntry = viewer ? st.night.seerResults[viewerId] : undefined;
    const seerResult =
      seerResultEntry && viewer
        ? {
            targetId: seerResultEntry.targetId,
            targetName: this.player(seerResultEntry.targetId)?.name ?? "?",
            isWolf: seerResultEntry.isWolf,
          }
        : null;

    return {
      phase: st.phase,
      round: st.round,
      phaseEndsAt: st.phaseEndsAt,
      winner: st.winner,
      you: viewer
        ? { id: viewer.id, role: viewer.role, alive: viewer.alive }
        : null,
      players: playersView,
      nightInfo:
        st.phase === "NIGHT" && viewer && viewer.alive && this.hasNightAction(viewer.role)
          ? this.nightInfoFor(viewer, seerResult)
          : null,
      hasVoted,
      // ?? null ở đây an toàn vì đã gác bằng hasVoted: chỉ đọc khi thật sự có
      // phiếu, nên null trả về là phiếu không treo chứ không phải "chưa vote".
      myVote: hasVoted ? st.votes[viewerId] ?? null : null,
      noEliminationVoteCount: showVoteCounts ? tally.noElimination : 0,
      votesRevealed: st.phase === "ELIMINATION" || st.phase === "GAME_OVER" || st.phase === "CHECK_WIN",
      lastNightDeaths: st.phase === "NIGHT_RESULT" || st.phase === "DAY_DISCUSSION" ? st.lastNightDeaths : [],
      nightHistory: st.phase === "GAME_OVER" ? st.nightHistory : [],
      lastEliminated: st.phase === "ELIMINATION" || st.phase === "CHECK_WIN" ? st.lastEliminated : null,
      log: st.log.slice(-10),
    };
  }
}
