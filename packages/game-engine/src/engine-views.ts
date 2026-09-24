/**
 * Chiếu `GameState` thành thứ mỗi người xem được thấy: snapshot của người
 * chơi, tri thức của bot, lựa chọn phiếu hợp lệ.
 *
 * Tách khỏi `engine.ts` vì đây là phần CHỈ ĐỌC: không hàm nào ở đây được ghi
 * vào `engine.state`. Import `GameEngine` bằng `import type` để hai file
 * không nạp vòng nhau lúc chạy.
 */
import type { GameEngine } from "./engine";

import {
  isWolfPack,
  roleTeam,
  specialRoleList,
  type DayVoteRecap,
  type ExecutionerView,
  type GameEventView,
  type GamePhase,
  type HunterShotRecap,
  type HunterShotView,
  type NightRecap,
  type PersonalWin,
  type PublicVoteChoice,
  type Role,
  type RoomConfig,
  type Team,
  type TrialRecap,
  type TrialView,
  type Winner,
} from "@masoi/shared";
import { buildBotKnowledgeView, buildLegalVoteChoices } from "./bot/knowledge";
import type { BotKnowledgeView, NightActionKind, NightKnowledge } from "./bot/types";
import type { EnginePlayer, PublicDeath, TrialRecapState } from "./types";

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

export interface SorcererResultView {
  target: { id: string; name: string };
  isSeerLine: boolean;
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
  seerResult: SeerResultView | null;
  apprenticeAwakened?: boolean;
  detectiveResult?: DetectiveResultView | null;
  sorcererResult?: SorcererResultView | null;
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
   * Kết quả theo dõi gần nhất của Kẻ Theo Dõi, riêng cho viewer này. Đứng
   * NGOÀI `nightInfo` vì phải còn đọc được sau khi pha rời NIGHT, lúc
   * `nightInfo` đã null - xem `RoomSnapshot.trackerResult`.
   */
  trackerResult: { targetId: string; acted: boolean } | null;
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
  pendingLastStandVictim?: { playerId: string; name: string } | null;
  /** Lượt nói của linh hồn, tính riêng cho người xem. Xem RoomSnapshot. */
  deadCanSpeak: { canAct: boolean } | null;
  /** Thắng lợi cá nhân, đã lọc theo quyền của người xem. Xem `personalWinsFor`. */
  personalWins: PersonalWin[];
  /** Nhiệm vụ của Kẻ Báo Thù, `null` với mọi người khác. Xem `executionerViewFor`. */
  executioner: ExecutionerView | null;
}

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
 * Vai → số ghế trong bộ bài, đếm từ ĐÚNG công thức mà `assignRoles` chia
 * (`specialRoleList` + Dân Làng lấp chỗ trống), không phải một bảng chép tay.
 *
 * CÔNG KHAI: chỉ đọc `config` (đi xuống mọi client trong `RoomSnapshot.config`)
 * và sĩ số. Cho biết bộ bài có những vai nào, mỗi vai mấy ghế — không nói ai
 * cầm lá nào. Lớp belief xác suất của bot dùng nó làm prior (xem
 * `role-belief.ts`), nên một preset đổi bộ bài là prior tự theo.
 */
function roleCompositionFor(config: RoomConfig, playerCount: number): Record<string, number> {
  const special = specialRoleList(config);
  const composition: Record<string, number> = {};
  for (const role of special) composition[role] = (composition[role] ?? 0) + 1;
  const villagers = Math.max(0, playerCount - special.length);
  composition.VILLAGER = (composition.VILLAGER ?? 0) + villagers;
  return composition;
}

/**
 * Lượt nói của linh hồn, tính riêng cho người xem.
 *
 * Trả về `{ canAct }` và KHÔNG GÌ KHÁC. Mọi trường thêm vào đây đều là một
 * đường rò danh tính tiềm năng, và `hunterShotInfo` ngay phía trên đã phải
 * thay tên thật bằng "Ẩn danh" vì đúng lý do đó.
 */
function deadCanSpeakViewFor(
  engine: GameEngine,
  viewerId: string,
): { canAct: boolean } | null {
  const st = engine.state;
  if (st.activeEvent?.id !== "DEAD_CAN_SPEAK") return null;
  return { canAct: !st.deadCanSpeakUsed && st.deadCanSpeakChosenId === viewerId };
}

/**
 * Sổ thành tích đã lọc cho MỘT người xem.
 *
 * Ở `GAME_OVER` mọi vai đã lộ nên danh sách mở hết. Trước đó, người xem chỉ
 * thấy mục của chính mình: một mục công khai giữa ván sẽ nói cho cả phòng
 * biết vai của người vừa bị treo, đúng điều mà luật "cái chết không tiết lộ
 * gì" cấm.
 */
function personalWinsFor(engine: GameEngine, viewerId: string): PersonalWin[] {
  const wins = engine.personalWins();
  const visible =
    engine.state.phase === "GAME_OVER" ? wins : wins.filter((win) => win.playerId === viewerId);
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
function executionerViewFor(
  engine: GameEngine,
  viewer: EnginePlayer | undefined,
): ExecutionerView | null {
  if (!viewer) return null;
  const targetId = engine.executionerTargets()[viewer.id];
  if (targetId === undefined) return null;
  const target = engine.player(targetId);
  return {
    target: target ? { id: target.id, name: target.name, alive: target.alive } : null,
    won: engine.personalWins().some(
      (win) => win.playerId === viewer.id && win.condition === "EXECUTIONER_TARGET_LYNCHED",
    ),
    turnedJester: viewer.executionerTurned === true,
  };
}

/**
 * Khối hành động đêm của một vai. Chỉ Sói và Phù Thuỷ được biết nạn nhân, và
 * Phù Thuỷ chỉ biết sau khi bầy Sói khoá phiếu - trước đó cô ta còn đang chờ lượt.
 */
function nightInfoFor(
  engine: GameEngine,
  viewer: EnginePlayer,
  seerResult: SeerResultView | null,
  detectiveResult: DetectiveResultView | null,
  sorcererResult?: SorcererResultView | null,
): NightInfoView {
  const st = engine.state;
  const locked = st.night.wolvesLocked;
  const isWolf = isWolfPack(viewer.role);
  const isWitch = viewer.role === "WITCH";
  const tally = isWolf ? engine.wolfVoteTally() : null;

  let acted = false;
  if (viewer.role === "SORCERER") {
    acted =
      st.night.wolfVotes[viewer.id] !== undefined &&
      st.night.sorcererResults[viewer.id] !== undefined;
  } else if (isWolf) {
    acted = st.night.wolfVotes[viewer.id] !== undefined;
  } else if (viewer.role === "SEER" || (viewer.role === "APPRENTICE_SEER" && st.apprenticeAwakened)) {
    acted = st.night.seerResults[viewer.id] !== undefined;
  } else if (viewer.role === "GUARD") {
    acted = st.night.guardTarget !== null;
  } else if (viewer.role === "DETECTIVE") {
    acted = st.night.detectiveResults[viewer.id] !== undefined;
  } else if (viewer.role === "TRACKER") {
    acted = st.night.trackerTargets[viewer.id] !== undefined;
  } else if (viewer.role === "SERIAL_KILLER") {
    acted = st.night.serialKillerTarget !== null || st.night.serialKillerSkipped === true;
  } else if (isWitch) {
    acted = st.night.witchSkipped || st.night.healTonight || st.night.poisonTarget !== null;
  }

  let canAct = isWitch ? locked : isWolf ? !locked : true;
  if (viewer.role === "SORCERER") {
    const checkDone = st.night.sorcererResults[viewer.id] !== undefined;
    const voteDone = st.night.wolfVotes[viewer.id] !== undefined;
    canAct = !checkDone || (!voteDone && !locked);
  }
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
    wolfVotesRequired: isWolf ? engine.aliveWolves().length : undefined,
    myWolfVote: isWolf ? st.night.wolfVotes[viewer.id] ?? null : undefined,
    guardPrevious: viewer.role === "GUARD" ? st.guardPrevious : undefined,
    seerResult,
    apprenticeAwakened: viewer.role === "APPRENTICE_SEER" ? st.apprenticeAwakened : undefined,
    detectiveResult,
    sorcererResult:
      viewer.role === "SORCERER"
        ? (sorcererResult ?? null)
        : undefined,
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
function lastTrialViewFor(
  engine: GameEngine,
  recap: TrialRecapState,
  viewerId: string,
): TrialRecap {
  const { weightDecidedVoterIds, ...shared } = recap;
  return { ...shared, yourWeightDecided: weightDecidedVoterIds?.includes(viewerId) === true };
}

/** Khối phiên toà của một người xem. Chỉ gọi khi state.trial khác null. */
function trialViewFor(
  engine: GameEngine,
  viewerId: string,
  viewer: EnginePlayer | undefined,
): TrialView {
  const st = engine.state;
  const trial = st.trial!;
  const accused = engine.player(trial.accusedId);
  const { guilty, innocent } = engine.finalVoteTally(false);
  // Đọc trực tiếp finalVotes chứ không qua finalVoters(): người xem có thể đã
  // chết giữa phiên toà, và khi đó họ không còn là cử tri nhưng vẫn phải thấy
  // đúng lá phiếu mình đã bỏ.
  const myVote = trial.finalVotes[viewerId];

  return {
    accusedId: trial.accusedId,
    accusedName: accused?.name ?? "?",
    guiltyVotes: guilty,
    innocentVotes: innocent,
    guiltyRequired: engine.guiltyRequired(false),
    canVote:
      st.phase === "FINAL_VOTE" &&
      viewer?.alive === true &&
      viewerId !== trial.accusedId &&
      myVote === undefined,
    hasVoted: myVote !== undefined,
    myVote: myVote ?? null,
    canSpeak: st.phase === "DEFENSE" && viewer?.alive === true,
  };
}

export function snapshotFor(engine: GameEngine, viewerId: string): PlayerGameView {
  const st = engine.state;
  const viewer = engine.player(viewerId);
  const revealAll = st.phase === "GAME_OVER";
  // Biến thể luật đang đo, xem `RoomConfig.revealRoleOnDeath`. Phòng thật
  // luôn thấy `undefined` ở đây.
  const revealDead = st.config.revealRoleOnDeath === true;
  // Sói luôn biết đồng bọn của mình
  const viewerIsWolf = viewer !== undefined && viewer.alive && isWolfPack(viewer.role);
  // Tiên Tri Tập Sự luôn biết Tiên Tri; xem chú thích dài ở `botKnowledgeFor`.
  const viewerIsApprentice =
    viewer !== undefined && viewer.alive && viewer.role === "APPRENTICE_SEER";

  const tally = engine.voteTally(false);
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
      // Sổ Tang lộ đúng MỘT người, và lộ cho cả bàn - xem `obituaryRevealedId`.
      revealAll || (revealDead && !p.alive) || p.id === st.obituaryRevealedId
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
      targetName: engine.player(seerResultEntry.targetId)?.name ?? "?",
      // Kết quả lưu trước bản này không có `team`; rơi về đúng thứ nó có.
      // `isWolf === false` ở một bản ghi cũ vẫn nghĩa là "phe làng", vì lúc
      // đó chưa có vai nào ngoài hai phe.
      team: seerResultEntry.team ?? (seerResultEntry.isWolf ? "wolves" : "village"),
      isWolf: seerResultEntry.isWolf,
      secondaryTargetId: seerResultEntry.secondaryTargetId,
      secondaryTargetName: seerResultEntry.secondaryTargetId
        ? engine.player(seerResultEntry.secondaryTargetId)?.name ?? "?"
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
            name: engine.player(detectiveEntry.target1Id)?.name ?? "?",
          },
          target2: {
            id: detectiveEntry.target2Id,
            name: engine.player(detectiveEntry.target2Id)?.name ?? "?",
          },
          sameTeam: detectiveEntry.sameTeam,
        }
      : null;

  const sorcererEntry = viewer ? st.night.sorcererResults[viewerId] : undefined;
  const sorcererResult: SorcererResultView | null =
    sorcererEntry && viewer
      ? {
          target: {
            id: sorcererEntry.targetId,
            name: engine.player(sorcererEntry.targetId)?.name ?? "?",
          },
          isSeerLine: sorcererEntry.isSeerLine,
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
      st.phase === "NIGHT" && viewer && viewer.alive && engine.hasNightAction(viewer.role)
        ? nightInfoFor(engine, viewer, seerResult, detectiveResult, sorcererResult)
        : null,
    // Bản sao nông, không phải tham chiếu sống vào `night.trackerResults` -
    // nếu người nhận view lỡ sửa object này thì state thật của engine không
    // bị hỏng theo (giống cách seerResult/detectiveResult/sorcererResult
    // dựng object mới ở trên thay vì trả thẳng entry).
    trackerResult: st.night.trackerResults[viewerId]
      ? { ...st.night.trackerResults[viewerId] }
      : null,
    hunterShotInfo:
      st.phase === "HUNTER_SHOT" && st.hunterReaction
        ? (() => {
            const isHunterViewer = viewerId === st.hunterReaction!.hunterId;
            return {
              hunterId: isHunterViewer ? st.hunterReaction!.hunterId : "",
              hunterName: isHunterViewer ? engine.player(st.hunterReaction!.hunterId)?.name ?? "?" : "Ẩn danh",
              canAct: !st.hunterReaction!.resolved && isHunterViewer,
              resolved: st.hunterReaction!.resolved,
              target:
                st.hunterReaction!.resolved && isHunterViewer
                  ? st.hunterShots.at(-1)?.target ?? null
                  : null,
            };
          })()
        : null,
    trialInfo: inTrialPhase && st.trial ? trialViewFor(engine, viewerId, viewer) : null,
    lastTrial:
      (st.phase === "ELIMINATION" || st.phase === "CHECK_WIN" || st.phase === "GAME_OVER") &&
      st.lastTrial
        ? lastTrialViewFor(engine, st.lastTrial, viewerId)
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
    pendingLastStandVictim: st.pendingLastStandVictim
      ? { playerId: st.pendingLastStandVictim.playerId, name: engine.player(st.pendingLastStandVictim.playerId)?.name ?? "?" }
      : null,
    deadCanSpeak: deadCanSpeakViewFor(engine, viewerId),
    personalWins: personalWinsFor(engine, viewerId),
    executioner: executionerViewFor(engine, viewer),
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
export function botKnowledgeFor(engine: GameEngine, botId: string): BotKnowledgeView {
  const st = engine.state;
  const viewer = engine.mustPlayer(botId);
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
  /*
   * Sổ Tang đi qua ĐÚNG kênh này, không chỉ qua `announcement`.
   *
   * Không một dòng nào trong `src/bot/` đọc `announcement`, nên một sự kiện
   * thuần thông báo là vô hình với mọi BOT ở bàn - và self-play sẽ đo nó ra 0
   * điểm bất kể nó đáng bao nhiêu với người thật.
   */
  const obituaryId = st.obituaryRevealedId;
  if (obituaryId) {
    const revealed = st.players.find((player) => player.id === obituaryId);
    if (revealed) knownRoles[revealed.id] = revealed.role;
  }

  const seerResultEntry = st.night.seerResults[botId];
  const seerResult = seerResultEntry
    ? {
        targetId: seerResultEntry.targetId,
        targetName: engine.player(seerResultEntry.targetId)?.name ?? "?",
        isWolf: seerResultEntry.isWolf,
        // Cùng đường rơi về như `snapshotFor`: lõi BOT không được thấy nhiều
        // hơn người chơi thật, và cũng không được thấy ít hơn.
        team: seerResultEntry.team ?? (seerResultEntry.isWolf ? "wolves" : "village"),
      }
    : null;

  // Gương `seerResult` ngay trên: entry ghi theo botId nên chỉ chính Sói Pháp
  // Sư mới có - không cần thêm cổng theo vai.
  const sorcererEntry = st.night.sorcererResults[botId];
  const sorcererResult = sorcererEntry
    ? {
        targetId: sorcererEntry.targetId,
        targetName: engine.player(sorcererEntry.targetId)?.name ?? "?",
        isSeerLine: sorcererEntry.isSeerLine,
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
    obituaryRevealedId: st.obituaryRevealedId ?? null,
    seerResult,
    sorcererResult,
    // Gương `seerResult` ngay trên: entry ghi theo botId nên chỉ chính Kẻ
    // Theo Dõi mới có - không cần thêm cổng theo vai. Sao chép nông để
    // tránh trả thẳng tham chiếu sống vào `night.trackerResults`.
    trackerResult: st.night.trackerResults[botId]
      ? { ...st.night.trackerResults[botId] }
      : null,
    // Suy từ CHÍNH bộ bài mà `assignRoles` chia, không phải một danh sách
    // chép tay: bật thêm một vai trung lập sau này là nó tự vào đây.
    neutralRolesInPlay: neutralRolesFor(st.config),
    // Cùng nguồn công khai với dòng ngay trên, nhưng kèm SỐ GHẾ cho mỗi vai:
    // prior của lớp belief xác suất (xem `role-belief.ts`).
    roleComposition: roleCompositionFor(st.config, st.players.length),
    // Nhiệm vụ RIÊNG của chính con BOT này, không bao giờ của ai khác - cùng
    // cổng với `executionerViewFor` dành cho người thật, và cùng một bảng
    // nguồn. Một BOT khác đọc `undefined` ở đây, kể cả BOT ngồi cạnh.
    executionerTargetId: engine.executionerTargets()[botId] ?? null,
    night: botNightKnowledgeFor(engine, viewer),
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
    hunterShot: botHunterShotKnowledgeFor(engine, viewer),
    publicVoteHistory: st.dayVoteHistory,
    // Đếm đầu người, đúng bằng thứ một người chơi nhìn thấy: cho BOT bản có
    // trọng số là cho nó suy ra Thị Trưởng bằng dữ liệu không ai khác có.
    currentVoteCounts: engine.voteTally(false),
    // Phiếu của chính mình vẫn hiển thị sau khi pha bỏ phiếu đóng, đúng như
    // snapshotFor: nói với BOT rằng nó "chưa bầu" trong lúc biện hộ là một
    // lời khai sai, và lõi belief sẽ dựng memory từ lời khai đó.
    currentVote: viewer.alive ? st.votes[botId] : undefined,
    legalVoteChoices: legalVoteChoicesFor(engine, botId),
    lastNightDeaths: st.lastNightDeaths,
    // Công khai với cả phòng qua `RoomSnapshot.activeEvent`, nên không có gì
    // để lọc; lõi BOT cần nó để biết luật hôm nay đã đổi.
    activeEventId: st.activeEvent?.id ?? null,
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
function botNightKnowledgeFor(
  engine: GameEngine,
  viewer: EnginePlayer,
): NightKnowledge | null {
  const st = engine.state;
  if (st.phase !== "NIGHT" || !viewer.alive) return null;
  if (!engine.hasNightAction(viewer.role)) return null;

  const isWolf = isWolfPack(viewer.role);
  const isWitch = viewer.role === "WITCH";
  const alive = engine.alivePlayers();

  const legalActions: NightActionKind[] = [];
  const legalTargets: Record<NightActionKind, string[]> = {
    KILL: [],
    SEE: [],
    GUARD: [],
    HEAL: [],
    POISON: [],
    SKIP: [],
    DETECTIVE_CHECK: [],
    SERIAL_KILL: [],
    SORCERER_CHECK: [],
    TRACK: [],
  };

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
    // Sói Pháp Sư cắn cùng bầy NHƯNG soi riêng dòng Tiên Tri (gương Detective:
    // người sống trừ mình).
    if (viewer.role === "SORCERER") {
      legalActions.push("SORCERER_CHECK");
      legalTargets.SORCERER_CHECK = alive
        .filter((player) => player.id !== viewer.id)
        .map((player) => player.id);
    }
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
    const guardedBefore = engine.guardedLastNight();
    legalTargets.GUARD = alive
      .filter((player) => player.id !== viewer.id && !guardedBefore.includes(player.id))
      .map((player) => player.id);
  } else if (viewer.role === "TRACKER") {
    // Không tự theo dõi; theo dõi lại người đêm trước CHO PHÉP - xem hàng
    // rào cùng tên ở `submitNightAction`.
    legalActions.push("TRACK");
    legalTargets.TRACK = alive
      .filter((player) => player.id !== viewer.id)
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
    canAct: nightActionPending(engine, viewer),
    legalActions,
    legalTargets,
    wolfTarget:
      (isWolf || isWitch) && st.night.wolvesLocked ? st.night.killTarget : null,
    guardPrevious: viewer.role === "GUARD" ? st.guardPrevious : null,
    healUsed: isWitch ? st.healUsed : false,
    poisonUsed: isWitch ? st.poisonUsed : false,
    wolvesLocked: st.night.wolvesLocked,
    bonusSecondTargetFor: bonusSecondTargetFor(engine, viewer, isWolf, canSee && !seerBlocked),
  };
}

/**
 * Vai này có được chọn thêm một mục tiêu phụ đêm nay không.
 *
 * Điều kiện phải khớp ĐÚNG hai nhánh `secondaryTargetId` trong
 * `submitNightAction`. Chào một mục tiêu phụ mà engine sẽ từ chối không chỉ
 * làm mất mục tiêu phụ - nó làm mất CẢ lượt đêm, vì engine ném trước khi ghi
 * nhận mục tiêu chính.
 */
function bonusSecondTargetFor(
  engine: GameEngine,
  viewer: EnginePlayer,
  isWolf: boolean,
  canSee: boolean,
): NightActionKind | null {
  const st = engine.state;
  if (isWolf) {
    const doubleKill = st.night.wolfCubRageTonight || st.activeEvent?.id === "BLOODY_HUNT";
    // Cần ít nhất hai mồi ngoài bầy: dưới mức đó mục tiêu phụ chắc chắn trùng
    // mục tiêu chính, và engine ném đúng vào cú trùng đó.
    const prey = engine.alivePlayers().filter((player) => roleTeam(player.role) !== "wolves");
    return doubleKill && prey.length >= 2 ? "KILL" : null;
  }
  if (canSee && st.activeEvent?.id === "CLEARING_MIST") {
    // Trừ chính mình: engine cấm tự soi, nên phải còn hai người KHÁC.
    const targets = engine.alivePlayers().filter((player) => player.id !== viewer.id);
    return targets.length >= 2 ? "SEE" : null;
  }
  if (viewer.role === "GUARD" && st.activeEvent?.id === "VIGILANT_NIGHT") {
    // Cùng bộ lọc mà `legalTargets.GUARD` dùng: chào một mục tiêu thứ hai mà
    // engine sẽ ném là làm lõi AI mất trắng cả lượt che.
    const guardedBefore = engine.guardedLastNight();
    const targets = engine.alivePlayers().filter(
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
function botHunterShotKnowledgeFor(
  engine: GameEngine,
  viewer: EnginePlayer,
): { canAct: boolean; legalTargets: string[] } | null {
  const reaction = engine.state.hunterReaction;
  if (engine.state.phase !== "HUNTER_SHOT" || !reaction) return null;
  if (reaction.hunterId !== viewer.id || reaction.resolved) return null;

  return {
    canAct: true,
    legalTargets: engine.alivePlayers()
      .filter((player) => player.id !== viewer.id)
      .map((player) => player.id),
  };
}

/** Vai này còn lượt đêm nay chưa. Cùng điều kiện `nightInfoFor` dùng cho UI. */
export function nightActionPending(engine: GameEngine, viewer: EnginePlayer): boolean {
  const st = engine.state;
  if (roleTeam(viewer.role) === "village" && !engine.villagePowersActive()) return false;
  // Sói Pháp Sư có HAI lượt: phiếu cắn cùng bầy + soi dòng Tiên Tri riêng.
  // Còn lượt khi một trong hai chưa xong; `nightInfoFor` soi cùng điều kiện.
  if (viewer.role === "SORCERER") {
    return (
      st.night.wolfVotes[viewer.id] === undefined ||
      st.night.sorcererResults[viewer.id] === undefined
    );
  }
  if (isWolfPack(viewer.role)) {
    return st.night.wolfVotes[viewer.id] === undefined;
  }
  if (viewer.role === "SEER" || viewer.role === "APPRENTICE_SEER") {
    return st.night.seerResults[viewer.id] === undefined;
  }
  if (viewer.role === "GUARD") return st.night.guardTarget === null;
  if (viewer.role === "DETECTIVE") return st.night.detectiveResults[viewer.id] === undefined;
  if (viewer.role === "TRACKER") return st.night.trackerTargets[viewer.id] === undefined;
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
export function legalVoteChoicesFor(
  engine: GameEngine,
  viewerId: string,
): PublicVoteChoice[] {
  return buildLegalVoteChoices(
    canSubmitVote(engine, viewerId),
    engine.alivePlayers().map((player) => player.id),
  );
}

/** Cùng điều kiện mà submitVote thực thi, tách ra để view không đoán lại luật. */
function canSubmitVote(engine: GameEngine, viewerId: string): boolean {
  return engine.state.phase === "VOTING" && engine.player(viewerId)?.alive === true;
}
