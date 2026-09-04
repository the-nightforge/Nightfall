import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";

/**
 * Lớp phủ chuyển cảnh, MOUNT CÂY COMPONENT THẬT.
 *
 * Bộ test này tồn tại vì một lỗi mà không hàm thuần nào thấy được. `cinematicFor`
 * trả về đúng cạnh `EXECUTION`, `killSceneFor` dựng đúng nạn nhân - cả hai đều
 * pass mọi test của mình - nhưng lớp phủ sống 2,2 giây trong khi ván vẫn chạy,
 * và `lastEliminated` chỉ có mặt ở ELIMINATION với CHECK_WIN. Một ván có Thợ Săn
 * đi tiếp sang HUNTER_SHOT trong khoảng đó, và bản đầu - vốn tính lại cảnh từ
 * `snapshot` ở mỗi lần render - đánh rơi khuôn mặt người vừa bị treo ngay giữa
 * cảnh.
 *
 * Nên thứ được khẳng định ở đây là VÒNG ĐỜI: cảnh phải chốt dữ liệu tại cạnh và
 * giữ nguyên tới lúc tự tháo.
 */

GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function snap(patch: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "MOONS",
    hostId: "a",
    phase: "NIGHT",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 2,
    phaseEndsAt: null,
    serverNow: 0,
    you: null,
    players: [
      { id: "p1", name: "An", alive: false, isBot: false },
      { id: "p2", name: "Bình", alive: false, isBot: false },
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
    ...patch,
  };
}

/** Mount lớp phủ rồi bơm lần lượt từng snapshot, đúng cách trang phòng làm. */
async function feed(snapshots: RoomSnapshot[]) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { CinematicOverlay } = await import("./CinematicOverlay");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  for (const snapshot of snapshots) {
    await act(async () => {
      root.render(React.createElement(CinematicOverlay, { snapshot }));
    });
  }

  return {
    host,
    text: () => host.textContent ?? "",
    portraits: () => host.querySelectorAll("[data-kill-portrait]").length,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("CinematicOverlay: cảnh treo cổ", () => {
  it("hiện khuôn mặt người bị treo ở mốc công bố", async () => {
    const view = await feed([
      snap({ phase: "FINAL_VOTE" }),
      snap({ phase: "ELIMINATION", lastEliminated: { playerId: "p1", name: "An" } }),
    ]);
    assert.equal(view.portraits(), 1);
    assert.ok(view.text().includes("An"), view.text());
    assert.ok(view.text().includes("treo cổ"), view.text());
    await view.cleanup();
  });

  it("pha nhảy tiếp giữa cảnh KHÔNG làm nạn nhân biến mất", async () => {
    /*
     * Đây là hồi quy của chính lỗi đã mô tả ở đầu file. Snapshot thứ ba là một
     * snapshot HỢP LỆ: Thợ Săn vừa được trao lượt bắn, và ở đó `lastEliminated`
     * đã bị server dọn đi. Lớp phủ vẫn còn sống thêm hơn một giây nữa.
     */
    const view = await feed([
      snap({ phase: "FINAL_VOTE" }),
      snap({ phase: "ELIMINATION", lastEliminated: { playerId: "p1", name: "An" } }),
      snap({ phase: "HUNTER_SHOT", lastEliminated: null }),
    ]);
    assert.equal(view.portraits(), 1);
    assert.ok(view.text().includes("An"), view.text());
    await view.cleanup();
  });

  it("được tha thì không có cảnh kill nào - cạnh đó vẫn thuộc sân khấu phiên toà", async () => {
    const view = await feed([
      snap({ phase: "FINAL_VOTE" }),
      snap({ phase: "ELIMINATION", lastEliminated: null }),
    ]);
    assert.equal(view.portraits(), 0);
    // Sân khấu sở hữu `VERDICT`, nên lớp phủ không dựng gì cả.
    assert.equal(view.text(), "");
    await view.cleanup();
  });
});

describe("CinematicOverlay: cảnh đêm", () => {
  const deaths = [
    { playerId: "p1", name: "An" },
    { playerId: "p2", name: "Bình" },
  ];

  it("đêm có người chết hiện đủ khuôn mặt và không nói gì về nguyên nhân", async () => {
    const view = await feed([
      snap({ phase: "NIGHT" }),
      snap({ phase: "NIGHT_RESULT", lastNightDeaths: deaths }),
    ]);
    assert.equal(view.portraits(), 2);
    assert.ok(view.text().includes("An"));
    assert.ok(view.text().includes("Bình"));
    for (const word of ["Sói", "Sát Nhân", "Phù Thuỷ", "cắn", "đâm", "độc"]) {
      assert.equal(view.host.innerHTML.includes(word), false, word);
    }
    await view.cleanup();
  });

  it("đêm bình yên vẫn là cảnh bình minh cũ, không có khung chân dung nào", async () => {
    const view = await feed([
      snap({ phase: "NIGHT" }),
      snap({ phase: "NIGHT_RESULT", lastNightDeaths: [] }),
    ]);
    assert.equal(view.portraits(), 0);
    assert.ok(view.text().includes("Trời sáng trên ngôi làng"), view.text());
    await view.cleanup();
  });

  it("resync giữa pha công bố không phát lại cảnh đã xem", async () => {
    const view = await feed([
      snap({ phase: "NIGHT" }),
      snap({ phase: "NIGHT_RESULT", lastNightDeaths: deaths }),
    ]);
    assert.equal(view.portraits(), 2);
    await view.cleanup();

    // Vào phòng ĐÚNG lúc pha công bố: không có cạnh nào để so, nên không phát.
    const late = await feed([snap({ phase: "NIGHT_RESULT", lastNightDeaths: deaths })]);
    assert.equal(late.portraits(), 0);
    assert.equal(late.text(), "");
    await late.cleanup();
  });

  it("một cạnh cho ĐÚNG một lớp phủ: không có tiêu đề chung nào chồng lên cảnh kill", async () => {
    // Khối caption chung của lớp phủ mang id `cine-title-*` và cảnh kill cũng
    // vậy. Hai phần tử cùng một id là một cây DOM sai, và trình đọc màn hình sẽ
    // đọc đúng một cái trong hai mà không ai đoán được là cái nào.
    const view = await feed([
      snap({ phase: "NIGHT" }),
      snap({ phase: "NIGHT_RESULT", lastNightDeaths: deaths }),
    ]);
    const titles = view.host.querySelectorAll('[id^="cine-title-"]');
    assert.equal(titles.length, 1);
    // Và nhãn cảnh chung ("Trời sáng trên ngôi làng") không được lẫn vào đây.
    assert.equal(view.text().includes("Trời sáng trên ngôi làng"), false, view.text());
    await view.cleanup();
  });
});
