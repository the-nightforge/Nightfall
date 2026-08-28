import type { DayVoteRecap, RoomSnapshot } from "@masoi/shared";
import { formatFinalBallots, formatVoteMutations } from "@/lib/vote-history";

interface Props {
  recap: DayVoteRecap;
  players: RoomSnapshot["players"];
}

export function VoteHistoryPanel({ recap, players }: Props) {
  const names = new Map(players.map((player) => [player.id, player.name]));
  const mutations = formatVoteMutations(recap, names);
  const finalBallots = formatFinalBallots(recap, names);

  return (
    <section className="card space-y-3" aria-label="Lịch sử phiếu">
      <div>
        <p className="text-xs uppercase tracking-[0.25em] text-mist/50">Lịch sử đề cử</p>
        <h3 className="mt-1 font-display text-xl font-bold text-white">Ai đã bỏ phiếu cho ai</h3>
      </div>
      <VoteLines lines={mutations} empty="Không có phiếu đề cử." />
      {recap.finalJudgment && (
        <div className="border-t border-white/[0.08] pt-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-mist/60">Phán quyết</p>
          <VoteLines lines={finalBallots} empty="Không có phiếu xác nhận." />
        </div>
      )}
    </section>
  );
}

function VoteLines({ lines, empty }: { lines: string[]; empty: string }) {
  if (lines.length === 0) return <p className="text-sm text-mist/60">{empty}</p>;
  return (
    <ol className="space-y-1.5 text-sm text-mist/80">
      {lines.map((line, index) => (
        <li key={`${index}:${line}`}>{line}</li>
      ))}
    </ol>
  );
}
