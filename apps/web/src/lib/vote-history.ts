import type { DayVoteRecap, PublicVoteChoice } from "@masoi/shared";

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
