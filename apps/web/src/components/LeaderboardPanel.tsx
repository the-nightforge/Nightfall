"use client";

import { useEffect, useState } from "react";
import type { LeaderboardEntry } from "@masoi/shared";
import { tintFor } from "@/lib/avatar";
import { fetchLeaderboard, initialOf, myStanding, pointsRule, type LeaderboardOutcome } from "@/lib/leaderboard";
import { formatPercent } from "@/lib/player-stats";

/**
 * Bảng xếp hạng 30 ngày trên trang chủ.
 *
 * Hiện cho cả người chưa đăng nhập - đó là phần "trò này có người chơi" của
 * trang chủ, và cũng là lý do người ta muốn có một cái tên trên đó. Chỉ ẩn
 * khi server chưa có endpoint hoặc không trả lời; bảng rỗng thì vẫn đứng đó
 * với một câu mời, vì một bảng trống có tên luật chơi còn hơn một khoảng
 * trắng không giải thích.
 */
export function LeaderboardPanel() {
  const [outcome, setOutcome] = useState<LeaderboardOutcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void fetchLeaderboard(controller.signal).then((result) => {
      if (alive) setOutcome(result);
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  if (!outcome || outcome.kind !== "ok") return null;
  const { view, loggedIn } = outcome;
  const standing = myStanding(view, loggedIn);
  const meId = view.me?.playerId ?? null;

  return (
    <section className="card p-4 sm:p-[1.15rem] motion-safe:animate-riseIn" aria-labelledby="leaderboard-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="leaderboard-heading" className="font-display text-base font-bold text-white sm:text-lg">
          Bảng xếp hạng {view.windowDays} ngày
        </h2>
        <span className="shrink-0 text-xs text-mist/70">Top {view.entries.length || "…"}</span>
      </div>

      {view.entries.length === 0 ? (
        <p className="text-sm text-mist/80">
          Chưa ai đủ {view.minGames} ván với {view.minHumans} người thật trong {view.windowDays} ngày qua. Rủ bạn bè vào
          một bàn là có tên đầu tiên.
        </p>
      ) : (
        <ol className="divide-y divide-white/[0.06]">
          {view.entries.map((entry) => (
            <Row key={entry.playerId} entry={entry} mine={entry.playerId === meId} />
          ))}
        </ol>
      )}

      {standing && (
        <p className="mt-3 rounded-lg border border-indigo-400/25 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100" role="status">
          {standing}
        </p>
      )}
      <p className="mt-2 text-xs text-mist/60">{pointsRule(view)}</p>
    </section>
  );
}

function Row({ entry, mine }: { entry: LeaderboardEntry; mine: boolean }) {
  const top = entry.rank <= 3;
  return (
    <li
      className={`flex items-center gap-3 py-2 ${mine ? "-mx-2 rounded-lg bg-indigo-500/15 px-2" : ""}`}
      aria-current={mine ? "true" : undefined}
    >
      <span
        className={`w-6 shrink-0 text-center font-display text-base font-bold ${
          top ? "text-amber-300" : "text-mist/70"
        }`}
      >
        {entry.rank}
      </span>
      {entry.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={entry.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full border border-white/10 object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 text-sm font-bold text-white"
          style={{ background: tintFor(entry.playerId) }}
        >
          {initialOf(entry.nickname)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-white">
          {entry.nickname}
          {mine && <span className="ml-1.5 text-xs font-normal text-indigo-200">(bạn)</span>}
        </span>
        <span className="block text-xs text-mist/70">
          {entry.wins}/{entry.games} thắng · {formatPercent(entry.winRate)}
        </span>
      </span>
      <span className="shrink-0 font-display text-lg font-bold text-white">
        {entry.points}
        <span className="ml-1 text-xs font-normal text-mist/60">đ</span>
      </span>
    </li>
  );
}
