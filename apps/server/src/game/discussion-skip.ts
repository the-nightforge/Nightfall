import type { DiscussionSkipView } from "@masoi/shared";
import type { Room } from "../rooms/store";

export const discussionSkipVotes = new Map<string, Set<string>>();

export type DiscussionSkipUpdate =
  | { ok: true; unanimous: boolean }
  | { ok: false; error: string };

export function clearDiscussionSkipVotes(code: string): void {
  discussionSkipVotes.delete(code);
}

export function getDiscussionSkipView(
  room: Room,
  viewerId: string,
): DiscussionSkipView | null {
  if (!room.engine || room.engine.getState().phase !== "DAY_DISCUSSION") return null;

  const eligible = eligibleHumanIds(room);
  if (eligible.size === 0) return null;
  const votes = normalizedVotes(room, eligible);

  return {
    votes: votes.size,
    required: eligible.size,
    hasVoted: votes.has(viewerId),
    canVote: eligible.has(viewerId),
  };
}

export function updateDiscussionSkipVote(
  room: Room,
  playerId: string,
  skip: boolean,
): DiscussionSkipUpdate {
  if (!room.engine || room.engine.getState().phase !== "DAY_DISCUSSION") {
    return { ok: false, error: "Chỉ có thể skip trong lúc thảo luận" };
  }

  const member = room.members.find((candidate) => candidate.playerId === playerId);
  if (!member) return { ok: false, error: "Bạn không ở trong phòng này" };
  if (member.isBot) return { ok: false, error: "Bot không thể skip thảo luận" };

  const eligible = eligibleHumanIds(room);
  if (!eligible.has(playerId)) {
    return { ok: false, error: "Chỉ người chơi còn sống mới được skip thảo luận" };
  }

  const votes = normalizedVotes(room, eligible, true);
  if (skip) votes.add(playerId);
  else votes.delete(playerId);

  return { ok: true, unanimous: eligible.size > 0 && votes.size === eligible.size };
}

export function hasUnanimousDiscussionSkip(room: Room): boolean {
  if (!room.engine || room.engine.getState().phase !== "DAY_DISCUSSION") return false;
  const eligible = eligibleHumanIds(room);
  if (eligible.size === 0) return false;
  return normalizedVotes(room, eligible).size === eligible.size;
}

function eligibleHumanIds(room: Room): Set<string> {
  if (!room.engine || room.engine.getState().phase !== "DAY_DISCUSSION") return new Set();

  const statePlayers = new Map(
    room.engine.getState().players.map((player) => [player.id, player]),
  );
  return new Set(
    room.members
      .filter((member) => !member.isBot && statePlayers.get(member.playerId)?.alive)
      .map((member) => member.playerId),
  );
}

function normalizedVotes(
  room: Room,
  eligible: Set<string>,
  create = false,
): Set<string> {
  let votes = discussionSkipVotes.get(room.code);
  if (!votes) {
    votes = new Set();
    if (create) discussionSkipVotes.set(room.code, votes);
  }
  for (const playerId of votes) {
    if (!eligible.has(playerId)) votes.delete(playerId);
  }
  return votes;
}
