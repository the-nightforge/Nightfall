import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { createStageDirector, type StageHandleLike } from "./live-trial-director";
import { CAMERA_GLIDE_MS, buildTrialScene } from "./live-trial-scene";
import type { TrialSceneState } from "./live-trial-scene";
import { createDisposableRegistry } from "./village-memory-resources";

/**
 * Bộ test cho đúng cái điều kiện không dựng lại được trong một effect React:
 * `import("three")` về CHẬM.
 *
 * `ready()` ở đây chính là thời điểm import hoàn tất, và test gọi nó khi nào
 * tuỳ ý - kể cả sau khi ván đã sang chặng khác. Hai lớp khẳng định:
 *
 *   1. Trên một handle GIẢ, đếm chính xác lời gọi nào đã chạy.
 *   2. Trên một `THREE.Scene` THẬT, đo camera và đèn sau khi cảnh sẵn sàng -
 *      vì lỗi cũ không nằm ở "gọi nhầm hàm" mà ở "cảnh đứng sai chặng".
 */

interface Call {
  name: "setState" | "opening" | "stamp" | "verdict";
  act?: TrialSceneState["act"];
  atMs: number;
}

function fakeHandle() {
  const calls: Call[] = [];
  const handle: StageHandleLike = {
    setState: (state, options) => calls.push({ name: "setState", act: state.act, atMs: options.atMs }),
    playOpening: (options) => calls.push({ name: "opening", atMs: options.atMs }),
    playStamp: (_side, options) => calls.push({ name: "stamp", atMs: options.atMs }),
    playVerdict: (_v, options) => calls.push({ name: "verdict", atMs: options.atMs }),
  };
  return { handle, calls, names: () => calls.map((c) => c.name) };
}

const state = (act: TrialSceneState["act"], tilt = 0): TrialSceneState => ({
  act,
  tilt,
  verdict: act === "VERDICT" ? "LYNCHED" : null,
});
const opts = (atMs: number, reduced = false) => ({ reduced, atMs });
const KEY = "1:1:acc";

// ---------------------------------------------------------------------------

describe("tải 3D chậm", () => {
  it("nhịp mở đầu chờ sẵn từ trước KHÔNG được chạy khi ván đã sang bỏ phiếu", () => {
    const director = createStageDirector();
    const { handle, names } = fakeHandle();

    // 1. Biện hộ mở ra, `three` chưa về.
    director.update(state("DEFENSE"), KEY, opts(0));
    director.play([{ kind: "OPENING" }], KEY, opts(0));
    assert.ok(director.peekPending(), "lô đang chờ cảnh dựng xong");

    // 2. Ván sang vòng xác nhận. Lô mới rỗng nên không có gì đè lô cũ.
    director.update(state("FINAL_VOTE"), KEY, opts(400));
    assert.equal(director.peekPending(), null, "lô cũ hết giá trị NGAY khi đổi chặng");

    // 3. `three` về muộn.
    director.ready(handle, 900);

    assert.deepEqual(names(), ["setState"], "chỉ dựng trạng thái hiện tại");
    assert.equal(handle === handle, true);
  });

  it("cảnh dựng xong TRONG lúc vẫn còn biện hộ thì màn mở đầu vẫn chạy", () => {
    const director = createStageDirector();
    const { handle, names } = fakeHandle();

    director.update(state("DEFENSE"), KEY, opts(0));
    director.play([{ kind: "OPENING" }], KEY, opts(0));
    director.ready(handle, 300);

    assert.deepEqual(names(), ["setState", "opening"]);
  });

  it("trạng thái được áp TRƯỚC nhịp diễn", () => {
    const director = createStageDirector();
    const { handle, calls } = fakeHandle();

    director.update(state("DEFENSE"), KEY, opts(0));
    director.play([{ kind: "OPENING" }], KEY, opts(0));
    director.ready(handle, 100);

    assert.equal(calls[0].name, "setState");
    assert.equal(calls[0].act, "DEFENSE");
  });

  it("lô diễn muộn giữ NGUYÊN mốc thời gian gốc", () => {
    const director = createStageDirector();
    const { handle, calls } = fakeHandle();

    director.update(state("FINAL_VOTE"), KEY, opts(0));
    director.play([{ kind: "STAMP", side: "guilty" }], KEY, opts(50));
    director.ready(handle, 5000);

    const stamp = calls.find((c) => c.name === "stamp")!;
    assert.equal(stamp.atMs, 50, "hiệu ứng cũ tự ở trạng thái kết thúc, không nhảy ra giữa màn");
  });

  it("lô của một PHIÊN TOÀ khác không bao giờ được diễn", () => {
    const director = createStageDirector();
    const { handle, names } = fakeHandle();

    director.update(state("DEFENSE"), "1:1:acc", opts(0));
    director.play([{ kind: "OPENING" }], "1:1:acc", opts(0));
    // Cùng chặng DEFENSE, nhưng là phiên toà của ngày hôm sau.
    director.update(state("DEFENSE"), "3:2:acc", opts(500));
    director.ready(handle, 600);

    assert.deepEqual(names(), ["setState"]);
  });

  it("giữ ĐÚNG MỘT lô: lô mới đè lô cũ, không xếp hàng phát bù", () => {
    const director = createStageDirector();
    const { handle, names } = fakeHandle();

    director.update(state("FINAL_VOTE"), KEY, opts(0));
    for (let i = 0; i < 6; i += 1) {
      director.play([{ kind: "STAMP", side: "guilty" }], KEY, opts(i * 10));
    }
    director.ready(handle, 100);

    assert.deepEqual(names(), ["setState", "stamp"], "sáu lá phiếu chờ chỉ còn một nhịp");
  });

  it("cảnh sẵn sàng rồi thì nhịp diễn chạy ngay, không qua hàng chờ", () => {
    const director = createStageDirector();
    const { handle, names } = fakeHandle();

    director.update(state("FINAL_VOTE"), KEY, opts(0));
    director.ready(handle, 0);
    director.play([{ kind: "STAMP", side: "guilty" }], KEY, opts(10));

    assert.deepEqual(names(), ["setState", "stamp"]);
    assert.equal(director.peekPending(), null);
  });

  it("mọi lần đổi trạng thái đều tới cảnh, kể cả giữa các nhịp diễn", () => {
    const director = createStageDirector();
    const { handle, calls } = fakeHandle();

    director.update(state("FINAL_VOTE"), KEY, opts(0));
    director.ready(handle, 0);
    director.update(state("FINAL_VOTE", 0.5), KEY, opts(10));
    director.update(state("VERDICT", 1), KEY, opts(20));

    const acts = calls.filter((c) => c.name === "setState").map((c) => c.act);
    // Lần đầu là lúc `ready` áp trạng thái đang có; hai lần sau là hai lần đổi.
    assert.deepEqual(acts, ["FINAL_VOTE", "FINAL_VOTE", "VERDICT"]);
  });

  it("tháo cảnh thì bỏ luôn lô đang chờ", () => {
    const director = createStageDirector();
    const { handle, names } = fakeHandle();

    director.update(state("DEFENSE"), KEY, opts(0));
    director.play([{ kind: "OPENING" }], KEY, opts(0));
    director.release();
    assert.equal(director.peekPending(), null);

    director.ready(handle, 100);
    assert.deepEqual(names(), ["setState"]);
  });

  it("sau khi tháo, đổi trạng thái không ném và không chạm cảnh cũ", () => {
    const director = createStageDirector();
    const { handle, names } = fakeHandle();
    director.update(state("DEFENSE"), KEY, opts(0));
    director.ready(handle, 0);
    director.release();

    assert.doesNotThrow(() => {
      director.update(state("FINAL_VOTE"), KEY, opts(10));
      director.play([{ kind: "STAMP", side: "guilty" }], KEY, opts(20));
    });
    assert.deepEqual(names(), ["setState"], "cảnh đã tháo không nhận thêm lệnh nào");
  });
});

describe("trên cảnh THẬT: camera và đèn đứng đúng chặng", () => {
  function realScene() {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
    const registry = createDisposableRegistry();
    const handle = buildTrialScene(THREE, scene, { audience: 9 }, { registry });
    return { scene, camera, handle };
  }

  function warmLight(scene: THREE.Scene): THREE.DirectionalLight {
    let found: THREE.DirectionalLight | null = null;
    scene.traverse((object) => {
      const light = object as THREE.DirectionalLight;
      if (light.isDirectionalLight && light.position.z > 0) found = light;
    });
    assert.ok(found);
    return found!;
  }

  /** Khung camera của một chặng, đo bằng cách để cảnh tự đứng yên ở chặng đó. */
  function poseOf(act: TrialSceneState["act"]): THREE.Vector3 {
    const { scene, camera, handle } = realScene();
    void scene;
    handle.setState(state(act), { reduced: true, atMs: 0 });
    handle.update(0, camera);
    return camera.position.clone();
  }

  it("import về muộn sau khi đã sang FINAL_VOTE: camera đứng ở khung bỏ phiếu", () => {
    const director = createStageDirector();
    const { camera, handle } = realScene();

    director.update(state("DEFENSE"), KEY, { reduced: true, atMs: 0 });
    director.play([{ kind: "OPENING" }], KEY, { reduced: true, atMs: 0 });
    director.update(state("FINAL_VOTE"), KEY, { reduced: true, atMs: 400 });
    director.ready(handle, 900);

    handle.update(900 + CAMERA_GLIDE_MS * 2, camera);

    const expected = poseOf("FINAL_VOTE");
    assert.ok(
      camera.position.distanceTo(expected) < 1e-6,
      `camera phải ở khung FINAL_VOTE, đo được ${camera.position.toArray().join(",")}`,
    );
    assert.ok(
      camera.position.distanceTo(poseOf("DEFENSE")) > 0.1,
      "và KHÔNG được ở khung biện hộ",
    );
  });

  it("import về muộn sau khi đã có phán quyết: đèn ấm đã tắt, không bật lại", () => {
    const director = createStageDirector();
    const { scene, camera, handle } = realScene();

    director.update(state("DEFENSE"), KEY, { reduced: true, atMs: 0 });
    director.play([{ kind: "OPENING" }], KEY, { reduced: true, atMs: 0 });
    director.update(state("VERDICT"), KEY, { reduced: true, atMs: 400 });
    director.ready(handle, 900);
    handle.update(900, camera);

    assert.equal(warmLight(scene).intensity, 0, "một màn mở đầu cũ không được thắp lại đèn");
  });

  it("cảnh sẵn sàng đúng lúc còn biện hộ: camera vẫn tới khung biện hộ", () => {
    const director = createStageDirector();
    const { camera, handle } = realScene();

    director.update(state("DEFENSE"), KEY, { reduced: true, atMs: 0 });
    director.play([{ kind: "OPENING" }], KEY, { reduced: true, atMs: 0 });
    director.ready(handle, 10);
    handle.update(10, camera);

    assert.ok(camera.position.distanceTo(poseOf("DEFENSE")) < 1e-6);
  });
});
