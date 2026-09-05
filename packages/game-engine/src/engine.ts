import {
  DEAD_MESSAGE_MAX_LENGTH,
  RESULT_MS,
  ROLE_REVEAL_MS,
  ROLE_META,
  midGameDeathCauseClause,
  isRole,
  isWolfPack,
  outcomeName,
  specialRoleList,
  roleTeam,
  sameFaction,
  type DayVoteRecap,
  type ExecutionerView,
  type GameEventView,
  type GamePhase,
  type HunterShotRecap,
  type HunterShotView,
  type NightRecap,
  type PersonalWin,
  type PublicVoteChoice,
  type RecapPlayer,
  type Role,
  type RoomConfig,
  type Team,
  type TrialRecap,
  type TrialView,
  type Winner,
} from "@masoi/shared";
import { selectEvent } from "./events/eventManager";
import { assignRoles, type AssignInput } from "./assignRoles";
import { buildBotKnowledgeView, buildLegalVoteChoices } from "./bot/knowledge";
import type { BotKnowledgeView, NightActionKind, NightKnowledge } from "./bot/types";
import {
  GameError,
  type DeathInfo,
  type EnginePlayer,
  type GameState,
  type NominationOutcome,
  type PublicDeath,
  type TrialRecapState,
  type TrialState,
} from "./types";

export interface SeerResultView {
  targetId: string;
  targetName: string;
  /** Phe đọc ra được; `neutral` là "Phe trung lập", không kèm vai. */
  team?: Team;
  isWolf: boolean;
  secondaryTargetId?: string;
  secondaryTargetName?: string;
  secondaryTeam?: Team;
  secondaryIsWolf?: boolean;
}

export interface DetectiveResultView {
  target1: { id: string; name: string };
  target2: { id: string; name: string };
  sameTeam: boolean;
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
  /** Chỉ Sát Nhân thấy; xem `NightActionView.serialKillerTarget`. */
  serialKillerTarget?: string | null;
  serialKillerSkipped?: boolean;
  healUsed: boolean;
  poisonUsed: boolean;
  wolfCubRageTonight?: boolean;
}

export interface PlayerGameView {
  phase: GamePhase;
  round: number;
  phaseEndsAt: number | null;
  activeEvent?: GameEventView | null;
  winner: Winner;
  you: {
    id: string;
    role: Role | undefined;
    alive: boolean;
    cursedTurned: boolean;
    executionerTurned: boolean;
  } | null;
  players: {
    id: string;
    name: string;
    alive: boolean;
    isBot: boolean;
    role?: Role;
    /** Chỉ kèm theo khi role được lộ hoàn toàn; xem PlayerView.cursedTurned. */
    cursedTurned?: boolean;
    /** Cùng luật lộ với `cursedTurned`; xem PlayerView.executionerTurned. */
    executionerTurned?: boolean;
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
  /** Danh tính phiếu đang mở; rỗng ngoài pha VOTING. Xem RoomSnapshot.openBallots. */
  openBallots: Array<{ voterId: string; choice: PublicVoteChoice }>;
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
  dayOfTruthClaims?: Record<string, string | null>;
  pendingLastStandVictim?: { playerId: string; name: string } | null;
  /** Lượt nói của linh hồn, tính riêng cho người xem. Xem RoomSnapshot. */
  deadCanSpeak: { canAct: boolean } | null;
  /** Thắng lợi cá nhân, đã lọc theo quyền của người xem. Xem `personalWinsFor`. */
  personalWins: PersonalWin[];
  /** Nhiệm vụ của Kẻ Báo Thù, `null` với mọi người khác. Xem `executionerViewFor`. */
  executioner: ExecutionerView | null;
}

const recapPlayer = (player: EnginePlayer | undefined): RecapPlayer | null =>
  player ? { id: player.id, name: player.name } : null;

/**
 * Vai TRUNG LẬP có thể có mặt trong ván này.
 *
 * Suy từ bộ bài, cộng thêm MỘT trường hợp mà bộ bài không nói ra: một ván có Kẻ
 * Báo Thù có thể sinh ra một Thằng Hề giữa chừng, kể cả khi `config.jester` là
 * `false`. `config.jester` nói về LÚC CHIA BÀI; nó không phải một lời hứa rằng
 * vai đó sẽ không bao giờ xuất hiện.
 *
 * Vẫn là thông tin CÔNG KHAI: cấu hình phòng đi xuống mọi client trong
 * `RoomSnapshot.config`, và luật hoá Hề nằm ngay trên thẻ vai. Danh sách này
 * nói vai nào CÓ THỂ có mặt, không nói ai đang cầm lá nào - nên thêm `JESTER`
 * vào đây không tiết lộ rằng chuyện đó ĐÃ xảy ra.
 */
function neutralRolesFor(config: RoomConfig): Role[] {
  const roles = specialRoleList(config).filter((role) => roleTeam(role) === "neutral");
  if (config.executioner && !roles.includes("JESTER")) roles.push("JESTER");
  return roles;
}

/**
 * Bốc mục tiêu cho mọi Kẻ Báo Thù trong bộ bài vừa chia.
 *
 * Bốn tính chất, và cả bốn đều là luật chứ không phải chi tiết cài đặt:
 *
 * 1. **Chỉ rút `rng` khi thật sự CÓ một Kẻ Báo Thù.** Vòng lặp không chạy lần
 *    nào với một bộ bài không bật vai này, nên dòng số ngẫu nhiên sau
 *    `assignRoles` giữ nguyên từng bit - mọi ván tái lập theo seed đã ghi
 *    trước bản này vẫn chia ra đúng bộ bài cũ.
 * 2. **Ứng viên là PHE DÂN, không phải "không phải Sói".** Vai trung lập bị
 *    loại theo đúng nghĩa đen của luật, và chính Kẻ Báo Thù tự loại mình vì nó
 *    mang nhãn `neutral` - không cần một phép loại trừ riêng nào để nhớ.
 * 3. **Thứ tự ứng viên bám theo `players`**, tức thứ tự chỗ ngồi, chứ không
 *    theo một bảng nào được sắp lại. Cùng seed cho cùng mục tiêu.
 * 4. **Ném khi không có ứng viên nào.** Một ván bắt đầu với một Kẻ Báo Thù
 *    không có nhiệm vụ là một ván mà một người chơi không có cách nào để
 *    thắng, và im lặng cấp cho họ một mục tiêu bừa thì còn tệ hơn.
 */
function drawExecutionerTargets(
  players: ReadonlyArray<{ id: string; role: Role }>,
  rng: () => number,
): Record<string, string> {
  const targets: Record<string, string> = {};
  const candidates = players.filter((player) => roleTeam(player.role) === "village");
  for (const player of players) {
    if (player.role !== "EXECUTIONER") continue;
    if (candidates.length === 0) {
      throw new GameError(
        "Không thể bắt đầu: bộ bài có Kẻ Báo Thù nhưng không còn ai thuộc phe Dân Làng để làm mục tiêu",
      );
    }
    targets[player.id] = candidates[Math.floor(rng() * candidates.length)].id;
  }
  return targets;
}

function emptyNight(wolfCubRageTonight = false): GameState["night"] {
  return {
    wolfVotes: {},
    killTarget: null,
    wolfSecondaryTarget: null,
    wolfCubRageTonight,
    wolvesLocked: false,
    guardTarget: null,
    guardSecondTarget: null,
    guardianAngelTarget: null,
    healTonight: false,
    poisonTarget: null,
    witchSkipped: false,
    seerResults: {},
    detectiveTargets: null,
    detectiveResults: {},
    serialKillerTarget: null,
    serialKillerSkipped: false,
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
    this.state.night.guardSecondTarget ??= null;
    this.state.night.guardianAngelTarget ??= null;
    this.state.night.detectiveTargets ??= null;
    this.state.night.detectiveResults ??= {};
    // State lưu trước khi có Sát Nhân không có ba trường dưới. Mặc định an toàn
    // là "role tắt, đêm nay chưa ra tay": không ván cũ nào bỗng dưng mọc thêm
    // một nhát dao.
    this.state.night.serialKillerTarget ??= null;
    this.state.night.serialKillerSkipped ??= false;
    this.state.guardianAngelPrevious ??= null;
    this.state.guardianAngelCharges ??= {};
    this.state.apprenticeAwakened ??= false;
    this.state.wolfCubRageNextNight ??= false;
    this.state.activeEvent ??= null;
    this.state.eventHistory ??= [];
    this.state.guardSecondPrevious ??= null;
    this.state.pendingLastStandVictim ??= null;
    this.state.elderBiteSurvived ??= false;
    this.state.firstDeadId ??= null;
    this.state.villagePowersLostRound ??= null;
    this.state.bloodMoonArmed ??= false;
    this.state.bloodMoonUsed ??= false;
    this.state.deadCanSpeakUsed ??= false;
    this.state.deadCanSpeakChosenId ??= null;
    this.state.howlBonusDay ??= null;
    this.state.dayOfTruthClaims ??= {};
    // State lưu trước khi có vai trung lập không có hai trường dưới. Mặc định
    // an toàn là "role tắt, chưa ai thắng cá nhân": không ván cũ nào bỗng dưng
    // mọc thêm một thành tích.
    this.state.personalWins ??= [];
    this.state.config.jester ??= false;
    this.state.config.serialKiller ??= false;
    /*
     * State lưu trước khi có Kẻ Báo Thù không có hai trường dưới. Mặc định an
     * toàn là "role tắt, không ai có nhiệm vụ": một ván cũ không bỗng dưng mọc
     * thêm một mục tiêu, và `settleExecutioner` không tìm thấy gì để làm.
     *
     * Cố ý KHÔNG bốc mục tiêu ở đây. Constructor chạy MỖI LẦN state được nạp
     * lại - reconnect, khôi phục sau restart, mỗi lần đọc từ Redis - nên một
     * lời bốc đặt ở đây sẽ đổi nhiệm vụ của người chơi sau mỗi lần mất mạng.
     * Chỗ bốc duy nhất là `create`.
     */
    this.state.config.executioner ??= false;
    this.state.executionerTargets ??= {};
    // State lưu trước khi có Kẻ Nguyền Rủa không có hai trường dưới đây. Mặc
    // định an toàn là "role tắt, chưa ai bị nguyền": không ván cũ nào bỗng dưng
    // mọc thêm một người đã đổi phe.
    this.state.config.cursed ??= false;
    for (const player of this.state.players) {
      /*
       * Ván cũ nạp lại có thể mang một vai không còn tồn tại (Linh Mục, Bà
       * Đồng đã bị xóa cứng). Không ném: ván đang chạy dở phải đọc được, và
       * người đó đơn giản thành Dân Làng.
       */
      if (!isRole(player.role)) {
        this.state.log.push(`Vai ${String(player.role)} không còn tồn tại - chuyển thành Dân Làng.`);
        (player as { role: Role }).role = "VILLAGER";
      }
      player.cursedTurned ??= false;
      player.executionerTurned ??= false;
      player.doppelgangerTurned ??= false;
      if (player.role === "GUARDIAN_ANGEL" && this.state.guardianAngelCharges[player.id] === undefined) {
        this.state.guardianAngelCharges[player.id] = 2;
      }
    }
  }

  /** Trạng thái thô (plain object, dùng để serialize qua Redis). */
  getState(): GameState {
    return this.state;
  }

  /**
   * `rng` là tham số CUỐI và tuỳ chọn, nên mọi call site hiện có không đổi hành
   * vi. Nó chỉ mở một đường inject đã có sẵn ở `assignRoles`, không đổi luật:
   * không có nó, một ván mô phỏng "cùng seed" vẫn chia vai khác nhau mỗi lần và
   * harness phải đi đường vòng để tự xáo lại.
   */
  static create(
    players: AssignInput[],
    config: RoomConfig,
    now = Date.now(),
    rng: () => number = Math.random,
  ): GameEngine {
    const roles = assignRoles(players, config, rng);
    /*
     * Bốc mục tiêu NGAY SAU khi chia bài, và trước khi dựng state.
     *
     * Đứng ở đây vì hai lý do. Thứ nhất, một bộ bài không có mục tiêu hợp lệ
     * phải làm cả lời gọi này NÉM, chứ không được trả về một engine đã dựng
     * xong mà thiếu nhiệm vụ - `startGame` bên server dựa vào đúng điều đó để
     * không bỏ phòng lại ở trạng thái bắt đầu dở dang. Thứ hai, đây là chỗ duy
     * nhất `rng` còn ở đúng vị trí sau `assignRoles`, nên "cùng seed cho cùng
     * ván" phủ luôn cả mục tiêu.
     */
    const executionerTargets = drawExecutionerTargets(
      players.map((p) => ({ id: p.id, role: roles[p.id] })),
      rng,
    );
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
        executionerTurned: false,
        doppelgangerTurned: false,
      })),
      config,
      winner: null,
      night: emptyNight(),
      votes: {},
      voteMutations: [],
      dayVoteHistory: [],
      guardPrevious: null,
      guardSecondPrevious: null,
      guardianAngelPrevious: null,
      guardianAngelCharges,
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
      activeEvent: null,
      eventHistory: [],
      log: [],
      pendingLastStandVictim: null,
      elderBiteSurvived: false,
      firstDeadId: null,
      villagePowersLostRound: null,
      bloodMoonArmed: false,
      bloodMoonUsed: false,
      deadCanSpeakUsed: false,
      deadCanSpeakChosenId: null,
      howlBonusDay: null,
      dayOfTruthClaims: {},
      // Ván mới, sổ thành tích trắng. Không đọc lại từ đâu cả: một thắng lợi cá
      // nhân thuộc về ĐÚNG một ván.
      personalWins: [],
      // Cùng lý do: nhiệm vụ thuộc về ĐÚNG một ván, và ván mới bốc lại từ đầu.
      executionerTargets,
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

  /**
   * Bầy Sói còn sống - dùng cho phiếu cắn và chat đêm, KHÔNG dùng cho luật thắng.
   *
   * `isWolfPack` chứ không phải `roleTeam`: Kẻ Phản Bội thắng cùng phe Sói
   * nhưng không bỏ phiếu cắn và không có mặt trong chat đêm. `checkWin` có phép
   * đếm riêng và nó mới là chỗ hỏi về PHE.
   */
  aliveWolves() {
    return this.alivePlayers().filter((p) => isWolfPack(p.role));
  }

  private queueHunterReaction(deaths: Array<{ playerId: string }>, source: "night" | "vote"): void {
    // Phát bắn của Thợ Săn là một kỹ năng đặc biệt của phe làng như mọi kỹ năng
    // khác, nên bẫy Trưởng Lão tắt luôn cả nó.
    if (!this.villagePowersActive()) return;
    if (this.state.hunterReaction) return;
    const hunter = deaths
      .map((death) => this.player(death.playerId))
      .find((player) => player?.role === "HUNTER");
    if (hunter) {
      this.state.hunterReaction = { hunterId: hunter.id, source, resolved: false };
    }
  }

  /**
   * Những người Bảo Vệ đã che đêm trước - MỘT nguồn sự thật cho luật "không đỡ
   * lại hai đêm liên tiếp".
   *
   * Đêm Cảnh Giác dựng hai khiên trong một đêm, nên luật ấy phải nhớ cả hai.
   * Khi bản đầu chỉ nhớ `guardPrevious`, người ở ô thứ hai được che lại ngay
   * đêm sau - một đường vòng qua đúng cái luật mà vai này dựa vào.
   */
  private guardedLastNight(): string[] {
    return [this.state.guardPrevious, this.state.guardSecondPrevious].filter(
      (id): id is string => id !== null && id !== undefined,
    );
  }

  /**
   * Cái bẫy dưới chân phe làng: chính họ giết Trưởng Lão thì mất hết kỹ năng.
   *
   * CHỈ ba nguồn do phe làng tự tay gây ra - treo cổ, Bình Độc, đạn Thợ Săn -
   * chứ không phải mọi cái chết. Nhát cắn của bầy Sói và nhát dao của Sát Nhân
   * KHÔNG kích bẫy, và đó là quyết định cân bằng chứ không phải chỗ sót: nếu
   * mọi cái chết đều kích, bầy Sói chỉ cần cắn Trưởng Lão hai đêm liền là tắt
   * sạch vế làng - một nước đi trội tuyệt đối, và ván coi như xong ở đêm 2.
   */
  private elderKilledByVillage(playerId: string): void {
    const victim = this.player(playerId);
    if (!victim || victim.role !== "ELDER") return;
    if (this.state.villagePowersLostRound != null) return;
    /*
     * VÒNG KẾ TIẾP, không phải vòng đang chạy.
     *
     * Treo cổ xảy ra ở ban ngày và ngày đó kết thúc ngay sau bản án, nên tắt từ
     * vòng hiện tại thì hình phạt gần như không chạm vào gì. Bình độc và đạn Thợ
     * Săn thì ngược lại - chúng nổ ở đêm hoặc ngay sau một cái chết đêm - và tắt
     * ngay sẽ ăn luôn phần ngày mà làng chưa kịp biết mình vừa mất gì.
     *
     * Lấy đúng một vòng cho cả hai đường: `round` tăng một lần mỗi khi vào
     * `NIGHT`, nên vòng `round + 1` phủ đúng đêm kế tiếp và ngày sau nó.
     */
    this.state.villagePowersLostRound = this.state.round + 1;
    this.state.log.push(
      `Trưởng Lão ${victim.name} ngã xuống bởi chính tay dân làng - mọi kỹ năng đặc biệt của phe làng mất hiệu lực suốt đêm và ngày kế tiếp.`,
    );
  }

  /**
   * Ghi lại NGƯỜI ĐẦU TIÊN của ván qua đời, và chỉ người đầu tiên.
   *
   * Nhận một danh sách ĐÃ XẾP THỨ TỰ chứ không phải một id: một đợt chết có thể
   * mang nhiều người (Sói cắn hai, Phù Thuỷ độc thêm một), và "ai trước" phải
   * theo đúng thứ tự mà `resolveNight` đã dựng chứ không theo thứ tự ghế.
   *
   * Tự chặn ghi đè: ô này chỉ được viết đúng một lần cả ván.
   */
  private noteDeathOrder(orderedIds: readonly string[]): void {
    if (this.state.firstDeadId) return;
    const first = orderedIds.find((id) => this.player(id) !== undefined);
    if (first) this.state.firstDeadId = first;
  }

  /** Kỹ năng đặc biệt phe làng còn hiệu lực không. Xem `elderKilledByVillage`. */
  private villagePowersActive(): boolean {
    // So bằng, không so "nhỏ hơn hoặc bằng": hình phạt phủ ĐÚNG một vòng rồi
    // tự hết, và ô này không cần dọn lại.
    return this.state.villagePowersLostRound !== this.state.round;
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

  startNight(
    durationMs: number,
    now = Date.now(),
    rng: () => number = Math.random,
    customEvent?: GameEventView | null,
  ): GameEventView | null {
    this.setPhase("NIGHT", durationMs, now);
    const event = customEvent !== undefined ? customEvent : selectEvent(this.state, "NIGHT", rng);
    this.state.activeEvent = event;
    if (event) {
      this.state.eventHistory.push(event);
      this.state.log.push(`Sự kiện Đêm: [${event.name}] - ${event.description}`);
    }
    return event;
  }

  startDay(
    durationMs: number,
    now = Date.now(),
    rng: () => number = Math.random,
    customEvent?: GameEventView | null,
  ): GameEventView | null {
    const event = customEvent !== undefined ? customEvent : selectEvent(this.state, "DAY", rng);
    let actualDuration = durationMs;
    if (event?.id === "CURFEW") {
      actualDuration = Math.floor(durationMs / 2);
    }
    this.setPhase("DAY_DISCUSSION", actualDuration, now);
    let activeEvent = event;
    if (event?.id === "JUDGMENT_DAY") {
      const detectiveEntries = Object.values(this.state.night.detectiveResults);
      const lastResult = detectiveEntries.at(-1);
      if (lastResult) {
        const target1Name = this.player(lastResult.target1Id)?.name ?? "?";
        const target2Name = this.player(lastResult.target2Id)?.name ?? "?";
        const announcement = `Kết quả Thám Tử: ${target1Name} và ${target2Name} là ${lastResult.sameTeam ? "CÙNG PHE" : "KHÁC PHE"}!`;
        activeEvent = { ...event, announcement };
      }
    } else if (event?.id === "MORNING_REPORT") {
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
      const lastNight = this.state.nightHistory.at(-1);
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
      activeEvent = { ...event, announcement };
    } else if (event?.id === "DEAD_CAN_SPEAK") {
      const announcement = `Tiếng Vọng Người Chết: một linh hồn có thể gửi lời nhắn ${DEAD_MESSAGE_MAX_LENGTH} ký tự ẩn danh.`;
      activeEvent = { ...event, announcement };
      // Bốc linh hồn NGAY tại đây thay vì để ai nhanh tay thì được: một cuộc
      // đua giữa người thật và BOT thì BOT luôn thắng, và người thắng đua lại
      // đổi theo độ trễ mạng chứ không theo ván đấu.
      //
      // `selectEvent` đã đòi có người chết, nhưng `customEvent` đi vòng qua nó
      // nên hàng rào phải nằm ở đây.
      const ghosts = this.state.players.filter((player) => !player.alive);
      this.state.deadCanSpeakChosenId =
        ghosts.length > 0 ? ghosts[Math.floor(rng() * ghosts.length)].id : null;
    } else if (event?.id === "HOWL_OF_THE_PACK") {
      this.state.howlBonusDay = this.state.round + 1;
    } else if (event?.id === "DAY_OF_TRUTH") {
      // initialize claims map for this day
      this.state.dayOfTruthClaims = {};
    }
    this.state.activeEvent = activeEvent;
    if (activeEvent) {
      this.state.eventHistory.push(activeEvent);
      this.state.log.push(`Sự kiện Ngày: [${activeEvent.name}] - ${activeEvent.description}`);
      if (activeEvent.announcement) {
        this.state.log.push(`[${activeEvent.name}] ${activeEvent.announcement}`);
      }
    }
    return activeEvent;
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
      | "SERIAL_KILL",
    targetId: string | null,
    secondaryTargetId?: string | null,
    rng: () => number = Math.random,
  ): void {
    const st = this.state;
    if (st.phase !== "NIGHT") throw new GameError("Chỉ được hành động vào ban đêm");
    const p = this.mustPlayer(playerId);
    if (!p.alive) throw new GameError("Người chết không thể hành động");
    // `hasNightAction` đã giấu hành động khỏi mọi màn hình và mọi lõi bot; đây
    // là chỗ DUY NHẤT có quyền cưỡng chế, nên luật phải được nhắc lại ở đây.
    if (roleTeam(p.role) === "village" && !this.villagePowersActive()) {
      throw new GameError("Kỹ năng đặc biệt của phe làng đã mất hiệu lực");
    }

    const target = targetId ? this.player(targetId) : undefined;
    if (targetId && !target) throw new GameError("Mục tiêu không tồn tại");
    // Mọi hành động đêm đều nhắm vào người còn sống, không có ngoại lệ: vai
    // duy nhất từng được chừa ra (Bà Đồng gọi hồn) đã bị xóa cứng.
    if (target && !target.alive) {
      throw new GameError("Mục tiêu đã chết");
    }

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
    if ((type === "KILL" || (type === "SKIP" && isWolfPack(p.role))) && st.night.wolvesLocked) {
      throw new GameError("Bầy Sói đã chốt mục tiêu đêm nay");
    }

    switch (type) {
      case "KILL": {
        if (!isWolfPack(p.role)) throw new GameError("Chỉ Ma Sói mới được cắn");
        if (!targetId || !target) throw new GameError("Hãy chọn một mục tiêu để cắn");
        /*
         * `isWolfPack`, KHÔNG phải `roleTeam`: bầy phải cắn được Kẻ Phản Bội.
         *
         * Bầy không biết nó là ai, nên một lời từ chối ở đây chính là một lời
         * khai - người chơi thử từng tên cho tới khi engine kêu lên là biết.
         * Ngược lại, một Kẻ Phản Bội chết vì đồng minh của chính nó là một kết
         * cục hoàn toàn hợp lệ của lá bài này.
         */
        if (isWolfPack(target.role)) throw new GameError("Không thể cắn đồng bọn");
        // Một phiếu, không phải quyết định cuối: Sói được đổi ý tới lúc khoá phiếu.
        st.night.wolfVotes[playerId] = targetId;
        if (secondaryTargetId) {
          const canDoubleKill = st.night.wolfCubRageTonight || st.activeEvent?.id === "BLOODY_HUNT";
          if (!canDoubleKill) throw new GameError("Chỉ được cắn 2 mục tiêu khi có Sói Con phẫn nộ hoặc event Cuộc Săn Đẫm Máu");
          const secTarget = this.player(secondaryTargetId);
          if (!secTarget || !secTarget.alive) throw new GameError("Mục tiêu phụ không hợp lệ");
          // Cùng lý do với mục tiêu chính ngay trên.
          if (isWolfPack(secTarget.role)) throw new GameError("Không thể cắn đồng bọn");
          if (targetId === secondaryTargetId) throw new GameError("Không thể cắn cùng một người 2 lần");
          st.night.wolfSecondaryTarget = secondaryTargetId;
        }
        break;
      }
      /*
       * Sát Nhân ra tay MỘT MÌNH.
       *
       * Không đi qua `wolfVotes`, không bị `wolvesLocked` chặn, và không kiểm
       * phiếu với ai: nó là một người, không phải một bầy. Vì thế nó cũng đổi ý
       * được tới lúc đêm khép lại - đúng như bầy Sói trước khi khoá phiếu.
       *
       * Ngoại lệ duy nhất là BỎ QUA: một khi đã chốt "đêm nay không giết ai"
       * thì không rút lại được, cùng luật và cùng lý do với `witchSkipped` -
       * một quyết định bỏ lượt phải là một quyết định, không phải một khoảng
       * trống để lấp lại sau.
       */
      case "SERIAL_KILL": {
        if (p.role !== "SERIAL_KILLER") throw new GameError("Chỉ Sát Nhân mới được ra tay");
        if (!targetId || !target) throw new GameError("Hãy chọn một người để giết");
        if (targetId === playerId) throw new GameError("Sát Nhân không thể tự giết mình");
        if (st.night.serialKillerSkipped) {
          throw new GameError("Sát Nhân đã bỏ qua đêm nay");
        }
        st.night.serialKillerTarget = targetId;
        break;
      }
      case "SEE": {
        const canSee = p.role === "SEER" || (p.role === "APPRENTICE_SEER" && st.apprenticeAwakened);
        if (!canSee) throw new GameError("Chỉ Tiên Tri (hoặc Tiên Tri Tập Sự đã thức tỉnh) mới được soi");
        // MỘT lượt soi mỗi đêm, chốt ngay tại lần nộp đầu.
        //
        // Sói và Bảo Vệ được đổi ý tới hết đêm vì lựa chọn của họ
        // KHÔNG trả lại thông tin gì; kết quả soi thì hiện ra ngay trong
        // snapshot của chính lần nộp này. Không có hàng rào ở đây thì "đổi ý"
        // trở thành "soi lại", và soi lại không giới hạn là quét sạch cả làng
        // trong một đêm - đủ để kết thúc ván ngay đêm 1.
        //
        // Ba chỗ khác của engine (`acted`, `nightActionPending`, và bộ chọn
        // hành động hợp lệ của BOT) từ trước tới nay đã coi "có kết quả soi" là
        // "đã hết lượt". Dòng này chỉ mang luật ấy về đúng nơi có quyền cưỡng
        // chế: client giấu nút đi không phải là một hàng rào.
        if (st.night.seerResults[playerId]) throw new GameError("Bạn đã soi trong đêm nay");
        if (st.activeEvent?.id === "MOONLESS_NIGHT") {
          throw new GameError("Đêm Không Trăng: Tiên Tri không thể soi đêm nay");
        }
        if (!targetId || !target) throw new GameError("Hãy chọn một người để soi");
        if (targetId === playerId) throw new GameError("Không thể soi chính mình");

        let secTargetId: string | undefined;
        let secTeam: Team | undefined;

        if (secondaryTargetId) {
          if (st.activeEvent?.id !== "CLEARING_MIST") {
            throw new GameError("Chỉ được soi 2 người khi có sự kiện Màn Sương Tan");
          }
          const secTarget = this.player(secondaryTargetId);
          if (!secTarget || !secTarget.alive) throw new GameError("Mục tiêu soi thứ 2 không hợp lệ");
          if (targetId === secondaryTargetId) throw new GameError("Không thể soi cùng 1 người 2 lần");
          secTargetId = secondaryTargetId;
          secTeam = secTarget.role === "TRAITOR" ? "village" : roleTeam(secTarget.role);
        }

        const isWolfShadow = st.activeEvent?.id === "WOLF_SHADOW";
        const shouldFlip = isWolfShadow && rng() < 0.3;
        /*
         * Kết quả soi là một PHE, và `isWolf` là hệ quả của nó.
         *
         * Trước đây chỉ có `isWolf`, và với hai phe thì "không phải Sói" đúng
         * bằng "phe làng". Với một vai trung lập thì câu đó thành lời nói dối:
         * Tiên Tri phải đọc ra "Phe trung lập" chứ không phải một lời bảo đảm
         * rằng người kia đứng về phía làng.
         *
         * Bóng Sói lật kết quả thì lật cả hai cho khớp nhau: một mục tiêu bị
         * lật luôn hiện ra là Sói (hoặc là làng nếu nó vốn là Sói), chứ không
         * bao giờ là một phe thứ ba mà nó không hề thuộc về.
         */
        const flipTeam = (team: Team): Team =>
          shouldFlip ? (team === "wolves" ? "village" : "wolves") : team;
        /*
         * Kẻ Phản Bội hiện ra là PHE LÀNG, không phải phe Sói.
         *
         * Đây là cả lá bài: nó thắng cùng phe Sói (`roleTeam` trả về `wolves`,
         * và `checkWin` đếm nó) nhưng Tiên Tri soi không ra. Để `roleTeam` chạy
         * thẳng ở đây thì nó chỉ còn là một con Sói không biết cắn.
         *
         * `village` chứ không phải `neutral`: nó không phải một phe thứ ba, và
         * Tiên Tri phải đọc ra đúng thứ mà một người làng đọc ra.
         */
        const seenTeam = (role: Role): Team =>
          role === "TRAITOR" ? "village" : roleTeam(role);
        const team = flipTeam(seenTeam(target.role));
        if (secTeam !== undefined) secTeam = flipTeam(secTeam);

        const seerResult: GameState["night"]["seerResults"][string] = {
          targetId,
          isWolf: team === "wolves",
          team,
        };
        if (secTargetId !== undefined) {
          seerResult.secondaryTargetId = secTargetId;
          seerResult.secondaryIsWolf = secTeam === "wolves";
          seerResult.secondaryTeam = secTeam;
        }

        st.night.seerResults[playerId] = seerResult;
        break;
      }
      case "GUARD": {
        if (p.role !== "GUARD") throw new GameError("Chỉ Bảo Vệ mới được bảo vệ");
        if (!targetId || !target) throw new GameError("Hãy chọn một người để bảo vệ");
        if (targetId === playerId) throw new GameError("Bảo Vệ không thể tự bảo vệ mình");
        if (this.guardedLastNight().includes(targetId)) {
          throw new GameError("Không thể bảo vệ cùng một người hai đêm liên tiếp");
        }
        /*
         * Mục tiêu thứ hai: gương đúng Màn Sương Tan của Tiên Tri ở trên.
         *
         * Mọi luật của lượt che đầu áp lại y nguyên cho lượt thứ hai - không tự
         * che, không che lại người đêm trước, không trùng người vừa chọn. Nới
         * một luật ra ở đây là biến sự kiện thành đường vòng qua chính luật của
         * vai: "che 2 người" phải là hai lượt che, không phải một lượt che cộng
         * một ngoại lệ.
         */
        let guardSecondId: string | null = null;
        if (secondaryTargetId) {
          if (st.activeEvent?.id !== "VIGILANT_NIGHT") {
            throw new GameError("Chỉ được che 2 người khi có sự kiện Đêm Cảnh Giác");
          }
          const secTarget = this.player(secondaryTargetId);
          if (!secTarget || !secTarget.alive) throw new GameError("Mục tiêu che thứ 2 không hợp lệ");
          if (secondaryTargetId === playerId) throw new GameError("Bảo Vệ không thể tự bảo vệ mình");
          if (secondaryTargetId === targetId) throw new GameError("Không thể che cùng 1 người 2 lần");
          if (this.guardedLastNight().includes(secondaryTargetId)) {
            throw new GameError("Không thể bảo vệ cùng một người hai đêm liên tiếp");
          }
          guardSecondId = secondaryTargetId;
        }
        st.night.guardTarget = targetId;
        st.night.guardSecondTarget = guardSecondId;
        break;
      }
      case "GUARDIAN_PROTECT": {
        if (p.role !== "GUARDIAN_ANGEL") throw new GameError("Chỉ Thiên Thần Hộ Mệnh mới được bảo vệ");
        if (!targetId || !target) throw new GameError("Hãy chọn một người để bảo vệ");
        /*
         * Không tự đỡ, gương theo Bảo Vệ ngay trên.
         *
         * Trước đây đây là vai DUY NHẤT tự nhắm được mình: Bảo Vệ và Tiên Tri
         * đều loại chính mình, còn vai này thì không - không có lý do
         * nào được viết ra, không có test, README cũng không nói. Nó là chỗ sót.
         *
         * Và nó không vô hại: hai lượt, không mất phí mỗi đêm, nên với một Thiên
         * Thần đã lộ mặt thì tự đỡ là nước đi trội tuyệt đối. Vai bảo vệ LÀNG khi
         * ấy thành vai tự bảo toàn, đúng thứ mà luật của Bảo Vệ sinh ra để chặn.
         * "Chỉ có 2 lượt nên tự đỡ đã tự mang chi phí" không cứu được lập luận:
         * Bảo Vệ cũng đánh đổi đúng một lượt như thế mỗi đêm mà vẫn bị cấm.
         */
        if (targetId === playerId) {
          throw new GameError("Thiên Thần Hộ Mệnh không thể tự bảo vệ mình");
        }
        const charges = st.guardianAngelCharges[playerId] ?? 2;
        if (charges <= 0) throw new GameError("Thiên Thần Hộ Mệnh đã hết lượt bảo vệ");
        if (targetId === st.guardianAngelPrevious) {
          throw new GameError("Không thể bảo vệ cùng một người hai đêm liên tiếp");
        }
        // Charge trừ lúc khép đêm chứ không phải lúc bấm, xem `resolveNight`.
        st.night.guardianAngelTarget = targetId;
        break;
      }
      case "DETECTIVE_CHECK": {
        if (p.role !== "DETECTIVE") throw new GameError("Chỉ Thám Tử mới được kiểm tra");
        // Cùng lý do với lượt soi ở trên: kết quả về ngay lúc nộp, nên lần nộp
        // đầu tiên là lần duy nhất.
        if (st.night.detectiveResults[playerId]) {
          throw new GameError("Thám Tử đã điều tra trong đêm nay");
        }
        if (!targetId || !secondaryTargetId) {
          throw new GameError("Thám Tử cần chọn đủ 2 người chơi khác nhau để kiểm tra");
        }
        if (targetId === secondaryTargetId) {
          throw new GameError("Không thể chọn cùng một người chơi 2 lần");
        }
        /*
         * Thám Tử không được ghép chính mình vào cặp.
         *
         * Không phải một luật cho gọn: tự ghép biến vai này THÀNH Tiên Tri. Thám
         * Tử biết chắc phe của chính nó, nên cặp `mình + X` đọc ra "cùng phe" là
         * X thuộc phe làng, "khác phe" là X thuộc Sói hoặc trung lập - một lượt
         * soi mỗi đêm, đúng thứ mà kết quả hai người vốn KHÔNG được phép nói.
         * Cái giá thiết kế của vai này là không biết ai trong hai người là Sói;
         * tự ghép xoá sạch cái giá đó.
         *
         * Hàng rào phải nằm ở đây chứ không chỉ ở `legalTargets`: danh sách hợp
         * lệ là gợi ý cho client và cho BOT, còn engine mới là nơi có quyền cưỡng
         * chế. Lõi BOT vốn đã tự loại mình (`bot/roles/detective.ts`), nên lỗ này
         * chỉ người thật khai thác được - tức self-play không bao giờ đo thấy nó.
         */
        if (targetId === playerId || secondaryTargetId === playerId) {
          throw new GameError("Thám Tử không thể tự đưa mình vào cặp kiểm tra");
        }
        const t1 = this.player(targetId);
        const t2 = this.player(secondaryTargetId);
        if (!t1 || !t1.alive || !t2 || !t2.alive) {
          throw new GameError("Cả 2 mục tiêu phải còn sống");
        }
        /*
         * `sameFaction`, KHÔNG phải `roleTeam(a) === roleTeam(b)`.
         *
         * Hai vai trung lập cùng mang nhãn `neutral` nhưng không đứng cùng ai,
         * kể cả nhau: Sát Nhân đi tìm cái chết của cả bàn, Thằng Hề thì không.
         * Trả "cùng phe" cho cặp đó là đưa cho Thám Tử một kết luận sai về đúng
         * hai lá bài nguy hiểm nhất ván.
         */
        const sameTeam = sameFaction(t1.role, t2.role);
        st.night.detectiveTargets = { target1: targetId, target2: secondaryTargetId };
        st.night.detectiveResults[playerId] = {
          target1Id: targetId,
          target2Id: secondaryTargetId,
          sameTeam,
        };
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
          // Dọn thuốc đã chọn trước đó: bỏ qua mà vẫn để nguyên lựa chọn cũ thì
          // `resolveNight` vẫn đổ thuốc, và người chơi lãnh một bình họ đã rút lại.
          st.night.healTonight = false;
          st.night.poisonTarget = null;
          st.night.witchSkipped = true;
        } else if (isWolfPack(p.role)) {
          st.night.wolfVotes[playerId] = null;
        } else if (p.role === "SERIAL_KILLER") {
          if (st.night.serialKillerSkipped) throw new GameError("Sát Nhân đã bỏ qua đêm nay");
          // Dọn mục tiêu đã chọn trước đó, cùng lý do với Phù Thuỷ ở trên: bỏ
          // qua mà vẫn để nguyên lựa chọn cũ thì `resolveNight` vẫn ra tay.
          st.night.serialKillerTarget = null;
          st.night.serialKillerSkipped = true;
        } else {
          throw new GameError("Chỉ Phù Thủy, Ma Sói hoặc Sát Nhân mới được bỏ qua hành động");
        }
        break;
      }
      default:
        throw new GameError("Hành động không hợp lệ");
    }
  }

  hasNightAction(role: Role): boolean {
    /*
     * Bẫy của Trưởng Lão tắt kỹ năng ở ĐÂY, không ở từng vai một.
     *
     * Ba đường đọc hàm này - `legalActions` của bot, `canAct` trong snapshot, và
     * phép kiểm "cả làng đã hành động xong chưa" - vì thế cùng tắt một lượt.
     * Rải cờ ra từng `case` trong `submitNightAction` sẽ để lại đúng những chỗ
     * quên: bot vẫn được chào một hành động mà engine sẽ ném, và lượt đêm của
     * nó mất trắng.
     *
     * Phe SÓI không bị đụng tới: bẫy này là hình phạt cho phe làng.
     */
    if (roleTeam(role) === "village" && !this.villagePowersActive()) return false;
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
    // `skipAllowed` tách riêng vì chỉ phiếu chính mới được quyền "không cắn";
    // `excludeId` để đòn cắn phụ không chốt trùng nạn nhân của phiếu chính.
    const pickTop = (skipAllowed: boolean, excludeId?: string | null): string | null => {
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
        if (alive.has(targetId) && targetId !== excludeId) consider(targetId, count);
      }
      if (skipAllowed) consider(null, tally.skip);
      return candidates.length === 0 ? null : candidates[Math.floor(rng() * candidates.length)];
    };

    st.night.killTarget = pickTop(true);

    // Ô cắn phụ dùng chung cho cả bầy nên không đi qua kiểm phiếu: phiếu chính
    // vẫn có thể chốt trúng đúng người đã bị đánh dấu cắn thêm, và bộ lọc trùng
    // trong `addDeath` sẽ nuốt mất vết cắn thứ hai. Đẩy đòn phụ sang ứng viên
    // còn lại trong phiếu bầy để phẫn nộ Sói Con không mất oan một mạng; bầy
    // chỉ bầu đúng một người thì mới thật sự không có nạn nhân thứ hai.
    if (st.night.wolfSecondaryTarget && st.night.wolfSecondaryTarget === st.night.killTarget) {
      st.night.wolfSecondaryTarget = pickTop(false, st.night.killTarget);
    }
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

  /**
   * Mọi người sống còn lượt đêm đều đã nộp xong.
   *
   * Dùng chung ĐÚNG vị từ `nightActionPending` mà `canAct` của UI đang dùng,
   * nên "màn hình của tôi đã hết việc" và "cả bàn đã hết việc" không thể lệch
   * nhau. Một bảng liệt kê vai riêng ở đây sẽ quên mất Tiên Tri Tập Sự vừa thức
   * tỉnh, hoặc quên rằng Phù Thuỷ chưa tới lượt khi phiếu Sói chưa khoá.
   *
   * Phù Thuỷ trước lúc khoá phiếu tính là ĐÃ XONG, và đó là chủ ý: chặng một
   * chốt phiếu Sói, chặng hai mới là cửa sổ của cô ta.
   */
  allNightActionsDone(): boolean {
    return this.alivePlayers().every(
      (p) => !this.hasNightAction(p.role) || !this.nightActionPending(p),
    );
  }

  /** Nới hạn của pha hiện tại; dùng để mở cửa sổ riêng cho Phù Thuỷ. */
  extendPhase(durationMs: number, now = Date.now()): void {
    this.state.phaseEndsAt = now + durationMs;
  }

  /** Xử lý toàn bộ hành động ban đêm theo thứ tự:
   * 1. Shields (Guard & Guardian Angel)
   * 2. Information (Seer, Apprentice Seer awakened, Detective)
   * 3. Offensive Actions (Wolves Bites)
   * 4. Witch Reaction (Heal & Poison)
   * 5. Impact & Conversion (Shields/Heal nullify kill, Cursed turned, Poison ignores shields)
   * 6. Post-night triggers (Hunter, Apprentice Seer awakening, Wolf Cub rage)
   */
  resolveNight(now = Date.now(), rng: () => number = Math.random): DeathInfo[] {
    const st = this.state;
    if (st.phase !== "NIGHT") throw new GameError("Chỉ xử lý đêm khi đang trong pha NIGHT");

    // Đêm kết thúc mà chưa ai khoá phiếu Sói thì chốt ngay tại đây: mọi lối vào
    // resolveNight đều phải thấy cùng một killTarget đã kiểm phiếu.
    if (!st.night.wolvesLocked) this.lockWolves(rng);

    const deaths: DeathInfo[] = [];
    const addDeath = (death: DeathInfo): void => {
      if (!deaths.some((item) => item.playerId === death.playerId)) {
        deaths.push(death);
      }
    };

    // LAST_STAND: check pending victim at start of this night's resolution
    if (this.state.pendingLastStandVictim && this.state.pendingLastStandVictim.dieRound <= this.state.round) {
      const pending = this.state.pendingLastStandVictim;
      const victim = this.player(pending.playerId);
      if (victim && victim.alive) {
        victim.alive = false;
        this.noteDeathOrder([victim.id]);
        addDeath({ playerId: victim.id, name: victim.name, cause: "wolf" });
        this.state.log.push(`Tử Thủ: ${victim.name} đã gục sau khi kéo dài sự sống!`);
        this.queueHunterReaction([{ playerId: victim.id }], "night");
        if (victim.role === "WOLF_CUB") this.state.wolfCubRageNextNight = true;
        if (victim.role === "SEER") this.state.apprenticeAwakened = true;
      }
      this.state.pendingLastStandVictim = null;
    }

    // 1. Ghi nhận shields
    const guardedIds = new Set<string>();
    if (st.night.guardTarget) guardedIds.add(st.night.guardTarget);
    if (st.night.guardSecondTarget) guardedIds.add(st.night.guardSecondTarget);
    if (st.night.guardianAngelTarget) guardedIds.add(st.night.guardianAngelTarget);
    /*
     * Trăng Máu: nạp từ đêm trước thì đêm nay 20% xuyên MỘT khiên.
     *
     * Chỉ QUYẾT ĐỊNH ở đây, chưa xoá khiên nào - khiên nào bị xuyên phải đợi
     * tới lúc biết Sói cắn ai. Trước đây chỗ này gỡ ngay phần tử đầu của Set,
     * tức luôn là khiên của Bảo Vệ và không bao giờ là của Thiên Thần Hộ Mệnh,
     * lại còn gỡ mà không cần biết người được che có nằm trong tầm cắn không:
     * Bảo Vệ che A, Sói cắn B thì cú xuyên tiêu vào hư không.
     *
     * Cú tung xúc xắc vẫn nằm sau `guardedIds.size > 0` như cũ - đêm không có
     * khiên nào thì không rút số, để dòng RNG của một ván không đổi.
     */
    let bloodMoonPierce = false;
    if (st.bloodMoonArmed) {
      st.bloodMoonArmed = false;
      st.bloodMoonUsed = true;
      bloodMoonPierce = guardedIds.size > 0 && rng() < 0.2;
    }

    // 2. Information results are already recorded during submitNightAction

    // 3 & 5. Xác định nạn nhân bị cắn bởi Sói (Primary & Secondary target)
    let healApplied = false;
    let cursedBitten: EnginePlayer | null = null;

    const isPeacefulNight = st.activeEvent?.id === "PEACEFUL_NIGHT";
    const primaryWolfTarget = isPeacefulNight ? null : st.night.killTarget;

    // Đêm Bình Yên tước CẢ lượt phụ: đêm Sói Con nổi giận là đêm duy nhất lượt
    // phụ tồn tại mà không cần sự kiện, và đó đúng là đêm làng cần được cứu.
    let secondaryTargetToProcess = isPeacefulNight ? null : st.night.wolfSecondaryTarget;
    if (st.activeEvent?.id === "BLOODY_HUNT" && secondaryTargetToProcess) {
      const success = rng() < 0.5;
      if (!success) {
        secondaryTargetToProcess = null;
      }
    }

    const wolfTargets = [primaryWolfTarget, secondaryTargetToProcess].filter(
      (t): t is string => t !== null && t !== undefined,
    );

    // Giờ mới biết Sói cắn ai: xuyên đúng khiên đang chắn một mục tiêu của Sói.
    // Sói cắn hai người mà cả hai đều có khiên thì mục tiêu chính mất khiên
    // trước - `wolfTargets` xếp chính trước phụ.
    if (bloodMoonPierce) {
      const pierced = wolfTargets.find((targetId) => guardedIds.has(targetId));
      if (pierced) {
        guardedIds.delete(pierced);
        st.log.push(`Trăng Máu xuyên thủng khiên bảo vệ ${this.player(pierced)?.name ?? "?"}!`);
      }
    }

    for (const targetId of wolfTargets) {
      const victim = this.player(targetId);
      if (victim && victim.alive) {
        const isGuarded = guardedIds.has(victim.id);
        const isHealed = targetId === st.night.killTarget && st.night.healTonight && !st.healUsed;
        if (isHealed) healApplied = true;

        if (!isGuarded && !isHealed) {
          if (victim.role === "CURSED") {
            cursedBitten = victim;
          } else if (victim.role === "ELDER" && !st.elderBiteSurvived) {
            /*
             * Tấm đệm của Trưởng Lão, dùng đúng MỘT lần cả ván.
             *
             * Đứng cùng chỗ với Kẻ Nguyền Rủa vì cùng một loại luật: nhát cắn
             * trúng đích nhưng KHÔNG thành một cái chết. Khác ở chỗ Nguyền Rủa
             * đổi phe còn lá này chỉ đơn giản là còn sống.
             *
             * Cờ bật ngay tại đây chứ không đợi khép đêm: bầy Sói cắn hai người
             * trong cùng một đêm (Sói Con nổi giận, Cuộc Săn Đẫm Máu) thì tấm
             * đệm chỉ được chắn cho nhát ĐẦU - vòng lặp này chạy qua cả hai
             * mục tiêu, và một tấm đệm chắn được cả hai là hai lần dùng.
             */
            st.elderBiteSurvived = true;
            st.log.push(`${victim.name} sống sót một cách khó hiểu qua đêm nay.`);
          } else {
            // LAST_STAND: delay death until end of next day, but not when cub rage double-kill is active
            if (st.activeEvent?.id === "LAST_STAND" && !st.pendingLastStandVictim && !st.night.wolfCubRageTonight) {
              st.pendingLastStandVictim = { playerId: victim.id, dieRound: st.round + 1 };
              st.log.push(`Tử Thủ: ${victim.name} được kéo dài sự sống tới hết ngày mai!`);
            } else {
              addDeath({ playerId: victim.id, name: victim.name, cause: "wolf" });
            }
          }
        }
      }
    }

    /*
     * Nhát dao của Sát Nhân.
     *
     * Đứng SAU vòng cắn của bầy Sói và TRƯỚC `st.healUsed = true` - vị trí là
     * một phần của luật, không phải một chi tiết sắp xếp:
     *
     *  - Sau vòng cắn, để `healApplied` đã biết bình cứu có đổ vào nạn nhân đêm
     *    nay hay không. Cứu thành công một người thì đêm đó người đó miễn CẢ
     *    hai đòn, đúng như đã chốt.
     *  - Trước `if (healApplied) st.healUsed = true;` ở dưới, vì `st.healUsed`
     *    chưa được đặt nên biểu thức kiểm tra ở đây đọc ra cùng một câu trả lời
     *    với vòng cắn, và khối này còn KỊP ghi vào `healApplied`. Đảo hai khối
     *    là bình cứu lặng lẽ mất tác dụng với riêng nhát dao.
     *
     * KHÔNG tra xem Sát Nhân còn sống hay không. `submitNightAction` đã đòi nó
     * còn sống lúc bấm, và `emptyNight` xoá ô này mỗi đêm - nên một mục tiêu
     * nằm đây luôn là đòn của một người còn sống lúc đêm bắt đầu được xử. Đó
     * chính là điều phải giữ: kẻ đâm có ngã xuống trong cùng đêm (một nhát cắn,
     * một bình độc, hay Tử Thủ đến hạn ở ngay đầu hàm này)
     * thì nhát dao vẫn tới nơi.
     *
     * Tử Thủ KHÔNG hoãn nhát dao: sự kiện đó viết cho nạn nhân của bầy Sói và
     * chỉ giữ được một người mỗi lần, nên nới nó ra cho cả nguồn thứ hai là đổi
     * luật của một sự kiện đang chạy.
     */
    if (st.night.serialKillerTarget) {
      const victim = this.player(st.night.serialKillerTarget);
      if (victim && victim.alive) {
        const isGuarded = guardedIds.has(victim.id);
        const isHealed =
          victim.id === st.night.killTarget && st.night.healTonight && !st.healUsed;
        /*
         * Bình cứu chặn được nhát dao thì bình cứu ĐÃ DÙNG, y như khi nó chặn
         * một cú cắn. Không thể để dòng này cho riêng vòng cắn lo: trong một
         * Đêm Bình Yên vòng cắn không chạy một lần nào, nên mục tiêu chính của
         * bầy Sói còn sống nhờ đúng bình cứu ấy mà `healApplied` vẫn là `false`
         * - Phù Thuỷ được cứu MIỄN PHÍ một mạng và recap báo là chưa dùng bình.
         *
         * Đặt TRƯỚC `isGuarded`, cùng thứ tự với vòng cắn: bình đã đổ vào một
         * người thật sự bị nhắm thì nó mất, kể cả khi một tấm khiên cũng đang
         * đỡ đúng người đó. Hai nguồn đòn phải trả lời câu này giống hệt nhau.
         */
        if (isHealed) healApplied = true;
        if (!isGuarded && !isHealed) {
          /*
           * Kẻ Nguyền Rủa chết THẬT ở đây, không hoá Sói.
           *
           * Không cần một nhánh riêng để chặn: cơ chế hoá Sói đọc `cursedBitten`
           * (chỉ do vòng cắn đặt) và chỉ chạy khi người đó CÒN SỐNG sau khi mọi
           * cái chết đã áp. Một nhát dao trúng đúng người vừa bị cắn vì thế tự
           * huỷ lần chuyển phe - đúng luật "chỉ đòn Sói hợp lệ mới hoá Sói".
           */
          addDeath({ playerId: victim.id, name: victim.name, cause: "serial_killer" });
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
    if (st.night.guardianAngelTarget) {
      // Trừ charge ở đây, không ở `submitNightAction`: cùng lý do với bình cứu
      // của Phù Thuỷ - tài nguyên chỉ mất khi đêm đã khép lại, để một cú bấm
      // nhầm còn sửa được.
      const angel = this.alivePlayers().find((p) => p.role === "GUARDIAN_ANGEL");
      if (angel) {
        st.guardianAngelCharges[angel.id] = (st.guardianAngelCharges[angel.id] ?? 2) - 1;
      }
    }
    st.guardPrevious = st.night.guardTarget;
    st.guardSecondPrevious = st.night.guardSecondTarget ?? null;
    st.guardianAngelPrevious = st.night.guardianAngelTarget;
    // Bình Độc của Phù Thuỷ là nguồn chết ĐÊM duy nhất do chính phe làng gây ra,
    // nên nó là nguồn duy nhất ở đây kích được cái bẫy của Trưởng Lão. Nhát cắn
    // và nhát dao thì không: xem `elderKilledByVillage`.
    for (const death of deaths) {
      if (death.cause === "poison") this.elderKilledByVillage(death.playerId);
    }
    st.lastNightDeaths = deaths.map((d) => ({ playerId: d.playerId, name: d.name }));
    this.noteDeathOrder(deaths.map((d) => d.playerId));
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

    // BLOOD_MOON arm: if active and 0 wolf deaths this night, arm for next night
    const wolfDeaths = deaths.filter((d) => d.cause === "wolf").length;
    if (st.activeEvent?.id === "BLOOD_MOON" && wolfDeaths === 0 && !st.bloodMoonArmed && !st.bloodMoonUsed) {
      st.bloodMoonArmed = true;
      st.log.push(`Trăng Máu đã được kích hoạt: đêm sau có 20% xuyên khiên!`);
    } else if (st.activeEvent?.id === "BLOOD_MOON" && wolfDeaths > 0) {
      // if kill happened, still mark used (consumed)
      st.bloodMoonUsed = true;
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
        if (!seer || !target) return [];
        const secondaryTarget = result.secondaryTargetId
          ? (recapPlayer(this.player(result.secondaryTargetId)) ?? undefined)
          : undefined;
        return [{
          seer,
          target,
          isWolf: result.isWolf,
          team: result.team,
          secondaryTarget,
          secondaryIsWolf: secondaryTarget ? result.secondaryIsWolf : undefined,
        }];
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
      guardianAngelTarget: recapPlayer(
        st.night.guardianAngelTarget ? this.player(st.night.guardianAngelTarget) : undefined,
      ),
      detectiveChecks: Object.entries(st.night.detectiveResults).flatMap(([detectiveId, result]) => {
        const detective = recapPlayer(this.player(detectiveId));
        const target1 = recapPlayer(this.player(result.target1Id));
        const target2 = recapPlayer(this.player(result.target2Id));
        return detective && target1 && target2
          ? [{ detective, target1, target2, sameTeam: result.sameTeam }]
          : [];
      }),
      // `priest` vắng mặt ở đêm mới: Linh Mục đã bị xóa cứng nên không còn đêm
      // nào sinh ra mục này nữa. Đêm CŨ nạp lại vẫn giữ nguyên trường `priest`
      // của nó (dữ liệu nằm trong nightHistory), và các cái chết cũ với cause
      // "priest"/"priest_backfire" vẫn kể lại qua mảng `deaths` ở dưới.
      wolfSecondaryTarget: recapPlayer(
        secondaryTargetToProcess ? this.player(secondaryTargetToProcess) : undefined,
      ),
      // Ô RIÊNG cạnh `wolfTarget`, không ghi đè nó: một đêm mà cả hai cùng ra
      // tay phải kể lại được thành hai đòn, kể cả khi chúng nhắm cùng một người.
      serialKillerTarget: recapPlayer(
        st.night.serialKillerTarget ? this.player(st.night.serialKillerTarget) : undefined,
      ),
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
   * `weighted` là ranh giới giữa cái được NHÌN và cái được TÍNH.
   *
   * Trọng số x2 của Thị Trưởng và phiếu ẩn +1 của Tiếng Hú Bầy Sói đều đến từ
   * vai/sự kiện còn đang giấu mặt. Danh sách phiếu (`openBallots`) thì công
   * khai ngay trong lúc bỏ phiếu, nên nếu số đếm hiển thị có trọng số thì ai
   * cũng trừ được: 3 lá phiếu mà đếm ra 4 nghĩa là Thị Trưởng vừa bầu người đó.
   * Vì vậy view luôn gọi `weighted: false`, còn chỗ QUYẾT ĐỊNH ai ra toà mới
   * gọi bản có trọng số.
   */
  voteTally(weighted = true): { players: Record<string, number>; noElimination: number } {
    const players: Record<string, number> = {};
    let noElimination = 0;
    for (const [voterId, targetId] of Object.entries(this.state.votes)) {
      const voter = this.player(voterId);
      const weight = weighted && voter?.role === "MAYOR" && this.villagePowersActive() ? 2 : 1;
      if (targetId === null) noElimination += weight;
      else players[targetId] = (players[targetId] ?? 0) + weight;
    }
    if (weighted && this.howlBonusActive()) {
      // find target most voted by wolves to add hidden vote
      const wolfIds = new Set(this.alivePlayers().filter((p) => isWolfPack(p.role)).map((p) => p.id));
      const wolfTally: Record<string, number> = {};
      for (const [voterId, targetId] of Object.entries(this.state.votes)) {
        if (!wolfIds.has(voterId) || targetId === null) continue;
        wolfTally[targetId] = (wolfTally[targetId] ?? 0) + 1;
      }
      let bestWolfTarget: string | null = null;
      let bestWolfCount = -1;
      for (const [tid, cnt] of Object.entries(wolfTally)) {
        if (cnt > bestWolfCount) {
          bestWolfCount = cnt;
          bestWolfTarget = tid;
        }
      }
      // Không Sói nào bầu ai thì KHÔNG có phiếu ẩn nào cả.
      //
      // Ở đây từng có một đường lui cộng +1 cho người đang dẫn đầu toàn cục.
      // Người dẫn đầu khi bầy Sói đứng ngoài chính là người phe LÀNG đang đề
      // cử - rất thường là một con Sói. Một sự kiện mang nhãn "có lợi cho phe
      // Sói" khi đó tự đẩy đồng bọn lên giá treo cổ, và đẩy đúng vào lúc bầy đã
      // cố tình bỏ phiếu trắng để tránh chuyện đó.
      if (bestWolfTarget) {
        players[bestWolfTarget] = (players[bestWolfTarget] ?? 0) + 1;
      }
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
        st.trial = { accusedId: accused.id, finalVotes: {}, defenseStartedAt: now };
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
    const trial = this.mustTrial();
    trial.defenseEndedAt = now;
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
   * `weighted` chia đôi giống hệt `voteTally`: view đếm đầu người, phần quyết
   * định mới nhân trọng số Thị Trưởng. Cùng một lý do - `guiltyRequired` suy ra
   * từ `eligible`, nên một ngưỡng có trọng số là lời khai rằng phòng này có một
   * Thị Trưởng còn sống, ngay cả trước khi có ai bỏ phiếu.
   */
  /** Ngày mà phiếu ẩn của Tiếng Hú Bầy Sói có hiệu lực. */
  private howlBonusActive(): boolean {
    return this.state.howlBonusDay !== null && this.state.howlBonusDay === this.state.round;
  }

  finalVoteTally(weighted = true): { guilty: number; innocent: number; abstain: number; eligible: number } {
    const trial = this.mustTrial();
    const voters = this.finalVoters();
    let guilty = 0;
    let innocent = 0;
    let totalWeight = 0;
    let votedWeight = 0;
    for (const voter of voters) {
      const weight = weighted && voter.role === "MAYOR" && this.villagePowersActive() ? 2 : 1;
      totalWeight += weight;
      const vote = trial.finalVotes[voter.id];
      if (vote === undefined) continue;
      votedWeight += weight;
      if (vote) guilty += weight;
      else innocent += weight;
    }

    /*
     * Phiếu ẩn của Tiếng Hú đi vào CẢ phiên toà, không chỉ vòng đề cử.
     *
     * Trước đây nó chỉ cộng vào `voteTally`, tức chỉ đổi được AI RA ĐỨNG TOÀ;
     * bản án sau đó vẫn đòi quá bán trên bảng phiếu này, nơi không có phiếu ẩn
     * nào. Một sự kiện mang nhãn "có lợi cho phe Sói" mà không đổi được kết quả
     * nào là một điểm `power` khống - và độ nghiêng lại trừ điểm đó vào quota
     * sự kiện đêm thật của bầy Sói.
     *
     * Hai hướng đi vào công thức bằng hai cửa khác nhau, và đó là chủ đích chứ
     * không phải bất cẩn. Hướng Treo cộng thẳng vào `guilty` mà giữ nguyên
     * `eligible` - nâng cả hai lên là triệt tiêu đúng cái lợi vừa cho. Hướng Tha
     * thì ngược lại, phải nâng `eligible`, vì `innocent` không có mặt trong phép
     * so sánh nào cả (xem chú thích tại chỗ ở nhánh đó).
     *
     * Hướng phiếu bám theo đa số của bầy, và bầy im lặng thì không có phiếu ẩn
     * nào - cùng một luật với `voteTally`, vì cùng một lý do: một phiếu ẩn tự
     * chọn hướng sẽ có ngày treo cổ chính đồng bọn.
     */
    if (weighted && this.howlBonusActive()) {
      let wolfGuilty = 0;
      let wolfInnocent = 0;
      for (const voter of voters) {
        if (!isWolfPack(voter.role)) continue;
        const vote = trial.finalVotes[voter.id];
        if (vote === undefined) continue;
        if (vote) wolfGuilty += 1;
        else wolfInnocent += 1;
      }
      if (wolfGuilty > wolfInnocent) {
        guilty += 1;
      } else if (wolfInnocent > wolfGuilty) {
        /*
         * Hướng Tha phải đi qua `totalWeight`, không phải chỉ `innocent`.
         *
         * `resolveFinalVote` quyết bằng `guilty * 2 > eligible` và KHÔNG hề đọc
         * `innocent`: phiếu trắng đã tính là Tha, nên cột Tha không có tiếng nói
         * riêng nào trong công thức. Cộng vào `innocent` rồi dừng ở đó là cộng
         * vào một con số không ai hỏi tới - phiếu ẩn hướng Tha khi ấy không cứu
         * được một bị cáo nào, đúng cái "điểm power khống" mà chú thích trên
         * cảnh báo, chỉ là ở nửa còn lại.
         *
         * Nâng `eligible` mới là cách nói "có thêm một cử tri, và cử tri đó bỏ
         * Tha": ngưỡng quá bán dâng lên đúng một phiếu. `votedWeight` đi theo vì
         * cử tri ảo ấy có bỏ phiếu - để nó ngoài là biến phiếu ẩn thành một
         * phiếu trắng trong `abstain`.
         */
        innocent += 1;
        totalWeight += 1;
        votedWeight += 1;
      }
    }

    return { guilty, innocent, abstain: totalWeight - votedWeight, eligible: totalWeight };
  }

  /**
   * Những cử tri mà PHẦN NẶNG THÊM của lá phiếu họ - không phải lá phiếu - đã
   * một mình đổi bản án.
   *
   * Cách đo là đặt lại người đó thành một cử tri thường: bỏ đi phần trọng số
   * thừa ở cả `guilty` lẫn `eligible`, rồi hỏi cùng một câu hỏi. Kết quả khác đi
   * nghĩa là chính trọng số ấy quyết định, chứ không phải lá phiếu - một Thị
   * Trưởng bỏ Treo giữa một bảng phiếu treo áp đảo không được nhận công.
   *
   * Bị cáo đã chết vì lý do khác thì `lynched` là false ở cả hai phép tính, nên
   * không ai bị gán nhầm.
   */
  private weightDecidedVoterIds(guiltyWeighted: number, eligible: number, lynched: boolean): string[] {
    const trial = this.mustTrial();
    const accused = this.player(trial.accusedId);
    const decided: string[] = [];
    for (const voter of this.finalVoters()) {
      if (voter.role !== "MAYOR") continue;
      const vote = trial.finalVotes[voter.id];
      const guiltyPlain = guiltyWeighted - (vote === true ? 1 : 0);
      const eligiblePlain = eligible - 1;
      const lynchedPlain =
        eligiblePlain > 0 && guiltyPlain * 2 > eligiblePlain && accused?.alive === true;
      if (lynchedPlain !== lynched) decided.push(voter.id);
    }
    return decided;
  }

  /** Số phiếu Treo tối thiểu để kết án. */
  guiltyRequired(weighted = true): number {
    return Math.floor(this.finalVoteTally(weighted).eligible / 2) + 1;
  }

  /** Trả về người bị treo; tha hoặc không đủ phiếu trả về null. */
  resolveFinalVote(now = Date.now()): PublicDeath | null {
    const st = this.state;
    if (st.phase !== "FINAL_VOTE") throw new GameError("Chỉ xử lý phiếu khi đang bỏ phiếu xác nhận");
    const trial = this.mustTrial();
    const { eligible } = this.finalVoteTally();
    const guiltyWeighted = this.finalVoteTally().guilty;
    // Recap in ra cạnh chính danh sách phiếu của nó, nên các con số ở đây phải
    // là đếm đầu người - bản có trọng số chỉ dùng để quyết `lynched`.
    const { guilty, innocent, abstain } = this.finalVoteTally(false);
    const accused = this.mustPlayer(trial.accusedId);

    // Nhân đôi thay vì chia đôi: eligible lẻ sẽ đưa số thực vào một phép so sánh
    // quyết định ai sống ai chết. Phiếu trắng vì thế tính là Tha.
    const lynched = eligible > 0 && guiltyWeighted * 2 > eligible && accused.alive;
    // Phải đọc trước khi `st.trial` bị xoá ở cuối hàm: nó cần chính bảng phiếu
    // vừa kiểm.
    const weightDecidedVoterIds = this.weightDecidedVoterIds(guiltyWeighted, eligible, lynched);

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
      this.noteDeathOrder([accused.id]);
      this.elderKilledByVillage(accused.id);
      eliminated = { playerId: accused.id, name: accused.name };
      /*
       * Thắng lợi của Thằng Hề được ghi NGAY ĐÂY, trước mọi phản ứng chết khác
       * và trước `checkWin` ở `continueAfterDeathResult`.
       *
       * Vị trí là một phần của luật, không phải một chi tiết cài đặt. Ván có
       * thể kết thúc ngay sau cú treo này (phát bắn của Thợ Săn hạ nốt con Sói
       * cuối, hoặc chính cú treo đưa bầy Sói tới thế cân bằng), và nếu thành
       * tích được ghi sau khi kiểm tra kết thúc thì đúng những ván ấy sẽ nuốt
       * mất nó.
       *
       * Chỉ tính CHẾT DO PHÁN QUYẾT TREO CỔ. Bị đề cử, được tha, chết vì Sói,
       * vì độc hay vì Thợ Săn đều không đi qua nhánh này - và đó
       * là lý do lời gọi nằm trong `if (lynched)` chứ không ở một chỗ chung
       * cho mọi cái chết.
       */
      this.recordPersonalWinForLynch(accused);
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
      weightDecidedVoterIds,
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
      this.noteDeathOrder([target.id]);
      this.elderKilledByVillage(target.id);
      if (target.role === "WOLF_CUB") {
        st.wolfCubRageNextNight = true;
      }
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

  submitDayOfTruthClaim(playerId: string, claim: string | null): void {
    const st = this.state;
    if (st.activeEvent?.id !== "DAY_OF_TRUTH") throw new GameError("Không trong Ngày Sự Thật");
    const p = this.mustPlayer(playerId);
    if (!p.alive) throw new GameError("Người chết không thể claim");
    if (claim !== null && !Object.values(ROLE_META).some((m) => m.id === claim)) {
      throw new GameError("Role claim không hợp lệ");
    }
    st.dayOfTruthClaims ??= {};
    st.dayOfTruthClaims[playerId] = claim;
    st.log.push(`${p.name} claim: ${claim ?? "Không tiết lộ"}`);
  }

  /**
   * Lượt nói của linh hồn, tính riêng cho người xem.
   *
   * Trả về `{ canAct }` và KHÔNG GÌ KHÁC. Mọi trường thêm vào đây đều là một
   * đường rò danh tính tiềm năng, và `hunterShotInfo` ngay phía trên đã phải
   * thay tên thật bằng "Ẩn danh" vì đúng lý do đó.
   */
  private deadCanSpeakViewFor(viewerId: string): { canAct: boolean } | null {
    const st = this.state;
    if (st.activeEvent?.id !== "DEAD_CAN_SPEAK") return null;
    return { canAct: !st.deadCanSpeakUsed && st.deadCanSpeakChosenId === viewerId };
  }

  /**
   * Lời nhắn ẩn danh của linh hồn được chọn.
   *
   * Engine chỉ gác luật và tiêu lượt; nó KHÔNG đăng chat, vì chat không thuộc
   * về nó. Trả lại câu đã trim để chỗ gọi khỏi tự chuẩn hoá lần thứ hai rồi
   * lệch khỏi cái vừa được kiểm.
   *
   * Quá dài thì TỪ CHỐI chứ không cắt: cắt âm thầm đổi nghĩa câu nói của người
   * chơi mà họ không hề biết, và họ chỉ có đúng một lượt.
   */
  submitDeadMessage(playerId: string, text: string): string {
    const st = this.state;
    if (st.activeEvent?.id !== "DEAD_CAN_SPEAK") throw new GameError("Không trong Tiếng Vọng Người Chết");
    if (st.deadCanSpeakUsed) throw new GameError("Lời nhắn của linh hồn đã được gửi");
    if (st.deadCanSpeakChosenId !== playerId) throw new GameError("Bạn không phải linh hồn được chọn");

    const trimmed = text.trim();
    if (trimmed.length === 0) throw new GameError("Lời nhắn không được để trống");
    if (trimmed.length > DEAD_MESSAGE_MAX_LENGTH) {
      throw new GameError(`Lời nhắn tối đa ${DEAD_MESSAGE_MAX_LENGTH} ký tự`);
    }

    st.deadCanSpeakUsed = true;
    // Log KHÔNG mang tên người gửi: log đi vào snapshot công khai.
    st.log.push(`[Tiếng Vọng Người Chết] Một linh hồn đã lên tiếng.`);
    return trimmed;
  }

  // ---- Thắng lợi cá nhân ----

  /** Sổ thành tích của ván, luôn là một mảng (state cũ có thể thiếu trường). */
  personalWins(): PersonalWin[] {
    return (this.state.personalWins ??= []);
  }

  /**
   * Ghi một thắng lợi cá nhân, ĐÚNG MỘT LẦN cho mỗi người.
   *
   * Chốt trùng lặp bằng `playerId` chứ không bằng điều kiện: một người chỉ có
   * một vai, nên hai mục cho cùng một người luôn là cùng một thành tích được
   * ghi hai lần - đúng thứ xảy ra khi một bước chuyển pha chạy lại sau khôi
   * phục. Trả về mục vừa ghi, hoặc `null` khi đã có sẵn.
   */
  private recordPersonalWin(
    player: EnginePlayer,
    condition: PersonalWin["condition"],
  ): PersonalWin | null {
    const wins = this.personalWins();
    if (wins.some((win) => win.playerId === player.id)) return null;
    const win: PersonalWin = {
      playerId: player.id,
      name: player.name,
      role: player.role,
      condition,
      round: this.state.round,
    };
    wins.push(win);
    /*
     * KHÔNG ghi log ở đây. `state.log` đi thẳng vào snapshot công khai, và luật
     * của phòng là cái chết không tiết lộ vai cho tới `GAME_OVER` - một dòng
     * "Thằng Hề đã thắng" ngay lúc treo là lật bài giữa ván. Dòng log được
     * thêm ở `finishGame`, đúng lúc mọi vai đã công khai.
     */
    return win;
  }

  /**
   * Người vừa bị treo có đạt điều kiện thắng cá nhân nào không.
   *
   * Một `switch` theo vai chứ không phải một cờ "là vai trung lập": vai trung
   * lập tiếp theo sẽ có luật thắng của riêng nó, và mặc định của bảng này là
   * KHÔNG ai thắng gì cả khi bị treo.
   */
  private recordPersonalWinForLynch(accused: EnginePlayer): void {
    if (accused.role === "JESTER") {
      this.recordPersonalWin(accused, "JESTER_LYNCHED");
    }
    this.recordExecutionerWinsForLynch(accused);
  }

  /**
   * Kẻ Báo Thù nào vừa thấy mục tiêu của mình lên giá treo.
   *
   * Tách khỏi `switch` theo vai của người bị treo ở trên vì nó trả lời một câu
   * hỏi KHÁC HẲN: bảng kia hỏi "người vừa chết có thắng gì không", còn chỗ này
   * hỏi "cái chết vừa rồi có hoàn thành nhiệm vụ của một NGƯỜI KHÁC không".
   * Nhét nó vào cùng một `switch` là buộc bảng đó phải biết về những người
   * không có mặt trên giá treo.
   *
   * Ba điều kiện, và cả ba đều bắt buộc:
   *  - vai HIỆN TẠI vẫn là `EXECUTIONER` (một người đã hoá Hề chơi luật của Hề);
   *  - `alive` - "còn sống tại thời điểm mục tiêu bị xử tử". `resolveFinalVote`
   *    mới chỉ hạ đúng bị cáo khi gọi tới đây, và phát bắn của Thợ Săn thì còn
   *    chưa xảy ra, nên đây đúng là thời điểm phải đo;
   *  - mục tiêu chính là người vừa bị treo.
   *
   * KHÔNG hỏi ai đã đề cử hay ai bỏ phiếu Treo: luật là "mục tiêu bị treo",
   * không phải "mục tiêu bị chính mình treo".
   */
  private recordExecutionerWinsForLynch(accused: EnginePlayer): void {
    const targets = this.executionerTargets();
    for (const player of this.state.players) {
      if (player.role !== "EXECUTIONER") continue;
      if (!player.alive) continue;
      if (targets[player.id] !== accused.id) continue;
      this.recordPersonalWin(player, "EXECUTIONER_TARGET_LYNCHED");
    }
  }

  /** Bảng nhiệm vụ của ván, luôn là một object (state cũ có thể thiếu trường). */
  executionerTargets(): Record<string, string> {
    return (this.state.executionerTargets ??= {});
  }

  /**
   * Kẻ Báo Thù mất mục tiêu thì hoá Thằng Hề.
   *
   * GỌI Ở ĐÂU: ngay trước mỗi lần chốt kết quả ván, tức sau khi cả đợt chết
   * lẫn chuỗi phản ứng Thợ Săn đi kèm đã xử xong. Hôm nay có đúng hai chỗ như
   * vậy - `checkWinOrContinue` bên server và `finished()` của harness self-play
   * - và cả hai gọi hàm này rồi mới gọi `checkWin`.
   *
   * VÌ SAO KHÔNG nằm trong `checkWin`: hàm đó là một câu HỎI, không phải một
   * bước của ván. Nó được gọi để dò trạng thái ở hàng chục chỗ (test, view,
   * điều kiện rẽ nhánh), và một phép ghi đè vai nấp trong một hàm đọc là thứ
   * sẽ đổi ván đấu vào lúc không ai ngờ tới.
   *
   * Vì sao đứng SAU chuỗi Thợ Săn: một phát bắn đang treo có thể hạ chính Kẻ
   * Báo Thù, và khi đó nó chết CÙNG đợt với mục tiêu - không được đổi vai. Đó
   * cũng là lý do điều kiện dưới đây đo `alive` chứ không nhớ ai còn sống lúc
   * đợt chết bắt đầu.
   *
   * TỰ CHẶN LẶP, không cần cờ phụ:
   *  - đã thắng rồi thì không đổi vai (nhiệm vụ đã xong, và mục tiêu của một
   *    người vừa thắng thì đương nhiên đã chết - không có dòng này, một cú
   *    treo trúng đích sẽ biến kẻ vừa thắng thành Thằng Hề ngay sau đó);
   *  - đổi vai xong thì `role` không còn là `EXECUTIONER`, nên lần gọi thứ hai
   *    không tìm thấy gì. Một pha chạy lại sau khôi phục vì thế vô hại.
   *
   * Người đã CHẾT không đổi vai và không được cấp gì cả: `alive` là điều kiện
   * đầu tiên, và nó cũng chính là điều làm cho một Kẻ Báo Thù đã chết không
   * thắng vì một cú treo xảy ra sau đó.
   */
  /**
   * Con Sói cuối cùng chết thì Kẻ Phản Bội HOÁ THÀNH Ma Sói.
   *
   * Không có luật này thì lá bài tự bẫy chính nó: `checkWin` đếm Kẻ Phản Bội
   * vào phe Sói, nên "hết Sói là làng thắng" không bao giờ đúng chừng nào nó
   * còn sống - trong khi không còn ai cắn ai vào ban đêm. Ván đấu khi đó chỉ
   * còn là làng lần lượt treo cho tới khi tìm ra nó, mỗi ngày một người, không
   * có áp lực nào từ phía đêm. Đó không phải một thế cờ, đó là một cái sảnh chờ.
   *
   * Hoá vai thay vì trao thắng lợi: từ giây này nó thức dậy, cắn được, và bị
   * Tiên Tri soi ra. Nó phải TỰ thắng phần còn lại của ván bằng luật của một
   * con Sói thật.
   *
   * GỌI Ở ĐÂU: cùng hai chỗ với `settleExecutioner` - sau khi cả đợt chết lẫn
   * chuỗi phản ứng Thợ Săn đã xử xong, trước khi chốt kết quả ván. Vì sao phải
   * đứng sau chuỗi Thợ Săn: một phát bắn đang treo có thể hạ chính Kẻ Phản Bội,
   * và khi đó nó chết CÙNG đợt với con Sói cuối - không được thăng cấp.
   *
   * VÌ SAO KHÔNG nằm trong `checkWin`: hàm đó là một câu HỎI, được gọi để dò
   * trạng thái ở hàng chục chỗ. Một phép ghi đè vai nấp trong một hàm đọc là
   * thứ sẽ đổi ván đấu vào lúc không ai ngờ tới. Cùng lý do đã viết ở
   * `settleExecutioner`.
   *
   * TỰ CHẶN LẶP: đổi xong thì `role` không còn là `TRAITOR`, nên lần gọi thứ
   * hai không tìm thấy gì. Một pha chạy lại sau khôi phục vì thế vô hại.
   */
  /**
   * Chốt mọi lá ĐỔI VAI rồi hỏi ván đã xong chưa.
   *
   * Tồn tại vì THỨ TỰ, không phải vì gõ ít đi. Ba lời gọi này từng nằm chép tay
   * ở hai nơi - `checkWinOrContinue` của server và `finished()` của harness
   * self-play - và không có gì bắt hai bản khớp nhau. Chúng đã lệch: harness
   * thiếu hẳn `settleDoppelganger`, nên trong MỌI ván tự chơi Kẻ Song Trùng
   * không hoá vai lần nào và mọi số đo sức mạnh của nó đo một kỹ năng chưa từng
   * chạy. Một bản sao thứ ba sẽ lệch theo cách khác.
   *
   * Thứ tự bên trong không tuỳ ý:
   *
   *  1. Kẻ Song Trùng trước, vì nó có thể hoá thành một con SÓI - và
   *     `settleTraitor` hỏi "bầy còn con nào sống không", nên nó phải thấy bầy
   *     ở trạng thái đã cập nhật.
   *  2. Kẻ Phản Bội trước Kẻ Báo Thù, vì một Kẻ Phản Bội vừa thăng cấp làm đổi
   *     câu trả lời của `checkWin`, mà `settleExecutioner` đọc thế cuộc để
   *     quyết một Kẻ Báo Thù mất mục tiêu có hoá Thằng Hề hay không.
   *
   * Gọi ở đâu thì vẫn là quyết định của người gọi: đây phải là cửa duy nhất mà
   * cả hai đường chết đi qua SAU khi chuỗi phản ứng Thợ Săn đã xử xong. Sớm hơn
   * thì một lá sắp trúng đạn kịp đổi vai trong chính đợt chết đã hạ nó.
   *
   * Cả ba `settle*` đều TỰ CHẶN LẶP, nên gọi lại sau khôi phục là vô hại.
   */
  settleAndCheckWin(): Winner {
    this.settleDoppelganger();
    this.settleTraitor();
    this.settleExecutioner();
    return this.checkWin();
  }
  /**
   * Kẻ Song Trùng hoá thành vai của NGƯỜI CHẾT ĐẦU TIÊN.
   *
   * Gọi cùng chỗ với `settleTraitor`/`settleExecutioner` - cửa duy nhất mà cả
   * hai đường chết đi qua sau khi chuỗi phản ứng Thợ Săn đã xử xong. Sớm hơn
   * thì một Kẻ Song Trùng sắp trúng đạn sẽ kịp đổi vai trong chính đợt chết đã
   * hạ nó.
   *
   * TỰ CHẶN LẶP đúng cách `settleExecutioner` làm: đổi xong thì `role` không
   * còn là `DOPPELGANGER`, nên lần gọi thứ hai không tìm thấy gì. Một pha chạy
   * lại sau khôi phục vì thế vô hại.
   *
   * Người đã CHẾT không hoá vai: một xác không cần một lá bài mới, và để nó đổi
   * sẽ khiến bảng tổng kết ghi sai vai mà nó đã sống và chết cùng.
   */
  settleDoppelganger(): void {
    const st = this.state;
    const corpseId = st.firstDeadId;
    if (!corpseId) return;
    const corpse = this.player(corpseId);
    if (!corpse) return;
    for (const player of st.players) {
      if (player.role !== "DOPPELGANGER") continue;
      if (!player.alive) continue;
      if (player.id === corpseId) continue;
      /*
       * Sao chép trúng Kẻ Báo Thù thì hoá THẰNG HỀ, không phải Kẻ Báo Thù.
       *
       * Không phải một ngoại lệ bịa ra cho lá này: `settleExecutioner` đã có sẵn
       * đúng luật đó cho một Kẻ Báo Thù mất mục tiêu, và một bản sao không có
       * mục tiêu trong `executionerTargets` chính là trường hợp ấy. Chép thẳng
       * `EXECUTIONER` vào đây sẽ tạo ra một lá không bao giờ thắng được: điều
       * kiện thắng cá nhân của nó tra vào một bảng nhiệm vụ không có tên nó.
       */
      player.role = corpse.role === "EXECUTIONER" ? "JESTER" : corpse.role;
      player.doppelgangerTurned = true;
      /*
       * KHÔNG ghi log, cùng lý do với `settleTraitor` và `settleExecutioner`:
       * `state.log` đi thẳng vào snapshot công khai, và một dòng "ai đó vừa hoá
       * X" vừa lộ vai người mới vừa lộ vai người vừa chết.
       */
    }
  }

  settleTraitor(): void {
    const packAlive = this.state.players.some((p) => p.alive && isWolfPack(p.role));
    if (packAlive) return;
    for (const player of this.state.players) {
      if (player.role !== "TRAITOR") continue;
      // Người đã CHẾT không thăng cấp: một xác không cắn ai, và để nó thành Sói
      // sẽ khiến bảng tổng kết ghi sai vai mà nó đã sống và chết cùng.
      if (!player.alive) continue;
      player.role = "WEREWOLF";
      player.traitorTurned = true;
      /*
       * KHÔNG ghi log: `state.log` đi thẳng vào snapshot công khai, và một dòng
       * "ai đó vừa hoá Sói" vừa lộ vai vừa nói cho làng biết bầy đã sạch. Cùng
       * lý do với `settleExecutioner` và `recordPersonalWin`.
       */
    }
  }

  settleExecutioner(): void {
    const targets = this.executionerTargets();
    const won = new Set(this.personalWins().map((win) => win.playerId));
    for (const player of this.state.players) {
      if (player.role !== "EXECUTIONER") continue;
      if (!player.alive) continue;
      if (won.has(player.id)) continue;
      const target = this.player(targets[player.id]);
      // Chưa có mục tiêu (state cũ) hoặc mục tiêu còn sống: chưa có gì xảy ra.
      if (!target || target.alive) continue;
      /*
       * Đổi hẳn `role`, đúng cách Kẻ Nguyền Rủa hoá Sói: từ giây này mọi phép
       * kiểm tra vai (luật thắng cá nhân khi bị treo, chiến thuật BOT, thẻ vai
       * trên màn hình) tự đọc ra luật của Thằng Hề mà không chỗ nào phải hỏi
       * "người này vốn là gì".
       *
       * KHÔNG trao thắng lợi nào ở đây: chuyển vai là một cơ hội thứ hai, không
       * phải một phần thưởng. Từ giờ nó chỉ thắng khi CHÍNH NÓ bị treo.
       *
       * KHÔNG cấp mục tiêu mới, và cũng không xoá mục tiêu cũ: bảng nhiệm vụ là
       * bản ghi của những gì đã xảy ra, và `executionerTurned` mới là thứ nói
       * ván đã sang trang.
       */
      player.role = "JESTER";
      player.executionerTurned = true;
      /*
       * KHÔNG ghi log. `state.log` đi thẳng vào snapshot công khai, và một dòng
       * "ai đó vừa hoá Thằng Hề" vừa lộ vai vừa chỉ đích danh mục tiêu vừa
       * chết. Cùng lý do với `recordPersonalWin`.
       */
    }
  }

  /**
   * Sổ thành tích đã lọc cho MỘT người xem.
   *
   * Ở `GAME_OVER` mọi vai đã lộ nên danh sách mở hết. Trước đó, người xem chỉ
   * thấy mục của chính mình: một mục công khai giữa ván sẽ nói cho cả phòng
   * biết vai của người vừa bị treo, đúng điều mà luật "cái chết không tiết lộ
   * gì" cấm.
   */
  private personalWinsFor(viewerId: string): PersonalWin[] {
    const wins = this.personalWins();
    const visible =
      this.state.phase === "GAME_OVER" ? wins : wins.filter((win) => win.playerId === viewerId);
    return visible.map((win) => ({ ...win }));
  }

  /**
   * Nhiệm vụ của Kẻ Báo Thù, tính cho MỘT người xem.
   *
   * Trả `null` cho tất cả những ai không phải chủ nhân của một nhiệm vụ - và
   * đó là toàn bộ cổng bảo mật của tính năng này. Không có nhánh nào mở nó ra
   * ở `GAME_OVER`, khác hẳn `personalWinsFor` ngay trên: sổ thắng là thành
   * tích và đáng được công bố, còn mục tiêu là một thứ chỉ có nghĩa với đúng
   * một người. Phần tổng kết sau ván đã có `personalWins` và cờ
   * `executionerTurned` nói đủ.
   *
   * Nhận cả người xem ĐÃ CHẾT và người đã hoá Thằng Hề: một người chết vẫn có
   * quyền đọc lại nhiệm vụ của chính mình, và một người vừa đổi vai cần đúng
   * màn hình đó để biết vì sao thẻ vai vừa đổi.
   */
  private executionerViewFor(viewer: EnginePlayer | undefined): ExecutionerView | null {
    if (!viewer) return null;
    const targetId = this.executionerTargets()[viewer.id];
    if (targetId === undefined) return null;
    const target = this.player(targetId);
    return {
      target: target ? { id: target.id, name: target.name, alive: target.alive } : null,
      won: this.personalWins().some(
        (win) => win.playerId === viewer.id && win.condition === "EXECUTIONER_TARGET_LYNCHED",
      ),
      turnedJester: viewer.executionerTurned === true,
    };
  }

  // ---- Điều kiện thắng ----

  /**
   * Kết cục của ván, hoặc `null` khi ván còn chạy.
   *
   * Gọi SAU khi mọi cái chết và mọi phản ứng Thợ Săn đã xử xong - dòng đầu tiên
   * gác đúng điều đó, vì một phát bắn đang treo có thể hạ nốt con Sói cuối hoặc
   * hạ chính Sát Nhân.
   *
   * Thứ tự năm nhánh dưới đây LÀ luật, không phải một cách viết cho gọn:
   *
   *  a. Không còn ai sống: hoà. Đứng đầu vì mọi nhánh sau đều nói về một người
   *     còn sống nào đó, và với bàn trống thì vế "hết Sói" cũng đúng - tức là
   *     làng sẽ "thắng" một ván mà không còn người làng nào.
   *  b. Chỉ còn Sát Nhân: nó thắng, và đây là một kết cục CHUNG kết thúc ván -
   *     khác hẳn thắng lợi cá nhân của Thằng Hề, thứ được ghi vào sổ riêng rồi
   *     để ván chạy tiếp.
   *  c. Sát Nhân còn sống mà chưa một mình: ván TIẾP TỤC, bất kể bầy Sói còn
   *     hay hết và bất kể quân số nghiêng về đâu. Hết Sói chưa đủ để làng thắng
   *     khi vẫn còn một kẻ giết người đi lại trong làng, và bầy Sói cũng chưa
   *     nắm được làng khi có một bên thứ ba giết cả hai phía mỗi đêm. Một Sói
   *     cuối cùng đứng trước một Sát Nhân vì thế là một ván còn đang chơi.
   *  d. Không còn Sát Nhân: quay lại đúng hai dòng luật cũ, từng bit.
   */
  checkWin(): Winner {
    const st = this.state;
    if (st.hunterReaction && !st.hunterReaction.resolved) return null;

    const alive = this.alivePlayers();
    if (alive.length === 0) return "draw";

    const killersAlive = alive.filter((p) => p.role === "SERIAL_KILLER").length;
    if (killersAlive > 0) {
      return killersAlive === alive.length ? "serial_killer" : null;
    }

    const wolvesAlive = alive.filter((p) => roleTeam(p.role) === "wolves").length;
    /*
     * "Không phải Sói", không phải "phe làng".
     *
     * Một vai trung lập còn sống được tính vào đây: bầy Sói chưa nắm được làng
     * chừng nào còn một người ngoài bầy ngồi đó bỏ phiếu, bất kể người ấy chơi
     * cho ai. Đối xứng ở vế trên: hết Sói là làng thắng, kể cả khi Thằng Hề
     * vẫn còn sống - thắng lợi của nó là một sổ riêng, không phải một phe thứ
     * ba tranh phần thắng chung.
     */
    const othersAlive = alive.length - wolvesAlive;
    if (wolvesAlive === 0) return "village";
    if (wolvesAlive >= othersAlive) return "wolves";
    return null;
  }

  finishGame(winner: Exclude<Winner, null>, now = Date.now()) {
    this.state.winner = winner;
    this.state.phase = "GAME_OVER";
    // Không đặt hạn chót: ván chỉ về lobby khi chủ phòng bấm reset, không tự động.
    this.state.phaseEndsAt = null;
    // Bảng nhãn dùng chung với web và hồ sơ vụ án: bốn kết cục, một chỗ gọi tên.
    // Một biểu thức ba ngôi ở đây sẽ ghi "Phe Dân Làng chiến thắng" vào log của
    // đúng những ván mà Dân Làng vừa chết sạch.
    this.state.log.push(`${outcomeName(winner) ?? "Không ai còn sống, ván đấu hoà"}${
      winner === "draw" ? "!" : " chiến thắng!"
    }`);
    // Thành tích cá nhân được nói ra ĐÚNG LÚC NÀY: `GAME_OVER` là lúc mọi vai
    // đã công khai, nên dòng log này không lộ thêm gì. Nó cũng là lý do dòng
    // đó không được viết ngay lúc ghi nhận, xem `recordPersonalWin`.
    for (const win of this.personalWins()) {
      this.state.log.push(
        `${ROLE_META[win.role].name} ${win.name} đã đạt mục tiêu riêng và thắng cá nhân.`,
      );
    }
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
  ): NightInfoView {
    const st = this.state;
    const locked = st.night.wolvesLocked;
    const isWolf = isWolfPack(viewer.role);
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
    } else if (viewer.role === "SERIAL_KILLER") {
      acted = st.night.serialKillerTarget !== null || st.night.serialKillerSkipped === true;
    } else if (isWitch) {
      acted = st.night.witchSkipped || st.night.healTonight || st.night.poisonTarget !== null;
    }

    let canAct = isWitch ? locked : isWolf ? !locked : true;
    if ((viewer.role === "SEER" || viewer.role === "APPRENTICE_SEER") && st.activeEvent?.id === "MOONLESS_NIGHT") {
      canAct = false;
    }

    return {
      canAct,
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
      // CHỈ cho chính Sát Nhân. Mọi vai khác nhận `undefined`, kể cả người đang
      // bị nhắm - biết đêm nay ai bị chọn đã là một rò rỉ, dù không kèm vai.
      serialKillerTarget:
        viewer.role === "SERIAL_KILLER" ? st.night.serialKillerTarget ?? null : undefined,
      serialKillerSkipped:
        viewer.role === "SERIAL_KILLER" ? st.night.serialKillerSkipped === true : undefined,
      healUsed: st.healUsed,
      poisonUsed: st.poisonUsed,
      wolfCubRageTonight: isWolfPack(viewer.role) ? st.night.wolfCubRageTonight : undefined,
    };
  }

  /**
   * Recap phiên toà đã xử xong, tính riêng cho một người xem.
   *
   * Việc duy nhất ở đây là ĐỔI DANH SÁCH THÀNH MỘT CÂU TRẢ LỜI: state giữ id của
   * những cử tri có trọng số đã lật bản án, snapshot chỉ được mang đúng một cờ
   * có/không cho chính người đang xem. Trả về `st.lastTrial` thẳng là gửi cả
   * danh sách Thị Trưởng cho cả phòng.
   */
  private lastTrialViewFor(recap: TrialRecapState, viewerId: string): TrialRecap {
    const { weightDecidedVoterIds, ...shared } = recap;
    return { ...shared, yourWeightDecided: weightDecidedVoterIds?.includes(viewerId) === true };
  }

  /** Khối phiên toà của một người xem. Chỉ gọi khi state.trial khác null. */
  private trialViewFor(viewerId: string, viewer: EnginePlayer | undefined): TrialView {
    const st = this.state;
    const trial = st.trial!;
    const accused = this.player(trial.accusedId);
    const { guilty, innocent } = this.finalVoteTally(false);
    // Đọc trực tiếp finalVotes chứ không qua finalVoters(): người xem có thể đã
    // chết giữa phiên toà, và khi đó họ không còn là cử tri nhưng vẫn phải thấy
    // đúng lá phiếu mình đã bỏ.
    const myVote = trial.finalVotes[viewerId];

    return {
      accusedId: trial.accusedId,
      accusedName: accused?.name ?? "?",
      guiltyVotes: guilty,
      innocentVotes: innocent,
      guiltyRequired: this.guiltyRequired(false),
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
    // Biến thể luật đang đo, xem `RoomConfig.revealRoleOnDeath`. Phòng thật
    // luôn thấy `undefined` ở đây.
    const revealDead = st.config.revealRoleOnDeath === true;
    // Sói luôn biết đồng bọn của mình
    const viewerIsWolf = viewer !== undefined && viewer.alive && isWolfPack(viewer.role);
    // Tiên Tri Tập Sự luôn biết Tiên Tri; xem chú thích dài ở `botKnowledgeFor`.
    const viewerIsApprentice =
      viewer !== undefined && viewer.alive && viewer.role === "APPRENTICE_SEER";

    const tally = this.voteTally(false);
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
      role:
        revealAll || (revealDead && !p.alive)
          ? p.role
          : viewerIsWolf && p.id !== viewerId && isWolfPack(p.role)
            ? p.role
            : viewerIsApprentice && p.role === "SEER"
              ? p.role
              : undefined,
      // Đồng bọn Sói chỉ được biết đây là một con Sói, không được biết nó vốn
      // là Kẻ Nguyền Rủa: gốc nguyền rủa chỉ lộ cùng lúc với toàn bộ vai trò.
      cursedTurned: revealAll ? p.cursedTurned === true : undefined,
      // Cùng cổng `revealAll` với dòng trên: trước lúc lật bài, việc một người
      // vừa đổi vai là bí mật của riêng họ.
      executionerTurned: revealAll ? p.executionerTurned === true : undefined,
      voteCount: showVoteCounts ? tally.players[p.id] ?? 0 : 0,
    }));

    const seerResultEntry = viewer ? st.night.seerResults[viewerId] : undefined;
    let seerResult: SeerResultView | null = null;
    if (seerResultEntry && viewer) {
      seerResult = {
        targetId: seerResultEntry.targetId,
        targetName: this.player(seerResultEntry.targetId)?.name ?? "?",
        // Kết quả lưu trước bản này không có `team`; rơi về đúng thứ nó có.
        // `isWolf === false` ở một bản ghi cũ vẫn nghĩa là "phe làng", vì lúc
        // đó chưa có vai nào ngoài hai phe.
        team: seerResultEntry.team ?? (seerResultEntry.isWolf ? "wolves" : "village"),
        isWolf: seerResultEntry.isWolf,
        secondaryTargetId: seerResultEntry.secondaryTargetId,
        secondaryTargetName: seerResultEntry.secondaryTargetId
          ? this.player(seerResultEntry.secondaryTargetId)?.name ?? "?"
          : undefined,
        secondaryTeam:
          seerResultEntry.secondaryTargetId === undefined
            ? undefined
            : seerResultEntry.secondaryTeam ??
              (seerResultEntry.secondaryIsWolf ? "wolves" : "village"),
        secondaryIsWolf: seerResultEntry.secondaryIsWolf,
      };
    }

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

    return {
      phase: st.phase,
      round: st.round,
      phaseEndsAt: st.phaseEndsAt,
      activeEvent: st.activeEvent,
      winner: st.winner,
      you: viewer
        ? {
            id: viewer.id,
            role: viewer.role,
            alive: viewer.alive,
            cursedTurned: viewer.cursedTurned === true,
            executionerTurned: viewer.executionerTurned === true,
          }
        : null,
      players: playersView,
      nightInfo:
        st.phase === "NIGHT" && viewer && viewer.alive && this.hasNightAction(viewer.role)
          ? this.nightInfoFor(viewer, seerResult, detectiveResult)
          : null,
      hunterShotInfo:
        st.phase === "HUNTER_SHOT" && st.hunterReaction
          ? (() => {
              const isHunterViewer = viewerId === st.hunterReaction!.hunterId;
              return {
                hunterId: isHunterViewer ? st.hunterReaction!.hunterId : "",
                hunterName: isHunterViewer ? this.player(st.hunterReaction!.hunterId)?.name ?? "?" : "Ẩn danh",
                canAct: !st.hunterReaction!.resolved && isHunterViewer,
                resolved: st.hunterReaction!.resolved,
                target:
                  st.hunterReaction!.resolved && isHunterViewer
                    ? st.hunterShots.at(-1)?.target ?? null
                    : null,
              };
            })()
          : null,
      trialInfo: inTrialPhase && st.trial ? this.trialViewFor(viewerId, viewer) : null,
      lastTrial:
        (st.phase === "ELIMINATION" || st.phase === "CHECK_WIN" || st.phase === "GAME_OVER") &&
        st.lastTrial
          ? this.lastTrialViewFor(st.lastTrial, viewerId)
          : null,
      hasVoted,
      // ?? null ở đây an toàn vì đã gác bằng hasVoted: chỉ đọc khi thật sự có
      // phiếu, nên null trả về là phiếu không treo chứ không phải "chưa vote".
      myVote: hasVoted ? st.votes[viewerId] ?? null : null,
      noEliminationVoteCount: showVoteCounts ? tally.noElimination : 0,
      // Danh tính phiếu ĐANG MỞ. Chỉ ở VOTING: từ DEFENSE trở đi vòng đã chốt
      // và recap trong dayVoteHistory là nguồn duy nhất, gửi cả hai thì client
      // có hai bản của cùng một sự thật.
      // Phiếu Kín đóng đúng cửa sổ này lại: tổng phiếu vẫn hiện (`voteCount` của từng người),
      // chỉ danh tính người bầu là biến mất.
      openBallots:
        st.phase === "VOTING" && st.activeEvent?.id !== "SECRET_BALLOT"
          ? Object.entries(st.votes).map(([voterId, targetId]) => ({
              voterId,
              choice:
                targetId === null
                  ? ({ type: "NO_ELIMINATION" } as const)
                  : ({ type: "PLAYER", targetId } as const),
            }))
          : [],
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
      dayOfTruthClaims: st.dayOfTruthClaims ? { ...st.dayOfTruthClaims } : undefined,
      pendingLastStandVictim: st.pendingLastStandVictim
        ? { playerId: st.pendingLastStandVictim.playerId, name: this.player(st.pendingLastStandVictim.playerId)?.name ?? "?" }
        : null,
      deadCanSpeak: this.deadCanSpeakViewFor(viewerId),
      personalWins: this.personalWinsFor(viewerId),
      executioner: this.executionerViewFor(viewer),
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
    const viewerIsWolf = viewer.alive && isWolfPack(viewer.role);

    const knownRoles: Record<string, Role> = { [viewer.id]: viewer.role };
    /*
     * Tiên Tri Tập Sự được chỉ mặt Tiên Tri ngay từ đêm 1.
     *
     * Trước đó lá này KHÔNG có kỹ năng nào cho tới khi Tiên Tri chết - một điều
     * kiện có thể không bao giờ xảy ra - mà vẫn chiếm một ghế đặc biệt, tức bộ
     * bài bớt một Dân Làng để bầy Sói phí nhát cắn vào. Đo ra -2.6 điểm.
     *
     * Biết Tiên Tri là ai cho nó việc để làm từ đêm đầu: khi có hai người cùng
     * khai Tiên Tri, nó là người DUY NHẤT biết ai thật. Vẫn thừa kế kỹ năng soi
     * khi Tiên Tri chết, phần đó không đổi.
     */
    if (viewer.alive && viewer.role === "APPRENTICE_SEER") {
      for (const player of st.players) {
        if (player.role === "SEER") knownRoles[player.id] = player.role;
      }
    }
    if (viewerIsWolf) {
      for (const player of st.players) {
        if (player.id !== viewer.id && isWolfPack(player.role)) {
          knownRoles[player.id] = player.role;
        }
      }
    }
    // Phải khớp ĐÚNG `snapshotFor`: một biến thể luật mà BOT không nhìn thấy sẽ
    // đo ra "không ảnh hưởng gì" bất kể nó ảnh hưởng thế nào tới người thật.
    if (st.config.revealRoleOnDeath === true) {
      for (const player of st.players) {
        if (!player.alive) knownRoles[player.id] = player.role;
      }
    }

    const seerResultEntry = st.night.seerResults[botId];
    const seerResult = seerResultEntry
      ? {
          targetId: seerResultEntry.targetId,
          targetName: this.player(seerResultEntry.targetId)?.name ?? "?",
          isWolf: seerResultEntry.isWolf,
          // Cùng đường rơi về như `snapshotFor`: lõi BOT không được thấy nhiều
          // hơn người chơi thật, và cũng không được thấy ít hơn.
          team: seerResultEntry.team ?? (seerResultEntry.isWolf ? "wolves" : "village"),
        }
      : null;

    return buildBotKnowledgeView({
      botId,
      round: st.round,
      phase: st.phase,
      phaseStartedAt: st.phaseStartedAt,
      phaseEndsAt: st.phaseEndsAt,
      selfRole: viewer.role,
      // `isBot` là công khai (`PlayerView.isBot` trong snapshot của cả phòng);
      // lõi dùng nó để biết bàn có người thật hay không, xem `countHumansAlive`.
      players: st.players.map(({ id, name, alive, isBot }) => ({ id, name, alive, isBot })),
      knownRoles,
      revealRoleOnDeath: st.config.revealRoleOnDeath === true,
      seerResult,
      // Bà Đồng đã bị xóa cứng nên engine không còn gì để kể ở đây. Giữ key với
      // null để `BotKnowledgeInput` (Task 6 sở hữu) vẫn biên dịch được cho tới
      // khi Task 6 gỡ trường này khỏi bot/types.ts + knowledge.ts.
      mediumResult: null,
      // Suy từ CHÍNH bộ bài mà `assignRoles` chia, không phải một danh sách
      // chép tay: bật thêm một vai trung lập sau này là nó tự vào đây.
      neutralRolesInPlay: neutralRolesFor(st.config),
      // Nhiệm vụ RIÊNG của chính con BOT này, không bao giờ của ai khác - cùng
      // cổng với `executionerViewFor` dành cho người thật, và cùng một bảng
      // nguồn. Một BOT khác đọc `undefined` ở đây, kể cả BOT ngồi cạnh.
      executionerTargetId: this.executionerTargets()[botId] ?? null,
      night: this.botNightKnowledgeFor(viewer),
      // Danh tính bị cáo là công khai ở hai pha này - cả phòng đang nhìn vào
      // đúng người đó. Thứ KHÔNG công khai là ai đã bỏ phiếu Treo hay Tha, và
      // nó không có mặt ở đây.
      trialAccusedId:
        (st.phase === "DEFENSE" || st.phase === "FINAL_VOTE") && st.trial
          ? st.trial.accusedId
          : null,
      // Cùng cổng pha với `trialAccusedId`. Thiếu mốc mở (snapshot cũ) thì
      // không có cửa sổ, và lõi sẽ không chấm lời bào chữa của phiên toà đó.
      trialDefense:
        (st.phase === "DEFENSE" || st.phase === "FINAL_VOTE") &&
        st.trial &&
        st.trial.defenseStartedAt !== undefined
          ? {
              startedAt: st.trial.defenseStartedAt,
              endedAt: st.phase === "FINAL_VOTE" ? (st.trial.defenseEndedAt ?? null) : null,
            }
          : null,
      canFinalVote:
        st.phase === "FINAL_VOTE" &&
        viewer.alive &&
        st.trial !== null &&
        st.trial.accusedId !== viewer.id &&
        st.trial.finalVotes[viewer.id] === undefined,
      hunterShot: this.botHunterShotKnowledgeFor(viewer),
      publicVoteHistory: st.dayVoteHistory,
      // Đếm đầu người, đúng bằng thứ một người chơi nhìn thấy: cho BOT bản có
      // trọng số là cho nó suy ra Thị Trưởng bằng dữ liệu không ai khác có.
      currentVoteCounts: this.voteTally(false),
      // Phiếu của chính mình vẫn hiển thị sau khi pha bỏ phiếu đóng, đúng như
      // snapshotFor: nói với BOT rằng nó "chưa bầu" trong lúc biện hộ là một
      // lời khai sai, và lõi belief sẽ dựng memory từ lời khai đó.
      currentVote: viewer.alive ? st.votes[botId] : undefined,
      legalVoteChoices: this.legalVoteChoicesFor(botId),
      lastNightDeaths: st.lastNightDeaths,
      // Công khai với cả phòng qua `RoomSnapshot.activeEvent`, nên không có gì
      // để lọc; lõi BOT cần nó để biết luật hôm nay đã đổi.
      activeEventId: st.activeEvent?.id ?? null,
      dayOfTruthClaims: this.publicRoleClaims(),
    });
  }

  /**
   * Thông tin ban đêm cho ĐÚNG một vai.
   *
   * Đây là điểm mở rộng nhạy cảm nhất của Phase 2, nên nó theo cùng nguyên tắc
   * với `botKnowledgeFor`: tất cả lọc xảy ra ở đây, và `bot/knowledge.ts` chỉ
   * nhận giá trị đã sạch. Trả `null` là mặc định an toàn - mọi vai không có
   * hành động đêm đều rơi vào nhánh đó mà không cần liệt kê tên vai.
   */
  private botNightKnowledgeFor(viewer: EnginePlayer): NightKnowledge | null {
    const st = this.state;
    if (st.phase !== "NIGHT" || !viewer.alive) return null;
    if (!this.hasNightAction(viewer.role)) return null;

    const isWolf = isWolfPack(viewer.role);
    const isWitch = viewer.role === "WITCH";
    const alive = this.alivePlayers();

    const legalActions: NightActionKind[] = [];
    const legalTargets = {
      KILL: [],
      SEE: [],
      GUARD: [],
      HEAL: [],
      POISON: [],
      SKIP: [],
      DETECTIVE_CHECK: [],
      GUARDIAN_PROTECT: [],
      SERIAL_KILL: [],
    } as Record<NightActionKind, string[]>;

    // Tiên Tri Tập Sự soi y hệt Tiên Tri, nhưng chỉ SAU khi thức tỉnh.
    // `hasNightAction` đã chặn lúc chưa thức tỉnh, nên tới đây là đã đủ điều kiện.
    const canSee =
      viewer.role === "SEER" ||
      (viewer.role === "APPRENTICE_SEER" && st.apprenticeAwakened);
    // Đêm Không Trăng khoá lượt soi; engine sẽ ném nếu vẫn gửi SEE.
    const seerBlocked = st.activeEvent?.id === "MOONLESS_NIGHT";

    if (isWolf) {
      legalActions.push("KILL");
      // Khớp đúng điều kiện `submitNightAction` case "KILL": cả bầy Sói bị loại,
      // theo PHE chứ không theo mã vai - Kẻ Nguyền Rủa đã hoá Sói và Sói Con
      // đều được miễn.
      legalTargets.KILL = alive
        .filter((player) => roleTeam(player.role) !== "wolves")
        .map((player) => player.id);
    } else if (canSee && !seerBlocked) {
      legalActions.push("SEE");
      legalTargets.SEE = alive
        .filter((player) => player.id !== viewer.id)
        .map((player) => player.id);
    } else if (viewer.role === "DETECTIVE") {
      // Thám Tử cần ĐÚNG hai người còn sống khác nhau, và KHÔNG có mình trong
      // đó - xem hàng rào cùng tên ở `submitNightAction`.
      const targets = alive.filter((player) => player.id !== viewer.id).map((player) => player.id);
      if (targets.length >= 2) {
        legalActions.push("DETECTIVE_CHECK");
        legalTargets.DETECTIVE_CHECK = targets;
      }
    } else if (viewer.role === "GUARDIAN_ANGEL") {
      // Hai lượt cả ván, không đỡ lại đúng người đêm trước, và không tự đỡ -
      // xem hàng rào cùng tên ở `submitNightAction`.
      const charges = st.guardianAngelCharges[viewer.id] ?? 2;
      const targets = alive
        .filter((player) => player.id !== st.guardianAngelPrevious && player.id !== viewer.id)
        .map((player) => player.id);
      if (charges > 0 && targets.length > 0) {
        legalActions.push("GUARDIAN_PROTECT");
        legalTargets.GUARDIAN_PROTECT = targets;
      }
    } else if (viewer.role === "SERIAL_KILLER") {
      // Một mình, mỗi đêm, và không bị nhịp khoá phiếu của bầy Sói chi phối -
      // nên nhánh này không hỏi `wolvesLocked` như Phù Thuỷ. Bỏ qua rồi thì
      // engine từ chối mọi thứ, kể cả một SKIP thứ hai, nên không chào gì nữa.
      if (st.night.serialKillerSkipped !== true) {
        const prey = alive.filter((player) => player.id !== viewer.id).map((player) => player.id);
        if (prey.length > 0) {
          legalActions.push("SERIAL_KILL");
          legalTargets.SERIAL_KILL = prey;
        }
        legalActions.push("SKIP");
      }
    } else if (viewer.role === "GUARD") {
      // Không được tự bảo vệ, không đỡ lại đúng người đêm trước.
      legalActions.push("GUARD");
      const guardedBefore = this.guardedLastNight();
      legalTargets.GUARD = alive
        .filter((player) => player.id !== viewer.id && !guardedBefore.includes(player.id))
        .map((player) => player.id);
    } else if (isWitch && st.night.wolvesLocked) {
      // Phù Thuỷ đi SAU bầy Sói: trước khi khoá phiếu, engine từ chối MỌI hành
      // động của cô ta - kể cả SKIP. Chào một hành động ở đây trong lúc engine
      // sẽ ném là nói dối với lõi AI, và lượt đêm mất trắng vì một nước đi hợp
      // lệ trên giấy.
      if (!st.healUsed && st.night.killTarget) legalActions.push("HEAL");
      if (!st.poisonUsed) {
        legalActions.push("POISON");
        legalTargets.POISON = alive.map((player) => player.id);
      }
      // SKIP luôn hợp lệ SAU khi khoá: không dùng bình nào là lựa chọn có chủ đích.
      legalActions.push("SKIP");
    }

    return {
      canAct: this.nightActionPending(viewer),
      legalActions,
      legalTargets,
      wolfTarget:
        (isWolf || isWitch) && st.night.wolvesLocked ? st.night.killTarget : null,
      // Mỗi vai chỉ thấy mốc "đêm trước" của CHÍNH kỹ năng mình; Bảo Vệ và
      // Thiên Thần có hai bộ đếm riêng và không được nhìn thấy của nhau.
      guardPrevious:
        viewer.role === "GUARD"
          ? st.guardPrevious
          : viewer.role === "GUARDIAN_ANGEL"
            ? st.guardianAngelPrevious
            : null,
      healUsed: isWitch ? st.healUsed : false,
      poisonUsed: isWitch ? st.poisonUsed : false,
      wolvesLocked: st.night.wolvesLocked,
      bonusSecondTargetFor: this.bonusSecondTargetFor(viewer, isWolf, canSee && !seerBlocked),
    };
  }

  /**
   * Bảng claim Ngày Sự Thật, đã lọc về đúng kiểu.
   *
   * `GameState` giữ claim là `string` vì nó đi thẳng từ payload socket. Lọc ở
   * đây chứ không ép kiểu: một phòng phục hồi từ Redis có thể mang state của
   * phiên bản khác, và truy một memory bịa ra từ chuỗi lạ tốn hơn nhiều so với
   * một lần kiểm ở đúng ranh giới kiểu.
   */
  private publicRoleClaims(): Record<string, Role | null> {
    const claims: Record<string, Role | null> = {};
    for (const [playerId, claim] of Object.entries(this.state.dayOfTruthClaims ?? {})) {
      if (claim === null) {
        claims[playerId] = null;
      } else if (claim in ROLE_META) {
        claims[playerId] = claim as Role;
      }
    }
    return claims;
  }

  /**
   * Vai này có được chọn thêm một mục tiêu phụ đêm nay không.
   *
   * Điều kiện phải khớp ĐÚNG hai nhánh `secondaryTargetId` trong
   * `submitNightAction`. Chào một mục tiêu phụ mà engine sẽ từ chối không chỉ
   * làm mất mục tiêu phụ - nó làm mất CẢ lượt đêm, vì engine ném trước khi ghi
   * nhận mục tiêu chính.
   */
  private bonusSecondTargetFor(
    viewer: EnginePlayer,
    isWolf: boolean,
    canSee: boolean,
  ): NightActionKind | null {
    const st = this.state;
    if (isWolf) {
      const doubleKill = st.night.wolfCubRageTonight || st.activeEvent?.id === "BLOODY_HUNT";
      // Cần ít nhất hai mồi ngoài bầy: dưới mức đó mục tiêu phụ chắc chắn trùng
      // mục tiêu chính, và engine ném đúng vào cú trùng đó.
      const prey = this.alivePlayers().filter((player) => roleTeam(player.role) !== "wolves");
      return doubleKill && prey.length >= 2 ? "KILL" : null;
    }
    if (canSee && st.activeEvent?.id === "CLEARING_MIST") {
      // Trừ chính mình: engine cấm tự soi, nên phải còn hai người KHÁC.
      const targets = this.alivePlayers().filter((player) => player.id !== viewer.id);
      return targets.length >= 2 ? "SEE" : null;
    }
    if (viewer.role === "GUARD" && st.activeEvent?.id === "VIGILANT_NIGHT") {
      // Cùng bộ lọc mà `legalTargets.GUARD` dùng: chào một mục tiêu thứ hai mà
      // engine sẽ ném là làm lõi AI mất trắng cả lượt che.
      const guardedBefore = this.guardedLastNight();
      const targets = this.alivePlayers().filter(
        (player) => player.id !== viewer.id && !guardedBefore.includes(player.id),
      );
      return targets.length >= 2 ? "GUARD" : null;
    }
    return null;
  }

  /**
   * Lượt phản kích của Thợ Săn, chỉ cho đúng người đang có lượt.
   *
   * Không dùng tên `hunterReaction` (state thô) để một lần spread nhầm không
   * kéo theo trường nội bộ nào.
   */
  private botHunterShotKnowledgeFor(
    viewer: EnginePlayer,
  ): { canAct: boolean; legalTargets: string[] } | null {
    const reaction = this.state.hunterReaction;
    if (this.state.phase !== "HUNTER_SHOT" || !reaction) return null;
    if (reaction.hunterId !== viewer.id || reaction.resolved) return null;

    return {
      canAct: true,
      legalTargets: this.alivePlayers()
        .filter((player) => player.id !== viewer.id)
        .map((player) => player.id),
    };
  }

  /** Vai này còn lượt đêm nay chưa. Cùng điều kiện `nightInfoFor` dùng cho UI. */
  private nightActionPending(viewer: EnginePlayer): boolean {
    const st = this.state;
    if (roleTeam(viewer.role) === "village" && !this.villagePowersActive()) return false;
    if (isWolfPack(viewer.role)) {
      return st.night.wolfVotes[viewer.id] === undefined;
    }
    if (viewer.role === "SEER" || viewer.role === "APPRENTICE_SEER") {
      return st.night.seerResults[viewer.id] === undefined;
    }
    if (viewer.role === "GUARD") return st.night.guardTarget === null;
    if (viewer.role === "DETECTIVE") return st.night.detectiveResults[viewer.id] === undefined;
    if (viewer.role === "GUARDIAN_ANGEL") return st.night.guardianAngelTarget === null;
    if (viewer.role === "SERIAL_KILLER") {
      return st.night.serialKillerTarget === null && st.night.serialKillerSkipped !== true;
    }
    if (viewer.role === "WITCH") {
      // Chưa khoá phiếu Sói thì chưa tới lượt, nên `canAct` phải là false dù
      // cô ta chưa dùng bình nào.
      if (!st.night.wolvesLocked) return false;
      return !st.night.witchSkipped && !st.night.healTonight && st.night.poisonTarget === null;
    }
    return false;
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
