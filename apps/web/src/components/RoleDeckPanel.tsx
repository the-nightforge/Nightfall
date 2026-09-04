"use client";

import {
  ROLE_META,
  type Role,
  type RoomConfig,
  type RoomSnapshot,
} from "@masoi/shared";
import { ROLE_ICON_PATHS } from "@/lib/role-art";
import {
  CONFIG_KEY,
  NEUTRAL_ROLES,
  VILLAGE_ROLES,
  WOLF_SPECIAL_ROLES,
  deckCounts,
} from "@/lib/lobby-summary";

interface Props {
  snapshot: RoomSnapshot;
  isHost: boolean;
  onUpdateConfig: (config: RoomConfig) => void;
}

/**
 * Bộ bài của ván sắp tới.
 *
 * CHỈ có bộ bài. Thanh cân bằng, cảnh báo và công tắc Ranked/Chaos đã chuyển
 * lên thẻ tóm tắt của phòng chờ: chúng là thứ phải nhìn thấy ngay, còn panel
 * này giờ nằm trong một mục mở ra được và sẽ chôn mất chúng. Panel cũng không
 * tự bọc `.card` nữa vì mục chứa nó đã là một thẻ.
 */
export function RoleDeckPanel({ snapshot, isHost, onUpdateConfig }: Props) {
  const config = snapshot.config;
  const playerCount = snapshot.players.length;
  const { villagers } = deckCounts(config, playerCount);

  const toggle = (role: Role) => {
    if (!isHost) return;
    const key = CONFIG_KEY[role];
    onUpdateConfig({ ...config, [key]: !config[key] } as RoomConfig);
  };

  const setWolves = (n: number) => {
    if (!isHost) return;
    onUpdateConfig({ ...config, werewolves: n });
  };

  return (
    <div>
      <p className="mb-3 text-xs text-mist/70">
        {isHost ? "Bấm để bật/tắt từng vai." : "Chủ phòng quyết định bộ bài này."}
      </p>

      <Section label="Phe Dân Làng" tone="village">
        <RoleCard
          role="VILLAGER"
          count={villagers}
          enabled
          locked
          onToggle={() => undefined}
        />
        {VILLAGE_ROLES.map((role) => (
          <RoleCard
            key={role}
            role={role}
            count={config[CONFIG_KEY[role]] ? 1 : 0}
            enabled={!!config[CONFIG_KEY[role]]}
            locked={!isHost}
            onToggle={() => toggle(role)}
          />
        ))}
      </Section>

      {/*
        * Nhóm TRUNG LẬP đứng riêng, giữa hai phe.
        *
        * Không nhét vào một trong hai nhóm kia dù nó chỉ có một lá: bộ bài là
        * chỗ host đọc để biết ván sắp tới có gì, và một Thằng Hề nằm dưới nhãn
        * "Phe Dân Làng" là một lời nói dối ngay tại màn hình quyết định - đúng
        * cái điều mà cả vai này sinh ra để làm với NGƯỜI CHƠI, không phải với
        * người đang xếp bài.
        */}
      <Section label="Phe Trung lập" tone="neutral">
        {NEUTRAL_ROLES.map((role) => (
          <RoleCard
            key={role}
            role={role}
            count={config[CONFIG_KEY[role]] ? 1 : 0}
            enabled={!!config[CONFIG_KEY[role]]}
            locked={!isHost}
            onToggle={() => toggle(role)}
          />
        ))}
      </Section>

      <Section label="Phe Ma Sói" tone="wolves">
        <RoleCard
          role="WEREWOLF"
          count={config.werewolves}
          enabled
          locked
          onToggle={() => undefined}
        />
        {WOLF_SPECIAL_ROLES.map((role) => (
          <RoleCard
            key={role}
            role={role}
            count={config[CONFIG_KEY[role]] ? 1 : 0}
            enabled={!!config[CONFIG_KEY[role]]}
            locked={!isHost}
            onToggle={() => toggle(role)}
          />
        ))}
        {isHost && (
          <div className="flex flex-col justify-center gap-1 rounded-xl border border-night-600/60 bg-night-800/40 px-3 py-2">
            <span className="text-[11px] uppercase tracking-wider text-mist/65">Số Ma Sói</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => setWolves(n)}
                  className={`h-8 flex-1 rounded-lg text-sm font-bold transition ${
                    config.werewolves === n
                      ? "bg-blood-500 text-white"
                      : "bg-night-700/70 text-mist hover:bg-night-600"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone: DeckTone;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p className={`mb-2 text-[11px] font-bold uppercase tracking-[0.2em] ${TONE.text[tone]}`}>
        {label}
      </p>
      {/*
        * Chia cột theo bề ngang THẬT của khung, không theo breakpoint màn hình:
        * bảng này sống trong cột phải rộng chừng 290px, nên `sm:grid-cols-3`
        * (đo màn hình) nhồi ba thẻ vào chỗ vừa hai và mỗi thẻ chỉ còn ~85px -
        * đủ hẹp để mô tả vai bị cắt cụt ngay ở màn hình host dùng để xếp bài.
        */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">{children}</div>
    </div>
  );
}

/**
 * Bảng màu theo phe, tra từ MỘT chỗ.
 *
 * Trước khi có phe thứ ba, mỗi chỗ dùng màu chỉ cần một biểu thức ba ngôi
 * `wolf ? ... : ...` - và có sáu chỗ như vậy trong file này. Thêm một phe vào
 * cách đó nghĩa là sáu biểu thức lồng nhau, và mỗi lần thêm phe sau này lại
 * phải tìm cho đủ sáu.
 */
type DeckTone = "village" | "wolves" | "neutral";

const TONE: Record<"text" | "card" | "halo" | "fill" | "dot", Record<DeckTone, string>> = {
  text: {
    village: "text-emerald-300",
    wolves: "text-blood-400",
    neutral: "text-amber-300",
  },
  card: {
    village: "border-emerald-500/25 bg-emerald-900/10 shadow-[inset_0_1px_0_rgba(52,211,153,0.12)]",
    wolves: "border-blood-500/40 bg-blood-600/10 shadow-[inset_0_1px_0_rgba(244,71,96,0.15)]",
    neutral: "border-amber-500/30 bg-amber-900/10 shadow-[inset_0_1px_0_rgba(251,191,36,0.14)]",
  },
  halo: {
    village: "bg-gradient-to-br from-emerald-600/20 to-emerald-900/20 ring-emerald-500/25",
    wolves: "bg-gradient-to-br from-blood-600/30 to-blood-900/20 ring-blood-500/30",
    neutral: "bg-gradient-to-br from-amber-600/25 to-amber-900/20 ring-amber-500/30",
  },
  fill: {
    village: "fill-emerald-200",
    wolves: "fill-blood-300",
    neutral: "fill-amber-200",
  },
  dot: {
    village: "bg-emerald-500",
    wolves: "bg-blood-500",
    neutral: "bg-amber-500",
  },
};

function toneFor(role: Role): DeckTone {
  return ROLE_META[role].team;
}

function RoleCard({
  role,
  count,
  enabled,
  locked,
  onToggle,
}: {
  role: Role;
  count: number;
  enabled: boolean;
  locked: boolean;
  onToggle: () => void;
}) {
  const meta = ROLE_META[role];
  const tone = toneFor(role);

  return (
    <button
      type="button"
      disabled={locked}
      onClick={onToggle}
      title={meta.description}
      aria-label={`${meta.name}: ${meta.description}`}
      className={`group flex h-full flex-col items-center rounded-xl border px-3 py-3 text-center transition hover:scale-[1.02] active:scale-[0.98]
        ${enabled ? TONE.card[tone] : "border-night-600/50 bg-night-800/30 opacity-45"}
        ${locked ? "cursor-default" : "cursor-pointer hover:border-white/25"}`}
    >
      <span
        className={`grid h-12 w-12 place-items-center rounded-full ring-1 transition-transform group-hover:scale-110 ${
          enabled ? TONE.halo[tone] : "bg-night-800 ring-white/5"
        }`}
      >
        <svg
          viewBox="0 0 512 512"
          aria-hidden="true"
          className={`h-7 w-7 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)] ${
            enabled ? TONE.fill[tone] : "fill-mist/35"
          }`}
        >
          <path d={ROLE_ICON_PATHS[role]} />
        </svg>
      </span>

      <span
        className={`mt-1.5 text-xs font-bold uppercase tracking-wide ${
          enabled ? TONE.text[tone] : "text-mist/65"
        }`}
      >
        {meta.name}
      </span>

      {/*
        * Mô tả hiện ĐỦ. `line-clamp-3` cắt mất đúng phần điều kiện của những
        * vai rắc rối nhất ("Khi Tiên Tri chết, thừa kế..."), mà đó lại chính là
        * thứ host cần đọc để quyết bật hay tắt. Thẻ cùng hàng vẫn cao bằng nhau
        * vì ô lưới tự kéo giãn, nên bỏ trần không làm hàng lệch.
        */}
      <span className="mt-1 min-h-[32px] px-1 text-center text-[11px] leading-snug text-mist/60">
        {meta.description}
      </span>

      {/* mt-auto: mô tả dài ngắn khác nhau thì dòng số lượng vẫn nằm cùng
          một mức ở đáy mọi thẻ trong hàng. */}
      <span className="mt-auto flex items-center gap-1 pt-1.5 text-[11px] font-bold">
        <span className={`h-1.5 w-1.5 rounded-full ${enabled ? TONE.dot[tone] : "bg-mist/30"}`} aria-hidden="true" />
        <span className={enabled ? "text-white" : "text-mist/60"}>
          {count > 0 ? `×${count}` : role === "VILLAGER" ? "lấp chỗ" : "—"}
        </span>
      </span>
    </button>
  );
}
