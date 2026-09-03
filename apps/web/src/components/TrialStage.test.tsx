import assert from "node:assert/strict";
import { after, before, describe, it, mock } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Bộ test MOUNT CÂY COMPONENT THẬT.
 *
 * Lý do nó phải tồn tại, dù cả repo còn lại chạy trên hàm thuần: lỗi mất màn mở
 * đầu KHÔNG nằm trong một hàm nào cả. Nó nằm ở thứ tự ba thứ xảy ra trong cùng
 * một lần commit của React:
 *
 *   1. `TrialStage` mount với `webgl2` còn là giá trị khởi tạo - chưa ai hỏi
 *      máy có dựng được 3D không.
 *   2. Effect dò khả năng chạy, đặt `webgl2 = true`.
 *   3. Effect tiêu thụ lô chạy CÙNG lượt đó, và ở lượt đó `mode` vẫn đang là
 *      "fallback" - nên nó đánh dấu lô OPENING là "đã có người nhận" trong khi
 *      canvas chưa hề tồn tại.
 *
 * Ở lượt commit sau, canvas mới mount - và `beats` đã rỗng. `playOpening` không
 * bao giờ được gọi. Một harness hàm thuần trên `advanceLiveTrial` không thấy gì
 * cả: hàm ấy trả về lô OPENING hoàn toàn đúng.
 *
 * Vì vậy ở đây cây component là THẬT (`useLiveTrial` → `TrialStage` →
 * `TrialStageCanvas` → `createStageDirector` → vòng vẽ), thứ tự effect là thật,
 * và chỉ hai thứ được thay: `three` (không có GPU trong `node:test`) và bản
 * dựng cảnh (thay bằng một handle ghi lại lời gọi). Đó đúng là "mock WebGL,
 * instrument scene methods" - phần còn lại chạy như trong trình duyệt.
 */

GlobalRegistrator.register();
// React 19 đòi cờ này thì `act()` mới bao được effect; thiếu nó React chỉ cảnh
// báo rồi bỏ qua, và test sẽ đọc trạng thái ở giữa chừng.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === "undefined") {
  // happy-dom không có ResizeObserver; canvas chỉ cần nó tồn tại và im lặng.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// ---------------------------------------------------------------------------
// Bản ghi lời gọi lên cảnh 3D.
// ---------------------------------------------------------------------------

interface SceneCall {
  name: "setState" | "playOpening" | "playStamp" | "playVerdict";
  act?: string;
}

const sceneCalls: SceneCall[] = [];
/** Số lần `buildTrialScene` chạy - dùng để canh "không dựng lại renderer". */
let scenesBuilt = 0;
/** Máy giả lập có dựng được 3D không. Test lật cờ này để đi đường 2D. */
let webglSupported = true;

function resetScene(): void {
  sceneCalls.length = 0;
  scenesBuilt = 0;
  webglSupported = true;
}

const opened = () => sceneCalls.filter((c) => c.name === "playOpening").length;

/*
 * `mock.module` với `options.exports`.
 *
 * Repo ghim `@types/node@^20`, còn runtime là Node 24: kiểu ở đó chỉ biết
 * `namedExports` (đã bị chính Node đánh dấu deprecated và in cảnh báo mỗi lần
 * gọi). Dùng đúng API hiện tại rồi khai kiểu tại chỗ, thay vì dùng API cũ chỉ
 * để chiều một gói kiểu đã lạc hậu.
 */
type MockModuleOptions = { exports?: Record<string, unknown> };
const mockModule = (specifier: string, options: MockModuleOptions): Promise<unknown> =>
  (mock as unknown as {
    module: (s: string, o: MockModuleOptions) => Promise<unknown>;
  }).module(specifier, options);

// ---------------------------------------------------------------------------

before(async () => {
  /*
   * `three` giả: `node:test` không có GPU, và một `WebGLRenderer` thật sẽ ném
   * ngay ở hàm dựng. Bản giả chỉ cần đủ hình dạng cho `TrialStageCanvas`.
   */
  await mockModule("three", {
    exports: {
      WebGLRenderer: class {
        domElement = document.createElement("canvas");
        setPixelRatio() {}
        setSize() {}
        render() {}
        dispose() {}
        forceContextLoss() {}
      },
      Scene: class {
        add() {}
        clear() {}
        traverse() {}
      },
      PerspectiveCamera: class {
        aspect = 1;
        position = { copy() {} };
        updateProjectionMatrix() {}
        lookAt() {}
      },
    },
  });

  /*
   * Bản dựng cảnh giả: giữ nguyên hợp đồng `TrialSceneHandle`, chỉ ghi lại ai
   * gọi gì. Đây là chỗ duy nhất test nhìn thấy `playOpening`.
   */
  await mockModule("../lib/live-trial-scene.ts", {
    exports: {
      buildTrialScene: () => {
        scenesBuilt += 1;
        return {
          setState: (state: { act: string }) => sceneCalls.push({ name: "setState", act: state.act }),
          playOpening: () => sceneCalls.push({ name: "playOpening" }),
          playStamp: () => sceneCalls.push({ name: "playStamp" }),
          playVerdict: () => sceneCalls.push({ name: "playVerdict" }),
          update: () => {},
          dispose: () => {},
        };
      },
    },
  });

  // Máy "có" WebGL2: `hasWebgl2` dựng một context thật, thứ happy-dom không có.
  // Đọc qua `webglSupported` vì namespace của một ES module là bất biến - test
  // không gán đè được, nên nó lật cái biến này.
  await mockModule("../lib/cinematic-webgl.ts", {
    exports: {
      hasWebgl2: () => webglSupported,
      renderScale: (dpr: number) => Math.min(dpr || 1, 1.5),
      MAX_RENDER_SCALE: 1.5,
      canUseWebgl: () => true,
      WEBGL_KINDS: new Set<string>(),
      hasWebglScene: () => false,
    },
  });
});

// ---------------------------------------------------------------------------
// Dàn dựng
// ---------------------------------------------------------------------------

type Snapshot = import("@masoi/shared").RoomSnapshot;
type TrialView = import("@masoi/shared").TrialView;

const players = [
  { id: "me", name: "Tôi", alive: true, isBot: false },
  { id: "acc", name: "Bị Cáo", alive: true, isBot: false },
];

function snapshot(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    phase: "DAY_DISCUSSION",
    round: 1,
    players,
    dayVoteHistory: [{ round: 1 }],
    trial: null,
    lastTrial: null,
    you: { id: "me", name: "Tôi", alive: true },
    ...patch,
  } as unknown as Snapshot;
}

function trial(patch: Partial<TrialView> = {}): TrialView {
  return {
    accusedId: "acc",
    accusedName: "Bị Cáo",
    guiltyVotes: 0,
    innocentVotes: 0,
    guiltyRequired: 2,
    canVote: false,
    hasVoted: false,
    myVote: null,
    canSpeak: false,
    ...patch,
  };
}

const defense = (patch: Partial<TrialView> = {}) =>
  snapshot({ phase: "DEFENSE", trial: trial(patch) });
const finalVote = (patch: Partial<TrialView> = {}) =>
  snapshot({ phase: "FINAL_VOTE", trial: trial(patch) });

/**
 * Đúng cách phòng chơi nối hook vào sân khấu - xem `app/room/[code]/page.tsx`.
 * Không rút gọn: thứ tự effect giữa hook, `TrialStage` và `TrialStageCanvas`
 * chính là thứ đang được kiểm.
 */
async function mountRoom(options: { strict?: boolean } = {}) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useLiveTrial } = await import("@/lib/useLiveTrial");
  const { TrialStage } = await import("./TrialStage");

  function Room({ snap, connected }: { snap: Snapshot | null; connected: boolean }) {
    const live = useLiveTrial(snap, connected);
    if (!snap || !live.enabled || !live.view) return null;
    return React.createElement(TrialStage, {
      view: live.view,
      beats: live.beats,
      beatsId: live.beatsId,
      onBeatsConsumed: live.consumeBeats,
      snapshot: snap,
    });
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  const render = async (snap: Snapshot | null, connected = true) => {
    const tree = React.createElement(Room, { snap, connected });
    await act(async () => {
      root.render(options.strict ? React.createElement(React.StrictMode, null, tree) : tree);
    });
    // Cho `import()` động trong canvas kịp giải quyết rồi để React xả effect.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  };

  return {
    render,
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function enable(on: boolean): void {
  localStorage.setItem("masoi.live-trial", JSON.stringify({ enabled: on }));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("masoi:live-trial-settings"));
  }
}

before(() => {
  localStorage.clear();
  localStorage.setItem("masoi.cinematic", JSON.stringify({ reduced: false }));
});

after(() => {
  GlobalRegistrator.unregister();
});

// ---------------------------------------------------------------------------

describe("mở phiên toà: OPENING phải tới được cảnh 3D", () => {
  it("bật sẵn, thảo luận → DEFENSE: playOpening chạy ĐÚNG MỘT LẦN", async () => {
    resetScene();
    enable(true);
    const room = await mountRoom();

    // Một snapshot hợp lệ NGOÀI phiên toà - đây là thứ phân biệt "đã vào bàn"
    // với "chưa nhận snapshot nào".
    await room.render(snapshot({ phase: "DAY_DISCUSSION" }));
    assert.equal(opened(), 0);

    await room.render(defense());
    assert.equal(opened(), 1, "màn mở đầu phải tới được cảnh 3D");

    await room.unmount();
  });

  it("render lại và snapshot lặp không làm nó chạy lần hai", async () => {
    resetScene();
    enable(true);
    const room = await mountRoom();
    await room.render(snapshot({ phase: "VOTING" }));

    const opening = defense();
    await room.render(opening);
    assert.equal(opened(), 1);

    // Cùng một object snapshot, đẩy lại nhiều lần.
    await room.render(opening);
    await room.render(opening);
    // Và một snapshot MỚI nhưng cùng nội dung.
    await room.render(defense());

    assert.equal(opened(), 1, "một phiên toà chỉ có một màn mở đầu");
    await room.unmount();
  });

  it("KHÔNG dựng lại cảnh theo từng snapshot", async () => {
    resetScene();
    enable(true);
    const room = await mountRoom();
    await room.render(snapshot({ phase: "VOTING" }));
    await room.render(defense());
    const afterOpening = scenesBuilt;

    await room.render(defense({ guiltyVotes: 1 }));
    await room.render(defense({ guiltyVotes: 2 }));
    await room.render(finalVote({ guiltyVotes: 2 }));

    assert.equal(scenesBuilt, afterOpening, "một phiên toà chỉ dựng cảnh một lần");
    await room.unmount();
  });

  it("phiếu về sau vẫn có con dấu - lần sửa này không đổi đường của STAMP", async () => {
    resetScene();
    enable(true);
    const room = await mountRoom();
    await room.render(snapshot({ phase: "VOTING" }));
    await room.render(defense());
    await room.render(finalVote());
    await room.render(finalVote({ guiltyVotes: 1 }));

    assert.equal(sceneCalls.filter((c) => c.name === "playStamp").length, 1);
    await room.unmount();
  });
});

describe("những lúc KHÔNG được mở màn", () => {
  it("snapshot đầu tiên đã là DEFENSE (F5 giữa pha): không mở màn", async () => {
    resetScene();
    enable(true);
    const room = await mountRoom();
    await room.render(defense());
    assert.equal(opened(), 0, "phiên toà đã diễn từ trước khi người chơi tới");
    await room.unmount();
  });

  it("tắt rồi bật lại sau khi đã mở màn: không chạy lại", async () => {
    resetScene();
    enable(true);
    const room = await mountRoom();
    await room.render(snapshot({ phase: "VOTING" }));
    const opening = defense();
    await room.render(opening);
    assert.equal(opened(), 1);

    enable(false);
    await room.render(opening);
    enable(true);
    await room.render(opening);

    assert.equal(opened(), 1, "gạt một công tắc hiển thị không diễn lại chuyện cũ");
    await room.unmount();
  });

  it("bật tính năng GIỮA phiên toà: không phát bù màn mở đầu", async () => {
    resetScene();
    enable(false);
    const room = await mountRoom();
    await room.render(snapshot({ phase: "VOTING" }));
    await room.render(defense());
    assert.equal(opened(), 0, "đang tắt thì không có gì để diễn");

    enable(true);
    await room.render(defense());
    assert.equal(opened(), 0, "bật lên chỉ được thấy trạng thái hiện tại");
    await room.unmount();
  });
});

describe("bản dự phòng 2D", () => {
  it("máy không dựng được 3D: không có playOpening, và lô bị bỏ hẳn", async () => {
    resetScene();
    webglSupported = false;
    enable(true);

    const room = await mountRoom();
    await room.render(snapshot({ phase: "VOTING" }));
    await room.render(defense());

    assert.equal(opened(), 0);
    assert.equal(scenesBuilt, 0, "không dựng cảnh 3D nào");
    // Chữ vẫn phải đủ: đây là điều kiện để bản 2D còn dùng được.
    assert.match(room.host.textContent ?? "", /Bị Cáo/);
    await room.unmount();
  });

  it("từ 2D sang 3D không phát lại lô đã bỏ", async () => {
    resetScene();
    webglSupported = false;
    enable(true);

    const room = await mountRoom();
    await room.render(snapshot({ phase: "VOTING" }));
    const opening = defense();
    await room.render(opening);
    assert.equal(opened(), 0, "bản 2D bỏ lô theo chính sách");

    // Máy "có" 3D trở lại, và sân khấu được dựng lại từ đầu.
    webglSupported = true;
    await room.unmount();

    const again = await mountRoom();
    await again.render(opening);
    assert.equal(opened(), 0, "lô đã bỏ theo chính sách thì không sống lại");
    await again.unmount();
  });
});

describe("import chậm", () => {
  it("cảnh dựng xong SAU khi đã sang FINAL_VOTE: không chạy màn mở đầu cũ", async () => {
    resetScene();
    enable(true);

    const React = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useLiveTrial } = await import("@/lib/useLiveTrial");
    const { TrialStage } = await import("./TrialStage");

    function Room({ snap }: { snap: Snapshot | null }) {
      const live = useLiveTrial(snap, true);
      if (!snap || !live.enabled || !live.view) return null;
      return React.createElement(TrialStage, {
        view: live.view,
        beats: live.beats,
        beatsId: live.beatsId,
        onBeatsConsumed: live.consumeBeats,
        snapshot: snap,
      });
    }

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);

    /*
     * KHÔNG xả microtask giữa hai lần render.
     *
     * `import("three")` trong canvas chỉ giải quyết ở microtask; giữ nguyên
     * hàng đợi thì DEFENSE và FINAL_VOTE cùng tới trước khi cảnh kịp dựng -
     * đúng cảnh máy chậm mà bản cũ để màn mở đầu ghi đè camera của pha bỏ phiếu.
     */
    await act(async () => {
      root.render(React.createElement(Room, { snap: snapshot({ phase: "VOTING" }) }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    root.render(React.createElement(Room, { snap: defense() }));
    root.render(React.createElement(Room, { snap: finalVote() }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    assert.equal(opened(), 0, "màn mở đầu đã lỗi thời thì bỏ, không ghi đè pha mới");
    const lastState = [...sceneCalls].reverse().find((c) => c.name === "setState");
    assert.equal(lastState?.act, "FINAL_VOTE", "cảnh phải đứng ở chặng hiện tại");

    await act(async () => root.unmount());
    host.remove();
  });
});

describe("React Strict Mode", () => {
  it("effect chạy hai lượt vẫn chỉ một màn mở đầu", async () => {
    resetScene();
    enable(true);
    const room = await mountRoom({ strict: true });
    await room.render(snapshot({ phase: "VOTING" }));
    await room.render(defense());

    assert.equal(opened(), 1, "StrictMode không được nhân đôi, cũng không được nuốt mất");
    await room.unmount();
  });
});
