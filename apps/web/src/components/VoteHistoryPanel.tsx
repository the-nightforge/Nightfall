import type { DayVoteRecap, RoomSnapshot } from "@masoi/shared";
import { assignAvatars, tintFor } from "@/lib/avatar";
import { Avatar } from "./Avatar";
import { useMemo } from "react";

interface Props {
  recap: DayVoteRecap;
  players: RoomSnapshot["players"];
}

export function VoteHistoryPanel({ recap, players }: Props) {
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const avatars = useMemo(() => assignAvatars(players.map((p) => p.id)), [players]);

  return (
    <section className="card space-y-3" aria-label="Lịch sử phiếu">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-mist/50">Lịch sử bỏ phiếu</p>
        </div>
        <span className="rounded-full bg-night-800 px-2 py-0.5 text-[10px] text-mist/60">
          Vòng {recap.round}
        </span>
      </div>

      {recap.mutations.length === 0 ? (
        <p className="text-sm text-mist/60">Không có ai bỏ phiếu.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {recap.mutations.map((m) => {
            const voter = playerMap.get(m.voterId);
            const isNoElim = m.choice.type === "NO_ELIMINATION";
            const targetId = m.choice.type === "PLAYER" ? m.choice.targetId : null;
            const target = targetId ? playerMap.get(targetId) : null;
            return (
              <div
                key={m.id}
                className="inline-flex items-center gap-1 rounded-full border border-white/[0.08] bg-night-800 px-2 py-1"
              >
                <Avatar avatar={avatars[m.voterId]} tint={tintFor(m.voterId)} alive className="h-5 w-5 shrink-0" />
                <span className="text-[11px] font-medium text-white">{voter?.name ?? "?"}</span>
                <span className="text-mist/30">→</span>
                {isNoElim ? (
                  <span className="text-[11px] text-mist/60">🚫</span>
                ) : (
                  <>
                    <Avatar avatar={avatars[targetId!]} tint={tintFor(targetId!)} alive className="h-5 w-5 shrink-0" />
                    <span className="text-[11px] text-mist/80">{target?.name ?? "?"}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {recap.finalJudgment && (
        <div className="border-t border-white/[0.08] pt-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-mist/60">
            Phán quyết · {recap.finalJudgment.guilty} treo · {recap.finalJudgment.innocent} tha · {recap.finalJudgment.abstain} bỏ qua
          </p>
          {recap.finalJudgment.ballots.length === 0 ? (
            <p className="text-sm text-mist/60">Không có phiếu xác nhận.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {recap.finalJudgment.ballots.map((b) => {
                const voter = playerMap.get(b.voterId);
                return (
                  <div
                    key={b.voterId}
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${
                      b.guilty ? "border-blood-500/20 bg-blood-950/20" : "border-emerald-500/20 bg-emerald-950/20"
                    }`}
                  >
                    <Avatar avatar={avatars[b.voterId]} tint={tintFor(b.voterId)} alive className="h-5 w-5 shrink-0" />
                    <span className="text-[11px] font-medium text-white">{voter?.name ?? "?"}</span>
                    <span
                      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        b.guilty ? "bg-blood-600 text-white" : "bg-emerald-600 text-white"
                      }`}
                      title={b.guilty ? "Treo" : "Tha"}
                    >
                      {b.guilty ? "✕" : "✓"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
