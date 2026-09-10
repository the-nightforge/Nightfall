import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";

/**
 * Bảng tra luật giữa ván: mở/đóng đúng ba lối, và ruột đọc đúng snapshot.
 *
 * Phần "ruột đọc gì" đã có test thuần ở `lib/rules-lookup.test.ts`; ở đây chỉ
 * kiểm rằng những gì module đó trả về thật sự lên DOM, và lớp phủ cư xử như
 * lớp phủ của phòng chờ - vì nó dùng chung CSS và bẫy focus với bên đó.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "RULES",
    hostId: "me",
    phase: "VOTING",
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 2, seer: true, villagers: 3 },
    round: 2,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: "me", name: "Tôi", ready: true, connected: true, role: "GUARD", alive: true },
    players: [],
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
    ...over,
  } as RoomSnapshot;
}

async function mount(view: RoomSnapshot = snapshot()) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { RulesDrawer } = await import("./RulesDrawer");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(RulesDrawer, { snapshot: view }));
  });

  const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="Luật và vai trò"]');
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
  return {
    trigger,
    dialog,
    text: () => dialog()?.textContent ?? "",
    open: async () => {
      await act(async () => trigger()!.click());
    },
    clickBackdrop: async () => {
      await act(async () => {
        document.body
          .querySelector<HTMLButtonElement>('[aria-label="Đóng bảng luật và vai trò"]')!
          .click();
      });
    },
    press: async (key: string) => {
      await act(async () => {
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      });
      await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("RulesDrawer", () => {
  it("mặc định đóng; nút có đủ thuộc tính của một nút mở dialog", async () => {
    const v = await mount();
    assert.equal(v.dialog(), null);
    assert.equal(v.trigger()?.getAttribute("aria-haspopup"), "dialog");
    assert.equal(v.trigger()?.getAttribute("aria-expanded"), "false");
    await v.cleanup();
  });

  it("mở ra thì có pha, vai của mình, và bộ bài; focus rơi vào nút Đóng", async () => {
    const v = await mount();
    await v.open();
    assert.equal(v.dialog()?.getAttribute("aria-modal"), "true");
    assert.equal(document.activeElement?.getAttribute("aria-label"), "Đóng");
    const text = v.text();
    assert.match(text, /Bỏ phiếu sơ bộ/);
    assert.match(text, /Bảo Vệ/);
    assert.match(text, /Ma Sói/);
    assert.match(text, /×2/);
    assert.match(text, /Dân Làng/);
    await v.cleanup();
  });

  it("Escape đóng và trả focus về nút ?", async () => {
    const v = await mount();
    await v.open();
    await v.press("Escape");
    assert.equal(v.dialog(), null);
    assert.equal(document.activeElement, v.trigger());
    await v.cleanup();
  });

  it("bấm nền đóng", async () => {
    const v = await mount();
    await v.open();
    await v.clickBackdrop();
    assert.equal(v.dialog(), null);
    await v.cleanup();
  });

  it("người không phải chủ phòng không thấy nút", async () => {
    const v = await mount(
      snapshot({ hostId: "me", you: { id: "guest", name: "Khách", ready: true, connected: true, role: "GUARD", alive: true } }),
    );
    assert.equal(v.trigger() !== null, false, "khách không được thấy nút tra luật");
    await v.cleanup();
  });

  it("phòng xếp hạng không có mục sự kiện; phòng hỗn loạn thì có", async () => {
    const event = {
      id: "CURFEW" as const,
      name: "Giới nghiêm",
      description: "Đêm nay không ai được nói.",
      targetPhase: "NIGHT" as const,
      round: 2,
      beneficiary: "wolves" as const,
      power: 1,
    };
    const ranked = await mount(snapshot({ activeEvent: event }));
    await ranked.open();
    assert.doesNotMatch(ranked.text(), /Giới nghiêm/);
    await ranked.cleanup();

    const chaos = await mount(
      snapshot({ config: { ...DEFAULT_ROOM_CONFIG, mode: "chaos" }, activeEvent: event }),
    );
    await chaos.open();
    assert.match(chaos.text(), /Sự kiện đang chạy/);
    assert.match(chaos.text(), /Giới nghiêm/);
    await chaos.cleanup();
  });
});
