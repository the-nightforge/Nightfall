import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Chân dung nhân vật, MOUNT COMPONENT THẬT.
 *
 * Phần luật thuần đã nằm ở `lib/character-portrait.test.ts`. Ở đây chỉ giữ ba
 * thứ chỉ nhìn thấy được trong DOM:
 *
 *   - chưa có sheet thì phải ra đúng cái <svg> cũ, không phải một ô trống;
 *   - ảnh hỏng giữa chừng thì phải rơi về <svg>, không để lại khung rỗng;
 *   - lệch pha nháy mắt phải nằm trên chính phần tử chân dung, vì nhiều nơi gọi
 *     không đặt --breath-offset ở cha.
 */

// happy-dom mặc định location là "about:blank": mọi `<img src="/...">` (đường
// dẫn tương đối) sẽ không dựng nổi URL và bắn `error` NGAY LẬP TỨC, trước khi
// test kịp đọc DOM - không liên quan gì tới component. Chưa test nào trong repo
// này render <img> với đường dẫn tương đối nên chưa ai đụng phải. Gắn một origin
// thật để new URL(src, location.href) dựng được bình thường.
GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountOptions {
  avatar?: string;
  alive?: boolean;
  speaking?: boolean;
  isCustom?: boolean;
  breathOffset?: number;
}

async function mountPortrait({
  avatar = "hood",
  alive = true,
  speaking = false,
  isCustom = false,
  breathOffset = 0.5,
}: MountOptions = {}) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { CharacterPortrait } = await import("./CharacterPortrait");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      React.createElement(CharacterPortrait, {
        avatar,
        tint: "rgba(126, 168, 226, 0.16)",
        alive,
        speaking,
        isCustom,
        breathOffset,
      }),
    );
  });

  return {
    host,
    svg: host.querySelector("svg"),
    sheet: host.querySelector(".character-portrait__sheet"),
    shell: host.querySelector(".character-portrait"),
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("CharacterPortrait", () => {
  it("nhân vật không có trong bảng sheet thì hiện bóng SVG cũ", async () => {
    // Không có AvatarId nào rơi vào đây nữa (cả 16 đều có sheet), nhưng đường
    // lui vẫn phải sống: một id lạ lọt vào từ snapshot cũ không được làm trống ô.
    const view = await mountPortrait({ avatar: "khong-ton-tai" });
    assert.ok(view.svg, "phải rơi về <svg> khi không tra được sheet");
    assert.equal(view.sheet, null, "không được dựng khung sheet khi không có sheet");
    await view.cleanup();
  });

  it("ảnh người chơi tự tải lên vẫn đi đường <img> cũ", async () => {
    const view = await mountPortrait({
      avatar: "https://example.com/me.png",
      isCustom: true,
    });
    const img = view.host.querySelector("img");
    assert.ok(img, "ảnh tự tải lên phải là một <img>");
    assert.equal(view.sheet, null, "ảnh tự tải lên không có sheet để hoán frame");
    await view.cleanup();
  });

});

/**
 * Nhánh CÓ sheet.
 *
 * `hood` có sheet thật trong `public/characters/`, nên không cần chèn tay gì cả.
 */
describe("CharacterPortrait khi đã có sheet", () => {
  it("dựng khung sheet và gắn class theo chế độ", async () => {
    const view = await mountPortrait({ speaking: true });
    assert.ok(view.sheet, "phải dựng <img> sheet");
    assert.equal(view.sheet!.getAttribute("src"), "/characters/hood.webp");
    assert.ok(
      view.shell!.classList.contains("is-talking"),
      `đang nói phải ra class is-talking, đang là "${view.shell!.className}"`,
    );
    assert.equal(view.svg, null, "có sheet rồi thì không dựng thêm <svg>");
    await view.cleanup();
  });

  it("người chết ra class is-dead dù caller nói họ đang nói", async () => {
    const view = await mountPortrait({ alive: false, speaking: true });
    assert.ok(view.shell!.classList.contains("is-dead"));
    await view.cleanup();
  });

  it("KHÔNG gắn has-variants khi sheet chưa có biến thể thật", async () => {
    // Đây là cái chặn mười lăm ô chạy animation vĩnh viễn để đổi sang một bức
    // ảnh y hệt. Ngày nào sheet có biến thể thật thì test này phải được sửa
    // cùng lúc với cờ trong character-art.ts - và đó là ý đồ.
    const view = await mountPortrait();
    assert.equal(
      view.shell!.classList.contains("has-variants"),
      false,
      "bộ art hiện tại chưa có biến thể, không được bật animation",
    );
    await view.cleanup();
  });

  it("đặt --breath-offset lên chính phần tử chân dung", async () => {
    // PlayerSeat đặt biến này ở nút cha, nhưng RosterPanel và GameOverView thì
    // không. Đặt tại chỗ thì nháy mắt lệch pha ở MỌI nơi gọi - kể cả sau này,
    // khi has-variants được bật.
    const view = await mountPortrait({ breathOffset: 0.5 });
    assert.match(
      view.shell!.getAttribute("style") ?? "",
      /--breath-offset:\s*0\.5/,
      "thiếu lệch pha nháy mắt trên phần tử chân dung",
    );
    await view.cleanup();
  });

  it("ảnh hỏng thì rơi về SVG, không để lại khung rỗng", async () => {
    const { act } = await import("react");
    const view = await mountPortrait();
    assert.ok(view.sheet, "phải bắt đầu bằng nhánh sheet");
    // Một file 404 sẽ 404 lại, nên component không được thử lại.
    await act(async () => {
      view.sheet!.dispatchEvent(new Event("error"));
    });
    // Đọc lại từ host chứ không dùng view.svg: view.svg chụp lúc mount, còn
    // cây DOM đã render lại sau sự kiện lỗi.
    assert.ok(view.host.querySelector("svg"), "sau lỗi ảnh phải hiện <svg>");
    assert.equal(
      view.host.querySelector(".character-portrait__sheet"),
      null,
      "không được giữ lại khung sheet sau khi ảnh hỏng",
    );
    await view.cleanup();
  });
});
