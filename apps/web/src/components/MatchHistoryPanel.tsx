"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  PERSONAL_WIN_LABELS,
  ROLE_META,
  momentLabel,
  outcomeHeadline,
  roleWonOutcome,
  type MatchHistoryEntry,
  type Team,
} from "@masoi/shared";
import {
  fetchMatchHistory,
  formatDurationClock,
  formatWhen,
  readStoredCaseFile,
  type HistoryOutcome,
} from "@/lib/match-history";
import { caseFileLetters } from "@/lib/last-letter";
import { LastLetterArchive } from "./LastLetterArchive";

/**
 * Số ván hiện lúc chưa mở rộng.
 *
 * Ba, không phải bảy. Thẻ này nằm ngay dưới nút "Tạo phòng mới" trên cùng một
 * cột, nên mỗi hàng thêm vào là một nhịp mắt kéo khỏi CTA; bảy hàng còn đủ dài
 * để đẩy chân cột ra ngoài màn 1366x768. Ba hàng trả lời đúng câu người ta hỏi
 * khi liếc qua - "ván vừa rồi thế nào" - phần còn lại nằm sau "Xem tất cả".
 */
const PREVIEW_COUNT = 3;

/**
 * Lịch sử các ván đã chơi.
 *
 * Chỉ hiện khi đã đăng nhập VÀ đã có ít nhất một ván: người mới vào không cần
 * nhìn một cái khung rỗng nói rằng họ chưa làm gì.
 */
export function MatchHistoryPanel() {
  const [outcome, setOutcome] = useState<HistoryOutcome | null>(null);
  /*
   * Mở rộng ngay trong thẻ chứ không điều hướng: dự án chưa có trang lịch sử,
   * và một link trỏ tới route không tồn tại còn tệ hơn không có link.
   */
  const [expanded, setExpanded] = useState(false);

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

  const hasMore = outcome.matches.length > PREVIEW_COUNT;
  const shown = expanded ? outcome.matches : outcome.matches.slice(0, PREVIEW_COUNT);

  return (
    <section
      className="card p-4 sm:p-[1.15rem] motion-safe:animate-riseIn"
      aria-labelledby="match-history-heading"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2
          id="match-history-heading"
          className="font-display text-base font-bold text-white sm:text-lg"
        >
          Ván của bạn gần đây
        </h2>

        {/*
          * Chỉ dựng nút khi thật sự còn ván bị giấu.
          *
          * Có đúng ba ván mà vẫn để "Xem tất cả" thì bấm vào không có gì xảy
          * ra - một tương tác giả, và người dùng chỉ cần bị lừa một lần là
          * thôi tin cả những nút còn lại.
          */}
        {hasMore && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls="match-history-list"
            className="shrink-0 rounded-md text-xs font-semibold text-mist-strong underline-offset-4 transition hover:text-white hover:underline sm:text-[0.8125rem]"
          >
            {expanded ? "Thu gọn" : `Xem tất cả (${outcome.matches.length})`}
          </button>
        )}
      </div>

      {/*
        * Chỉ khoá chiều cao KHI ĐÃ MỞ RỘNG.
        *
        * Ba hàng mặc định phải hiện trọn, không thanh cuộn: một vùng cuộn con
        * cao 205px nằm trong một trang vốn đã cuộn được là cái bẫy con lăn cổ
        * điển. Nhưng mở ra hai mươi ván trên màn 768px thì cả cột trái lẫn CTA
        * bị đẩy đi mất, nên lúc đó mới cần trần - tính theo svh để thanh địa
        * chỉ trên điện thoại không làm nó tràn.
        */}
      <ul
        id="match-history-list"
        className={
          expanded ? "max-h-[min(24rem,46svh)] space-y-2 overflow-y-auto pr-1" : "space-y-2"
        }
      >
        {shown.map((match) => (
          <MatchRow key={`${match.roomCode}-${match.endedAt}`} match={match} />
        ))}
      </ul>
    </section>
  );
}

/** Màu tên vai trong đội hình, theo phe. Xem `PANEL_ACCENT` ở `GameOverView`. */
const ROSTER_TEAM_TEXT: Record<Team, string> = {
  wolves: "text-blood-400/90",
  village: "text-emerald-300/90",
  neutral: "text-amber-300/90",
};

function MatchRow({ match }: { match: MatchHistoryEntry }) {
  const [open, setOpen] = useState(false);
  // Ván ghi trước khi hồ sơ được lưu thì không có gì để mở ra - hàng vẫn xem
  // được roster như cũ, chỉ thiếu phần bước ngoặt.
  const caseFile = readStoredCaseFile(match.caseFile);
  const letters = caseFileLetters(caseFile);

  // Thắng/thua tính theo PHE của vai mình cầm, không theo việc còn sống: sống
  // tới cuối trong một ván thua vẫn là thua.
  //
  // Trừ một đường thứ hai: thắng lợi CÁ NHÂN. Một Thằng Hề bị treo đã thắng
  // ván đó, kể cả khi phe thắng chung là phe nó không thuộc về - nên `myTeam`
  // một mình sẽ ghi "Thua" vào đúng ván mà người chơi đã thắng.
  /*
   * `!= null` bắt CẢ HAI, và đó là điểm mấu chốt chứ không phải một thói quen
   * viết code. `myPersonalWin` là optional vì server cũ không gửi nó (xem chú
   * thích của trường đó): `!== null` đọc `undefined` thành "có thắng cá nhân",
   * nên mọi ván thua đọc từ một server cũ đều hiện ra là "Thắng".
   *
   * `fetchMatchHistory` đã quy `undefined` về `null` ở biên, nên dòng này là
   * lớp thứ hai - và nó vẫn cần thiết: kiểu dữ liệu cho phép `undefined`, và
   * một chỗ đọc mới sau này sẽ không đi qua cái biên đó.
   */
  const myTeam = match.myRole ? ROLE_META[match.myRole].team : null;
  /*
   * `roleWonOutcome`, KHÔNG phải `match.winner === myTeam`.
   *
   * Phép so cũ trả `false` cho một ván mà chính người này thắng với tư cách Sát
   * Nhân (phe của vai đó là `neutral`), và cũng trả `false` cho ván hoà - vế
   * sau thì đúng và phải giữ.
   *
   * `winner` ở lịch sử có thêm giá trị `"unknown"`, thứ không phải một kết cục:
   * nó nghĩa là bản build này không đọc nổi cột đó. Với nó, câu trả lời đúng là
   * "không biết" chứ không phải "thua".
   */
  const knownOutcome = match.winner === null || match.winner === "unknown" ? null : match.winner;
  const won =
    myTeam === null || knownOutcome === null
      ? null
      : match.myPersonalWin != null || roleWonOutcome(match.myRole!, knownOutcome);

  return (
    <li className="rounded-lg border border-white/[0.08] bg-night-800/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-night-700/45"
      >
        <span
          aria-hidden="true"
          className={`h-9 w-1 shrink-0 rounded-full ${
            won === null ? "bg-mist/30" : won ? "bg-emerald-500" : "bg-blood-500"
          }`}
        />

        <span className="min-w-0 flex-1">
          {/*
            * Dòng một: kết quả - vai - sống chết.
            *
            * Chữ "Thắng"/"Thua" mang nghĩa, màu chỉ nhắc lại nó. Dấu ✓/✕ là
            * nấc thứ ba: trên màn ám vàng hoặc với mắt không tách được đỏ -
            * lục, hình dáng vẫn khác nhau ngay từ cái liếc đầu.
            */}
          <span className="flex flex-wrap items-baseline gap-x-1.5 text-sm leading-snug">
            <span
              className={`inline-flex items-baseline gap-1 font-bold ${
                won === null ? "text-mist-strong" : won ? "text-emerald-300" : "text-blood-400"
              }`}
            >
              {won !== null && (
                <span aria-hidden="true" className="text-[0.7rem] font-black">
                  {won ? "✓" : "✕"}
                </span>
              )}
              {won === null ? "Đã chơi" : won ? "Thắng" : "Thua"}
            </span>

            {/* Ván cũ không lưu vai mình cầm thì không suy ra được thắng thua;
              * nói phe nào thắng để hàng vẫn còn một câu trả lời. */}
            {match.myRole ? (
              <Meta className="text-mist-bright">{ROLE_META[match.myRole].name}</Meta>
            ) : (
              <Meta>{knownOutcome === null ? "Không rõ kết quả" : outcomeHeadline(knownOutcome)}</Meta>
            )}

            {match.mySurvived !== null && (
              <Meta>{match.mySurvived ? "Đã sống" : "Đã chết"}</Meta>
            )}
          </span>

          {/*
            * Dòng hai, ở 13px và mist-strong chứ không phải 11px ở mist/55.
            *
            * Đo trên nền hàng đã dựng thật (#0c1321): nấc cũ ra 3.65:1, dưới
            * ngưỡng AA - mà đây đúng là dòng chứa mốc thời gian, thứ người ta
            * quét mắt tìm trước nhất. Nấc mới ra 10.47:1.
            *
            * Ba mẩu ngắn với thời lượng ở dạng đồng hồ vừa đủ một dòng trên
            * khung 375px, nên không phải cắt đuôi bằng `truncate` nữa.
            */}
          <span className="mt-1 block text-[0.8125rem] leading-snug text-mist-strong/85">
            {momentLabel(match.rounds, "day")} · {formatDurationClock(match.durationSec)} ·{" "}
            {formatWhen(match.endedAt)}
          </span>
        </span>

        {/* Mũi tên: đậm hơn hẳn mist/40 của bản cũ, nhưng vẫn là nét mảnh
          * không nền - nó chỉ nói rằng hàng bấm được, không tranh chỗ với kết
          * quả ván. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 shrink-0 text-mist-strong/70 group-hover:text-white motion-safe:transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
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

      {/* Xem lại phong thư trong lịch sử trận. Dữ liệu nằm trong chính JSON hồ
        * sơ đã lưu, nên không cần thêm cột nào; ván ghi trước tính năng này chỉ
        * đơn giản là không có mục này. */}
      {open && letters.length > 0 && (
        <div className="border-t border-white/[0.06] px-3 py-2.5">
          <LastLetterArchive letters={letters} compact />
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
              <span className={`shrink-0 ${ROSTER_TEAM_TEXT[ROLE_META[player.role].team]}`}>
                {ROLE_META[player.role].name}
                {/* Huy hiệu thắng cá nhân đứng ngay cạnh vai, vì nó chỉ có
                  * nghĩa khi đọc cùng vai đó. Ván ghi trước bản này không có
                  * trường này và đơn giản là không có huy hiệu. */}
                {player.personalWin && (
                  <span className="ml-1 text-amber-300" title={PERSONAL_WIN_LABELS[player.personalWin.condition]}>
                    ★
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Một mẩu thông tin phụ ở dòng đầu, kèm dấu chấm ngăn với mẩu đứng trước.
 *
 * Dấu chấm nằm TRONG cùng một `inline-flex` với chữ nó dẫn vào, không phải là
 * một phần tử anh em: dòng này `flex-wrap`, và ở khung 320px "Đã sống" bị đẩy
 * xuống dòng dưới trong khi dấu chấm ở lại - kết thúc dòng trên bằng một dấu
 * chấm mồ côi. Gói lại thì cả cụm cùng xuống dòng.
 *
 * aria-hidden trên dấu chấm: trình đọc màn hình đã có quãng nghỉ tự nhiên giữa
 * các span, thêm "dấu chấm giữa" vào mỗi khoảng chỉ là tiếng ồn.
 */
function Meta({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span aria-hidden="true" className="text-mist/45">
        ·
      </span>
      <span className={className ?? "text-mist-strong/85"}>{children}</span>
    </span>
  );
}
