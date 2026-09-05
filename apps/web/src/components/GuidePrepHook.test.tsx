import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, type RoomConfig, type RoomSnapshot } from "@masoi/shared";
import { GUIDE_DECK, GUIDE_PREP_RETRY_MS, hasGuideDeck, type GuidePrepStage } from "@/lib/guide-prep";
import { GUIDE_PREP_KEY_PREFIX } from "@/lib/guide-steps";

/**
 * `useGuidePrep` MOUNT THẬT, trong `<StrictMode>`.
 *
 * Luật thuần đã có test ở `lib/guide-prep.test.ts`; server thật ở
 * `apps/server/tests/guide-prep-integration.test.ts`. Ở đây chỉ giữ những gì
 * chỉ thấy được khi hook chạy trong React thật:
 *
 *   - StrictMode chạy effect hai lần ở mỗi lần mount: vẫn đúng MỘT lần gửi;
 *   - cùng một snapshot render lại nhiều lần: không gửi thêm;
 *   - snapshot mới xác nhận bước trước thì gửi bước sau, đúng một lần;
 *   - `done` được ghi vào sessionStorage theo mã phòng, và mount lại với cờ
 *     đó thì không gửi gì nữa dù bàn đã bị host chỉnh;
 *   - `requested=false` (phòng thường) không gửi gì cả.
 */
GlobalRegistrator.register({ url: "http://localhost:3000/room/GUIDE" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function snapshot(config: RoomConfig, count: number, phase: RoomSnapshot["phase"] = "LOBBY"): RoomSnapshot {
  return {
    code: "GUIDE",
    hostId: "me",
    phase,
    config,
    round: 0,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: "me", name: "Minh", ready: true, connected: true, alive: true },
    players: Array.from({ length: count }, (_, i) => ({ id: i === 0 ? "me" : `bot-${i}`, name: `P${i}`, alive: true })) as RoomSnapshot["players"],
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
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
  };
}

interface Harness {
  emitted: Array<{ event: string; payload: unknown }>;
  stage: () => GuidePrepStage | null;
  push: (snapshot: RoomSnapshot | null, over?: { connected?: boolean; isHost?: boolean }) => Promise<void>;
  rerender: () => Promise<void>;
  cleanup: () => Promise<void>;
}

async function mount(requested: boolean, first: RoomSnapshot | null): Promise<Harness> {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { useGuidePrep } = await import("@/lib/useGuidePrep");

  const emitted: Harness["emitted"] = [];
  let latestStage: GuidePrepStage | null = null;
  let setInput: ((next: { snapshot: RoomSnapshot | null; connected: boolean; isHost: boolean; tick: number }) => void) | null = null;
  let current = { snapshot: first, connected: true, isHost: true, tick: 0 };

  function Probe() {
    const [input, set] = React.useState(current);
    setInput = set;
    const stage = useGuidePrep({
      code: "GUIDE",
      requested,
      snapshot: input.snapshot,
      isHost: input.isHost,
      connected: input.connected,
      emit: (event, payload) => emitted.push({ event, payload }),
    });
    latestStage = stage;
    return React.createElement("span", { "data-stage": stage ?? "" });
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(React.StrictMode, null, React.createElement(Probe)));
  });

  return {
    emitted,
    stage: () => latestStage,
    push: async (snap, over = {}) => {
      current = { snapshot: snap, connected: over.connected ?? true, isHost: over.isHost ?? true, tick: current.tick + 1 };
      await act(async () => setInput!(current));
    },
    rerender: async () => {
      // Cùng snapshot, chỉ đổi một trường không liên quan để React render lại.
      current = { ...current, tick: current.tick + 1 };
      await act(async () => setInput!(current));
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const PREP_KEY = `${GUIDE_PREP_KEY_PREFIX}GUIDE`;

describe("useGuidePrep trong StrictMode", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it("mount hai lần (StrictMode) và render lại nhiều lần: đúng MỘT update-config", async () => {
    const h = await mount(true, snapshot(DEFAULT_ROOM_CONFIG, 1));
    try {
      await h.rerender();
      await h.rerender();
      await h.rerender();
      assert.equal(h.emitted.length, 1);
      assert.equal(h.emitted[0]!.event, "room:update-config");
      assert.ok(hasGuideDeck((h.emitted[0]!.payload as { config: RoomConfig }).config));
      assert.equal(h.stage(), "config");
    } finally {
      await h.cleanup();
    }
  });

  it("snapshot xác nhận từng bước: config -> 7 bot -> done, mỗi bước một sự kiện, rồi ghi cờ đã chuẩn bị", async () => {
    const h = await mount(true, snapshot(DEFAULT_ROOM_CONFIG, 1));
    try {
      // Server phát lại đúng snapshot cũ một lần (reconnect) - không gửi thêm.
      await h.push(snapshot(DEFAULT_ROOM_CONFIG, 1));
      assert.equal(h.emitted.length, 1);
      // Server xác nhận bộ bài.
      await h.push(snapshot(GUIDE_DECK, 1));
      assert.equal(h.emitted.length, 2);
      assert.equal(h.emitted[1]!.event, "room:add-bot");
      assert.equal(h.stage(), "bots");
      for (let count = 2; count <= 7; count += 1) {
        await h.push(snapshot(GUIDE_DECK, count));
        await h.rerender();
      }
      assert.equal(h.emitted.filter((e) => e.event === "room:add-bot").length, 7);
      await h.push(snapshot(GUIDE_DECK, 8));
      assert.equal(h.emitted.length, 8);
      assert.equal(h.stage(), "done");
      assert.equal(window.sessionStorage.getItem(PREP_KEY), "1");
      // Thêm snapshot nữa: im.
      await h.push(snapshot(GUIDE_DECK, 8));
      assert.equal(h.emitted.length, 8);
    } finally {
      await h.cleanup();
    }
  });

  it("mất kết nối rồi nối lại với snapshot đã áp dụng: đi tiếp, không gửi khi đang mất kết nối", async () => {
    const h = await mount(true, snapshot(DEFAULT_ROOM_CONFIG, 1));
    try {
      await h.push(snapshot(DEFAULT_ROOM_CONFIG, 1), { connected: false });
      await h.push(null, { connected: false });
      assert.equal(h.emitted.length, 1);
      await h.push(snapshot(GUIDE_DECK, 1), { connected: true });
      assert.equal(h.emitted.length, 2);
      assert.equal(h.emitted[1]!.event, "room:add-bot");
    } finally {
      await h.cleanup();
    }
  });

  it("tải lại sau khi đã chuẩn bị (cờ trong sessionStorage): host đã chỉnh bàn thì không gửi gì", async () => {
    window.sessionStorage.setItem(PREP_KEY, "1");
    const h = await mount(true, snapshot({ ...GUIDE_DECK, hunter: false }, 7));
    try {
      await h.rerender();
      assert.equal(h.emitted.length, 0);
      assert.equal(h.stage(), "done");
    } finally {
      await h.cleanup();
    }
  });

  it("phòng thường (không xin hướng dẫn): không gửi gì, không đọc cờ", async () => {
    const h = await mount(false, snapshot(DEFAULT_ROOM_CONFIG, 1));
    try {
      await h.push(snapshot(DEFAULT_ROOM_CONFIG, 1));
      assert.equal(h.emitted.length, 0);
      assert.equal(h.stage(), null);
    } finally {
      await h.cleanup();
    }
  });

  it("add-bot chưa được xác nhận: hẹn giờ thật trôi qua cửa sổ vẫn KHÔNG gửi add-bot thứ hai", async () => {
    const h = await mount(true, snapshot(GUIDE_DECK, 7));
    try {
      const { act } = await import("react");
      assert.equal(h.emitted.length, 1);
      assert.equal(h.emitted[0]!.event, "room:add-bot");
      await act(async () => { await new Promise((r) => setTimeout(r, GUIDE_PREP_RETRY_MS + 200)); });
      await h.rerender();
      assert.equal(h.emitted.length, 1, "gửi lại add-bot theo đồng hồ là thừa một bot");
      // Snapshot 8 người tới muộn: xong, không gửi thêm.
      await h.push(snapshot(GUIDE_DECK, 8));
      assert.equal(h.emitted.length, 1);
      assert.equal(h.stage(), "done");
    } finally {
      await h.cleanup();
    }
  });

  it("không xác nhận thì gửi lại theo hẹn giờ thật, tới trần rồi báo failed", async () => {
    const h = await mount(true, snapshot(DEFAULT_ROOM_CONFIG, 1));
    try {
      const { act } = await import("react");
      const wait = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
      assert.equal(h.emitted.length, 1);
      await wait(GUIDE_PREP_RETRY_MS + 100);
      assert.equal(h.emitted.length, 2);
      await wait(GUIDE_PREP_RETRY_MS + 100);
      assert.equal(h.emitted.length, 3);
      await wait(GUIDE_PREP_RETRY_MS + 100);
      assert.equal(h.emitted.length, 3);
      assert.equal(h.stage(), "failed");
    } finally {
      await h.cleanup();
    }
  });
});
