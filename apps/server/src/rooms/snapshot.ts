import type { ChatMessage, RoomSnapshot } from "@masoi/shared";
import { getDiscussionSkipView } from "../game/discussion-skip";
import type { Room } from "./store";

function isHunterReactionParticipant(room: Room, playerId: string): boolean {
  return room.engine?.state.hunterReaction?.hunterId === playerId;
}

/**
 * Xác định kênh chat của người gửi và ai được nhận tin nhắn.
 * Server là nơi duy nhất quyết định quyền - client không gửi channel.
 */
export function resolveChat(room: Room, senderId: string):
  | { ok: true; channel: string; recipients: string[] }
  | { ok: false; error: string } {
  const sender = room.members.find((m) => m.playerId === senderId);
  if (!sender) return { ok: false, error: "Bạn không ở trong phòng này" };

  if (room.status === "LOBBY" || !room.engine) {
    return { ok: true, channel: "lobby", recipients: room.members.map((m) => m.playerId) };
  }

  const view = room.engine.snapshotFor(senderId);
  const alive = view.you?.alive ?? true;

  if (view.phase === "GAME_OVER") {
    return { ok: true, channel: "lobby", recipients: room.members.map((m) => m.playerId) };
  }

  if (!alive) {
    if (isHunterReactionParticipant(room, senderId)) {
      return { ok: false, error: "Thợ Săn chưa thể dùng kênh chat người chết" };
    }
    // Người chết chỉ chat với người chết
    const recipients = room.members
      .filter(
        (m) =>
          !room.engine!.snapshotFor(m.playerId).you?.alive &&
          !m.isBot &&
          !isHunterReactionParticipant(room, m.playerId),
      )
      .map((m) => m.playerId);
    return { ok: true, channel: "dead", recipients };
  }

  if (view.phase === "NIGHT") {
    const role = view.you?.role;
    if (role === "WEREWOLF") {
      const recipients = room.members
        .filter(
          (m) =>
            !m.isBot &&
            room.engine!.snapshotFor(m.playerId).you?.role === "WEREWOLF" &&
            room.engine!.snapshotFor(m.playerId).you?.alive,
        )
        .map((m) => m.playerId);
      return { ok: true, channel: "wolves", recipients };
    }
    return { ok: false, error: "Ban đêm bạn không thể trò chuyện" };
  }

  if (view.phase === "DAY_DISCUSSION" || view.phase === "VOTING" || view.phase === "ROLE_REVEAL" || view.phase === "NIGHT_RESULT" || view.phase === "ELIMINATION") {
    const recipients = room.members
      .filter((m) => !m.isBot && room.engine!.snapshotFor(m.playerId).you?.alive)
      .map((m) => m.playerId);
    return { ok: true, channel: "day", recipients };
  }

  return { ok: false, error: "Hiện tại không thể trò chuyện" };
}

export function pushChat(room: Room, message: ChatMessage): void {
  room.chatLog.push(message);
  if (room.chatLog.length > 100) room.chatLog.splice(0, room.chatLog.length - 100);
}

/** Chỉ trả về lịch sử kênh chat mà người xem hiện tại được phép đọc. */
export function visibleChatLog(room: Room, viewerId: string): ChatMessage[] {
  const member = room.members.find((candidate) => candidate.playerId === viewerId);
  if (!member) return [];

  const messagesFor = (channel: string) =>
    room.chatLog.filter((message) => message.channel === channel).slice(-60);

  if (room.status === "LOBBY" || !room.engine) return messagesFor("lobby");

  const view = room.engine.snapshotFor(viewerId);
  if (!view.you) return [];
  if (view.phase === "GAME_OVER") return messagesFor("lobby");
  if (!view.you.alive) {
    return isHunterReactionParticipant(room, viewerId) ? [] : messagesFor("dead");
  }

  if (view.phase === "NIGHT") {
    return view.you.role === "WEREWOLF" ? messagesFor("wolves") : [];
  }

  if (
    view.phase === "ROLE_REVEAL" ||
    view.phase === "NIGHT_RESULT" ||
    view.phase === "DAY_DISCUSSION" ||
    view.phase === "VOTING" ||
    view.phase === "ELIMINATION"
  ) {
    return messagesFor("day");
  }

  return [];
}

/** Snapshot đầy đủ cho MỘT người chơi cụ thể - đã lọc thông tin bí mật theo quyền. */
export function buildSnapshot(room: Room, viewerId: string): RoomSnapshot {
  const member = room.members.find((m) => m.playerId === viewerId);
  const gameView = room.engine ? room.engine.snapshotFor(viewerId) : null;

  return {
    code: room.code,
    hostId: room.hostId,
    phase: gameView ? gameView.phase : "LOBBY",
    config: room.config,
    round: gameView?.round ?? 0,
    phaseEndsAt: gameView ? gameView.phaseEndsAt : null,
    you: member
      ? {
          id: member.playerId,
          name: member.name,
          ready: member.ready,
          connected: member.connected,
          role: gameView?.you?.role,
          alive: gameView?.you?.alive ?? true,
        }
      : null,
    players: (() => {
      if (gameView) {
        return gameView.players.map((p) => {
          const member = room.members.find((m) => m.playerId === p.id);
          return {
            id: p.id,
            name: p.name,
            alive: p.alive,
            isBot: p.isBot,
            role: p.role,
            voteCount: p.voteCount,
            ready: member?.ready,
            connected: member?.connected,
          };
        });
      }
      return room.members.map((m) => ({
        id: m.playerId,
        name: m.name,
        alive: true,
        isBot: m.isBot,
        voteCount: 0,
        ready: m.ready,
        connected: m.connected,
      }));
    })(),
    night: gameView?.nightInfo ?? null,
    hunterShot: gameView?.hunterShotInfo ?? null,
    hasVoted: gameView?.hasVoted ?? false,
    myVote: gameView?.myVote ?? null,
    noEliminationVoteCount: gameView?.noEliminationVoteCount ?? 0,
    discussionSkip: getDiscussionSkipView(room, viewerId),
    votesRevealed: gameView?.votesRevealed ?? false,
    nightHistory: gameView?.nightHistory ?? [],
    hunterShots: gameView?.hunterShots ?? [],
    lastNightDeaths: gameView?.lastNightDeaths ?? [],
    lastEliminated: gameView?.lastEliminated ?? null,
    winner: gameView?.winner ?? null,
    chatLog: visibleChatLog(room, viewerId),
    log: gameView?.log ?? [],
  };
}
