import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";
import type { UseVoice } from "@/lib/useVoice";

/**
 * Dock voice: thứ người chơi nhìn vào để biết mic đang bật hay tắt.
 *
 * Bộ test này khoá hai thứ mà một lần đổi hình rất dễ làm rơi:
 *
 *  1. **Tên đọc được của nút mic.** Nó là control quan trọng nhất trong phòng,
 *     và trên dock nó chỉ là một icon - không có chữ nào cho người dùng trình
 *     đọc màn hình bám vào ngoài `aria-label`. Nhãn cũng phải nói TRẠNG THÁI
 *     hiện tại, không phải hành động, vì "Mic" một mình thì không biết đang bật
 *     hay tắt.
 *  2. **Chỉ có MỘT kết nối LiveKit.** Dock được vẽ hai lần - bản nổi cho điện
 *     thoại và bản trong cột phải cho desktop. Nếu bản nào tự gọi `useVoice`
 *     thì hai kết nối cùng một danh tính sẽ thay nhau đá nhau, đúng cái bẫy mà
 *     `VoiceProvider` sinh ra để tránh.
 */

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Số lần `useVoice` được gọi - tức số kết nối LiveKit mà cây này sẽ mở. */
let useVoiceCalls = 0;
let voice: UseVoice;

/* Cùng lý do với `mockModule` trong RosterPanel.test.tsx: Node 20/22 đọc
 * `namedExports`, Node 24 đổi sang `exports` và ném nếu nhận cả hai. */
const mockModule = async (specifier: string, exports: Record<string, unknown>) => {
  const tracker = mock as unknown as {
    module: (s: string, o: Record<string, unknown>) => Promise<unknown>;
  };
  try {
    return await tracker.module(specifier, { exports, namedExports: exports });
  } catch {
    return tracker.module(specifier, { exports });
  }
};

before(async () => {
  await mockModule(new URL("../lib/useVoice.ts", import.meta.url).href, {
    useVoice: () => {
      useVoiceCalls += 1;
      return voice;
    },
  });
  // Provider thật dựng socket.io ngay trong effect; ở đây không có server nào.
  await mockModule(new URL("../lib/socket.ts", import.meta.url).href, {
    getSocket: () => null,
  });
  await mockModule(new URL("../lib/identity.ts", import.meta.url).href, {
    getIdentity: () => ({ playerId: "p1", name: "Trường" }),
  });
});

function fakeVoice(over: Partial<UseVoice> = {}): UseVoice {
  return {
    ui: { visible: true, mode: "talk", reconnecting: false },
    activate: () => undefined,
    leave: () => undefined,
    holdStart: () => undefined,
    holdEnd: () => undefined,
    toggleMic: () => undefined,
    micMode: "toggle",
    setMicMode: () => undefined,
    micOpen: false,
    micIntent: false,
    micError: null,
    speakers: new Set<string>(),
    ...over,
  };
}

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "VOICE",
    hostId: "p1",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG, voice: true },
    round: 1,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: "p1", name: "Trường", ready: false, connected: true, alive: true },
    players: [{ id: "p1", name: "Trường", alive: true, isBot: false }],
    night: null,
    hunterShot: null,
    trial: null,
    lastTrial: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    dayVoteHistory: [],
    ...over,
  } as unknown as RoomSnapshot;
}

interface Mounted {
  text: string;
  /** `aria-label` của mọi nút, theo đúng thứ tự DOM. */
  labels: string[];
  html: string;
  cleanup(): Promise<void>;
}

async function mount(
  variant: "dock" | "panel",
  next: UseVoice,
  snap: RoomSnapshot | null = snapshot(),
): Promise<Mounted> {
  voice = next;
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { VoiceControl } = await import("./VoiceControl");
  const { VoiceProvider } = await import("./VoiceProvider");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      // `children` đi trong props chứ không ở dạng tham số biến thiên: kiểu của
      // provider khai báo `children` là bắt buộc, và dạng variadic không thoả nó.
      React.createElement(VoiceProvider, {
        snapshot: snap,
        children: React.createElement(VoiceControl, { snapshot: snap, variant }),
      }),
    );
  });

  return {
    text: host.textContent ?? "",
    labels: [...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? ""),
    html: host.innerHTML,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("nút mic phải tự nói nó đang bật hay tắt", () => {
  it("mic đang phát: nhãn nói rõ là đang bật", async () => {
    const view = await mount("panel", fakeVoice({ micOpen: true, micIntent: true }));
    assert.ok(
      view.labels.some((l) => /mic đang bật/i.test(l)),
      `không thấy nhãn "mic đang bật" trong ${JSON.stringify(view.labels)}`,
    );
    await view.cleanup();
  });

  it("mic đang tắt: nhãn nói rõ là đang tắt, và có icon gạch chéo", async () => {
    const view = await mount("panel", fakeVoice({ micOpen: false }));
    assert.ok(
      view.labels.some((l) => /mic đang tắt/i.test(l)),
      `không thấy nhãn "mic đang tắt" trong ${JSON.stringify(view.labels)}`,
    );
    // Gạch chéo là dấu hiệu nhận ra ngay, không cần đọc chữ.
    assert.match(view.html, /data-mic-slash/);
    await view.cleanup();
  });

  it("chạm vào là lật ý định mic, không phải gọi thẳng SDK", async () => {
    let toggled = 0;
    const view = await mount(
      "panel",
      fakeVoice({ micMode: "toggle", toggleMic: () => (toggled += 1) }),
    );
    const React = await import("react");
    void React;
    const { act } = await import("react");
    const button = [...document.querySelectorAll("button")].find((b) =>
      /mic đang/i.test(b.getAttribute("aria-label") ?? ""),
    );
    assert.ok(button, "phải có nút mic");
    await act(async () => {
      button.click();
    });
    assert.equal(toggled, 1);
    await view.cleanup();
  });
});

describe("trạng thái kết nối phải đọc được bằng chữ", () => {
  it("đã kết nối", async () => {
    const view = await mount("panel", fakeVoice());
    assert.match(view.text, /Đã kết nối/);
    await view.cleanup();
  });

  it("đang kết nối lại - kể cả khi vẫn đang ở chế độ nói", async () => {
    const view = await mount(
      "panel",
      fakeVoice({ ui: { visible: true, mode: "talk", reconnecting: true } }),
    );
    assert.match(view.text, /Đang kết nối lại/);
    await view.cleanup();
  });

  it("đang xin token sau khi rớt cũng là đang kết nối lại", async () => {
    const view = await mount(
      "panel",
      fakeVoice({ ui: { visible: true, mode: "connecting", reconnecting: true } }),
    );
    assert.match(view.text, /Đang kết nối lại/);
    await view.cleanup();
  });

  it("chỉ nghe", async () => {
    const view = await mount(
      "panel",
      fakeVoice({ ui: { visible: true, mode: "listen", reconnecting: false } }),
    );
    assert.match(view.text, /Chỉ nghe/);
    await view.cleanup();
  });

  it("lỗi kết nối, kèm đường thử lại", async () => {
    let activated = 0;
    const view = await mount(
      "panel",
      fakeVoice({
        ui: { visible: true, mode: "error", reconnecting: false },
        activate: () => (activated += 1),
      }),
    );
    assert.match(view.text, /Mất kết nối|Lỗi kết nối/);
    const { act } = await import("react");
    const retry = [...document.querySelectorAll("button")].at(-1);
    await act(async () => retry?.click());
    assert.equal(activated, 1);
    await view.cleanup();
  });

  it("bị đá vì mở tab khác: mời chọn tab này, KHÔNG tự nối lại", async () => {
    const view = await mount(
      "panel",
      fakeVoice({ ui: { visible: true, mode: "duplicate", reconnecting: false } }),
    );
    assert.match(view.text, /tab này/);
    await view.cleanup();
  });
});

describe("ngắt và vào lại kênh thoại", () => {
  it("đang nối thì có nút ngắt", async () => {
    let left = 0;
    const view = await mount("panel", fakeVoice({ leave: () => (left += 1) }));
    const { act } = await import("react");
    const button = [...document.querySelectorAll("button")].find((b) =>
      /ngắt/i.test(b.getAttribute("aria-label") ?? ""),
    );
    assert.ok(button, "phải có nút ngắt kênh thoại");
    await act(async () => button.click());
    assert.equal(left, 1);
    await view.cleanup();
  });

  it("chưa vào thì mời bấm để vào", async () => {
    const view = await mount(
      "panel",
      fakeVoice({ ui: { visible: true, mode: "join", reconnecting: false } }),
    );
    assert.match(view.text, /Vào kênh thoại|Bật mic/);
    await view.cleanup();
  });
});

describe("dock nổi trên điện thoại", () => {
  it("là lớp nổi cố định, và né chỗ nút chat lẫn safe-area", async () => {
    const view = await mount("dock", fakeVoice());
    const dock = document.querySelector("[data-voice-dock]");
    assert.ok(dock, "phải có phần tử dock");
    const className = dock.getAttribute("class") ?? "";
    assert.match(className, /fixed/);
    // Nút chat nổi ở `bottom-4 left-4`; dock phải ở phía đối diện.
    assert.match(className, /right-4/);
    assert.match(className, /lg:hidden/, "desktop dùng bản trong cột phải");
    // Lề an toàn đi bằng class chứ không bằng inline style: `env()` trong thuộc
    // tính `style` bị CSSOM của happy-dom loại thẳng, nên nó không kiểm chứng được.
    assert.match(className, /env\(safe-area-inset-bottom\)/);
    await view.cleanup();
  });

  it("chưa vào kênh thì dock chỉ còn MỘT hàng: không có chip nhắc lại cái nút, và nút không đỏ", async () => {
    const view = await mount(
      "dock",
      fakeVoice({ ui: { visible: true, mode: "join", reconnecting: false } }),
    );
    // Chip "Chưa vào kênh thoại" và nút "Vào kênh thoại" nói cùng một điều;
    // xếp chồng chúng lên trên nút Bắt đầu là cụm nổi cao gần nửa màn iPhone.
    assert.doesNotMatch(view.text, /Chưa vào kênh thoại/);
    assert.match(view.text, /Vào kênh thoại/);
    const button = [...document.querySelectorAll("[data-voice-dock] button")].find((b) =>
      /Vào kênh thoại/.test(b.textContent ?? ""),
    );
    assert.ok(button, "phải có nút vào kênh thoại");
    // Đỏ là màu của CTA và của cảnh báo; một lời mời bình thường không được
    // nổi hơn nút Bắt đầu đang xám ngay cạnh nó.
    assert.doesNotMatch(button.getAttribute("class") ?? "", /bg-blood/);
    await view.cleanup();
  });

  it("kênh thoại hỏng thì chip vẫn ở lại nói chuyện gì đã xảy ra", async () => {
    const view = await mount(
      "dock",
      fakeVoice({ ui: { visible: true, mode: "error", reconnecting: false } }),
    );
    assert.match(view.text, /Mất kết nối thoại/);
    assert.match(view.text, /Thử kết nối lại/);
    await view.cleanup();
  });

  it("bản trong cột phải không nổi", async () => {
    const view = await mount("panel", fakeVoice());
    // So bằng boolean, không so thẳng phần tử: `assert.equal` sẽ đi dựng diff
    // cho một node DOM có vòng tham chiếu và làm cạn bộ nhớ tiến trình test.
    assert.equal(view.html.includes("data-voice-dock"), false);
    await view.cleanup();
  });

  it("phòng chưa bật voice thì không vẽ gì cả", async () => {
    const view = await mount(
      "dock",
      fakeVoice({ ui: { visible: false, mode: "join", reconnecting: false } }),
    );
    assert.equal(view.html, "");
    await view.cleanup();
  });
});

describe("hai chỗ vẽ, MỘT kết nối LiveKit", () => {
  it("vẽ cả bản dock lẫn bản cột phải trong cùng một provider vẫn chỉ gọi useVoice một lần", async () => {
    const React = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { VoiceControl } = await import("./VoiceControl");
    const { VoiceProvider } = await import("./VoiceProvider");

    voice = fakeVoice();
    useVoiceCalls = 0;
    const snap = snapshot();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        React.createElement(VoiceProvider, {
          snapshot: snap,
          children: [
            React.createElement(VoiceControl, { snapshot: snap, variant: "dock", key: "d" }),
            React.createElement(VoiceControl, { snapshot: snap, variant: "panel", key: "p" }),
          ],
        }),
      );
    });

    assert.equal(useVoiceCalls, 1, "hai kết nối cùng danh tính sẽ thay nhau đá nhau");
    await act(async () => root.unmount());
    host.remove();
  });
});

/**
 * Lỗi mic phải hiện ra thành chữ.
 *
 * Đây là hệ quả trực tiếp của việc bỏ vòng retry: mic không còn tự thử lại
 * nữa, nên nếu dock im lặng thì người chơi ngồi trước một nút mic tắt mà không
 * biết vì sao nó không chịu bật, và cũng không biết phải làm gì.
 */
describe("mic hỏng thì dock phải nói ra", () => {
  it("hiện lý do, và nói rõ chạm lại là thử lại", async () => {
    const view = await mount(
      "panel",
      fakeVoice({ micError: "Không bật được mic. Kiểm tra quyền truy cập rồi chạm để thử lại." }),
    );
    assert.match(view.text, /Không bật được mic/);
    await view.cleanup();
  });

  it("nút mic vẫn bấm được - chính nó là nút thử lại", async () => {
    let toggled = 0;
    const view = await mount(
      "panel",
      fakeVoice({ micError: "Không bật được mic.", toggleMic: () => (toggled += 1) }),
    );
    const { act } = await import("react");
    const button = [...document.querySelectorAll("button")].find((b) =>
      /mic đang/i.test(b.getAttribute("aria-label") ?? ""),
    );
    assert.ok(button, "phải còn nút mic để bấm");
    await act(async () => button.click());
    assert.equal(toggled, 1);
    await view.cleanup();
  });

  it("bản dock cũng nói, không chỉ bản cột phải", async () => {
    const view = await mount("dock", fakeVoice({ micError: "Không bật được mic." }));
    assert.match(view.text, /Không bật được mic/);
    await view.cleanup();
  });

  it("không có lỗi thì không bịa ra dòng cảnh báo nào", async () => {
    const view = await mount("panel", fakeVoice());
    assert.doesNotMatch(view.text, /Không bật được mic/);
    await view.cleanup();
  });
});
