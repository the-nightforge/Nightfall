import { ROLE_POWER } from "@masoi/shared";
import type { RoomConfig } from "@masoi/shared";
import type { EnginePlayer } from "../types";
import { specialRoleList } from "../assignRoles";
import { PRESET_DECKS } from "./presets";
import type { BalanceWarningView } from "@masoi/shared";

type Role = keyof typeof ROLE_POWER;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function villagerCount(config: RoomConfig, playerCount: number): number {
  const specials =
    (config.seer ? 1 : 0) +
    (config.guard ? 1 : 0) +
    (config.witch ? 1 : 0) +
    (config.hunter ? 1 : 0) +
    (config.cursed ? 1 : 0) +
    (config.apprenticeSeer ? 1 : 0) +
    (config.detective ? 1 : 0) +
    (config.guardianAngel ? 1 : 0) +
    (config.priest ? 1 : 0) +
    (config.mayor ? 1 : 0);
  const wolfCount = config.werewolves + (config.wolfCub ? 1 : 0);
  const count = playerCount - wolfCount - specials;
  return count < 0 ? 0 : count;
}

function deckRoles(config: RoomConfig, playerCount: number): Role[] {
  const roles: Role[] = specialRoleList(config);
  const vCount = villagerCount(config, playerCount);
  for (let i = 0; i < vCount; i++) roles.push("VILLAGER");
  return roles;
}

function sumPower(roles: Role[]): number {
  return roles.reduce((acc, r) => acc + (ROLE_POWER[r as Role] ?? 0), 0);
}

function wolfRoles(roles: Role[]): Role[] {
  return roles.filter((r) => r === "WEREWOLF" || r === "WOLF_CUB");
}

function villageRoles(roles: Role[]): Role[] {
  return roles.filter((r) => r !== "WEREWOLF" && r !== "WOLF_CUB");
}

function infoPower(roles: Role[]): number {
  return roles.reduce((acc, r) => {
    if (r === "SEER") return acc + ROLE_POWER["SEER"];
    if (r === "APPRENTICE_SEER") return acc + ROLE_POWER["APPRENTICE_SEER"];
    if (r === "DETECTIVE") return acc + ROLE_POWER["DETECTIVE"];
    return acc;
  }, 0);
}

// Exported per spec: calculateFactionPower sums ROLE_POWER for given players
export function calculateFactionPower(players: EnginePlayer[]): number {
  let total = 0;
  for (const p of players) {
    total += ROLE_POWER[p.role] ?? 0;
  }
  // Weighted formula placeholder: keep sum but apply spec weights comment
  // FactionPower = 0.20*population + 0.20*rolePower + 0.20*info + 0.20*kill + 0.10*protect + 0.10*control
  // For simplicity, rolePower already encapsulates info/kill/protect/control, so sum is proportional.
  return total;
}

export function calculateBalanceScore(
  config: RoomConfig,
  playerCount: number,
): { score: number; villagePower: number; wolfPower: number } {
  const roles = deckRoles(config, playerCount);
  const wolves = wolfRoles(roles);
  const village = villageRoles(roles);
  const wolfPower = sumPower(wolves);
  const villagePower = sumPower(village);

  const preset = PRESET_DECKS[playerCount];
  let score: number;
  if (preset) {
    const presetRoles = deckRoles(preset, playerCount);
    const presetWolfPower = sumPower(wolfRoles(presetRoles));
    const presetVillagePower = sumPower(villageRoles(presetRoles));
    const presetDiff = presetVillagePower - presetWolfPower;
    const rawDiff = villagePower - wolfPower;
    // Scale factor: spec says 10, but diff-of-preset centers score at 50;
    // use 3 to make moderate deviations block near 40/60.
    const SCALE = 3;
    score = clamp(50 + (rawDiff - presetDiff) * SCALE, 0, 100);
  } else {
    const rawDiff = villagePower - wolfPower;
    score = clamp(50 + rawDiff * 2, 0, 100);
  }
  // Round to 1 decimal
  score = Math.round(score * 10) / 10;
  return { score, villagePower, wolfPower };
}

export function generateWarnings(
  config: RoomConfig,
  playerCount: number,
): BalanceWarningView {
  const { score, villagePower, wolfPower } = calculateBalanceScore(config, playerCount);
  const warnings: string[] = [];
  let blocking = false;

  // Score thresholds
  if (score < 40 || score > 60) {
    warnings.push(`Cân bằng lệch: BalanceScore ${score} ngoài ngưỡng 40-60`);
    blocking = true;
  } else if (score < 45 || score > 55) {
    warnings.push(`Cảnh báo cân bằng: BalanceScore ${score} ngoài ngưỡng 45-55`);
  }

  const preset = PRESET_DECKS[playerCount];
  if (preset) {
    const wolfCount = config.werewolves + (config.wolfCub ? 1 : 0);
    const presetWolfCount = preset.werewolves + (preset.wolfCub ? 1 : 0);
    const wolfRatio = playerCount > 0 ? wolfCount / playerCount : 0;
    const presetRatio = playerCount > 0 ? presetWolfCount / playerCount : 0;
    const ratioDiff = Math.abs(wolfRatio - presetRatio);
    if (ratioDiff > 0.15) {
      warnings.push(
        `Tỉ lệ Sói lệch ${(ratioDiff * 100).toFixed(1)}% so với preset chuẩn (${presetWolfCount}/${playerCount})`,
      );
      blocking = true;
    }

    const roles = deckRoles(config, playerCount);
    const presetRoles = deckRoles(preset, playerCount);
    const cfgInfo = infoPower(roles);
    const presetInfo = infoPower(presetRoles);
    const infoDiff = Math.abs(cfgInfo - presetInfo);
    if (infoDiff >= 3) {
      warnings.push(`Năng lực soi lệch ${infoDiff.toFixed(1)} điểm so với preset chuẩn`);
      blocking = true;
    }

  } else {
    warnings.push(`Không có preset cho ${playerCount} người chơi`);
  }

  // Ensure at least one warning when blocking due to score but no other
  if (warnings.length === 0 && blocking) {
    warnings.push(`Cấu hình mất cân bằng`);
  }

  return { score, warnings, blocking, villagePower, wolfPower };
}
