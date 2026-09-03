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
/** Số lần effect dò WebGL đã chạy. Là tín hiệu "đã có gì đó xảy ra" cho `drainTurns`. */
let webglCalls = 0;

function resetScene(): void {
  sceneCalls.length = 0;
  scenesBuilt = 0;
  webglCalls = 0;
  webglSupported = true;
}

/**
 * Trần số vòng xả. Chỉ để một lỗi treo hiện ra thành test đỏ thay vì treo mãi -
 * KHÔNG phải một mốc cần chỉnh cho khớp máy.
 */
const DRAIN_MAX_TURNS = 100;
/** Bao nhiêu vòng liền im lặng thì coi là đã xong. */
const DRAIN_IDLE_TURNS = 3;

/**
 * Xả hàng đợi cho tới khi mọi thứ THÔI ĐỔI, không phải cho tới một số vòng
 * định sẵn.
 *
 * `import("three")` và `import("@/lib/live-trial-scene")` trong canvas không
 * giải quyết trong microtask - chúng đi qua loader của Node, nên cần vòng
 * MACROTASK, và cần bao nhiêu vòng thì tuỳ phiên bản Node lẫn tốc độ máy. Bản
 * đầu xả đúng hai microtask, vừa đủ trên máy người viết và không bao giờ đủ
 * trên Node 22; thay nó bằng một số cứng lớn hơn cũng chỉ là dời chỗ đoán.
 *
 * Điều kiện dừng vì thế là quan sát, không phải đếm: chờ tới khi ĐÃ có hoạt
 * động rồi im được vài vòng liền. `seenActivity` là mấu chốt - thiếu nó thì
 * "chưa kịp bắt đầu" trông y hệt "đã xong", và vòng lặp thoát ngay ở vòng đầu.
 *
 * Còn `host` trả lời câu hỏi thứ hai: sân khấu đã mount chưa. Chưa mount thì
 * không có `import()` nào đang chờ và cũng sẽ không có - render đó chỉ dựng một
 * cây rỗng (`Room` trả null khi chưa có phiên toà) - nên thoát ngay thay vì
 * ngồi hết trần. Thiếu lối thoát này thì mỗi render như vậy tốn trọn 100 vòng,
 * và cả file chạy lâu gấp ba mà không kiểm thêm được gì.
 */
async function drainTurns(host: HTMLElement): Promise<void> {
  const mounted = () => host.querySelector('[aria-label="Sân khấu phiên toà"]') !== null;
  const signal = () => `${webglCalls}:${scenesBuilt}:${sceneCalls.length}`;
  let seenActivity = false;
  let idle = 0;

  for (let turn = 0; turn < DRAIN_MAX_TURNS; turn += 1) {
    const before = signal();
    await new Promise((resolve) => setTimeout(resolve, 0));

    if (signal() !== before) {
      seenActivity = true;
      idle = 0;
      continue;
    }
    idle += 1;
    if (seenActivity && idle >= DRAIN_IDLE_TURNS) return;
    if (!seenActivity && !mounted()) return;
  }
}

const opened = () => sceneCalls.filter((c) => c.name === "playOpening").length;

/*
 * `mock.module` đổi tên tuỳ chọn giữa các bản Node, nên ở đây gửi CẢ HAI.
 *
 * Node 20 và 22 đọc `namedExports`; Node 24 đổi sang `exports` và đánh dấu
 * `namedExports` là deprecated. Bản trước chỉ gửi `exports` - đúng trên máy
 * người viết (Node 24), nhưng trên Node 20/22 tuỳ chọn đó bị bỏ qua LẶNG LẼ và
 * mock cài vào một module rỗng. Triệu chứng hiện ra cách chỗ sai vài lớp:
 * `hasWebgl2 is not a function` ở giữa một effect của React. CI ghim 20.19.x
 * nên đây không phải chuyện lý thuyết.
 *
 * Nhưng KHÔNG được gửi cả hai cùng lúc: từ Node 24 hai khoá loại trừ nhau và
 * `normalizeModuleMockOptions` ném thẳng `ERR_INVALID_ARG_VALUE` - "The property
 * 'options.exports' cannot be used with 'options.namedExports'". Node 22 nhận cả
 * hai (đã đo trên 22.23.2), Node 24 thì không, nên "bản nào cũng bỏ qua khoá nó
 * không biết" chỉ đúng một chiều.
 *
 * Vậy: THỬ cả hai trước, và chỉ khi runtime từ chối mới gửi riêng `exports`.
 * Cách này không đọc `process.version` - nó hỏi chính runtime đang chạy, nên một
 * bản Node sau này gỡ hẳn `namedExports` cũng rơi đúng vào nhánh thứ hai. Lần
 * thử đầu KHÔNG cài được mock nào khi nó ném, nên không có nguy cơ mock đôi.
 */
type MockExports = Record<string, unknown>;
type MockModuleFn = (s: string, o: Record<string, unknown>) => Promise<unknown>;

/**
 * Đổi đường dẫn tương đối thành URL tuyệt đối TRƯỚC khi đưa cho `mock.module`.
 *
 * Node 22 phân giải specifier tương đối của `mock.module` theo điểm vào của tiến
 * trình chứ không theo file gọi, nên `"../lib/live-trial-scene.ts"` trỏ ra một
 * đường không tồn tại và mock được đăng ký ở một chỗ KHÔNG AI import. Không có
 * lỗi nào cả - module thật vẫn chạy, rồi vỡ ở tận trong nó ("THREE.Group is not
 * a constructor", vì `three` thì lại mock được do nó là specifier trần).
 *
 * `new URL(rel, import.meta.url)` bỏ hẳn câu hỏi "tương đối với cái gì".
 */
const fromHere = (relative: string): string => new URL(relative, import.meta.url).href;

const mockModule = async (specifier: string, options: { exports: MockExports }): Promise<unknown> => {
  // Gọi qua chính đối tượng `mock`: `MockTracker#module` đọc một private field
  // (`#mocks`), nên tách hàm ra biến rồi gọi trần là mất `this` và ném ngay.
  const tracker = mock as unknown as { module: MockModuleFn };
  try {
    return await tracker.module(specifier, {
      exports: options.exports,
      namedExports: options.exports,
    });
  } catch {
    // Bắt mọi lỗi chứ không riêng ERR_INVALID_ARG_VALUE: nếu lần hai cũng hỏng
    // thì lỗi THẬT nổi lên từ đó, còn nếu chỉ là chuyện tên tuỳ chọn thì lần hai
    // chạy được. Không nuốt lỗi nào cả.
    return tracker.module(specifier, { exports: options.exports });
  }
};

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
  await mockModule(fromHere("../lib/live-trial-scene.ts"), {
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
  await mockModule(fromHere("../lib/cinematic-webgl.ts"), {
    exports: {
      hasWebgl2: () => {
        webglCalls += 1;
        return webglSupported;
      },
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
    if (!snap || !live.view) return null;
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
      await drainTurns(host);
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
    const room = await mountRoom();
    await room.render(defense());
    assert.equal(opened(), 0, "phiên toà đã diễn từ trước khi người chơi tới");
    await room.unmount();
  });

});

describe("bản dự phòng 2D", () => {
  it("máy không dựng được 3D: không có playOpening, và lô bị bỏ hẳn", async () => {
    resetScene();
    webglSupported = false;

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

    const React = await import("react");
    const { act } = await import("react");
    const { createRoot } = await import("react-dom/client");
    const { useLiveTrial } = await import("@/lib/useLiveTrial");
    const { TrialStage } = await import("./TrialStage");

    function Room({ snap }: { snap: Snapshot | null }) {
      const live = useLiveTrial(snap, true);
      if (!snap || !live.view) return null;
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
     * Cuộc đua ở đây được DÀN, không phải được đua.
     *
     * Điều kiện cần tái hiện là: lô OPENING của DEFENSE tới tay canvas trong
     * lúc cảnh 3D CHƯA dựng xong, rồi cảnh mới dựng xong khi pha đã sang
     * FINAL_VOTE. Bản cũ tạo điều kiện đó bằng cách gọi `root.render` ngoài
     * `act()` và trông chờ `import("three")` chưa kịp giải quyết. Cả hai vế đều
     * không có gì bảo đảm: React 19 cảnh báo đúng về update ngoài `act` và
     * không hứa hẹn thứ tự, còn "chưa kịp" thì tuỳ phiên bản Node.
     *
     * Bản này dựa vào một bảo đảm của chính ngôn ngữ thay vì vào tốc độ máy:
     * `act()` ĐỒNG BỘ không thể chờ một promise, còn `import()` thì không bao
     * giờ giải quyết đồng bộ. Nên sau ba lần render dưới đây, cảnh CHẮC CHẮN
     * chưa dựng - ở mọi phiên bản Node, dù loader nhanh đến đâu.
     *
     * Phải là `act` đồng bộ chứ không phải `await act(async …)`: bản async nhả
     * microtask, và khi `three` lẫn module dựng cảnh đều đã bị mock (và đã nằm
     * trong cache của loader sau những test trước trong file này), `import()`
     * giải quyết ngay trong microtask. Lúc đó cảnh dựng xong NGAY Ở PHA DEFENSE,
     * cuộc đua không còn, và test hoá ra chỉ đang khẳng định một thứ khác.
     *
     * `act` đồng bộ vẫn xả effect và vẫn gộp lô, nên canvas vẫn mount đủ hai
     * lượt commit (lượt sau khi effect dò WebGL bật `webgl2`) và vẫn kịp gửi lô
     * OPENING cho người điều phối - chỉ có `import()` là chắc chắn còn dang dở.
     */
    act(() => {
      root.render(React.createElement(Room, { snap: snapshot({ phase: "VOTING" }) }));
    });
    act(() => {
      root.render(React.createElement(Room, { snap: defense() }));
    });

    // Tiền đề của cả bài. Nếu một ngày nó sai, test này phải đỏ NGAY Ở ĐÂY với
    // lý do đúng, chứ không đỏ ở khẳng định cuối với lý do gây hiểu nhầm.
    assert.equal(scenesBuilt, 0, "tiền đề: cảnh chưa dựng xong khi pha còn là DEFENSE");
    assert.equal(opened(), 0, "tiền đề: chưa có màn mở đầu nào chạy");

    act(() => {
      root.render(React.createElement(Room, { snap: finalVote() }));
    });

    /*
     * Hai lượt xả, không phải một.
     *
     * Lượt đầu để effect dò WebGL chạy và canvas mount - canvas chỉ xuất hiện ở
     * lượt commit SAU khi `webgl2` bật. Lượt sau mới là lúc `import()` của
     * canvas có vòng macrotask để giải quyết và cảnh dựng xong. Gộp làm một thì
     * canvas mount đúng vào cuối lượt xả và không còn vòng nào cho `import()` -
     * đó chính là trạng thái mà bản trước mắc kẹt: cảnh không bao giờ dựng, và
     * khẳng định cuối đọc phải `undefined`.
     */
    await act(async () => {
      await drainTurns(host);
    });
    await act(async () => {
      await drainTurns(host);
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
    const room = await mountRoom({ strict: true });
    await room.render(snapshot({ phase: "VOTING" }));
    await room.render(defense());

    assert.equal(opened(), 1, "StrictMode không được nhân đôi, cũng không được nuốt mất");
    await room.unmount();
  });
});
