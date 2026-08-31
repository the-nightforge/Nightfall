import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyShareError,
  describeShareOutcome,
  pickShareStrategy,
  shareCapabilities,
  type ShareNavigatorLike,
} from "./case-share";

const FAKE_FILE = { name: "ho-so.png", type: "image/png" } as File;

describe("pickShareStrategy", () => {
  it("có Web Share nhận file thì gửi cả ảnh", () => {
    assert.equal(pickShareStrategy({ canShareFiles: true, canShare: true, canCopy: true }), "files");
  });

  it("có Web Share nhưng không nhận file thì gửi text", () => {
    assert.equal(pickShareStrategy({ canShareFiles: false, canShare: true, canCopy: true }), "text");
  });

  it("không có Web Share thì chép vào bộ nhớ tạm", () => {
    assert.equal(pickShareStrategy({ canShareFiles: false, canShare: false, canCopy: true }), "clipboard");
  });

  it("không có gì thì để người dùng tự chép", () => {
    assert.equal(pickShareStrategy({ canShareFiles: false, canShare: false, canCopy: false }), "manual");
  });

  it("ảnh hỏng vẫn còn đường chia sẻ text", () => {
    // canShareFiles đã gộp sẵn điều kiện "có ảnh", nên xuất ảnh thất bại chỉ
    // tụt xuống một bậc chứ không mất luôn nút chia sẻ.
    assert.equal(pickShareStrategy({ canShareFiles: false, canShare: true, canCopy: true }), "text");
  });
});

describe("shareCapabilities", () => {
  it("trình duyệt không có gì thì mọi khả năng đều tắt", () => {
    const caps = shareCapabilities({}, null);
    assert.deepEqual(caps, { canShareFiles: false, canShare: false, canCopy: false });
  });

  it("navigator vắng mặt hoàn toàn cũng không nổ", () => {
    assert.deepEqual(shareCapabilities(undefined, FAKE_FILE), {
      canShareFiles: false,
      canShare: false,
      canCopy: false,
    });
  });

  it("có share nhưng không có ảnh thì không bật nhánh file", () => {
    const nav: ShareNavigatorLike = { share: async () => {}, canShare: () => true };
    assert.equal(shareCapabilities(nav, null).canShareFiles, false);
    assert.equal(shareCapabilities(nav, null).canShare, true);
  });

  it("có ảnh và canShare chấp nhận file thì bật nhánh file", () => {
    const nav: ShareNavigatorLike = { share: async () => {}, canShare: () => true };
    assert.equal(shareCapabilities(nav, FAKE_FILE).canShareFiles, true);
  });

  it("canShare từ chối file thì không bật nhánh file", () => {
    const nav: ShareNavigatorLike = { share: async () => {}, canShare: () => false };
    assert.equal(shareCapabilities(nav, FAKE_FILE).canShareFiles, false);
    assert.equal(shareCapabilities(nav, FAKE_FILE).canShare, true);
  });

  it("canShare ném lỗi thì coi như không hỗ trợ file, không làm vỡ luồng", () => {
    const nav: ShareNavigatorLike = {
      share: async () => {},
      canShare: () => {
        throw new Error("boom");
      },
    };
    assert.equal(shareCapabilities(nav, FAKE_FILE).canShareFiles, false);
  });

  it("có clipboard.writeText thì bật khả năng chép", () => {
    assert.equal(shareCapabilities({ clipboard: { writeText: async () => {} } }, null).canCopy, true);
  });
});

describe("classifyShareError", () => {
  it("người dùng huỷ bảng chia sẻ là huỷ, không phải lỗi", () => {
    const abort = Object.assign(new Error("share canceled"), { name: "AbortError" });
    assert.deepEqual(classifyShareError(abort), { kind: "cancelled" });
  });

  it("lỗi thật thì báo lỗi kèm lối thoát", () => {
    const outcome = classifyShareError(new Error("network"));
    assert.equal(outcome.kind, "error");
    assert.ok(outcome.kind === "error" && outcome.message.length > 0);
  });

  it("giá trị ném ra không phải Error cũng xử lý được", () => {
    assert.equal(classifyShareError("hỏng").kind, "error");
  });
});

describe("describeShareOutcome", () => {
  it("huỷ thì im lặng - không dựng toast đỏ cho một hành động cố ý", () => {
    assert.equal(describeShareOutcome({ kind: "cancelled" }), null);
  });

  it("chép xong thì xác nhận", () => {
    const message = describeShareOutcome({ kind: "copied" });
    assert.ok(message && message.length > 0);
  });

  it("phải tự chép thì hướng dẫn bằng tiếng Việt", () => {
    const message = describeShareOutcome({ kind: "manual" });
    assert.ok(message && message.includes("sao chép"));
  });

  it("lỗi thì trả lại đúng lời nhắn của lỗi", () => {
    assert.equal(describeShareOutcome({ kind: "error", message: "Không chia sẻ được" }), "Không chia sẻ được");
  });

  it("chia sẻ xong thì xác nhận ngắn", () => {
    assert.ok(describeShareOutcome({ kind: "shared" }));
  });
});
