import { GameEngine } from "@masoi/game-engine";
import type { BotDecisionContext, BotSpeechIntention } from "@masoi/game-engine";
import { GAME_OVER_MS, RESULT_MS, ROLE_REVEAL_MS, SERVER_EVENTS } from "@masoi/shared";
import type { PublicVoteChoice } from "@masoi/shared";
import type { Room } from "../rooms/store";
import { clearRoomTimers, persistRoom, setRoomTimer } from "../rooms/store";
import { broadcastRoom, emitToPlayers } from "../rooms/broadcast";
import { prisma } from "../db";
import { buildSnapshot, pushChat, resolveChat } from "../rooms/snapshot";
import { botBrain, randomBrain, resetBotBudget } from "../bots";
import { buildBotDecisionContext } from "../bots/context";
import { renderBotSpeech } from "../bots/speech-renderer";
import { personaFor } from "../bots/prompt";
import type { SpeechRequest } from "../bots/types";
import { engineVote } from "../bots/targets";
import { botSessionFor, clearBotSession, startBotSession } from "../bots/session-registry";
import { newId } from "../util";
import type { NightDecision, PlannedVote } from "../bots/types";
import { pendingEndFinalVote } from "./bot-room-state";
import {
  DISCONNECT_GRACE_MS,
  clearDiscussionSkipVotes,
  hasUnanimousDiscussionSkip,
  updateDiscussionSkipVote,
} from "./discussion-skip";

const HUNTER_SHOT_MS = 15_000;
/** Chừa một giây để engine nhận fallback trước khi phase hết hạn. */
const HUNTER_BOT_DEADLINE_BUFFER_MS = 1_000;
/** Cùng mục đích, cho vòng bỏ phiếu xác nhận. */
const FINAL_VOTE_BOT_DEADLINE_BUFFER_MS = 1_500;
/** Cửa sổ riêng cho Phù Thuỷ sau khi bầy Sói chốt nạn nhân. */
const WITCH_WINDOW_MS = 15_000;

function engine(room: Room): GameEngine {
  if (!room.engine) throw new Error("Chưa có trận đấu");
  return room.engine;
}

function sync(room: Room): void {
  void persistRoom(room);
  broadcastRoom(room.code);
}

/**
 * Đánh giá điều kiện thắng sau mỗi pha kết quả.
 * Đi qua pha CHECK_WIN để đúng luồng trạng thái đã thiết kế.
 */
function checkWinOrContinue(room: Room, next: () => void): void {
  const e = engine(room);
  const winner = e.checkWin();
  if (winner) {
    e.finishGame(winner);
    onGameOver(room);
  } else {
    next();
  }
}

export function startGame(room: Room): void {
  room.chatLog = [];
  clearDiscussionSkipVotes(room.code);
  const players = room.members.map((m) => ({ id: m.playerId, name: m.name, isBot: m.isBot }));
  room.engine = GameEngine.create(players, room.config);
  room.status = "IN_GAME";
  pendingEndFinalVote.set(room.code, false);
  // Ván mới thì nhận thức của BOT phải bắt đầu lại từ đầu: giữ lại brain của
  // ván trước sẽ mang theo nghi ngờ về những người đã đổi vai.
  startBotSession(room);

  // ROLE_REVEAL rồi tự vào đêm
  setRoomTimer(room.code, () => beginNight(room), ROLE_REVEAL_MS);
  sync(room);
}

function beginNight(room: Room): void {
  clearRoomTimers(room.code);
  const e = engine(room);
  e.startNight(room.config.nightSeconds * 1000);
  scheduleNightBots(room);
  setRoomTimer(room.code, () => lockWolves(room), room.config.nightSeconds * 1000 + 500);
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
  setRoomTimer(room.code, () => endNight(room), WITCH_WINDOW_MS + 500);
  sync(room);
}

/**
 * Đóng cửa sổ Phù Thuỷ ngay khi cô ta đã quyết, khỏi bắt cả phòng ngồi chờ hết
 * 15 giây, để không phải chờ toàn bộ cửa sổ đêm.
 */
export function maybeEndWitchWindow(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "NIGHT") return;
  if (!room.engine.state.night.wolvesLocked) return;
  if (room.engine.witchPending()) return;
  setRoomTimer(room.code, () => endNight(room), 800);
}

function endNight(room: Room): void {
  clearRoomTimers(room.code);
  if (!room.engine || room.engine.state.phase !== "NIGHT") return;
  const deaths = engine(room).resolveNight();
  void deaths;
  sync(room);

  setRoomTimer(room.code, () => {
    continueAfterDeathResult(room, "night");
  }, RESULT_MS);
}

function beginDiscussion(room: Room): void {
  clearRoomTimers(room.code);
  clearDiscussionSkipVotes(room.code);
  const e = engine(room);
  const event = e.startDay(room.config.discussionSeconds * 1000);
  const durationMs = (e.state.phaseEndsAt ?? (Date.now() + room.config.discussionSeconds * 1000)) - Date.now();

  if (event?.id === "AMNESTY_DAY") {
    // Ngày Hòa Hoãn: sau thảo luận chuyển thẳng sang Đêm
    setRoomTimer(room.code, () => beginNight(room), durationMs + 500);
  } else {
    setRoomTimer(room.code, () => beginVoting(room), durationMs + 500);
  }
  scheduleDayBots(room);
  sync(room);
}

function beginVoting(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "DAY_DISCUSSION") return;
  clearRoomTimers(room.code);
  clearDiscussionSkipVotes(room.code);
  const e = engine(room);
  e.setPhase("VOTING", room.config.voteSeconds * 1000);
  scheduleVoteBots(room);
  setRoomTimer(room.code, () => endVoting(room), room.config.voteSeconds * 1000 + 500);
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
    setRoomTimer(room.code, () => {
      continueAfterDeathResult(room, "vote");
    }, RESULT_MS);
    return;
  }

  // resolveNomination đã đặt pha và hạn chót; ở đây chỉ còn xếp lịch.
  scheduleDefenseBot(room, outcome.accusedId);
  setRoomTimer(room.code, () => beginFinalVote(room), defenseMs + 500);
}

function beginFinalVote(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "DEFENSE") return;
  clearRoomTimers(room.code);
  pendingEndFinalVote.set(room.code, false);
  engine(room).beginFinalVote(room.config.finalVoteSeconds * 1000);
  scheduleFinalVoteBots(room);
  setRoomTimer(room.code, () => endFinalVote(room), room.config.finalVoteSeconds * 1000 + 500);
  sync(room);
}

/** Cờ chặn hẹn giờ trùng cho vòng final vote. */
export function maybeEndFinalVoteEarly(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "FINAL_VOTE") return;
  if (!room.engine.allFinalVotersVoted()) return;
  if (pendingEndFinalVote.get(room.code)) return;
  pendingEndFinalVote.set(room.code, true);
  setRoomTimer(room.code, () => endFinalVote(room), 800);
}

function endFinalVote(room: Room): void {
  clearRoomTimers(room.code);
  if (!room.engine || room.engine.state.phase !== "FINAL_VOTE") return;
  engine(room).resolveFinalVote();
  sync(room);

  setRoomTimer(room.code, () => {
    continueAfterDeathResult(room, "vote");
  }, RESULT_MS);
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
  setRoomTimer(room.code, () => timeoutHunterShot(room), HUNTER_SHOT_MS + 500);
  sync(room);
}

export function submitHunterShot(room: Room, playerId: string, targetId: string | null): void {
  engine(room).submitHunterShot(playerId, targetId);
  sync(room);
  setRoomTimer(room.code, () => finishHunterShot(room), 800);
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
  clearDiscussionSkipVotes(room.code);
  room.engine = null;
  room.status = "LOBBY";
  for (const m of room.members) m.ready = false;
  pendingEndFinalVote.delete(room.code);
  clearBotSession(room.code);
  resetBotBudget(room.code);
  sync(room);
}

function onGameOver(room: Room): void {
  const e = engine(room);
  const st = e.getState();
  void prisma.gameResult
    .create({
      data: {
        roomCode: room.code,
        round: st.round,
        winner: st.winner ?? "unknown",
        playerRoles: st.players.map((p) => ({ name: p.name, role: p.role, alive: p.alive })),
        durationSec: Math.round((Date.now() - room.createdAt) / 1000),
      },
    })
    .catch(() => undefined);

  clearBotSession(room.code);
  resetBotBudget(room.code);

  sync(room);
  setRoomTimer(room.code, () => resetToLobby(room), GAME_OVER_MS);
}

// ---- Bot ----

export function scheduleHunterBot(room: Room): void {
  const scheduledEngine = room.engine;
  if (!scheduledEngine || scheduledEngine.state.phase !== "HUNTER_SHOT") return;
  const scheduledReaction = scheduledEngine.state.hunterReaction;
  if (!scheduledReaction || scheduledReaction.resolved) return;

  const member = room.members.find(
    (candidate) => candidate.playerId === scheduledReaction.hunterId && candidate.isBot,
  );
  if (!member) return;

  const initialView = buildSnapshot(room, member.playerId);
  if (!initialView.hunterShot?.canAct) return;

  const stillPending = (): boolean =>
    room.engine === scheduledEngine &&
    scheduledEngine.state.phase === "HUNTER_SHOT" &&
    scheduledEngine.state.hunterReaction === scheduledReaction &&
    scheduledReaction.hunterId === member.playerId &&
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

function applyNight(room: Room, botId: string, decision: NightDecision | null): void {
  if (!decision) return;
  try {
    if (decision.secondaryTargetId !== undefined) {
      engine(room).submitNightAction(botId, decision.action, decision.targetId, decision.secondaryTargetId);
    } else {
      engine(room).submitNightAction(botId, decision.action, decision.targetId);
    }
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
 */
export function scheduleNightBots(room: Room): void {
  const session = botSessionFor(room);

  for (const member of room.members) {
    if (!member.isBot) continue;

    const view = buildSnapshot(room, member.playerId);
    // canAct đã loại Phù Thuỷ ở chặng một và loại Sói ở chặng hai; cờ acted
    // chặn nốt việc gọi lại này hỏi một bot đã hành động rồi.
    if (!view.night?.canAct || view.night.acted) continue;

    const rng = session.rngFor(member.playerId, "night-schedule");
    const delay = Math.floor((0.1 + rng() * 0.2) * room.config.nightSeconds * 1_000);

    setRoomTimer(room.code, () => {
      try {
        if (!room.engine || room.engine.state.phase !== "NIGHT") return;

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
function toSpeechRequest(
  room: Room,
  member: { playerId: string; name: string },
  context: BotDecisionContext,
  speech: BotSpeechIntention,
): SpeechRequest {
  const target = speech.targetId
    ? context.knowledge.players.find((player) => player.id === speech.targetId)
    : undefined;
  const runtime = botSessionFor(room).runtimeFor(member.playerId);

  return {
    roomCode: room.code,
    speaker: { id: member.playerId, name: member.name },
    personalityStyle: personaFor(member.playerId),
    intention: speech,
    evidence: speech.evidence.map((item) => ({
      sourceId: item.sourceId,
      summary: item.summary,
    })),
    targetName: target?.name ?? null,
    recentSpeechSourceIds: runtime.state.speechMemory.flatMap((entry) => entry.sourceIds),
  };
}

export function scheduleDayBots(room: Room): void {
  const bots = room.members.filter((m) => m.isBot);
  const window = room.config.discussionSeconds * 1_000;

  bots.forEach((member, i) => {
    // Rải đều trong khung thảo luận thay vì dội ra cùng lúc
    const delay = Math.floor(((i + 1) / (bots.length + 1)) * window);
    setRoomTimer(room.code, () => {
      void (async () => {
        try {
          if (!room.engine || room.engine.state.phase !== "DAY_DISCUSSION") return;
          const discussionEngine = room.engine;
          const discussionRound = discussionEngine.state.round;
          const discussionEndsAt = discussionEngine.state.phaseEndsAt;
          const runtime = botSessionFor(room).runtimeFor(member.playerId);
          const context = buildBotDecisionContext(room, member.playerId);
          runtime.observe(context);
          // Phiếu là quyết định của lõi deterministic, chốt TRƯỚC khi hỏi nhà
          // cung cấp. Provider chỉ còn việc diễn đạt.
          //
          // Phiếu KHÔNG được ghi nhớ ở đây: pha bỏ phiếu sẽ hỏi lại chính lõi
          // này với ngữ cảnh mới nhất. Một phiếu đóng băng từ lúc thảo luận là
          // phiếu bỏ qua mọi thứ xảy ra sau đó.
          const vote = runtime.decideVote(context);
          const speech = runtime.decideSpeech(context, vote);
          const chat = speech
            ? await renderBotSpeech(toSpeechRequest(room, member, context, speech))
            : null;

          // Kết quả về sau khi pha đổi thì bỏ hết: nó được tính từ một tình thế
          // không còn tồn tại.
          if (
            room.engine !== discussionEngine ||
            discussionEngine.state.phase !== "DAY_DISCUSSION" ||
            discussionEngine.state.round !== discussionRound ||
            discussionEngine.state.phaseEndsAt !== discussionEndsAt
          ) return;

          if (!speech || !chat) return;

          const resolved = resolveChat(room, member.playerId);
          if (resolved.ok) {
            // ChatMessage cần đủ id và at; dựng giống hệt service.chat()
            const message = {
              id: newId(),
              channel: resolved.channel,
              playerId: member.playerId,
              playerName: member.name,
              text: chat,
              at: Date.now(),
            };
            pushChat(room, message);
            emitToPlayers(resolved.recipients, SERVER_EVENTS.CHAT_NEW, message);
            void persistRoom(room);
            runtime.recordSpeech(speech, discussionRound);
          }
        } catch {
          /* não bot lỗi (mạng, JSON hỏng,...) không được kéo sập cả tiến trình */
        }
      })();
    }, delay);
  });
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
      const attempt = await botBrain().decideDefense(view);
      // Chỉ lượt HỎNG mới đáng để đường lui nói thay: bot chủ động im lặng
      // (đã chết, không còn là bị cáo) phải được tôn trọng.
      const decision = attempt.ok ? attempt : await randomBrain.decideDefense(view);
      if (!decision.ok || !decision.value) return;
      // Kết quả về muộn không được lọt sang pha sau.
      if (!stillDefending()) return;

      const resolved = resolveChat(room, member.playerId);
      if (!resolved.ok) return;
      const message = {
        id: newId(),
        channel: resolved.channel,
        playerId: member.playerId,
        playerName: member.name,
        text: decision.value.chat,
        at: Date.now(),
      };
      pushChat(room, message);
      emitToPlayers(resolved.recipients, SERVER_EVENTS.CHAT_NEW, message);
      void persistRoom(room);
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
function scheduleFinalVoteBots(room: Room): void {
  const scheduledEngine = room.engine;
  if (!scheduledEngine) return;
  const accusedId = scheduledEngine.state.trial?.accusedId;
  if (!accusedId) return;

  const session = botSessionFor(room);
  const windowMs = room.config.finalVoteSeconds * 1_000;
  const deadlineMs = Math.max(0, windowMs - FINAL_VOTE_BOT_DEADLINE_BUFFER_MS);

  for (const member of room.members) {
    if (!member.isBot) continue;
    const view = buildSnapshot(room, member.playerId);
    if (!view.trial?.canVote) continue;

    const rng = session.rngFor(member.playerId, "final-vote-schedule");
    const delay = Math.min(deadlineMs, Math.floor((0.15 + rng() * 0.25) * windowMs));

    setRoomTimer(room.code, () => {
      try {
        if (!room.engine || room.engine.state.phase !== "FINAL_VOTE") return;

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
    if (!member.isBot) continue;

    const rng = session.rngFor(member.playerId, "vote-schedule");
    const delays = VOTE_CHECKPOINTS.map(([start, spread]) =>
      Math.floor((start + rng() * spread) * window),
    );

    for (const delay of delays) {
      setRoomTimer(room.code, () => {
        try {
          if (!room.engine || room.engine.state.phase !== "VOTING") return;

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
