import { GameEngine } from "@masoi/game-engine";
import {
  GHOST_AUTHOR_ID,
  GHOST_AUTHOR_NAME,
  RESULT_MS,
  ROLE_REVEAL_MS,
  SERVER_EVENTS,
  discussionSecondsFor,
} from "@masoi/shared";
import type { Room } from "../rooms/store";
import { clearRoomTimers, persistRoom, setRoomTimer } from "../rooms/store";
import { armStep, clearPendingStep, registerStepHandlers } from "./steps";
import { writeGameResultOnce } from "./game-result";
import { resetMatchChat } from "./match-chat";
import {
  discardBotSpeechLog,
  settleBotQuestions,
  settleBotQuestionsIfLeavingDiscussion,
  startBotSpeechLog,
} from "./bot-speech-log";
import { broadcastRoom, emitToPlayers } from "../rooms/broadcast";
import { syncVoicePermissions } from "../voice/service";
import { dayRecipients, pushChat } from "../rooms/snapshot";
import { resetBotBudget } from "../bots";
import { clearBotSession, startBotSession } from "../bots/session-registry";
import { newId } from "../util";
import { pendingEndFinalVote } from "./bot-room-state";
import { cancelDiscussionScheduler, runDefenseScheduler } from "./discussion-scheduler";
import {
  DISCONNECT_GRACE_MS,
  clearDiscussionSkipVotes,
  hasUnanimousDiscussionSkip,
  updateDiscussionSkipVote,
} from "./discussion-skip";
import { clearLastLetters, openLastLettersForDeaths } from "./last-letter";
import {
  scheduleDayBots,
  scheduleDeadCanSpeakBot,
  scheduleFinalVoteBots,
  scheduleHunterBot,
  scheduleLastLetterBots,
  scheduleNightBots,
  scheduleVoteBots,
} from "./bot-scheduler";

export const HUNTER_SHOT_MS = 15_000;
/** Cửa sổ riêng cho Phù Thuỷ sau khi bầy Sói chốt nạn nhân. */
const WITCH_WINDOW_MS = 15_000;

function engine(room: Room): GameEngine {
  if (!room.engine) throw new Error("Chưa có trận đấu");
  return room.engine;
}

export function sync(room: Room): void {
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
  const winner = e.settleAndCheckWin();
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
  startBotSpeechLog(room);
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
  // Phải đứng trước `startNight`: sau đó pha đã là NIGHT và phép kiểm pha
  // trong hàm này không còn biết mình vừa rời pha nào.
  settleBotQuestionsIfLeavingDiscussion(room);
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
  const discussionMs = discussionSecondsFor(room.config.discussionSeconds, e.alivePlayers().length) * 1000;
  const event = e.startDay(discussionMs);
  const durationMs = (e.state.phaseEndsAt ?? (Date.now() + discussionMs)) - Date.now();

  if (event?.id === "AMNESTY_DAY") {
    // Ngày Hòa Hoãn: sau thảo luận chuyển thẳng sang Đêm
    armStep(room, { name: "beginNight" }, durationMs + 500);
  } else {
    armStep(room, { name: "beginVoting" }, durationMs + 500);
  }
  scheduleDayBots(room);
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
  // Đúng vị trí chốt của self-play: sau lượt bỏ phiếu, ngay trước khi đề cử
  // được chốt. Chốt sớm hơn (lúc rời thảo luận) thì câu hỏi hỏi cuối thảo luận
  // ra UNDETERMINED ở đây mà NO_TURN ở self-play.
  settleBotQuestions(room);
  const outcome = engine(room).resolveNomination(defenseMs);
  sync(room);

  if (outcome.kind === "NONE") {
    armStep(room, { name: "afterDeathResult", source: "vote" }, RESULT_MS);
    return;
  }

  // resolveNomination đã đặt pha và hạn chót; ở đây chỉ còn xếp lịch.
  runDefenseScheduler(room, outcome.accusedId);
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
  discardBotSpeechLog(room);
  room.engine = null;
  room.status = "LOBBY";
  for (const m of room.members) m.ready = false;
  pendingEndFinalVote.delete(room.code);
  clearBotSession(room.code);
  resetBotBudget(room.code);
  /*
   * Room voice sống theo vòng đời PHÒNG GAME, không theo vòng đời một ván.
   *
   * Ở đây từng có `destroyVoiceRoom`, với lý do "không ai được ngồi lại với
   * quyền của ván cũ". Lý do đó không đứng vững: `sync()` ngay dưới đây đồng bộ
   * quyền theo pha MỚI, mà pha mới là LOBBY - nơi ai cũng được nói. Nó phá kênh
   * thoại của cả bàn để tới đúng cái đích nó vốn đã ở.
   *
   * Cái giá thì có thật: `deleteRoom` ngắt mọi participant, nên bấm "Chơi lại"
   * là cả bàn mất tiếng giữa câu và từng người phải tự bấm "Bật mic" lần nữa.
   * Room chỉ bị xoá ở hai lối ra mà phòng game thật sự hết tồn tại: host tắt
   * voice (`rooms/service.ts`) và phòng bị xoá (`rooms/store.ts`).
   */
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
