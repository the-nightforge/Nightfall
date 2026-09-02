"use client";

import { useMemo } from "react";
import { m } from "motion/react";
import {
  buildCaseFile,
  momentLabel,
  roundsLabel,
  ROLE_META,
  type CaseHighlight,
  type PlayerView,
  type RoomSnapshot,
  type Team,
} from "@masoi/shared";
import type { AvatarId } from "@/lib/avatar-art";
import { assignAvatars, breathOffsetFor, tintFor } from "@/lib/avatar";
import { roleLabel } from "@/lib/cursed";
import {
  decisiveHighlight,
  personalOutcome,
  winnerCopy,
  type PersonalOutcome,
} from "@/lib/game-over-summary";
import { Avatar } from "./Avatar";
import { CaseFileCard } from "./CaseFileCard";
import { CaseShareCard } from "./CaseShareCard";
import { HunterShotTimeline } from "./HunterShotTimeline";
import { NightRecapTimeline } from "./NightRecapTimeline";

interface Props {
  snapshot: RoomSnapshot;
  isHost: boolean;
  onReset: () => void;
  onLeave: () => void;
}

/** Bảng màu theo phe thắng. Một chỗ khai báo, mọi khối trong màn đọc lại từ đây. */
const ACCENT = {
  wolves: {
    text: "text-blood-400",
    border: "border-blood-500/70",
    ring: "ring-blood-500/50",
    glow: "radial-gradient(900px 520px at 50% 12%, rgba(220, 38, 64, 0.18), transparent 70%)",
  },
  village: {
    text: "text-emerald-300",
    border: "border-emerald-500/60",
    ring: "ring-emerald-500/50",
    glow: "radial-gradient(900px 520px at 50% 12%, rgba(52, 178, 140, 0.16), transparent 70%)",
  },
} as const;

/**
 * Màn kết thúc ván.
 *
 * Thứ tự các khối là thứ tự CÂU HỎI người chơi hỏi khi chuông vừa dứt:
 *
 *   1. Phe nào thắng, và TÔI thắng hay thua (thẻ hero)
 *   2. Làm gì tiếp (một CTA duy nhất)
 *   3. Ai là ai (bảng vai trò hai phe)
 *   4. Chuyện gì đã xảy ra (diễn biến, mặc định thu gọn)
 *   5. Khoe với bạn bè (chia sẻ)
 *
 * Mặt của phe thắng nằm NGAY trong thẻ hero chứ không đợi tới bảng vai trò: đó
 * là phần "lật bài" mà ai cũng muốn xem trong hai giây đầu, còn bảng đầy đủ
 * mười lăm dòng là thứ để TRA CỨU sau. Vì vậy CTA đứng trước bảng đó - trên
 * điện thoại, để CTA sau hai bảng vai trò là bắt người chơi cuộn hết một màn
 * hình rưỡi mới thấy đường về phòng chờ.
 *
 * Bản cũ đặt "Chơi lại" và "Chia sẻ hồ sơ" ở hai chỗ khác nhau với CÙNG một
 * hình dáng nút đỏ, nên không có hành động nào là hành động chính. Giờ chỉ
 * `btn-cta` về phòng chờ là hạng nhất; chia sẻ tụt xuống hạng hai trong thẻ
 * chia sẻ, tải ảnh và sao chép xuống hạng ba, rời phòng là chữ nhạt sắc đỏ.
 *
 * MÀU cũng phải nói đúng nghĩa, không chỉ kích cỡ. CTA về phòng chờ mang sắc
 * xanh chiến thắng (`btn-cta-win`) chứ không phải đỏ thương hiệu: đỏ ở màn này
 * được để dành cho đường thoát ra. Nếu cả hai cùng đỏ thì thứ bậc chỉ còn nằm ở
 * cỡ nút, và người vừa đọc xong "Phe Ma Sói chiến thắng" bằng chữ đỏ sẽ thấy
 * đúng sắc đỏ đó trên nút đi tiếp lẫn nút rời đi.
 */
export function GameOverView({ snapshot, isHost, onReset, onLeave }: Props) {
  const wolvesWin = snapshot.winner === "wolves";
  const accent = wolvesWin ? ACCENT.wolves : ACCENT.village;
  const copy = winnerCopy(wolvesWin ? "wolves" : "village");
  const roster = snapshot.players.map((p) => p.id).join(",");
  const avatars = useMemo(() => assignAvatars(roster ? roster.split(",") : []), [roster]);

  // Chủ phòng mất kết nối ở màn này thì không ai bấm được nút về phòng chờ -
  // server đã cho phép người khác thay thế sau một khoảng ân hạn, ở đây chỉ cần
  // lộ nút ra khi chủ phòng đang offline. Bấm sớm quá thì lỗi từ server tự hiện.
  const hostConnected = snapshot.players.find((p) => p.id === snapshot.hostId)?.connected ?? true;
  const canReset = isHost || !hostConnected;

  // Phe lấy từ role sau khi ván kết thúc, nên Kẻ Nguyền Rủa đã hoá Sói tự nằm
  // đúng bên Sói - engine đã đổi hẳn vai chứ không gắn cờ.
  const byTeam = (team: Team) =>
    snapshot.players.filter((p) => p.role && ROLE_META[p.role].team === team);
  const wolves = byTeam("wolves");
  const village = byTeam("village");
  const winners = wolvesWin ? wolves : village;

  /*
   * Hồ sơ vụ án. `buildCaseFile` tự gác pha và trả null nếu ván chưa thật sự
   * kết thúc, nên ở đây KHÔNG kiểm tra pha lần nữa - một cổng, một chỗ.
   */
  const caseFile = useMemo(() => buildCaseFile(snapshot), [snapshot]);

  // Kết quả cá nhân và bước ngoặt phải sống ở TRANG, không chỉ trong ảnh chia
  // sẻ: ở bản cũ chỉ tấm thumbnail mới nói được ván này ngoặt ở đâu.
  const outcome = personalOutcome(snapshot);
  const decisive = caseFile ? decisiveHighlight(caseFile) : null;

  // Chỉ có ở trình duyệt. Trên server render thì để rỗng và lời mời rơi về
  // đúng đường dẫn tương đối thay vì một origin bịa ra.
  const shareOrigin = typeof window === "undefined" ? "" : window.location.origin;

  /*
   * Quy mô ván, đếm bằng NGÀY.
   *
   * Cùng con số với "Ngày 3" của thanh pha và của mọi mốc trong hồ sơ, nên nó
   * phải mang cùng một đơn vị: bản cũ gọi nó là "3 vòng" ngay phía trên một hồ
   * sơ toàn nhãn "Ngày 3 / Đêm 2", và không có gì nói cho người đọc biết hai
   * cách gọi đó là một.
   */
  const scale = `${roundsLabel(caseFile ? caseFile.rounds : snapshot.round)} · ${snapshot.players.length} người chơi`;

  return (
    <div className="space-y-3">
      {/*
        * Quầng sáng phủ cả màn theo phe thắng. Không nhét vào Backdrop vì moodFor
        * chỉ nhận pha: ai thắng là dữ liệu của ván, không phải của pha.
        */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-[9]"
        style={{ background: accent.glow }}
      />

      <m.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={`card overflow-hidden border-2 p-5 sm:p-6 ${accent.border}`}
      >
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-mist">
            Ván đấu kết thúc
          </p>
          <h2
            className={`mt-1.5 font-display text-3xl font-extrabold leading-tight sm:text-4xl ${accent.text}`}
          >
            {copy.headline}
          </h2>
          <p className="mt-1.5 text-sm text-mist-strong">{scale}</p>
        </div>

        {outcome && <YourResult outcome={outcome} />}

        {decisive && <DecisiveMoment highlight={decisive} accentText={accent.text} />}

        <div className="mt-5 border-t border-white/[0.08] pt-4">
          {/* Ai thắng đọc nhanh nhất bằng mặt, không phải bằng cách dò bảng bên dưới. */}
          <p className="text-center text-xs font-semibold uppercase tracking-[0.25em] text-mist">
            Người thắng cuộc
          </p>
          <div className="mt-3 flex flex-wrap items-start justify-center gap-3">
            {winners.map((player) => (
              <div key={player.id} className="w-20">
                <Avatar
                  avatar={player.avatarUrl ? player.avatarUrl : avatars[player.id]}
                  tint={tintFor(player.id)}
                  alive
                  breathOffset={breathOffsetFor(player.id)}
                  className={`mx-auto h-12 w-12 ring-1 ${accent.ring}`}
                  isCustom={!!player.avatarUrl}
                />
                <p className="mt-1.5 truncate text-center text-[13px] font-semibold text-white">
                  {player.name}
                </p>
              </div>
            ))}
          </div>
        </div>
      </m.div>

      <PostMatchActions
        canReset={canReset}
        isHost={isHost}
        hostConnected={hostConnected}
        onReset={onReset}
        onLeave={onLeave}
      />

      <section aria-labelledby="reveal-heading" className="space-y-3">
        <h2 id="reveal-heading" className="sr-only">
          Vai trò của cả phòng
        </h2>
        {/*
          * Hai bảng đứng cạnh nhau khi CÒN CHỖ, không phải khi viewport rộng:
          * ở nấc lg cột giữa chỉ còn ~440px và hai bảng cạnh nhau ở đó cắt cụt
          * cả biệt danh lẫn bộ đếm "2/6 còn sống".
          *
          * items-start: hai phe hiếm khi bằng số người, để hàng kéo cao bằng
          * nhau thì phe ít người có một khoảng trống to bằng nửa panel.
          */}
        <div className="flex flex-wrap items-start gap-3">
          <TeamPanel
            title="Phe Ma Sói"
            players={wolves}
            avatars={avatars}
            won={wolvesWin}
            accent="wolves"
          />
          <TeamPanel
            title="Phe Dân Làng"
            players={village}
            avatars={avatars}
            won={!wolvesWin}
            accent="village"
          />
        </div>
      </section>

      {/*
        * Diễn biến gói vào MỘT mục thu gọn.
        *
        * Bản cũ trải hồ sơ vụ án ra sẵn rồi còn thêm một nút mở dòng thời gian
        * đầy đủ, nên giữa màn kết thúc có hai tầng "xem thêm" chồng nhau và thẻ
        * chia sẻ bị đẩy xuống dưới cả hai. Thanh tóm tắt dùng chính `.card` nên
        * nó không phải một thẻ lồng trong thẻ.
        */}
      <details className="group">
        <summary className="card flex cursor-pointer list-none items-center justify-between gap-3 py-3.5">
          <span>
            <span className="font-display text-lg font-semibold text-white">Diễn biến trận</span>
            <span className="block text-sm text-mist-strong">
              Hồ sơ vụ án, từng đêm và các phát bắn của Thợ Săn
            </span>
          </span>
          <span
            aria-hidden="true"
            className="shrink-0 text-lg text-mist-strong transition group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="mt-3 space-y-3">
          {caseFile && <CaseFileCard file={caseFile} />}
          {/* Server cũ deploy lệch có thể thiếu hẳn hai mảng này. */}
          <NightRecapTimeline nights={snapshot.nightHistory ?? []} config={snapshot.config} />
          <HunterShotTimeline shots={snapshot.hunterShots ?? []} />
        </div>
      </details>

      {caseFile && <CaseShareCard file={caseFile} shareOrigin={shareOrigin} />}
    </div>
  );
}

/**
 * Kết quả của chính người đang xem.
 *
 * Thắng/thua KHÔNG chỉ nằm ở màu: có dấu ✓/✕ và có chữ "Bạn thắng"/"Bạn thua",
 * nên ảnh chụp đen trắng hay người mù màu vẫn đọc ra đúng. Sống/chết cũng vậy -
 * "Sống sót"/"Đã bị loại" là chữ, không phải một chấm màu.
 */
function YourResult({ outcome }: { outcome: PersonalOutcome }) {
  return (
    <div
      className={`mt-5 rounded-xl border px-4 py-3.5 ${
        outcome.won ? "border-emerald-500/45 bg-emerald-900/20" : "border-night-600 bg-night-900/55"
      }`}
    >
      {/*
        * flex-wrap chứ không phải `sm:flex-row`: thẻ này nằm trong cột giữa của
        * bàn chơi, và cột đó hẹp nhất đúng ở nấc lg - nơi một breakpoint theo
        * viewport sẽ bật hàng ngang ra và bẻ đôi chữ "Bạn thua".
        */}
      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2.5">
        <p className="flex items-center gap-2.5 whitespace-nowrap">
          <span
            aria-hidden="true"
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-base font-bold ${
              outcome.won ? "bg-emerald-500/20 text-emerald-300" : "bg-night-700 text-mist-bright"
            }`}
          >
            {outcome.won ? "✓" : "✕"}
          </span>
          <span className="font-display text-xl font-bold text-white">{outcome.verdict}</span>
        </p>

        <dl className="flex flex-wrap items-baseline justify-center gap-x-5 gap-y-1 text-sm">
          <div className="flex items-baseline gap-1.5">
            <dt className="text-mist">Vai của bạn</dt>
            <dd className="font-semibold text-white">{outcome.roleName}</dd>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dt className="text-mist">Trạng thái</dt>
            <dd className="font-semibold text-mist-bright">{outcome.statusLabel}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

/**
 * Bước ngoặt của ván.
 *
 * Chọn theo `importance` chứ không phải phần tử đầu mảng - xem `decisiveHighlight`.
 * Ván không có điểm ngoặt nào đủ rõ thì khối này biến mất hẳn thay vì hứa hão.
 */
function DecisiveMoment({
  highlight,
  accentText,
}: {
  highlight: CaseHighlight;
  accentText: string;
}) {
  return (
    <div className="mt-3 rounded-xl border border-white/[0.08] bg-night-900/50 px-4 py-3 text-left">
      <p className={`text-xs font-bold uppercase tracking-[0.2em] ${accentText}`}>
        Bước ngoặt · {momentLabel(highlight.round, highlight.phase)}
      </p>
      <p className="mt-1 font-display text-base font-bold text-white">{highlight.title}</p>
      {/* break-words: biệt danh dài viết liền không được đẩy ngang cả thẻ. */}
      <p className="mt-0.5 break-words text-sm leading-relaxed text-mist-strong">
        {highlight.description}
      </p>
    </div>
  );
}

/**
 * Hành động sau trận.
 *
 * Nhãn nói ĐÚNG việc nút làm: `room:reset` đưa phòng về LOBBY với nguyên danh
 * sách người chơi và nguyên cấu hình, chứ KHÔNG bắt đầu ván mới - "Chơi lại"
 * của bản cũ hứa một ván mới mà server không hề khởi động.
 *
 * "Rời phòng" vẫn ở đây dù thanh đầu trang đã có một cái: thanh đó là đường
 * thoát của MỌI pha nên không bỏ được, còn trên điện thoại màn kết thúc dài hơn
 * một khung nhìn nên tới lúc đọc xong nó đã cuộn đi mất.
 *
 * Vì hai chỗ cùng gọi đúng một hàm, nhãn phải nói rõ hơn cái ở trên chứ không
 * lặp lại y hệt: hai nút "Rời phòng" trên cùng một trang đọc ra như hai hành
 * động khác nhau mà người chơi phải đoán xem cái nào là cái nào. "Rời phòng và
 * về trang chủ" nói hết điều nút làm - `room:leave` rồi đẩy về `/`.
 *
 * Vẫn là chữ nhạt hạng ba chứ không phải nút đặc, nên nó không cạnh tranh với
 * CTA ngay trên.
 */
function PostMatchActions({
  canReset,
  isHost,
  hostConnected,
  onReset,
  onLeave,
}: {
  canReset: boolean;
  isHost: boolean;
  hostConnected: boolean;
  onReset: () => void;
  onLeave: () => void;
}) {
  return (
    <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="post-match-heading">
      <h2 id="post-match-heading" className="sr-only">
        Hành động sau trận
      </h2>

      {canReset ? (
        <>
          <button className="btn-cta btn-cta-win w-full" onClick={onReset}>
            Về phòng chờ
          </button>
          <p className="text-center text-sm text-mist-strong">
            Giữ nguyên người chơi và thiết lập trận. Chủ phòng bấm bắt đầu là vào ván mới.
          </p>
        </>
      ) : (
        <p className="text-center text-sm text-mist-strong">
          Chờ chủ phòng đưa cả phòng về phòng chờ.
        </p>
      )}

      {canReset && !isHost && (
        <p className="text-center text-sm text-mist-strong">
          {hostConnected
            ? "Chủ phòng cũng bấm được nút này."
            : "Chủ phòng mất kết nối — bạn bấm thay được cho cả phòng."}
        </p>
      )}

      <div className="flex justify-center border-t border-white/[0.08] pt-3">
        <button className="btn-tertiary-danger min-h-11 px-4" onClick={onLeave}>
          Rời phòng và về trang chủ
        </button>
      </div>
    </section>
  );
}

/**
 * Bảng vai trò chia theo phe.
 *
 * Hết ván thì câu hỏi duy nhất là "ai ở phe Sói", nên chia phe chứ không liệt kê
 * một danh sách phẳng theo thứ tự ghế - đọc danh sách phẳng phải tự dò từng dòng
 * mới trả lời được đúng câu đó.
 */
function TeamPanel({
  title,
  players,
  avatars,
  won,
  accent,
}: {
  title: string;
  players: PlayerView[];
  avatars: Record<string, AvatarId>;
  won: boolean;
  accent: "wolves" | "village";
}) {
  const wolfSide = accent === "wolves";
  return (
    <section
      className={`card min-w-[17rem] flex-1 ${
        won ? (wolfSide ? "border-blood-500/50" : "border-emerald-500/40") : ""
      }`}
    >
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3
          className={`font-display text-lg font-bold ${
            wolfSide ? "text-blood-400" : "text-emerald-300"
          }`}
        >
          {title}
          {/* Chữ, không phải viền sáng: một cái viền thắng cuộc thì trình đọc
            * màn hình lẫn ảnh chụp đen trắng đều không thấy. */}
          {won && <span className="sr-only"> — phe chiến thắng</span>}
        </h3>
        <span className="text-[13px] text-mist-strong">
          {players.filter((p) => p.alive).length}/{players.length} còn sống
        </span>
      </div>

      <ul className="space-y-1.5">
        {players.map((player) => (
          <li
            key={player.id}
            className="flex items-center gap-2.5 rounded-lg border border-white/[0.04] bg-night-800/50 px-2 py-1.5"
          >
            <span className="relative shrink-0">
              <Avatar
                avatar={player.avatarUrl ? player.avatarUrl : avatars[player.id]}
                tint={tintFor(player.id)}
                alive={player.alive}
                breathOffset={breathOffsetFor(player.id)}
                className="h-9 w-9"
                isCustom={!!player.avatarUrl}
              />
              {!player.alive && (
                <span className="pointer-events-none absolute inset-0 grid place-items-center">
                  <span className="h-[1.5px] w-7 rotate-45 rounded bg-blood-500/70" />
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={`block truncate text-sm font-semibold ${
                  player.alive ? "text-white" : "text-mist-strong line-through"
                }`}
              >
                {player.name}
              </span>
              <span
                className={`block truncate text-[13px] ${
                  wolfSide ? "text-blood-400" : "text-emerald-300"
                }`}
              >
                {roleLabel(player)}
              </span>
            </span>
            {!player.alive && (
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-mist-strong">
                đã chết
              </span>
            )}
          </li>
        ))}
        {players.length === 0 && (
          <li className="rounded-lg bg-night-800/50 px-2 py-3 text-center text-sm text-mist-strong">
            Không còn ai.
          </li>
        )}
      </ul>
    </section>
  );
}
