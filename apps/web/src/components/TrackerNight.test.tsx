import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, type NightActionView, type RoomSnapshot } from "@masoi/shared";

/**
 * Bảng hành động ĐÊM của Kẻ Theo Dõi, mount component thật.
 *
 * Trước bản này `NightPanel` không có nhánh nào cho "TRACKER": vai này rơi
 * thẳng vào màn "Bạn ngủ say" như một vai không hành động đêm, dù
 * `canActAtNight` đã cho phép nó hành động - người chơi bị dán không có nút
 * nào để bấm và đêm chạy hết `nightSeconds` timeout. Test này canh đúng lỗ hổng
 * đó, cùng khuôn với `SerialKillerNight.test.tsx`.
 */

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function nightSnapshot(
  night: Partial<NightActionView> = {},
  trackerResult: RoomSnapshot["trackerResult"] = null,
): RoomSnapshot {
  return {
    code: "TRKNGT",
    hostId: "villager",
    phase: "NIGHT",
    config: { ...DEFAULT_ROOM_CONFIG, tracker: true },
    round: 2,
    phaseEndsAt: null,
    serverNow: 0,
    you: {
      id: "tracker",
      name: "Dõi",
      ready: false,
      connected: true,
      role: "TRACKER",
      alive: true,
    },
    players: [
      { id: "tracker", name: "Dõi", alive: true, isBot: false },
      { id: "villager", name: "Dân", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", alive: true, isBot: false },
      { id: "wolf", name: "Sói", alive: true, isBot: false },
    ],
    night: {
      canAct: true,
      acted: false,
      ...night,
    },
    trackerResult,
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

interface Sent {
  type: string;
  targetId?: string | null;
}

async function mountNight(snapshot: RoomSnapshot) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { NightPanel } = await import("./NightPanel");

  const sent: Sent[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      React.createElement(NightPanel, {
        snapshot,
        onAction: (type: string, targetId?: string | null) => {
          sent.push({ type, targetId });
        },
      }),
    );
  });

  const buttons = () => Array.from(host.querySelectorAll("button"));
  const clickText = async (match: RegExp) => {
    const button = buttons().find((item) => match.test(item.textContent ?? ""));
    assert.ok(button, `không tìm thấy nút khớp ${match}`);
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
  };

  return {
    sent,
    text: () => host.textContent ?? "",
    buttons,
    clickText,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("NightPanel · Kẻ Theo Dõi", () => {
  it("KHÔNG rơi vào màn 'Bạn ngủ say'", async () => {
    const panel = await mountNight(nightSnapshot());
    assert.doesNotMatch(panel.text(), /Bạn ngủ say/);
    await panel.unmount();
  });

  it("chọn người rồi bấm là gửi đúng TRACK kèm mục tiêu", async () => {
    const panel = await mountNight(nightSnapshot());

    const seat = panel.buttons().find((item) => /Dân/.test(item.textContent ?? ""));
    assert.ok(seat);
    const { act } = await import("react");
    await act(async () => {
      seat.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    await panel.clickText(/Theo dõi người này/);
    assert.deepEqual(panel.sent, [{ type: "TRACK", targetId: "villager" }]);
    await panel.unmount();
  });

  it("ô của chính mình có mặt nhưng KHÔNG bấm được", async () => {
    // Gương luật engine: TRACK cấm tự nhắm (xem `submitNightAction` case
    // "TRACK"). Ô vẫn hiện để người chơi thấy đủ bàn, nhưng phải bị khoá.
    const panel = await mountNight(nightSnapshot());
    const seats = panel.buttons().filter((item) => /Dõi/.test(item.textContent ?? ""));

    assert.equal(seats.length, 1);
    assert.equal(seats[0].disabled, true);
    await panel.unmount();
  });

  it("có kết quả theo dõi gần nhất thì hiện đúng tên và CÓ ra tay khi acted true", async () => {
    const panel = await mountNight(nightSnapshot({}, { targetId: "wolf", acted: true }));
    const text = panel.text();
    assert.match(text, /Sói/);
    assert.match(text, /CÓ/);
    assert.doesNotMatch(text, /KHÔNG.*ra tay/);
    await panel.unmount();
  });

  it("kết quả theo dõi báo KHÔNG ra tay khi acted là false", async () => {
    const panel = await mountNight(nightSnapshot({}, { targetId: "wolf", acted: false }));
    assert.match(panel.text(), /KHÔNG.*ra tay/);
    await panel.unmount();
  });
});
