import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { LeaderboardEntry, LeaderboardView } from "@masoi/shared";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDENTITY_KEY = "masoi.identity";

function entry(rank: number, playerId: string, nickname: string, points: number): LeaderboardEntry {
  return { rank, playerId, nickname, avatarUrl: null, points, games: 4, wins: 3, winRate: 0.75 };
}

function view(over: Partial<LeaderboardView> = {}): LeaderboardView {
  return {
    entries: [entry(1, "a", "An", 40), entry(2, "me", "Tôi", 34), entry(3, "c", "Chi", 30)],
    me: null,
    myGames: 0,
    windowDays: 30,
    minGames: 3,
    minHumans: 4,
    points: { win: 10, personalWin: 5, survived: 2 },
    generatedAt: 0,
    ...over,
  };
}

async function mount(response: { status: number; body?: unknown }, loggedIn: boolean) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { LeaderboardPanel } = await import("./LeaderboardPanel");

  window.localStorage.clear();
  if (loggedIn) {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify({ playerId: "me", token: "t".repeat(24), nickname: "Tôi" }));
  }
  const headers: Array<Record<string, string>> = [];
  (globalThis as { fetch?: unknown }).fetch = async (_url: string, init?: { headers?: Record<string, string> }) => {
    headers.push(init?.headers ?? {});
    return { ok: response.status < 300, status: response.status, json: async () => response.body ?? {} };
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(LeaderboardPanel));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    host,
    headers,
    text: () => host.textContent ?? "",
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

before(() => window.localStorage.clear());
after(() => window.localStorage.clear());

describe("LeaderboardPanel", () => {
  it("ẩn danh vẫn thấy bảng, không gửi token, không có câu 'của bạn'", async () => {
    const v = await mount({ status: 200, body: view() }, false);
    assert.equal(v.headers[0]!.Authorization, undefined);
    assert.match(v.text(), /Bảng xếp hạng 30 ngày/);
    assert.match(v.text(), /An.*Tôi.*Chi/);
    assert.doesNotMatch(v.text(), /hạng \d+ với/);
    await v.unmount();
  });

  it("đăng nhập và có trên bảng: dòng của mình được đánh dấu, câu đứng hạng", async () => {
    const me = entry(2, "me", "Tôi", 34);
    const v = await mount({ status: 200, body: view({ me, myGames: 4 }) }, true);
    assert.match(v.headers[0]!.Authorization ?? "", /^Bearer /);
    const mine = v.host.querySelector('[aria-current="true"]');
    assert.ok(mine);
    assert.match(mine.textContent ?? "", /Tôi.*\(bạn\)/);
    assert.match(v.text(), /hạng 2 với 34 điểm/);
    await v.unmount();
  });

  it("chưa đủ ván: nói còn bao nhiêu ván", async () => {
    const v = await mount({ status: 200, body: view({ myGames: 2 }) }, true);
    assert.match(v.text(), /còn 1 ván nữa/);
    await v.unmount();
  });

  it("bảng rỗng vẫn hiện với lời mời; server cũ 404 thì ẩn hẳn", async () => {
    const empty = await mount({ status: 200, body: view({ entries: [] }) }, false);
    assert.match(empty.text(), /Chưa ai đủ 3 ván/);
    await empty.unmount();
    const old = await mount({ status: 404 }, false);
    assert.equal(old.text(), "");
    await old.unmount();
  });

  it("cách tính điểm in từ số server gửi", async () => {
    const v = await mount({ status: 200, body: view({ points: { win: 8, personalWin: 4, survived: 1 } }) }, false);
    assert.match(v.text(), /Thắng \+8/);
    await v.unmount();
  });
});
