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
import { deckCounts, isPresetDeck, startBlock, type StartBlock } from "@/lib/lobby-summary";
import { BalanceMeter } from "./BalanceMeter";
import { RoleDeckPanel } from "./RoleDeckPanel";

interface Props {
  snapshot: RoomSnapshot;
  identity: Identity;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onAddBot: () => void;
  onLeave: () => void;
  onUpdateConfig: (config: RoomConfig) => void;
}

/**
 * Khu giữa của phòng chờ.
 *
 * Danh sách người chơi KHÔNG ở đây - nó là cột riêng bên trái, cùng một
 * component với lúc đang chơi, nên không còn hai cách trình bày người chơi phải
 * giữ cho khớp nhau.
 *
 * Bày theo lớp: thẻ đầu trả lời đúng câu hỏi của phút đầu tiên - "bấm bắt đầu
 * được chưa, và nếu chưa thì vướng gì" - còn mười ba thẻ vai, năm ô thời gian
 * và công tắc voice lui vào hai mục mở ra được. Bản cũ trải hết ra cùng lúc và
 * trên điện thoại nó dài hơn ba màn hình, trong đó phần host thực sự cần đọc
 * chiếm chưa tới một phần tư. Host lâu năm vẫn chỉnh được đúng mọi thứ như cũ,
 * chỉ thêm một cú bấm mở mục.
 */
export function Lobby({
  snapshot,
  identity,
  onReady,
  onStart,
  onAddBot,
  onLeave,
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

  // Cùng ba đầu vào, cùng thứ tự ưu tiên như bản cũ - startBlock chỉ gói lại
  // chứ không đổi luật nào.
  const configError = validateRoomConfig(config, count);
  const block = startBlock({
    playerCount: count,
    configError,
    unreadyNames: unreadyGuests.map((player) => player.name),
  });

  // Ưu tiên kết quả server; generateWarnings chỉ để xem trước tức thì lúc host
  // vừa gạt một công tắc và snapshot mới chưa về.
  const balance = snapshot.balanceWarning ?? generateWarnings(config, count);
  const counts = deckCounts(config, count);
  const onPreset = isPresetDeck(config, count);
  const presetForCount = PRESET_DECKS[count];
  const mode = config.mode ?? "ranked";

  return (
    <div className="space-y-3">
      <section className="card space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-bold text-white">Ván sắp tới</h2>
          <span className="text-sm text-mist/70">
            <b className="text-white">{count}</b>/{MAX_PLAYERS_PER_ROOM} người
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${
              onPreset
                ? "border-emerald-500/40 bg-emerald-900/25 text-emerald-300"
                : "border-amber-500/40 bg-amber-900/20 text-amber-300"
            }`}
          >
            {onPreset ? `Preset chuẩn ${count} người` : "Bộ bài tuỳ chỉnh"}
          </span>
          <Chip tone="wolves">{counts.wolves} Ma Sói</Chip>
          <Chip tone="village">{counts.specials} chức năng</Chip>
          <Chip tone="plain">{counts.villagers} Dân Làng</Chip>
        </div>

        <ModeToggle
          mode={mode}
          isHost={isHost}
          onChange={(next) => onUpdateConfig({ ...config, mode: next })}
        />

        <BalanceMeter score={balance.score} />

        {balance.warnings.length > 0 && (
          <div
            data-testid="balance-warning"
            className={`rounded-xl border px-3 py-2.5 ${
              balance.blocking
                ? "border-blood-500/40 bg-blood-600/15"
                : "border-amber-500/30 bg-amber-500/10"
            }`}
          >
            <p
              className={`text-xs font-bold ${balance.blocking ? "text-blood-400" : "text-amber-300"}`}
            >
              {balance.blocking
                ? "Cấu hình mất cân bằng — không thể bắt đầu ở Ranked"
                : "Cảnh báo cân bằng"}
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-mist/80">
              {balance.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
            {isHost && presetForCount && (
              <button
                type="button"
                onClick={() => onUpdateConfig(presetForCount)}
                className="mt-2 w-full rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15"
                data-testid="apply-preset"
              >
                Áp dụng preset chuẩn cho {count} người
              </button>
            )}
            {balance.blocking && mode === "ranked" && (
              <p className="mt-1.5 text-[11px] text-blood-300/90">
                Chuyển sang Chaos hoặc sửa cấu hình để bắt đầu.
              </p>
            )}
          </div>
        )}

        {isHost ? (
          <div className="space-y-2">
            <button
              className="btn-primary w-full py-3 text-base"
              onClick={onStart}
              disabled={block !== null}
            >
              Bắt đầu trận đấu
            </button>
            <button
              className="btn-secondary w-full"
              onClick={onAddBot}
              disabled={count >= MAX_PLAYERS_PER_ROOM}
            >
              + Thêm bot (để test một mình)
            </button>
          </div>
        ) : (
          <button className="btn-primary w-full py-3 text-base" onClick={() => onReady(!myReady)}>
            {myReady ? "Huỷ sẵn sàng" : "Tôi đã sẵn sàng!"}
          </button>
        )}

        <BlockReason block={block} code={snapshot.code} isHost={isHost} />

        <button className="btn-secondary w-full" onClick={onLeave}>
          Rời phòng
        </button>
      </section>

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
    wolves: "border-blood-500/40 bg-blood-600/15 text-blood-400",
    village: "border-emerald-500/30 bg-emerald-900/20 text-emerald-300",
    plain: "border-night-600 bg-night-800/60 text-mist/80",
  }[tone];
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[11px] font-bold ${cls}`}>{children}</span>
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
    <details className="card group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span>
          <span className="font-semibold text-white">{summary}</span>
          <span className="block text-xs text-mist/65">{hint}</span>
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 text-mist/65 transition group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

/** Chỉ hiện ĐÚNG lý do đang chặn, theo thứ tự người chơi gặp phải. */
function BlockReason({
  block,
  code,
  isHost,
}: {
  block: StartBlock;
  code: string;
  isHost: boolean;
}) {
  if (!block) return null;
  if (block.kind === "need-players") {
    return (
      <p className="text-center text-xs text-mist/65">
        Chờ thêm {block.missing} người nữa để bắt đầu. Gửi mã{" "}
        <b className="font-mono text-white">{code}</b> cho bạn bè.
      </p>
    );
  }
  if (block.kind === "config") {
    return <p className="text-center text-xs text-blood-400">{block.message}</p>;
  }
  // Khách không cần đọc danh sách người chưa sẵn sàng: họ không bấm bắt đầu.
  if (!isHost) return null;
  return (
    <p className="text-center text-xs text-amber-300">
      Chờ {block.names.join(", ")} sẵn sàng.
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
      title: "Sự kiện chỉ kích hoạt khi một phe bị lấn lướt mạnh",
      on: "border-amber-500/40 bg-amber-500/20 text-amber-300",
    },
    {
      id: "chaos" as const,
      label: "🌀 Chaos",
      title: "Sự kiện bất ngờ ngẫu nhiên kích hoạt mỗi vòng",
      on: "border-purple-500/40 bg-purple-500/20 text-purple-300",
    },
  ];
  return (
    <div className="flex items-center gap-1 rounded-xl border border-night-600/60 bg-night-800/60 p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={!isHost}
          onClick={() => onChange(option.id)}
          title={option.title}
          aria-pressed={mode === option.id}
          className={`flex-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition ${
            mode === option.id
              ? option.on
              : "border-transparent text-mist/65 hover:text-white"
          } ${isHost ? "cursor-pointer" : "cursor-default"}`}
        >
          {option.label}
        </button>
      ))}
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
    <div className="flex flex-col gap-2 border-b border-white/[0.06] pb-4">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="font-semibold text-white">🎙️ Trò chuyện bằng giọng nói</span>
        <input
          type="checkbox"
          className="h-5 w-5 accent-blood-500"
          checked={on}
          onChange={(e) => onSave({ ...config, voice: e.target.checked })}
        />
      </label>
      <p className="text-xs text-mist/65">
        Chỉ dùng được ban ngày. Ban đêm và phe Sói vẫn nhắn bằng chữ.
      </p>
      {on && (
        <p className="text-xs text-amber-300/80">
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
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
            <span className="text-mist/80">
              {label}{" "}
              <span className="text-mist/60">
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
        className="btn-primary mt-3 w-full"
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
