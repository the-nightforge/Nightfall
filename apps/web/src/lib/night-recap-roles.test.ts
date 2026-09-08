import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_ROOM_CONFIG, type NightRecap, type RoomConfig } from "@masoi/shared";
import { rolesInRecap, sorcererChecksOf } from "./night-recap-roles";

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

/** Đêm mà Sói Pháp Sư đã kiểm tra — engine chưa ghi trường này vào recap,
 *  nên test bơm qua cast thay vì qua kiểu NightRecap. */
function nightWithSorcererCheck() {
  return night({
    sorcererChecks: [
      { sorcerer: p("s", "Sói"), target: p("t", "Tiên"), isSeerLine: true },
    ],
  } as unknown as Partial<NightRecap>);
}

function config(over: Partial<RoomConfig> = {}): RoomConfig {
  return { ...DEFAULT_ROOM_CONFIG, ...over };
}

test("vai đã bật trong cấu hình thì được kể dù cả ván không hành động lần nào", () => {
  const roles = rolesInRecap([night(), night({ round: 2 })], config({ detective: true, sorcerer: true }));
  assert.equal(roles.detective, true);
  assert.equal(roles.sorcerer, true);
});

test("vai không có trong ván thì không được kể", () => {
  const roles = rolesInRecap(
    [night()],
    config({ guard: false, witch: false, seer: false, detective: false, sorcerer: false }),
  );
  assert.equal(roles.guard, false);
  assert.equal(roles.witch, false);
  assert.equal(roles.seer, false);
  assert.equal(roles.detective, false);
  assert.equal(roles.sorcerer, false);
  // Thiên Thần Hộ Mệnh chỉ còn vế lịch sử: không cờ, không dữ liệu thì không kể.
  assert.equal(roles.guardianAngel, false);
});

test("có dữ liệu trong lịch sử thì kể, kể cả khi cờ cấu hình thiếu", () => {
  // Server cũ deploy lệch: gửi hành động nhưng thiếu cờ vai mở rộng.
  const legacy = config({ sorcerer: undefined, detective: undefined });
  const roles = rolesInRecap(
    [
      night({
        guardianAngelTarget: p("a", "An"),
        detectiveChecks: [
          { detective: p("d", "Dò"), target1: p("x", "X"), target2: p("y", "Y"), sameTeam: true },
        ],
      } as Partial<NightRecap>),
      nightWithSorcererCheck(),
    ],
    legacy,
  );
  // Thiên Thần Hộ Mệnh đã bị xoá cứng: recap của ván ĐÃ XONG vẫn phải kể được.
  assert.equal(roles.guardianAngel, true);
  assert.equal(roles.sorcerer, true);
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

test("đêm không có kiểm tra Pháp Sư thì không có gì để kể", () => {
  assert.deepEqual(sorcererChecksOf(night()), []);
});

test("đêm có kiểm tra Pháp Sư thì đọc ra đúng mục tiêu và kết quả", () => {
  const checks = sorcererChecksOf(nightWithSorcererCheck());
  assert.equal(checks.length, 1);
  assert.equal(checks[0].target.name, "Tiên");
  assert.equal(checks[0].isSeerLine, true);
});
