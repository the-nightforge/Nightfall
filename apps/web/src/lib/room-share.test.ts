import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInvitePayload,
  buildInviteUrl,
  classifyInviteError,
  describeInviteOutcome,
  inviteCapabilities,
  pickInviteStrategy,
  type InviteNavigatorLike,
} from "./room-share";

const CODE = "ABCDE";

describe("buildInviteUrl", () => {
  it("origin production ra đúng dạng ?code=", () => {
    assert.equal(buildInviteUrl("https://masoi.example", CODE), "https://masoi.example/?code=ABCDE");
  });

  it("localhost giữ nguyên cổng", () => {
    assert.equal(buildInviteUrl("http://localhost:3000", CODE), "http://localhost:3000/?code=ABCDE");
  });

  it("origin có trailing slash không sinh ra hai dấu gạch", () => {
    assert.equal(buildInviteUrl("https://masoi.example/", CODE), "https://masoi.example/?code=ABCDE");
  });

  it("origin có path thì giữ path lại", () => {
    // Ứng dụng đặt dưới một thư mục con thì link mời phải trỏ về ĐÚNG thư mục
    // đó, chứ không phải về gốc tên miền - ở gốc không có trang chủ nào.
    assert.equal(buildInviteUrl("https://x.example/game", CODE), "https://x.example/game?code=ABCDE");
  });

  it("origin có path kèm trailing slash giữ nguyên dấu gạch cuối", () => {
    assert.equal(buildInviteUrl("https://x.example/game/", CODE), "https://x.example/game/?code=ABCDE");
  });

  it("mã chữ thường được nâng lên chữ hoa", () => {
    assert.equal(buildInviteUrl("https://masoi.example", "abcde"), "https://masoi.example/?code=ABCDE");
  });

  it("mã có khoảng trắng thừa vẫn dùng được", () => {
    assert.equal(buildInviteUrl("https://masoi.example", "  abcde  "), "https://masoi.example/?code=ABCDE");
  });

  it("query và hash cũ của origin bị dọn sạch", () => {
    // `window.location.origin` không bao giờ mang hai thứ này, nhưng hàm cũng
    // nhận origin do chỗ khác truyền vào. Giữ lại `?code=` cũ nghĩa là link mời
    // mang hai mã phòng, còn hash thì kéo theo trạng thái tab của NGƯỜI MỜI -
    // không có lý do nào để gửi nó đi.
    assert.equal(
      buildInviteUrl("https://masoi.example/?code=ZZZZZ&ref=x#lobby", CODE),
      "https://masoi.example/?code=ABCDE",
    );
  });

  it("mã sai định dạng thì không dựng link", () => {
    assert.equal(buildInviteUrl("https://masoi.example", "ABC"), null);
    assert.equal(buildInviteUrl("https://masoi.example", "ABCDEF"), null);
    assert.equal(buildInviteUrl("https://masoi.example", "ABC-E"), null);
    assert.equal(buildInviteUrl("https://masoi.example", ""), null);
    assert.equal(buildInviteUrl("https://masoi.example", null), null);
  });

  it("origin rỗng hoặc hỏng thì trả null chứ không ném", () => {
    // Render phía server không có `window`, nên chỗ gọi truyền vào chuỗi rỗng.
    assert.equal(buildInviteUrl("", CODE), null);
    assert.equal(buildInviteUrl("không phải url", CODE), null);
    assert.equal(buildInviteUrl(undefined, CODE), null);
  });

  it("chỉ nhận http và https", () => {
    // `new URL` nuốt trôi mọi scheme. Một link mời `javascript:` hay `file:`
    // thì không ai mở được, mà lại đi thẳng vào QR và bộ nhớ tạm.
    assert.equal(buildInviteUrl("javascript:alert(1)", CODE), null);
    assert.equal(buildInviteUrl("file:///C:/x", CODE), null);
  });
});

describe("buildInvitePayload", () => {
  it("gói đủ tiêu đề, lời mời và link", () => {
    const payload = buildInvitePayload("https://masoi.example", CODE);
    assert.ok(payload);
    assert.equal(payload.url, "https://masoi.example/?code=ABCDE");
    assert.equal(payload.code, "ABCDE");
    assert.ok(payload.title.length > 0);
    assert.ok(payload.text.length > 0);
  });

  it("lời mời có nhắc mã phòng, để người nhận đọc qua điện thoại cũng vào được", () => {
    const payload = buildInvitePayload("https://masoi.example", CODE);
    assert.ok(payload);
    assert.match(payload.text, /ABCDE/);
  });

  it("lời mời không tự chép link vào - Web Share đã gửi url riêng", () => {
    // Nhiều ứng dụng nhận được cả `text` lẫn `url` rồi dán liền nhau; nhét link
    // vào text nữa là người nhận thấy đúng một đường link hai lần.
    const payload = buildInvitePayload("https://masoi.example", CODE);
    assert.ok(payload);
    assert.ok(!payload.text.includes("https://"));
  });

  it("mã hỏng hoặc origin hỏng thì không có gì để chia sẻ", () => {
    assert.equal(buildInvitePayload("https://masoi.example", "xx"), null);
    assert.equal(buildInvitePayload("", CODE), null);
  });

  it("không mang theo bất cứ thứ gì ngoài origin và mã phòng", () => {
    // Đây là bằng chứng cho yêu cầu "không đưa token vào URL/QR/analytics":
    // payload là hàm THUẦN của đúng hai tham số này, nên không có đường nào để
    // một playerId hay token lọt vào, kể cả khi chúng có mặt ở phạm vi ngoài.
    const playerId = "p_7f3a91";
    const token = "tok_secret_value";
    const payload = buildInvitePayload("https://masoi.example", CODE);
    assert.ok(payload);
    const everything = `${payload.url}|${payload.title}|${payload.text}|${payload.code}`;
    assert.ok(!everything.includes(playerId));
    assert.ok(!everything.includes(token));
    assert.ok(!/token|secret|playerId/i.test(everything));
  });
});

describe("pickInviteStrategy", () => {
  it("có Web Share thì mở bảng chia sẻ của hệ điều hành", () => {
    assert.equal(pickInviteStrategy({ canShare: true, canCopy: true }), "share");
  });

  it("không có Web Share thì chép link vào bộ nhớ tạm", () => {
    assert.equal(pickInviteStrategy({ canShare: false, canCopy: true }), "clipboard");
  });

  it("không có gì thì để người dùng tự chép", () => {
    assert.equal(pickInviteStrategy({ canShare: false, canCopy: false }), "manual");
  });
});

describe("inviteCapabilities", () => {
  it("không có navigator thì mọi khả năng đều tắt", () => {
    assert.deepEqual(inviteCapabilities(undefined), { canShare: false, canCopy: false });
  });

  it("trình duyệt trống rỗng thì cũng tắt hết", () => {
    assert.deepEqual(inviteCapabilities({}), { canShare: false, canCopy: false });
  });

  it("nhận ra share và clipboard khi có thật", () => {
    const nav: InviteNavigatorLike = {
      share: async () => {},
      clipboard: { writeText: async () => {} },
    };
    assert.deepEqual(inviteCapabilities(nav), { canShare: true, canCopy: true });
  });

  it("có clipboard nhưng thiếu writeText thì không tính là chép được", () => {
    // Ngữ cảnh không bảo mật (http trên máy khác localhost) cho ra đúng hình
    // này, và gọi vào là ném.
    assert.deepEqual(inviteCapabilities({ clipboard: {} }), { canShare: false, canCopy: false });
  });

  it("không đụng tới canShare - link thuần thì trình duyệt nào cũng gửi được", () => {
    // Khác hồ sơ vụ án: ở đó phải hỏi `canShare({files})` vì gửi kèm ảnh. Ở đây
    // payload chỉ có title/text/url, nên hỏi thêm một câu chỉ tạo thêm một
    // nhánh để hỏng - và có trình duyệt NÉM thay vì trả false.
    //
    // `canShare` ở đây ném để bài test tự chứng minh điều đó: gọi vào là đỏ.
    const hostile = {
      share: async () => {},
      canShare: () => {
        throw new Error("không được phép hỏi canShare");
      },
    } as InviteNavigatorLike;
    assert.equal(inviteCapabilities(hostile).canShare, true);
  });
});

describe("classifyInviteError", () => {
  it("người dùng đóng bảng chia sẻ là lựa chọn cố ý, không phải lỗi", () => {
    const error = new Error("share canceled");
    error.name = "AbortError";
    assert.deepEqual(classifyInviteError(error), { kind: "cancelled" });
  });

  it("lỗi thật thì nói ra và chỉ sang đường khác", () => {
    const outcome = classifyInviteError(new Error("NotAllowedError"));
    assert.equal(outcome.kind, "error");
    assert.ok(outcome.kind === "error" && outcome.message.length > 0);
  });

  it("thứ ném ra không phải Error vẫn phân loại được", () => {
    assert.equal(classifyInviteError("hỏng").kind, "error");
    assert.deepEqual(classifyInviteError({ name: "AbortError" }), { kind: "cancelled" });
  });
});

describe("describeInviteOutcome", () => {
  it("huỷ thì im lặng", () => {
    assert.equal(describeInviteOutcome({ kind: "cancelled" }), null);
  });

  it("mỗi kết quả còn lại đều có câu nói cho người dùng", () => {
    assert.ok(describeInviteOutcome({ kind: "shared" }));
    assert.ok(describeInviteOutcome({ kind: "copied-link" }));
    assert.ok(describeInviteOutcome({ kind: "copied-code" }));
    assert.ok(describeInviteOutcome({ kind: "manual" }));
    assert.equal(describeInviteOutcome({ kind: "error", message: "hỏng" }), "hỏng");
  });

  it("chép mã và chép link nói hai câu khác nhau", () => {
    // Hai nút nằm cạnh nhau; cùng một câu xác nhận thì người dùng không biết
    // mình vừa chép được thứ gì.
    assert.notEqual(
      describeInviteOutcome({ kind: "copied-code" }),
      describeInviteOutcome({ kind: "copied-link" }),
    );
  });
});
