import type { RoomConfig } from "@masoi/shared";

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

// Spec §4 Presets 6-15 (from 2026-08-29 design)
// Deck details:
// 6: WEREWOLF x2, SEER, GUARD, HUNTER, VILLAGER
// 7: WEREWOLF x2, SEER, WITCH, HUNTER, MAYOR, VILLAGER
// 8: WEREWOLF x2, SEER, WITCH, GUARD, HUNTER, DETECTIVE, VILLAGER
// 9: WEREWOLF x2, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, VILLAGER
// 10: WEREWOLF x2, WOLF_CUB, CURSED, SEER, APPRENTICE_SEER, WITCH, GUARD, HUNTER, VILLAGER
// 11: WEREWOLF x2, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, VILLAGER x2
// 12: WEREWOLF x3, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, VILLAGER x2
// 13: WEREWOLF x3, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, VILLAGER x2
// 14: WEREWOLF x3, WOLF_CUB, SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, PRIEST, VILLAGER x2
// 15: WEREWOLF x3, WOLF_CUB, CURSED, SEER, APPRENTICE_SEER, WITCH, GUARD, DETECTIVE, HUNTER, MAYOR, GUARDIAN_ANGEL, PRIEST, VILLAGER

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
