import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";

/**
 * Lớp phủ "Luật và vai trò": ba lối đóng, và ranh giới chủ phòng / khách.
 *
 * Thiết lập ván từng nằm thẳng trong thanh điều khiển của phòng chờ. Chuyển nó
 * vào một lớp phủ đổi hai thứ mà chỉ DOM thật mới kiểm được:
 *
 *   - đóng/mở giờ là một trạng thái, và một lớp phủ chỉ đóng được bằng nút ×
 *     là một cái bẫy cho người dùng bàn phím. Escape và bấm ra ngoài phải làm
 *     đúng việc mà nút × làm, và focus phải quay về đúng cái nút đã mở nó -
 *     không thì Tab tiếp theo bắt đầu lại từ đầu trang.
 *   - toàn bộ ruột `LobbySettings` đi qua một tầng mới. Bộ test này mount ruột
 *     thật (không mock) để chắc nội dung chủ phòng thấy đi qua nguyên vẹn, và
 *     khách thì không có lối vào nào - nút trigger vắng mặt hẳn.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
// React 19 đòi cờ này thì `act()` mới bao được effect.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST_ID = "host-1";
const GUEST_ID = "guest-1";

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "DRAWR",
    hostId: HOST_ID,
    phase: "LOBBY",
    config: DEFAULT_ROOM_CONFIG,
    round: 0,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: HOST_ID, name: "Chủ", ready: true, connected: true, alive: true },
    players: [
      { id: HOST_ID, name: "Chủ", alive: true, isBot: false },
      { id: GUEST_ID, name: "Khách", alive: true, isBot: false, ready: false },
    ],
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

async function mountDrawer(playerId: string) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LobbySettingsDrawer } = await import("./LobbySettingsDrawer");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  const updates: unknown[] = [];
  await act(async () => {
    root.render(
      React.createElement(LobbySettingsDrawer, {
        snapshot: snapshot(),
        identity: { playerId, token: "t", nickname: "n" },
        onUpdateConfig: (config: unknown) => updates.push(config),
      }),
    );
  });

  const trigger = () => host.querySelector<HTMLButtonElement>(".lobby-settings-trigger");
  const dialog = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
  const backdrop = () =>
    document.body.querySelector<HTMLButtonElement>('[aria-label="Đóng bảng luật và vai trò"]');

  return {
    updates,
    trigger,
    dialog,
    backdrop,
    /** Chữ bên trong lớp phủ - dùng để kiểm ruột `LobbySettings` đi qua nguyên vẹn. */
    dialogText: () => dialog()?.textContent ?? "",
    open: async () => {
      await act(async () => trigger()!.click());
    },
    press: async (key: string) => {
      await act(async () => {
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      });
      // `useModalFocus` trả focus trong một rAF để React kịp dựng lại nút mở.
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

describe("LobbySettingsDrawer: đóng và mở", () => {
  it("mặc định đóng, và trang không dựng sẵn lớp phủ nào", async () => {
    const view = await mountDrawer(HOST_ID);
    assert.equal(view.dialog(), null, "chưa bấm thì không có dialog");
    assert.equal(view.trigger()?.getAttribute("aria-expanded"), "false");
    assert.equal(view.trigger()?.getAttribute("aria-haspopup"), "dialog");
    await view.cleanup();
  });

  it("bấm nút -> lớp phủ mở, là modal thật, và focus rơi vào nút Đóng", async () => {
    const view = await mountDrawer(HOST_ID);
    await view.open();

    const dialog = view.dialog();
    assert.ok(dialog, "lớp phủ phải có mặt");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.equal(dialog.getAttribute("aria-labelledby"), "lobby-settings-title");
    assert.ok(
      document.getElementById("lobby-settings-title"),
      "aria-labelledby phải trỏ tới một phần tử có thật",
    );
    assert.equal(view.trigger()?.getAttribute("aria-expanded"), "true");
    assert.equal(
      document.activeElement?.getAttribute("aria-label"),
      "Đóng",
      "mở ra là con trỏ đã ở trong lớp phủ, không còn ở nút vừa bấm",
    );

    await view.cleanup();
  });

  it("Escape đóng lớp phủ và trả focus về đúng nút đã mở nó", async () => {
    const view = await mountDrawer(HOST_ID);
    await view.open();
    await view.press("Escape");

    assert.equal(view.dialog(), null, "Escape phải đóng lớp phủ");
    assert.equal(view.trigger()?.getAttribute("aria-expanded"), "false");
    assert.equal(
      document.activeElement,
      view.trigger(),
      "focus quay về nút mở, không rơi về body",
    );
    await view.cleanup();
  });

  it("bấm ra ngoài đóng lớp phủ", async () => {
    const view = await mountDrawer(HOST_ID);
    await view.open();
    assert.ok(view.backdrop(), "tấm nền mờ phải là một nút bấm được, có nhãn");

    await view.press("Escape");
    await view.open();
    await (async () => {
      const { act } = await import("react");
      await act(async () => view.backdrop()!.click());
    })();

    assert.equal(view.dialog(), null, "bấm ra ngoài phải đóng lớp phủ");
    await view.cleanup();
  });

  it("nút Đóng đóng lớp phủ", async () => {
    const view = await mountDrawer(HOST_ID);
    await view.open();
    const { act } = await import("react");
    const close = document.body.querySelector<HTMLButtonElement>('[aria-label="Đóng"]');
    await act(async () => close!.click());
    assert.equal(view.dialog(), null);
    await view.cleanup();
  });
});

describe("LobbySettingsDrawer: chỉ chủ phòng thấy nút", () => {
  it("khách không thấy nút 'Luật và vai trò'", async () => {
    const view = await mountDrawer(GUEST_ID);
    assert.equal(view.trigger() !== null, false, "khách không được thấy nút");
    await view.cleanup();
  });
});

describe("LobbySettingsDrawer: chủ phòng và khách", () => {
  it("chủ phòng mở ra đủ ba mục, kể cả cài đặt nâng cao", async () => {
    const view = await mountDrawer(HOST_ID);
    assert.match(view.trigger()?.textContent ?? "", /Thiết lập ván/);

    await view.open();
    const text = view.dialogText();
    assert.match(text, /Thiết lập ván/);
    assert.match(text, /Chỉnh sửa vai trò/);
    assert.match(text, /Cài đặt nâng cao/, "chỉ chủ phòng mới có mục thời gian");
    await view.cleanup();
  });

  it("khách không mở được lớp phủ bằng bàn phím hay nút nào khác", async () => {
    // Không có trigger thì không có lối vào: kiểm cả dialog lẫn backdrop đều
    // vắng mặt, không chỉ nút.
    const view = await mountDrawer(GUEST_ID);
    assert.equal(view.dialog() !== null, false, "khách không có dialog");
    assert.equal(view.backdrop() !== null, false, "khách không có tấm nền");
    assert.equal(view.updates.length, 0, "và không phát ra thay đổi cấu hình nào");
    await view.cleanup();
  });
});
