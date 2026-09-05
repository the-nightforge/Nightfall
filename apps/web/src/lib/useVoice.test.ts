import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Socket } from "socket.io-client";
import { DisconnectReason } from "livekit-client";
import type { VoiceRoomHandlers } from "./voice-room";
import { classifyDisconnect } from "./voice-disconnect";
import { CONNECT_TIMEOUT_MS } from "./voice-reconnect";
import type { UseVoice } from "./useVoice";

/**
 * Tầng nối hook ↔ SDK ↔ socket.
 *
 * Bộ test này tồn tại vì một bài học đắt: cả BA lỗi voice lọt lên production
 * ngày 2026-08-30 đều nằm đúng ở tầng này, và toàn bộ test web vẫn xanh suốt -
 * chúng chỉ chạy trên máy trạng thái thuần, mà máy trạng thái thì đúng.
 *
 * Việc tự nối lại rơi vào đúng cái bẫy ấy: `voice-reconnect.ts` thuần và có test
 * riêng, nhưng thứ quyết định người chơi có phải bấm "Bật mic" lần nữa hay
 * không lại là chuyện hook có NGHE đúng bốn sự kiện kia hay không.
 */

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Handler mà hook đưa cho lớp bọc LiveKit; test dùng nó để giả lập SDK. */
let roomHandlers: VoiceRoomHandlers | null = null;
/** Số `Room` LiveKit đã được dựng - hai cái cùng danh tính sẽ đá nhau. */
let roomsCreated = 0;
const roomCalls: string[] = [];
/** Mọi lời gọi `setMic`, kèm hướng - để đếm được số lần thử mở. */
let micCalls: boolean[] = [];
/** Trả true để `setMic` hướng đó ném lỗi. */
let micRejects: ((on: boolean) => boolean) | null = null;

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
  await mockModule(new URL("./voice-room.ts", import.meta.url).href, {
    createVoiceRoom: (handlers: VoiceRoomHandlers) => {
      roomHandlers = handlers;
      roomsCreated += 1;
      return {
        connect: async () => {
          roomCalls.push("connect");
        },
        setMic: async (on: boolean) => {
          roomCalls.push("setMic");
          micCalls.push(on);
          if (micRejects?.(on)) throw new Error("Trình duyệt từ chối micro");
        },
        startAudio: async () => {
          roomCalls.push("startAudio");
        },
        disconnect: async () => {
          roomCalls.push("disconnect");
        },
      };
    },
  });
  // `unlock()` dựng AudioContext thật; ở đây không có thiết bị âm thanh nào.
  await mockModule(new URL("./audio-engine.ts", import.meta.url).href, {
    audioEngine: { unlock: () => undefined },
  });
});

type Listener = (payload?: unknown) => void;

function fakeSocket() {
  const listeners = new Map<string, Set<Listener>>();
  const emitted: string[] = [];
  const socket = {
    on(event: string, fn: Listener) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(fn);
      listeners.set(event, set);
      return socket;
    },
    off(event: string, fn: Listener) {
      listeners.get(event)?.delete(fn);
      return socket;
    },
    emit(event: string) {
      emitted.push(event);
      return true;
    },
  };
  return {
    socket: socket as unknown as Socket,
    emitted,
    fire(event: string, payload?: unknown) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(payload);
    },
  };
}

const VIEW = { available: true, enabled: true, canPublish: true, roomName: "r" };

/**
 * Ép `document.hidden` / `navigator.onLine` về một giá trị.
 *
 * happy-dom không có API đổi hai thứ này, mà chúng lại là điều kiện then chốt
 * của việc tự nối lại: hook phải im khi app còn nằm nền hoặc còn mất mạng.
 *
 * @returns hàm trả lại nguyên trạng
 */
function force(target: object, prop: string, value: unknown): () => void {
  const original = Object.getOwnPropertyDescriptor(target, prop);
  Object.defineProperty(target, prop, { configurable: true, get: () => value });
  return () => {
    if (original) Object.defineProperty(target, prop, original);
    else delete (target as Record<string, unknown>)[prop];
  };
}

async function mount() {
  micCalls = [];
  micRejects = null;
  roomsCreated = 0;
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useVoice } = await import("./useVoice");

  const wire = fakeSocket();
  const api: { current: UseVoice | null } = { current: null };

  function Probe() {
    api.current = useVoice(wire.socket, VIEW);
    return null;
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(Probe));
  });

  const run = async (fn: () => void | Promise<void>) => {
    await act(async () => {
      await fn();
    });
  };

  return {
    wire,
    /**
     * LiveKit ngắt kết nối với một lý do THẬT của SDK.
     *
     * Đi qua `classifyDisconnect` thật chứ không truyền sẵn nhãn: chính việc
     * test bằng một boolean tự chế là thứ đã giấu lỗi "bị đuổi thì tự vào lại"
     * đi. Ở đây enum thật của SDK chạy hết đường tới hook.
     */
    drop: async (reason: DisconnectReason | undefined) => {
      await run(() => roomHandlers?.onDisconnected(classifyDisconnect(reason)));
    },
    roomsCreated: () => roomsCreated,
    /** Số lần đã xin token - tức số lần sẽ mở một phiên LiveKit mới. */
    tokenRequests: () => wire.emitted.filter((e) => e === "voice:token").length,
    /** Số lần đã gọi `setMic(true)`. Vòng retry vô hạn lộ ra ở đúng con số này. */
    micOpenAttempts: () => micCalls.filter((on) => on).length,
    micCloseAttempts: () => micCalls.filter((on) => !on).length,
    disconnects: () => roomCalls.filter((c) => c === "disconnect").length,
    /** Số lần gọi `startAudio` - đường DUY NHẤT phát lại tiếng người khác trên iOS. */
    startAudioCalls: () => roomCalls.filter((c) => c === "startAudio").length,
    /** Thứ tự các lời gọi tới lớp bọc LiveKit, để so "trước/sau". */
    calls: () => [...roomCalls],
    /** Server trả token: hook vào phòng rồi mới ngã ngũ chuyện phát tiếng. */
    token: async () => {
      await run(() => wire.fire("voice:token", { url: "wss://lk", token: "t" }));
    },
    /** Quay vài vòng event loop + render, đủ để một vòng retry lộ diện. */
    churn: async () => {
      for (let i = 0; i < 5; i += 1) {
        await act(async () => {
          await new Promise((resolve) => setImmediate(resolve));
        });
      }
    },
    readySignals: () => wire.emitted.filter((e) => e === "voice:ready").length,
    run,
    /** Bấm "Vào kênh thoại" rồi giả lập LiveKit nối xong. */
    join: async () => {
      await run(() => api.current?.activate());
      await run(() => roomHandlers?.onConnected());
    },
    api,
    /** Bốn tín hiệu "app sống dậy", bắn dồn như khi mở lại app thật. */
    wakeAll: async () => {
      await run(() => {
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pageshow"));
        window.dispatchEvent(new Event("online"));
        wire.fire("connect");
      });
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("tự nối lại khi app sống dậy", () => {
  it("đã vào voice rồi rớt: quay lại foreground chỉ xin token MỘT lần", async () => {
    const view = await mount();
    await view.join();
    const afterJoin = view.tokenRequests();

    await view.drop(DisconnectReason.SIGNAL_CLOSE);
    await view.wakeAll();

    assert.equal(
      view.tokenRequests() - afterJoin,
      1,
      "bốn tín hiệu cho một lần thức dậy phải gộp thành một lần xin token",
    );
    await view.cleanup();
  });

  it("chưa từng bấm tham gia thì không tín hiệu nào kéo được vào voice", async () => {
    const view = await mount();
    await view.wakeAll();
    assert.equal(view.tokenRequests(), 0);
    await view.cleanup();
  });

  it("bị đá vì trùng danh tính: KHÔNG tự nối lại, chờ người dùng chọn tab", async () => {
    /*
     * Không có luật này thì hai tab tự nối lại rồi thay nhau đá nhau vô tận -
     * mỗi vòng là một token mới và một lần cả bàn mất tiếng của người đó.
     */
    const view = await mount();
    await view.join();
    const afterJoin = view.tokenRequests();

    await view.drop(DisconnectReason.DUPLICATE_IDENTITY);
    await view.wakeAll();

    assert.equal(view.tokenRequests(), afterJoin);
    await view.cleanup();
  });

  it("chủ động ngắt rồi thì cũng im", async () => {
    const view = await mount();
    await view.join();
    const afterJoin = view.tokenRequests();

    await view.run(() => view.api.current?.leave());
    await view.wakeAll();

    assert.equal(view.tokenRequests(), afterJoin);
    await view.cleanup();
  });

  it("gỡ listener khi unmount: rời phòng rồi thì tab không còn xin token nữa", async () => {
    const view = await mount();
    await view.join();
    await view.drop(DisconnectReason.SIGNAL_CLOSE);
    const before = view.tokenRequests();

    await view.cleanup();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("online"));

    assert.equal(view.tokenRequests(), before);
  });
});

describe("không kẹt vĩnh viễn ở 'đang kết nối'", () => {
  it("server im lặng từ chối token: quá hạn thì báo lỗi và mời thử lại", async () => {
    /*
     * Server trả lời `voice:token` hỏng bằng sự kiện lỗi CHUNG của socket, cùng
     * đường với "phòng đã đầy". Hook không phân biệt được lỗi nào của mình, nên
     * mốc thời gian là thứ duy nhất kéo nó ra khỏi trạng thái treo - và nếu treo
     * thì cổng nối lại cũng khoá theo, vì `connection` không rời `connecting`.
     */
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const view = await mount();
      await view.run(() => view.api.current?.activate());
      assert.equal(view.api.current?.ui.mode, "connecting");

      await view.run(() => mock.timers.tick(CONNECT_TIMEOUT_MS + 1));

      assert.equal(view.api.current?.ui.mode, "error", "phải có đường thoát ra");
      await view.cleanup();
    } finally {
      mock.timers.reset();
    }
  });
});

describe("nối lại xong phải tự giới thiệu lại với server", () => {
  it("LiveKit tự vá đường truyền: gửi lại voice:ready", async () => {
    /*
     * Reconnect đầy đủ thì participant vào lại bằng chính token cũ, mà token
     * không bao giờ mang quyền nói. Server không biết chuyện đó xảy ra.
     */
    const view = await mount();
    await view.join();
    const before = view.readySignals();

    await view.run(() => roomHandlers?.onReconnected());

    assert.equal(view.readySignals(), before + 1);
    await view.cleanup();
  });

  /**
   * Nửa còn thiếu, và là nửa người chơi NHÌN THẤY.
   *
   * Bản trước chỉ gửi `voice:ready` ở `onReconnected` mà không hạ cờ nào cả:
   * LiveKit đã vá xong đường truyền, tiếng đã thông trở lại, nhưng dock vẫn ghi
   * "Đang kết nối lại" cho tới hết ván. Test cũ không thấy vì nó chỉ đếm
   * `voice:ready`.
   */
  it("hạ cờ 'đang nối lại' mà không xin token, không dựng Room, không đụng mic", async () => {
    const view = await mount();
    await view.join();
    await view.run(() => view.api.current?.setMicMode("toggle"));
    await view.run(() => roomHandlers?.onPermission(true));
    await view.run(() => view.api.current?.toggleMic());
    await view.churn();
    assert.equal(view.api.current?.micIntent, true, "đang bật mic trước khi đường truyền chớp");
    assert.equal(view.api.current?.micOpen, true);

    const tokensBefore = view.tokenRequests();
    const readyBefore = view.readySignals();
    const roomsBefore = view.roomsCreated();

    await view.run(() => roomHandlers?.onReconnecting());
    assert.equal(view.api.current?.ui.reconnecting, true, "phải nói là đang nối lại");

    await view.run(() => roomHandlers?.onReconnected());
    await view.churn();

    assert.equal(view.api.current?.ui.reconnecting, false, "nối lại xong thì phải thôi báo");
    assert.equal(view.api.current?.ui.mode, "talk");
    assert.equal(view.readySignals() - readyBefore, 1, "đúng một lần xin lại quyền nói");
    assert.equal(
      view.tokenRequests(),
      tokensBefore,
      "cùng một phiên LiveKit: không có token nào được xin",
    );
    assert.equal(view.roomsCreated(), roomsBefore, "và không dựng Room thứ hai");
    assert.equal(view.api.current?.micIntent, true, "người dùng chưa hề tắt mic");
    assert.equal(view.api.current?.micOpen, true);
    await view.cleanup();
  });
});

describe("ý định mic qua một vòng đêm", () => {
  it("bật ở chế độ chạm, bị thu quyền, rồi được cấp lại: mic tự mở", async () => {
    const view = await mount();
    await view.join();
    await view.run(() => view.api.current?.setMicMode("toggle"));
    await view.run(() => roomHandlers?.onPermission(true));
    await view.run(() => view.api.current?.toggleMic());
    assert.equal(view.api.current?.micIntent, true);

    // Đêm xuống: server thu quyền.
    await view.run(() => roomHandlers?.onPermission(false));
    assert.equal(view.api.current?.micIntent, true, "ý định phải sống qua đêm");

    // Sáng ra: LiveKit xác nhận được nói lại.
    await view.run(() => roomHandlers?.onPermission(true));
    // Một nhịp nữa để vòng đối chiếu mic chạy xong - `setMic` là bất đồng bộ.
    await view.run(() => undefined);
    assert.equal(view.api.current?.micOpen, true, "mic tự mở lại theo ý định cũ");
    await view.cleanup();
  });

  it("đổi sang giữ-để-nói thì xoá ý định, không để mic tự mở dưới chế độ mới", async () => {
    const view = await mount();
    await view.join();
    await view.run(() => view.api.current?.setMicMode("toggle"));
    await view.run(() => roomHandlers?.onPermission(true));
    await view.run(() => view.api.current?.toggleMic());

    await view.run(() => view.api.current?.setMicMode("ptt"));

    assert.equal(view.api.current?.micIntent, false);
    assert.equal(view.api.current?.micOpen, false);
    await view.cleanup();
  });
});

/**
 * Ca hỏng thật sự của bản trước, và là ca THƯỜNG GẶP NHẤT trên điện thoại.
 *
 * Thứ tự đời thực không phải "rớt rồi mới mở lại app" mà là ngược lại: người
 * dùng mở lại app TRƯỚC, bốn tín hiệu thức dậy bắn ra khi kết nối cũ trên giấy
 * tờ vẫn là `connected`, nên cổng từ chối cả bốn - đúng và cần thiết. LiveKit
 * lúc đó mới cố khôi phục, thất bại, rồi mới bắn `Disconnected`.
 *
 * Tới đó thì KHÔNG CÒN tín hiệu nào nữa. App đã "thức dậy" xong từ lâu, người
 * dùng đang nhìn vào màn hình, và voice nằm im ở `idle` chờ một cú bấm mà giao
 * diện thậm chí không nói là cần bấm.
 */
describe("LiveKit rớt SAU khi app đã thức dậy", () => {
  it("A: mất kết nối hẳn là một tín hiệu nối lại, tự nó", async () => {
    const view = await mount();
    await view.join();

    // Bốn tín hiệu tới lúc còn `connected`: đúng ra phải bị từ chối.
    await view.wakeAll();
    const afterWake = view.tokenRequests();
    assert.equal(afterWake, 1, "chỉ có lần xin token lúc bấm Vào kênh thoại");

    // Giờ LiveKit mới chịu thua.
    await view.drop(DisconnectReason.SIGNAL_CLOSE);

    assert.equal(view.tokenRequests() - afterWake, 1, "phải tự xin đúng một token mới");
    await view.cleanup();
  });

  it("B: rớt lúc trang đang ẩn thì chờ, hiện lại mới xin - đúng một lần", async () => {
    const view = await mount();
    await view.join();
    const afterJoin = view.tokenRequests();

    const restore = force(document, "hidden", true);
    try {
      await view.drop(DisconnectReason.SIGNAL_CLOSE);
      assert.equal(view.tokenRequests(), afterJoin, "app còn nằm nền: nối lại chỉ tổ hỏng");
    } finally {
      restore();
    }

    await view.run(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(view.tokenRequests() - afterJoin, 1);
    await view.cleanup();
  });

  it("C: rớt lúc mất mạng thì chờ sự kiện online - đúng một lần", async () => {
    const view = await mount();
    await view.join();
    const afterJoin = view.tokenRequests();

    const restore = force(navigator, "onLine", false);
    try {
      await view.drop(DisconnectReason.SIGNAL_CLOSE);
      assert.equal(view.tokenRequests(), afterJoin);
    } finally {
      restore();
    }

    await view.run(() => {
      window.dispatchEvent(new Event("online"));
    });
    assert.equal(view.tokenRequests() - afterJoin, 1);
    await view.cleanup();
  });

  it("D: rớt rồi bốn tín hiệu dồn tới ngay sau: vẫn đúng một token", async () => {
    const view = await mount();
    await view.join();
    const afterJoin = view.tokenRequests();

    await view.drop(DisconnectReason.SIGNAL_CLOSE);
    await view.wakeAll();
    await view.wakeAll();

    assert.equal(view.tokenRequests() - afterJoin, 1);
    await view.cleanup();
  });

  it("E: rớt vì trùng danh tính thì không, dù mọi điều kiện khác đều thuận", async () => {
    const view = await mount();
    await view.join();
    const afterJoin = view.tokenRequests();

    await view.drop(DisconnectReason.DUPLICATE_IDENTITY);
    await view.wakeAll();

    assert.equal(view.tokenRequests(), afterJoin);
    await view.cleanup();
  });

  it("F: chưa từng bấm tham gia thì một lần rớt cũng không kéo họ vào", async () => {
    const view = await mount();
    await view.drop(DisconnectReason.SIGNAL_CLOSE);
    assert.equal(view.tokenRequests(), 0);
    await view.cleanup();
  });
});

/**
 * Mở mic hỏng không được biến thành một vòng lặp.
 *
 * `micIntent` sinh ra để sống sót qua mọi thứ - đêm, rớt mạng, đổi tab. Đúng
 * tính chất ấy làm nó thành nhiên liệu hoàn hảo cho một vòng retry: `setMic`
 * hỏng, `micOpen` vẫn false, ý định vẫn true, nên vòng đối chiếu kế tiếp lại
 * gọi `setMic`, lại hỏng, lại dispatch, lại đối chiếu. Trên máy thật đó là
 * `getUserMedia` bị gọi liên tục - hộp xin quyền nhấp nháy và console ngập lỗi.
 */
describe("mở mic hỏng: một lần là một lần", () => {
  it("A: setMic(true) hỏng thì chỉ thử ĐÚNG một lần, dù quay bao nhiêu vòng", async () => {
    const view = await mount();
    await view.join();
    await view.run(() => view.api.current?.setMicMode("toggle"));
    await view.run(() => roomHandlers?.onPermission(true));

    micRejects = (on) => on;
    await view.run(() => view.api.current?.toggleMic());
    await view.churn();

    assert.equal(view.micOpenAttempts(), 1, "vòng retry lộ ra ở đúng con số này");
    assert.equal(view.api.current?.micOpen, false, "không được giả vờ mic đã mở");
    assert.ok(view.api.current?.micError, "và phải nói ra là hỏng");
    await view.cleanup();
  });

  it("B: người dùng bấm lại thì thử thêm ĐÚNG một lần, và lần này chạy được", async () => {
    const view = await mount();
    await view.join();
    await view.run(() => view.api.current?.setMicMode("toggle"));
    await view.run(() => roomHandlers?.onPermission(true));

    micRejects = (on) => on;
    await view.run(() => view.api.current?.toggleMic());
    await view.churn();
    assert.equal(view.micOpenAttempts(), 1);

    micRejects = null;
    await view.run(() => view.api.current?.toggleMic());
    await view.churn();

    assert.equal(view.micOpenAttempts(), 2, "đúng một lần thử mới, không phải một vòng");
    assert.equal(view.api.current?.micOpen, true);
    assert.equal(view.api.current?.micError, null, "chạy được rồi thì xoá lỗi");
    await view.cleanup();
  });

  it("C: hỏng ở giữ-để-nói thì không tự thử lại sau khi đã nhả tay", async () => {
    const view = await mount();
    await view.join();
    await view.run(() => roomHandlers?.onPermission(true));

    micRejects = (on) => on;
    await view.run(() => view.api.current?.holdStart());
    await view.churn();
    await view.run(() => view.api.current?.holdEnd());
    await view.churn();

    assert.equal(view.micOpenAttempts(), 1);
    assert.equal(view.api.current?.micOpen, false);
    await view.cleanup();
  });

  it("D: hỏng rồi qua đêm rồi lại sang ngày cũng không sinh vòng retry", async () => {
    const view = await mount();
    await view.join();
    await view.run(() => view.api.current?.setMicMode("toggle"));
    await view.run(() => roomHandlers?.onPermission(true));

    micRejects = (on) => on;
    await view.run(() => view.api.current?.toggleMic());
    await view.churn();

    // Đêm xuống rồi sáng ra: quyền publish đi một vòng.
    await view.run(() => roomHandlers?.onPermission(false));
    await view.churn();
    await view.run(() => roomHandlers?.onPermission(true));
    await view.churn();

    assert.equal(view.micOpenAttempts(), 1, "một lỗi mic không được biến pha thành nút retry");
    await view.cleanup();
  });
});

/**
 * Đóng mic hỏng là ca NGUY HIỂM, khác hẳn mở hỏng.
 *
 * Mở hỏng thì hậu quả là im lặng - khó chịu, không hại ai. Đóng hỏng thì mic có
 * thể VẪN ĐANG PHÁT trong khi giao diện tưởng đã tắt, và đó đúng là thứ cả tính
 * năng này sinh ra để tránh trong một game mà nói hớ một câu là mất ván.
 */
describe("đóng mic hỏng: không được nói dối, và phải im bằng mọi giá", () => {
  it("E: không tắt được mic mà vẫn còn quyền phát thì rời hẳn phòng", async () => {
    const view = await mount();
    await view.join();
    await view.run(() => view.api.current?.setMicMode("toggle"));
    await view.run(() => roomHandlers?.onPermission(true));

    await view.run(() => view.api.current?.toggleMic());
    await view.churn();
    assert.equal(view.api.current?.micOpen, true, "mic đã mở thật");

    const before = view.disconnects();
    micRejects = (on) => !on;
    await view.run(() => view.api.current?.toggleMic());
    await view.churn();

    assert.equal(view.micCloseAttempts(), 1, "không quay vòng gọi lại setMic");
    assert.equal(
      view.disconnects() - before,
      1,
      "rời phòng là đường DUY NHẤT chắc chắn không còn phát gì",
    );
    await view.cleanup();
  });
});

/**
 * Ngắt CÓ CHỦ ĐÍCH khác hẳn rớt mạng, và bản trước không phân biệt được.
 *
 * `voice-room.ts` chỉ truyền một boolean "có phải duplicate không", nên
 * `PARTICIPANT_REMOVED` (rời phòng, bị đuổi) và `ROOM_DELETED` (host tắt voice,
 * phòng biến mất) rơi vào chung một rổ với tín hiệu đứt. Kết quả: server vừa
 * tống một người ra khỏi kênh thoại thì client lập tức xin token vào lại - và
 * lặp lại ở mỗi lần đổi tab, mỗi lần mạng chớp.
 *
 * Bộ test này đẩy lý do THẬT của SDK qua lớp phân loại THẬT vào hook. Dùng một
 * boolean tự chế chính là thứ đã giấu lỗi đi.
 */
describe("ngắt có chủ đích thì KHÔNG tự vào lại", () => {
  for (const [label, reason] of [
    ["bị gỡ khỏi room (rời phòng / bị đuổi)", DisconnectReason.PARTICIPANT_REMOVED],
    ["room bị xoá (host tắt voice / phòng biến mất)", DisconnectReason.ROOM_DELETED],
  ] as const) {
    it(`${label}: không xin token nào`, async () => {
      const view = await mount();
      await view.join();
      const afterJoin = view.tokenRequests();

      await view.drop(reason);

      assert.equal(view.tokenRequests(), afterJoin, "server vừa tống ra, vào lại là đi ngược lại");
      assert.notEqual(
        view.api.current?.ui.mode,
        "duplicate",
        "im lặng vì ĐÚNG lý do: người này bị gỡ khỏi kênh, không phải mở tab thứ hai",
      );
      await view.cleanup();
    });

    it(`${label}: bốn tín hiệu thức dậy sau đó cũng không xin`, async () => {
      /*
       * Đây mới là phần đắt. Xin token ngay lúc bị ngắt thì còn thấy được; xin
       * ở lần đổi tab thứ ba, mười phút sau, thì không ai lần ra.
       */
      const view = await mount();
      await view.join();
      const afterJoin = view.tokenRequests();

      await view.drop(reason);
      await view.wakeAll();
      await view.wakeAll();

      assert.equal(view.tokenRequests(), afterJoin);
      await view.cleanup();
    });

    it(`${label}: xoá ý định mic, không để nó tự bật ở phiên sau`, async () => {
      const view = await mount();
      await view.join();
      await view.run(() => view.api.current?.setMicMode("toggle"));
      await view.run(() => roomHandlers?.onPermission(true));
      await view.run(() => view.api.current?.toggleMic());
      await view.churn();
      assert.equal(view.api.current?.micIntent, true, "đang bật trước khi bị ngắt");

      await view.drop(reason);

      assert.equal(view.api.current?.micIntent, false);
      assert.equal(view.api.current?.micOpen, false);
      await view.cleanup();
    });

    it(`${label}: người dùng vẫn tự bấm vào lại được`, async () => {
      /*
       * Không tự vào lại KHÔNG có nghĩa là chặn cửa. Host bật voice trở lại,
       * hoặc người chơi được mời vào lại - một cú bấm phải đủ.
       */
      const view = await mount();
      await view.join();
      const afterJoin = view.tokenRequests();

      await view.drop(reason);
      await view.run(() => view.api.current?.activate());

      assert.equal(view.tokenRequests() - afterJoin, 1);
      await view.cleanup();
    });
  }

  it("trùng danh tính: vẫn giữ nguyên hành vi cũ - chờ người dùng chọn tab", async () => {
    const view = await mount();
    await view.join();
    await view.run(() => view.api.current?.setMicMode("toggle"));
    await view.run(() => roomHandlers?.onPermission(true));
    await view.run(() => view.api.current?.toggleMic());
    await view.churn();
    const afterJoin = view.tokenRequests();

    await view.drop(DisconnectReason.DUPLICATE_IDENTITY);
    await view.wakeAll();

    assert.equal(view.tokenRequests(), afterJoin);
    assert.equal(view.api.current?.micIntent, false);
    assert.equal(view.api.current?.ui.mode, "duplicate", "phải nói đúng lý do, không phải mạng hỏng");
    await view.cleanup();
  });
});

describe("rớt mạng thì ngược lại: vào lại, và giữ nguyên ý định mic", () => {
  it("tín hiệu đứt: đúng một token, và mic bật lại được sau khi có quyền", async () => {
    const view = await mount();
    await view.join();
    await view.run(() => view.api.current?.setMicMode("toggle"));
    await view.run(() => roomHandlers?.onPermission(true));
    await view.run(() => view.api.current?.toggleMic());
    await view.churn();
    const afterJoin = view.tokenRequests();

    await view.drop(DisconnectReason.SIGNAL_CLOSE);

    assert.equal(view.tokenRequests() - afterJoin, 1);
    assert.equal(view.api.current?.micIntent, true, "rớt mạng không phải là người dùng đổi ý");

    // Phiên mới: vào lại rồi server cấp quyền theo pha hiện tại.
    await view.run(() => roomHandlers?.onConnected());
    await view.run(() => roomHandlers?.onPermission(true));
    await view.churn();

    assert.equal(view.api.current?.micOpen, true, "mic tự mở lại, không bắt bấm nữa");
    await view.cleanup();
  });

  it("server khởi động lại cũng là rớt phục hồi được", async () => {
    const view = await mount();
    await view.join();
    const afterJoin = view.tokenRequests();

    await view.drop(DisconnectReason.SERVER_SHUTDOWN);

    assert.equal(view.tokenRequests() - afterJoin, 1);
    await view.cleanup();
  });
});

describe("một hook, một Room", () => {
  it("cả vòng đời rớt-rồi-vào-lại vẫn chỉ dựng đúng một Room", async () => {
    /*
     * `createVoiceRoom` được gọi một lần duy nhất ở lần render đầu; việc vào
     * lại đi qua `connect()` của chính handle đó. Dựng thêm Room thứ hai nghĩa
     * là hai kết nối cùng danh tính, mà trùng danh tính thì LiveKit đá cái cũ.
     */
    const view = await mount();
    await view.join();
    await view.drop(DisconnectReason.SIGNAL_CLOSE);
    await view.run(() => roomHandlers?.onConnected());
    await view.wakeAll();

    assert.equal(view.roomsCreated(), 1);
    await view.cleanup();
  });
});

/**
 * iOS tạm dừng mọi thẻ <audio> của người khác khi app xuống nền, và LiveKit chỉ
 * phát lại chúng qua `Room.startAudio()`. Bản trước gọi `startAudio` đúng một
 * lần - ở cú bấm "Vào kênh thoại" - tức là TRƯỚC khi token về và Room tồn tại,
 * nên lời gọi ấy rơi vào khoảng không. Không lần nào sau đó gọi lại: quay lại
 * app là điếc, mà dock vẫn ghi "Đã kết nối" vì chẳng có `play()` nào hỏng để
 * LiveKit báo bị chặn.
 */
describe("phát lại tiếng người khác trên iOS", () => {
  it("vào phòng xong mới gọi startAudio - lúc bấm nút thì Room chưa tồn tại", async () => {
    const view = await mount();
    await view.run(() => view.api.current?.activate());
    await view.token();
    await view.churn();

    const calls = view.calls();
    const connectAt = calls.lastIndexOf("connect");
    const startAt = calls.lastIndexOf("startAudio");
    assert.ok(connectAt >= 0, "phải có một lần connect");
    assert.ok(startAt > connectAt, "startAudio phải đi SAU connect, khi Room đã có");
    await view.cleanup();
  });

  it("LiveKit tự vá xong đường truyền: gọi lại startAudio", async () => {
    const view = await mount();
    await view.join();
    const before = view.startAudioCalls();

    await view.run(() => roomHandlers?.onReconnected());
    await view.churn();

    assert.equal(view.startAudioCalls(), before + 1);
    await view.cleanup();
  });

  it("đang kết nối mà app hiện lại: gọi startAudio, không xin token", async () => {
    const view = await mount();
    await view.join();
    const startBefore = view.startAudioCalls();
    const tokensBefore = view.tokenRequests();

    await view.wakeAll();
    await view.churn();

    assert.ok(view.startAudioCalls() > startBefore, "phải thử phát lại tiếng");
    assert.equal(view.tokenRequests(), tokensBefore, "cùng phiên: không xin token");
    await view.cleanup();
  });

  it("chưa vào voice thì app hiện lại không gọi startAudio", async () => {
    const view = await mount();
    const before = view.startAudioCalls();

    await view.wakeAll();
    await view.churn();

    assert.equal(view.startAudioCalls(), before);
    await view.cleanup();
  });
});
