import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, PRESET_DECKS, type RoomConfig, type RoomSnapshot } from "@masoi/shared";

/**
 * Hai ô có SỐ trong bảng xếp bài: Dân Làng và Ma Sói.
 *
 * Cả hai đều nằm trong một thẻ dựng bằng `div` (nút trong nút là HTML hỏng),
 * và cả hai đều tự kẹp giá trị trước khi gửi. Chỗ kẹp ấy là chỗ hỏng:
 *
 *   - Kẹp TRẦN vô điều kiện thì một bộ bài ĐANG vượt trần - host đặt 3 Dân
 *     Làng rồi bật thêm mười mấy vai - không giảm được từng bước: cú bấm "−"
 *     đầu tiên nhảy thẳng từ 3 về 1, bỏ qua đúng bộ bài host đang nhắm tới.
 *   - Ô Ma Sói chỉ biết trần của LUẬT (4 con), không biết trần của PHÒNG, nên
 *     con Sói thứ tư thêm vào một bộ bài đã kín 20 ghế chỉ đổi được một dòng
 *     lỗi đỏ từ server - hiện ở cột chính, không ở bảng đang mở.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOST_ID = "host-1";

/**
 * Mọi vai bật/tắt được đều BẬT: 14 lá đặc biệt phe Dân/trung lập + 5 ghế Sói
 * (2 Sói + Sói Con + Kẻ Phản Bội + Sói Pháp Sư) = 19 ghế.
 *
 * Cộng 3 Dân Làng là 22, tức bộ bài đã vượt `MAX_PLAYERS_PER_ROOM` (20) - đúng
 * cái trạng thái mà host rơi vào khi đặt số Dân Làng trước rồi bật thêm vai.
 */
const PACKED: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  werewolves: 2,
  wolfCub: true,
  traitor: true,
  sorcerer: true,
  seer: true,
  guard: true,
  witch: true,
  hunter: true,
  cursed: true,
  apprenticeSeer: true,
  detective: true,
  tracker: true,
  mayor: true,
  elder: true,
  doppelganger: true,
  jester: true,
  serialKiller: true,
  executioner: true,
  villagers: 3,
};

function snapshot(count: number, config: RoomConfig): RoomSnapshot {
  return {
    code: "DECK1",
    hostId: HOST_ID,
    phase: "LOBBY",
    config,
    round: 0,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: HOST_ID, name: "Chủ", ready: true, connected: true, alive: true },
    players: Array.from({ length: count }, (_, i) => ({
      id: i === 0 ? HOST_ID : `p${i + 1}`,
      name: i === 0 ? "Chủ" : `Bot ${i + 1}`,
      alive: true,
      isBot: i > 0,
      ready: true,
    })),
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

async function mount(count: number, config: RoomConfig, isHost = true) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { RoleDeckPanel } = await import("./RoleDeckPanel");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const updates: RoomConfig[] = [];
  await act(async () => {
    root.render(
      React.createElement(RoleDeckPanel, {
        snapshot: snapshot(count, config),
        isHost,
        onUpdateConfig: (next: RoomConfig) => updates.push(next),
      }),
    );
  });
  const btn = (label: string) => {
    const el = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
    assert.ok(el, `không thấy nút "${label}"`);
    return el;
  };
  return {
    updates,
    btn,
    query: (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`),
    click: async (el: HTMLElement) => {
      await act(async () => el.click());
    },
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("ô Dân Làng", () => {
  it("bấm + thì gửi đúng một lá nhiều hơn", async () => {
    const deck = PRESET_DECKS[12];
    const view = await mount(12, deck);
    await view.click(view.btn("Thêm một Dân Làng"));
    assert.equal(view.updates.length, 1);
    assert.equal(view.updates[0].villagers, (deck.villagers ?? 0) + 1);
    await view.cleanup();
  });

  it("bấm − thì gửi đúng một lá ít hơn", async () => {
    const deck = PRESET_DECKS[12];
    const view = await mount(12, deck);
    await view.click(view.btn("Bớt một Dân Làng"));
    assert.equal(view.updates[0].villagers, (deck.villagers ?? 0) - 1);
    await view.cleanup();
  });

  it("bộ bài đã vượt trần vẫn giảm được TỪNG BƯỚC, không nhảy thẳng về sàn", async () => {
    const view = await mount(8, PACKED);
    await view.click(view.btn("Bớt một Dân Làng"));
    assert.equal(view.updates[0].villagers, 2, "3 → 2, không phải 3 → 1");
    await view.cleanup();
  });

  it("bộ bài đã kín phòng thì nút + xám", async () => {
    const view = await mount(8, PACKED);
    assert.equal(view.btn("Thêm một Dân Làng").disabled, true);
    await view.cleanup();
  });

  it("một Dân Làng là sàn: nút − xám", async () => {
    const view = await mount(8, { ...DEFAULT_ROOM_CONFIG, villagers: 1 });
    assert.equal(view.btn("Bớt một Dân Làng").disabled, true);
    await view.cleanup();
  });
});

describe("ô Ma Sói", () => {
  it("bấm + thì gửi đúng một con Sói nhiều hơn", async () => {
    const view = await mount(12, PRESET_DECKS[12]);
    await view.click(view.btn("Thêm một Ma Sói"));
    assert.equal(view.updates[0].werewolves, PRESET_DECKS[12].werewolves + 1);
    await view.cleanup();
  });

  it("bộ bài đã kín phòng thì nút + xám, dù luật còn cho tới 4 con", async () => {
    const view = await mount(8, PACKED);
    assert.equal(PACKED.werewolves, 2, "tiền đề: trần của luật chưa chạm tới");
    assert.equal(view.btn("Thêm một Ma Sói").disabled, true);
    await view.cleanup();
  });
});

describe("khách", () => {
  it("không thấy hai ô số nào cả", async () => {
    const view = await mount(12, PRESET_DECKS[12], false);
    assert.equal(view.query("Thêm một Dân Làng"), null);
    assert.equal(view.query("Thêm một Ma Sói"), null);
    await view.cleanup();
  });
});
