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
 * Nút "Áp dụng đội hình chuẩn" của mục "Thiết lập ván".
 *
 * Bản cũ đặt nút đó BÊN TRONG thẻ cảnh báo cân bằng, nên nó chỉ có mặt khi
 * engine có gì để phàn nàn. Hai kịch bản thật làm nó biến mất đúng lúc cần:
 *
 *   - Phòng 8 người áp preset 8, người thứ 9 vào. Điểm vẫn 50, không cảnh báo,
 *     thẻ ẩn, nút ẩn - trong khi nút Bắt đầu xám với "Bộ bài cần 8 người,
 *     phòng đang có 9". Host phải tự mò vào "Chỉnh sửa vai trò".
 *   - Bộ bài mặc định ở bàn 11-14 người: điểm trong dải, không cảnh báo, không
 *     nút - dù đó là "Đội hình tuỳ chỉnh" và preset chuẩn có sẵn.
 *
 * Và khi nút CÓ mặt, nó gửi nguyên preset làm cấu hình mới: preset mang
 * `mode: "ranked"` và bộ giây gốc, nên bấm nó là phòng Chaos về Ranked, voice
 * tắt, Phong thư sau cùng tắt.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST_ID = "host-1";

function players(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i === 0 ? HOST_ID : `p${i + 1}`,
    name: i === 0 ? "Chủ" : `Bot ${i + 1}`,
    alive: true,
    isBot: i > 0,
    ready: true,
  }));
}

function snapshot(count: number, config: RoomConfig): RoomSnapshot {
  return {
    code: "SETUP",
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

async function mount(count: number, config: RoomConfig, playerId = HOST_ID) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LobbySettings } = await import("./Lobby");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const updates: RoomConfig[] = [];
  await act(async () => {
    root.render(
      React.createElement(LobbySettings, {
        snapshot: snapshot(count, config),
        identity: { playerId, token: "t", nickname: "n" },
        onUpdateConfig: (next: RoomConfig) => updates.push(next),
      }),
    );
  });
  return {
    updates,
    preset: () => host.querySelector<HTMLButtonElement>('[data-testid="apply-preset"]'),
    warning: () => host.querySelector<HTMLElement>('[data-testid="balance-warning"]'),
    click: async (el: HTMLElement) => {
      await act(async () => el.click());
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("Áp dụng đội hình chuẩn: khi nào có mặt", () => {
  // Cặp (preset 13, bàn 14) chấm đúng 50. Cặp cũ (preset 8, bàn 9) lên 63.5 khi
  // preset 9 nhận Kẻ Nguyền Rủa (2026-09-11), và thẻ cảnh báo mọc ra.
  it("có mặt khi bộ bài lệch preset dù engine không cảnh báo (preset 13 ở bàn 14)", async () => {
    const view = await mount(14, PRESET_DECKS[13]);
    assert.equal(view.warning(), null, "tiền đề: điểm 50, không có thẻ cảnh báo");
    assert.ok(view.preset(), "nút phải có mặt - nút Bắt đầu đang xám vì thiếu một ghế");
    await view.cleanup();
  });

  // Bàn 10: bộ bài mặc định chấm 54.5, sát mép 55 - nhưng 9/10/11 là ba cỡ
  // duy nhất nó không cảnh báo (bàn 12 cũ lên 65 khi preset 12 nhận Kẻ Nguyền
  // Rủa, 2026-09-11), và cả ba đều cách mép đúng 0.5.
  it("có mặt với bộ bài mặc định ở bàn 10 người (điểm trong dải, không cảnh báo)", async () => {
    const view = await mount(10, DEFAULT_ROOM_CONFIG);
    assert.equal(view.warning(), null);
    assert.ok(view.preset());
    await view.cleanup();
  });

  it("vẫn có mặt khi bộ bài lệch VÀ có cảnh báo", async () => {
    const view = await mount(11, PRESET_DECKS[10]);
    assert.ok(view.warning(), "tiền đề: preset 10 ở bàn 11 bị chặn");
    assert.ok(view.preset());
    await view.cleanup();
  });

  it("ẩn khi bộ bài đã đúng preset", async () => {
    const view = await mount(9, PRESET_DECKS[9]);
    assert.equal(view.preset(), null);
    await view.cleanup();
  });

  it("ẩn khi chưa đủ người để chấm", async () => {
    const view = await mount(5, DEFAULT_ROOM_CONFIG);
    assert.equal(view.preset(), null);
    await view.cleanup();
  });

  it("ẩn với khách", async () => {
    const view = await mount(9, PRESET_DECKS[8], "p2");
    assert.equal(view.preset(), null);
    await view.cleanup();
  });
});

describe("Áp dụng đội hình chuẩn: bấm thì gửi gì", () => {
  it("chỉ thay bộ bài - giữ Chaos, voice, Phong thư và thời gian của phòng", async () => {
    const room: RoomConfig = {
      ...PRESET_DECKS[8],
      mode: "chaos",
      voice: true,
      lastLetter: true,
      discussionSeconds: 120,
    };
    const view = await mount(9, room);
    await view.click(view.preset()!);

    assert.equal(view.updates.length, 1);
    const sent = view.updates[0];
    assert.ok(sameDeck(sent, PRESET_DECKS[9]), "bộ bài phải là preset của bàn 9");
    assert.equal(sent.mode, "chaos");
    assert.equal(sent.voice, true);
    assert.equal(sent.lastLetter, true);
    assert.equal(sent.discussionSeconds, 120);
    await view.cleanup();
  });
});
