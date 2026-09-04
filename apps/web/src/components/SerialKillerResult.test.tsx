import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  DEFAULT_ROOM_CONFIG,
  type MatchHistoryEntry,
  type PersonalWin,
  type RoomSnapshot,
} from "@masoi/shared";

/**
 * Màn kết thúc và lịch sử trận, MOUNT COMPONENT THẬT.
 *
 * Lỗi mà bộ này sinh ra để chặn không nằm trong một hàm thuần nào: nó nằm ở
 * dòng `const wolvesWin = snapshot.winner === "wolves"` ngay đầu `GameOverView`,
 * thứ rút bốn kết cục về một boolean rồi để mọi khối phía dưới đọc "không phải
 * Sói" thành "Dân Làng". Một ván Sát Nhân thắng khi đó hiện ra là phe Dân Làng
 * chiến thắng - với chính người vừa giết cả làng đứng ngoài danh sách.
 */

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDENTITY_KEY = "masoi.identity";

const JESTER_WIN: PersonalWin = {
  playerId: "jester",
  name: "Hề",
  role: "JESTER",
  condition: "JESTER_LYNCHED",
  round: 2,
};

function endedSnapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "SKEND",
    hostId: "villager",
    phase: "GAME_OVER",
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, serialKiller: true, jester: true },
    round: 4,
    phaseEndsAt: null,
    serverNow: 0,
    you: {
      id: "villager",
      name: "Dân",
      ready: false,
      connected: true,
      role: "VILLAGER",
      alive: false,
    },
    players: [
      { id: "killer", name: "Sát", alive: true, isBot: false, role: "SERIAL_KILLER" },
      { id: "jester", name: "Hề", alive: false, isBot: false, role: "JESTER" },
      { id: "villager", name: "Dân", alive: false, isBot: false, role: "VILLAGER" },
      { id: "wolf", name: "Sói", alive: false, isBot: false, role: "WEREWOLF" },
    ],
    night: null,
    hunterShot: null,
    trial: null,
    lastTrial: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: true,
    dayVoteHistory: [],
    nightHistory: [],
    hunterShots: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: "serial_killer",
    personalWins: [JESTER_WIN],
    chatLog: [],
    log: [],
    ...over,
  };
}

async function mountGameOver(snapshot: RoomSnapshot) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { GameOverView } = await import("./GameOverView");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(
      React.createElement(GameOverView, {
        snapshot,
        isHost: false,
        onReset: () => undefined,
        onLeave: () => undefined,
      }),
    );
  });

  return {
    text: () => host.textContent ?? "",
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

before(() => {
  window.localStorage.clear();
});

after(() => {
  window.localStorage.clear();
});

describe("Màn kết thúc · Sát Nhân thắng", () => {
  it("tiêu đề nói ĐÚNG ai thắng, không gán cho phe Dân Làng", async () => {
    const view = await mountGameOver(endedSnapshot());
    const text = view.text();

    assert.match(text, /Sát Nhân chiến thắng/);
    assert.doesNotMatch(text, /Phe Dân Làng chiến thắng/);
    assert.doesNotMatch(text, /Phe Ma Sói chiến thắng/);
    await view.unmount();
  });

  it("thành tích của Thằng Hề vẫn được kể, tách khỏi phe thắng", async () => {
    const view = await mountGameOver(endedSnapshot());
    const text = view.text();

    // Hai câu trả lời cho hai câu hỏi khác nhau, và cả hai đều phải có mặt.
    assert.match(text, /Thắng cá nhân/);
    assert.match(text, /bị treo cổ/);
    await view.unmount();
  });

  it("người xem là Dân Làng đọc ra THUA", async () => {
    const view = await mountGameOver(endedSnapshot());
    assert.match(view.text(), /Bạn thua/);
    await view.unmount();
  });

  it("chính Sát Nhân đọc ra THẮNG", async () => {
    const view = await mountGameOver(
      endedSnapshot({
        you: {
          id: "killer",
          name: "Sát",
          ready: false,
          connected: true,
          role: "SERIAL_KILLER",
          alive: true,
        },
      }),
    );
    assert.match(view.text(), /Bạn thắng/);
    await view.unmount();
  });
});

describe("Màn kết thúc · ván HOÀ", () => {
  const draw = () =>
    endedSnapshot({
      winner: "draw",
      players: [
        { id: "killer", name: "Sát", alive: false, isBot: false, role: "SERIAL_KILLER" },
        { id: "jester", name: "Hề", alive: false, isBot: false, role: "JESTER" },
        { id: "villager", name: "Dân", alive: false, isBot: false, role: "VILLAGER" },
        { id: "wolf", name: "Sói", alive: false, isBot: false, role: "WEREWOLF" },
      ],
    });

  it("nói rõ không ai thắng, và không dựng một hàng 'người thắng cuộc' rỗng", async () => {
    const view = await mountGameOver(draw());
    const text = view.text();

    assert.match(text, /hoà/i);
    // Một nhãn "Người thắng cuộc" đứng trên một hàng trống đọc như lỗi tải dữ
    // liệu chứ không như một kết cục.
    assert.doesNotMatch(text, /Người thắng cuộc/);
    assert.doesNotMatch(text, /chiến thắng/);
    await view.unmount();
  });

  it("thành tích của Thằng Hề KHÔNG bị hoà xoá đi", async () => {
    const view = await mountGameOver(draw());
    assert.match(view.text(), /Thắng cá nhân/);
    await view.unmount();
  });

  it("người không có thành tích riêng đọc ra 'Ván đấu hoà', không phải 'Bạn thua'", async () => {
    const view = await mountGameOver(draw());
    assert.match(view.text(), /Ván đấu hoà/);
    assert.doesNotMatch(view.text(), /Bạn thua/);
    await view.unmount();
  });

  it("nhãn kết quả cá nhân KHÔNG cãi lại khối 'Thắng cá nhân' ngay dưới nó", async () => {
    /*
     * Bài này là bài giữ cho ba khối của màn hoà nói cùng một chuyện. Thẻ hero
     * chỉ được nói về kết cục CHUNG; ai đạt được gì thì `drawNote` và danh sách
     * thắng cá nhân trả lời. Một chữ "Không ai thắng" ở thẻ hero là một lời phủ
     * nhận trực tiếp hai khối đang hiển thị bên dưới nó.
     */
    const view = await mountGameOver(draw());
    const text = view.text();

    assert.match(text, /Thắng cá nhân/);
    assert.doesNotMatch(text, /Không ai thắng/);
    assert.doesNotMatch(text, /không ai đạt được mục tiêu/);
    await view.unmount();
  });

  it("hoà mà KHÔNG ai thắng cá nhân: vẫn 'Ván đấu hoà', và câu giải thích nói thẳng", async () => {
    // Nhánh còn lại của `drawNote`. Nhãn hero không đổi theo sổ riêng - nó nói
    // về kết cục của ván, và kết cục đó là hoà trong cả hai trường hợp.
    const view = await mountGameOver({ ...draw(), personalWins: [] });
    const text = view.text();

    assert.match(text, /Ván đấu hoà/);
    assert.match(text, /không ai đạt được mục tiêu/);
    assert.doesNotMatch(text, /Thắng cá nhân/);
    await view.unmount();
  });

  it("chính Thằng Hề trong ván hoà đó vẫn đọc 'Bạn thắng'", async () => {
    const view = await mountGameOver({
      ...draw(),
      you: { id: "jester", name: "Hề", ready: false, connected: true, role: "JESTER", alive: false },
    });
    assert.match(view.text(), /Bạn thắng/);
    await view.unmount();
  });
});

// ---------------------------------------------------------------------------
// Lịch sử trận
// ---------------------------------------------------------------------------

function historyEntry(over: Partial<MatchHistoryEntry> = {}): MatchHistoryEntry {
  return {
    roomCode: "ABCDE",
    winner: "serial_killer",
    rounds: 4,
    durationSec: 300,
    endedAt: Date.UTC(2026, 8, 3, 10, 0, 0),
    myRole: "SERIAL_KILLER",
    mySurvived: true,
    myPersonalWin: null,
    players: [
      { id: "me", name: "Tôi", role: "SERIAL_KILLER", alive: true },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: false },
    ],
    caseFile: null,
    ...over,
  };
}

async function mountHistory(matches: unknown[]) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { MatchHistoryPanel } = await import("./MatchHistoryPanel");

  window.localStorage.setItem(
    IDENTITY_KEY,
    JSON.stringify({ playerId: "me", token: "t".repeat(24), nickname: "Tôi" }),
  );

  const body = JSON.stringify({ matches });
  (globalThis as { fetch?: unknown }).fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => JSON.parse(body),
  });

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(React.createElement(MatchHistoryPanel));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    text: () => host.textContent ?? "",
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("Lịch sử trận · kết cục mới", () => {
  it("ván mình cầm Sát Nhân và thắng hiện THẮNG", async () => {
    /*
     * `match.winner === myTeam` không bao giờ khớp ở đây: phe của vai này là
     * `neutral`, còn kết cục là `serial_killer`. Dòng lịch sử vì thế hiện
     * "Thua" cho đúng ván người chơi vừa thắng.
     */
    const panel = await mountHistory([historyEntry()]);
    assert.match(panel.text(), /Thắng/);
    await panel.unmount();
  });

  it("ván mình cầm Dân Làng mà Sát Nhân thắng hiện THUA", async () => {
    const panel = await mountHistory([
      historyEntry({ myRole: "VILLAGER", mySurvived: false }),
    ]);
    assert.match(panel.text(), /Thua/);
    await panel.unmount();
  });

  it("ván HOÀ không phải một chiến thắng của ai", async () => {
    const panel = await mountHistory([
      historyEntry({ winner: "draw", myRole: "VILLAGER", mySurvived: false }),
    ]);
    assert.match(panel.text(), /Thua/);
    await panel.unmount();
  });

  it("một kết cục bản build này không hiểu vẫn hiện được dòng lịch sử", async () => {
    // `unknown` không phải một kết cục: câu trả lời đúng là "không biết", chứ
    // không phải "thua".
    const panel = await mountHistory([historyEntry({ winner: "unknown" })]);
    const text = panel.text();
    assert.match(text, /Đã chơi/);
    assert.doesNotMatch(text, /Thắng|Thua/);
    await panel.unmount();
  });
});
