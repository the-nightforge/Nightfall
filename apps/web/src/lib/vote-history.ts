import type { DayVoteRecap, PublicVoteChoice, RoomSnapshot } from "@masoi/shared";

const LEFT_ROOM = "Người chơi đã rời phòng";

function playerName(playerId: string, names: Map<string, string>): string {
  return names.get(playerId) ?? LEFT_ROOM;
}

function choiceLabel(choice: PublicVoteChoice, names: Map<string, string>): string {
  return choice.type === "PLAYER" ? playerName(choice.targetId, names) : "Không treo ai";
}

export function formatVoteMutations(recap: DayVoteRecap, names: Map<string, string>): string[] {
  return recap.mutations.map((mutation) => {
    const voter = playerName(mutation.voterId, names);
    const choice = choiceLabel(mutation.choice, names);
    if (!mutation.previousChoice) return `${voter} → ${choice}`;
    return `${voter}: ${choiceLabel(mutation.previousChoice, names)} → ${choice}`;
  });
}

export function formatFinalBallots(recap: DayVoteRecap, names: Map<string, string>): string[] {
  return (recap.finalJudgment?.ballots ?? []).map(
    (ballot) => `${playerName(ballot.voterId, names)}: ${ballot.guilty ? "HANG" : "SPARE"}`,
  );
}

/**
 * Bảng phiếu ĐANG MỞ, đọc thẳng từ snapshot.
 *
 * Cố ý cùng dạng "người bỏ → lựa chọn" với lịch sử đã chốt: cùng một loại thông
 * tin thì phải đọc giống nhau, người chơi không việc gì phải học hai cách đọc
 * cho vòng đề cử và cho recap của chính nó.
 */
export function formatOpenBallots(
  openBallots: RoomSnapshot["openBallots"],
  names: Map<string, string>,
): string[] {
  return (openBallots ?? []).map(
    (ballot) => `${playerName(ballot.voterId, names)} → ${choiceLabel(ballot.choice, names)}`,
  );
}
