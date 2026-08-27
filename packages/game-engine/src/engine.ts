import { ROLE_META, roleTeam, type GamePhase, type Role, type RoomConfig, type Winner } from "@masoi/shared";
import { assignRoles, type AssignInput } from "./assignRoles";
import {
  GameError,
  type DeathInfo,
  type GameState,
  type PublicDeath,
} from "./types";

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
  nightInfo: {
    canAct: boolean;
    acted: boolean;
    wolfTarget: string | null;
    seerResult: { targetId: string; targetName: string; isWolf: boolean } | null;
    healUsed: boolean;
    poisonUsed: boolean;
  } | null;
  myVote: string | null;
  votesRevealed: boolean;
  lastNightDeaths: PublicDeath[];
  lastEliminated: PublicDeath | null;
  log: string[];
}

function emptyNight(): GameState["night"] {
  return {
    killTarget: null,
    actedWolves: [],
    guardTarget: null,
    healTonight: false,
    poisonTarget: null,
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

  submitNightAction(playerId: string, type: "KILL" | "SEE" | "GUARD" | "HEAL" | "POISON", targetId: string | null): void {
    const st = this.state;
    if (st.phase !== "NIGHT") throw new GameError("Chỉ được hành động vào ban đêm");
    const p = this.mustPlayer(playerId);
    if (!p.alive) throw new GameError("Người chết không thể hành động");

    const target = targetId ? this.player(targetId) : undefined;
    if (targetId && !target) throw new GameError("Mục tiêu không tồn tại");
    if (target && !target.alive) throw new GameError("Mục tiêu đã chết");

    switch (type) {
      case "KILL": {
        if (roleTeam(p.role) !== "wolves") throw new GameError("Chỉ Ma Sói mới được cắn");
        if (!targetId || !target) throw new GameError("Hãy chọn một mục tiêu để cắn");
        if (roleTeam(target.role) === "wolves") throw new GameError("Không thể cắn đồng bọn");
        st.night.killTarget = targetId;
        if (!st.night.actedWolves.includes(playerId)) st.night.actedWolves.push(playerId);
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
        if (p.role !== "WITCH") throw new GameError("Chỉ Phù Thủy mới có bình cứu");
        if (st.healUsed) throw new GameError("Bình cứu đã được sử dụng");
        // HEAL là quyết định cứu nạn nhân đêm nay, không cần chỉ định mục tiêu
        st.night.healTonight = true;
        break;
      }
      case "POISON": {
        if (p.role !== "WITCH") throw new GameError("Chỉ Phù Thủy mới có bình độc");
        if (st.poisonUsed) throw new GameError("Bình độc đã được sử dụng");
        if (!targetId || !target) throw new GameError("Hãy chọn một người để đầu độc");
        st.night.poisonTarget = targetId;
        break;
      }
      default:
        throw new GameError("Hành động không hợp lệ");
    }
  }

  hasNightAction(role: Role): boolean {
    return ROLE_META[role].nightOrder !== undefined;
  }

  /** Đêm kết thúc khi mọi Sói còn sống đã chọn mục tiêu cắn. */
  isNightComplete(): boolean {
    const wolves = this.aliveWolves();
    if (wolves.length === 0) return true;
    return wolves.every((w) => this.state.night.actedWolves.includes(w.id));
  }

  /** Xử lý toàn bộ hành động ban đêm theo thứ tự: Bảo Vệ -> Sói -> Phù Thủy. */
  resolveNight(now = Date.now()): DeathInfo[] {
    const st = this.state;
    if (st.phase !== "NIGHT") throw new GameError("Chỉ xử lý đêm khi đang trong pha NIGHT");

    const deaths: DeathInfo[] = [];
    const addDeath = (death: DeathInfo): void => {
      if (!deaths.some((item) => item.playerId === death.playerId)) {
        deaths.push(death);
      }
    };

    // 1. Xác định nạn nhân bị cắn
    if (st.night.killTarget) {
      const victim = this.player(st.night.killTarget);
      if (victim && victim.alive) {
        const guarded = st.night.guardTarget === victim.id;
        const healed = st.night.healTonight && !st.healUsed;
        if (!guarded && !healed) {
          addDeath({ playerId: victim.id, name: victim.name, cause: "wolf" });
        }
      }
    }

    // Tiêu hao bình cứu nếu đã quyết định dùng
    if (st.night.healTonight && !st.healUsed) st.healUsed = true;

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

    st.phase = "NIGHT_RESULT";
    st.phaseEndsAt = now + 8_000;
    return deaths;
  }

  // ---- Bình chọn ban ngày ----

  submitVote(voterId: string, targetId: string): void {
    const st = this.state;
    if (st.phase !== "VOTING") throw new GameError("Chỉ được bỏ phiếu trong pha bỏ phiếu");
    const voter = this.mustPlayer(voterId);
    if (!voter.alive) throw new GameError("Người chết không được bỏ phiếu");
    const target = this.player(targetId);
    if (!target) throw new GameError("Mục tiêu không tồn tại");
    if (!target.alive) throw new GameError("Không thể bỏ phiếu cho người đã chết");
    st.votes[voterId] = targetId;
  }

  allAliveVoted(): boolean {
    return this.alivePlayers().every((p) => this.state.votes[p.id] !== undefined);
  }

  voteTally(): Record<string, number> {
    const tally: Record<string, number> = {};
    for (const targetId of Object.values(this.state.votes)) {
      tally[targetId] = (tally[targetId] ?? 0) + 1;
    }
    return tally;
  }

  /** Trả về người bị loại; hoà phiếu trả về null (không ai bị loại). */
  resolveVote(now = Date.now()): PublicDeath | null {
    const st = this.state;
    if (st.phase !== "VOTING") throw new GameError("Chỉ xử lý phiếu khi đang bỏ phiếu");
    const tally = this.voteTally();
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    let eliminated: PublicDeath | null = null;

    if (
      entries.length > 0 &&
      (entries.length === 1 || entries[0][1] > entries[1][1])
    ) {
      const [targetId, count] = entries[0];
      const p = this.player(targetId);
      if (p && p.alive) {
        p.alive = false;
        eliminated = { playerId: p.id, name: p.name };
      }
    }

    st.lastEliminated = eliminated;
    st.log.push(eliminated ? `Dân làng đã loại ${eliminated.name}.` : "Hoà phiếu, không ai bị loại.");
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

  snapshotFor(viewerId: string): PlayerGameView {
    const st = this.state;
    const viewer = this.player(viewerId);
    const revealAll = st.phase === "GAME_OVER" || (viewer !== undefined && !viewer.alive);
    // Sói luôn biết đồng bọn của mình
    const viewerIsWolf = viewer !== undefined && viewer.alive && roleTeam(viewer.role) === "wolves";

    const tally = this.voteTally();
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
      voteCount: st.phase === "VOTING" || revealAll ? tally[p.id] ?? 0 : 0,
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
          ? {
              canAct: true,
              acted:
                roleTeam(viewer.role) === "wolves"
                  ? st.night.actedWolves.includes(viewerId)
                  : viewer.role === "SEER"
                    ? st.night.seerResults[viewerId] !== undefined
                    : viewer.role === "GUARD"
                      ? st.night.guardTarget !== null
                      : st.night.healTonight || st.night.poisonTarget !== null,
              wolfTarget:
                roleTeam(viewer.role) === "wolves" ? st.night.killTarget : null,
              seerResult,
              healUsed: st.healUsed,
              poisonUsed: st.poisonUsed,
            }
          : null,
      myVote: viewer?.alive ? st.votes[viewerId] ?? null : null,
      votesRevealed: st.phase === "ELIMINATION" || st.phase === "GAME_OVER" || st.phase === "CHECK_WIN",
      lastNightDeaths: st.phase === "NIGHT_RESULT" || st.phase === "DAY_DISCUSSION" ? st.lastNightDeaths : [],
      lastEliminated: st.phase === "ELIMINATION" || st.phase === "CHECK_WIN" ? st.lastEliminated : null,
      log: st.log.slice(-10),
    };
  }
}
