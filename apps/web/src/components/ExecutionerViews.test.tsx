import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  DEFAULT_ROOM_CONFIG,
  type ExecutionerView,
  type PersonalWin,
  type RoomSnapshot,
} from "@masoi/shared";

/**
 * Giao diện của Kẻ Báo Thù, MOUNT COMPONENT THẬT.
 *
 * Ba thứ không kiểm được bằng một hàm thuần: khối nhiệm vụ chỉ hiện cho đúng
 * một người, thẻ vai đổi ngay lúc chuyển vai, và màn kết thúc phân biệt được
 * hai thắng lợi cá nhân khác nhau. Cả ba đều là những chỗ mà một biểu thức ba
 * ngôi viết vội sẽ nói dối chính người vừa chơi ván đó.
 */

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MISSION: ExecutionerView = {
  target: { id: "target", name: "Mục Tiêu", alive: true },
  won: false,
  turnedJester: false,
};

const EXEC_WIN: PersonalWin = {
  playerId: "exec",
  name: "Báo Thù",
  role: "EXECUTIONER",
  condition: "EXECUTIONER_TARGET_LYNCHED",
  round: 2,
};

const JESTER_WIN: PersonalWin = {
  playerId: "jester",
  name: "Hề",
  role: "JESTER",
  condition: "JESTER_LYNCHED",
  round: 3,
};

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "EXEC1",
    hostId: "villager",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 1, executioner: true },
    round: 2,
    phaseEndsAt: null,
    serverNow: 0,
    you: {
      id: "exec",
      name: "Báo Thù",
      ready: false,
      connected: true,
      role: "EXECUTIONER",
      alive: true,
    },
    players: [
      { id: "exec", name: "Báo Thù", alive: true, isBot: false },
      { id: "target", name: "Mục Tiêu", alive: true, isBot: false },
      { id: "villager", name: "Dân", alive: true, isBot: false },
      { id: "wolf", name: "Sói", alive: true, isBot: false },
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
    executioner: MISSION,
    chatLog: [],
    log: [],
    ...over,
  };
}

async function mount(
  render: (React: typeof import("react")) => import("react").ReactElement,
) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(render(React)));

  return {
    text: () => host.textContent ?? "",
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

async function mountMission(view: RoomSnapshot | null) {
  const { ExecutionerMission } = await import("./ExecutionerMission");
  return mount((React) => React.createElement(ExecutionerMission, { snapshot: view }));
}

async function mountRoleCard(role: Parameters<typeof roleOf>[0]) {
  const { RoleCard } = await import("./RoleViews");
  return mount((React) => React.createElement(RoleCard, { role }));
}

/** Chỉ để lấy đúng kiểu tham số của `RoleCard` mà không phải import type riêng. */
function roleOf(role: "EXECUTIONER" | "JESTER" | undefined) {
  return role;
}

async function mountGameOver(view: RoomSnapshot) {
  const { GameOverView } = await import("./GameOverView");
  return mount((React) =>
    React.createElement(GameOverView, {
      snapshot: view,
      isHost: false,
      onReset: () => undefined,
      onLeave: () => undefined,
    }),
  );
}

before(() => {
  window.localStorage.clear();
});

after(() => {
  window.localStorage.clear();
});

describe("Khối nhiệm vụ của Kẻ Báo Thù", () => {
  it("hiện tên mục tiêu và nói rõ điều kiện thắng", async () => {
    const view = await mountMission(snapshot());
    const text = view.text();

    assert.match(text, /Mục Tiêu/);
    assert.match(text, /treo cổ/);
    assert.match(text, /còn sống/);
    await view.unmount();
  });

  it("nói rõ KHÔNG cần chính mình bỏ phiếu kết tội", async () => {
    const view = await mountMission(snapshot());
    assert.match(view.text(), /Không cần chính bạn đề cử hay bỏ phiếu kết tội/);
    await view.unmount();
  });

  it("người khác không có khối này - server gửi null", async () => {
    // Không phải một phép lọc ở client: `snapshot.executioner` đã là `null`
    // trong payload của mọi người khác, và component chỉ hỏi "có nhiệm vụ
    // không". Một tầng lọc thứ hai ở đây là ảo giác an toàn.
    const view = await mountMission(snapshot({ executioner: null }));
    assert.equal(view.text(), "");
    await view.unmount();
  });

  it("mục tiêu đã chết thì nói ra, thay vì để người chơi tự đoán", async () => {
    const view = await mountMission(
      snapshot({
        executioner: {
          target: { id: "target", name: "Mục Tiêu", alive: false },
          won: false,
          turnedJester: false,
        },
      }),
    );
    assert.match(view.text(), /Người này đã chết/);
    await view.unmount();
  });

  it("nhiệm vụ xong thì nói rõ thắng lợi KHÔNG mất đi nữa", async () => {
    const view = await mountMission(
      snapshot({
        executioner: {
          target: { id: "target", name: "Mục Tiêu", alive: false },
          won: true,
          turnedJester: false,
        },
      }),
    );
    const text = view.text();

    assert.match(text, /Nhiệm vụ hoàn thành/);
    // Câu này là lý do khối "đã xong" tồn tại: thiếu nó, người vừa thắng sẽ
    // ngồi lo suốt phần còn lại của ván.
    assert.match(text, /kể cả khi bạn chết sau đó, hay ván kết thúc hoà/);
    await view.unmount();
  });

  it("chuyển vai thì giải thích VÌ SAO thẻ vai vừa đổi", async () => {
    const view = await mountMission(
      snapshot({
        you: {
          id: "exec",
          name: "Báo Thù",
          ready: false,
          connected: true,
          role: "JESTER",
          alive: true,
          executionerTurned: true,
        },
        executioner: {
          target: { id: "target", name: "Mục Tiêu", alive: false },
          won: false,
          turnedJester: true,
        },
      }),
    );
    const text = view.text();

    assert.match(text, /Thằng Hề/);
    assert.match(text, /không phải trên giá treo cổ/);
    assert.match(text, /CHÍNH BẠN bị/);
    await view.unmount();
  });

  it("biến mất ở GAME_OVER - màn kết thúc đã nói đủ", async () => {
    const view = await mountMission(snapshot({ phase: "GAME_OVER", winner: "village" }));
    assert.equal(view.text(), "");
    await view.unmount();
  });
});

describe("Thẻ vai đổi theo vai HIỆN TẠI", () => {
  it("thẻ Kẻ Báo Thù nói đúng luật của nó", async () => {
    const view = await mountRoleCard(roleOf("EXECUTIONER"));
    const text = view.text();

    assert.match(text, /Kẻ Báo Thù/);
    assert.match(text, /Phe Trung lập/);
    assert.match(text, /mục tiêu bí mật/);
    // Đường hoá Hề phải nằm ngay trên thẻ: một người chơi không biết trước điều
    // đó sẽ tưởng mình vừa mất trắng cả ván.
    assert.match(text, /Thằng Hề/);
    await view.unmount();
  });

  it("sau khi chuyển vai, thẻ là thẻ của Thằng Hề", async () => {
    const view = await mountRoleCard(roleOf("JESTER"));
    const text = view.text();

    assert.match(text, /Thằng Hề/);
    assert.doesNotMatch(text, /Kẻ Báo Thù/);
    await view.unmount();
  });
});

describe("Màn kết thúc phân biệt hai thắng lợi cá nhân", () => {
  const ended = (over: Partial<RoomSnapshot> = {}) =>
    snapshot({
      phase: "GAME_OVER",
      winner: "village",
      votesRevealed: true,
      players: [
        { id: "exec", name: "Báo Thù", alive: true, isBot: false, role: "EXECUTIONER" },
        { id: "jester", name: "Hề", alive: false, isBot: false, role: "JESTER" },
        { id: "target", name: "Mục Tiêu", alive: false, isBot: false, role: "VILLAGER" },
        { id: "wolf", name: "Sói", alive: false, isBot: false, role: "WEREWOLF" },
      ],
      personalWins: [EXEC_WIN, JESTER_WIN],
      executioner: null,
      ...over,
    });

  it("nhãn của Kẻ Báo Thù khác hẳn nhãn của Thằng Hề", async () => {
    const view = await mountGameOver(ended());
    const text = view.text();

    assert.match(text, /Kẻ Báo Thù - mục tiêu bị treo cổ/);
    assert.match(text, /Thằng Hề - bị treo cổ/);
    await view.unmount();
  });

  it("Kẻ Báo Thù đọc ra THẮNG dù phe thắng chung là Dân Làng", async () => {
    const view = await mountGameOver(ended());
    const text = view.text();

    assert.match(text, /Phe Dân Làng chiến thắng/);
    assert.match(text, /Bạn thắng/);
    // Và không có câu nào nói cả phe trung lập cùng thắng.
    assert.doesNotMatch(text, /Phe Trung lập chiến thắng/);
    await view.unmount();
  });

  it("người đã hoá Thằng Hề rồi thắng hiện ra là chiến thắng của Hề", async () => {
    const view = await mountGameOver(
      ended({
        you: {
          id: "exec",
          name: "Báo Thù",
          ready: false,
          connected: true,
          role: "JESTER",
          alive: false,
          executionerTurned: true,
        },
        players: [
          {
            id: "exec",
            name: "Báo Thù",
            alive: false,
            isBot: false,
            role: "JESTER",
            executionerTurned: true,
          },
          { id: "target", name: "Mục Tiêu", alive: true, isBot: false, role: "VILLAGER" },
          { id: "wolf", name: "Sói", alive: false, isBot: false, role: "WEREWOLF" },
        ],
        personalWins: [
          {
            playerId: "exec",
            name: "Báo Thù",
            role: "JESTER",
            condition: "JESTER_LYNCHED",
            round: 3,
          },
        ],
      }),
    );
    const text = view.text();

    assert.match(text, /Bạn thắng/);
    assert.match(text, /Thằng Hề - bị treo cổ/);
    assert.doesNotMatch(text, /mục tiêu bị treo cổ/);
    // Vai lúc chia bài vẫn kể lại được, đúng cách Kẻ Nguyền Rủa đã hoá Sói.
    assert.match(text, /Kẻ Báo Thù \(đã hoá Thằng Hề\)/);
    await view.unmount();
  });

  it("ván HOÀ có thắng cá nhân vẫn hiển thị nhất quán", async () => {
    const view = await mountGameOver(
      ended({
        winner: "draw",
        players: [
          { id: "exec", name: "Báo Thù", alive: false, isBot: false, role: "EXECUTIONER" },
          { id: "target", name: "Mục Tiêu", alive: false, isBot: false, role: "VILLAGER" },
          { id: "wolf", name: "Sói", alive: false, isBot: false, role: "WEREWOLF" },
        ],
        personalWins: [EXEC_WIN],
        you: {
          id: "exec",
          name: "Báo Thù",
          ready: false,
          connected: true,
          role: "EXECUTIONER",
          alive: false,
        },
      }),
    );
    const text = view.text();

    // Bản sửa đã có: "Ván đấu hoà" cho người không thắng, "Bạn thắng" cho người
    // có thành tích riêng - và ba khối cạnh nhau không được cãi nhau.
    assert.match(text, /Bạn thắng/);
    assert.match(text, /Kẻ Báo Thù - mục tiêu bị treo cổ/);
    assert.match(text, /vẫn đạt được mục tiêu riêng|một người vẫn đạt được mục tiêu riêng/);
    assert.doesNotMatch(text, /Không phe nào và không ai đạt được mục tiêu/);
    await view.unmount();
  });
});
