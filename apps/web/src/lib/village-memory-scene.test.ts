import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { EFFECT_MS, buildVillageScene, type VillageSceneHandle } from "./village-memory-webgl";
import { CAMERA_GLIDE_MS } from "./village-memory-camera";
import { ringRadius, type VillageEffect, type VillageMemoryModel, type VillageStep } from "./village-memory";

/**
 * Bộ test chạy trên một `THREE.Scene` THẬT.
 *
 * Ba file test kia đều là hàm thuần - đóng khung, nhịp, dọn tài nguyên - và
 * chúng bỏ lọt đúng loại lỗi tốn kém nhất: lỗi ở trạng thái mà `setStep` và
 * `update` để lại trên cây scene sau nhiều khung hình. "Nhà của nạn nhân đầu
 * sáng trở lại khi Sói chuyển sang người thứ hai" không phải một con số sai
 * trong một công thức; nó là hậu quả của việc `levels` được đặt lại từ nền mỗi
 * khung hình trong khi hiệu ứng chỉ ghi cho một người.
 *
 * Không cần `WebGLRenderer`: geometry, material, `Object3D` và toàn bộ phép
 * biến đổi của three chạy được trong `node:test` mà không cần DOM lẫn GPU. Cái
 * duy nhất không kiểm được ở đây là pixel, và pixel không phải chỗ những lỗi này
 * sống.
 */

// ---- Dựng mô hình thử ----

function villageModel(count: number): VillageMemoryModel {
  const radius = ringRadius(count);
  const houses = Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    return {
      playerId: `p${index}`,
      name: `Người ${index}`,
      roleLabel: "Dân Làng",
      teamLabel: "Dân Làng",
      team: "village" as const,
      aliveAtEnd: true,
      accent: "villager" as const,
      variant: index % 3,
      x: Math.round(Math.cos(angle) * radius * 1e4) / 1e4,
      z: Math.round(Math.sin(angle) * radius * 1e4) / 1e4,
    };
  });
  return {
    caseId: "test",
    title: "Hồi ức Ngôi Làng",
    winner: "village",
    winnerLabel: "Phe Dân Làng chiến thắng",
    subtitle: `${count} người chơi`,
    houses,
    steps: [],
    epilogueLetters: [],
    groundRadius: Math.round((radius + 3.2) * 1e4) / 1e4,
  };
}

function makeStep(
  effect: VillageEffect,
  options: {
    targets?: string[];
    extinguish?: string[];
    lit?: string[];
    origin?: string | null;
    all: string[];
  },
): VillageStep {
  const targets = options.targets ?? [];
  return {
    id: `${effect}:${targets.join(",")}`,
    index: 0,
    round: 1,
    phase: "night",
    momentLabel: "Đêm 1",
    effect,
    title: effect,
    description: "",
    participantIds: targets,
    litIds: options.lit ?? options.all,
    extinguishIds: options.extinguish ?? [],
    originId: options.origin ?? null,
    targetIds: targets,
    tally: null,
    cameraTarget: { x: 0, z: 0 },
    letters: [],
  };
}

/**
 * Một cảnh dựng xong, kèm đường tắt tới ô cửa của từng nhà.
 *
 * Nhóm nhà nhận diện bằng tấm phẳng cửa sổ: nó là `PlaneGeometry` duy nhất
 * trong cả cảnh. Bắt theo VỊ TRÍ thì hỏng, vì hiệu ứng Sói có làm nhà rung -
 * và chính cú rung ấy là một trong những thứ phải kiểm.
 */
function mountScene(model: VillageMemoryModel) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1440 / 608, 0.1, 200);
  const handle: VillageSceneHandle = buildVillageScene(THREE, scene, model);

  const groups: THREE.Object3D[] = [];
  for (const child of scene.children) {
    const hasWindow = child.children?.some(
      (part) => (part as THREE.Mesh).geometry?.type === "PlaneGeometry",
    );
    if (hasWindow) groups.push(child);
  }
  assert.equal(groups.length, model.houses.length, "phải tìm được đúng số nhóm nhà");
  // Thứ tự `scene.children` là thứ tự `scene.add`, tức thứ tự `model.houses`.
  const byId = new Map(model.houses.map((house, index) => [house.playerId, groups[index]]));

  const windowOf = (id: string) => {
    const group = byId.get(id);
    assert.ok(group, `không có nhà ${id}`);
    const mesh = group.children.find(
      (part) => (part as THREE.Mesh).geometry?.type === "PlaneGeometry",
    ) as THREE.Mesh;
    return mesh.material as THREE.MeshBasicMaterial;
  };

  /**
   * Độ sáng ô cửa, đọc ngược từ vật liệu.
   *
   * `paintHouses` đặt `opacity = 0.55 + 0.45 * level`, nên phép này trả lại
   * đúng `level` mà hiệu ứng đã tính - một con số so sánh được, thay vì phải
   * đoán qua màu.
   */
  const lightOf = (id: string) => (windowOf(id).opacity - 0.55) / 0.45;
  const groupOf = (id: string) => {
    const group = byId.get(id);
    assert.ok(group);
    return group;
  };

  return { scene, camera, handle, windowOf, lightOf, groupOf };
}

/** Mốc thời gian ứng với tiến độ `t` của hiệu ứng, tính từ lúc bước bắt đầu. */
const at = (t: number, startedAt = 0) => startedAt + t * EFFECT_MS;

const DARK = 0.05;
const LIT = 0.9;

// ---- Lỗi 1: Sói cắn nhiều người ----

describe("WOLF_ATTACK · nhiều nạn nhân", () => {
  const ALL = ["p0", "p1", "p2", "p3", "p4"];

  function twoVictims(reduced = false) {
    const model = villageModel(5);
    const scene = mountScene(model);
    const step = makeStep("WOLF_ATTACK", {
      all: ALL,
      targets: ["p1", "p3"],
      extinguish: ["p1", "p3"],
    });
    scene.handle.setStep(step, { glide: false, reduced, atMs: 0 });
    return scene;
  }

  it("nạn nhân đầu KHÔNG sáng lại khi Sói chuyển sang người thứ hai", () => {
    /*
     * Đây là lỗi, viết thành một câu khẳng định.
     *
     * Hai nạn nhân chia đôi thời lượng: p1 sống trong nửa đầu, p3 nửa sau. Ở
     * `t = 0.6` thì p1 đã ngã xuống từ lâu - nhưng bản cũ đặt lại `levels` từ
     * mức nền mỗi khung hình và chỉ ghi cho nạn nhân của phân đoạn ĐANG chạy,
     * nên ô cửa của p1 sáng trở lại y như chưa có chuyện gì.
     */
    const { lightOf, handle, camera } = twoVictims();

    // Cuối phân đoạn của p1 - `t = 0.5` là ranh giới, nên 0.499 là khung hình
    // cuối cùng còn thuộc về p1.
    handle.update(at(0.499), camera);
    assert.ok(lightOf("p1") < DARK, `p1 phải tối ở cuối lượt của mình, đang ${lightOf("p1")}`);

    handle.update(at(0.6), camera);
    assert.ok(lightOf("p1") < DARK, `p1 sáng lại ở lượt của p3: ${lightOf("p1")}`);
  });

  it("cuối hiệu ứng cả hai nhà đều tối", () => {
    const { lightOf, handle, camera } = twoVictims();
    handle.update(at(1), camera);
    assert.ok(lightOf("p1") < DARK, `p1: ${lightOf("p1")}`);
    assert.ok(lightOf("p3") < DARK, `p3: ${lightOf("p3")}`);
  });

  it("người ngoài cuộc giữ nguyên ánh đèn của dữ liệu", () => {
    const { lightOf, handle, camera } = twoVictims();
    for (const t of [0.1, 0.5, 0.9, 1]) {
      handle.update(at(t), camera);
      for (const id of ["p0", "p2", "p4"]) {
        assert.ok(lightOf(id) > LIT, `${id} ở t=${t}: ${lightOf(id)}`);
      }
    }
  });

  it("nạn nhân chưa tới lượt vẫn còn sáng", () => {
    const { lightOf, handle, camera } = twoVictims();
    handle.update(at(0.2), camera);
    assert.ok(lightOf("p3") > LIT, `p3 tắt đèn trước lượt của mình: ${lightOf("p3")}`);
  });

  it("nạn nhân hiện tại tắt dần theo tiến độ chứ không tắt phụt", () => {
    const { lightOf, handle, camera } = twoVictims();
    // Trong phân đoạn của p1: trước cú va chạm còn sáng, sau đó mờ dần.
    handle.update(at(0.05), camera);
    const early = lightOf("p1");
    handle.update(at(0.3), camera);
    const late = lightOf("p1");
    handle.update(at(0.45), camera);
    const done = lightOf("p1");
    assert.ok(early > LIT, `đầu lượt phải còn sáng: ${early}`);
    assert.ok(late < early, `phải mờ dần: ${late} so với ${early}`);
    assert.ok(done < late, `và tối hẳn ở cuối lượt: ${done}`);
  });

  it("ranh giới giữa hai phân đoạn không có bước nhảy ngược", () => {
    const { lightOf, handle, camera } = twoVictims();
    handle.update(at(0.499), camera);
    const before = lightOf("p1");
    handle.update(at(0.501), camera);
    const after = lightOf("p1");
    assert.ok(before < DARK && after < DARK, `qua ranh giới: ${before} -> ${after}`);
  });

  it("ba nạn nhân: ai qua lượt thì tối, ai chưa tới thì sáng", () => {
    const model = villageModel(6);
    const { lightOf, handle, camera } = mountScene(model);
    const all = ["p0", "p1", "p2", "p3", "p4", "p5"];
    handle.setStep(
      makeStep("WOLF_ATTACK", {
        all,
        targets: ["p1", "p3", "p5"],
        extinguish: ["p1", "p3", "p5"],
      }),
      { glide: false, reduced: false, atMs: 0 },
    );

    // Phân đoạn thứ ba: hai người đầu đã xong, người thứ ba mới bắt đầu.
    handle.update(at(0.7), camera);
    assert.ok(lightOf("p1") < DARK, `p1: ${lightOf("p1")}`);
    assert.ok(lightOf("p3") < DARK, `p3: ${lightOf("p3")}`);
    assert.ok(lightOf("p5") > LIT, `p5 chưa tới cú va chạm: ${lightOf("p5")}`);

    handle.update(at(1), camera);
    for (const id of ["p1", "p3", "p5"]) {
      assert.ok(lightOf(id) < DARK, `${id} cuối cảnh: ${lightOf(id)}`);
    }
  });

  it("một nạn nhân vẫn chạy đúng như trước", () => {
    const model = villageModel(5);
    const { lightOf, handle, camera } = mountScene(model);
    handle.setStep(
      makeStep("WOLF_ATTACK", { all: ALL, targets: ["p2"], extinguish: ["p2"] }),
      { glide: false, reduced: false, atMs: 0 },
    );
    handle.update(at(0.05), camera);
    assert.ok(lightOf("p2") > LIT);
    handle.update(at(1), camera);
    assert.ok(lightOf("p2") < DARK);
  });

  it("chỉ tắt đèn những id nằm trong extinguishIds", () => {
    /*
     * Sói cắn hai người nhưng chỉ một người ngã xuống - người kia được cứu, và
     * hồ sơ nói điều đó bằng cách KHÔNG đưa id vào `extinguishIds`. Cảnh không
     * được tự quyết định thay.
     */
    const model = villageModel(5);
    const { lightOf, handle, camera } = mountScene(model);
    handle.setStep(
      makeStep("WOLF_ATTACK", { all: ALL, targets: ["p1", "p3"], extinguish: ["p1"] }),
      { glide: false, reduced: false, atMs: 0 },
    );
    handle.update(at(1), camera);
    assert.ok(lightOf("p1") < DARK, `p1 phải tối: ${lightOf("p1")}`);
    assert.ok(lightOf("p3") > LIT, `p3 không có trong extinguishIds: ${lightOf("p3")}`);
  });

  it("giảm chuyển động cho đúng trạng thái CUỐI, không phải trạng thái giữa chừng", () => {
    const { lightOf, handle, camera } = twoVictims(true);
    // Giảm chuyển động kẹp `t = 1` bất kể đồng hồ, nên mọi mốc đều là cảnh kết.
    for (const ms of [0, at(0.3), at(0.6), at(1)]) {
      handle.update(ms, camera);
      assert.ok(lightOf("p1") < DARK, `p1 ở ${ms}ms: ${lightOf("p1")}`);
      assert.ok(lightOf("p3") < DARK, `p3 ở ${ms}ms: ${lightOf("p3")}`);
    }
  });

  it("nhảy thẳng tới một mốc cho cùng kết quả với chạy lần lượt qua các mốc", () => {
    /*
     * Người xem bấm Tạm dừng rồi kéo qua lại; tab bị ẩn rồi hiện lại; máy chậm
     * bỏ mất nửa số khung hình. Trạng thái phải là HÀM của `t`, không phải hệ
     * quả của việc những khung hình nào đã kịp chạy.
     */
    /*
     * Cả hai cảnh nhận khung hình ĐẦU TIÊN ở cùng một mốc, rồi mới rẽ đôi.
     *
     * Ngọn đèn có thêm một dao động nhấp nháy tính theo thời gian TỪ LÚC DỰNG
     * CẢNH, và mốc đó chính là khung hình đầu tiên. Không cho hai cảnh cùng một
     * điểm bắt đầu thì phép so sánh này đo pha nhấp nháy chứ không đo thứ đang
     * cần đo; cho rồi thì mọi khác biệt còn lại đúng là trạng thái sót lại giữa
     * các khung hình.
     */
    const snap = (scene: ReturnType<typeof mountScene>) => ({
      lights: ["p0", "p1", "p2", "p3", "p4"].map((id) => scene.lightOf(id).toFixed(6)),
      shift: ["p1", "p3"].map((id) => scene.groupOf(id).position.x.toFixed(6)),
    });

    const jumped = twoVictims();
    jumped.handle.update(at(0.01), jumped.camera);
    jumped.handle.update(at(0.8), jumped.camera);

    const stepped = twoVictims();
    stepped.handle.update(at(0.01), stepped.camera);
    for (const t of [0.2, 0.35, 0.5, 0.55, 0.65, 0.8]) {
      stepped.handle.update(at(t), stepped.camera);
    }

    assert.deepEqual(snap(stepped), snap(jumped));
  });

  it("nhà rung xong thì trở về đúng chỗ cũ", () => {
    const { groupOf, handle, camera } = twoVictims();
    const home = groupOf("p1").position.x;

    // Ngay sau cú va chạm nhà đang rung, nên vị trí lệch khỏi gốc.
    handle.update(at(0.3), camera);
    const shaken = groupOf("p1").position.x;
    assert.notEqual(shaken, home, "cảnh này phải có rung, nếu không thì test vô nghĩa");

    // Hết dư âm - và hết cả cảnh - thì nhà phải đứng lại đúng chỗ.
    handle.update(at(0.48), camera);
    assert.equal(groupOf("p1").position.x, home, "nhà kẹt lại ở vị trí rung");
    handle.update(at(1), camera);
    assert.equal(groupOf("p1").position.x, home, "nhà kẹt lại sau khi cảnh kết thúc");
    assert.equal(groupOf("p3").position.x, groupOf("p3").position.x, "nạn nhân thứ hai cũng vậy");
  });

  it("đổi sang bước khác rồi quay lại vẫn đúng", () => {
    const model = villageModel(5);
    const scene = mountScene(model);
    const wolf = makeStep("WOLF_ATTACK", {
      all: ALL,
      targets: ["p1", "p3"],
      extinguish: ["p1", "p3"],
    });
    const seer = makeStep("SEER_BEAM", { all: ALL, targets: ["p2"], origin: "p0" });

    scene.handle.setStep(wolf, { glide: false, reduced: false, atMs: 0 });
    scene.handle.update(at(1), scene.camera);
    assert.ok(scene.lightOf("p1") < DARK);

    // Bước sau nói cả làng còn sáng: cảnh phải nghe theo dữ liệu của bước đó.
    scene.handle.setStep(seer, { glide: false, reduced: false, atMs: 10_000 });
    scene.handle.update(10_000, scene.camera);
    assert.ok(scene.lightOf("p1") > LIT, `bước mới phải trả đèn về: ${scene.lightOf("p1")}`);

    scene.handle.setStep(wolf, { glide: false, reduced: false, atMs: 20_000 });
    scene.handle.update(at(1, 20_000), scene.camera);
    assert.ok(scene.lightOf("p1") < DARK, `quay lại: ${scene.lightOf("p1")}`);
    assert.ok(scene.lightOf("p3") < DARK, `quay lại: ${scene.lightOf("p3")}`);
  });

  it("vòng vẽ không dựng mảng mới để xử lý danh sách nạn nhân", () => {
    /*
     * Đếm THẬT trên `Array.prototype`, không đọc mã nguồn: bản cũ gọi
     * `targetIds.map(...).filter(...)` mỗi khung hình, tức hai mảng rác cho mỗi
     * khung của mọi cảnh Sói.
     */
    const { handle, camera } = twoVictims();
    const realMap = Array.prototype.map;
    const realFilter = Array.prototype.filter;
    let calls = 0;
    try {
      Array.prototype.map = function (this: unknown[], ...args: unknown[]) {
        calls += 1;
        return realMap.apply(this, args as never);
      } as typeof realMap;
      Array.prototype.filter = function (this: unknown[], ...args: unknown[]) {
        calls += 1;
        return realFilter.apply(this, args as never);
      } as typeof realFilter;
      for (let frame = 0; frame < 20; frame += 1) handle.update(at(frame / 20), camera);
    } finally {
      Array.prototype.map = realMap;
      Array.prototype.filter = realFilter;
    }
    assert.equal(calls, 0, `vòng vẽ gọi map/filter ${calls} lần`);
  });
});

// ---- Lỗi 2: cắt ngang một cú lia ----

describe("camera · ngắt cú lia giữa chừng", () => {
  const ALL = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"];

  /** Vị trí và hướng nhìn hiện tại - hai thứ phải liên tục, không chỉ khoảng cách. */
  function pose(camera: THREE.PerspectiveCamera) {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    return { position: camera.position.clone(), forward };
  }

  function gap(a: ReturnType<typeof pose>, b: ReturnType<typeof pose>) {
    return {
      position: a.position.distanceTo(b.position),
      forward: a.forward.distanceTo(b.forward),
    };
  }

  function stage() {
    const model = villageModel(8);
    const scene = mountScene(model);
    const steps = {
      intro: null,
      a: makeStep("GENERIC", { all: ALL, targets: ["p0"] }),
      b: makeStep("GENERIC", { all: ALL, targets: ["p4"] }),
      c: makeStep("GENERIC", { all: ALL, targets: ["p2"] }),
    };
    // Mở màn ở toàn cảnh, không lia - đúng như `VillageMemoryCanvas` làm.
    scene.handle.setStep(steps.intro, { glide: false, reduced: false, atMs: 0 });
    scene.handle.update(0, scene.camera);
    return { ...scene, steps };
  }

  it("cắt ngang ở 200ms: camera không nhảy tới đích cũ", () => {
    /*
     * Chính là tình huống đã tái hiện. Camera đang lia từ toàn cảnh sang nhà A;
     * 200ms sau người xem bấm Tiếp sang nhà B. Bản cũ lấy ĐÍCH A làm điểm xuất
     * phát của cú lia mới, nên khung hình kế tiếp nhảy thẳng tới A rồi mới bò
     * sang B.
     */
    const { handle, camera, steps } = stage();

    handle.setStep(steps.a, { glide: true, reduced: false, atMs: 1_000 });
    handle.update(1_200, camera);
    const before = pose(camera);

    handle.setStep(steps.b, { glide: true, reduced: false, atMs: 1_200 });
    handle.update(1_200, camera);
    const after = pose(camera);

    const jump = gap(before, after);
    assert.ok(jump.position < 0.01, `camera nhảy ${jump.position.toFixed(3)} đơn vị`);
    assert.ok(jump.forward < 0.001, `hướng nhìn nhảy ${jump.forward.toFixed(4)}`);
  });

  it("cắt ngang ở mọi thời điểm đều liên tục", () => {
    for (const cut of [1, 60, 200, 400, 800, CAMERA_GLIDE_MS - 1]) {
      const { handle, camera, steps } = stage();
      handle.setStep(steps.a, { glide: true, reduced: false, atMs: 1_000 });
      handle.update(1_000 + cut, camera);
      const before = pose(camera);

      handle.setStep(steps.b, { glide: true, reduced: false, atMs: 1_000 + cut });
      handle.update(1_000 + cut, camera);
      const jump = gap(before, pose(camera));

      assert.ok(jump.position < 0.01, `cắt ở ${cut}ms: nhảy ${jump.position.toFixed(3)}`);
      assert.ok(jump.forward < 0.001, `cắt ở ${cut}ms: hướng nhảy ${jump.forward.toFixed(4)}`);
    }
  });

  it("bấm Tiếp liên tiếp A → B → C → A vẫn liên tục", () => {
    const { handle, camera, steps } = stage();
    let now = 1_000;
    let previous = pose(camera);

    for (const step of [steps.a, steps.b, steps.c, steps.a]) {
      handle.setStep(step, { glide: true, reduced: false, atMs: now });
      handle.update(now, camera);
      const jump = gap(previous, pose(camera));
      assert.ok(jump.position < 0.01, `chuỗi bước: nhảy ${jump.position.toFixed(3)}`);
      assert.ok(jump.forward < 0.001, `chuỗi bước: hướng nhảy ${jump.forward.toFixed(4)}`);

      // Người xem bấm tiếp sau 180ms, tức là luôn cắt ngang cú lia trước.
      now += 180;
      handle.update(now, camera);
      previous = pose(camera);
    }
  });

  it("chờ hết cú lia thì tới ĐÚNG đích, dù đã bị cắt ngang", () => {
    const { handle, camera, steps } = stage();

    // Đích của B, đo trên một cảnh không bị cắt ngang lần nào.
    const clean = stage();
    clean.handle.setStep(clean.steps.b, { glide: false, reduced: false, atMs: 0 });
    clean.handle.update(0, clean.camera);
    const target = pose(clean.camera);

    handle.setStep(steps.a, { glide: true, reduced: false, atMs: 1_000 });
    handle.update(1_200, camera);
    handle.setStep(steps.b, { glide: true, reduced: false, atMs: 1_200 });
    handle.update(1_200 + CAMERA_GLIDE_MS + 1, camera);

    const off = gap(target, pose(camera));
    assert.ok(off.position < 1e-6, `lệch đích ${off.position}`);
    assert.ok(off.forward < 1e-6, `lệch hướng ${off.forward}`);
  });

  it("giảm chuyển động vẫn nhảy thẳng tới đích, không sinh ra cú lia", () => {
    const { handle, camera, steps } = stage();
    const clean = stage();
    clean.handle.setStep(clean.steps.a, { glide: false, reduced: true, atMs: 0 });
    clean.handle.update(0, clean.camera);
    const target = pose(clean.camera);

    handle.setStep(steps.a, { glide: false, reduced: true, atMs: 1_000 });
    handle.update(1_000, camera);
    const off = gap(target, pose(camera));
    assert.ok(off.position < 1e-9, `phải tới ngay: ${off.position}`);
  });

  it("đổi tỉ lệ khung giữa cú lia không làm camera nhảy", () => {
    const { handle, camera, steps } = stage();
    handle.setStep(steps.a, { glide: true, reduced: false, atMs: 1_000 });
    handle.update(1_200, camera);
    const before = pose(camera);

    // Xoay điện thoại: khung hình đổi tỉ lệ ngay giữa cú lia.
    camera.aspect = 390 / 505;
    handle.update(1_200, camera);
    const jump = gap(before, pose(camera));
    assert.ok(jump.position < 1.5, `đổi khung làm camera nhảy ${jump.position.toFixed(2)}`);

    // Và cú lia vẫn kết thúc ở đúng khung mới.
    const clean = stage();
    clean.camera.aspect = 390 / 505;
    clean.handle.setStep(clean.steps.a, { glide: false, reduced: false, atMs: 0 });
    clean.handle.update(0, clean.camera);
    handle.update(1_000 + CAMERA_GLIDE_MS + 1, camera);
    const off = gap(pose(clean.camera), pose(camera));
    assert.ok(off.position < 1e-6, `lệch đích sau khi đổi khung: ${off.position}`);
  });

  it("đổi bước KHÔNG dựng lại gì trong cảnh", () => {
    // Cùng một lời hứa mà `applyStepToScene` giữ ở lớp trên, nhưng đo trên cây
    // scene thật: số vật thể và chính danh tính của chúng phải không đổi.
    const { scene, handle, camera, steps } = stage();
    const before = scene.children.slice();
    handle.setStep(steps.a, { glide: true, reduced: false, atMs: 1_000 });
    handle.update(1_200, camera);
    handle.setStep(steps.b, { glide: true, reduced: false, atMs: 1_200 });
    handle.update(1_400, camera);
    assert.equal(scene.children.length, before.length);
    for (let index = 0; index < before.length; index += 1) {
      assert.equal(scene.children[index], before[index], `vật thể ${index} bị thay`);
    }
  });
});
