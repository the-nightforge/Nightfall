import type { ChatMessage, RoomSnapshot } from "@masoi/shared";
import { getDiscussionSkipView } from "../game/discussion-skip";
import type { Room } from "./store";

function isHunterReactionParticipant(room: Room, playerId: string): boolean {
  return room.engine?.state.hunterReaction?.hunterId === playerId;
}

/** Kênh chat trong trận mà người chết được theo dõi với tư cách khán giả. */
const SPECTATOR_CHANNELS = ["day", "wolves", "dead"];

/**
 * Người chết xem được mọi kênh trong trận nhưng chỉ gửi được ở kênh người chết.
 * Thợ Săn đang chờ bắn chưa tính là người chết - họ vẫn phải bắn "mù".
 */
function deadSpectators(room: Room): string[] {
  if (!room.engine) return [];
  return room.members
    .filter(
      (member) =>
        !member.isBot &&
        !room.engine!.snapshotFor(member.playerId).you?.alive &&
        !isHunterReactionParticipant(room, member.playerId),
    )
    .map((member) => member.playerId);
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
    return { ok: true, channel: "dead", recipients: deadSpectators(room) };
  }

  if (view.phase === "NIGHT") {
    const role = view.you?.role;
    if (role === "WEREWOLF" || role === "WOLF_CUB") {
      if (room.engine?.state.activeEvent?.id === "SILENT_NIGHT") {
        return { ok: false, error: "Đêm Tĩnh Lặng: Kênh chat phe Sói bị vô hiệu hóa" };
      }
      const recipients = room.members
        .filter(
          (m) =>
            !m.isBot &&
            (room.engine!.snapshotFor(m.playerId).you?.role === "WEREWOLF" ||
             room.engine!.snapshotFor(m.playerId).you?.role === "WOLF_CUB") &&
            room.engine!.snapshotFor(m.playerId).you?.alive,
        )
        .map((m) => m.playerId);
      return { ok: true, channel: "wolves", recipients: [...recipients, ...deadSpectators(room)] };
    }
    return { ok: false, error: "Ban đêm bạn không thể trò chuyện" };
  }

  // Biện hộ là lượt nói độc quyền của bị cáo. Nhánh này nằm SAU nhánh người
  // chết, nên người chết vẫn dùng kênh dead bình thường trong lúc đó.
  if (view.phase === "DEFENSE" && senderId !== room.engine.state.trial?.accusedId) {
    return { ok: false, error: "Chỉ người đang biện hộ được nói" };
  }

  if (
    view.phase === "DAY_DISCUSSION" ||
    view.phase === "VOTING" ||
    view.phase === "DEFENSE" ||
    view.phase === "FINAL_VOTE" ||
    view.phase === "ROLE_REVEAL" ||
    view.phase === "NIGHT_RESULT" ||
    view.phase === "ELIMINATION"
  ) {
    const recipients = room.members
      .filter((m) => !m.isBot && room.engine!.snapshotFor(m.playerId).you?.alive)
      .map((m) => m.playerId);
    return { ok: true, channel: "day", recipients: [...recipients, ...deadSpectators(room)] };
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

  const messagesFor = (...channels: string[]) =>
    room.chatLog.filter((message) => channels.includes(message.channel)).slice(-60);

  if (room.status === "LOBBY" || !room.engine) return messagesFor("lobby");

  const view = room.engine.snapshotFor(viewerId);
  if (!view.you) return [];
  if (view.phase === "GAME_OVER") return messagesFor("lobby");
  if (!view.you.alive) {
    // Người chết theo dõi được cả trận, chỉ mất quyền nói với người sống.
    return isHunterReactionParticipant(room, viewerId) ? [] : messagesFor(...SPECTATOR_CHANNELS);
  }

  if (view.phase === "NIGHT") {
    if (room.engine?.state.activeEvent?.id === "SILENT_NIGHT") return [];
    return (view.you.role === "WEREWOLF" || view.you.role === "WOLF_CUB") ? messagesFor("wolves") : [];
  }

  if (
    view.phase === "ROLE_REVEAL" ||
    view.phase === "NIGHT_RESULT" ||
    view.phase === "DAY_DISCUSSION" ||
    view.phase === "VOTING" ||
    view.phase === "DEFENSE" ||
    view.phase === "FINAL_VOTE" ||
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
    activeEvent: gameView?.activeEvent ?? null,
    apprenticeAwakened: gameView?.nightInfo?.apprenticeAwakened ?? room.engine?.state.apprenticeAwakened,
    phaseEndsAt: gameView ? gameView.phaseEndsAt : null,
    serverNow: Date.now(),
    you: member
      ? {
          id: member.playerId,
          name: member.name,
          ready: member.ready,
          connected: member.connected,
          role: gameView?.you?.role,
          alive: gameView?.you?.alive ?? true,
          cursedTurned: gameView?.you?.cursedTurned,
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
            cursedTurned: p.cursedTurned,
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
    trial: gameView?.trialInfo ?? null,
    lastTrial: gameView?.lastTrial ?? null,
    hasVoted: gameView?.hasVoted ?? false,
    myVote: gameView?.myVote ?? null,
    noEliminationVoteCount: gameView?.noEliminationVoteCount ?? 0,
    discussionSkip: getDiscussionSkipView(room, viewerId),
    votesRevealed: gameView?.votesRevealed ?? false,
    dayVoteHistory: gameView?.dayVoteHistory ?? [],
    nightHistory: gameView?.nightHistory ?? [],
    hunterShots: gameView?.hunterShots ?? [],
    lastNightDeaths: gameView?.lastNightDeaths ?? [],
    lastEliminated: gameView?.lastEliminated ?? null,
    winner: gameView?.winner ?? null,
    chatLog: visibleChatLog(room, viewerId),
    log: gameView?.log ?? [],
  };
}
