import { describe, it, expect } from "vitest";
import { ROLES, ROLE_META, roleTeam, isWolfPack, ROLE_ORDER_FOR_NIGHT, isRole } from "../src/roles";
import { DEFAULT_ROOM_CONFIG, RoomMode } from "../src/phases";
import { GameEventId } from "../src/events";
import { GameEventView, RoomSnapshot, NightActionView } from "../src/snapshot";
import { gameActionPayload, roomConfigSchema, validateRoomConfig } from "../src/schemas";
import { PRESET_DECKS, ROLE_POWER, specialRoleList } from "../src/balance";

describe("Shared Roles", () => {
  it("includes all 15 roles with valid meta", () => {
    const expected = [
      "WEREWOLF",
      "WOLF_CUB",
      "SORCERER",
      "SEER",
      "APPRENTICE_SEER",
      "DETECTIVE",
      "GUARD",
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

  it("hard-deletes PRIEST/MEDIUM (no deprecated entries)", () => {
    expect(ROLES).not.toContain("PRIEST");
    expect(ROLES).not.toContain("MEDIUM");
    expect((ROLE_META as Record<string, unknown>)["PRIEST"]).toBeUndefined();
    expect((ROLE_META as Record<string, unknown>)["MEDIUM"]).toBeUndefined();
  });

  it("assigns correct teams to all roles", () => {
    expect(roleTeam("WEREWOLF")).toBe("wolves");
    expect(roleTeam("WOLF_CUB")).toBe("wolves");
    expect(roleTeam("SORCERER")).toBe("wolves");
    expect(roleTeam("SEER")).toBe("village");
    expect(roleTeam("APPRENTICE_SEER")).toBe("village");
    expect(roleTeam("DETECTIVE")).toBe("village");
    expect(roleTeam("GUARD")).toBe("village");
    expect(roleTeam("WITCH")).toBe("village");
    expect(roleTeam("HUNTER")).toBe("village");
    expect(roleTeam("MAYOR")).toBe("village");
    expect(roleTeam("CURSED")).toBe("village");
    expect(roleTeam("VILLAGER")).toBe("village");
    // Phe thứ ba: KHÔNG phải "village", và cũng không phải "wolves". Mọi phép
    // so đồng đội trong game đọc đúng trường này.
    expect(roleTeam("JESTER")).toBe("neutral");
  });

  it("distinguishes wolf pack from wolf faction", () => {
    // Bầy Sói: thức dậy cùng nhau, biết mặt đồng bọn.
    expect(isWolfPack("WEREWOLF")).toBe(true);
    expect(isWolfPack("WOLF_CUB")).toBe(true);
    expect(isWolfPack("SORCERER")).toBe(true);
    // Không trong bầy: Kẻ Phản Bội thắng cùng phe Sói nhưng không biết Sói là ai.
    expect(isWolfPack("TRAITOR")).toBe(false);
    expect(isWolfPack("SEER")).toBe(false);
    expect(isWolfPack("VILLAGER")).toBe(false);
  });

  it("orders night roles correctly in ROLE_ORDER_FOR_NIGHT", () => {
    // Expected order:
    // Guard: 0
    // Guardian Angel: 0.5
    // Seer: 1
    // Apprentice Seer: 1
    // Sorcerer: 1
    // Detective: 1.5
    // Werewolf: 2
    // Wolf Cub: 2
    // Serial Killer: 2.2
    // Tracker: 3
    // Witch: 3
    expect(ROLE_META.GUARD.nightOrder).toBe(0);
    expect(ROLE_META.SEER.nightOrder).toBe(1);
    expect(ROLE_META.APPRENTICE_SEER.nightOrder).toBe(1);
    expect(ROLE_META.SORCERER.nightOrder).toBe(1);
    expect(ROLE_META.DETECTIVE.nightOrder).toBe(1.5);
    expect(ROLE_META.WEREWOLF.nightOrder).toBe(2);
    expect(ROLE_META.WOLF_CUB.nightOrder).toBe(2);
    expect(ROLE_META.SERIAL_KILLER.nightOrder).toBe(2.2);
    expect(ROLE_META.TRACKER.nightOrder).toBe(3);
    expect(ROLE_META.WITCH.nightOrder).toBe(3);

    expect(ROLE_ORDER_FOR_NIGHT).toEqual([
      "GUARD",
      "SEER",
      "APPRENTICE_SEER",
      // Sói Pháp Sư cùng nightOrder 1 với hai vai soi: cả ba chỉ ĐỌC, không đổi
      // gì trong đêm, nên thứ tự giữa chúng không quan sát được từ bên ngoài.
      "SORCERER",
      "DETECTIVE",
      "WEREWOLF",
      "WOLF_CUB",
      "SERIAL_KILLER",
      // Kẻ Theo Dõi cùng nightOrder 3 với Phù Thuỷ: cả hai chỉ đọc/tác động sau
      // khi mọi đòn đêm đã khoá, và Kẻ Theo Dõi đứng trước vì nó được khai báo
      // trước trong ROLE_META (thứ tự giữa chúng không quan sát được từ bên
      // ngoài, cùng lý do với cụm nightOrder 1 ở trên).
      "TRACKER",
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
  it("validates gameActionPayload for detective, sorcerer", () => {
    // Detective action with targetId and secondary target or targetId1 & targetId2
    const detectiveAction = gameActionPayload.parse({
      type: "DETECTIVE_CHECK",
      targetId1: "p1",
      targetId2: "p2",
    });
    expect(detectiveAction.type).toBe("DETECTIVE_CHECK");

    // Sorcerer action
    const sorcererAction = gameActionPayload.parse({
      type: "SORCERER_CHECK",
      targetId: "p2",
    });
    expect(sorcererAction.type).toBe("SORCERER_CHECK");
  });
});

describe("Kẻ Theo Dõi", () => {
  it("là một vai phe làng có lượt đêm", () => {
    expect(isRole("TRACKER")).toBe(true);
    expect(ROLE_META.TRACKER.team).toBe("village");
    // Đọc kết quả của cả đêm nên phải thức sau mọi người ra tay.
    expect(ROLE_META.TRACKER.nightOrder).toBe(3);
  });

  it("giá đã đo: nằm trong một bậc của số đo 2026-09-11 (1.0, 9 mẫu)", () => {
    // Không còn là giá tạm "ngang Thám Tử": lượt đo đó hạ Thám Tử về 0 còn Kẻ
    // Theo Dõi đo ra 1.0 - lệch đúng một bậc nên bảng giữ 2 theo luật của nó.
    expect(Math.abs(ROLE_POWER.TRACKER - 1)).toBeLessThanOrEqual(1);
  });
});

describe("Xoá cứng Thiên Thần Hộ Mệnh", () => {
  it("Thiên Thần Hộ Mệnh đã bị xoá cứng", () => {
    expect(isRole("GUARDIAN_ANGEL")).toBe(false);
    expect((ROLE_POWER as Record<string, number>).GUARDIAN_ANGEL).toBeUndefined();
  });

  it("9 preset từng có Thiên Thần giờ có Kẻ Theo Dõi, giữ nguyên số ghế", () => {
    for (const n of [11, 13, 14, 15, 16, 17, 18, 19, 20]) {
      const preset = PRESET_DECKS[n]!;
      expect(preset.tracker, `preset ${n}`).toBe(true);
      expect((preset as unknown as Record<string, unknown>).guardianAngel, `preset ${n}`).toBeUndefined();
      // Bảo Vệ ở lại: cả 9 preset đều đã có sẵn nó.
      expect(preset.guard, `preset ${n}`).toBe(true);
      // Đổi một-đổi-một, nên số ghế đặc biệt phải khớp cỡ phòng như trước.
      expect(specialRoleList(preset).length + (preset.villagers ?? 0), `preset ${n}`).toBe(n);
    }
  });
});
