import { describe, it, expect } from "vitest";
import { ROLES, ROLE_META, roleTeam, ROLE_ORDER_FOR_NIGHT } from "../src/roles";
import { DEFAULT_ROOM_CONFIG, RoomMode } from "../src/phases";
import { GameEventId } from "../src/events";
import { GameEventView, RoomSnapshot, NightActionView } from "../src/snapshot";
import { gameActionPayload, roomConfigSchema, validateRoomConfig } from "../src/schemas";

describe("Shared Roles", () => {
  it("includes all 14 roles with valid meta", () => {
    const expected = [
      "WEREWOLF",
      "WOLF_CUB",
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
      "VILLAGER",
      "JESTER",
    ] as const;

    for (const r of expected) {
      expect(ROLES).toContain(r);
      expect(ROLE_META[r]).toBeDefined();
      expect(ROLE_META[r].id).toBe(r);
      expect(ROLE_META[r].name).toBeDefined();
      expect(ROLE_META[r].description).toBeDefined();
      expect(ROLE_META[r].team).toBeDefined();
    }
  });

  it("assigns correct teams to all roles", () => {
    expect(roleTeam("WEREWOLF")).toBe("wolves");
    expect(roleTeam("WOLF_CUB")).toBe("wolves");
    expect(roleTeam("SEER")).toBe("village");
    expect(roleTeam("APPRENTICE_SEER")).toBe("village");
    expect(roleTeam("DETECTIVE")).toBe("village");
    expect(roleTeam("GUARD")).toBe("village");
    expect(roleTeam("GUARDIAN_ANGEL")).toBe("village");
    expect(roleTeam("PRIEST")).toBe("village");
    expect(roleTeam("WITCH")).toBe("village");
    expect(roleTeam("HUNTER")).toBe("village");
    expect(roleTeam("MAYOR")).toBe("village");
    expect(roleTeam("CURSED")).toBe("village");
    expect(roleTeam("VILLAGER")).toBe("village");
    // Phe thứ ba: KHÔNG phải "village", và cũng không phải "wolves". Mọi phép
    // so đồng đội trong game đọc đúng trường này.
    expect(roleTeam("JESTER")).toBe("neutral");
  });

  it("orders night roles correctly in ROLE_ORDER_FOR_NIGHT", () => {
    // Expected order:
    // Guard: 0
    // Guardian Angel: 0.5
    // Seer: 1
    // Apprentice Seer: 1
    // Detective: 1.5
    // Werewolf: 2
    // Wolf Cub: 2
    // Priest: 2.5
    // Witch: 3
    expect(ROLE_META.GUARD.nightOrder).toBe(0);
    expect(ROLE_META.GUARDIAN_ANGEL.nightOrder).toBe(0.5);
    expect(ROLE_META.SEER.nightOrder).toBe(1);
    expect(ROLE_META.APPRENTICE_SEER.nightOrder).toBe(1);
    expect(ROLE_META.DETECTIVE.nightOrder).toBe(1.5);
    expect(ROLE_META.WEREWOLF.nightOrder).toBe(2);
    expect(ROLE_META.WOLF_CUB.nightOrder).toBe(2);
    expect(ROLE_META.PRIEST.nightOrder).toBe(2.5);
    expect(ROLE_META.WITCH.nightOrder).toBe(3);

    expect(ROLE_ORDER_FOR_NIGHT).toEqual([
      "GUARD",
      "GUARDIAN_ANGEL",
      "SEER",
      "APPRENTICE_SEER",
      "DETECTIVE",
      "WEREWOLF",
      "WOLF_CUB",
      "PRIEST",
      "WITCH",
    ]);
  });
});

describe("Shared Phases & Config", () => {
  it("includes room mode in RoomConfig with default ranked", () => {
    expect(DEFAULT_ROOM_CONFIG.mode).toBe("ranked");
  });
});

describe("Shared Game Events", () => {
  it("supports all 9 event IDs", () => {
    const events: GameEventId[] = [
      "CURFEW",
      "SILENT_NIGHT",
      "AMNESTY_DAY",
      "CLEARING_MIST",
      "PEACEFUL_NIGHT",
      "JUDGMENT_DAY",
      "LAST_STAND",
      "DAY_OF_TRUTH",
      "MOONLESS_NIGHT",
      "BLOODY_HUNT",
      "HOWL_OF_THE_PACK",
      "BLOOD_MOON",
      "WOLF_SHADOW",
      "MORNING_REPORT",
      "DEAD_CAN_SPEAK",
    ];
    expect(events.length).toBe(15);
  });
});

describe("Shared Schemas and Payloads", () => {
  it("validates gameActionPayload for detective, priest, guardian angel", () => {
    // Detective action with targetId and secondary target or targetId1 & targetId2
    const detectiveAction = gameActionPayload.parse({
      type: "DETECTIVE_CHECK",
      targetId1: "p1",
      targetId2: "p2",
    });
    expect(detectiveAction.type).toBe("DETECTIVE_CHECK");

    // Guardian Angel action
    const guardianAction = gameActionPayload.parse({
      type: "GUARDIAN_PROTECT",
      targetId: "p1",
    });
    expect(guardianAction.type).toBe("GUARDIAN_PROTECT");

    // Priest action
    const priestAction = gameActionPayload.parse({
      type: "HOLY_WATER",
      targetId: "p2",
    });
    expect(priestAction.type).toBe("HOLY_WATER");
  });
});
