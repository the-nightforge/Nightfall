import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MAX_RENDER_SCALE, renderScale } from "./cinematic-webgl";
import { EFFECT_MS } from "./village-memory-webgl";
import { CAMERA_GLIDE_MS } from "./village-memory-camera";
import { STEP_DURATION_MS } from "./village-memory-playback";

/*
 * File này `import` được từ `node:test` là một khẳng định tự nó.
 *
 * `village-memory-webgl` chỉ `import type` three, nên nạp nó KHÔNG kéo theo
 * ~600KB thư viện 3D. Phần còn lại của bộ test cho bản dựng cảnh nằm ở
 * `village-memory-camera.test.ts` - mọi phép tính đóng khung và nhịp đều đã dọn
 * sang đó, nên chúng khẳng định được mà không cần một context WebGL.
 */

/**
 * Mã nguồn của bản dựng, ĐÃ BỎ chú thích.
 *
 * Cả file này viết về những gì nó cố tình không dùng - "thay cho một PointLight
 * mỗi nhà", "không `Math.random`" - nên tìm chuỗi trên bản có chú thích thì
 * chính lời giải thích lại là thứ làm test đỏ. Bỏ chú thích rồi mới tìm.
 */
const source = readFileSync(new URL("./village-memory-webgl.ts", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("nhịp của một bước", () => {
  it("cảnh diễn xong trước khi bước kết thúc, để còn một nhịp lặng", () => {
    assert.ok(EFFECT_MS < STEP_DURATION_MS);
  });

  it("cú lia camera ngắn hơn hẳn phần diễn", () => {
    assert.ok(CAMERA_GLIDE_MS < EFFECT_MS / 2);
  });
});

describe("giới hạn hiệu năng", () => {
  it("dùng chung trần pixel ratio 1.5 với cảnh chuyển pha", () => {
    assert.equal(MAX_RENDER_SCALE, 1.5);
    assert.equal(renderScale(3), 1.5);
  });

  it("không shadow map, không post-processing, không tải tài nguyên ngoài", () => {
    /*
     * Khẳng định ở cấp mã nguồn vì không có cách nào khác: một `castShadow` lọt
     * vào đây sẽ chạy đúng trên máy của người viết và làm tụt khung hình trên
     * điện thoại của người chơi, mà không test hành vi nào bắt được.
     */
    for (const forbidden of [
      "castShadow",
      "receiveShadow",
      "shadowMap",
      "EffectComposer",
      "UnrealBloomPass",
      "TextureLoader",
      "GLTFLoader",
      "PointLight",
      "SpotLight",
    ]) {
      assert.ok(!source.includes(forbidden), `bản dựng không được dùng ${forbidden}`);
    }
  });

  it("không có nguồn ngẫu nhiên hay đồng hồ nào trong bản dựng", () => {
    // Cùng một ván phải cho ra cùng một ngôi làng, ở mọi lần mở. Thời gian đi
    // vào qua tham số `nowMs` của `update`, không qua một lời gọi toàn cục.
    assert.ok(!source.includes("Math.random"));
    assert.ok(!source.includes("Date.now"));
    assert.ok(!source.includes("performance.now"));
  });

  it("không hiệu ứng nào bọc căn nhà trong một khối đặc", () => {
    /*
     * Bản đầu dựng quầng của Trăng Nguyền, Bình Độc, Bình Cứu và cảnh trung
     * tính bằng CÙNG một `SphereGeometry` bán kính 0.95 - to gần bằng cả căn
     * nhà - rồi đặt nó ngay trên mái. Ở khung hình thật, thứ duy nhất còn đọc
     * được sau đó là quả cầu; căn nhà mà cảnh đang kể về thì biến mất.
     *
     * Luật thay thế: quầng và sương đều là hình quạt PHẲNG, còn hình cầu chỉ
     * được dùng cho những chi tiết bé - mắt Sói, điểm sáng chạy dọc tia - và cho
     * đúng một mái vòm, vốn trong suốt và là nội dung chính của cảnh Bảo Vệ.
     */
    const calls = [...source.matchAll(/new THREE\.SphereGeometry\(([^)]*)\)/g)];
    assert.ok(calls.length > 0, "test này chỉ có nghĩa khi có hình cầu để kiểm");
    for (const call of calls) {
      const args = call[1].split(",").map((part) => part.trim());
      const radius = Number(args[0]);
      assert.ok(Number.isFinite(radius), `bán kính phải là hằng số: ${call[0]}`);
      // Mái vòm của Khiên là ngoại lệ DUY NHẤT, và nó tự nhận diện bằng chính
      // hình dạng của mình: một nửa mặt cầu, tức là có `thetaLength`.
      const isDome = args.length >= 7;
      assert.ok(radius <= 0.12 || isDome, `khối cầu bán kính ${radius} đủ lớn để che một căn nhà`);
    }
  });

  it("mọi hình khối đều dựng tại chỗ, không tải model hay texture", () => {
    assert.ok(!/from "three\/examples/.test(source));
    assert.ok(!source.includes(".gltf"));
    assert.ok(!source.includes(".glb"));
    assert.ok(!source.includes(".png"));
  });
});
