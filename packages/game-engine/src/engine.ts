import {
  GAME_OVER_MS,
  RESULT_MS,
  ROLE_REVEAL_MS,
  ROLE_META,
  roleTeam,
  type DayVoteRecap,
  type GamePhase,
  type HunterShotRecap,
  type HunterShotView,
  type NightRecap,
  type PublicVoteChoice,
  type RecapPlayer,
  type Role,
  type RoomConfig,
  type TrialRecap,
  type TrialView,
  type Winner,
} from "@masoi/shared";
import { assignRoles, type AssignInput } from "./assignRoles";
import { buildBotKnowledgeView, buildLegalVoteChoices } from "./bot/knowledge";
import type { BotKnowledgeView } from "./bot/types";
import {
  GameError,
  type DeathInfo,
  type EnginePlayer,
  type GameState,
  type NominationOutcome,
  type PublicDeath,
  type TrialState,
} from "./types";

export interface SeerResultView {
  targetId: string;
  targetName: string;
  isWolf: boolean;
}

export interface DetectiveResultView {
  target1: { id: string; name: string };
  target2: { id: string; name: string };
  sameTeam: boolean;
}

export interface PriestResultView {
  target: { id: string; name: string };
  isWolf: boolean;
}

export interface NightInfoView {
  canAct: boolean;
  acted: boolean;
  wolvesLocked: boolean;
  wolfTarget: string | null;
  wolfSecondaryTarget?: string | null;
  wolfVoteCounts?: Record<string, number>;
  wolfSkipVotes?: number;
  wolfVotesRequired?: number;
  myWolfVote?: string | null;
  guardPrevious?: string | null;
  guardianAngelCharges?: number;
  guardianAngelPrevious?: string | null;
  seerResult: SeerResultView | null;
  apprenticeAwakened?: boolean;
  detectiveResult?: DetectiveResultView | null;
  priestHolyWaterUsed?: boolean;
  priestResult?: PriestResultView | null;
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
    cursedTurned: boolean;
  } | null;
  players: {
    id: string;
    name: string;
    alive: boolean;
    isBot: boolean;
    role?: Role;
    /** Chỉ kèm theo khi role được lộ hoàn toàn; xem PlayerView.cursedTurned. */
    cursedTurned?: boolean;
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
  trialInfo: TrialView | null;
  lastTrial: TrialRecap | null;
  hunterShotInfo: HunterShotView | null;
  hunterShots: HunterShotRecap[];
  dayVoteHistory: DayVoteRecap[];
  log: string[];
}

const recapPlayer = (player: EnginePlayer | undefined): RecapPlayer | null =>
  player ? { id: player.id, name: player.name } : null;

function emptyNight(wolfCubRageTonight = false): GameState["night"] {
  return {
    wolfVotes: {},
    killTarget: null,
    wolfSecondaryTarget: null,
    wolfCubRageTonight,
    wolvesLocked: false,
    guardTarget: null,
    guardianAngelTarget: null,
    healTonight: false,
    poisonTarget: null,
    witchSkipped: false,
    seerResults: {},
    priestTarget: null,
    detectiveTargets: null,
    detectiveResults: {},
    priestResults: {},
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
    this.state.phaseStartedAt ??= this.state.phaseEndsAt ?? Date.now();
    this.state.voteMutations ??= [];
    this.state.dayVoteHistory ??= [];
    this.state.hunterReaction ??= null;
    this.state.hunterShots ??= [];
    // State lưu trước khi có phiên toà không có hai trường này.
    this.state.trial ??= null;
    this.state.lastTrial ??= null;
    this.state.night.wolfVotes ??= {};
    this.state.night.wolfSecondaryTarget ??= null;
    this.state.night.wolfCubRageTonight ??= false;
    this.state.night.wolvesLocked ??= false;
    this.state.night.witchSkipped ??= false;
    this.state.night.guardianAngelTarget ??= null;
    this.state.night.priestTarget ??= null;
    this.state.night.detectiveTargets ??= null;
    this.state.night.detectiveResults ??= {};
    this.state.night.priestResults ??= {};
    this.state.guardianAngelPrevious ??= null;
    this.state.guardianAngelCharges ??= {};
    this.state.priestHolyWaterUsed ??= {};
    this.state.apprenticeAwakened ??= false;
    this.state.wolfCubRageNextNight ??= false;
    // State lưu trước khi có Kẻ Nguyền Rủa không có hai trường dưới đây. Mặc
    // định an toàn là "role tắt, chưa ai bị nguyền": không ván cũ nào bỗng dưng
    // mọc thêm một người đã đổi phe.
    this.state.config.cursed ??= false;
    for (const player of this.state.players) {
      player.cursedTurned ??= false;
      if (player.role === "GUARDIAN_ANGEL" && this.state.guardianAngelCharges[player.id] === undefined) {
        this.state.guardianAngelCharges[player.id] = 2;
      }
    }
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
    const guardianAngelCharges: Record<string, number> = {};
    for (const p of players) {
      if (roles[p.id] === "GUARDIAN_ANGEL") {
        guardianAngelCharges[p.id] = 2;
      }
    }
    const state: GameState = {
      phase: "ROLE_REVEAL",
      round: 0,
      phaseEndsAt: now + ROLE_REVEAL_MS,
      phaseStartedAt: now,
      players: players.map((p) => ({
        ...p,
        role: roles[p.id],
        alive: true,
        cursedTurned: false,
      })),
      config,
      winner: null,
      night: emptyNight(),
      votes: {},
      voteMutations: [],
      dayVoteHistory: [],
      guardPrevious: null,
      guardianAngelPrevious: null,
      guardianAngelCharges,
      priestHolyWaterUsed: {},
      apprenticeAwakened: false,
      wolfCubRageNextNight: false,
      healUsed: false,
      poisonUsed: false,
      lastNightDeaths: [],
      nightHistory: [],
      lastEliminated: null,
      trial: null,
      lastTrial: null,
      hunterReaction: null,
      hunterShots: [],
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

  private queueHunterReaction(deaths: Array<{ playerId: string }>, source: "night" | "vote"): void {
    if (this.state.hunterReaction) return;
    const hunter = deaths
      .map((death) => this.player(death.playerId))
      .find((player) => player?.role === "HUNTER");
    if (hunter) {
      this.state.hunterReaction = { hunterId: hunter.id, source, resolved: false };
    }
  }

  setPhase(phase: GamePhase, durationMs: number, now = Date.now()) {
    this.state.phase = phase;
    this.state.phaseStartedAt = now;
    this.state.phaseEndsAt = now + durationMs;
    if (phase === "NIGHT") {
      this.state.round += 1;
      const rageTonight = this.state.wolfCubRageNextNight;
      this.state.wolfCubRageNextNight = false;
      this.state.night = emptyNight(rageTonight);
      this.state.votes = {};
      this.state.lastNightDeaths = [];
    }
    if (phase === "DAY_DISCUSSION") {
      this.state.votes = {};
    }
    if (phase === "VOTING") {
      this.state.votes = {};
      this.state.voteMutations = [];
    }
    // Một phiên toà không bao giờ được sống sót sang ngày kế tiếp: mỗi ngày
    // đúng một phiên, và phiên đó bắt đầu từ vote sơ bộ.
    if (phase === "NIGHT" || phase === "DAY_DISCUSSION" || phase === "VOTING") {
      this.state.trial = null;
    }
  }

  // ---- Hành động ban đêm ----

  submitNightAction(
    playerId: string,
    type:
      | "KILL"
      | "SEE"
      | "GUARD"
      | "HEAL"
      | "POISON"
      | "SKIP"
      | "DETECTIVE_CHECK"
      | "GUARDIAN_PROTECT"
      | "HOLY_WATER",
    targetId: string | null,
    secondaryTargetId?: string | null,
  ): void {
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
        const canSee = p.role === "SEER" || (p.role === "APPRENTICE_SEER" && st.apprenticeAwakened);
        if (!canSee) throw new GameError("Chỉ Tiên Tri (hoặc Tiên Tri Tập Sự đã thức tỉnh) mới được soi");
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
      case "GUARDIAN_PROTECT": {
        if (p.role !== "GUARDIAN_ANGEL") throw new GameError("Chỉ Thiên Thần Hộ Mệnh mới được bảo vệ");
        if (!targetId || !target) throw new GameError("Hãy chọn một người để bảo vệ");
        const charges = st.guardianAngelCharges[playerId] ?? 2;
        if (charges <= 0) throw new GameError("Thiên Thần Hộ Mệnh đã hết lượt bảo vệ");
        if (targetId === st.guardianAngelPrevious) {
          throw new GameError("Không thể bảo vệ cùng một người hai đêm liên tiếp");
        }
        st.night.guardianAngelTarget = targetId;
        st.guardianAngelCharges[playerId] = charges - 1;
        break;
      }
      case "DETECTIVE_CHECK": {
        if (p.role !== "DETECTIVE") throw new GameError("Chỉ Thám Tử mới được kiểm tra");
        if (!targetId || !secondaryTargetId) {
          throw new GameError("Thám Tử cần chọn đủ 2 người chơi khác nhau để kiểm tra");
        }
        if (targetId === secondaryTargetId) {
          throw new GameError("Không thể chọn cùng một người chơi 2 lần");
        }
        const t1 = this.player(targetId);
        const t2 = this.player(secondaryTargetId);
        if (!t1 || !t1.alive || !t2 || !t2.alive) {
          throw new GameError("Cả 2 mục tiêu phải còn sống");
        }
        const sameTeam = roleTeam(t1.role) === roleTeam(t2.role);
        st.night.detectiveTargets = { target1: targetId, target2: secondaryTargetId };
        st.night.detectiveResults[playerId] = {
          target1Id: targetId,
          target2Id: secondaryTargetId,
          sameTeam,
        };
        break;
      }
      case "HOLY_WATER": {
        if (p.role !== "PRIEST") throw new GameError("Chỉ Linh Mục mới được dùng Nước thánh");
        if (!targetId || !target) throw new GameError("Hãy chọn một người để dùng Nước thánh");
        if (st.priestHolyWaterUsed[playerId]) {
          throw new GameError("Bình Nước thánh đã được sử dụng");
        }
        st.night.priestTarget = targetId;
        st.priestHolyWaterUsed[playerId] = true;
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
    if (role === "APPRENTICE_SEER") {
      return this.state.apprenticeAwakened;
    }
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

  /** Xử lý toàn bộ hành động ban đêm theo thứ tự:
   * 1. Shields (Guard & Guardian Angel)
   * 2. Information (Seer, Apprentice Seer awakened, Detective)
   * 3. Offensive Actions (Priest Holy Water & Wolves Bites)
   * 4. Witch Reaction (Heal & Poison)
   * 5. Impact & Conversion (Shields/Heal nullify kill, Cursed turned, Poison ignores shields)
   * 6. Post-night triggers (Hunter, Apprentice Seer awakening, Wolf Cub rage)
   */
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

    // 1. Ghi nhận shields
    const guardedIds = new Set<string>();
    if (st.night.guardTarget) guardedIds.add(st.night.guardTarget);
    if (st.night.guardianAngelTarget) guardedIds.add(st.night.guardianAngelTarget);

    // 2. Information results are already recorded during submitNightAction

    // 3. Priest Holy Water
    if (st.night.priestTarget) {
      const priestPlayer = this.alivePlayers().find((p) => p.role === "PRIEST");
      const target = this.player(st.night.priestTarget);
      if (priestPlayer && target && target.alive) {
        const isWolf = roleTeam(target.role) === "wolves";
        st.night.priestResults[priestPlayer.id] = { targetId: target.id, isWolf };
        if (isWolf) {
          addDeath({ playerId: target.id, name: target.name, cause: "priest" });
        } else {
          addDeath({ playerId: priestPlayer.id, name: priestPlayer.name, cause: "priest_backfire" });
        }
      }
    }

    // 4 & 5. Xác định nạn nhân bị cắn bởi Sói (Primary & Secondary target)
    let healApplied = false;
    let cursedBitten: EnginePlayer | null = null;

    const wolfTargets = [st.night.killTarget, st.night.wolfSecondaryTarget].filter(
      (t): t is string => t !== null && t !== undefined,
    );

    for (const targetId of wolfTargets) {
      const victim = this.player(targetId);
      if (victim && victim.alive) {
        const isGuarded = guardedIds.has(victim.id);
        const isHealed = targetId === st.night.killTarget && st.night.healTonight && !st.healUsed;
        if (isHealed) healApplied = true;

        if (!isGuarded && !isHealed) {
          if (victim.role === "CURSED") {
            cursedBitten = victim;
          } else {
            addDeath({ playerId: victim.id, name: victim.name, cause: "wolf" });
          }
        }
      }
    }

    // Bình cứu chỉ mất khi có nạn nhân thật để cứu
    if (healApplied) st.healUsed = true;

    // Bình độc: đâm xuyên mọi protection
    if (st.night.poisonTarget && !st.poisonUsed) {
      const victim = this.player(st.night.poisonTarget);
      if (victim && victim.alive) {
        addDeath({ playerId: victim.id, name: victim.name, cause: "poison" });
        st.poisonUsed = true;
      }
    }

    // Cập nhật trạng thái
    st.guardPrevious = st.night.guardTarget;
    st.guardianAngelPrevious = st.night.guardianAngelTarget;
    st.lastNightDeaths = deaths.map((d) => ({ playerId: d.playerId, name: d.name }));
    for (const d of deaths) {
      const p = this.player(d.playerId);
      if (p) p.alive = false;
    }

    // 6. Post-night triggers
    // Cursed conversion
    const cursedTurned = cursedBitten !== null && cursedBitten.alive ? cursedBitten : null;
    if (cursedTurned) {
      cursedTurned.role = "WEREWOLF";
      cursedTurned.cursedTurned = true;
    }

    // Check if Seer died -> awaken apprentice seer
    const seerDied = deaths.some((d) => {
      const p = this.player(d.playerId);
      return p?.role === "SEER";
    });
    if (seerDied) {
      st.apprenticeAwakened = true;
    }

    // Check if Wolf Cub died -> trigger wolf cub rage next night
    const wolfCubDied = deaths.some((d) => {
      const p = this.player(d.playerId);
      return p?.role === "WOLF_CUB";
    });
    if (wolfCubDied) {
      st.wolfCubRageNextNight = true;
    }

    this.queueHunterReaction(deaths, "night");
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
      cursedTurned: recapPlayer(cursedTurned ?? undefined),
    };
    st.nightHistory.push(recap);

    st.phase = "NIGHT_RESULT";
    st.phaseEndsAt = now + RESULT_MS;
    return deaths;
  }

  // ---- Bình chọn ban ngày ----

  /** targetId null nghĩa là chọn "Không treo ai", không phải bỏ trống phiếu. */
  submitVote(voterId: string, targetId: string | null, now = Date.now()): void {
    const st = this.state;
    if (st.phase !== "VOTING") throw new GameError("Chỉ được bỏ phiếu trong pha bỏ phiếu");
    const voter = this.mustPlayer(voterId);
    if (!voter.alive) throw new GameError("Người chết không được bỏ phiếu");
    if (targetId !== null) {
      const target = this.player(targetId);
      if (!target) throw new GameError("Mục tiêu không tồn tại");
      if (!target.alive) throw new GameError("Không thể bỏ phiếu cho người đã chết");
    }
    const previousTarget = st.votes[voterId];
    if (previousTarget !== undefined && previousTarget === targetId) return;

    const toChoice = (id: string | null): PublicVoteChoice =>
      id === null ? { type: "NO_ELIMINATION" } : { type: "PLAYER", targetId: id };
    const sequence = st.voteMutations.length + 1;
    st.voteMutations.push({
      id: `${st.round}:nomination:${sequence}`,
      round: st.round,
      voterId,
      previousChoice: previousTarget === undefined ? null : toChoice(previousTarget),
      choice: toChoice(targetId),
      castAt: now,
      phaseStartedAt: st.phaseStartedAt,
      phaseEndsAt: st.phaseEndsAt ?? now,
      sequence,
    });
    st.votes[voterId] = targetId;
  }

  allAliveVoted(): boolean {
    return this.alivePlayers().every((p) => this.state.votes[p.id] !== undefined);
  }

  /**
   * Tách phiếu người chơi khỏi phiếu không treo. Gộp chung vào một Record sẽ
   * cần một id giả cho lựa chọn không treo, và id đó sẽ rò ra snapshot cùng UI.
   * Thị trưởng (MAYOR) có trọng số x2 phiếu.
   */
  voteTally(): { players: Record<string, number>; noElimination: number } {
    const players: Record<string, number> = {};
    let noElimination = 0;
    for (const [voterId, targetId] of Object.entries(this.state.votes)) {
      const voter = this.player(voterId);
      const weight = voter?.role === "MAYOR" ? 2 : 1;
      if (targetId === null) noElimination += weight;
      else players[targetId] = (players[targetId] ?? 0) + weight;
    }
    return { players, noElimination };
  }

  /**
   * Kiểm phiếu sơ bộ và chọn bị cáo. KHÔNG giết ai - mọi cái chết ban ngày đi
   * qua resolveFinalVote.
   *
   * defenseMs là tham số chứ không đọc từ config: machine đã sở hữu toàn bộ
   * lịch trình pha, engine không nên có hai nguồn sự thật cho cùng một mốc.
   */
  resolveNomination(defenseMs: number, now = Date.now()): NominationOutcome {
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

    // Mỗi lần kiểm phiếu sơ bộ mở một trang mới: kết quả phiên toà hôm trước
    // không được rơi lại vào màn hình kết quả hôm nay.
    st.lastEliminated = null;
    st.lastTrial = null;

    let outcome: NominationOutcome;
    if (uniqueLeader && leader.type === "PLAYER") {
      const accused = this.player(leader.targetId);
      if (accused && accused.alive) {
        st.trial = { accusedId: accused.id, finalVotes: {} };
        st.log.push(`${accused.name} bị đưa ra biện hộ.`);
        st.phase = "DEFENSE";
        st.phaseEndsAt = now + defenseMs;
        outcome = { kind: "TRIAL", accusedId: accused.id };
        this.recordDayVoteRecap(outcome);
        return outcome;
      }
    }

    st.trial = null;
    // Ba kết cục khác nhau về ý nghĩa nên log phải phân biệt được, dù UI gộp
    // hai nhánh không có nạn nhân vào cùng một câu.
    const reason =
      leader === undefined ? "no-votes" : uniqueLeader ? "no-elimination" : "tie";
    st.log.push(
      reason === "no-elimination"
        ? "Dân làng quyết định không treo ai."
        : "Hoà phiếu, không ai bị loại.",
    );
    st.phase = "ELIMINATION";
    st.phaseEndsAt = now + RESULT_MS;
    outcome = { kind: "NONE", reason };
    this.recordDayVoteRecap(outcome);
    return outcome;
  }

  private recordDayVoteRecap(outcome: NominationOutcome): void {
    const st = this.state;
    st.dayVoteHistory.push({
      round: st.round,
      mutations: st.voteMutations.map((mutation) => ({
        ...mutation,
        previousChoice: mutation.previousChoice && { ...mutation.previousChoice },
        choice: { ...mutation.choice },
      })),
      finalBallots: Object.entries(st.votes).map(([voterId, targetId]) => ({
        voterId,
        choice: targetId === null ? { type: "NO_ELIMINATION" } : { type: "PLAYER", targetId },
      })),
      nomination: { ...outcome },
      finalJudgment: null,
    });
  }

  // ---- Phiên toà: biện hộ và bỏ phiếu xác nhận ----

  private mustTrial(): TrialState {
    const trial = this.state.trial;
    if (!trial) throw new GameError("Không có phiên toà đang diễn ra");
    return trial;
  }

  /** Cử tri hợp lệ của vòng xác nhận: người còn sống, trừ chính bị cáo. */
  finalVoters(): EnginePlayer[] {
    const trial = this.mustTrial();
    return this.alivePlayers().filter((p) => p.id !== trial.accusedId);
  }

  beginFinalVote(durationMs: number, now = Date.now()): void {
    this.mustTrial();
    this.state.phase = "FINAL_VOTE";
    this.state.phaseEndsAt = now + durationMs;
  }

  /** guilty true là Treo, false là Tha. Cả hai đều là phiếu thật. */
  submitFinalVote(voterId: string, guilty: boolean): void {
    const st = this.state;
    if (st.phase !== "FINAL_VOTE") throw new GameError("Chỉ được bỏ phiếu trong pha xác nhận");
    const trial = this.mustTrial();
    const voter = this.mustPlayer(voterId);
    if (!voter.alive) throw new GameError("Người chết không được bỏ phiếu");
    // Bị cáo tự tha mình thì lá phiếu đó vô nghĩa mà vẫn làm lệch ngưỡng.
    if (voterId === trial.accusedId) throw new GameError("Bị cáo không được bỏ phiếu cho chính mình");
    // So với undefined chứ không dùng truthiness: một phiếu Tha đã lưu là false.
    if (trial.finalVotes[voterId] !== undefined) throw new GameError("Bạn đã bỏ phiếu");
    trial.finalVotes[voterId] = guilty;
  }

  allFinalVotersVoted(): boolean {
    const trial = this.mustTrial();
    return this.finalVoters().every((p) => trial.finalVotes[p.id] !== undefined);
  }

  /**
   * Kiểm phiếu xác nhận. Bỏ qua phiếu của người không còn sống: một phát bắn
   * của Thợ Săn có thể giết một cử tri giữa phiên toà.
   * Thị trưởng (MAYOR) có trọng số x2 phiếu.
   */
  finalVoteTally(): { guilty: number; innocent: number; abstain: number; eligible: number } {
    const trial = this.mustTrial();
    const voters = this.finalVoters();
    let guilty = 0;
    let innocent = 0;
    let totalWeight = 0;
    let votedWeight = 0;
    for (const voter of voters) {
      const weight = voter.role === "MAYOR" ? 2 : 1;
      totalWeight += weight;
      const vote = trial.finalVotes[voter.id];
      if (vote === undefined) continue;
      votedWeight += weight;
      if (vote) guilty += weight;
      else innocent += weight;
    }
    return { guilty, innocent, abstain: totalWeight - votedWeight, eligible: totalWeight };
  }

  /** Số phiếu Treo tối thiểu để kết án. */
  guiltyRequired(): number {
    return Math.floor(this.finalVoteTally().eligible / 2) + 1;
  }

  /** Trả về người bị treo; tha hoặc không đủ phiếu trả về null. */
  resolveFinalVote(now = Date.now()): PublicDeath | null {
    const st = this.state;
    if (st.phase !== "FINAL_VOTE") throw new GameError("Chỉ xử lý phiếu khi đang bỏ phiếu xác nhận");
    const trial = this.mustTrial();
    const { guilty, innocent, abstain, eligible } = this.finalVoteTally();
    const accused = this.mustPlayer(trial.accusedId);

    // Nhân đôi thay vì chia đôi: eligible lẻ sẽ đưa số thực vào một phép so sánh
    // quyết định ai sống ai chết. Phiếu trắng vì thế tính là Tha.
    const lynched = eligible > 0 && guilty * 2 > eligible && accused.alive;

    const recap = [...st.dayVoteHistory].reverse().find((item) => item.round === st.round);
    if (recap) {
      recap.finalJudgment = {
        ballots: this.finalVoters().flatMap((voter) => {
          const guiltyVote = trial.finalVotes[voter.id];
          return guiltyVote === undefined ? [] : [{ voterId: voter.id, guilty: guiltyVote }];
        }),
        guilty,
        innocent,
        abstain,
        lynched,
      };
    }

    let eliminated: PublicDeath | null = null;
    if (lynched) {
      accused.alive = false;
      eliminated = { playerId: accused.id, name: accused.name };
      if (accused.role === "SEER") {
        st.apprenticeAwakened = true;
      }
      if (accused.role === "WOLF_CUB") {
        st.wolfCubRageNextNight = true;
      }
      this.queueHunterReaction([eliminated], "vote");
    }

    st.lastEliminated = eliminated;
    st.lastTrial = {
      accused: { id: accused.id, name: accused.name },
      guilty,
      innocent,
      abstain,
      lynched,
    };
    st.trial = null;
    st.log.push(
      lynched
        ? `Dân làng đã treo ${accused.name} (${guilty}-${innocent}).`
        : `Dân làng đã tha ${accused.name} (${guilty}-${innocent}).`,
    );
    st.phase = "ELIMINATION";
    st.phaseEndsAt = now + RESULT_MS;
    return eliminated;
  }

  // ---- Phản ứng của Thợ Săn ----

  hasPendingHunterShot(): boolean {
    return !!this.state.hunterReaction && !this.state.hunterReaction.resolved;
  }

  beginHunterShot(durationMs: number, now = Date.now()): void {
    if (!this.hasPendingHunterShot()) throw new GameError("Không có lượt bắn của Thợ Săn");
    this.state.phase = "HUNTER_SHOT";
    this.state.phaseEndsAt = now + durationMs;
  }

  submitHunterShot(playerId: string, targetId: string | null): PublicDeath | null {
    const st = this.state;
    if (st.phase !== "HUNTER_SHOT") throw new GameError("Chỉ được bắn trong lượt của Thợ Săn");
    if (!this.hasPendingHunterShot()) throw new GameError("Lượt bắn của Thợ Săn đã được giải quyết");

    const reaction = st.hunterReaction!;
    if (playerId !== reaction.hunterId) throw new GameError("Chỉ Thợ Săn được bắn");
    const hunter = this.mustPlayer(playerId);
    if (hunter.role !== "HUNTER" || hunter.alive) throw new GameError("Thợ Săn phải đã chết mới được bắn");

    let target: EnginePlayer | null = null;
    if (targetId !== null) {
      if (targetId === hunter.id) throw new GameError("Thợ Săn không thể tự bắn mình");
      target = this.mustPlayer(targetId);
      if (!target.alive) throw new GameError("Không thể bắn người đã chết");
      target.alive = false;
    }

    reaction.resolved = true;
    st.hunterShots.push({
      round: st.round,
      hunter: { id: hunter.id, name: hunter.name },
      target: target ? { id: target.id, name: target.name } : null,
      source: reaction.source,
    });
    st.log.push(
      target
        ? `Thợ Săn ${hunter.name} đã bắn ${target.name}.`
        : `Thợ Săn ${hunter.name} quyết định không bắn ai.`,
    );
    return target ? { playerId: target.id, name: target.name } : null;
  }

  completeHunterReaction(): "night" | "vote" {
    const reaction = this.state.hunterReaction;
    if (!reaction || !reaction.resolved) {
      throw new GameError("Phản ứng của Thợ Săn chưa được giải quyết");
    }
    this.state.hunterReaction = null;
    return reaction.source;
  }

  // ---- Điều kiện thắng ----

  checkWin(): Winner {
    const st = this.state;
    if (st.hunterReaction && !st.hunterReaction.resolved) return null;
    const wolvesAlive = this.aliveWolves().length;
    const othersAlive = this.alivePlayers().length - wolvesAlive;
    if (wolvesAlive === 0) return "village";
    if (wolvesAlive >= othersAlive) return "wolves";
    return null;
  }

  finishGame(winner: Exclude<Winner, null>, now = Date.now()) {
    this.state.winner = winner;
    this.state.phase = "GAME_OVER";
    this.state.phaseEndsAt = now + GAME_OVER_MS;
    this.state.log.push(winner === "wolves" ? "Phe Ma Sói chiến thắng!" : "Phe Dân Làng chiến thắng!");
  }

  // ---- View ----

  /**
   * Khối hành động đêm của một vai. Chỉ Sói và Phù Thuỷ được biết nạn nhân, và
   * Phù Thuỷ chỉ biết sau khi bầy Sói khoá phiếu - trước đó cô ta còn đang chờ lượt.
   */
  private nightInfoFor(
    viewer: EnginePlayer,
    seerResult: SeerResultView | null,
    detectiveResult: DetectiveResultView | null,
    priestResult: PriestResultView | null,
  ): NightInfoView {
    const st = this.state;
    const locked = st.night.wolvesLocked;
    const isWolf = roleTeam(viewer.role) === "wolves";
    const isWitch = viewer.role === "WITCH";
    const tally = isWolf ? this.wolfVoteTally() : null;

    let acted = false;
    if (isWolf) {
      acted = st.night.wolfVotes[viewer.id] !== undefined;
    } else if (viewer.role === "SEER" || (viewer.role === "APPRENTICE_SEER" && st.apprenticeAwakened)) {
      acted = st.night.seerResults[viewer.id] !== undefined;
    } else if (viewer.role === "GUARD") {
      acted = st.night.guardTarget !== null;
    } else if (viewer.role === "GUARDIAN_ANGEL") {
      acted = st.night.guardianAngelTarget !== null;
    } else if (viewer.role === "DETECTIVE") {
      acted = st.night.detectiveResults[viewer.id] !== undefined;
    } else if (viewer.role === "PRIEST") {
      acted = st.night.priestTarget !== null;
    } else if (isWitch) {
      acted = st.night.witchSkipped || st.night.healTonight || st.night.poisonTarget !== null;
    }

    return {
      canAct: isWitch ? locked : isWolf ? !locked : true,
      acted,
      wolvesLocked: locked,
      wolfTarget: (isWolf || isWitch) && locked ? st.night.killTarget : null,
      wolfSecondaryTarget: isWolf && locked ? st.night.wolfSecondaryTarget : undefined,
      wolfVoteCounts: tally ? tally.players : undefined,
      wolfSkipVotes: tally ? tally.skip : undefined,
      wolfVotesRequired: isWolf ? this.aliveWolves().length : undefined,
      myWolfVote: isWolf ? st.night.wolfVotes[viewer.id] ?? null : undefined,
      guardPrevious: viewer.role === "GUARD" ? st.guardPrevious : undefined,
      guardianAngelCharges:
        viewer.role === "GUARDIAN_ANGEL" ? st.guardianAngelCharges[viewer.id] ?? 2 : undefined,
      guardianAngelPrevious:
        viewer.role === "GUARDIAN_ANGEL" ? st.guardianAngelPrevious : undefined,
      seerResult,
      apprenticeAwakened: viewer.role === "APPRENTICE_SEER" ? st.apprenticeAwakened : undefined,
      detectiveResult,
      priestHolyWaterUsed:
        viewer.role === "PRIEST" ? st.priestHolyWaterUsed[viewer.id] ?? false : undefined,
      priestResult,
      healUsed: st.healUsed,
      poisonUsed: st.poisonUsed,
    };
  }

  /** Khối phiên toà của một người xem. Chỉ gọi khi state.trial khác null. */
  private trialViewFor(viewerId: string, viewer: EnginePlayer | undefined): TrialView {
    const st = this.state;
    const trial = st.trial!;
    const accused = this.player(trial.accusedId);
    const { guilty, innocent } = this.finalVoteTally();
    // Đọc trực tiếp finalVotes chứ không qua finalVoters(): người xem có thể đã
    // chết giữa phiên toà, và khi đó họ không còn là cử tri nhưng vẫn phải thấy
    // đúng lá phiếu mình đã bỏ.
    const myVote = trial.finalVotes[viewerId];

    return {
      accusedId: trial.accusedId,
      accusedName: accused?.name ?? "?",
      guiltyVotes: guilty,
      innocentVotes: innocent,
      guiltyRequired: this.guiltyRequired(),
      canVote:
        st.phase === "FINAL_VOTE" &&
        viewer?.alive === true &&
        viewerId !== trial.accusedId &&
        myVote === undefined,
      hasVoted: myVote !== undefined,
      myVote: myVote ?? null,
      canSpeak: st.phase === "DEFENSE" && viewerId === trial.accusedId && viewer?.alive === true,
    };
  }

  snapshotFor(viewerId: string): PlayerGameView {
    const st = this.state;
    const viewer = this.player(viewerId);
    const revealAll = st.phase === "GAME_OVER";
    // Sói luôn biết đồng bọn của mình
    const viewerIsWolf = viewer !== undefined && viewer.alive && roleTeam(viewer.role) === "wolves";

    const tally = this.voteTally();
    // Số phiếu sơ bộ là bối cảnh của cả phiên toà: giấu đi trong lúc biện hộ thì
    // bị cáo không có gì để phản biện.
    const inTrialPhase = st.phase === "DEFENSE" || st.phase === "FINAL_VOTE";
    const showVoteCounts = st.phase === "VOTING" || inTrialPhase || revealAll;
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
      // Đồng bọn Sói chỉ được biết đây là một con Sói, không được biết nó vốn
      // là Kẻ Nguyền Rủa: gốc nguyền rủa chỉ lộ cùng lúc với toàn bộ vai trò.
      cursedTurned: revealAll ? p.cursedTurned === true : undefined,
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

    const detectiveEntry = viewer ? st.night.detectiveResults[viewerId] : undefined;
    const detectiveResult =
      detectiveEntry && viewer
        ? {
            target1: {
              id: detectiveEntry.target1Id,
              name: this.player(detectiveEntry.target1Id)?.name ?? "?",
            },
            target2: {
              id: detectiveEntry.target2Id,
              name: this.player(detectiveEntry.target2Id)?.name ?? "?",
            },
            sameTeam: detectiveEntry.sameTeam,
          }
        : null;

    const priestEntry = viewer ? st.night.priestResults[viewerId] : undefined;
    const priestResult =
      priestEntry && viewer
        ? {
            target: {
              id: priestEntry.targetId,
              name: this.player(priestEntry.targetId)?.name ?? "?",
            },
            isWolf: priestEntry.isWolf,
          }
        : null;

    return {
      phase: st.phase,
      round: st.round,
      phaseEndsAt: st.phaseEndsAt,
      winner: st.winner,
      you: viewer
        ? {
            id: viewer.id,
            role: viewer.role,
            alive: viewer.alive,
            cursedTurned: viewer.cursedTurned === true,
          }
        : null,
      players: playersView,
      nightInfo:
        st.phase === "NIGHT" && viewer && viewer.alive && this.hasNightAction(viewer.role)
          ? this.nightInfoFor(viewer, seerResult, detectiveResult, priestResult)
          : null,
      hunterShotInfo:
        st.phase === "HUNTER_SHOT" && st.hunterReaction
          ? {
              hunterId: st.hunterReaction.hunterId,
              hunterName: this.player(st.hunterReaction.hunterId)?.name ?? "?",
              canAct: !st.hunterReaction.resolved && viewerId === st.hunterReaction.hunterId,
              resolved: st.hunterReaction.resolved,
              target: st.hunterReaction.resolved
                ? st.hunterShots.at(-1)?.target ?? null
                : null,
            }
          : null,
      trialInfo: inTrialPhase && st.trial ? this.trialViewFor(viewerId, viewer) : null,
      lastTrial:
        st.phase === "ELIMINATION" || st.phase === "CHECK_WIN" || st.phase === "GAME_OVER"
          ? st.lastTrial
          : null,
      hasVoted,
      // ?? null ở đây an toàn vì đã gác bằng hasVoted: chỉ đọc khi thật sự có
      // phiếu, nên null trả về là phiếu không treo chứ không phải "chưa vote".
      myVote: hasVoted ? st.votes[viewerId] ?? null : null,
      noEliminationVoteCount: showVoteCounts ? tally.noElimination : 0,
      votesRevealed:
        inTrialPhase ||
        st.phase === "ELIMINATION" ||
        st.phase === "GAME_OVER" ||
        st.phase === "CHECK_WIN",
      lastNightDeaths: st.phase === "NIGHT_RESULT" || st.phase === "DAY_DISCUSSION" ? st.lastNightDeaths : [],
      nightHistory: st.phase === "GAME_OVER" ? st.nightHistory : [],
      hunterShots: st.phase === "GAME_OVER" ? st.hunterShots : [],
      dayVoteHistory: st.dayVoteHistory.map((recap) => ({
        ...recap,
        mutations: recap.mutations.map((mutation) => ({
          ...mutation,
          previousChoice: mutation.previousChoice && { ...mutation.previousChoice },
          choice: { ...mutation.choice },
        })),
        finalBallots: recap.finalBallots.map((ballot) => ({
          ...ballot,
          choice: { ...ballot.choice },
        })),
        nomination: { ...recap.nomination },
        finalJudgment: recap.finalJudgment && {
          ...recap.finalJudgment,
          ballots: recap.finalJudgment.ballots.map((ballot) => ({ ...ballot })),
        },
      })),
      lastEliminated: st.phase === "ELIMINATION" || st.phase === "CHECK_WIN" ? st.lastEliminated : null,
      log: st.log.slice(-10),
    };
  }

  /**
   * View đã lọc dành riêng cho lõi AI deterministic. Đây là entry point duy
   * nhất được đọc state để dựng knowledge của BOT: `bot/knowledge.ts` chỉ nhận
   * giá trị đã lọc, nên không có đường vòng nào để một trường bí mật lọt ra.
   *
   * Luật role trùng đúng với `snapshotFor` ở mọi pha đang chơi, và chặt hơn ở
   * `GAME_OVER`: view này KHÔNG bao giờ reveal toàn bộ role, vì lõi AI không có
   * việc gì phải làm sau khi ván kết thúc. BOT vì thế không bao giờ có lợi thế
   * thông tin mà người thật không có.
   *
   * Hai chỗ rộng hơn snapshot một cách có chủ đích, cả hai đều là sự thật công
   * khai không mang role: `currentVoteCounts` và `lastNightDeaths` không bị
   * khoá theo pha, để runtime còn dựng được memory `PLAYER_DIED` trong pha bỏ
   * phiếu - lúc snapshot của UI đã ngừng gửi danh sách đó.
   */
  botKnowledgeFor(botId: string): BotKnowledgeView {
    const st = this.state;
    const viewer = this.mustPlayer(botId);
    // Sói chết mất liên lạc với bầy, giống hệt luật của snapshotFor.
    const viewerIsWolf = viewer.alive && roleTeam(viewer.role) === "wolves";

    const knownRoles: Record<string, Role> = { [viewer.id]: viewer.role };
    if (viewerIsWolf) {
      for (const player of st.players) {
        if (player.id !== viewer.id && roleTeam(player.role) === "wolves") {
          knownRoles[player.id] = player.role;
        }
      }
    }

    const seerResultEntry = st.night.seerResults[botId];
    const seerResult = seerResultEntry
      ? {
          targetId: seerResultEntry.targetId,
          targetName: this.player(seerResultEntry.targetId)?.name ?? "?",
          isWolf: seerResultEntry.isWolf,
        }
      : null;

    return buildBotKnowledgeView({
      botId,
      round: st.round,
      phase: st.phase,
      phaseStartedAt: st.phaseStartedAt,
      phaseEndsAt: st.phaseEndsAt,
      selfRole: viewer.role,
      players: st.players.map(({ id, name, alive }) => ({ id, name, alive })),
      knownRoles,
      seerResult,
      publicVoteHistory: st.dayVoteHistory,
      currentVoteCounts: this.voteTally(),
      // Phiếu của chính mình vẫn hiển thị sau khi pha bỏ phiếu đóng, đúng như
      // snapshotFor: nói với BOT rằng nó "chưa bầu" trong lúc biện hộ là một
      // lời khai sai, và lõi belief sẽ dựng memory từ lời khai đó.
      currentVote: viewer.alive ? st.votes[botId] : undefined,
      legalVoteChoices: this.legalVoteChoicesFor(botId),
      lastNightDeaths: st.lastNightDeaths,
    });
  }

  /**
   * Lựa chọn hợp lệ cho vòng đề cử hiện tại. Trả mảng rỗng khi người xem không
   * được bỏ phiếu, để lõi AI không phải tự suy ra luật pha.
   */
  legalVoteChoicesFor(viewerId: string): PublicVoteChoice[] {
    return buildLegalVoteChoices(
      this.canSubmitVote(viewerId),
      this.alivePlayers().map((player) => player.id),
    );
  }

  /** Cùng điều kiện mà submitVote thực thi, tách ra để view không đoán lại luật. */
  private canSubmitVote(viewerId: string): boolean {
    return this.state.phase === "VOTING" && this.player(viewerId)?.alive === true;
  }
}
