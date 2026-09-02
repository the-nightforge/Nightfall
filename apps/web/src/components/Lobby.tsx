"use client";

import { useState } from "react";
import {
  MAX_PLAYERS_PER_ROOM,
  validateRoomConfig,
  type RoomConfig,
  type RoomSnapshot,
} from "@masoi/shared";
import type { Identity } from "@/lib/identity";
import { generateWarnings, PRESET_DECKS } from "@/lib/balance";
import { balanceCopy } from "@/lib/balance-copy";
import { deckCounts, deckStage, isPresetDeck, startBlock, type StartBlock } from "@/lib/lobby-summary";
import { lastLetterToggle } from "@/lib/last-letter";
import { BalanceMeter } from "./BalanceMeter";
import { RoleDeckPanel } from "./RoleDeckPanel";

interface Props {
  snapshot: RoomSnapshot;
  identity: Identity;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onAddBot: () => void;
  onUpdateConfig: (config: RoomConfig) => void;
}

/**
 * Khu giữa của phòng chờ.
 *
 * Danh sách người chơi KHÔNG ở đây - nó là cột riêng bên trái, cùng một
 * component với lúc đang chơi, nên không còn hai cách trình bày người chơi phải
 * giữ cho khớp nhau. Tên phòng, mã phòng và bộ đếm người cũng không ở đây: chúng
 * nằm trong `LobbyHeader` ngay trên, nên thẻ này chỉ còn nói về BỘ BÀI.
 *
 * Bày theo lớp: thẻ đầu trả lời đúng câu hỏi của phút đầu tiên - "bấm bắt đầu
 * được chưa, và nếu chưa thì vướng gì" - còn mười ba thẻ vai, năm ô thời gian
 * và công tắc voice lui vào hai mục mở ra được. Bản cũ trải hết ra cùng lúc và
 * trên điện thoại nó dài hơn ba màn hình, trong đó phần host thực sự cần đọc
 * chiếm chưa tới một phần tư. Host lâu năm vẫn chỉnh được đúng mọi thứ như cũ,
 * chỉ thêm một cú bấm mở mục.
 *
 * Nút "Rời phòng" KHÔNG còn ở đây. Bản cũ có hai cái - một ở thanh đầu trang,
 * một chiếm trọn chiều ngang ngay dưới "Bắt đầu trận đấu" - và cái thứ hai có
 * đúng hình dáng của CTA nên nó cạnh tranh với chính nút mà nó nằm dưới. Giờ
 * chỉ còn một, ở thanh đầu trang, cỡ chữ thường.
 */
export function Lobby({
  snapshot,
  identity,
  onReady,
  onStart,
  onAddBot,
  onUpdateConfig,
}: Props) {
  const config = snapshot.config;
  const isHost = snapshot.hostId === identity.playerId;
  const me = snapshot.players.find((p) => p.id === identity.playerId);
  const count = snapshot.players.length;
  const myReady = me?.ready ?? false;
  const unreadyGuests = snapshot.players.filter(
    (player) => !player.isBot && player.id !== snapshot.hostId && !player.ready,
  );

  // Ưu tiên kết quả server; generateWarnings chỉ để xem trước tức thì lúc host
  // vừa gạt một công tắc và snapshot mới chưa về.
  const mode = config.mode ?? "ranked";
  const balance = snapshot.balanceWarning ?? generateWarnings(config, count);
  // Chế độ đi vào đây để thẻ cảnh báo biết mình đang CHẶN hay chỉ đang nhắc:
  // Chaos bỏ qua chặn cân bằng, đúng như server.
  const copy = balanceCopy(balance, count, mode);
  const counts = deckCounts(config, count);
  const onPreset = isPresetDeck(config, count);
  const presetForCount = PRESET_DECKS[count];
  const stage = deckStage(count);

  // Cùng bộ đầu vào và cùng thứ tự ưu tiên mà `RoomService.start` dùng -
  // startBlock chỉ gói lại chứ không đổi luật nào.
  const configError = validateRoomConfig(config, count);
  const block = startBlock({
    playerCount: count,
    configError,
    balanceBlocking: balance.blocking,
    mode,
    unreadyNames: unreadyGuests.map((player) => player.name),
  });

  return (
    <div className="space-y-3 lg:space-y-4">
      <section className="card space-y-4 p-4 lg:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-display text-xl font-bold text-white lg:text-2xl">Thiết lập trận</h2>
          <span className="text-sm text-mist-strong/85">{stage.summary}</span>
        </div>

        {/*
          * Hai chip đầu đếm thẳng từ cấu hình nên lúc nào cũng đúng. Hai chip
          * còn lại thì KHÔNG: nhãn preset khẳng định bộ bài hợp lệ cho số người
          * hiện tại, còn "Dân Làng" là phần còn lại sau khi trừ bài khỏi người -
          * ở phòng 1 người nó ra "0 Dân Làng", một con số đúng về số học và vô
          * nghĩa về trò chơi.
          */}
        <div className="flex flex-wrap items-center gap-2">
          {stage.rated ? (
            <span
              className={`rounded-full border px-3 py-1.5 text-xs font-bold ${
                onPreset
                  ? "border-emerald-500/45 bg-emerald-900/30 text-emerald-200"
                  : "border-amber-500/45 bg-amber-900/25 text-amber-200"
              }`}
            >
              {onPreset ? `Preset chuẩn ${count} người` : "Bộ bài tuỳ chỉnh"}
            </span>
          ) : (
            <span className="rounded-full border border-night-600 bg-night-800/70 px-3 py-1.5 text-xs font-bold text-mist">
              Vai trò đang bật
            </span>
          )}
          <Chip tone="wolves">{counts.wolves} Ma Sói</Chip>
          <Chip tone="village">{counts.specials} chức năng</Chip>
          {stage.rated && <Chip tone="plain">{counts.villagers} Dân Làng</Chip>}
        </div>

        <ModeToggle
          mode={mode}
          isHost={isHost}
          onChange={(next) => onUpdateConfig({ ...config, mode: next })}
        />

        {/*
          * Dưới mốc bắt đầu KHÔNG chấm cân bằng.
          *
          * `calculateBalanceScore` vẫn trả về một con số cho bàn 1 người, và
          * `PRESET_DECKS` phủ đúng 6..15 nên nó luôn kèm "Không có preset". Kết
          * quả ở bản cũ: phòng 1 người hiện một thanh cân bằng 58 điểm, một
          * cảnh báo đội hình nghiêng, và một câu bảo "Bạn vẫn chơi được" - ngay
          * dưới dòng header nói còn thiếu 5 người. Chấm điểm một bàn chưa tồn
          * tại thì mọi câu chữ sinh ra từ nó đều mâu thuẫn với phần còn lại.
          */}
        {stage.rated ? (
          <BalanceMeter score={balance.score} />
        ) : (
          <p
            data-testid="balance-pending"
            className="rounded-xl border border-night-600/60 bg-night-900/50 px-3.5 py-3 text-[13px] leading-relaxed text-mist-strong"
          >
            {stage.pending}
          </p>
        )}

        {stage.rated && copy.advice.length > 0 && (
          <div
            data-testid="balance-warning"
            className={`rounded-xl border px-3.5 py-3 ${
              copy.blocksStart
                ? "border-blood-500/45 bg-blood-600/15"
                : "border-amber-500/35 bg-amber-500/10"
            }`}
          >
            <p
              className={`text-sm font-bold ${copy.blocksStart ? "text-blood-400" : "text-amber-200"}`}
            >
              {copy.headline}
            </p>
            {/*
              * Lời khuyên là câu người chơi ĐỌC, bản kỹ thuật là câu họ tra khi
              * cần. Bản cũ in thẳng "BalanceScore 58 ngoài ngưỡng 45-55" ở đúng
              * chỗ này: nó nói đúng chuyện gì đang xảy ra mà không nói được phải
              * làm gì, và nó là dòng chữ đầu tiên của thẻ cảnh báo.
              */}
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-mist/90">
              {copy.advice.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            {isHost && presetForCount && (
              <button
                type="button"
                onClick={() => onUpdateConfig(presetForCount)}
                className="btn-secondary mt-3 w-full text-sm"
                data-testid="apply-preset"
              >
                Áp dụng preset chuẩn cho {count} người
              </button>
            )}
            <TechnicalDetail lines={copy.technical} score={balance.score} />
          </div>
        )}

        <div className="border-t border-white/[0.08] pt-4">
          {isHost ? (
            /*
             * CTA và "Thêm bot" nằm CÙNG một hàng từ sm trở lên, và CTA chiếm
             * phần lớn chiều ngang. Bản cũ xếp chúng thành hai nút toàn chiều
             * rộng chồng lên nhau, cùng bề ngang và cùng chiều cao: mắt đọc ra
             * hai hành động ngang hàng, trong khi "Thêm bot" chỉ là thứ dùng để
             * tự test một mình.
             */
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-stretch">
              <button
                className="btn-cta w-full sm:flex-[3]"
                onClick={onStart}
                disabled={block !== null}
              >
                Bắt đầu trận đấu
              </button>
              <button
                className="btn-secondary w-full sm:flex-1"
                onClick={onAddBot}
                disabled={count >= MAX_PLAYERS_PER_ROOM}
              >
                + Thêm bot
              </button>
            </div>
          ) : (
            <button className="btn-cta w-full" onClick={() => onReady(!myReady)}>
              {myReady ? "Huỷ sẵn sàng" : "Tôi đã sẵn sàng!"}
            </button>
          )}

          <BlockReason block={block} isHost={isHost} />

          {isHost && count < MAX_PLAYERS_PER_ROOM && (
            <p className="mt-2 text-center text-[13px] leading-relaxed text-mist-strong/85">
              Bot dùng để chơi thử một mình — người thật vẫn vào được cho tới khi đủ{" "}
              {MAX_PLAYERS_PER_ROOM} người.
            </p>
          )}
        </div>
      </section>

      {/*
        * Khu Add-on đứng NGOÀI mục "Cài đặt nâng cao".
        *
        * Mục kia chỉ hiện với chủ phòng, còn add-on thì đổi LUẬT của ván mà cả
        * bàn sắp chơi. Giấu nó với khách nghĩa là để họ phát hiện ra giữa ván,
        * lúc một lá thư mở ra và không ai biết nó từ đâu tới. Khách thấy đủ
        * trạng thái, chỉ không gạt được.
        */}
      <Disclosure
        summary="Add-on"
        hint={isHost ? "Luật thêm cho ván này" : "Luật thêm chủ phòng đã bật"}
      >
        <AddonConfig snapshot={snapshot} identity={identity} onSave={onUpdateConfig} />
      </Disclosure>

      <Disclosure
        summary="Tuỳ chỉnh vai trò"
        hint={isHost ? "Bật/tắt từng vai, đổi số Ma Sói" : "Xem bộ bài chủ phòng đã chọn"}
      >
        <RoleDeckPanel snapshot={snapshot} isHost={isHost} onUpdateConfig={onUpdateConfig} />
      </Disclosure>

      {isHost && (
        <Disclosure summary="Cài đặt nâng cao" hint="Thời gian từng pha, trò chuyện bằng giọng nói">
          <div className="space-y-4">
            {snapshot.voice?.available && <VoiceConfig config={config} onSave={onUpdateConfig} />}
            <TimingConfig config={config} onSave={onUpdateConfig} />
          </div>
        </Disclosure>
      )}
    </div>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "wolves" | "village" | "plain";
  children: React.ReactNode;
}) {
  const cls = {
    wolves: "border-blood-500/45 bg-blood-600/20 text-blood-400",
    village: "border-emerald-500/35 bg-emerald-900/25 text-emerald-200",
    plain: "border-night-600 bg-night-800/70 text-mist",
  }[tone];
  return (
    <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${cls}`}>{children}</span>
  );
}

/**
 * Bản gốc của engine, gấp lại.
 *
 * Không xoá hẳn: khi host báo "nó không cho tôi bắt đầu" thì con số và ngưỡng
 * chính xác là thứ duy nhất tra ra được chuyện gì đã xảy ra, và nó phải khớp
 * từng chữ với thứ server đang chặn.
 */
function TechnicalDetail({ lines, score }: { lines: string[]; score: number }) {
  if (lines.length === 0) return null;
  return (
    <details className="group mt-2">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs text-mist/75 transition hover:text-white">
        <span aria-hidden="true" className="transition group-open:rotate-90">
          ▸
        </span>
        Chi tiết kỹ thuật
      </summary>
      <ul className="mt-1.5 space-y-0.5 pl-4 text-[11px] leading-snug text-mist/70">
        <li>Điểm cân bằng: {score}/100 (cân là 45-55)</li>
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Mục mở ra được.
 *
 * `<details>` của trình duyệt chứ không phải một cái nút tự dựng: nó mở được
 * bằng bàn phím sẵn, tìm-trong-trang của trình duyệt tự bung nó ra, và trạng
 * thái đóng/mở không phải thêm một state nữa để giữ cho đúng.
 */
function Disclosure({
  summary,
  hint,
  children,
}: {
  summary: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <details className="card group p-4 lg:p-5">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg transition hover:text-white">
        <span>
          <span className="font-display text-lg font-semibold text-white">{summary}</span>
          <span className="block text-sm text-mist-strong/85">{hint}</span>
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 text-lg text-mist/80 transition group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

/**
 * Chỉ hiện ĐÚNG lý do đang chặn, theo thứ tự người chơi gặp phải.
 *
 * Đứng ngay dưới nút để mắt không phải đi tìm: nút xám là câu hỏi, dòng này là
 * câu trả lời, và hai thứ đó cách nhau 10px. Lời rủ gửi mã phòng cho bạn bè đã
 * nằm ở `LobbyHeader` cùng thanh tiến độ, nên ở đây không nhắc lại.
 */
function BlockReason({ block, isHost }: { block: StartBlock; isHost: boolean }) {
  if (!block) return null;
  if (block.kind === "need-players") {
    return (
      <p className="mt-2.5 text-center text-sm text-mist/85" data-testid="start-block">
        Cần thêm <b className="text-white">{block.missing}</b> người để bắt đầu.
      </p>
    );
  }
  /*
   * Lý do này trước đây KHÔNG tồn tại ở client.
   *
   * Server từ chối `room:start` bằng BALANCE_UNSTABLE khi đội hình mất cân bằng
   * và phòng đang ở Ranked, nhưng nút vẫn sáng - host bấm và nhận về một dòng
   * lỗi đỏ chép nguyên văn cảnh báo của engine. Câu ở đây nói ra cả hai lối
   * thoát mà server chấp nhận.
   */
  if (block.kind === "balance") {
    return (
      <p className="mt-2.5 text-center text-sm text-blood-400" data-testid="start-block">
        Đội hình chưa đủ cân bằng để bắt đầu Ranked. Hãy sửa bộ bài hoặc chuyển sang Chaos.
      </p>
    );
  }
  if (block.kind === "config") {
    return (
      <p className="mt-2.5 text-center text-sm text-blood-400" data-testid="start-block">
        {block.message}
      </p>
    );
  }
  // Khách không cần đọc danh sách người chưa sẵn sàng: họ không bấm bắt đầu.
  if (!isHost) return null;
  return (
    <p className="mt-2.5 text-center text-sm text-amber-200" data-testid="start-block">
      Chờ {block.names.join(", ")} bấm sẵn sàng.
    </p>
  );
}

function ModeToggle({
  mode,
  isHost,
  onChange,
}: {
  mode: "ranked" | "chaos";
  isHost: boolean;
  onChange: (mode: "ranked" | "chaos") => void;
}) {
  const options = [
    {
      id: "ranked" as const,
      label: "🛡️ Ranked",
      hint: "Sự kiện hiếm",
      title: "Sự kiện chỉ kích hoạt khi một phe bị lấn lướt mạnh",
      // Viền đặc + nền đậm + chữ sáng: ở bản cũ ô được chọn chỉ khác ô kia ở
      // sắc chữ, và trên nền xanh đen thì amber/65 với amber/100 nhìn gần như
      // nhau - không đọc kỹ thì không biết đang ở chế độ nào.
      on: "border-amber-400/70 bg-amber-500/25 text-amber-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
    },
    {
      id: "chaos" as const,
      label: "🌀 Chaos",
      hint: "Sự kiện mỗi vòng",
      title: "Sự kiện bất ngờ ngẫu nhiên kích hoạt mỗi vòng",
      on: "border-purple-400/70 bg-purple-500/25 text-purple-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]",
    },
  ];
  return (
    <div
      className="flex items-stretch gap-1.5 rounded-xl border border-night-600/70 bg-night-900/60 p-1.5"
      role="group"
      aria-label="Chế độ sự kiện"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={!isHost}
          onClick={() => onChange(option.id)}
          title={option.title}
          aria-pressed={mode === option.id}
          className={`flex-1 rounded-lg border px-3 py-2 text-sm font-bold transition ${
            mode === option.id
              ? option.on
              : "border-transparent text-mist/80 hover:bg-white/[0.06] hover:text-white"
          } ${isHost ? "cursor-pointer" : "cursor-default"}`}
        >
          <span className="block">{option.label}</span>
          {/* 11px là cỡ chữ nhỏ nhất trên trang này và nó nằm ngay dưới nhãn
            * đậm 14px - ở khoảng cách ngồi chơi thật thì nó chỉ còn là một vệt
            * xám. Lên 12px và bớt mờ đi một nấc. */}
          <span className="mt-0.5 block text-xs font-medium opacity-90">{option.hint}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Khu Add-on: những luật thêm, bật/tắt cho từng ván.
 *
 * Công tắc bị `disabled` với người không phải chủ phòng chứ không bị ẩn đi -
 * `lastLetterToggle` trả về hai cờ tách bạch đúng cho việc này, và server vẫn
 * là nơi chặn thật (`updateConfig` đòi chủ phòng và đòi phòng chưa vào trận).
 */
function AddonConfig({
  snapshot,
  identity,
  onSave,
}: {
  snapshot: RoomSnapshot;
  identity: Identity;
  onSave: (c: RoomConfig) => void;
}) {
  const config = snapshot.config;
  const letter = lastLetterToggle(snapshot, identity.playerId);

  return (
    <div className="flex flex-col gap-2">
      <label
        className={`flex items-center justify-between gap-3 ${
          letter.canToggle ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <span className="font-semibold text-white">✉️ Phong thư sau cùng</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-blood-500 disabled:opacity-50"
          checked={letter.on}
          disabled={!letter.canToggle}
          onChange={(e) => onSave({ ...config, lastLetter: e.target.checked })}
        />
      </label>
      <p className="text-sm text-mist/80">
        Người chơi có thể để lại một thông điệp bí mật, chỉ được mở sau khi họ chết.
      </p>
      {!letter.canToggle && (
        <p className="text-xs text-mist/60">
          {snapshot.phase === "LOBBY"
            ? "Chỉ chủ phòng đổi được add-on."
            : "Không đổi được add-on khi trận đã bắt đầu."}
        </p>
      )}
    </div>
  );
}

/**
 * Công tắc voice chỉ hiện khi máy chủ có cấu hình LiveKit - `snapshot.voice`
 * vắng mặt nghĩa là server chưa bật, và khi đó gạt công tắc chẳng có tác dụng
 * gì ngoài gây khó hiểu.
 */
function VoiceConfig({
  config,
  onSave,
}: {
  config: RoomConfig;
  onSave: (c: RoomConfig) => void;
}) {
  const on = config.voice === true;
  return (
    <div className="flex flex-col gap-2 border-b border-white/[0.08] pb-4">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="font-semibold text-white">🎙️ Trò chuyện bằng giọng nói</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-blood-500"
          checked={on}
          onChange={(e) => onSave({ ...config, voice: e.target.checked })}
        />
      </label>
      <p className="text-sm text-mist/80">
        Chỉ dùng được ban ngày. Ban đêm và phe Sói vẫn nhắn bằng chữ.
      </p>
      {on && (
        <p className="text-sm text-amber-200/90">
          Lưu ý: giọng nói làm lộ bạn là ai, kể cả khi vai của bạn còn bí mật.
        </p>
      )}
    </div>
  );
}

/** Mốc thời gian từng pha: thứ chỉnh một lần rồi quên, không phải thứ cả phòng cần nhìn. */
function TimingConfig({
  config,
  onSave,
}: {
  config: RoomConfig;
  onSave: (c: RoomConfig) => void;
}) {
  const [draft, setDraft] = useState<RoomConfig>(config);
  const [dirty, setDirty] = useState(false);

  const set = (patch: Partial<RoomConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  return (
    <div>
      <p className="font-semibold text-white">Thời gian từng pha</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(
          [
            // Khoảng hợp lệ phải khớp roomConfigSchema; đặc biệt finalVoteSeconds
            // có cận dưới 15 vì chuỗi não bot mất tới 13 giây.
            ["nightSeconds", "Đêm", 15, 120],
            ["discussionSeconds", "Thảo luận", 30, 300],
            ["voteSeconds", "Bỏ phiếu sơ bộ", 15, 120],
            ["defenseSeconds", "Biện hộ", 10, 60],
            ["finalVoteSeconds", "Bỏ phiếu xác nhận", 15, 60],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key} className="block text-sm">
            <span className="text-mist/90">
              {label}{" "}
              <span className="text-mist/70">
                ({min}-{max}s)
              </span>
            </span>
            <input
              type="number"
              className="input mt-1"
              min={min}
              max={max}
              value={draft[key]}
              onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<RoomConfig>)}
            />
          </label>
        ))}
      </div>
      <button
        className="btn-primary mt-3 w-full sm:w-auto"
        disabled={!dirty}
        onClick={() => {
          onSave(draft);
          setDirty(false);
        }}
      >
        Lưu thời gian
      </button>
    </div>
  );
}
