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
          <p className="text-[10px] uppercase tracking-[0.25em] text-mist/50">Lịch sử đề cử</p>
          <h3 className="font-display text-base font-bold text-white">Ai → Ai</h3>
        </div>
        <span className="rounded-full bg-night-800 px-2 py-0.5 text-[10px] text-mist/60">
          Vòng {recap.round}
        </span>
      </div>

      {recap.mutations.length === 0 ? (
        <p className="text-sm text-mist/60">Không có phiếu đề cử.</p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {recap.mutations.map((m) => {
            const voter = playerMap.get(m.voterId);
            const isNoElim = m.choice.type === "NO_ELIMINATION";
            const targetId = m.choice.type === "PLAYER" ? m.choice.targetId : null;
            const target = targetId ? playerMap.get(targetId) : null;
            const prevIsNoElim = m.previousChoice?.type === "NO_ELIMINATION";
            const prevTargetId = m.previousChoice?.type === "PLAYER" ? m.previousChoice.targetId : null;
            const hasPrev = !!m.previousChoice;
            return (
              <div
                key={m.id}
                className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-night-800/60 px-2 py-1.5"
              >
                <span className="flex items-center gap-1 min-w-0 flex-1">
                  <Avatar avatar={avatars[m.voterId]} tint={tintFor(m.voterId)} alive className="h-6 w-6 shrink-0" />
                  <span className="truncate text-xs font-semibold text-white">{voter?.name ?? "?"}</span>
                </span>
                <span className="shrink-0 text-mist/60" aria-hidden="true">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M5 12h13M13 6l6 6-6 6" />
                  </svg>
                </span>
                <span className="flex items-center gap-1 min-w-0 flex-1 justify-end">
                  {isNoElim ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-mist/70">
                      <span>🚫</span> Không treo
                    </span>
                  ) : (
                    <>
                      <Avatar avatar={avatars[targetId!]} tint={tintFor(targetId!)} alive className="h-6 w-6 shrink-0" />
                      <span className="truncate text-xs font-medium text-mist/90">{target?.name ?? "?"}</span>
                    </>
                  )}
                </span>
                {hasPrev && (
                  <span className="ml-1 hidden text-[10px] text-mist/30 sm:inline" title="đổi phiếu">
                    ↻
                  </span>
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
            <div className="grid gap-1.5 sm:grid-cols-2">
              {recap.finalJudgment.ballots.map((b) => {
                const voter = playerMap.get(b.voterId);
                return (
                  <div
                    key={b.voterId}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 ${
                      b.guilty ? "border-blood-500/20 bg-blood-950/20" : "border-emerald-500/20 bg-emerald-950/20"
                    }`}
                  >
                    <Avatar avatar={avatars[b.voterId]} tint={tintFor(b.voterId)} alive className="h-6 w-6 shrink-0" />
                    <span className="truncate text-xs font-medium text-white flex-1">{voter?.name ?? "?"}</span>
                    <span
                      className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
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
