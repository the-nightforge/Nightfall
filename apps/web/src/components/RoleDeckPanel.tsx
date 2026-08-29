"use client";

import {
  ROLE_META,
  type Role,
  type RoomConfig,
  type RoomSnapshot,
} from "@masoi/shared";
import { ROLE_ICON_PATHS } from "@/lib/role-art";
import { BalanceMeter } from "./BalanceMeter";
import { generateWarnings, PRESET_DECKS } from "@/lib/balance";

/** Thứ tự hiển thị, không phải thứ tự hành động ban đêm. Dân Làng luôn đứng cuối. */
const VILLAGE_ROLES: Role[] = [
  "SEER",
  "APPRENTICE_SEER",
  "DETECTIVE",
  "GUARD",
  "GUARDIAN_ANGEL",
  "PRIEST",
  "WITCH",
  "HUNTER",
  "MAYOR",
  "CURSED",
];

const WOLF_SPECIAL_ROLES: Role[] = ["WOLF_CUB"];

/** Khoá cấu hình tương ứng với từng vai bật/tắt được. */
const CONFIG_KEY: Record<string, keyof RoomConfig> = {
  SEER: "seer",
  APPRENTICE_SEER: "apprenticeSeer",
  DETECTIVE: "detective",
  GUARD: "guard",
  GUARDIAN_ANGEL: "guardianAngel",
  PRIEST: "priest",
  WITCH: "witch",
  HUNTER: "hunter",
  MAYOR: "mayor",
  CURSED: "cursed",
  WOLF_CUB: "wolfCub",
};

interface Props {
  snapshot: RoomSnapshot;
  isHost: boolean;
  onUpdateConfig: (config: RoomConfig) => void;
}

/**
 * Bộ bài của ván sắp tới.
 */
export function RoleDeckPanel({ snapshot, isHost, onUpdateConfig }: Props) {
  const config = snapshot.config;
  const playerCount = snapshot.players.length;
  const balance = snapshot.balanceWarning ?? generateWarnings(config, playerCount);
  const presetForCount = PRESET_DECKS[playerCount];

  const specials =
    (config.seer ? 1 : 0) +
    (config.apprenticeSeer ? 1 : 0) +
    (config.detective ? 1 : 0) +
    (config.guard ? 1 : 0) +
    (config.guardianAngel ? 1 : 0) +
    (config.priest ? 1 : 0) +
    (config.witch ? 1 : 0) +
    (config.hunter ? 1 : 0) +
    (config.mayor ? 1 : 0) +
    (config.cursed ? 1 : 0);
  const wolfCount = config.werewolves + (config.wolfCub ? 1 : 0);
  // Dân Làng lấp phần còn lại, đúng như buildRoleDeck làm ở engine.
  const villagers = Math.max(0, playerCount - wolfCount - specials);

  const toggle = (role: Role) => {
    if (!isHost) return;
    const key = CONFIG_KEY[role];
    onUpdateConfig({ ...config, [key]: !config[key] } as RoomConfig);
  };

  const setWolves = (n: number) => {
    if (!isHost) return;
    onUpdateConfig({ ...config, werewolves: n });
  };

  const setMode = (mode: "ranked" | "chaos") => {
    if (!isHost) return;
    onUpdateConfig({ ...config, mode });
  };

  const currentMode = config.mode ?? "ranked";

  return (
    <div className="card">
      <BalanceMeter score={balance.score} />
      {balance.warnings.length > 0 && (
        <div
          data-testid="balance-warning"
          className={`mb-4 rounded-xl border px-3 py-2.5 ${
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
            {balance.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {isHost && presetForCount && (
            <button
              type="button"
              onClick={() => onUpdateConfig(presetForCount)}
              className="mt-2 w-full rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/15"
              data-testid="apply-preset"
            >
              Áp dụng preset chuẩn cho {playerCount} người
            </button>
          )}
          {balance.blocking && (config.mode ?? "ranked") === "ranked" && (
            <p className="mt-1.5 text-[11px] text-blood-300/80">
              Chuyển sang Chaos hoặc sửa cấu hình để bắt đầu.
            </p>
          )}
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-bold text-white">Bộ bài của ván này</h3>
          <p className="text-xs text-mist/60">
            {isHost ? "Bấm để bật/tắt vai & chế độ chơi" : "Chủ phòng quyết định"}
          </p>
        </div>

        {/* Chế độ chơi: Ranked / Chaos */}
        <div className="flex items-center gap-1 rounded-xl border border-night-600/60 bg-night-800/60 p-1">
          <button
            type="button"
            disabled={!isHost}
            onClick={() => setMode("ranked")}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
              currentMode === "ranked"
                ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                : "text-mist/60 hover:text-white"
            } ${!isHost ? "cursor-default" : "cursor-pointer"}`}
            title="Sự kiện chỉ kích hoạt khi một phe bị lấn lướt mạnh"
          >
            🛡️ Ranked
          </button>
          <button
            type="button"
            disabled={!isHost}
            onClick={() => setMode("chaos")}
            className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
              currentMode === "chaos"
                ? "bg-purple-500/20 text-purple-300 border border-purple-500/40"
                : "text-mist/60 hover:text-white"
            } ${!isHost ? "cursor-default" : "cursor-pointer"}`}
            title="Sự kiện bất ngờ ngẫu nhiên kích hoạt mỗi vòng"
          >
            🌀 Chaos
          </button>
        </div>
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
      title={meta.description}
      aria-label={`${meta.name}: ${meta.description}`}
      className={`group flex flex-col items-center rounded-xl border px-3 py-3 text-center transition hover:scale-[1.02] active:scale-[0.98]
        ${
          enabled
            ? wolf
              ? "border-blood-500/40 bg-blood-600/10 shadow-[inset_0_1px_0_rgba(244,71,96,0.15)]"
              : "border-emerald-500/25 bg-emerald-900/10 shadow-[inset_0_1px_0_rgba(52,211,153,0.12)]"
            : "border-night-600/50 bg-night-800/30 opacity-45"
        }
        ${locked ? "cursor-default" : "cursor-pointer hover:border-white/25"}`}
    >
      <span
        className={`grid h-12 w-12 place-items-center rounded-full ring-1 transition-transform group-hover:scale-110 ${
          enabled
            ? wolf
              ? "bg-gradient-to-br from-blood-600/30 to-blood-900/20 ring-blood-500/30"
              : "bg-gradient-to-br from-emerald-600/20 to-emerald-900/20 ring-emerald-500/25"
            : "bg-night-800 ring-white/5"
        }`}
      >
        <svg
          viewBox="0 0 512 512"
          aria-hidden="true"
          className={`h-7 w-7 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)] ${
            enabled ? (wolf ? "fill-blood-300" : "fill-emerald-200") : "fill-mist/35"
          }`}
        >
          <path d={ROLE_ICON_PATHS[role]} />
        </svg>
      </span>

      <span
        className={`mt-1.5 text-xs font-bold uppercase tracking-wide ${
          enabled ? (wolf ? "text-blood-400" : "text-emerald-300") : "text-mist/50"
        }`}
      >
        {meta.name}
      </span>

      <span className="mt-1 flex items-center gap-1 text-[10px] font-bold">
        <span className={`h-1.5 w-1.5 rounded-full ${enabled ? (wolf ? "bg-blood-500" : "bg-emerald-500") : "bg-mist/30"}`} aria-hidden="true" />
        <span className={enabled ? "text-white" : "text-mist/40"}>
          {count > 0 ? `×${count}` : role === "VILLAGER" ? "lấp chỗ" : "—"}
        </span>
      </span>
    </button>
  );
}
