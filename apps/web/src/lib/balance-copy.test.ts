import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BalanceWarningView } from "@masoi/shared";
import { balanceCopy } from "./balance-copy";

function view(patch: Partial<BalanceWarningView> = {}): BalanceWarningView {
  return {
    score: 50,
    warnings: [],
    blocking: false,
    villagePower: 0,
    wolfPower: 0,
    ...patch,
  };
}

describe("balanceCopy", () => {
  it("không có cảnh báo thì không có lời khuyên nào", () => {
    const copy = balanceCopy(view(), 8);
    assert.deepEqual(copy.advice, []);
    assert.deepEqual(copy.technical, []);
  });

  it("giữ nguyên bản kỹ thuật của engine để đặt vào tooltip", () => {
    const raw = ["Cảnh báo cân bằng: BalanceScore 58 ngoài ngưỡng 45-55"];
    const copy = balanceCopy(view({ score: 58, warnings: raw }), 8);
    assert.deepEqual(copy.technical, raw);
  });

  it("không để chữ BalanceScore lọt ra lời khuyên", () => {
    const copy = balanceCopy(
      view({ score: 58, warnings: ["Cảnh báo cân bằng: BalanceScore 58 ngoài ngưỡng 45-55"] }),
      8,
    );
    assert.equal(copy.advice.length, 1);
    assert.ok(!copy.advice[0].includes("BalanceScore"));
    assert.ok(!copy.advice[0].includes("ngưỡng"));
  });

  it("điểm trên 55 là nghiêng về phe Dân, và nói rõ phải thêm gì", () => {
    const copy = balanceCopy(
      view({ score: 58, warnings: ["Cảnh báo cân bằng: BalanceScore 58 ngoài ngưỡng 45-55"] }),
      8,
    );
    assert.match(copy.advice[0], /nghiêng về phe Dân Làng/);
    assert.match(copy.advice[0], /Ma Sói/);
  });

  it("điểm dưới 45 là nghiêng về phe Sói", () => {
    const copy = balanceCopy(
      view({ score: 38, warnings: ["Cân bằng lệch: BalanceScore 38 ngoài ngưỡng 40-60"], blocking: true }),
      8,
    );
    assert.match(copy.advice[0], /nghiêng về phe Ma Sói/);
  });

  it("blocking đi thẳng qua, không bị diễn giải lại", () => {
    assert.equal(balanceCopy(view({ blocking: true, warnings: ["x"] }), 8).blocking, true);
    assert.equal(balanceCopy(view({ blocking: false, warnings: ["x"] }), 8).blocking, false);
  });

  it("tiêu đề nặng hơn khi đang bị chặn", () => {
    assert.notEqual(
      balanceCopy(view({ blocking: true }), 8).headline,
      balanceCopy(view({ blocking: false }), 8).headline,
    );
  });

  it("tỉ lệ Sói lệch nói về số Ma Sói chứ không đọc ra phần trăm", () => {
    const copy = balanceCopy(
      view({ warnings: ["Tỉ lệ Sói lệch 18.8% so với preset chuẩn (2/8)"], blocking: true }),
      8,
    );
    assert.match(copy.advice[0], /số Ma Sói/);
    assert.ok(!copy.advice[0].includes("%"));
  });

  it("năng lực soi lệch gọi tên các vai soi", () => {
    const copy = balanceCopy(
      view({ warnings: ["Năng lực soi lệch 3.0 điểm so với preset chuẩn"], blocking: true }),
      8,
    );
    assert.match(copy.advice[0], /Tiên Tri/);
  });

  it("thiếu preset thì nhắc đúng số người đang có", () => {
    const copy = balanceCopy(view({ warnings: ["Không có preset cho 16 người chơi"] }), 16);
    assert.match(copy.advice[0], /16 người/);
  });

  it("hai cảnh báo quy về cùng một lời khuyên chỉ hiện một lần", () => {
    const copy = balanceCopy(
      view({
        score: 62,
        blocking: true,
        warnings: [
          "Cân bằng lệch: BalanceScore 62 ngoài ngưỡng 40-60",
          "Cấu hình mất cân bằng",
        ],
      }),
      8,
    );
    assert.equal(copy.advice.length, 1);
  });

  it("cảnh báo lạ thì giữ nguyên văn thay vì nuốt mất", () => {
    const copy = balanceCopy(view({ warnings: ["Một luật mới nào đó"] }), 8);
    assert.deepEqual(copy.advice, ["Một luật mới nào đó"]);
  });
});
