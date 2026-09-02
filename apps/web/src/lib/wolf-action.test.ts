import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WOLF_TALLY_EMPTY,
  wolfBiteLabel,
  wolfSkipLabel,
  wolfTallyProgress,
} from "./wolf-action";

describe("wolfBiteLabel", () => {
  it("chưa chọn ai thì nút nói VIỆC CẦN LÀM", () => {
    assert.equal(wolfBiteLabel({ targetName: null }), "Chọn một người để cắn");
  });

  it("đã chọn thì nút mang tên mục tiêu", () => {
    assert.equal(wolfBiteLabel({ targetName: "Phú Lê" }), "Bầu chọn Phú Lê");
  });

  it("đêm cắn kép ghi cả hai tên", () => {
    assert.equal(
      wolfBiteLabel({ targetName: "Phú Lê", secondaryName: "Hải Yến" }),
      "Bầu chọn Phú Lê và Hải Yến",
    );
  });

  it("đã gửi xong thì nút xác nhận, không mời bấm lại", () => {
    assert.equal(
      wolfBiteLabel({ targetName: "Phú Lê", alreadyCast: true }),
      "Đã bầu chọn Phú Lê",
    );
  });

  it("đang gửi thì mọi trạng thái khác nhường chỗ", () => {
    // Kể cả khi đã có mục tiêu và đã từng bầu: trong lúc chờ máy chủ xác nhận,
    // điều duy nhất đúng để nói là phiếu đang trên đường đi.
    assert.equal(
      wolfBiteLabel({ targetName: "Phú Lê", alreadyCast: true, sending: true }),
      "Đang gửi phiếu…",
    );
  });
});

describe("wolfSkipLabel", () => {
  it("mặc định là một lựa chọn, không phải một lá phiếu đã bỏ", () => {
    assert.equal(wolfSkipLabel(), "Không cắn đêm nay");
  });

  it("đã bầu không cắn thì nói rõ là đã bầu", () => {
    assert.equal(wolfSkipLabel({ alreadyCast: true }), "Đã bầu không cắn đêm nay");
  });

  it("đang gửi thì dùng chung câu chờ với nút cắn", () => {
    assert.equal(wolfSkipLabel({ sending: true }), "Đang gửi phiếu…");
  });
});

describe("bảng phiếu của bầy", () => {
  it("tiến độ đọc theo thứ tự đã bầu / tổng số Sói", () => {
    assert.equal(wolfTallyProgress(0, 3), "0/3 Sói đã bỏ phiếu");
    assert.equal(wolfTallyProgress(2, 3), "2/3 Sói đã bỏ phiếu");
  });

  it("chưa ai bầu thì nói thành câu hoàn chỉnh", () => {
    assert.equal(WOLF_TALLY_EMPTY, "Chưa có Sói nào bỏ phiếu");
  });

  it('"Sói" luôn viết hoa - đó là tên phe, không phải con vật', () => {
    for (const text of [wolfTallyProgress(1, 2), WOLF_TALLY_EMPTY]) {
      assert.doesNotMatch(text, /(^|[^A-Za-zÀ-ỹ])sói/);
    }
  });
});
