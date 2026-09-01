"use client";

import { useMemo, useState } from "react";
import { m } from "motion/react";
import { buildCaseFile, ROLE_META, type PlayerView, type RoomSnapshot, type Team } from "@masoi/shared";
import type { AvatarId } from "@/lib/avatar-art";
import { assignAvatars, breathOffsetFor, tintFor } from "@/lib/avatar";
import { roleLabel } from "@/lib/cursed";
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

export function GameOverView({ snapshot, isHost, onReset, onLeave }: Props) {
  const wolvesWin = snapshot.winner === "wolves";
  const roster = snapshot.players.map((p) => p.id).join(",");
  const avatars = useMemo(() => assignAvatars(roster ? roster.split(",") : []), [roster]);

  // Chủ phòng mất kết nối ở màn này thì không ai bấm được "Chơi lại" - server
  // đã cho phép người khác thay thế sau một khoảng ân hạn, ở đây chỉ cần lộ
  // nút ra khi chủ phòng đang offline. Bấm sớm quá thì lỗi từ server tự hiện.
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

  // Diễn biến chi tiết mặc định đóng: màn kết thúc phải đọc được trong một màn
  // hình, còn ai muốn soi từng đêm thì mở ra.
  const [showFullTimeline, setShowFullTimeline] = useState(false);

  // Thẻ chia sẻ là HÀNH ĐỘNG, không phải thứ để nhìn: một khung 9:16 cao hơn
  // cả phần còn lại cộng lại, và người ta mở nó đúng một lần lúc muốn khoe.
  const [showShare, setShowShare] = useState(false);

  // Chỉ có ở trình duyệt. Trên server render thì để rỗng và lời mời rơi về
  // đúng đường dẫn tương đối thay vì một origin bịa ra.
  const shareOrigin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <div className="space-y-3">
      {/*
        * Quầng sáng phủ cả màn theo phe thắng. Không nhét vào Backdrop vì moodFor
        * chỉ nhận pha: ai thắng là dữ liệu của ván, không phải của pha.
        */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-[9]"
        style={{
          background: wolvesWin
            ? "radial-gradient(900px 520px at 50% 12%, rgba(220, 38, 64, 0.18), transparent 70%)"
            : "radial-gradient(900px 520px at 50% 12%, rgba(52, 178, 140, 0.16), transparent 70%)",
        }}
      />

      <m.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={`card overflow-hidden border-2 py-8 text-center ${
          wolvesWin ? "border-blood-500/70" : "border-emerald-500/60"
        }`}
      >
        <p className="text-xs uppercase tracking-[0.35em] text-mist/65">Ván đấu kết thúc</p>
        <h2
          className={`mt-2 font-display text-4xl font-extrabold leading-tight ${
            wolvesWin ? "text-blood-400" : "text-emerald-300"
          }`}
        >
          {wolvesWin ? "Ma Sói thắng" : "Dân Làng thắng"}
        </h2>

        {/* Ai thắng đọc nhanh nhất bằng mặt, không phải bằng cách dò bảng bên dưới. */}
        <div className="mt-5 flex flex-wrap items-start justify-center gap-3">
          {winners.map((player) => (
            <div key={player.id} className="w-20">
              <Avatar
                avatar={player.avatarUrl ? player.avatarUrl : avatars[player.id]}
                tint={tintFor(player.id)}
                alive
                breathOffset={breathOffsetFor(player.id)}
                className={`mx-auto h-12 w-12 ring-1 ${
                  wolvesWin ? "ring-blood-500/50" : "ring-emerald-500/50"
                }`}
                isCustom={!!player.avatarUrl}
              />
              <p className="mt-1 truncate text-[11px] font-semibold text-white">{player.name}</p>
            </div>
          ))}
        </div>
      </m.div>

      {/*
        * Từ `lg` là hai cột ngang hàng: đội hình bên trái, hồ sơ vụ án bên phải.
        *
        * Bản cũ xếp dọc, nên ở 1080p màn kết thúc luôn tràn quá một màn - trong
        * khi chính file này đã ghi ý định "phải đọc được trong một màn hình".
        * Dưới `lg` vẫn đúng một cột như cũ.
        */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid items-start gap-3 lg:grid-cols-1 xl:grid-cols-2">
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
        {caseFile && <CaseFileCard file={caseFile} />}
      </div>

      <button
        className="btn-secondary min-h-11 w-full"
        onClick={() => setShowFullTimeline((open) => !open)}
        aria-expanded={showFullTimeline}
        aria-controls="full-timeline"
      >
        {showFullTimeline ? "Ẩn diễn biến chi tiết" : "Xem toàn bộ diễn biến"}
      </button>

      {showFullTimeline && (
        <div id="full-timeline" className="space-y-3">
          {/* Server cũ deploy lệch có thể thiếu hẳn hai mảng này. */}
          <NightRecapTimeline nights={snapshot.nightHistory ?? []} />
          <HunterShotTimeline shots={snapshot.hunterShots ?? []} />
        </div>
      )}

      {caseFile && (
        <>
          <button
            className="btn-secondary min-h-11 w-full"
            onClick={() => setShowShare((open) => !open)}
            aria-expanded={showShare}
            aria-controls="share-card"
          >
            {showShare ? "Ẩn thẻ chia sẻ" : "Tạo thẻ chia sẻ"}
          </button>
          {showShare && (
            <div id="share-card">
              <CaseShareCard file={caseFile} shareOrigin={shareOrigin} />
            </div>
          )}
        </>
      )}

      <div className="flex gap-2">
        {canReset && (
          <button className="btn-primary flex-1" onClick={onReset}>
            Chơi lại (về phòng chờ)
          </button>
        )}
        <button className="btn-secondary flex-1" onClick={onLeave}>
          Rời phòng
        </button>
      </div>
      {!isHost && (
        <p className="text-center text-xs text-mist/65">
          {hostConnected
            ? "Chờ chủ phòng bấm chơi lại hoặc rời phòng."
            : "Chủ phòng mất kết nối - bạn có thể bấm chơi lại giúp phòng."}
        </p>
      )}
    </div>
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
      className={`card ${won ? (wolfSide ? "border-blood-500/50" : "border-emerald-500/40") : ""}`}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h3
          className={`font-display text-lg font-bold ${
            wolfSide ? "text-blood-400" : "text-emerald-300"
          }`}
        >
          {title}
        </h3>
        <span className="text-xs text-mist/65">
          {players.filter((p) => p.alive).length}/{players.length} còn sống
        </span>
      </div>

      {/*
        * Cuộn TRONG thẻ từ `lg`, theo đúng khuôn mà `RosterPanel` đang dùng
        * (`lg:max-h-[calc(100dvh-16rem)]`). Chỉ khoá riêng danh sách đội hình
        * chứ không khoá cả màn: đây là khối duy nhất co giãn theo số người.
        */}
      <ul className="lobby-roster-scroll space-y-1.5 lg:max-h-[38vh] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
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
                  player.alive ? "text-white" : "text-mist/60 line-through"
                }`}
              >
                {player.name}
              </span>
              <span className={`block truncate text-xs ${wolfSide ? "text-blood-400/90" : "text-emerald-300/90"}`}>
                {roleLabel(player)}
              </span>
            </span>
            {!player.alive && (
              <span className="shrink-0 text-[11px] uppercase tracking-wider text-mist/60">
                đã chết
              </span>
            )}
          </li>
        ))}
        {players.length === 0 && (
          <li className="rounded-lg bg-night-800/50 px-2 py-3 text-center text-sm text-mist/65">
            Không còn ai.
          </li>
        )}
      </ul>
    </section>
  );
}
