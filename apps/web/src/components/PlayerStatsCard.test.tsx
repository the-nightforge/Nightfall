import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PlayerStats } from "@masoi/shared";

/**
 * Thẻ "Hồ sơ của bạn": khi nào hiện, hiện gì, và server cũ thì im lặng.
 */

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDENTITY_KEY = "masoi.identity";

function stats(over: Partial<PlayerStats> = {}): PlayerStats {
  return {
    games: 12,
    wins: 7,
    winRate: 7 / 12,
    survived: 5,
    survivalRate: 5 / 12,
    currentStreak: 2,
    bestStreak: 4,
    personalWins: 1,
    byTeam: {
      village: { games: 8, wins: 5 },
      wolves: { games: 3, wins: 1 },
      neutral: { games: 1, wins: 1 },
    },
    byRole: [
      { role: "VILLAGER", games: 5, wins: 3 },
      { role: "SEER", games: 3, wins: 2 },
      { role: "WEREWOLF", games: 3, wins: 1 },
      { role: "JESTER", games: 1, wins: 1 },
    ],
    lastPlayedAt: 1,
    ...over,
  };
}

async function mount(response: { status: number; body?: unknown }, loggedIn = true) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { PlayerStatsCard } = await import("./PlayerStatsCard");

  window.localStorage.clear();
  if (loggedIn) {
    window.localStorage.setItem(
      IDENTITY_KEY,
      JSON.stringify({ playerId: "me", token: "t".repeat(24), nickname: "Tôi" }),
    );
  }
  const calls: string[] = [];
  (globalThis as { fetch?: unknown }).fetch = async (url: string) => {
    calls.push(String(url));
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body ?? {},
    };
  };

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(PlayerStatsCard));
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    host,
    calls,
    text: () => host.textContent ?? "",
    click: async (label: string) => {
      const btn = [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;
      await act(async () => btn.click());
    },
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

before(() => window.localStorage.clear());
after(() => window.localStorage.clear());

describe("PlayerStatsCard", () => {
  it("chưa đăng nhập thì không gọi server và không vẽ gì", async () => {
    const v = await mount({ status: 200, body: { stats: stats() } }, false);
    assert.deepEqual(v.calls, []);
    assert.equal(v.text(), "");
    await v.unmount();
  });

  it("server cũ trả 404 thì im lặng, không hiện lỗi", async () => {
    const v = await mount({ status: 404 });
    assert.equal(v.text(), "");
    await v.unmount();
  });

  it("chưa có ván nào thì ẩn thẻ", async () => {
    const v = await mount({ status: 200, body: { stats: stats({ games: 0 }) } });
    assert.equal(v.text(), "");
    await v.unmount();
  });

  it("có hồ sơ: bốn con số, ba vai thắng tốt nhất, chi tiết thu gọn cho tới khi bấm", async () => {
    const v = await mount({ status: 200, body: { stats: stats() } });
    assert.match(v.calls[0]!, /\/api\/players\/me\/stats$/);
    const text = v.text();
    assert.match(text, /Hồ sơ của bạn/);
    assert.match(text, /12/);
    assert.match(text, /58%/);
    assert.match(text, /kỷ lục 4/);
    assert.match(text, /42%/);
    // Vai thắng tốt nhất theo số thắng: Dân Làng 3, Tiên Tri 2, rồi Thằng Hề 1/1 (100%) trước Ma Sói 1/3.
    const best = [...v.host.querySelectorAll("ul")][0]!.textContent ?? "";
    assert.match(best, /Dân Làng[\s\S]*Tiên Tri[\s\S]*Thằng Hề/);
    assert.doesNotMatch(best, /Ma Sói/);

    const detail = v.host.querySelector<HTMLElement>("#player-stats-detail")!;
    assert.equal(detail.hidden, true);
    await v.click("Chi tiết");
    assert.equal(detail.hidden, false);
    assert.match(detail.textContent ?? "", /Sói[\s\S]*1\/3/);
    assert.match(detail.textContent ?? "", /Thắng cá nhân 1/);
    await v.unmount();
  });
});
