import { GameEngine } from "@masoi/game-engine";
import { SERVER_EVENTS } from "@masoi/shared";
import type { Room } from "../rooms/store";
import { clearRoomTimers, persistRoom, setRoomTimer } from "../rooms/store";
import { broadcastRoom, emitToPlayers } from "../rooms/broadcast";
import { prisma } from "../db";
import { buildSnapshot, pushChat, resolveChat } from "../rooms/snapshot";
import { botBrain, randomBrain, resetBotBudget } from "../bots";
import { engineVote, usablePlannedVote } from "../bots/targets";
import { newId } from "../util";
import type { NightDecision, PlannedVote } from "../bots/types";
import { pendingEndVote, pendingVote } from "./bot-room-state";
import {
  clearDiscussionSkipVotes,
  hasUnanimousDiscussionSkip,
  updateDiscussionSkipVote,
} from "./discussion-skip";

const ROLE_REVEAL_MS = 10_000;
const RESULT_MS = 8_000;
const GAME_OVER_MS = 30_000;
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
  pendingEndVote.set(room.code, false);

  // ROLE_REVEAL rồi tự vào đêm
  setRoomTimer(room.code, () => beginNight(room), ROLE_REVEAL_MS);
  sync(room);
}

function beginNight(room: Room): void {
  clearRoomTimers(room.code);
  const e = engine(room);
  e.setPhase("NIGHT", room.config.nightSeconds * 1000);
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
 * 15 giây. Cùng cách làm với maybeEndVotingEarly ở pha bỏ phiếu.
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
    checkWinOrContinue(room, () => beginDiscussion(room));
  }, RESULT_MS);
}

function beginDiscussion(room: Room): void {
  clearRoomTimers(room.code);
  clearDiscussionSkipVotes(room.code);
  engine(room).setPhase("DAY_DISCUSSION", room.config.discussionSeconds * 1000);
  setRoomTimer(room.code, () => beginVoting(room), room.config.discussionSeconds * 1000 + 500);
  scheduleDayBots(room);
  sync(room);
}

function beginVoting(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "DAY_DISCUSSION") return;
  clearRoomTimers(room.code);
  clearDiscussionSkipVotes(room.code);
  const e = engine(room);
  pendingEndVote.set(room.code, false);
  e.setPhase("VOTING", room.config.voteSeconds * 1000);
  scheduleVoteBots(room);
  setRoomTimer(room.code, () => endVoting(room), room.config.voteSeconds * 1000 + 500);
  sync(room);
}

export function submitDiscussionSkip(room: Room, playerId: string, skip: boolean): string | null {
  const result = updateDiscussionSkipVote(room, playerId, skip);
  if (!result.ok) return result.error;
  if (result.unanimous) beginVoting(room);
  else sync(room);
  return null;
}

export function reconcileDiscussionSkip(room: Room): boolean {
  if (!hasUnanimousDiscussionSkip(room)) return false;
  beginVoting(room);
  return room.engine?.state.phase === "VOTING";
}

export function maybeEndVotingEarly(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "VOTING") return;
  if (!room.engine.allAliveVoted()) return;
  if (pendingEndVote.get(room.code)) return;
  pendingEndVote.set(room.code, true);
  setRoomTimer(room.code, () => endVoting(room), 800);
}

function endVoting(room: Room): void {
  clearRoomTimers(room.code);
  if (!room.engine || room.engine.state.phase !== "VOTING") return;
  engine(room).resolveVote();
  sync(room);

  setRoomTimer(room.code, () => {
    checkWinOrContinue(room, () => beginNight(room));
  }, RESULT_MS);
}

export function resetToLobby(room: Room): void {
  clearRoomTimers(room.code);
  clearDiscussionSkipVotes(room.code);
  room.engine = null;
  room.status = "LOBBY";
  for (const m of room.members) m.ready = false;
  pendingVote.delete(room.code);
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

  pendingVote.delete(room.code);
  resetBotBudget(room.code);

  sync(room);
  setRoomTimer(room.code, () => resetToLobby(room), GAME_OVER_MS);
}

// ---- Bot ----

function applyNight(room: Room, botId: string, decision: NightDecision | null): void {
  if (!decision) return;
  try {
    engine(room).submitNightAction(botId, decision.action, decision.targetId);
  } catch {
    /* engine là trọng tài cuối; sai luật thì bot bỏ lượt */
  }
}

export function scheduleNightBots(room: Room): void {
  // Trần thời gian nộp quyết định: nhanh hơn hẳn thời lượng đêm, để endNight()
  // không bao giờ phải chờ mạng — kể cả với nightSeconds ngắn nhất (15s = 6s trần).
  const deadlineMs = Math.min(
    8_000,
    room.engine?.state.night.wolvesLocked ? WITCH_WINDOW_MS * 0.4 : room.config.nightSeconds * 400,
  );

  for (const member of room.members) {
    if (!member.isBot) continue;
    const view = buildSnapshot(room, member.playerId);
    // canAct đã loại Phù Thuỷ ở chặng một và loại Sói ở chặng hai; cờ acted
    // chặn nốt việc gọi lại này hỏi một bot đã hành động rồi.
    if (!view.night?.canAct || view.night.acted) continue;

    const delay = 2_000 + Math.floor(Math.random() * 3_000);
    // Gọi ngay ở t=0, nộp ở max(delay, lúc kết quả về)
    const pending = botBrain().decideNight(view);
    const earliest = new Promise<void>((r) => setTimeout(r, delay));
    let settled = false;

    void (async () => {
      try {
        const decision = await pending;
        await earliest;
        if (settled) return;
        settled = true;
        if (!room.engine || room.engine.state.phase !== "NIGHT") return;
        // Chỉ lượt HỎNG mới đáng để RandomBrain đánh bừa thay. Bot chủ động
        // không làm gì (đã chết, Phù Thuỷ chọn SKIP) phải được tôn trọng.
        const fallback = decision.ok ? decision : await randomBrain.decideNight(view);
        applyNight(room, member.playerId, fallback.ok ? fallback.value : null);
      } catch {
        /* não bot lỗi (mạng, JSON hỏng,...) không được kéo sập cả tiến trình */
      }
    })();

    setRoomTimer(room.code, () => {
      void (async () => {
        try {
          if (settled) return;
          settled = true;
          if (!room.engine || room.engine.state.phase !== "NIGHT") return;
          applyNight(room, member.playerId, (await randomBrain.decideNight(view)).value);
        } catch {
          /* não bot lỗi (mạng, JSON hỏng,...) không được kéo sập cả tiến trình */
        }
      })();
    }, deadlineMs);
  }
}

export function scheduleDayBots(room: Room): void {
  const bots = room.members.filter((m) => m.isBot);
  const window = room.config.discussionSeconds * 1_000;
  const votes = new Map<string, PlannedVote>();
  pendingVote.set(room.code, votes);

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
          const view = buildSnapshot(room, member.playerId);
          const attempt = await botBrain().decideDay(view);
          if (
            room.engine !== discussionEngine ||
            discussionEngine.state.phase !== "DAY_DISCUSSION" ||
            discussionEngine.state.round !== discussionRound ||
            discussionEngine.state.phaseEndsAt !== discussionEndsAt
          ) return;
          if (!attempt.ok || !attempt.value) return;
          const decision = attempt.value;
          if (decision.vote) votes.set(member.playerId, decision.vote);
          if (decision.chat) {
            const resolved = resolveChat(room, member.playerId);
            if (resolved.ok) {
              // ChatMessage cần đủ id và at; dựng giống hệt service.chat()
              const message = {
                id: newId(),
                channel: resolved.channel,
                playerId: member.playerId,
                playerName: member.name,
                text: decision.chat,
                at: Date.now(),
              };
              pushChat(room, message);
              emitToPlayers(resolved.recipients, SERVER_EVENTS.CHAT_NEW, message);
              void persistRoom(room);
            }
          }
        } catch {
          /* não bot lỗi (mạng, JSON hỏng,...) không được kéo sập cả tiến trình */
        }
      })();
    }, delay);
  });
}

function scheduleVoteBots(room: Room): void {
  const votes = pendingVote.get(room.code);

  for (const member of room.members) {
    if (!member.isBot) continue;
    setRoomTimer(room.code, () => {
      void (async () => {
        try {
          if (!room.engine || room.engine.state.phase !== "VOTING") return;
          const view = buildSnapshot(room, member.playerId);

          const vote =
            usablePlannedVote(view, votes?.get(member.playerId)) ??
            (await randomBrain.decideDay(view)).value?.vote;

          if (!vote) return;
          try {
            room.engine.submitVote(member.playerId, engineVote(vote));
            // Phiếu của người thật được broadcast ngay trong handler socket, còn
            // phiếu bot thì không: client giữ nguyên snapshot cũ nên mọi voteCount
            // đứng yên ở 0 tới tận lúc pha kết thúc. Trong phòng toàn bot, bộ đếm
            // "Không treo ai (x phiếu)" vì thế trông như hỏng.
            sync(room);
            maybeEndVotingEarly(room);
          } catch {
            /* bỏ phiếu lỗi */
          }
        } catch {
          /* não bot lỗi (mạng, JSON hỏng,...) không được kéo sập cả tiến trình */
        }
      })();
    }, 3_000 + Math.floor(Math.random() * 8_000));
  }
}
