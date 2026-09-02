"use client";

import { useEffect, useState } from "react";
import { ROLE_META, momentLabel, roundsLabel, type MatchHistoryEntry } from "@masoi/shared";
import {
  fetchMatchHistory,
  formatDuration,
  formatWhen,
  readStoredCaseFile,
  type HistoryOutcome,
} from "@/lib/match-history";

/**
 * Lịch sử các ván đã chơi.
 *
 * Chỉ hiện khi đã đăng nhập VÀ đã có ít nhất một ván: người mới vào không cần
 * nhìn một cái khung rỗng nói rằng họ chưa làm gì.
 */
export function MatchHistoryPanel() {
  const [outcome, setOutcome] = useState<HistoryOutcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    void fetchMatchHistory(controller.signal).then((result) => {
      if (alive) setOutcome(result);
    });

    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  // Đang tải, chưa đăng nhập, hoặc chưa có ván nào: không chiếm chỗ trên màn.
  if (!outcome) return null;
  if (outcome.kind === "anonymous") return null;
  if (outcome.kind === "error") {
    return (
      <p className="text-xs text-mist/60">
        Không tải được lịch sử ván. Thử tải lại trang.
      </p>
    );
  }
  if (outcome.matches.length === 0) return null;

  return (
    <section className="card" aria-labelledby="match-history-heading">
      <h2
        id="match-history-heading"
        className="mb-3 font-display text-lg font-bold text-white"
      >
        Ván gần đây
      </h2>
      <ul className="space-y-2">
        {outcome.matches.map((match) => (
          <MatchRow key={`${match.roomCode}-${match.endedAt}`} match={match} />
        ))}
      </ul>
    </section>
  );
}

function MatchRow({ match }: { match: MatchHistoryEntry }) {
  const [open, setOpen] = useState(false);
  // Ván ghi trước khi hồ sơ được lưu thì không có gì để mở ra - hàng vẫn xem
  // được roster như cũ, chỉ thiếu phần bước ngoặt.
  const caseFile = readStoredCaseFile(match.caseFile);

  // Thắng/thua tính theo PHE của vai mình cầm, không theo việc còn sống: sống
  // tới cuối trong một ván thua vẫn là thua.
  const myTeam = match.myRole ? ROLE_META[match.myRole].team : null;
  const won = myTeam === null ? null : match.winner === myTeam;
  const wolvesWon = match.winner === "wolves";

  return (
    <li className="overflow-hidden rounded-lg border border-white/[0.06] bg-night-800/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-night-700/40"
      >
        <span
          aria-hidden="true"
          className={`h-8 w-1 shrink-0 rounded-full ${
            won === null ? "bg-mist/30" : won ? "bg-emerald-500" : "bg-blood-500"
          }`}
        />

        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span
              className={`text-sm font-bold ${
                won === null ? "text-mist/80" : won ? "text-emerald-300" : "text-blood-400"
              }`}
            >
              {won === null ? "Đã chơi" : won ? "Thắng" : "Thua"}
            </span>
            {match.myRole && (
              <span className="truncate text-xs text-mist/70">
                {ROLE_META[match.myRole].name}
                {match.mySurvived === false && " · đã chết"}
              </span>
            )}
          </span>
          {/*
            * Cho XUỐNG DÒNG, không cắt bằng `truncate`.
            *
            * Bốn mẩu thông tin này cần 276px mà khung điện thoại 375px chỉ chừa
            * 234px, nên `truncate` nuốt mất phần đuôi - đúng chỗ đặt mốc thời
            * gian, thứ người ta quét mắt tìm trước nhất ở một danh sách lịch
            * sử. Thà hai dòng còn hơn mất câu trả lời cho "ván này từ bao giờ".
            */}
          <span className="mt-0.5 block text-[11px] leading-snug text-mist/55">
            {wolvesWon ? "Ma Sói thắng" : "Dân Làng thắng"} · {roundsLabel(match.rounds)} ·{" "}
            {formatDuration(match.durationSec)} · {formatWhen(match.endedAt)}
          </span>
        </span>

        <span aria-hidden="true" className="shrink-0 text-mist/40">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && caseFile && (
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          <p className="mb-1.5 text-[10px] uppercase tracking-[0.28em] text-mist/55">
            {caseFile.fallback ? "Hồ sơ vụ án" : "Bước ngoặt"}
          </p>
          <ol className="space-y-1.5">
            {caseFile.highlights.map((highlight, index) => (
              <li key={`${highlight.type}-${highlight.round}-${index}`} className="text-xs">
                <span className="text-mist/50">
                  {momentLabel(highlight.round, highlight.phase)}
                </span>{" "}
                <span className="font-semibold text-white/90">{highlight.title}</span>
                <span className="block text-mist/70">{highlight.description}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {open && (
        <ul className="space-y-1 border-t border-white/[0.06] px-3 py-2">
          {match.players.map((player, index) => (
            <li
              key={player.id ?? `${player.name}-${index}`}
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <span
                className={`truncate ${
                  player.alive ? "text-white/90" : "text-mist/50 line-through"
                }`}
              >
                {player.name}
              </span>
              <span
                className={`shrink-0 ${
                  ROLE_META[player.role].team === "wolves"
                    ? "text-blood-400/90"
                    : "text-emerald-300/90"
                }`}
              >
                {ROLE_META[player.role].name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
