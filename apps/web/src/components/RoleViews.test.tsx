import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";

/**
 * Thẻ vai là NHẤN GIỮ ĐỂ NHÌN, không phải mở một lần rồi thôi.
 *
 * Đây là lý do bộ test này mount component thật thay vì kiểm một hàm thuần:
 * cái sai cũ không nằm trong logic nào cả, nó nằm ở chỗ `revealed` một khi đã
 * bật thì không có đường nào tắt. Người chơi lật thẻ, đặt điện thoại xuống
 * bàn, và bí mật của họ nằm ngửa trên màn hình cho tới hết ván.
 *
 * Nên mọi đường TẮT đều được khoá lại ở đây:
 *
 *   - thả tay (`pointerup`, kể cả khi nó rơi ra ngoài nút) - đường thường gặp;
 *   - thả phím Space/Enter - cùng một luật cho người không dùng chuột;
 *   - `visibilitychange -> hidden` - chuyển app, khoá máy, có cuộc gọi đến;
 *   - `window blur` - bấm sang cửa sổ khác mà tay vẫn đang giữ.
 *
 * Và một thứ được khoá ở chiều ngược lại: phần "đồng bọn của bạn" phải RỜI
 * KHỎI DOM khi úp lại, chứ không phải chỉ ẩn đi bằng CSS. Một danh sách Sói
 * còn nằm trong DOM là một danh sách còn đọc được bằng devtools, bằng trình
 * đọc màn hình, và bằng ảnh chụp toàn trang.
 */

GlobalRegistrator.register();
// React 19 đòi cờ này thì `act()` mới bao được effect; thiếu nó React chỉ cảnh
// báo rồi bỏ qua, và test sẽ đọc trạng thái ở giữa chừng.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "PEEK1",
    hostId: "wolf",
    phase: "ROLE_REVEAL",
    config: { ...DEFAULT_ROOM_CONFIG, werewolves: 2 },
    round: 1,
    phaseEndsAt: null,
    serverNow: 0,
    you: {
      id: "wolf",
      name: "Sói Cả",
      ready: false,
      connected: true,
      role: "WEREWOLF",
      alive: true,
    },
    players: [
      { id: "wolf", name: "Sói Cả", alive: true, isBot: false, role: "WEREWOLF" },
      { id: "wolf2", name: "Sói Em", alive: true, isBot: false, role: "WEREWOLF" },
      { id: "villager", name: "Dân Đen", alive: true, isBot: false },
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
    executioner: null,
    chatLog: [],
    log: [],
    ...over,
  };
}

/**
 * Mount `RoleRevealView` thật và trả về đúng những thứ cần để hỏi "đang ngửa
 * hay đang úp": chữ trong DOM, `aria-pressed` của nút, và một hàm bắn sự kiện.
 */
async function mountReveal(view: RoomSnapshot = snapshot()) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { RoleRevealView } = await import("./RoleViews");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(React.createElement(RoleRevealView, { snapshot: view })));

  const button = host.querySelector("button");
  assert.ok(button, "phải có nút thẻ úp");
  // Tìm mặt ngửa bằng đúng cái định nghĩa ra nó - phép xoay 180 độ - chứ không
  // bằng một `data-testid` chỉ tồn tại vì test.
  const back = host.querySelector('[class*="rotateY(180deg)"]');
  assert.ok(back, "phải có mặt ngửa của thẻ");

  return {
    button,
    text: () => host.textContent ?? "",
    /** `aria-pressed` là hợp đồng với trình đọc màn hình, không phải trang trí. */
    pressed: () => button.getAttribute("aria-pressed"),
    /** `aria-hidden` của mặt ngửa: thẻ úp thì trình đọc màn hình phải bỏ qua nó. */
    backHidden: () => back.getAttribute("aria-hidden"),
    fire: (event: Event, target: EventTarget = button) =>
      act(async () => {
        target.dispatchEvent(event);
      }),
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

const pointer = (type: string) => new PointerEvent(type, { bubbles: true, cancelable: true });
const key = (type: string, k: string, repeat = false) =>
  new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, repeat });

/** Đặt `document.visibilityState` rồi mới báo cho trang - đúng thứ tự của trình duyệt. */
async function goHidden(fire: (event: Event, target?: EventTarget) => Promise<void>) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  await fire(new Event("visibilitychange"), document);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
}

describe("RoleRevealView - nhấn giữ để nhìn", () => {
  it("chưa chạm thì mời NHẤN GIỮ, và không có gì bí mật trong DOM", async () => {
    const view = await mountReveal();

    assert.match(view.text(), /Nhấn giữ để xem, thả ra để úp lại/);
    assert.match(view.text(), /Không ai khác được nhìn thấy/);
    assert.equal(view.pressed(), "false");
    // Nhãn cũ hứa một hành vi mà nút không còn làm nữa.
    assert.doesNotMatch(view.text(), /Chạm để xem/);
    assert.doesNotMatch(view.text(), /Đồng bọn của bạn/);
    assert.doesNotMatch(view.text(), /Sói Em/);

    /*
     * Cố ý KHÔNG assert `doesNotMatch(/Ma Sói/)`: mặt ngửa vẫn nằm trong DOM
     * lúc úp, vì bố cục lật cần cả hai mặt cùng tồn tại - unmount `RoleCard`
     * thì cú lật về 180→0 (0.62s) chạy trên một mặt rỗng.
     *
     * Nên ranh giới là thế này: mặt ngửa ở lại DOM nhưng bị khoá khỏi cây
     * accessibility (`aria-hidden`, khẳng định ngay dưới), còn thứ PHẢI rời
     * khỏi DOM là ba khối bí mật đi kèm - đồng bọn Sói, `CursedNote`, và cảnh
     * báo 🔒.
     */
    assert.equal(view.backHidden(), "true", "thẻ úp thì mặt ngửa phải câm với screen reader");

    await view.unmount();
  });

  it("nhấn giữ thì ngửa thẻ vai và hiện đồng bọn Sói", async () => {
    const view = await mountReveal();

    await view.fire(pointer("pointerdown"));
    const text = view.text();

    assert.equal(view.pressed(), "true");
    // Đang giữ thì mặt ngửa trở lại cây accessibility - người dùng screen
    // reader nghe được đúng thứ người dùng mắt thường đang nhìn.
    assert.equal(view.backHidden(), "false");
    // Mặt ngửa là thẻ vai thật, không phải một chỗ giữ chỗ.
    assert.match(text, /Ma Sói/);
    assert.match(text, /Đồng bọn của bạn/);
    assert.match(text, /Sói Em/);
    // Không lộ người ngoài bầy.
    assert.doesNotMatch(text, /Dân Đen/);
    // Cảnh báo bảo mật đi cùng mặt ngửa, không phải mặt úp.
    assert.match(text, /Đây là thông tin chỉ mình bạn có/);

    await view.unmount();
  });

  it("thả tay là úp lại NGAY, và danh sách Sói rời khỏi DOM", async () => {
    const view = await mountReveal();

    await view.fire(pointer("pointerdown"));
    assert.match(view.text(), /Sói Em/);

    await view.fire(pointer("pointerup"));

    assert.equal(view.pressed(), "false");
    // Kiểm trên textContent chứ không phải trên một class CSS: yêu cầu là
    // "không còn trong DOM", không phải "không nhìn thấy".
    assert.doesNotMatch(view.text(), /Đồng bọn của bạn/);
    assert.doesNotMatch(view.text(), /Sói Em/);
    assert.doesNotMatch(view.text(), /Đây là thông tin chỉ mình bạn có/);

    await view.unmount();
  });

  it("kéo tay ra khỏi thẻ cũng tính là thả tay", async () => {
    const view = await mountReveal();

    await view.fire(pointer("pointerdown"));
    // Bắn `pointerout` chứ không phải `pointerleave`: `pointerleave` không nổi
    // bọt, nên React không nghe nó ở gốc cây mà tự dựng `onPointerLeave` từ
    // cặp `pointerover`/`pointerout`. Bắn thẳng `pointerleave` là test một sự
    // kiện mà trình duyệt thật không bao giờ giao tới handler này.
    await view.fire(pointer("pointerout"));

    assert.equal(view.pressed(), "false");
    await view.unmount();
  });

  it("pointercancel - hệ điều hành cướp cử chỉ giữa chừng - cũng úp lại", async () => {
    const view = await mountReveal();

    await view.fire(pointer("pointerdown"));
    await view.fire(pointer("pointercancel"));

    assert.equal(view.pressed(), "false");
    await view.unmount();
  });

  it("thả tay ngoài nút vẫn úp lại - mặt úp đã quay lưng, không bắt được pointerup", async () => {
    // Đây là cái bẫy thật của bố cục lật 3D: sau khi lật, `backface-visibility`
    // làm nút biến mất khỏi hit-test ở một số trình duyệt, nên `pointerup`
    // không bao giờ về tới handler trên nút. Thiếu lưới ở `window`, thẻ nằm
    // ngửa vĩnh viễn - đúng cái hành vi vừa bị bỏ đi.
    const view = await mountReveal();

    await view.fire(pointer("pointerdown"));
    assert.equal(view.pressed(), "true");

    await view.fire(pointer("pointerup"), window);

    assert.equal(view.pressed(), "false");
    assert.doesNotMatch(view.text(), /Sói Em/);
    await view.unmount();
  });
});

describe("RoleRevealView - bàn phím và các đường tắt tự động", () => {
  it("giữ Space thì ngửa, thả Space thì úp", async () => {
    const view = await mountReveal();

    await view.fire(key("keydown", " "));
    assert.equal(view.pressed(), "true");
    assert.match(view.text(), /Sói Em/);

    await view.fire(key("keyup", " "));
    assert.equal(view.pressed(), "false");
    assert.doesNotMatch(view.text(), /Sói Em/);

    await view.unmount();
  });

  it("Enter theo đúng luật của Space - giữ mới thấy", async () => {
    const view = await mountReveal();

    await view.fire(key("keydown", "Enter"));
    assert.equal(view.pressed(), "true");

    await view.fire(key("keyup", "Enter"));
    assert.equal(view.pressed(), "false");

    await view.unmount();
  });

  it("Space chặn hành vi mặc định, phím khác thì không đụng vào", async () => {
    const view = await mountReveal();

    const down = key("keydown", " ");
    await view.fire(down);
    assert.equal(down.defaultPrevented, true, "để lọt Space là để nó cuộn trang");

    // Tab phải còn rời được khỏi nút - không bẫy focus ở đây.
    const tab = key("keydown", "Tab");
    await view.fire(tab);
    assert.equal(tab.defaultPrevented, false);
    assert.equal(view.pressed(), "true", "Tab không phải phím úp thẻ");

    await view.unmount();
  });

  it("giữ lâu (keydown repeat) không bật lại thứ đang bật", async () => {
    const view = await mountReveal();

    await view.fire(key("keydown", " "));
    await view.fire(key("keydown", " ", true));
    assert.equal(view.pressed(), "true");

    await view.fire(key("keyup", " "));
    assert.equal(view.pressed(), "false");

    await view.unmount();
  });

  it("chuyển sang app khác (visibilitychange -> hidden) thì úp lại", async () => {
    const view = await mountReveal();

    await view.fire(pointer("pointerdown"));
    assert.equal(view.pressed(), "true");

    await goHidden(view.fire);

    assert.equal(view.pressed(), "false");
    assert.doesNotMatch(view.text(), /Đồng bọn của bạn/);
    await view.unmount();
  });

  it("cửa sổ mất focus thì úp lại", async () => {
    const view = await mountReveal();

    await view.fire(pointer("pointerdown"));
    await view.fire(new Event("blur"), window);

    assert.equal(view.pressed(), "false");
    await view.unmount();
  });

  it("menu giữ lâu của di động bị chặn, và thẻ úp lại", async () => {
    const view = await mountReveal();

    await view.fire(pointer("pointerdown"));
    const menu = pointer("contextmenu");
    await view.fire(menu);

    assert.equal(menu.defaultPrevented, true, "để lọt menu là để nó che mất thẻ đang ngửa");
    assert.equal(view.pressed(), "false");
    await view.unmount();
  });

  it("không phải Sói thì ngửa thẻ cũng không có khối đồng bọn", async () => {
    const view = await mountReveal(
      snapshot({
        you: {
          id: "villager",
          name: "Dân Đen",
          ready: false,
          connected: true,
          role: "VILLAGER",
          alive: true,
        },
      }),
    );

    await view.fire(pointer("pointerdown"));

    assert.equal(view.pressed(), "true");
    assert.match(view.text(), /Đây là thông tin chỉ mình bạn có/);
    assert.doesNotMatch(view.text(), /Đồng bọn của bạn/);

    await view.unmount();
  });
});
