import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { MatchHistoryEntry } from "@masoi/shared";

/**
 * Bộ test MOUNT COMPONENT THẬT, và nó phải như vậy.
 *
 * Lỗi mà nó sinh ra để chặn không nằm trong một hàm thuần nào: nó nằm ở chỗ
 * `myPersonalWin !== null` đọc `undefined` thành "có thắng cá nhân". Một
 * `undefined` như thế chỉ xuất hiện khi web MỚI nói chuyện với server CŨ - tức
 * là ở đúng đường dữ liệu đi từ `fetch` vào JSX, không ở chỗ nào khác.
 *
 * Vì vậy `fetch` toàn cục mới là thứ bị thay, không phải `fetchMatchHistory`:
 * cả đường đọc API (gồm bước chuẩn hoá ở biên) nằm trong phạm vi kiểm.
 */

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDENTITY_KEY = "masoi.identity";

/** Một ván đã xong, mặc định: người xem là Dân Làng và phe Sói thắng - tức THUA. */
function losingMatch(over: Partial<MatchHistoryEntry> = {}): MatchHistoryEntry {
  return {
    roomCode: "ABCDE",
    winner: "wolves",
    rounds: 3,
    durationSec: 300,
    endedAt: Date.UTC(2026, 8, 3, 10, 0, 0),
    myRole: "VILLAGER",
    mySurvived: false,
    myPersonalWin: null,
    players: [
      { id: "me", name: "Tôi", role: "VILLAGER", alive: false },
      { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true },
    ],
    caseFile: null,
    ...over,
  };
}

/**
 * Mount `MatchHistoryPanel` với đúng payload mà server sẽ trả về.
 *
 * `matches` đi qua `JSON.stringify` rồi `JSON.parse` như một lượt gọi mạng
 * thật, nên một trường mang giá trị `undefined` BIẾN MẤT khỏi payload - đúng
 * hình dạng mà một server cũ gửi lên, và cũng là thứ không thể dựng lại được
 * bằng cách gán `undefined` cho một object trong test.
 */
async function mountPanel(matches: unknown[]) {
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
  // Cho lượt `fetch` (một promise đã resolve) kịp chạy rồi để React xả effect.
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

before(() => {
  // `identity.ts` đọc localStorage; happy-dom có sẵn nhưng phải sạch giữa các ván.
  window.localStorage.clear();
});

after(() => {
  window.localStorage.clear();
});

describe("MatchHistoryPanel · thắng thua theo phe", () => {
  it("Dân Làng thua trước Sói hiện THUA khi server gửi myPersonalWin: null", async () => {
    const panel = await mountPanel([losingMatch()]);
    assert.match(panel.text(), /Thua/);
    assert.doesNotMatch(panel.text(), /Thắng/);
    await panel.unmount();
  });

  it("Dân Làng thua trước Sói vẫn hiện THUA khi server CŨ không gửi trường đó", async () => {
    /*
     * Đây là ca hồi quy.
     *
     * `myPersonalWin !== null` trả về `true` cho `undefined`, nên một ván thua
     * hiện ra là "Thắng" - và nó chỉ xảy ra với server cũ, tức đúng cửa sổ vài
     * phút giữa hai lần deploy mà không ai nhìn màn hình lịch sử.
     */
    const { myPersonalWin: _absent, ...withoutField } = losingMatch();
    const panel = await mountPanel([withoutField]);

    assert.match(panel.text(), /Thua/);
    assert.doesNotMatch(panel.text(), /Thắng/);
    await panel.unmount();
  });

  it("Dân Làng cùng phe với bên thắng hiện THẮNG", async () => {
    const panel = await mountPanel([losingMatch({ winner: "village" })]);
    assert.match(panel.text(), /Thắng/);
    await panel.unmount();
  });
});

describe("MatchHistoryPanel · thắng cá nhân", () => {
  it("Thằng Hề bị treo hiện THẮNG dù phe Sói về nhất", async () => {
    const panel = await mountPanel([
      losingMatch({
        myRole: "JESTER",
        myPersonalWin: { condition: "JESTER_LYNCHED", round: 2 },
        players: [
          {
            id: "me",
            name: "Tôi",
            role: "JESTER",
            alive: false,
            personalWin: { condition: "JESTER_LYNCHED", round: 2 },
          },
          { id: "wolf", name: "Sói", role: "WEREWOLF", alive: true },
        ],
      }),
    ]);

    assert.match(panel.text(), /Thắng/);
    assert.doesNotMatch(panel.text(), /Thua/);
    await panel.unmount();
  });

  it("Thằng Hề sống tới cuối ván hiện THUA", async () => {
    const panel = await mountPanel([
      losingMatch({ myRole: "JESTER", mySurvived: true, myPersonalWin: null }),
    ]);

    assert.match(panel.text(), /Thua/);
    assert.doesNotMatch(panel.text(), /Thắng/);
    await panel.unmount();
  });

  it("điều kiện thắng lạ từ server không làm hàng đó thành THẮNG", async () => {
    // Server mới đã lọc ở `toHistoryEntry`, nhưng web không được phụ thuộc vào
    // việc server ở đầu kia là bản nào - đó chính là bài học của lỗi này.
    const panel = await mountPanel([
      losingMatch({ myPersonalWin: { condition: "KHÔNG_CÓ_THẬT", round: 2 } as never }),
    ]);

    assert.match(panel.text(), /Thua/);
    await panel.unmount();
  });
});
