import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { KillSceneView } from "@/lib/kill-cinematic";

/**
 * Cảnh kill, MOUNT COMPONENT THẬT.
 *
 * Phần luật thuần - ai lên hình, cắt ở mấy người, chữ nói gì - đã nằm ở
 * `lib/kill-cinematic.test.ts`. Ở đây chỉ giữ những thứ chỉ nhìn thấy được
 * trong DOM, và tất cả đều là những thứ SAI thì hỏng cả tính năng:
 *
 *   - khuôn mặt phải là khuôn mặt của đúng nạn nhân;
 *   - kẻ tấn công phải vô danh: không tên, không vai, không nhãn nào cho trình
 *     đọc màn hình;
 *   - người thứ tư trở đi không được biến mất khỏi màn hình;
 *   - tiêu đề phải mang đúng id mà lớp phủ trỏ `aria-labelledby` vào.
 */

// happy-dom mặc định location là "about:blank", nên `<img src="/...">` bắn
// `error` ngay trước khi test kịp đọc DOM. Cùng lý do với CharacterPortrait.test.
GlobalRegistrator.register({ url: "http://localhost:3000/" });
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function victims(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    name: `Người ${i + 1}`,
    avatarUrl: null,
  }));
}

async function mountScene(view: KillSceneView) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { KillScene } = await import("./KillScene");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(KillScene, { view, titleId: "cine-title-x" }));
  });
  return {
    host,
    text: host.textContent ?? "",
    /*
     * Tháo cây React nhưng GIỮ `host` lại để khẳng định được trên nó.
     *
     * `node:test` chạy các suite song song, nên mọi phép đếm trên `document`
     * đều nhìn thấy cả DOM của test khác đang chạy dở. Cái duy nhất khẳng định
     * được chắc chắn là cái hộp của chính lần mount này.
     */
    unmount: async () => {
      await act(async () => root.unmount());
      const leftover = host.innerHTML;
      host.remove();
      return leftover;
    },
  };
}

const night = (count: number): KillSceneView => ({
  mode: "NIGHT",
  victims: victims(Math.min(count, 3)),
  total: count,
  overflow: Math.max(0, count - 3),
});

const execution = (name = "Bị Cáo"): KillSceneView => ({
  mode: "EXECUTION",
  victims: [{ playerId: "p9", name, avatarUrl: null }],
  total: 1,
  overflow: 0,
});

describe("KillScene: khuôn mặt nạn nhân", () => {
  it("in đúng tên của từng người lên hình", async () => {
    const scene = await mountScene(night(2));
    assert.ok(scene.text.includes("Người 1"), scene.text);
    assert.ok(scene.text.includes("Người 2"), scene.text);
    await scene.unmount();
  });

  it("dựng đúng một khung chân dung cho mỗi nạn nhân lên hình", async () => {
    const scene = await mountScene(night(3));
    assert.equal(scene.host.querySelectorAll("[data-kill-portrait]").length, 3);
    await scene.unmount();
  });

  it("cảnh treo dùng chân dung của chính người bị treo", async () => {
    const scene = await mountScene(execution("Bị Cáo"));
    assert.equal(scene.host.querySelectorAll("[data-kill-portrait]").length, 1);
    assert.ok(scene.text.includes("Bị Cáo"), scene.text);
    await scene.unmount();
  });
});

describe("KillScene: kẻ tấn công vô danh", () => {
  it("bóng người không mang tên, không mang vai, và ẩn khỏi trình đọc màn hình", async () => {
    const scene = await mountScene(night(1));
    const attacker = scene.host.querySelector("[data-kill-attacker]");
    assert.ok(attacker, "cảnh đêm phải có một bóng người");
    assert.equal(attacker!.getAttribute("aria-hidden"), "true");
    assert.equal(attacker!.textContent, "");
    for (const attr of ["aria-label", "title", "alt"]) {
      assert.equal(attacker!.getAttribute(attr), null, attr);
    }
    await scene.unmount();
  });

  it("không một chữ nào trong cảnh đêm gợi ra nguồn sát thương", async () => {
    const scene = await mountScene(night(2));
    const html = scene.host.innerHTML;
    for (const word of [
      "Sói",
      "Sát Nhân",
      "Phù Thuỷ",
      "Phù Thủy",
      "Thợ Săn",
      "Linh Mục",
      "Bảo Vệ",
      "độc",
      "cắn",
      "đâm",
      "dao",
    ]) {
      assert.equal(html.includes(word), false, word);
    }
    await scene.unmount();
  });

  it("cảnh treo KHÔNG mượn bóng người của cảnh đêm", async () => {
    // Treo cổ là hành động CÔNG KHAI của cả làng: kẻ thi hành không phải một bí
    // mật, nên ở đây không có ai để giấu. Dùng lại bóng vô danh sẽ kể sai
    // chuyện vừa xảy ra.
    const scene = await mountScene(execution());
    assert.equal(scene.host.querySelector("[data-kill-attacker]"), null);
    await scene.unmount();
  });
});

describe("KillScene: nhiều nạn nhân", () => {
  it("người thứ tư trở đi gộp thành một chip đếm, không biến mất", async () => {
    const scene = await mountScene(night(6));
    assert.equal(scene.host.querySelectorAll("[data-kill-portrait]").length, 3);
    assert.ok(scene.text.includes("+3"), scene.text);
    await scene.unmount();
  });

  it("vừa đủ ba người thì không có chip nào", async () => {
    const scene = await mountScene(night(3));
    assert.equal(scene.host.querySelector("[data-kill-overflow]"), null);
    await scene.unmount();
  });
});

describe("KillScene: trình đọc màn hình và vòng đời", () => {
  it("tiêu đề mang đúng id mà lớp phủ trỏ vào", async () => {
    const scene = await mountScene(night(1));
    const title = scene.host.querySelector("#cine-title-x");
    assert.ok(title, "phải có phần tử mang id của lớp phủ");
    assert.ok((title!.textContent ?? "").includes("Người 1"), title!.textContent ?? "");
    await scene.unmount();
  });

  it("tháo ra là sạch: không để lại node nào", async () => {
    // Cảnh này không có timer, không có rAF, không có canvas - toàn bộ nhịp
    // diễn nằm trong CSS. Nên "tháo sạch" ở đây không phải một phép lịch sự:
    // nó là bằng chứng rằng không còn gì sống sót sau khi lớp phủ đóng lại.
    const scene = await mountScene(night(3));
    assert.equal(await scene.unmount(), "");
  });
});
