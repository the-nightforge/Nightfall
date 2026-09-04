import { GameEngine } from "@masoi/game-engine";
import type { BotDecisionContext, BotSpeechIntention } from "@masoi/game-engine";
import {
  DEAD_MESSAGE_MAX_LENGTH,
  GHOST_AUTHOR_ID,
  GHOST_AUTHOR_NAME,
  RESULT_MS,
  ROLE_REVEAL_MS,
  SERVER_EVENTS,
} from "@masoi/shared";
import type { PublicVoteChoice } from "@masoi/shared";
import type { Room } from "../rooms/store";
import { clearRoomTimers, persistRoom, setRoomTimer } from "../rooms/store";
import { armStep, clearPendingStep, registerStepHandlers } from "./steps";
import { writeGameResultOnce } from "./game-result";
import { resetMatchChat } from "./match-chat";
import { broadcastRoom, emitToPlayers } from "../rooms/broadcast";
import { destroyVoiceRoom, syncVoicePermissions } from "../voice/service";
import { buildSnapshot, dayRecipients, pushChat, resolveChat } from "../rooms/snapshot";
import { botBrain, resetBotBudget } from "../bots";
import { buildBotDecisionContext } from "../bots/context";
import { renderBotSpeech, speechTemplate } from "../bots/speech-renderer";
import {
  describeSpeechStyle,
  recentOpenings,
  recentSpeechSourceIds,
} from "@masoi/game-engine";
import type { SpeechRequest } from "../bots/types";
import { engineVote } from "../bots/targets";
import { botSessionFor, clearBotSession, startBotSession } from "../bots/session-registry";
import { newId } from "../util";
import type { NightDecision, PlannedVote } from "../bots/types";
import { pendingEndFinalVote } from "./bot-room-state";
import {
  cancelDiscussionScheduler,
  runDiscussionScheduler,
} from "./discussion-scheduler";
import { isBotControlled } from "./seat-control";
import {
  DISCONNECT_GRACE_MS,
  clearDiscussionSkipVotes,
  hasUnanimousDiscussionSkip,
  updateDiscussionSkipVote,
} from "./discussion-skip";
import {
  clearLastLetters,
  lastLetterEnabled,
  openLastLettersForDeaths,
  submitLastLetter,
} from "./last-letter";

const HUNTER_SHOT_MS = 15_000;
/** Chừa một giây để engine nhận fallback trước khi phase hết hạn. */
const HUNTER_BOT_DEADLINE_BUFFER_MS = 1_000;
/** Cùng mục đích, cho vòng bỏ phiếu xác nhận. */
const FINAL_VOTE_BOT_DEADLINE_BUFFER_MS = 1_500;
/** Cửa sổ riêng cho Phù Thuỷ sau khi bầy Sói chốt nạn nhân. */
const WITCH_WINDOW_MS = 15_000;

/**
 * Cửa sổ rải claim của Ngày Sự Thật.
 *
 * Claim phải nằm ở ĐẦU ngày để cả làng còn thời gian bàn về nó; rải hết cả pha
 * thì con cuối cùng khai xong là vừa lúc chuyển sang bỏ phiếu. Vẫn bị kẹp lại
 * theo cửa sổ thật ở dưới, vì Lệnh Giới Nghiêm cắt đôi pha thảo luận.
 */
const DAY_OF_TRUTH_SPREAD_MS = 6_000;

/**
 * Cửa sổ rải lời nhắn của linh hồn.
 *
 * Muộn hơn claim một chút để lời nhắn rơi vào lúc cuộc thảo luận đã có gì đó để
 * bám vào, nhưng vẫn còn đủ ngày để làng phản ứng. Cũng bị kẹp theo cửa sổ thật.
 */
const GHOST_WHISPER_SPREAD_MS = 10_000;

/**
 * Cửa sổ rải lượt viết Phong thư của BOT.
 *
 * Muộn hơn claim, sớm hơn lời nhắn của linh hồn - và lý do là ở chỗ nó KHÔNG
 * hiện ra: lá thư chỉ được lưu vào sổ, không ai thấy gì cả. Rải ra chỉ để mười
 * lăm con bot không cùng ghi vào một lượt event loop, và để một bot bị chết
 * ngay sau đó vẫn kịp có thư. Vẫn bị kẹp theo cửa sổ thật vì Lệnh Giới Nghiêm
 * cắt đôi pha thảo luận.
 */
const LAST_LETTER_SPREAD_MS = 8_000;

function engine(room: Room): GameEngine {
  if (!room.engine) throw new Error("Chưa có trận đấu");
  return room.engine;
}

function sync(room: Room): void {
  /*
   * ĐIỂM NGHẼN DUY NHẤT của việc mở phong thư.
   *
   * Mọi cái chết trong game đều đi qua một lần `sync` ngay sau đó - Sói cắn và
   * Phù Thuỷ dùng độc ở `endNight`, treo cổ ở `endFinalVote`, phát bắn của Thợ
   * Săn ở `submitHunterShot`, Tử Thủ ở lượt `resolveNight` của vòng sau, và màn
   * kết thúc ở `onGameOver`. Đặt lời gọi ở đây thay vì chép vào từng nhánh
   * nghĩa là một cơ chế gây chết THÊM SAU NÀY cũng được phủ sẵn, mà không ai
   * phải nhớ thêm một dòng.
   *
   * Đứng TRƯỚC `persistRoom` và `broadcastRoom`: lá thư phải nằm sẵn trong
   * chính snapshot báo cái chết, không phải trong snapshot kế tiếp.
   *
   * Hàm được gọi thuần theo trạng thái hiện tại nên gọi thừa là vô hại - đó là
   * điều kiện để nó an toàn ở một chỗ bị gọi nhiều lần như thế này.
   */
  openLastLettersForDeaths(room);
  void persistRoom(room);
  // Không await: một lần LiveKit chậm không được làm cả bàn đứng hình chờ đổi
  // pha. Client tự tắt mic ngay khi nhận snapshot là lớp nhanh; lời gọi này là
  // lớp chắc.
  void syncVoicePermissions(room);
  broadcastRoom(room.code);
}

/**
 * Đánh giá điều kiện thắng sau mỗi pha kết quả.
 * Đi qua pha CHECK_WIN để đúng luồng trạng thái đã thiết kế.
 */
function checkWinOrContinue(room: Room, next: () => void): void {
  const e = engine(room);
  /*
   * Kẻ Báo Thù mất mục tiêu thì hoá Thằng Hề, và chỗ đó là ĐÂY.
   *
   * Hàm này là cửa duy nhất mà cả hai đường chết đi qua trước khi ván được
   * chốt: `continueAfterDeathResult` khi không có Thợ Săn nào phải bắn, và
   * `finishHunterShot` sau khi phát bắn đã xử xong. Vì vậy nó đứng đúng sau
   * "cả đợt chết và chuỗi phản ứng Thợ Săn liên quan" và đúng trước
   * `checkWin` - nếu đặt sớm hơn, một Kẻ Báo Thù sắp trúng đạn của Thợ Săn sẽ
   * kịp đổi vai trong cùng cái đợt chết đã hạ nó.
   *
   * `settleExecutioner` tự chặn lặp, nên một bước chuyển pha chạy lại sau khôi
   * phục không đổi vai ai lần thứ hai.
   */
  e.settleExecutioner();
  const winner = e.checkWin();
  if (winner) {
    e.finishGame(winner);
    onGameOver(room);
  } else {
    next();
  }
}

export function startGame(room: Room): void {
  /*
   * Dựng engine TRƯỚC khi động vào phòng, và giữ nó trong một biến cục bộ.
   *
   * `GameEngine.create` có thể NÉM - hôm nay là khi bộ bài có Kẻ Báo Thù mà
   * không còn ai phe Dân để làm mục tiêu. Ở thứ tự cũ, lời ném đó rơi vào giữa
   * một chuỗi đã kịp xoá chat, xoá thư, sinh `gameId` mới và đặt lại
   * `phaseSeq`, để lại một phòng nửa chừng: `status` vẫn là LOBBY nhưng mọi
   * thứ khác đã bị dọn cho một ván không bao giờ bắt đầu. Dựng trước thì lỗi
   * bật ra khi phòng còn nguyên vẹn, và người chơi chỉ thấy đúng một thông báo.
   */
  const engineForGame = GameEngine.create(
    room.members.map((m) => ({ id: m.playerId, name: m.name, isBot: m.isBot })),
    room.config,
  );

  room.chatLog = [];
  // Sổ chat của ván cũ đã đi xuống DB ở GAME_OVER của nó. Không xoá ở đây thì
  // ván thứ hai trong cùng phòng lưu kèm trọn ván trước, và `seq` sẽ nói dối về
  // thứ tự của chính nó.
  resetMatchChat(room);
  clearDiscussionSkipVotes(room.code);
  // Ván mới, sổ thư trắng: một lá thư của ván trước mở ra giữa ván này sẽ nói
  // về những người đã đổi vai.
  clearLastLetters(room);
  // Khoá idempotency của ván này. Sinh Ở ĐÂY chứ không sinh lúc ghi kết quả:
  // lúc ghi thì process có thể đã là một process khác, và một khoá sinh sau
  // restart sẽ không nhận ra bản ghi mà process trước đã kịp tạo.
  room.gameId = newId();
  // Mốc đo thời lượng của ván NÀY. `room.createdAt` không dùng được: nó đứng
  // yên qua mọi lần chơi lại trong cùng một phòng.
  room.startedAt = Date.now();
  room.resultWritten = false;
  room.pendingStep = null;
  room.phaseSeq = 0;
  room.engine = engineForGame;
  room.status = "IN_GAME";
  pendingEndFinalVote.set(room.code, false);
  // Ván mới thì nhận thức của BOT phải bắt đầu lại từ đầu: giữ lại brain của
  // ván trước sẽ mang theo nghi ngờ về những người đã đổi vai.
  startBotSession(room);

  // ROLE_REVEAL rồi tự vào đêm
  armStep(room, { name: "beginNight" }, ROLE_REVEAL_MS);
  sync(room);
}

function beginNight(room: Room): void {
  clearRoomTimers(room.code);
  // Ngày Hoà Hoãn đi thẳng từ thảo luận sang đêm, nên đây cũng là một lối ra
  // của pha thảo luận và mọi phản hồi đang chờ phải bị bỏ.
  cancelDiscussionScheduler(room.code);
  const e = engine(room);
  e.startNight(room.config.nightSeconds * 1000);
  scheduleNightBots(room);
  armStep(room, { name: "lockWolves" }, room.config.nightSeconds * 1000 + 500);
  sync(room);
}

/**
 * Chốt phiếu cắn rồi mở cửa sổ riêng cho Phù Thuỷ.
 *
 * Đêm vẫn là một pha duy nhất; chia hai chặng ở đây vì Phù Thuỷ phải biết ai
 * bị cắn mới quyết được có đốt bình cứu hay không.
 */
function lockWolves(room: Room): void {
  clearRoomTimers(room.code);
  if (!room.engine || room.engine.state.phase !== "NIGHT") return;
  const e = engine(room);
  e.lockWolves();

  if (!e.witchPending()) {
    endNight(room);
    return;
  }
  e.extendPhase(WITCH_WINDOW_MS);
  scheduleNightBots(room);
  armStep(room, { name: "endNight" }, WITCH_WINDOW_MS + 500);
  sync(room);
}

/**
 * Chốt phiếu Sói ngay khi mọi người còn lượt đã nộp xong.
 *
 * Cùng khuôn với `maybeEndWitchWindow` ngay dưới, và cùng lý do: hạn chót của
 * pha là trần chứ không phải nhịp. Không có hàm này thì một phòng 6 người với
 * một Sói, một Tiên Tri và một Bảo Vệ vẫn ngồi hết `nightSeconds` sau khi cả ba
 * đã bấm xong - nhân lên 4-6 đêm mỗi ván.
 *
 * `armStep` tăng `phaseSeq`, nên mốc hẹn dài đang chờ tự hết hiệu lực; không
 * cần gỡ tay. Chỉ gọi SAU một lần nộp thành công: gọi sau một lần nộp bị engine
 * từ chối sẽ đẩy lùi mốc 800ms mỗi lần một BOT lỡ tay nộp lại.
 */
export function maybeLockWolvesEarly(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "NIGHT") return;
  if (room.engine.state.night.wolvesLocked) return;
  if (!room.engine.allNightActionsDone()) return;
  armStep(room, { name: "lockWolves" }, 800);
}

/**
 * Đóng cửa sổ Phù Thuỷ ngay khi cô ta đã quyết, khỏi bắt cả phòng ngồi chờ hết
 * 15 giây, để không phải chờ toàn bộ cửa sổ đêm.
 */
export function maybeEndWitchWindow(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "NIGHT") return;
  if (!room.engine.state.night.wolvesLocked) return;
  if (room.engine.witchPending()) return;
  armStep(room, { name: "endNight" }, 800);
}

function endNight(room: Room): void {
  clearRoomTimers(room.code);
  if (!room.engine || room.engine.state.phase !== "NIGHT") return;
  const deaths = engine(room).resolveNight();
  void deaths;
  sync(room);

  armStep(room, { name: "afterDeathResult", source: "night" }, RESULT_MS);
}

function beginDiscussion(room: Room): void {
  clearRoomTimers(room.code);
  clearDiscussionSkipVotes(room.code);
  const e = engine(room);
  const event = e.startDay(room.config.discussionSeconds * 1000);
  const durationMs = (e.state.phaseEndsAt ?? (Date.now() + room.config.discussionSeconds * 1000)) - Date.now();

  if (event?.id === "AMNESTY_DAY") {
    // Ngày Hòa Hoãn: sau thảo luận chuyển thẳng sang Đêm
    armStep(room, { name: "beginNight" }, durationMs + 500);
  } else {
    armStep(room, { name: "beginVoting" }, durationMs + 500);
  }
  scheduleDayBots(room);
  scheduleDayOfTruthBots(room);
  scheduleDeadCanSpeakBot(room);
  scheduleLastLetterBots(room);
  sync(room);
}

function beginVoting(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "DAY_DISCUSSION") return;
  clearRoomTimers(room.code);
  // Cả làng bấm bỏ qua thảo luận cũng đi qua đây; một câu về muộn sau đó là câu
  // của một tình thế không còn tồn tại.
  cancelDiscussionScheduler(room.code);
  clearDiscussionSkipVotes(room.code);
  const e = engine(room);
  e.setPhase("VOTING", room.config.voteSeconds * 1000);
  scheduleVoteBots(room);
  armStep(room, { name: "endVoting" }, room.config.voteSeconds * 1000 + 500);
  sync(room);
}

export function submitDiscussionSkip(room: Room, playerId: string, skip: boolean): string | null {
  const result = updateDiscussionSkipVote(room, playerId, skip);
  if (!result.ok) return result.error;
  if (result.unanimous) {
    if (room.engine?.state.activeEvent?.id === "AMNESTY_DAY") {
      beginNight(room);
    } else {
      beginVoting(room);
    }
  } else {
    sync(room);
  }
  return null;
}

/**
 * Hết ân hạn của người vừa rớt mạng thì ngưỡng đồng thuận tụt xuống, và số
 * phiếu đang có có thể đã đủ. Không hẹn lại thì những người còn lại đã bấm
 * skip xong vẫn ngồi chờ, vì không có thao tác nào kích hoạt việc kiểm lại.
 */
export function scheduleDiscussionSkipRecheck(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "DAY_DISCUSSION") return;
  setRoomTimer(
    room.code,
    () => {
      if (!reconcileDiscussionSkip(room)) sync(room);
    },
    DISCONNECT_GRACE_MS + 500,
  );
}

export function reconcileDiscussionSkip(room: Room): boolean {
  if (!hasUnanimousDiscussionSkip(room)) return false;
  if (room.engine?.state.activeEvent?.id === "AMNESTY_DAY") {
    beginNight(room);
    return room.engine?.state.phase === "NIGHT";
  }
  beginVoting(room);
  return room.engine?.state.phase === "VOTING";
}

/**
 * Chốt vote sơ bộ tại deadline. Không ai chết ở đây: hoặc mở phiên toà, hoặc
 * kết thúc ngày.
 */
export function endVoting(room: Room): void {
  clearRoomTimers(room.code);
  if (!room.engine || room.engine.state.phase !== "VOTING") return;
  const defenseMs = room.config.defenseSeconds * 1000;
  const outcome = engine(room).resolveNomination(defenseMs);
  sync(room);

  if (outcome.kind === "NONE") {
    armStep(room, { name: "afterDeathResult", source: "vote" }, RESULT_MS);
    return;
  }

  // resolveNomination đã đặt pha và hạn chót; ở đây chỉ còn xếp lịch.
  scheduleDefenseBot(room, outcome.accusedId);
  armStep(room, { name: "beginFinalVote" }, defenseMs + 500);
}

function beginFinalVote(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "DEFENSE") return;
  clearRoomTimers(room.code);
  pendingEndFinalVote.set(room.code, false);
  engine(room).beginFinalVote(room.config.finalVoteSeconds * 1000);
  scheduleFinalVoteBots(room);
  armStep(room, { name: "endFinalVote" }, room.config.finalVoteSeconds * 1000 + 500);
  sync(room);
}

/** Cờ chặn hẹn giờ trùng cho vòng final vote. */
export function maybeEndFinalVoteEarly(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "FINAL_VOTE") return;
  if (!room.engine.allFinalVotersVoted()) return;
  if (pendingEndFinalVote.get(room.code)) return;
  pendingEndFinalVote.set(room.code, true);
  armStep(room, { name: "endFinalVote" }, 800);
}

function endFinalVote(room: Room): void {
  clearRoomTimers(room.code);
  if (!room.engine || room.engine.state.phase !== "FINAL_VOTE") return;
  engine(room).resolveFinalVote();
  sync(room);

  armStep(room, { name: "afterDeathResult", source: "vote" }, RESULT_MS);
}

export function continueAfterDeathResult(room: Room, source: "night" | "vote"): void {
  const e = engine(room);
  if (!e.hasPendingHunterShot()) {
    checkWinOrContinue(room, () => (source === "night" ? beginDiscussion(room) : beginNight(room)));
    return;
  }

  clearRoomTimers(room.code);
  e.beginHunterShot(HUNTER_SHOT_MS);
  scheduleHunterBot(room);
  armStep(room, { name: "timeoutHunterShot" }, HUNTER_SHOT_MS + 500);
  sync(room);
}

export function submitHunterShot(room: Room, playerId: string, targetId: string | null): void {
  engine(room).submitHunterShot(playerId, targetId);
  sync(room);
  armStep(room, { name: "finishHunterShot" }, 800);
}

function timeoutHunterShot(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "HUNTER_SHOT") return;
  const reaction = room.engine.state.hunterReaction;
  if (!reaction || reaction.resolved) return;

  room.engine.submitHunterShot(reaction.hunterId, null);
  sync(room);
  finishHunterShot(room);
}

function finishHunterShot(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "HUNTER_SHOT") return;
  const reaction = room.engine.state.hunterReaction;
  if (!reaction?.resolved) return;

  clearRoomTimers(room.code);
  const source = room.engine.completeHunterReaction();
  checkWinOrContinue(room, () => (source === "night" ? beginDiscussion(room) : beginNight(room)));
}

export function resetToLobby(room: Room): void {
  clearRoomTimers(room.code);
  clearPendingStep(room);
  cancelDiscussionScheduler(room.code);
  clearDiscussionSkipVotes(room.code);
  // Thư CHƯA mở bị xoá cùng lúc: chủ nhân nó đã sống tới cuối ván, và một bản
  // nháp không có ai chết để mở ra thì không có lý do gì để sống tiếp.
  clearLastLetters(room);
  /*
   * Add-on cũng TẮT theo, và đây là một quyết định về mặc định chứ không phải
   * dọn dẹp.
   *
   * "Phong thư sau cùng" là lựa chọn của MỘT ván, không phải thiết lập dính vào
   * phòng. Để nó bật sẵn thì ván sau chạy với một luật thêm mà không ai vừa
   * đồng ý - và cũng không ai nhìn lại khu Add-on để phát hiện, vì chính họ đã
   * bật nó ở ván trước. Host bật lại là đúng một cú bấm; còn bật hộ thì không
   * có cú bấm nào để rút lại.
   *
   * Chỉ đụng đúng trường này. Bộ bài, thời gian từng pha, voice và chế độ đều
   * là thiết lập của PHÒNG và phải sống qua mọi lần chơi lại.
   */
  room.config.lastLetter = false;
  room.engine = null;
  room.status = "LOBBY";
  for (const m of room.members) m.ready = false;
  pendingEndFinalVote.delete(room.code);
  clearBotSession(room.code);
  resetBotBudget(room.code);
  // Về lobby là xoá hẳn room voice: không ai được ngồi lại với quyền của ván
  // cũ. CỐ Ý không làm điều này ở GAME_OVER - lúc lật bài xong là lúc đáng nói
  // nhất cả ván, nên room vẫn sống tới khi phòng thật sự reset.
  void destroyVoiceRoom(room.code, "về lại phòng chờ");
  sync(room);
}

function onGameOver(room: Room): void {
  cancelDiscussionScheduler(room.code);
  // Ván đã xong thì không còn bước nào được chờ. Không xoá thì một bước cũ còn
  // nằm trong hàng đợi có thể hồi sinh máy trạng thái sau màn kết thúc.
  clearPendingStep(room);

  // Không await: một lần ghi DB chậm không được giữ cả bàn ở màn kết thúc.
  // `writeGameResultOnce` tự chịu trách nhiệm "đúng một lần", kể cả khi lời
  // gọi này và một lời gọi từ đường khôi phục cùng chạy.
  void writeGameResultOnce(room);

  clearBotSession(room.code);
  resetBotBudget(room.code);

  sync(room);
}

// ---- Bot ----

export function scheduleHunterBot(room: Room): void {
  const scheduledEngine = room.engine;
  if (!scheduledEngine || scheduledEngine.state.phase !== "HUNTER_SHOT") return;
  const scheduledReaction = scheduledEngine.state.hunterReaction;
  if (!scheduledReaction || scheduledReaction.resolved) return;

  const member = room.members.find(
    (candidate) => candidate.playerId === scheduledReaction.hunterId && isBotControlled(candidate),
  );
  if (!member) return;

  const initialView = buildSnapshot(room, member.playerId);
  if (!initialView.hunterShot?.canAct) return;

  const stillPending = (): boolean =>
    room.engine === scheduledEngine &&
    scheduledEngine.state.phase === "HUNTER_SHOT" &&
    scheduledEngine.state.hunterReaction === scheduledReaction &&
    scheduledReaction.hunterId === member.playerId &&
    // Người chơi quay lại trước mốc hẹn thì trả ghế cho họ; `member` là tham
    // chiếu sống nên `connected` ở đây luôn là hiện tại.
    isBotControlled(member) &&
    !scheduledReaction.resolved;

  // Một mốc duy nhất. Lõi chạy đồng bộ nên không có kết quả về muộn để phải
  // chạy đua với hạn chót, và `null` (không bắn) là một quyết định thật chứ
  // không phải một lượt hỏng cần ai đó đánh bừa thay.
  const delay = Math.max(0, Math.min(HUNTER_SHOT_MS - HUNTER_BOT_DEADLINE_BUFFER_MS, 2_000));

  setRoomTimer(room.code, () => {
    try {
      if (!stillPending()) return;

      const runtime = botSessionFor(room).runtimeFor(member.playerId);
      const context = buildBotDecisionContext(room, member.playerId);
      runtime.observe(context);

      const decision = runtime.decideHunterShot(context);
      submitHunterShot(room, member.playerId, decision.targetId);
    } catch {
      /* state đổi sát lúc nộp thì để timeout toàn cục xử lý như một lượt skip */
    }
  }, delay);
}

/**
 * Claim của BOT trong Ngày Sự Thật.
 *
 * Trước đây `submitDayOfTruthClaim` chỉ có một chỗ gọi là handler socket, nên
 * sự kiện này không tồn tại với BOT: banner hiện lên, bảng claim rỗng, và cả
 * làng nhìn nhau. Đây là sự kiện DUY NHẤT đòi một thao tác chủ động, nên nó là
 * sự kiện duy nhất cần một scheduler riêng.
 *
 * Quyết định khai gì là của lõi deterministic, giống mọi nước đi khác: nhà cung
 * cấp không được đụng vào.
 */
export function scheduleDayOfTruthBots(room: Room): void {
  const scheduledEngine = room.engine;
  if (!scheduledEngine) return;
  // Ngoài sự kiện thì engine ném ở mọi lời gọi; xếp lịch mù biến mỗi ngày
  // thường thành một chuỗi ngoại lệ bị nuốt.
  if (scheduledEngine.state.activeEvent?.id !== "DAY_OF_TRUTH") return;

  const session = botSessionFor(room);
  const scheduledRound = scheduledEngine.state.round;

  const stillOpen = (): boolean =>
    room.engine === scheduledEngine &&
    scheduledEngine.state.phase === "DAY_DISCUSSION" &&
    scheduledEngine.state.round === scheduledRound &&
    scheduledEngine.state.activeEvent?.id === "DAY_OF_TRUTH";

  // Kẹp theo cửa sổ CÒN LẠI chứ không theo `discussionSeconds`: Lệnh Giới
  // Nghiêm cắt đôi pha, và một hằng số cứng sẽ xếp claim ra ngoài pha.
  const remaining = Math.max(0, (scheduledEngine.state.phaseEndsAt ?? Date.now()) - Date.now());
  const spread = Math.min(DAY_OF_TRUTH_SPREAD_MS, Math.floor(remaining * 0.4));

  for (const member of room.members) {
    if (!member.isBot) continue;
    // Người chết không claim được - engine ném - và người thật tự bấm lấy.
    const player = scheduledEngine.state.players.find((p) => p.id === member.playerId);
    if (!player?.alive) continue;

    const rng = session.rngFor(member.playerId, "day-of-truth");
    const delay = Math.floor(rng() * spread);

    setRoomTimer(room.code, () => {
      try {
        if (!stillOpen()) return;

        const runtime = session.runtimeFor(member.playerId);
        const context = buildBotDecisionContext(room, member.playerId);
        runtime.observe(context);

        scheduledEngine.submitDayOfTruthClaim(
          member.playerId,
          runtime.decideRoleClaim(context).role,
        );
        sync(room);
      } catch {
        /* state đổi sát lúc nộp thì bỏ lượt claim, không kéo sập tiến trình */
      }
    }, delay);
  }
}

/**
 * Phong thư sau cùng của BOT.
 *
 * Đi qua ĐÚNG hàm `submitLastLetter` mà người thật dùng, nên mọi hàng rào -
 * add-on đã bật, còn sống, đúng pha, trần độ dài - chỉ có một bản. Hai đường
 * riêng cho người và BOT sẽ trôi lệch, và ở đây trôi lệch nghĩa là một con BOT
 * viết được thư trong lúc người thật thì không.
 *
 * Nội dung do lõi tất định quyết (`decideLastLetter`), và cố ý KHÔNG đi qua
 * `renderBotSpeech`: một câu do nhà cung cấp viết ra thì không ai kiểm được nó
 * có nhắc tới thứ ngoài quyền của vai hay không, mà lá thư thì mở ra là cả làng
 * đọc và không rút lại được.
 *
 * KHÔNG `sync` sau khi lưu: bản nháp chỉ nằm trong snapshot của chính chủ, mà
 * chủ ở đây là một con BOT không có socket nào. Phát cho cả phòng chỉ để dựng
 * mười lăm snapshot y hệt bản cũ.
 */
export function scheduleLastLetterBots(room: Room): void {
  const scheduledEngine = room.engine;
  if (!scheduledEngine) return;
  if (!lastLetterEnabled(room)) return;
  if (scheduledEngine.state.phase !== "DAY_DISCUSSION") return;

  const session = botSessionFor(room);
  const scheduledRound = scheduledEngine.state.round;

  const stillOpen = (): boolean =>
    room.engine === scheduledEngine &&
    scheduledEngine.state.phase === "DAY_DISCUSSION" &&
    scheduledEngine.state.round === scheduledRound;

  const remaining = Math.max(0, (scheduledEngine.state.phaseEndsAt ?? Date.now()) - Date.now());
  const spread = Math.min(LAST_LETTER_SPREAD_MS, Math.floor(remaining * 0.4));

  for (const member of room.members) {
    if (!member.isBot) continue;
    // Người chết không viết được - `submitLastLetter` cũng từ chối - nhưng chặn
    // ở đây thì không phải tiêu một lượt dựng context cho một lượt chắc chắn hỏng.
    const player = scheduledEngine.state.players.find((p) => p.id === member.playerId);
    if (!player?.alive) continue;

    const delay = Math.floor(session.rngFor(member.playerId, "last-letter")() * spread);

    setRoomTimer(room.code, () => {
      try {
        if (!stillOpen()) return;

        const runtime = session.runtimeFor(member.playerId);
        const context = buildBotDecisionContext(room, member.playerId);
        runtime.observe(context);

        // Im lặng là một quyết định thật: không nghi ai thì không để lại gì.
        const letter = runtime.decideLastLetter(context);
        if (letter.text === null) return;

        submitLastLetter(room, member.playerId, letter.text);
        void persistRoom(room);
      } catch {
        /* state đổi sát lúc lưu thì bỏ lượt viết, không kéo sập tiến trình */
      }
    }, delay);
  }
}

/**
 * Đăng một lời nhắn ẩn danh vào kênh ban ngày.
 *
 * Tác giả là hằng số `GHOST_AUTHOR_ID`, không phải id thật. Đây không phải một
 * chi tiết hiển thị: payload chat được phát cho cả phòng, nên một id thật nằm
 * trong đó là đã lộ, bất kể client vẽ ra sao.
 */
function postGhostChat(room: Room, text: string): void {
  const message = {
    id: newId(),
    channel: "day",
    playerId: GHOST_AUTHOR_ID,
    playerName: GHOST_AUTHOR_NAME,
    text,
    at: Date.now(),
  };
  pushChat(room, message);
  emitToPlayers(dayRecipients(room), SERVER_EVENTS.CHAT_NEW, message);
  void persistRoom(room);
}

/**
 * Lời nhắn của linh hồn - đường DUY NHẤT, dùng chung cho người thật và BOT.
 *
 * Engine gác luật và tiêu lượt; nếu nó ném thì không có gì được đăng. Hai đường
 * riêng cho người và BOT sẽ trôi lệch, và ở đây "trôi lệch" nghĩa là một cú lộ
 * danh tính không rút lại được.
 */
export function submitGhostMessage(room: Room, playerId: string, text: string): void {
  const trimmed = engine(room).submitDeadMessage(playerId, text);
  postGhostChat(room, trimmed);
  sync(room);
}

/**
 * Lời nhắn khi linh hồn được chọn là một BOT.
 *
 * Lõi chốt nói VỀ AI (`decideGhostWhisper`, chỉ đọc nghi ngờ công khai); nhà
 * cung cấp chỉ diễn đạt, và trần 120 ký tự được ép ngay ở tầng render để engine
 * không phải từ chối - một cú từ chối ở đây là mất trắng lượt duy nhất của ván.
 */
export function scheduleDeadCanSpeakBot(room: Room): void {
  const scheduledEngine = room.engine;
  if (!scheduledEngine) return;
  if (scheduledEngine.state.activeEvent?.id !== "DEAD_CAN_SPEAK") return;

  const ghostId = scheduledEngine.state.deadCanSpeakChosenId;
  if (!ghostId) return;
  const member = room.members.find((candidate) => candidate.playerId === ghostId);
  // Người thật tự bấm lấy; scheduler không được cướp lượt của họ.
  if (!member?.isBot) return;

  const scheduledRound = scheduledEngine.state.round;
  const stillOpen = (): boolean =>
    room.engine === scheduledEngine &&
    scheduledEngine.state.phase === "DAY_DISCUSSION" &&
    scheduledEngine.state.round === scheduledRound &&
    scheduledEngine.state.activeEvent?.id === "DEAD_CAN_SPEAK" &&
    !scheduledEngine.state.deadCanSpeakUsed;

  const session = botSessionFor(room);
  const remaining = Math.max(0, (scheduledEngine.state.phaseEndsAt ?? Date.now()) - Date.now());
  const spread = Math.min(GHOST_WHISPER_SPREAD_MS, Math.floor(remaining * 0.5));
  const delay = Math.floor(session.rngFor(ghostId, "ghost-whisper")() * spread);

  setRoomTimer(room.code, () => {
    void (async () => {
      try {
        if (!stillOpen()) return;

        const runtime = session.runtimeFor(ghostId);
        const context = buildBotDecisionContext(room, ghostId);
        runtime.observe(context);

        const whisper = runtime.decideGhostWhisper(context);
        // Im lặng là một quyết định thật: không nghi ai thì không chỉ bừa.
        if (!whisper.targetId) return;

        const request = toSpeechRequest(room, member, context, {
          kind: "ACCUSE",
          targetId: whisper.targetId,
          confidence: 0.5,
          evidence: [],
          tone: "TENSE",
        });
        const rendered = await renderBotSpeech(request, botBrain(), DEAD_MESSAGE_MAX_LENGTH);
        const text = stripSelfNaming(rendered.text, member.name) ?? speechTemplate(request);
        if (!text) return;

        // Kết quả về muộn không được lọt sang pha sau.
        if (!stillOpen()) return;
        submitGhostMessage(room, ghostId, text.slice(0, DEAD_MESSAGE_MAX_LENGTH));
      } catch {
        /* lượt của ma hỏng thì thôi, không kéo sập tiến trình */
      }
    })();
  }, delay);
}

/**
 * Bỏ câu nào tự xưng tên người nói.
 *
 * Prompt cố tình mang tên BOT vào để nó xưng hô tự nhiên, và ở mọi lượt nói
 * khác điều đó vô hại. Ở đây nó phá đúng thứ sự kiện dựa vào, nên câu bị trả
 * về `null` và chỗ gọi rơi sang bảng mẫu - bảng mẫu không bao giờ nhắc tên
 * người nói, chỉ nhắc tên mục tiêu.
 */
function stripSelfNaming(text: string | null, speakerName: string): string | null {
  if (!text) return null;
  return text.toLowerCase().includes(speakerName.toLowerCase()) ? null : text;
}

function applyNight(room: Room, botId: string, decision: NightDecision | null): void {
  if (!decision) return;
  try {
    if (decision.secondaryTargetId !== undefined) {
      engine(room).submitNightAction(botId, decision.action, decision.targetId, decision.secondaryTargetId);
    } else {
      engine(room).submitNightAction(botId, decision.action, decision.targetId);
    }
    // Trong `try` và sau lời gọi: chỉ một lần nộp THÀNH CÔNG mới được rút ngắn
    // đêm. Một lượt bị engine từ chối không đổi gì để mà kiểm lại.
    maybeLockWolvesEarly(room);
  } catch {
    /* engine là trọng tài cuối; sai luật thì bot bỏ lượt */
  }
}

/**
 * Hành động đêm, quyết bởi lõi deterministic.
 *
 * Không còn `await` nào: lõi chạy đồng bộ, nên không có kết quả về muộn, không
 * cần cờ `settled`, và không cần một hạn chót để cứu một lời gọi mạng treo.
 * Toàn bộ khối `pending`/`earliest`/`randomBrain` trước đây tồn tại chỉ để
 * quản lý độ trễ và lỗi của nhà cung cấp.
 *
 * Vẫn giữ độ trễ rải đều để người thật không thấy cả bầy bot hành động cùng
 * một khoảnh khắc, nhưng độ trễ gieo từ RNG của session thay vì `Math.random`.
 *
 * Độ trễ rải theo thời gian CÒN LẠI của pha, không theo `nightSeconds`. Đêm có
 * hai chặng với hai hạn chót khác nhau: chặng Sói dài `nightSeconds`, còn chặng
 * Phù Thuỷ chỉ dài `WITCH_WINDOW_MS`. Tính theo `nightSeconds` thì với cấu hình
 * đêm dài (schema cho tới 120s) mốc hẹn của Phù Thuỷ rơi ra SAU `endNight`, và
 * cô ta mất trắng lượt dù lõi đã quyết đúng. `phaseEndsAt` đã được `extendPhase`
 * dời về đúng hạn chót của chặng đang mở, nên nó là nguồn duy nhất đúng cho cả
 * hai chặng.
 */
export function scheduleNightBots(room: Room): void {
  const session = botSessionFor(room);
  const now = Date.now();
  const remainingMs = Math.max(
    0,
    (room.engine?.state.phaseEndsAt ?? now + room.config.nightSeconds * 1_000) - now,
  );

  for (const member of room.members) {
    if (!isBotControlled(member)) continue;

    const view = buildSnapshot(room, member.playerId);
    // canAct đã loại Phù Thuỷ ở chặng một và loại Sói ở chặng hai; cờ acted
    // chặn nốt việc gọi lại này hỏi một bot đã hành động rồi.
    if (!view.night?.canAct || view.night.acted) continue;

    const rng = session.rngFor(member.playerId, "night-schedule");
    const delay = Math.floor((0.1 + rng() * 0.2) * remainingMs);

    setRoomTimer(room.code, () => {
      try {
        if (!room.engine || room.engine.state.phase !== "NIGHT") return;
        // Người chơi quay lại trước khi mốc hẹn nổ thì ghế trả về cho họ:
        // `member` là tham chiếu sống, ws.ts cập nhật `connected` ngay khi
        // socket nối lại.
        if (!isBotControlled(member)) return;

        const runtime = session.runtimeFor(member.playerId);
        const context = buildBotDecisionContext(room, member.playerId);
        runtime.observe(context);

        const decision = runtime.decideNight(context);
        if (!decision) return;

        applyNight(room, member.playerId, {
          action: decision.action,
          targetId: decision.targetId,
          // Thám Tử so hai người; bỏ trường này thì engine ném "cần đủ 2 người"
          // và lượt điều tra mất trắng.
          secondaryTargetId: decision.secondaryTargetId,
        });
      } catch {
        /* lõi bot lỗi không được kéo sập cả tiến trình */
      }
    }, delay);
  }
}

/** `PublicVoteChoice` của engine sang hình dạng phiếu mà scheduler đang dùng. */
function toPlannedVote(choice: PublicVoteChoice): PlannedVote {
  return choice.type === "PLAYER"
    ? { type: "PLAYER", targetId: choice.targetId }
    : { type: "NO_ELIMINATION" };
}

/**
 * Gói một ý định đã chốt thành yêu cầu diễn đạt.
 *
 * Chỉ mang tên mục tiêu và tóm tắt bằng chứng: không snapshot, không bảng role,
 * không danh sách mục tiêu hợp lệ - nhà cung cấp không có gì để đổi.
 */
export function toSpeechRequest(
  room: Room,
  member: { playerId: string; name: string },
  context: BotDecisionContext,
  speech: BotSpeechIntention,
): SpeechRequest {
  const nameOf = (playerId: string): string | undefined =>
    context.knowledge.players.find((player) => player.id === playerId)?.name;

  const runtime = botSessionFor(room).runtimeFor(member.playerId);
  const limits = runtime.weights.conversation;

  const quoted = speech.replyToMessageId
    ? context.visibleChat.find((message) => message.id === speech.replyToMessageId)
    : undefined;

  // Cửa sổ chat, KHÔNG phải cả ván. Trước Phase 4 chỗ này trải phẳng toàn bộ
  // lịch sử phát ngôn, nên prompt phình theo độ dài ván và danh sách "đừng lặp
  // lại" dài tới mức không còn nghĩa gì.
  const window = context.visibleChat.slice(-limits.promptChatWindow);

  return {
    roomCode: room.code,
    speaker: { id: member.playerId, name: member.name },
    style: runtime.style,
    styleDescription: describeSpeechStyle(runtime.style),
    intention: speech,
    evidence: speech.evidence.map((item) => ({
      sourceId: item.sourceId,
      summary: item.summary,
    })),
    targetName: speech.targetId ? nameOf(speech.targetId) ?? null : null,
    replyTo:
      quoted && speech.replyToMessageId
        ? {
            messageId: speech.replyToMessageId,
            actorName: nameOf(quoted.actorId) ?? "một người",
            text: quoted.text,
          }
        : null,
    recentOwnLines: recentOwnLines(room, member.playerId, limits.promptRecentOwnLines),
    chatWindow: window.map((message) => ({
      actorName: nameOf(message.actorId) ?? "một người",
      text: message.text,
      isSelf: message.actorId === member.playerId,
    })),
    avoidOpenings: recentOpenings(runtime.state, limits.promptRecentOwnLines),
    recentSpeechSourceIds: recentSpeechSourceIds(
      runtime.state,
      limits.promptRecentOwnLines,
    ),
    seq: runtime.state.speechSequence,
    round: context.knowledge.round,
    players: context.knowledge.players,
    // Chỉ lượt bào chữa mới cần trường này; mọi chỗ gọi khác của hàm này đều là
    // lời nói ban ngày bình thường. `scheduleDefenseBot` tự ghi đè lại.
    defense: null,
  };
}

/**
 * Vài câu gần nhất mà chính BOT đã phát.
 *
 * Đọc từ `room.chatLog` chứ không từ `BotBrainState`: state cố tình chỉ giữ vân
 * tay, không giữ chữ. Prompt thì cần chữ thật để mô hình biết mình vừa nói gì
 * mà tránh diễn đạt lại.
 */
function recentOwnLines(room: Room, botId: string, count: number): string[] {
  return room.chatLog
    .filter((message) => message.playerId === botId)
    .slice(-count)
    .map((message) => message.text);
}

/**
 * Mở phiên thảo luận cho BOT.
 *
 * Toàn bộ lịch, hạn mức và luật huỷ nằm trong `discussion-scheduler`. Ở đây chỉ
 * còn một lời gọi, đúng như mọi `schedule*Bots` khác trong file này.
 */
export function scheduleDayBots(room: Room): void {
  runDiscussionScheduler(room);
}

/**
 * Bot bị cáo tự bào chữa. Tối đa một lượt gọi mỗi ngày, và chỉ khi bị cáo là
 * bot: người thật tự gõ trong khung chat.
 */
function scheduleDefenseBot(room: Room, accusedId: string): void {
  const member = room.members.find((m) => m.playerId === accusedId && m.isBot);
  if (!member) return;

  const scheduledEngine = room.engine;
  if (!scheduledEngine) return;
  const scheduledRound = scheduledEngine.state.round;

  const stillDefending = (): boolean =>
    room.engine === scheduledEngine &&
    scheduledEngine.state.phase === "DEFENSE" &&
    scheduledEngine.state.round === scheduledRound &&
    scheduledEngine.state.trial?.accusedId === accusedId;

  const view = buildSnapshot(room, member.playerId);
  if (!view.trial?.canSpeak) return;

  void (async () => {
    try {
      const runtime = botSessionFor(room).runtimeFor(member.playerId);
      const context = buildBotDecisionContext(room, member.playerId);
      runtime.observe(context);

      /*
       * TOÀN BỘ lượt bào chữa do lõi quyết, kể cả đường lui.
       *
       * Bản trước gọi `decideDefenseClaim` rồi tự dựng một ý định DISAGREE khi
       * lõi trả `null`. Đường lui viết ở đây trông vô hại - hình dạng của nó cố
       * định - nhưng nó là một quyết định gameplay đặt ở tầng IO, và tầng này
       * KHÔNG nhìn thấy vai. Hệ quả: mọi bị cáo đều được dựng thành một người
       * đang cố sống, kể cả Thằng Hề, vai mà sống chính là thua.
       *
       * `stance` đi cùng ý định và được chuyển thẳng xuống prompt: tầng diễn
       * đạt không được phép tự đoán bị cáo này muốn gì.
       */
      const { intention: speech, stance } = runtime.decideDefense(context);

      // Số phiếu và danh sách đồng-bị-nhắm đã công khai ở pha DEFENSE (đúng dữ
      // liệu `RoomSnapshot.players[].voteCount` cũ từng đọc) - khác hẳn vai
      // thật, thứ `roleContext` từng đưa vào prompt và đã bị bỏ hẳn.
      const votesAgainstMe = context.knowledge.currentVoteCounts.players[member.playerId] ?? 0;
      const alsoAccused = context.knowledge.players
        .filter(
          (p) =>
            p.alive &&
            p.id !== member.playerId &&
            (context.knowledge.currentVoteCounts.players[p.id] ?? 0) > 0,
        )
        .map((p) => p.name);

      const request: SpeechRequest = {
        ...toSpeechRequest(room, member, context, speech),
        defense: { votesAgainstMe, alsoAccused, stance },
      };

      // Cùng một hàm với mọi lời nói khác: cổng CLAIM_INTEGRITY và bảng mẫu dự
      // phòng áp dụng ở đây y hệt ban ngày. Không còn `randomBrain.decideDefense`
      // ("não chắc chắn trả lời được") - bảng mẫu tất định của `renderBotSpeech`
      // đã phủ đúng chỗ trống đó, kể cả khi mọi nhà cung cấp hỏng.
      const rendered = await renderBotSpeech(request);

      // Kết quả về muộn không được lọt sang pha sau.
      if (!stillDefending()) return;
      if (!rendered.text) return;

      const resolved = resolveChat(room, member.playerId);
      if (!resolved.ok) return;
      const message = {
        id: newId(),
        channel: resolved.channel,
        playerId: member.playerId,
        playerName: member.name,
        text: rendered.text,
        at: Date.now(),
      };
      pushChat(room, message);
      emitToPlayers(resolved.recipients, SERVER_EVENTS.CHAT_NEW, message);
      void persistRoom(room);

      // Vào sổ SAU khi câu đã thật sự nằm trong log, không sớm hơn (cùng lý do
      // discussion-scheduler.ts ghi ở đây). Nếu speech là một claim, việc này
      // chốt `state.myClaim` - thiếu bước này, bị cáo có thể bị hỏi khai lần
      // hai ở một phiên xử sau trong cùng ván.
      runtime.recordSpeech(speech, context.knowledge.round, rendered.text);
    } catch {
      /* não bot lỗi (mạng, JSON hỏng,...) không được kéo sập cả tiến trình */
    }
  })();
}

/**
 * Phiếu Treo/Tha của bot, quyết bởi lõi deterministic.
 *
 * Vẫn có độ trễ, nhưng lý do đã đổi: trước đây nó chờ nhà cung cấp trả lời, giờ
 * nó chỉ để người thật kịp đọc lời biện hộ trước khi bảng phiếu nhảy số.
 */
export function scheduleFinalVoteBots(room: Room): void {
  const scheduledEngine = room.engine;
  if (!scheduledEngine) return;
  const accusedId = scheduledEngine.state.trial?.accusedId;
  if (!accusedId) return;

  const session = botSessionFor(room);
  const windowMs = room.config.finalVoteSeconds * 1_000;
  const deadlineMs = Math.max(0, windowMs - FINAL_VOTE_BOT_DEADLINE_BUFFER_MS);

  for (const member of room.members) {
    if (!isBotControlled(member)) continue;
    const view = buildSnapshot(room, member.playerId);
    if (!view.trial?.canVote) continue;

    const rng = session.rngFor(member.playerId, "final-vote-schedule");
    const delay = Math.min(deadlineMs, Math.floor((0.15 + rng() * 0.25) * windowMs));

    setRoomTimer(room.code, () => {
      try {
        if (!room.engine || room.engine.state.phase !== "FINAL_VOTE") return;
        // Người chơi quay lại trước khi mốc hẹn nổ thì ghế trả về cho họ:
        // `member` là tham chiếu sống, ws.ts cập nhật `connected` ngay khi
        // socket nối lại.
        if (!isBotControlled(member)) return;

        const runtime = session.runtimeFor(member.playerId);
        const context = buildBotDecisionContext(room, member.playerId);
        runtime.observe(context);

        room.engine.submitFinalVote(member.playerId, runtime.decideFinalVote(context).guilty);
        // Phiếu bot không đi qua handler socket nào nên không tự được broadcast:
        // thiếu sync thì bộ đếm Treo/Tha đứng yên tới tận lúc pha kết thúc.
        sync(room);
        maybeEndFinalVoteEarly(room);
      } catch {
        /* state đổi sát lúc nộp */
      }
    }, delay);
  }
}

/** Phiếu do lõi deterministic chốt ngay tại thời điểm gọi. */
function deterministicVote(room: Room, botId: string): PlannedVote | null {
  try {
    const runtime = botSessionFor(room).runtimeFor(botId);
    const context = buildBotDecisionContext(room, botId);
    runtime.observe(context);
    return toPlannedVote(runtime.decideVote(context).choice);
  } catch {
    return null;
  }
}

/**
 * Lá phiếu đề cử mà chính bot đã nộp trong vòng này.
 *
 * Đọc từ recap công khai chứ không từ một map phiếu "đã định": recap là thứ
 * engine thật sự đã tính, nên nó không bao giờ lệch với bảng phiếu người chơi
 * vừa nhìn thấy. `undefined` nghĩa là vòng đề cử chưa chốt hoặc bot không bỏ
 * phiếu nào.
 */
function nominationBallotFor(room: Room, botId: string): PlannedVote | undefined {
  const st = room.engine?.state;
  if (!st) return undefined;

  const recap = [...st.dayVoteHistory].reverse().find((item) => item.round === st.round);
  const ballot = recap?.finalBallots.find((item) => item.voterId === botId);
  if (!ballot) return undefined;

  return ballot.choice.type === "PLAYER"
    ? { type: "PLAYER", targetId: ballot.choice.targetId }
    : { type: "NO_ELIMINATION" };
}

/**
 * Ba mốc quyết định trong khung bỏ phiếu, dạng [đầu khung, biên độ].
 *
 * Bot bỏ phiếu sớm để bảng phiếu có thứ cho người thật đọc và phản ứng, soi lại
 * khi bảng đã đông, rồi chốt sát giờ. Một mốc duy nhất thì phiếu bot hoặc quá
 * sớm để biết gì, hoặc quá muộn để ai kịp phản ứng.
 */
const VOTE_CHECKPOINTS: ReadonlyArray<readonly [number, number]> = [
  [0.12, 0.12],
  [0.52, 0.08],
  [0.84, 0.08],
];

/**
 * Xếp lịch bỏ phiếu cho bot.
 *
 * Mốc gieo từ RNG của session nên cùng một ván luôn phát lại được; không còn
 * `Math.random()` và không còn đường lui ngẫu nhiên. Ở mỗi mốc, lõi deterministic
 * được hỏi lại với ngữ cảnh mới nhất, nên bot đổi phiếu đúng khi và chỉ khi nó
 * thật sự đổi ý.
 */
export function scheduleVoteBots(room: Room): void {
  const session = botSessionFor(room);
  const window = room.config.voteSeconds * 1_000;

  for (const member of room.members) {
    if (!isBotControlled(member)) continue;

    const rng = session.rngFor(member.playerId, "vote-schedule");
    const delays = VOTE_CHECKPOINTS.map(([start, spread]) =>
      Math.floor((start + rng() * spread) * window),
    );

    for (const delay of delays) {
      setRoomTimer(room.code, () => {
        try {
          if (!room.engine || room.engine.state.phase !== "VOTING") return;
          if (!isBotControlled(member)) return;

          const vote = deterministicVote(room, member.playerId);
          if (!vote) return;

          // Engine coi lá trùng là no-op, nhưng chặn ở đây thì mốc "không đổi ý"
          // cũng không phát broadcast thừa cho cả phòng.
          const target = engineVote(vote);
          const previous = room.engine.state.votes[member.playerId];
          if (previous !== undefined && previous === target) return;

          room.engine.submitVote(member.playerId, target);
          // Phiếu của người thật được broadcast ngay trong handler socket, còn
          // phiếu bot thì không: client giữ nguyên snapshot cũ nên mọi voteCount
          // đứng yên ở 0 tới tận lúc pha kết thúc. Trong phòng toàn bot, bộ đếm
          // "Không treo ai (x phiếu)" vì thế trông như hỏng.
          sync(room);
        } catch {
          /* lõi bot lỗi không được kéo sập cả tiến trình */
        }
      }, delay);
    }
  }
}

/**
 * Bảng xử lý cho `steps.ts`.
 *
 * Đăng ký ở cấp module (chạy đúng một lần lúc nạp) thay vì để `steps.ts` import
 * ngược lại file này - chiều import đó sẽ tạo vòng, vì file này đã import
 * `steps.ts` để hẹn bước.
 */
registerStepHandlers({
  beginNight: (room) => beginNight(room),
  lockWolves: (room) => lockWolves(room),
  endNight: (room) => endNight(room),
  beginVoting: (room) => beginVoting(room),
  endVoting: (room) => endVoting(room),
  beginFinalVote: (room) => beginFinalVote(room),
  endFinalVote: (room) => endFinalVote(room),
  afterDeathResult: (room, step) => continueAfterDeathResult(room, step.source ?? "night"),
  timeoutHunterShot: (room) => timeoutHunterShot(room),
  finishHunterShot: (room) => finishHunterShot(room),
});
