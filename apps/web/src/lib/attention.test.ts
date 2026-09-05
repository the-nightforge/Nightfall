import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AttentionChannel,
  VIBRATE_PATTERN,
  formatTabTitle,
  shouldAskNotificationPermission,
  type AttentionPorts,
} from "./attention";
import type { Attention } from "./attention-cues";

const turn: Attention = { kind: "NIGHT_TURN", title: "Tới lượt bạn", body: "Chọn mục tiêu." };
const death: Attention = { kind: "DEATH", title: "Có người chết", body: "An" };

interface FakeWorld {
  ports: AttentionPorts;
  hidden: boolean;
  title: string;
  vibrations: number[][];
  notices: Array<{ title: string; body: string }>;
  /** Giả lập người dùng quay lại tab. */
  becomeVisible(): void;
}

function world(over: { hidden?: boolean; vibrate?: boolean; notify?: boolean } = {}): FakeWorld {
  const listeners = new Set<() => void>();
  const w: FakeWorld = {
    hidden: over.hidden ?? true,
    title: "Ma Sói",
    vibrations: [],
    notices: [],
    ports: null as unknown as AttentionPorts,
    becomeVisible() {
      w.hidden = false;
      for (const cb of listeners) cb();
    },
  };
  w.ports = {
    isHidden: () => w.hidden,
    getTitle: () => w.title,
    setTitle: (t) => {
      w.title = t;
    },
    vibrate: over.vibrate === false ? undefined : (p) => void w.vibrations.push(p),
    notify: over.notify === false ? undefined : (title, body) => void w.notices.push({ title, body }),
    onVisible: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return w;
}

describe("AttentionChannel", () => {
  it("không có gì để báo thì không đụng vào đâu", () => {
    const w = world();
    new AttentionChannel(w.ports).show([]);
    assert.equal(w.title, "Ma Sói");
    assert.deepEqual(w.vibrations, []);
    assert.deepEqual(w.notices, []);
  });

  it("tab ở nền: đổi tiêu đề, rung và gửi thông báo theo mục đầu", () => {
    const w = world({ hidden: true });
    new AttentionChannel(w.ports).show([turn, death]);
    assert.equal(w.title, formatTabTitle(turn.title));
    assert.deepEqual(w.vibrations, [VIBRATE_PATTERN]);
    assert.deepEqual(w.notices, [{ title: turn.title, body: turn.body }]);
  });

  it("tab đang mở: chỉ rung, không đổi tiêu đề, không gửi thông báo", () => {
    const w = world({ hidden: false });
    new AttentionChannel(w.ports).show([turn]);
    assert.equal(w.title, "Ma Sói");
    assert.deepEqual(w.vibrations, [VIBRATE_PATTERN]);
    assert.deepEqual(w.notices, []);
  });

  it("máy không rung, không có Notification: chỉ còn tiêu đề tab", () => {
    const w = world({ hidden: true, vibrate: false, notify: false });
    new AttentionChannel(w.ports).show([turn]);
    assert.equal(w.title, formatTabTitle(turn.title));
  });

  it("quay lại tab thì trả tiêu đề gốc", () => {
    const w = world({ hidden: true });
    new AttentionChannel(w.ports).show([turn]);
    w.becomeVisible();
    assert.equal(w.title, "Ma Sói");
  });

  it("hai lần báo liên tiếp khi vẫn ở nền: nhớ tiêu đề GỐC, không nhớ tiêu đề đã sửa", () => {
    const w = world({ hidden: true });
    const channel = new AttentionChannel(w.ports);
    channel.show([turn]);
    channel.show([death]);
    assert.equal(w.title, formatTabTitle(death.title));
    w.becomeVisible();
    assert.equal(w.title, "Ma Sói");
  });

  it("dispose trả tiêu đề gốc và thôi lắng nghe", () => {
    const w = world({ hidden: true });
    const channel = new AttentionChannel(w.ports);
    channel.show([turn]);
    channel.dispose();
    assert.equal(w.title, "Ma Sói");
    w.title = "Trang khác";
    w.becomeVisible();
    assert.equal(w.title, "Trang khác");
  });

  it("cổng ném lỗi thì nuốt: một kênh hỏng không được làm hỏng kênh còn lại", () => {
    const w = world({ hidden: true });
    w.ports.notify = () => {
      throw new Error("blocked");
    };
    new AttentionChannel(w.ports).show([turn]);
    assert.equal(w.title, formatTabTitle(turn.title));
    assert.deepEqual(w.vibrations, [VIBRATE_PATTERN]);
  });
});

describe("formatTabTitle", () => {
  it("chấm tròn ở đầu để thấy ngay trong hàng tab hẹp", () => {
    assert.equal(formatTabTitle("Tới lượt bạn"), "● Tới lượt bạn · Ma Sói");
  });
});

describe("shouldAskNotificationPermission", () => {
  it("chỉ hỏi khi trình duyệt còn để ngỏ và chưa hỏi lần nào", () => {
    assert.equal(shouldAskNotificationPermission("default", false), true);
  });
  it("đã hỏi rồi thì thôi, dù trình duyệt vẫn để ngỏ", () => {
    assert.equal(shouldAskNotificationPermission("default", true), false);
  });
  it("đã cho hoặc đã từ chối thì không hỏi", () => {
    assert.equal(shouldAskNotificationPermission("granted", false), false);
    assert.equal(shouldAskNotificationPermission("denied", false), false);
  });
  it("không có Notification API thì không hỏi", () => {
    assert.equal(shouldAskNotificationPermission(null, false), false);
  });
});
