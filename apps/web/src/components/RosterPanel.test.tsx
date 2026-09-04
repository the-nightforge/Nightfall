import assert from "node:assert/strict";
import { before, describe, it, mock } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, type Phase, type RoomSnapshot } from "@masoi/shared";

/**
 * Cột Người chơi: hàng "đang nói" phải theo ĐÚNG luật voice của server.
 *
 * Bản trước hỏi thẳng `speakers.has(player.id)`, tức tin LiveKit thay cho luật
 * ván. LiveKit báo về theo mức âm lượng: nó không biết ai vừa chết, cũng không
 * biết đang là đêm. Hai hệ quả, và cả hai đều rơi vào đúng việc duy nhất của
 * cột này - tra ai còn sống:
 *
 *   - một người vừa chết còn ngồi trong room và còn thở vào mic thì hàng của
 *     họ sáng lên như người đang phát biểu;
 *   - giữa đêm, khi luật cấm mọi người nói, một khe hở giữa lúc server thu
 *     quyền và lúc SDK cập nhật cũng đủ để một hàng sáng.
 *
 * Nên bộ test này mount cột thật và bơm thẳng danh sách "đang nói" của LiveKit
 * vào - kể cả những danh sách mà server sẽ không bao giờ cho phép - rồi đòi cột
 * phải tự lọc.
 */

GlobalRegistrator.register();
// React 19 đòi cờ này thì `act()` mới bao được effect.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Danh sách LiveKit đang báo. Test đổi biến này rồi mới mount.
 *
 * Phải là một biến ngoài chứ không phải giá trị chốt lúc cài mock:
 * `mock.module` chỉ cài được MỘT lần cho cả file.
 */
let liveSpeakers: ReadonlySet<string> = new Set();

/*
 * Cùng lý do và cùng cách xử lý với `mockModule` trong `TrialStage.test.tsx` -
 * xem chú thích dài ở đó: Node 20/22 đọc `namedExports`, Node 24 đổi sang
 * `exports` và ném nếu nhận cả hai. Nên THỬ cả hai trước rồi mới lui về một.
 */
const mockModule = async (specifier: string, exports: Record<string, unknown>) => {
  const tracker = mock as unknown as {
    module: (s: string, o: Record<string, unknown>) => Promise<unknown>;
  };
  try {
    return await tracker.module(specifier, { exports, namedExports: exports });
  } catch {
    return tracker.module(specifier, { exports });
  }
};

before(async () => {
  /*
   * Thay `useSpeakers` chứ không dựng `VoiceProvider` thật: provider thật sẽ
   * kéo theo SDK LiveKit và một socket, trong khi thứ cần kiểm ở đây chỉ là
   * "cột làm gì với danh sách nhận được".
   *
   * Đường dẫn phải là URL TUYỆT ĐỐI - Node phân giải specifier tương đối của
   * `mock.module` theo điểm vào tiến trình, không theo file gọi.
   */
  await mockModule(new URL("./VoiceProvider.tsx", import.meta.url).href, {
    useSpeakers: () => liveSpeakers,
  });
});

function snapshot(phase: Phase, over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ROSTR",
    hostId: "alive1",
    phase,
    config: DEFAULT_ROOM_CONFIG,
    round: 2,
    phaseEndsAt: null,
    serverNow: 0,
    you: { id: "alive1", name: "Trường", ready: false, connected: true, alive: true },
    players: [
      { id: "alive1", name: "Trường", alive: true, isBot: false },
      { id: "alive2", name: "Hạnh", alive: true, isBot: false },
      { id: "ghost", name: "Ma", alive: false, isBot: false },
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
  };
}

interface Row {
  glowing: boolean;
  /** Có nhãn chữ "đang nói" cho trình đọc màn hình không. */
  labelled: boolean;
}

async function mountRoster(phase: Phase, speaking: string[]) {
  liveSpeakers = new Set(speaking);

  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { RosterPanel } = await import("./RosterPanel");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const snap = snapshot(phase);
  await act(async () => {
    root.render(React.createElement(RosterPanel, { snapshot: snap }));
  });

  const items = [...host.querySelectorAll("li")];
  assert.equal(items.length, snap.players.length, "mỗi người chơi một hàng");

  const rows: Record<string, Row> = {};
  snap.players.forEach((player, index) => {
    const li = items[index];
    rows[player.id] = {
      // Nền + vòng emerald là dấu hiệu "đang nói" hiện có; test khoá đúng nó
      // để một lần đổi nguồn boolean không kéo theo đổi cả hình.
      glowing: /emerald/.test(li.className),
      labelled: [...li.querySelectorAll(".sr-only")].some((el) =>
        (el.textContent ?? "").includes("đang nói"),
      ),
    };
  });

  return {
    rows,
    /** Không được có vùng đọc tự động nào cho trạng thái nói. */
    liveRegions: host.querySelectorAll("[aria-live]").length,
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("RosterPanel: hàng đang nói", () => {
  it("đúng pha, người còn sống -> sáng và có nhãn chữ", async () => {
    const view = await mountRoster("DAY_DISCUSSION", ["alive2"]);
    assert.equal(view.rows.alive2.glowing, true);
    assert.equal(view.rows.alive2.labelled, true);
    // Người không nói thì không sáng, để chắc là cột không sáng cả loạt.
    assert.equal(view.rows.alive1.glowing, false);
    assert.equal(view.rows.alive1.labelled, false);
    await view.cleanup();
  });

  it("người ĐÃ CHẾT thì không sáng, dù LiveKit vẫn báo là đang nói", async () => {
    const view = await mountRoster("DAY_DISCUSSION", ["ghost"]);
    assert.equal(view.rows.ghost.glowing, false);
    assert.equal(view.rows.ghost.labelled, false);
    await view.cleanup();
  });

  /*
   * Ba pha này là toàn bộ khoảng thời gian mà không ai được nói: `voiceCanPublish`
   * chỉ mở cho NIGHT_RESULT trở đi, còn NIGHT / ROLE_REVEAL / HUNTER_SHOT thì
   * đóng với cả người sống.
   */
  for (const phase of ["NIGHT", "ROLE_REVEAL", "HUNTER_SHOT"] as const) {
    it(`pha ${phase}: không ai được nói nên không hàng nào sáng`, async () => {
      const view = await mountRoster(phase, ["alive1", "alive2", "ghost"]);
      for (const id of ["alive1", "alive2", "ghost"]) {
        assert.equal(view.rows[id].glowing, false, `${id} không được sáng ở ${phase}`);
        assert.equal(view.rows[id].labelled, false);
      }
      await view.cleanup();
    });
  }

  it("LOBBY: ai cũng được nói, kể cả hàng của chính mình", async () => {
    const view = await mountRoster("LOBBY", ["alive1"]);
    assert.equal(view.rows.alive1.glowing, true);
    assert.equal(view.rows.alive1.labelled, true);
    await view.cleanup();
  });

  it("không dựng vùng aria-live nào cho trạng thái nói", async () => {
    const view = await mountRoster("DAY_DISCUSSION", ["alive2"]);
    assert.equal(view.liveRegions, 0);
    await view.cleanup();
  });

  it("không ai nói thì cột giữ nguyên hình dạng cũ", async () => {
    const view = await mountRoster("DAY_DISCUSSION", []);
    for (const id of ["alive1", "alive2", "ghost"]) {
      assert.equal(view.rows[id].glowing, false);
      assert.equal(view.rows[id].labelled, false);
    }
    await view.cleanup();
  });
});
