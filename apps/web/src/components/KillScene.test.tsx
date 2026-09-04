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

function victims(count: number): KillSceneView["victims"] {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    name: `Người ${i + 1}`,
    avatar: "hood" as const,
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
  allVictimNames: Array.from({ length: count }, (_, i) => `Người ${i + 1}`),
});

const execution = (name = "Bị Cáo"): KillSceneView => ({
  mode: "EXECUTION",
  victims: [{ playerId: "p9", name, avatar: "hood", avatarUrl: null }],
  total: 1,
  overflow: 0,
  allVictimNames: [name],
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

  it("dùng ĐÚNG khuôn mặt đã chốt trong model, không tự tính lại", async () => {
    /*
     * Hồi quy của một lỗi thật. Bản đầu gọi lại `assignAvatars` từ riêng danh
     * sách nạn nhân, và vì hàm đó dò chỗ trống theo cả tập id, kết quả khác hẳn
     * bảng của bàn chơi: `p7` là `miner` trên lưới nhưng thành `farmer` khi
     * tính một mình. Người vừa chết hiện lên với một khuôn mặt lạ, ở đúng cái
     * cảnh sinh ra để nói "người này là ai".
     *
     * Hai avatar này đều CÓ sprite sheet, nên `<img src>` phân biệt được chúng.
     */
    const scene = await mountScene({
      mode: "NIGHT",
      victims: [{ playerId: "p7", name: "Người p7", avatar: "miner", avatarUrl: null }],
      total: 1,
      overflow: 0,
      allVictimNames: ["Người p7"],
    });
    const img = scene.host.querySelector("[data-kill-portrait] img");
    assert.ok(img, "phải dựng ảnh sprite sheet");
    assert.match(img!.getAttribute("src") ?? "", /miner/);
    assert.equal(/farmer/.test(img!.getAttribute("src") ?? ""), false);
    await scene.unmount();
  });

  it("ảnh tự tải lên vẫn thắng khuôn mặt mặc định", async () => {
    const scene = await mountScene({
      mode: "NIGHT",
      victims: [
        {
          playerId: "p7",
          name: "Người p7",
          avatar: "miner",
          avatarUrl: "https://cdn.example/con-nguoi.png",
        },
      ],
      total: 1,
      overflow: 0,
      allVictimNames: ["Người p7"],
    });
    const html = scene.host.innerHTML;
    assert.ok(html.includes("cdn.example/con-nguoi.png"), html.slice(0, 400));
    assert.equal(html.includes("/characters/miner"), false);
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

  it("chỉ MỘT phần tử mang titleId", async () => {
    const scene = await mountScene(night(5));
    assert.equal(scene.host.querySelectorAll("#cine-title-x").length, 1);
    await scene.unmount();
  });

  it("nhãn trợ năng đúng bằng killAnnouncement, không lẫn tiêu đề nhìn thấy", async () => {
    /*
     * Hồi quy của một lỗi thật. Bản đầu nhét câu `sr-only` vào BÊN TRONG chính
     * thẻ tiêu đề mang `titleId`, nên tên dialog gộp cả hai và trình đọc màn
     * hình đọc ra một câu lặp: "Không qua khỏi đêm nay. Trời đã sáng. Người 1
     * không qua khỏi đêm nay."
     *
     * Giờ hai phần tử tách hẳn: cái nhìn thấy chỉ để nhìn, cái mang `titleId`
     * chỉ mang đúng một câu.
     */
    const { killAnnouncement, killTitle } = await import("@/lib/kill-cinematic");
    // MỘT nạn nhân: ở đây tiêu đề nhìn thấy ("Không qua khỏi đêm nay") và câu
    // đầy đủ ("Trời đã sáng. Người 1 không qua khỏi đêm nay.") khác hẳn nhau,
    // nên phép so BẰNG dưới đây bắt được ngay một bản sao thừa lọt vào nhãn.
    const view = night(1);
    const scene = await mountScene(view);

    const label = scene.host.querySelector("#cine-title-x");
    assert.ok(label);
    // Bằng ĐÚNG, không phải "có chứa": bản lỗi cho ra nội dung gộp
    // "Không qua khỏi đêm nayTrời đã sáng. Người 1 không qua khỏi đêm nay."
    assert.equal(label!.textContent, killAnnouncement(view));

    // Tiêu đề nhìn thấy vẫn còn trên màn, nhưng là một phần tử KHÁC và không
    // lồng bên trong nhãn.
    const heading = scene.host.querySelector(".kill-title");
    assert.ok(heading);
    assert.equal(heading!.textContent, killTitle(view));
    assert.notEqual(heading, label);
    assert.equal(label!.querySelector(".kill-title"), null);
    await scene.unmount();
  });

  it("cả năm tên có mặt trong nhãn trợ năng, kể cả hai người không lên hình", async () => {
    const view = night(5);
    const scene = await mountScene(view);
    const label = scene.host.querySelector("#cine-title-x")!.textContent ?? "";
    for (const name of view.allVictimNames) assert.ok(label.includes(name), `${name} | ${label}`);
    await scene.unmount();
  });

  it("phần chữ nhìn thấy được ẩn khỏi trình đọc màn hình để không đọc hai lần", async () => {
    const scene = await mountScene(night(2));
    for (const selector of [".kill-title", ".kill-eyebrow"]) {
      const el = scene.host.querySelector(selector);
      assert.ok(el, selector);
      assert.equal(el!.getAttribute("aria-hidden"), "true", selector);
    }
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
