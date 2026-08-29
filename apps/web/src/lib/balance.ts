import { ROLE_POWER } from "@masoi/shared";
import type { RoomConfig } from "@masoi/shared";
import type { BalanceWarningView } from "@masoi/shared";

/**
 * Client preview wrapper: re-export logic compatible with
 * packages/game-engine/src/balance/analyzer.ts.
 * Server snapshot.balanceWarning is preferred; this is fallback when snapshot
 * hasn't arrived yet or for instant preview on toggle.
 */

// Duplicated PRESET_DECKS to avoid cross-package src import issues in Next bundler.
const BASE_TIMINGS: Pick<RoomConfig, "nightSeconds" | "discussionSeconds" | "voteSeconds" | "defenseSeconds" | "finalVoteSeconds"> = {
  nightSeconds: 30,
  discussionSeconds: 60,
  voteSeconds: 30,
  defenseSeconds: 25,
  finalVoteSeconds: 20,
};

function preset(overrides: Partial<RoomConfig>): RoomConfig {
  return {
    werewolves: 2,
    seer: false,
    guard: false,
    witch: false,
    hunter: false,
    cursed: false,
    wolfCub: false,
    apprenticeSeer: false,
    detective: false,
    guardianAngel: false,
    priest: false,
    mayor: false,
    mode: "ranked",
    ...BASE_TIMINGS,
    ...overrides,
  } as RoomConfig;
}

export const PRESET_DECKS: Record<number, RoomConfig> = {
  6: preset({ werewolves: 2, seer: true, guard: true, hunter: true }),
  7: preset({ werewolves: 2, seer: true, witch: true, hunter: true, mayor: true }),
  8: preset({ werewolves: 2, seer: true, witch: true, guard: true, hunter: true, detective: true }),
  9: preset({ werewolves: 2, wolfCub: true, seer: true, witch: true, guard: true, detective: true, hunter: true }),
  10: preset({
    werewolves: 2,
    wolfCub: true,
    cursed: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    hunter: true,
  }),
  11: preset({
    werewolves: 2,
    wolfCub: true,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
  }),
  12: preset({
    werewolves: 3,
    wolfCub: true,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
  }),
  13: preset({
    werewolves: 3,
    wolfCub: true,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
  }),
  14: preset({
    werewolves: 3,
    wolfCub: true,
    seer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
    priest: true,
  }),
  15: preset({
    werewolves: 3,
    wolfCub: true,
    cursed: true,
    seer: true,
    apprenticeSeer: true,
    witch: true,
    guard: true,
    detective: true,
    hunter: true,
    mayor: true,
    guardianAngel: true,
    priest: true,
  }),
};

type RoleKey = keyof typeof ROLE_POWER;

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

function deckRoles(config: RoomConfig, playerCount: number): RoleKey[] {
  const roles: RoleKey[] = [];
  for (let i = 0; i < config.werewolves; i++) roles.push("WEREWOLF");
  if (config.wolfCub) roles.push("WOLF_CUB");
  if (config.seer) roles.push("SEER");
  if (config.apprenticeSeer) roles.push("APPRENTICE_SEER");
  if (config.detective) roles.push("DETECTIVE");
  if (config.guard) roles.push("GUARD");
  if (config.guardianAngel) roles.push("GUARDIAN_ANGEL");
  if (config.priest) roles.push("PRIEST");
  if (config.witch) roles.push("WITCH");
  if (config.hunter) roles.push("HUNTER");
  if (config.mayor) roles.push("MAYOR");
  if (config.cursed) roles.push("CURSED");
  const vCount = villagerCount(config, playerCount);
  for (let i = 0; i < vCount; i++) roles.push("VILLAGER");
  return roles;
}

function sumPower(roles: RoleKey[]): number {
  return roles.reduce((acc, r) => acc + (ROLE_POWER[r] ?? 0), 0);
}

function wolfRoles(roles: RoleKey[]): RoleKey[] {
  return roles.filter((r) => r === "WEREWOLF" || r === "WOLF_CUB");
}

function villageRoles(roles: RoleKey[]): RoleKey[] {
  return roles.filter((r) => r !== "WEREWOLF" && r !== "WOLF_CUB");
}

function infoPower(roles: RoleKey[]): number {
  return roles.reduce((acc, r) => {
    if (r === "SEER") return acc + ROLE_POWER["SEER"];
    if (r === "APPRENTICE_SEER") return acc + ROLE_POWER["APPRENTICE_SEER"];
    if (r === "DETECTIVE") return acc + ROLE_POWER["DETECTIVE"];
    return acc;
  }, 0);
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
    const SCALE = 3;
    score = clamp(50 + (rawDiff - presetDiff) * SCALE, 0, 100);
  } else {
    const rawDiff = villagePower - wolfPower;
    score = clamp(50 + rawDiff * 2, 0, 100);
  }
  score = Math.round(score * 10) / 10;
  return { score, villagePower, wolfPower };
}

export function generateWarnings(config: RoomConfig, playerCount: number): BalanceWarningView {
  const { score, villagePower, wolfPower } = calculateBalanceScore(config, playerCount);
  const warnings: string[] = [];
  let blocking = false;

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
      warnings.push(`Tỉ lệ Sói lệch ${(ratioDiff * 100).toFixed(1)}% so với preset chuẩn (${presetWolfCount}/${playerCount})`);
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

  if (warnings.length === 0 && blocking) {
    warnings.push(`Cấu hình mất cân bằng`);
  }

  return { score, warnings, blocking, villagePower, wolfPower };
}
