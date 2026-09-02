import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_ROOM_CONFIG, type NightRecap, type RoomConfig } from "@masoi/shared";
import { priestSpentRound, rolesInRecap } from "./night-recap-roles";

const p = (id: string, name: string) => ({ id, name });

function night(over: Partial<NightRecap> = {}): NightRecap {
  return {
    round: 1,
    wolfTarget: null,
    guardTarget: null,
    seerChecks: [],
    witch: { usedHeal: false, healedTarget: null, poisonTarget: null },
    deaths: [],
    ...over,
  };
}

function config(over: Partial<RoomConfig> = {}): RoomConfig {
  return { ...DEFAULT_ROOM_CONFIG, ...over };
}

test("vai đã bật trong cấu hình thì được kể dù cả ván không hành động lần nào", () => {
  const roles = rolesInRecap([night(), night({ round: 2 })], config({ guardianAngel: true, priest: true }));
  assert.equal(roles.guardianAngel, true);
  assert.equal(roles.priest, true);
});

test("vai không có trong ván thì không được kể", () => {
  const roles = rolesInRecap(
    [night()],
    config({ guard: false, witch: false, seer: false, guardianAngel: false, priest: false }),
  );
  assert.equal(roles.guard, false);
  assert.equal(roles.witch, false);
  assert.equal(roles.seer, false);
  assert.equal(roles.guardianAngel, false);
  assert.equal(roles.priest, false);
});

test("có dữ liệu trong lịch sử thì kể, kể cả khi cờ cấu hình thiếu", () => {
  // Server cũ deploy lệch: gửi hành động nhưng thiếu cờ vai mở rộng.
  const legacy = config({ guardianAngel: undefined, priest: undefined, detective: undefined });
  const roles = rolesInRecap(
    [
      night({
        guardianAngelTarget: p("a", "An"),
        priest: { priest: p("m", "Mục"), target: p("s", "Sói"), isWolf: true },
        detectiveChecks: [
          { detective: p("d", "Dò"), target1: p("x", "X"), target2: p("y", "Y"), sameTeam: true },
        ],
      }),
    ],
    legacy,
  );
  assert.equal(roles.guardianAngel, true);
  assert.equal(roles.priest, true);
  assert.equal(roles.detective, true);
});

test("không có cấu hình thì rơi hẳn về dữ liệu đã ghi", () => {
  const roles = rolesInRecap([night({ guardTarget: p("b", "Bảo") })]);
  assert.equal(roles.guard, true);
  assert.equal(roles.witch, false);
});

test("ván chỉ bật Tiên Tri Tập Sự vẫn có dòng Tiên Tri", () => {
  const roles = rolesInRecap([night()], config({ seer: false, apprenticeSeer: true }));
  assert.equal(roles.seer, true);
});

test("Phù Thuỷ tính là có hành động khi đã đốt bình cứu, không chỉ khi đầu độc", () => {
  const roles = rolesInRecap(
    [night({ witch: { usedHeal: true, healedTarget: p("a", "An"), poisonTarget: null } })],
    config({ witch: false }),
  );
  assert.equal(roles.witch, true);
});

test("Nước thánh chưa dùng thì không có đêm nào để chỉ tới", () => {
  const nights = [night(), night({ round: 2 })];
  assert.equal(priestSpentRound(nights, 0), null);
  assert.equal(priestSpentRound(nights, 1), null);
});

test("Nước thánh đã dùng ở đêm trước thì trả về đúng đêm đó", () => {
  const nights = [
    night({ round: 1 }),
    night({ round: 2, priest: { priest: p("m", "Mục"), target: p("s", "Sói"), isWolf: true } }),
    night({ round: 3 }),
  ];
  // Đêm dùng bình KHÔNG tự tính là "đã dùng từ trước".
  assert.equal(priestSpentRound(nights, 1), null);
  assert.equal(priestSpentRound(nights, 2), 2);
});
