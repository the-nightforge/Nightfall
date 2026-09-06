import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  DEFAULT_ROOM_CONFIG,
  PRESET_DECKS,
  sameDeck,
  type RoomConfig,
  type RoomSnapshot,
} from "@masoi/shared";

/**
 * Lối thoát đặt NGAY DƯỚI nút Bắt đầu khi bộ bài là thứ đang chặn.
 *
 * Kịch bản gặp nhiều nhất của một phòng thật: host mở phòng, áp đội hình chuẩn
 * cho 8, rồi thêm bot cho vui tới 10. Bộ bài vẫn là bộ của 8, nên server từ
 * chối và nút Bắt đầu xám với "Bộ bài cần 8 người, phòng đang có 10". Cách sửa
 * là một cú bấm - áp preset của cỡ bàn hiện tại - nhưng cái nút làm việc đó
 * nằm trong lớp phủ "Luật và vai trò", sau một cú bấm nữa và một cuộn nữa.
 * Host nhìn thấy một nút xám, một dòng đỏ, và không có gì để bấm.
 *
 * Nút ở đây là bản sao HÀNH ĐỘNG của nút trong lớp phủ (`LobbySettings.test`),
 * không phải bản sao điều kiện: nó chỉ mọc ra khi bộ bài đang thực sự CHẶN,
 * còn nút trong lớp phủ có mặt hễ bộ bài lệch preset. Hai bộ test giữ đúng hai
 * điều kiện đó tách nhau.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/*
 * happy-dom không có ResizeObserver, và `Lobby` dùng nó để đo chiều cao thanh
 * hành động dính đáy (`useDockHeight`). Bản giả này không cần đo gì: test ở đây
 * hỏi về nút bấm, không hỏi về layout.
 */
if (!("ResizeObserver" in globalThis)) {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const HOST_ID = "host-1";

/*
 * `allReady: false` cắm vào phòng đúng MỘT người thật chưa bấm sẵn sàng.
 *
 * Không đổi cờ `ready` của cả phòng: `startBlock` chỉ đếm người THẬT không
 * phải chủ phòng, nên một phòng toàn bot với `ready: false` vẫn không bị chặn -
 * và test sẽ xanh vì một lý do khác hẳn lý do nó tưởng.
 */
function players(count: number, allReady = true) {
  return Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? HOST_ID : `p${index + 1}`,
    name: index === 0 ? "Chủ" : index === 1 && !allReady ? "Khách" : `Bot ${index + 1}`,
    alive: true,
    isBot: index > 0 && !(index === 1 && !allReady),
    ready: !(index === 1 && !allReady),
  }));
}

function snapshot(count: number, config: RoomConfig, allReady = true): RoomSnapshot {
  return {
    code: "BLOCK",
    hostId: HOST_ID,
    phase: "LOBBY",
    config,
    round: 0,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: HOST_ID, name: "Chủ", ready: true, connected: true, alive: true },
    players: players(count, allReady),
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

async function mount(
  count: number,
  config: RoomConfig,
  options: { playerId?: string; allReady?: boolean } = {},
) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { Lobby } = await import("./Lobby");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const updates: RoomConfig[] = [];
  await act(async () => {
    root.render(
      React.createElement(Lobby, {
        snapshot: snapshot(count, config, options.allReady ?? true),
        identity: { playerId: options.playerId ?? HOST_ID, token: "t", nickname: "n" },
        onReady: () => {},
        onStart: () => {},
        onAddBot: () => {},
        onUpdateConfig: (next: RoomConfig) => updates.push(next),
      }),
    );
  });
  return {
    updates,
    fix: () => host.querySelector<HTMLButtonElement>('[data-testid="fix-deck"]'),
    reason: () => host.querySelector<HTMLElement>('[data-testid="start-block"]'),
    click: async (el: HTMLElement) => {
      await act(async () => el.click());
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("Lối thoát dưới nút Bắt đầu: khi nào có mặt", () => {
  it("có mặt khi bộ bài của bàn 8 còn nguyên ở bàn 10", async () => {
    const view = await mount(10, PRESET_DECKS[8]);
    assert.match(view.reason()?.textContent ?? "", /Bộ bài cần 8 người/);
    assert.equal(view.fix()?.textContent, "Áp dụng đội hình chuẩn cho 10 người");
    await view.cleanup();
  });

  it("vắng mặt với khách - chỉ chủ phòng đổi được cấu hình", async () => {
    const view = await mount(10, PRESET_DECKS[8], { playerId: "p2" });
    // Khách vẫn ĐỌC được lý do; họ chỉ không có nút để sửa.
    assert.ok(view.reason());
    assert.equal(view.fix(), null);
    await view.cleanup();
  });

  it("vắng mặt khi lý do chặn không phải bộ bài (chưa đủ người)", async () => {
    const view = await mount(5, DEFAULT_ROOM_CONFIG);
    assert.match(view.reason()?.textContent ?? "", /Cần thêm/);
    assert.equal(view.fix(), null);
    await view.cleanup();
  });

  it("vắng mặt khi bộ bài đã đúng preset và chỉ còn chờ người bấm sẵn sàng", async () => {
    const view = await mount(8, PRESET_DECKS[8], { allReady: false });
    assert.match(view.reason()?.textContent ?? "", /sẵn sàng/);
    assert.equal(view.fix(), null);
    await view.cleanup();
  });

  it("vắng mặt khi không có gì chặn", async () => {
    const view = await mount(8, PRESET_DECKS[8]);
    assert.equal(view.reason(), null);
    assert.equal(view.fix(), null);
    await view.cleanup();
  });
});

describe("Lối thoát dưới nút Bắt đầu: bấm thì gửi gì", () => {
  it("chỉ thay bộ bài - giữ Chaos, voice, Phong thư và thời gian của phòng", async () => {
    const room: RoomConfig = {
      ...PRESET_DECKS[8],
      mode: "chaos",
      voice: true,
      lastLetter: true,
      discussionSeconds: 300,
    };
    const view = await mount(10, room);
    const button = view.fix();
    assert.ok(button, "phải có nút áp preset");
    await view.click(button);

    assert.equal(view.updates.length, 1);
    const sent = view.updates[0];
    assert.ok(sameDeck(sent, PRESET_DECKS[10]), "bộ bài phải là preset của bàn 10");
    assert.equal(sent.mode, "chaos");
    assert.equal(sent.voice, true);
    assert.equal(sent.lastLetter, true);
    assert.equal(sent.discussionSeconds, 300);
    await view.cleanup();
  });
});
