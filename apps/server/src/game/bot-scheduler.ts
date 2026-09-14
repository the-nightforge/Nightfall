/**
 * Lịch hẹn cho BOT ở từng pha. Tách khỏi `machine.ts` để file đó chỉ còn luồng
 * pha; mọi lượt nộp của BOT vẫn đi qua đúng các hàm công khai của `machine.ts`.
 */
import type { BotDecisionContext, BotSpeechIntention } from "@masoi/game-engine";
import { describeSpeechStyle, recentOpenings, recentSpeechSourceIds } from "@masoi/game-engine";
import { DEAD_MESSAGE_MAX_LENGTH } from "@masoi/shared";
import type { PublicVoteChoice } from "@masoi/shared";
import type { Room } from "../rooms/store";
import { persistRoom, setRoomTimer } from "../rooms/store";
import { buildSnapshot } from "../rooms/snapshot";
import { botBrain } from "../bots";
import { buildBotDecisionContext } from "../bots/context";
import { renderBotSpeech, speechTemplate } from "../bots/speech-renderer";
import type { NightDecision, PlannedVote, SpeechRequest } from "../bots/types";
import { engineVote } from "../bots/targets";
import { botSessionFor } from "../bots/session-registry";
import { noteBotObserved } from "./bot-speech-log";
import { runDiscussionScheduler } from "./discussion-scheduler";
import { isBotControlled } from "./seat-control";
import { lastLetterEnabled, submitLastLetter } from "./last-letter";
import {
  HUNTER_SHOT_MS,
  maybeEndFinalVoteEarly,
  maybeLockWolvesEarly,
  submitGhostMessage,
  submitHunterShot,
  sync,
} from "./machine";

/** Chừa một giây để engine nhận fallback trước khi phase hết hạn. */
const HUNTER_BOT_DEADLINE_BUFFER_MS = 1_000;
/** Cùng mục đích, cho vòng bỏ phiếu xác nhận. */
const FINAL_VOTE_BOT_DEADLINE_BUFFER_MS = 1_500;

/**
 * Cửa sổ rải lời nhắn của linh hồn.
 *
 * Rải muộn để lời nhắn rơi vào lúc cuộc thảo luận đã có gì đó để
 * bám vào, nhưng vẫn còn đủ ngày để làng phản ứng. Cũng bị kẹp theo cửa sổ thật.
 */
const GHOST_WHISPER_SPREAD_MS = 10_000;

/**
 * Cửa sổ rải lượt viết Phong thư của BOT.
 *
 * Sớm hơn lời nhắn của linh hồn - và lý do là ở chỗ nó KHÔNG
 * hiện ra: lá thư chỉ được lưu vào sổ, không ai thấy gì cả. Rải ra chỉ để mười
 * lăm con bot không cùng ghi vào một lượt event loop, và để một bot bị chết
 * ngay sau đó vẫn kịp có thư. Vẫn bị kẹp theo cửa sổ thật vì Lệnh Giới Nghiêm
 * cắt đôi pha thảo luận.
 */
const LAST_LETTER_SPREAD_MS = 8_000;

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
      room.engine!.submitNightAction(botId, decision.action, decision.targetId, decision.secondaryTargetId);
    } else {
      room.engine!.submitNightAction(botId, decision.action, decision.targetId);
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
    // Cửa sổ mở đầu (5) rộng hơn cửa sổ câu gửi vào prompt (4): xem
    // RECENT_OPENING_WINDOW. Cùng danh sách này đi vào prompt VÀ vào cổng ở
    // speech-renderer, nên nhà cung cấp và bảng mẫu chịu chung một luật.
    avoidOpenings: recentOpenings(runtime.state),
    recentSpeechSourceIds: recentSpeechSourceIds(
      runtime.state,
      limits.promptRecentOwnLines,
    ),
    seq: runtime.state.speechSequence,
    round: context.knowledge.round,
    players: context.knowledge.players,
    // Chỉ lượt bào chữa mới cần trường này; mọi chỗ gọi khác của hàm này đều là
    // lời nói ban ngày bình thường. hàng đợi của pha xử tự ghi đè lại.
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
    noteBotObserved(room, botId, context.visibleChat, runtime.state.memories);
    return toPlannedVote(runtime.decideVote(context).choice);
  } catch {
    return null;
  }
}

/**
 * Hai mốc quyết định trong khung bỏ phiếu, dạng [đầu khung, biên độ].
 *
 * MỘT lá phiếu và MỘT lần đổi ý, không hơn. Mốc sớm để bảng phiếu có gì đó cho
 * người thật đọc và phản ứng; mốc muộn để bot chốt lại sau khi đã nghe gần hết
 * cuộc bàn.
 *
 * Mốc giữa (0.52) bị bỏ: giữ nó thì bot có hai lần đổi ý. Bỏ mốc GIỮA chứ
 * không bỏ mốc cuối - một con bot chốt phiếu ở giữa pha rồi ngồi im trong khi
 * nửa sau cuộc bàn lật hết mọi thứ là con bot điếc, và mốc cuối vốn đã bị
 * `VOTE_LOCKOUT_MS` kéo ra khỏi vùng cấm.
 */
const VOTE_CHECKPOINTS: ReadonlyArray<readonly [number, number]> = [
  [0.12, 0.12],
  [0.84, 0.08],
];

/**
 * Khoảng cuối pha mà BOT không được đụng vào lá phiếu nữa.
 *
 * Người thật đọc bảng phiếu để quyết định lá cuối của mình. Một con bot lật
 * phiếu ở giây chót đổi kết quả sau khi người ta đã hết thời gian phản ứng -
 * không phải một nước cờ hay, chỉ là một cái bẫy do lịch hẹn sinh ra.
 *
 * Hằng số chứ không phải cấu hình: chưa phòng nào cần con số khác. Mở ra
 * `RoomConfig` khi có phòng thật cần.
 */
const VOTE_LOCKOUT_MS = 5_000;

/**
 * Trần số lá một BOT được nộp trong MỘT vòng đề cử.
 *
 * Hai lá = lá đầu + một lần đổi ý, khớp đúng hai mốc ở `VOTE_CHECKPOINTS`. Trần
 * này không thừa dù lịch chỉ có hai mốc: `rescheduleBots` trong `resume.ts` cấp
 * lại trọn bộ mốc khi server sống lại giữa pha, nên một bot đã nộp đủ hai lá
 * trước khi tiến trình chết có thể được cấp thêm hai mốc nữa.
 *
 * Đếm từ `voteMutations` của engine chứ không từ một bộ đếm riêng: đó là state
 * được persist, nên con số sống sót qua đúng cái restart đang cần chặn.
 */
const MAX_BALLOTS_PER_ROUND = 2;

/** Số lá BOT đã nộp trong vòng đề cử đang chạy. */
function ballotsCastThisRound(room: Room, playerId: string): number {
  const st = room.engine?.state;
  if (!st) return 0;
  return st.voteMutations.filter(
    (item) => item.round === st.round && item.voterId === playerId,
  ).length;
}

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

  /*
   * Mốc rải trên phần khung CÒN LẠI và ĐƯỢC PHÉP, không phải trên trọn
   * `voteSeconds`.
   *
   * Hai lý do, cả hai đều là lỗi thật:
   * - `resume.ts` gọi hàm này khi server sống lại giữa pha. Tính theo trọn
   *   khung thì mốc rơi ra ngoài pha, và chú thích "trong đúng cửa sổ CÒN LẠI"
   *   ở đó là một lời hứa suông.
   * - 5 giây chót bị khoá (xem `VOTE_LOCKOUT_MS`). Ở `voteSeconds` mặc định 30,
   *   mốc thứ ba cũ rơi vào giây 25.2-27.6 - tức nằm gọn trong vùng cấm.
   *
   * RẢI LẠI chứ không cắt cụt bằng `min(delay, ...)`: cắt cụt dồn mọi bot có
   * mốc rơi vào vùng cấm về đúng một mili giây, và cả phòng lật phiếu trong
   * một nhịp. Rải lại giữ nguyên nhịp hai mốc và jitter đã gieo.
   */
  const now = Date.now();
  const remaining = (room.engine?.state.phaseEndsAt ?? now) - now;
  const window = remaining - VOTE_LOCKOUT_MS;
  if (window <= 0) return;

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

          // Lịch hẹn không phải một bảo đảm: timer bắn trễ khi máy tải nặng,
          // và `resume.ts` có thể vừa cấp thêm một bộ mốc. Hai luật được chốt
          // ở ĐÚNG chỗ lá phiếu rời đi, không chỉ ở chỗ xếp lịch.
          if ((room.engine.state.phaseEndsAt ?? 0) - Date.now() < VOTE_LOCKOUT_MS) return;
          if (ballotsCastThisRound(room, member.playerId) >= MAX_BALLOTS_PER_ROUND) return;

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
