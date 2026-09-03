import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, type NightActionView, type RoomSnapshot } from "@masoi/shared";

/**
 * Bảng hành động ĐÊM của Sát Nhân, mount component thật.
 *
 * `NightPanel` phân nhánh theo `snapshot.you.role`, và một vai không có nhánh
 * riêng rơi thẳng vào màn "Bạn ngủ say" - im lặng, không lỗi, không log. Đây
 * là cách một vai mới mất trắng lượt đêm ở tầng giao diện, và không bộ test
 * thuần nào nhìn thấy được.
 */

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function nightSnapshot(night: Partial<NightActionView> = {}): RoomSnapshot {
  return {
    code: "SKNGT",
    hostId: "villager",
    phase: "NIGHT",
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, serialKiller: true },
    round: 2,
    phaseEndsAt: null,
    serverNow: 0,
    you: {
      id: "killer",
      name: "Sát",
      ready: false,
      connected: true,
      role: "SERIAL_KILLER",
      alive: true,
    },
    players: [
      { id: "killer", name: "Sát", alive: true, isBot: false },
      { id: "villager", name: "Dân", alive: true, isBot: false },
      { id: "seer", name: "Tiên Tri", alive: true, isBot: false },
      { id: "wolf", name: "Sói", alive: true, isBot: false },
    ],
    night: {
      canAct: true,
      acted: false,
      serialKillerTarget: null,
      serialKillerSkipped: false,
      ...night,
    },
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

describe("NightPanel · Sát Nhân", () => {
  it("KHÔNG rơi vào màn 'Bạn ngủ say'", async () => {
    const panel = await mountNight(nightSnapshot());
    assert.doesNotMatch(panel.text(), /Bạn ngủ say/);
    // Và nó phải nói rõ vai này đi một mình - đó là luật dễ hiểu sai nhất.
    assert.match(panel.text(), /một mình/);
    await panel.unmount();
  });

  it("chọn người rồi bấm là gửi đúng SERIAL_KILL kèm mục tiêu", async () => {
    const panel = await mountNight(nightSnapshot());

    // Chọn một người trong lưới. `PlayerGrid` dựng mỗi ô là một button.
    const seat = panel.buttons().find((item) => /Dân/.test(item.textContent ?? ""));
    assert.ok(seat);
    const { act } = await import("react");
    await act(async () => {
      seat.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    await panel.clickText(/Ra tay/);
    assert.deepEqual(panel.sent, [{ type: "SERIAL_KILL", targetId: "villager" }]);
    await panel.unmount();
  });

  it("có nút bỏ qua, và nó gửi SKIP không kèm mục tiêu", async () => {
    const panel = await mountNight(nightSnapshot());
    await panel.clickText(/Không giết ai/);
    assert.deepEqual(panel.sent, [{ type: "SKIP", targetId: null }]);
    await panel.unmount();
  });

  it("đã chốt mục tiêu thì nói rõ còn đổi ý được", async () => {
    const panel = await mountNight(
      nightSnapshot({ acted: true, serialKillerTarget: "villager" }),
    );
    const text = panel.text();

    assert.match(text, /Mục tiêu đang chốt/);
    assert.match(text, /đổi ý/);
    // KHÔNG hiện nhãn "Đã hành động": cửa vẫn mở tới khi trời sáng.
    assert.doesNotMatch(text, /Đã hành động/);
    await panel.unmount();
  });

  it("đã bỏ qua thì không bày lại lưới chọn người", async () => {
    // Engine từ chối mọi thao tác sau khi bỏ qua, nên bày ra một cú bấm chắc
    // chắn bị từ chối là hứa hão.
    const panel = await mountNight(nightSnapshot({ acted: true, serialKillerSkipped: true }));

    assert.match(panel.text(), /không ra tay đêm nay/i);
    assert.equal(
      panel.buttons().some((item) => /Ra tay|Không giết ai/.test(item.textContent ?? "")),
      false,
    );
    await panel.unmount();
  });

  it("ô của chính mình có mặt nhưng KHÔNG bấm được", async () => {
    const panel = await mountNight(nightSnapshot());
    const seats = panel.buttons().filter((item) => /Sát/.test(item.textContent ?? ""));

    /*
     * Ô vẫn hiện - người chơi cần thấy đủ bàn để suy luận - nhưng nó bị TẮT.
     * Engine cấm tự giết mình, và một cú bấm chắc chắn bị từ chối là một lời
     * hứa hão ngay giữa lượt đêm duy nhất của vai này.
     */
    assert.equal(seats.length, 1);
    assert.equal(seats[0].disabled, true);
    await panel.unmount();
  });
});
