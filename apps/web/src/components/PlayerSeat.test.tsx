import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { PlayerView } from "@masoi/shared";

/**
 * Ô người chơi khi có người ĐANG NÓI, mount component thật.
 *
 * Phần luật thuần đã nằm ở `lib/seat-voice.test.ts`. Cái còn lại chỉ nhìn thấy
 * được trong DOM thật, và đó đúng là ba chỗ dễ hỏng nhất:
 *
 *   - quầng sáng phải là một phần tử RIÊNG nằm ngoài khung, `aria-hidden`, và
 *     không nhận chuột - dán nó vào chính nút là nó ăn cả sự kiện bấm;
 *   - viền của nút không được đổi một ký tự nào khi người đó bắt đầu nói;
 *   - trạng thái nói vào TÊN của nút chứ không vào một vùng aria-live, nếu
 *     không thì mỗi lần LiveKit bắn `ActiveSpeakersChanged` là trình đọc màn
 *     hình đọc lại cái tên đó - vài lần mỗi giây.
 */

// happy-dom mặc định `location.href` là "about:blank". `CharacterPortrait`
// dựng <img src="/characters/..."> khi có sheet, và `new URL(src, base)` với
// base "about:blank" ném lỗi ngay trong lúc mount - ra một sự kiện `error` giả
// trước cả khi ảnh kịp tải. Đặt sẵn một origin thật thì URL tương đối hợp lệ.
GlobalRegistrator.register({ url: "http://localhost:3000/" });
// React 19 đòi cờ này thì `act()` mới bao được effect; thiếu nó React chỉ cảnh
// báo rồi bỏ qua, và test sẽ đọc trạng thái ở giữa chừng.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function player(over: Partial<PlayerView> = {}): PlayerView {
  return { id: "p1", name: "Trường", alive: true, isBot: false, ...over };
}

interface SeatOptions {
  selected?: boolean;
  isMe?: boolean;
  disabled?: boolean;
  isSpeaking?: boolean;
  alive?: boolean;
}

async function mountSeat({
  selected = false,
  isMe = false,
  disabled = false,
  isSpeaking = false,
  alive = true,
}: SeatOptions) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { PlayerSeat } = await import("./PlayerSeat");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      React.createElement(PlayerSeat, {
        player: player({ alive }),
        avatar: "hood",
        tint: "rgba(126, 168, 226, 0.16)",
        isMe,
        isHost: false,
        selected,
        disabled,
        isSpeaking,
      }),
    );
  });

  const button = host.querySelector("button");
  assert.ok(button, "ô người chơi phải là một <button>");
  return {
    button,
    halo: host.querySelector(".seat-voice-halo"),
    dot: host.querySelector(".seat-voice-dot"),
    breathe: host.querySelector(".seat-voice-breathe"),
    live: host.querySelector("[aria-live], [role='status']"),
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("PlayerSeat: trạng thái đang nói", () => {
  it("thêm quầng + chấm + nhịp thở, và quầng không nhận chuột", async () => {
    const seat = await mountSeat({ isSpeaking: true });
    assert.ok(seat.halo, "phải có quầng thoại");
    assert.ok(seat.dot, "phải có chấm xanh");
    assert.ok(seat.breathe, "chân dung phải phồng nhẹ theo nhịp");
    assert.equal(seat.halo?.getAttribute("aria-hidden"), "true");
    assert.match(seat.halo?.className ?? "", /pointer-events-none/);
    // Lệch pha riêng của từng người, lấy từ breathOffsetFor qua biến CSS.
    assert.match(seat.button.getAttribute("style") ?? "", /--breath-offset/);
    await seat.cleanup();
  });

  it("im lặng thì không dựng quầng, chấm hay nhịp thở nào", async () => {
    const seat = await mountSeat({ isSpeaking: false });
    assert.equal(seat.halo, null);
    assert.equal(seat.dot, null);
    assert.equal(seat.breathe, null);
    await seat.cleanup();
  });

  it("ô ĐANG CHỌN vẫn giữ nguyên viền đỏ blood khi người đó nói", async () => {
    const silent = await mountSeat({ selected: true });
    const talking = await mountSeat({ selected: true, isSpeaking: true });
    assert.match(silent.button.className, /border-blood-500/);
    assert.equal(talking.button.className, silent.button.className);
    assert.ok(talking.halo, "quầng vẫn phải hiện, chỉ là nó nằm ngoài viền");
    await silent.cleanup();
    await talking.cleanup();
  });

  it("ô CỦA MÌNH vẫn giữ quầng chàm mềm khi đang nói", async () => {
    const silent = await mountSeat({ isMe: true });
    const talking = await mountSeat({ isMe: true, isSpeaking: true });
    assert.match(silent.button.className, /border-indigo-400\/60/);
    assert.equal(talking.button.className, silent.button.className);
    await silent.cleanup();
    await talking.cleanup();
  });

  it("ô ĐÃ CHẾT không sáng, kể cả khi voice báo là đang nói", async () => {
    const seat = await mountSeat({ alive: false, isSpeaking: true });
    assert.equal(seat.halo, null);
    assert.equal(seat.dot, null);
    assert.match(seat.button.className, /border-night-600\/60/);
    await seat.cleanup();
  });

  it("ô ĐANG TẮT không sáng - ô không bấm được không được nổi hơn ô bấm được", async () => {
    const seat = await mountSeat({ disabled: true, isSpeaking: true });
    assert.equal(seat.halo, null);
    assert.equal(seat.dot, null);
    await seat.cleanup();
  });
});

describe("PlayerSeat: trợ năng của trạng thái nói", () => {
  it("nói ra bằng TÊN của nút, và không dựng thêm vùng đọc tự động nào", async () => {
    const quiet = await mountSeat({});
    const talking = await mountSeat({ isSpeaking: true });

    assert.equal(quiet.button.getAttribute("aria-label"), null);
    assert.match(talking.button.getAttribute("aria-label") ?? "", /đang nói/);
    assert.match(talking.button.getAttribute("aria-label") ?? "", /Trường/);

    // Không có huy hiệu phiếu nào ở đây, nên vùng aria-live duy nhất có thể
    // xuất hiện sẽ là vùng do chính trạng thái nói dựng ra - và nó không được
    // phép tồn tại.
    assert.equal(talking.live, null);

    await quiet.cleanup();
    await talking.cleanup();
  });
});

describe("PlayerSeat: chân dung sprite sheet", () => {
  it("người chơi còn sống dựng đúng ảnh sprite sheet của avatar", async () => {
    const seat = await mountSeat({ alive: true });
    const sheetImg = seat.button.querySelector(".character-portrait__sheet");
    assert.ok(sheetImg, "phải có ảnh sprite sheet, không rơi về SVG avatar cũ");
    assert.equal(sheetImg?.getAttribute("src"), "/characters/hood.webp");
    await seat.cleanup();
  });
});
