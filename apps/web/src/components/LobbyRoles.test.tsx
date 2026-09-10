import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  DEFAULT_ROOM_CONFIG,
  ROLE_META,
  type RoomConfig,
  type RoomSnapshot,
} from "@masoi/shared";

/**
 * Tóm tắt vai trò ở sảnh: hiện ĐỦ mọi vai, tooltip chức năng, và nút Thêm bot
 * đứng yên một chỗ.
 *
 * - Nhiều vai không còn bị gom vào chip "+n": bao nhiêu vai là bấy nhiêu chip.
 * - Hover (native `title`, cùng pattern với `RoleDeckPanel`) đọc ra mô tả
 *   chức năng của vai đó.
 * - Nút "Thêm bot" luôn nằm trong khối ghim dưới nút Bắt đầu, thiếu hay đủ
 *   người cũng vậy - layout không giật khi qua ngưỡng bắt đầu được.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const HOST_ID = "host-1";

/** Bộ bài nhiều vai: Sói + 6 vai làng có hành động + Dân. */
const MANY_ROLES: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  villagers: 2,
  seer: true,
  guard: true,
  witch: true,
  hunter: true,
  detective: true,
  tracker: true,
};

function players(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? HOST_ID : `p${index + 1}`,
    name: index === 0 ? "Chủ" : `Bot ${index + 1}`,
    alive: true,
    isBot: index > 0,
    ready: true,
  }));
}

function snapshot(count: number, config: RoomConfig): RoomSnapshot {
  return {
    code: "ROLES",
    hostId: HOST_ID,
    phase: "LOBBY",
    config,
    round: 0,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: HOST_ID, name: "Chủ", ready: true, connected: true, alive: true },
    players: players(count),
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
  } as RoomSnapshot;
}

async function mount(count: number, config: RoomConfig) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { Lobby } = await import("./Lobby");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      React.createElement(Lobby, {
        snapshot: snapshot(count, config),
        identity: { playerId: HOST_ID, token: "t", nickname: "n" },
        onReady: () => {},
        onStart: () => {},
        onAddBot: () => {},
        onUpdateConfig: () => {},
      }),
    );
  });
  return {
    chips: () => [...host.querySelectorAll<HTMLElement>(".lobby-role-chip")],
    pinned: () => host.querySelector<HTMLElement>(".lobby-primary-action"),
    summary: () => host.querySelector<HTMLElement>(".lobby-command-summary"),
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("Lobby: tóm tắt vai trò", () => {
  it("nhiều vai thì hiện đủ, không gom vào chip +n", async () => {
    const view = await mount(10, MANY_ROLES);
    const chips = view.chips();
    assert.ok(chips.length >= 8, `phải hiện đủ 8 vai, thấy ${chips.length}`);
    assert.equal(
      chips.some((chip) => /^\+\d+$/.test(chip.textContent?.trim() ?? "")),
      false,
      "không còn chip +n",
    );
    await view.cleanup();
  });

  it("mỗi chip vai mang tooltip mô tả chức năng", async () => {
    const view = await mount(10, MANY_ROLES);
    const seer = view.chips().find((chip) => chip.textContent?.includes(ROLE_META.SEER.name));
    assert.ok(seer, "phải có chip Tiên Tri");
    assert.equal(seer.getAttribute("title"), ROLE_META.SEER.description);
    assert.ok(
      view.chips().every((chip) => (chip.getAttribute("title") ?? "").length > 0),
      "mọi chip đều có tooltip",
    );
    await view.cleanup();
  });
});

describe("Lobby: nút Thêm bot đứng yên", () => {
  it("thiếu người: nút nằm trong khối ghim dưới nút Bắt đầu", async () => {
    const view = await mount(5, MANY_ROLES);
    assert.match(view.pinned()?.textContent ?? "", /Thêm bot/, "thiếu người thì nút ở khối ghim");
    await view.cleanup();
  });

  it("đủ người: nút VẪN nằm trong khối ghim, không chạy lên phần tóm tắt", async () => {
    const view = await mount(10, MANY_ROLES);
    assert.match(
      view.pinned()?.textContent ?? "",
      /Thêm bot/,
      "đủ người nút vẫn ở khối ghim dưới nút Bắt đầu",
    );
    assert.equal(
      (view.summary()?.textContent ?? "").includes("Thêm bot"),
      false,
      "phần tóm tắt không còn nút Thêm bot",
    );
    await view.cleanup();
  });
});
