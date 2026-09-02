import { momentLabel, roundsLabel, type CaseDeathCause, type CaseFile } from "@masoi/shared";

/** Nhãn nguyên nhân cho dòng thời gian ngắn. Gộp cả ba nguồn chết về một cách đọc. */
const CAUSE_LABEL: Record<CaseDeathCause, string> = {
  wolf: "bị Sói cắn",
  poison: "trúng độc",
  priest: "bị Nước thánh thanh tẩy",
  priest_backfire: "chết vì Nước thánh phản phệ",
  lynch: "bị làng treo cổ",
  hunter: "trúng đạn Thợ Săn",
};

/**
 * Hồ sơ vụ án của một ván đã kết thúc.
 *
 * Chỉ nhận `CaseFile` đã dựng sẵn - component này không tự đọc snapshot và
 * không tự kiểm tra pha. Cổng bảo mật nằm ở `buildCaseFile`, và chỗ gọi chỉ vẽ
 * khi hàm đó trả về khác `null`.
 */
export function CaseFileCard({ file }: { file: CaseFile }) {
  const wolvesWin = file.winner === "wolves";
  const accent = wolvesWin ? "text-blood-400" : "text-emerald-300";

  return (
    <section className="card space-y-4" aria-labelledby="case-file-heading">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.3em] text-mist">Hồ sơ vụ án</p>
          <h3 id="case-file-heading" className={`font-display text-xl font-bold ${accent}`}>
            {file.caseId}
          </h3>
        </div>
        <p className="text-[13px] text-mist-strong">
          {roundsLabel(file.rounds)} · {file.cast.length} người chơi
        </p>
      </header>

      {file.fallback ? (
        <p className="rounded-lg bg-night-800/50 px-3 py-3 text-sm leading-relaxed text-mist-strong">
          {file.highlights[0].description}
        </p>
      ) : (
        <ol className="space-y-2">
          {file.highlights.map((highlight, index) => (
            <li
              key={`${highlight.type}-${highlight.round}-${highlight.phase}-${index}`}
              className="rounded-lg border border-white/[0.05] bg-night-800/50 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                    highlight.phase === "night"
                      ? "bg-night-700 text-mist-bright"
                      : "bg-amber-900/40 text-amber-300"
                  }`}
                >
                  {momentLabel(highlight.round, highlight.phase)}
                </span>
                <h4 className="min-w-0 font-display text-base font-bold text-white">
                  {highlight.title}
                </h4>
              </div>
              {/* break-words: biệt danh dài viết liền không được đẩy ngang cả thẻ. */}
              <p className="mt-1 break-words text-sm leading-relaxed text-mist-strong">{highlight.description}</p>
            </li>
          ))}
        </ol>
      )}

      {file.timeline.length > 0 && (
        <div className="border-t border-white/[0.06] pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-mist">
            Dòng thời gian
          </p>
          <ol className="space-y-1">
            {file.timeline.map((entry, index) => (
              <li
                key={`${entry.round}-${entry.phase}-${entry.playerId}-${index}`}
                className="flex flex-wrap items-baseline gap-x-1.5 text-[13px]"
              >
                <span className="shrink-0 text-mist">
                  {momentLabel(entry.round, entry.phase)}
                </span>
                <span className="min-w-0 break-words font-semibold text-white">{entry.name}</span>
                <span className="text-mist-strong">
                  {entry.kind === "cursed-turned"
                    ? "hoá Ma Sói"
                    : CAUSE_LABEL[entry.cause ?? "wolf"]}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
