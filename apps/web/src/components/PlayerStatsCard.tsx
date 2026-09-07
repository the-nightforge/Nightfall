"use client";

import { useEffect, useState } from "react";
import { ROLE_META, roleTeam } from "@masoi/shared";
import { bestRoles, fetchPlayerStats, formatPercent, streakLabel, teamLine, type StatsOutcome } from "@/lib/player-stats";
import { RoleGlyph } from "./RoleGlyph";

const BEST_ROLE_COUNT = 3;

/**
 * "Hồ sơ của bạn": thẻ trên trang chủ, ngay trên lịch sử ván.
 *
 * Tự ẩn khi chưa đăng nhập, khi server chưa có endpoint, và khi chưa có ván
 * nào - cùng lối với `MatchHistoryPanel`: người mới không cần một khung rỗng
 * nói rằng họ chưa làm gì. Bốn con số lớn là thứ người ta liếc; vai thắng
 * tốt nhất là thứ người ta khoe; phần theo phe và toàn bộ vai thu gọn lại.
 */
export function PlayerStatsCard() {
  const [outcome, setOutcome] = useState<StatsOutcome | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void fetchPlayerStats(controller.signal).then((result) => {
      if (alive) setOutcome(result);
    });
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  if (!outcome || outcome.kind !== "ok" || outcome.stats.games === 0) return null;
  const stats = outcome.stats;
  const best = bestRoles(stats, BEST_ROLE_COUNT);

  return (
    <section className="card p-4 sm:p-[1.15rem] motion-safe:animate-riseIn" aria-labelledby="player-stats-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="player-stats-heading" className="font-display text-base font-bold text-white sm:text-lg">
          Hồ sơ của bạn
        </h2>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="player-stats-detail"
          className="shrink-0 rounded-md text-xs font-semibold text-mist-strong underline-offset-4 transition hover:text-white hover:underline sm:text-[0.8125rem]"
        >
          {expanded ? "Thu gọn" : "Chi tiết"}
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Ván đã chơi" value={String(stats.games)} />
        <Tile label="Tỉ lệ thắng" value={formatPercent(stats.winRate)} hint={`${stats.wins} thắng`} />
        <Tile label="Chuỗi thắng" value={String(stats.currentStreak)} hint={streakLabel(stats)} />
        <Tile label="Sống sót" value={formatPercent(stats.survivalRate)} hint={`${stats.survived} ván`} />
      </dl>

      {best.length > 0 && (
        <div className="mt-4">
          <p className="lobby-kicker">Vai thắng tốt nhất</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {best.map((r) => (
              <li key={r.role} className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-2.5 py-2">
                <RoleGlyph role={r.role} team={roleTeam(r.role)} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-white">{ROLE_META[r.role].name}</span>
                  <span className="block text-xs text-mist/85">
                    {r.wins}/{r.games} thắng · {formatPercent(r.wins / r.games)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div id="player-stats-detail" hidden={!expanded} className="mt-4 space-y-4">
        <div>
          <p className="lobby-kicker">Theo phe</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {teamLine(stats).map((t) => (
              <li key={t.team} className="rounded-full border border-white/10 px-3 py-1 text-xs text-mist">
                <span className="font-semibold text-white">{t.label}</span> {t.wins}/{t.games}
              </li>
            ))}
            {stats.personalWins > 0 && (
              <li className="rounded-full border border-amber-400/30 bg-amber-900/20 px-3 py-1 text-xs text-amber-100">
                Thắng cá nhân {stats.personalWins}
              </li>
            )}
          </ul>
        </div>
        <div>
          <p className="lobby-kicker">Tất cả vai đã chơi</p>
          <ul className="mt-2 divide-y divide-white/[0.07]">
            {stats.byRole.map((r) => (
              <li key={r.role} className="flex items-center gap-2.5 py-1.5 text-sm">
                <RoleGlyph role={r.role} team={roleTeam(r.role)} />
                <span className="flex-1 text-white">{ROLE_META[r.role].name}</span>
                <span className="text-mist/85">
                  {r.wins}/{r.games} · {formatPercent(r.wins / r.games)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-mist/85">{label}</dt>
      <dd className="mt-0.5 font-display text-2xl font-bold text-white">{value}</dd>
      {hint && <dd className="text-xs text-mist/85">{hint}</dd>}
    </div>
  );
}
