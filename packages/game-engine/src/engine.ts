import {
  DEAD_MESSAGE_MAX_LENGTH,
  RESULT_MS,
  ROLE_REVEAL_MS,
  ROLE_META,
  isRole,
  isWolfPack,
  outcomeName,
  roleTeam,
  type GameEventView,
  type GamePhase,
  type PersonalWin,
  type PublicVoteChoice,
  type Role,
  type RoomConfig,
  type Winner,
} from "@masoi/shared";
import { selectEvent } from "./events/eventManager";
import { applyDayEventStart } from "./events/day-start";
import { assignRoles, type AssignInput } from "./assignRoles";
import type { BotKnowledgeView } from "./bot/types";
import * as views from "./engine-views";
import * as night from "./engine-night";
import {
  GameError,
  type DeathInfo,
  type EnginePlayer,
  type GameState,
  type NominationOutcome,
  type PublicDeath,
  type TrialState,
} from "./types";

export type {
  DetectiveResultView,
  NightInfoView,
  PlayerGameView,
  SeerResultView,
  SorcererResultView,
} from "./engine-views";

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
    healTonight: false,
    poisonTarget: null,
    witchSkipped: false,
    seerResults: {},
    detectiveTargets: null,
    detectiveResults: {},
    sorcererResults: {},
    serialKillerTarget: null,
    serialKillerSkipped: false,
    trackerTargets: {},
    trackerResults: {},
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
    this.state.night.detectiveTargets ??= null;
    this.state.night.detectiveResults ??= {};
    this.state.night.sorcererResults ??= {};
    // State lưu trước khi có Kẻ Theo Dõi không có hai trường dưới, cùng lý do
    // với `sorcererResults` ngay trên.
    this.state.night.trackerTargets ??= {};
    this.state.night.trackerResults ??= {};
    // State lưu trước khi có Sát Nhân không có ba trường dưới. Mặc định an toàn
    // là "role tắt, đêm nay chưa ra tay": không ván cũ nào bỗng dưng mọc thêm
    // một nhát dao.
    this.state.night.serialKillerTarget ??= null;
    this.state.night.serialKillerSkipped ??= false;
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

  /** @internal Dùng bởi `engine-night.ts`, không phải API công khai. */
  queueHunterReaction(deaths: Array<{ playerId: string }>, source: "night" | "vote"): void {
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
  /** @internal Dùng bởi `engine-views.ts` / `engine-night.ts`, không phải API công khai. */
  guardedLastNight(): string[] {
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
  /** @internal Dùng bởi `engine-night.ts`, không phải API công khai. */
  elderKilledByVillage(playerId: string): void {
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
  /** @internal Dùng bởi `engine-night.ts`, không phải API công khai. */
  noteDeathOrder(orderedIds: readonly string[]): void {
    if (this.state.firstDeadId) return;
    const first = orderedIds.find((id) => this.player(id) !== undefined);
    if (first) this.state.firstDeadId = first;
  }

  /** Kỹ năng đặc biệt phe làng còn hiệu lực không. Xem `elderKilledByVillage`. */
  /** @internal Dùng bởi `engine-views.ts` / `engine-night.ts`, không phải API công khai. */
  villagePowersActive(): boolean {
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
    const activeEvent = applyDayEventStart(this.state, event, rng);
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

  // ---- Hành động ban đêm: thân hàm ở engine-night.ts ----

  submitNightAction(
    playerId: string,
    type: night.NightActionType,
    targetId: string | null,
    secondaryTargetId?: string | null,
    rng: () => number = Math.random,
  ): void {
    night.submitNightAction(this, playerId, type, targetId, secondaryTargetId, rng);
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
      (p) => !this.hasNightAction(p.role) || !views.nightActionPending(this, p),
    );
  }

  /** Nới hạn của pha hiện tại; dùng để mở cửa sổ riêng cho Phù Thuỷ. */
  extendPhase(durationMs: number, now = Date.now()): void {
    this.state.phaseEndsAt = now + durationMs;
  }

  resolveNight(now = Date.now(), rng: () => number = Math.random): DeathInfo[] {
    return night.resolveNight(this, now, rng);
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

  // ---- View: phần chiếu nằm ở engine-views.ts ----

  snapshotFor(viewerId: string): views.PlayerGameView {
    return views.snapshotFor(this, viewerId);
  }

  botKnowledgeFor(botId: string): BotKnowledgeView {
    return views.botKnowledgeFor(this, botId);
  }

  legalVoteChoicesFor(viewerId: string): PublicVoteChoice[] {
    return views.legalVoteChoicesFor(this, viewerId);
  }
}
