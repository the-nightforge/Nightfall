import { roleTeam } from "@masoi/shared";
import type { GameState } from "../types";

export function calculateMomentum(state: GameState): number {
  const alivePlayers = state.players.filter((p) => p.alive);
  const totalAlive = alivePlayers.length;
  const aliveWolves = alivePlayers.filter((p) => roleTeam(p.role) === "wolves").length;
  const totalWolves = state.players.filter((p) => roleTeam(p.role) === "wolves").length;
  const totalPlayers = state.players.length;

  if (aliveWolves === 0) return -1.0;
  if (totalAlive === aliveWolves) return 1.0;

  const baselineRatio = totalPlayers > 0 ? totalWolves / totalPlayers : 0.25;
  const currentRatio = totalAlive > 0 ? aliveWolves / totalAlive : 0;

  let deltaPop: number;
  if (currentRatio < baselineRatio) {
    deltaPop = baselineRatio > 0 ? (currentRatio - baselineRatio) / baselineRatio : -1.0;
  } else {
    deltaPop = 1.0 - baselineRatio > 0 ? (currentRatio - baselineRatio) / (1.0 - baselineRatio) : 1.0;
  }

  // 1. Info power
  let totalVillageInfo = 0;
  let aliveVillageInfo = 0;
  for (const p of state.players) {
    if (p.role === "SEER") totalVillageInfo += 1.0;
    if (p.role === "APPRENTICE_SEER") totalVillageInfo += 0.6;
    if (p.role === "DETECTIVE") totalVillageInfo += 0.8;
  }
  for (const p of alivePlayers) {
    if (p.role === "SEER") aliveVillageInfo += 1.0;
    if (p.role === "APPRENTICE_SEER") aliveVillageInfo += state.apprenticeAwakened ? 1.0 : 0.6;
    if (p.role === "DETECTIVE") aliveVillageInfo += 0.8;
  }
  const wolfAliveRatio = totalWolves > 0 ? aliveWolves / totalWolves : 0;
  const villageInfoAliveRatio = totalVillageInfo > 0 ? aliveVillageInfo / totalVillageInfo : 1.0;
  const deltaInfo = 1.0 - villageInfoAliveRatio - (1.0 - wolfAliveRatio);

  // 2. Kill power
  let totalVillageKill = 0;
  let aliveVillageKill = 0;
  for (const p of state.players) {
    if (p.role === "WITCH") totalVillageKill += 1.0;
    if (p.role === "HUNTER") totalVillageKill += 1.0;
    if (p.role === "PRIEST") totalVillageKill += 0.8;
  }
  for (const p of alivePlayers) {
    if (p.role === "WITCH" && !state.poisonUsed) aliveVillageKill += 1.0;
    if (p.role === "HUNTER") aliveVillageKill += 1.0;
    if (p.role === "PRIEST" && !state.priestHolyWaterUsed[p.id]) aliveVillageKill += 0.8;
  }
  const villageKillAliveRatio = totalVillageKill > 0 ? aliveVillageKill / totalVillageKill : 1.0;
  const deltaKill = wolfAliveRatio - villageKillAliveRatio;

  // 3. Prot power
  let totalVillageProt = 0;
  let aliveVillageProt = 0;
  for (const p of state.players) {
    if (p.role === "GUARD") totalVillageProt += 1.0;
    if (p.role === "GUARDIAN_ANGEL") totalVillageProt += 1.0;
    if (p.role === "WITCH") totalVillageProt += 1.0;
  }
  for (const p of alivePlayers) {
    if (p.role === "GUARD") aliveVillageProt += 1.0;
    if (p.role === "GUARDIAN_ANGEL") {
      const charges = state.guardianAngelCharges[p.id] ?? 2;
      aliveVillageProt += charges / 2.0;
    }
    if (p.role === "WITCH" && !state.healUsed) aliveVillageProt += 1.0;
  }
  const villageProtAliveRatio = totalVillageProt > 0 ? aliveVillageProt / totalVillageProt : 1.0;
  const deltaProt = 1.0 - villageProtAliveRatio - (1.0 - wolfAliveRatio);

  const rawMomentum = 0.35 * deltaPop + 0.25 * deltaInfo + 0.2 * deltaKill + 0.2 * deltaProt;
  const clamped = Math.max(-1.0, Math.min(1.0, rawMomentum));
  return Number(clamped.toFixed(4));
}
