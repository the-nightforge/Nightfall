import { GameEngine } from "@masoi/game-engine";
import type { Room } from "../rooms/store";
import { clearRoomTimers, persistRoom, setRoomTimer } from "../rooms/store";
import { broadcastRoom } from "../rooms/broadcast";
import { prisma } from "../db";
import { buildSnapshot } from "../rooms/snapshot";
import { randomBrain } from "../bots/random-brain";
import type { NightDecision } from "../bots/types";

const ROLE_REVEAL_MS = 10_000;
const RESULT_MS = 8_000;
const GAME_OVER_MS = 30_000;

const pendingEndVote = new Map<string, boolean>();

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
  setRoomTimer(room.code, () => endNight(room), room.config.nightSeconds * 1000 + 500);
  sync(room);
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
  engine(room).setPhase("DAY_DISCUSSION", room.config.discussionSeconds * 1000);
  setRoomTimer(room.code, () => beginVoting(room), room.config.discussionSeconds * 1000 + 500);
  sync(room);
}

function beginVoting(room: Room): void {
  clearRoomTimers(room.code);
  const e = engine(room);
  pendingEndVote.set(room.code, false);
  e.setPhase("VOTING", room.config.voteSeconds * 1000);
  scheduleVoteBots(room);
  setRoomTimer(room.code, () => endVoting(room), room.config.voteSeconds * 1000 + 500);
  sync(room);
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
  room.engine = null;
  room.status = "LOBBY";
  for (const m of room.members) m.ready = false;
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

function scheduleNightBots(room: Room): void {
  for (const member of room.members) {
    if (!member.isBot) continue;
    const delay = 2_000 + Math.floor(Math.random() * 3_000);
    setRoomTimer(room.code, () => {
      void (async () => {
        try {
          if (!room.engine || room.engine.state.phase !== "NIGHT") return;
          const view = buildSnapshot(room, member.playerId);
          applyNight(room, member.playerId, await randomBrain.decideNight(view));
        } catch {
          /* não bot lỗi (mạng, JSON hỏng,...) không được kéo sập cả tiến trình */
        }
      })();
    }, delay);
  }
}

function scheduleVoteBots(room: Room): void {
  for (const member of room.members) {
    if (!member.isBot) continue;
    setRoomTimer(room.code, () => {
      void (async () => {
        try {
          if (!room.engine || room.engine.state.phase !== "VOTING") return;
          const view = buildSnapshot(room, member.playerId);
          const decision = await randomBrain.decideDay(view);
          if (!decision?.voteTargetId) return;
          try {
            room.engine.submitVote(member.playerId, decision.voteTargetId);
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
