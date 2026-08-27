import { GameEngine } from "@masoi/game-engine";
import type { Room } from "../rooms/store";
import { clearRoomTimers, persistRoom, setRoomTimer } from "../rooms/store";
import { broadcastRoom } from "../rooms/broadcast";
import { prisma } from "../db";

const ROLE_REVEAL_MS = 10_000;
const RESULT_MS = 8_000;
const GAME_OVER_MS = 30_000;

const pendingEndNight = new Map<string, boolean>();
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
  pendingEndNight.set(room.code, false);
  pendingEndVote.set(room.code, false);

  // ROLE_REVEAL rồi tự vào đêm
  setRoomTimer(room.code, () => beginNight(room), ROLE_REVEAL_MS);
  sync(room);
}

function beginNight(room: Room): void {
  clearRoomTimers(room.code);
  const e = engine(room);
  pendingEndNight.set(room.code, false);
  e.setPhase("NIGHT", room.config.nightSeconds * 1000);
  scheduleNightBots(room);
  setRoomTimer(room.code, () => endNight(room), room.config.nightSeconds * 1000 + 500);
  sync(room);
}

/** Gọi sau khi một Sói hành động xong - nếu đủ điều kiện thì kết thúc đêm sớm. */
export function maybeEndNightEarly(room: Room): void {
  if (!room.engine || room.engine.state.phase !== "NIGHT") return;
  if (!room.engine.isNightComplete()) return;
  if (pendingEndNight.get(room.code)) return;
  pendingEndNight.set(room.code, true);
  // Chờ chút cho các vai trò tuỳ chọn (Tiên Tri/Bảo Vệ/Phù Thủy) kịp hành động
  setRoomTimer(room.code, () => endNight(room), 1_500);
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

// ---- Bot đơn giản để một người có thể test toàn ván ----

function randomOf<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)];
}

function scheduleNightBots(room: Room): void {
  const e = engine(room);
  for (const p of e.state.players) {
    if (!p.isBot || !p.alive) continue;
    const delay = 2_000 + Math.floor(Math.random() * 3_000);

    if (p.role === "WEREWOLF") {
      setRoomTimer(room.code, () => {
        try {
          const targets = e.state.players.filter(
            (t) => t.alive && t.role !== "WEREWOLF",
          );
          const target = randomOf(targets);
          if (target) e.submitNightAction(p.id, "KILL", target.id);
          maybeEndNightEarly(room);
        } catch {
          /* bot bỏ lượt */
        }
      }, delay);
    }

    if (p.role === "SEER") {
      setRoomTimer(room.code, () => {
        try {
          const targets = e.state.players.filter((t) => t.alive && t.id !== p.id);
          const target = randomOf(targets);
          if (target) e.submitNightAction(p.id, "SEE", target.id);
        } catch {
          /* bỏ lượt */
        }
      }, delay + 500);
    }

    if (p.role === "GUARD") {
      setRoomTimer(room.code, () => {
        try {
          const targets = e.state.players.filter(
            (t) => t.alive && t.id !== e.state.guardPrevious,
          );
          const target = randomOf(targets);
          if (target) e.submitNightAction(p.id, "GUARD", target.id);
        } catch {
          /* bỏ lượt */
        }
      }, delay + 1_000);
    }

    if (p.role === "WITCH" && !e.state.healUsed && e.state.round === 1) {
      setRoomTimer(room.code, () => {
        try {
          if (!e.state.healUsed) e.submitNightAction(p.id, "HEAL", null);
        } catch {
          /* bỏ lượt */
        }
      }, delay + 1_200);
    }
  }
}

function scheduleVoteBots(room: Room): void {
  const e = engine(room);
  for (const p of e.state.players) {
    if (!p.isBot || !p.alive) continue;
    setRoomTimer(room.code, () => {
      try {
        if (e.state.phase !== "VOTING" || !p.alive) return;
        const targets = e.state.players.filter((t) => t.alive && t.id !== p.id);
        const target = randomOf(targets);
        if (target) e.submitVote(p.id, target.id);
        maybeEndVotingEarly(room);
      } catch {
        /* bỏ phiếu lỗi */
      }
    }, 3_000 + Math.floor(Math.random() * 8_000));
  }
}
