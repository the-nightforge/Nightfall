"use client";

import {
  ROLE_META,
  type Role,
  type RoomConfig,
  type RoomSnapshot,
} from "@masoi/shared";
import { ROLE_ICON_PATHS } from "@/lib/role-art";

/** Thứ tự hiển thị, không phải thứ tự hành động ban đêm. Dân Làng luôn đứng cuối. */
const VILLAGE_ROLES: Role[] = ["SEER", "GUARD", "WITCH", "HUNTER", "CURSED"];

/** Khoá cấu hình tương ứng với từng vai bật/tắt được. */
const CONFIG_KEY: Record<string, keyof RoomConfig> = {
  SEER: "seer",
  GUARD: "guard",
  WITCH: "witch",
  HUNTER: "hunter",
  CURSED: "cursed",
};

interface Props {
  snapshot: RoomSnapshot;
  isHost: boolean;
  onUpdateConfig: (config: RoomConfig) => void;
}

/**
 * Bộ bài của ván sắp tới.
 *
 * Đây KHÔNG phải chỗ chọn vai cho mình: vai được chia ngẫu nhiên ở server và
 * đó là thứ giữ cho ván công bằng. Bảng này chỉ nói ván này có những vai nào,
 * và chủ phòng bật/tắt được - cùng dữ liệu với hộp cấu hình cũ, chỉ trình bày
 * để cả phòng cùng đọc được thay vì giấu trong một thẻ details của riêng chủ.
 */
export function RoleDeckPanel({ snapshot, isHost, onUpdateConfig }: Props) {
  const config = snapshot.config;
  const playerCount = snapshot.players.length;

  const specials =
    (config.seer ? 1 : 0) +
    (config.guard ? 1 : 0) +
    (config.witch ? 1 : 0) +
    (config.hunter ? 1 : 0) +
    (config.cursed ? 1 : 0);
  // Dân Làng lấp phần còn lại, đúng như buildRoleDeck làm ở engine.
  const villagers = Math.max(0, playerCount - config.werewolves - specials);

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
    <div className="card">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-xl font-bold text-white">Bộ bài của ván này</h3>
        <span className="text-xs text-mist/50">
          {isHost ? "Bấm để bật/tắt vai" : "Chủ phòng quyết định"}
        </span>
      </div>

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

      <Section label="Phe Ma Sói" tone="wolves">
        <RoleCard
          role="WEREWOLF"
          count={config.werewolves}
          enabled
          locked
          onToggle={() => undefined}
        />
        {isHost && (
          <div className="flex flex-col justify-center gap-1 rounded-xl border border-night-600/60 bg-night-800/40 px-3 py-2">
            <span className="text-[10px] uppercase tracking-wider text-mist/50">Số Ma Sói</span>
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
  tone: "village" | "wolves";
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <p
        className={`mb-2 text-[11px] font-bold uppercase tracking-[0.2em] ${
          tone === "wolves" ? "text-blood-400" : "text-emerald-300"
        }`}
      >
        {label}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{children}</div>
    </div>
  );
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
  const wolf = meta.team === "wolves";

  return (
    <button
      type="button"
      disabled={locked}
      onClick={onToggle}
      className={`flex flex-col items-center rounded-xl border px-3 py-3 text-center transition
        ${
          enabled
            ? wolf
              ? "border-blood-500/40 bg-blood-600/10"
              : "border-emerald-500/25 bg-emerald-900/10"
            : "border-night-600/50 bg-night-800/30 opacity-45"
        }
        ${locked ? "cursor-default" : "cursor-pointer hover:border-white/25"}`}
    >
      <svg
        viewBox="0 0 512 512"
        aria-hidden="true"
        className={`h-9 w-9 ${
          enabled ? (wolf ? "fill-blood-400" : "fill-emerald-300") : "fill-mist/40"
        }`}
      >
        <path d={ROLE_ICON_PATHS[role]} />
      </svg>

      <span
        className={`mt-1.5 text-xs font-bold uppercase tracking-wide ${
          enabled ? (wolf ? "text-blood-400" : "text-emerald-300") : "text-mist/50"
        }`}
      >
        {meta.name}
      </span>

      {/* Mô tả luôn hiện: người mới cần biết vai đó làm gì trước khi vào ván. */}
      <span className="mt-1 line-clamp-3 text-[11px] leading-snug text-mist/60">
        {meta.description}
      </span>

      <span className="mt-2 text-[10px] font-semibold text-mist/40">
        {count > 0
          ? `${count} người`
          : // Dân Làng không bao giờ bị tắt, họ chỉ lấp phần còn lại - phòng chờ
            // chưa đủ người thì con số đó là 0, và "không dùng" sẽ nói sai.
            role === "VILLAGER"
            ? "lấp chỗ còn lại"
            : "không dùng"}
      </span>
    </button>
  );
}
