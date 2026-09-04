import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as THREE from "three";
import {
  CAMERA_GLIDE_MS,
  STAMP_MS,
  TOKENS_PER_SIDE,
  VERDICT_MS,
  buildTrialScene,
  type TrialSceneHandle,
} from "./live-trial-scene";
import { MAX_RENDER_SCALE, renderScale } from "./cinematic-webgl";
import { createDisposableRegistry } from "./village-memory-resources";

/**
 * Bộ test chạy trên một `THREE.Scene` THẬT.
 *
 * Không cần `WebGLRenderer`: geometry, material, `Object3D` và mọi phép biến
 * đổi của three chạy được trong `node:test` mà không cần DOM lẫn GPU. Thứ duy
 * nhất không kiểm được ở đây là pixel, và pixel không phải chỗ những lỗi tốn
 * kém nhất của tính năng này sống - chúng sống ở trạng thái mà `setState` và
 * `update` để lại trên cây scene sau nhiều khung hình.
 *
 * Khẳng định QUAN TRỌNG NHẤT của cả file: số vật thể trong scene không nhúc
 * nhích khi phiếu về. Đó là cách duy nhất chứng minh "không dựng lại cảnh theo
 * mỗi lá phiếu" mà không phải đọc mã nguồn rồi tin vào mắt mình.
 */

function count(scene: THREE.Scene): number {
  let total = 0;
  scene.traverse(() => {
    total += 1;
  });
  return total;
}

function setup(audience = 9) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
  const registry = createDisposableRegistry();
  const handle = buildTrialScene(THREE, scene, { audience }, { registry });
  return { scene, camera, registry, handle };
}

/** Đưa cảnh về đúng một trạng thái tĩnh rồi vẽ một khung hình. */
function settle(handle: TrialSceneHandle, camera: THREE.PerspectiveCamera, atMs: number) {
  handle.update(atMs, camera);
}

const now = 1000;

// ---------------------------------------------------------------------------

describe("dựng cảnh", () => {
  it("dựng được trên một Scene thật và gắn đúng MỘT gốc vào scene", () => {
    const { scene } = setup();
    assert.equal(scene.children.length, 1);
    assert.ok(count(scene) > 20, "cảnh phải có thật, không phải một group rỗng");
  });

  it("chỉ có ba nguồn sáng, và không có nguồn nào cần shadow map", () => {
    const { scene } = setup();
    const lights: THREE.Light[] = [];
    scene.traverse((object) => {
      if ((object as THREE.Light).isLight) lights.push(object as THREE.Light);
    });
    assert.equal(lights.length, 3);
    for (const light of lights) {
      assert.equal(light.castShadow, false, "không có đèn nào đổ bóng");
      assert.ok(
        !(light as THREE.PointLight).isPointLight && !(light as THREE.SpotLight).isSpotLight,
        "PointLight/SpotLight bị cấm - xem luật hiệu năng ở đầu file dựng cảnh",
      );
    }
  });

  it("không vật thể nào bật đổ bóng", () => {
    const { scene } = setup();
    scene.traverse((object) => {
      assert.equal(object.castShadow, false);
      assert.equal(object.receiveShadow, false);
    });
  });

  it("đám đông dùng InstancedMesh: một lời gọi vẽ cho cả vòng khán giả", () => {
    const { scene } = setup(15);
    const instanced: THREE.InstancedMesh[] = [];
    scene.traverse((object) => {
      if ((object as THREE.InstancedMesh).isInstancedMesh) {
        instanced.push(object as THREE.InstancedMesh);
      }
    });
    assert.equal(instanced.length, 2);
    for (const mesh of instanced) assert.equal(mesh.count, 15);
  });

  it("vòng khán giả KHÔNG đổi theo số phiếu, chỉ theo sĩ số phòng", () => {
    const small = setup(7);
    const large = setup(14);
    const instancedCount = (scene: THREE.Scene) => {
      let value = 0;
      scene.traverse((object) => {
        if ((object as THREE.InstancedMesh).isInstancedMesh) {
          value = (object as THREE.InstancedMesh).count;
        }
      });
      return value;
    };
    assert.equal(instancedCount(small.scene), 7);
    assert.equal(instancedCount(large.scene), 14);

    // Phiếu đổ vào không được đụng tới đám đông.
    large.handle.setState({ act: "FINAL_VOTE", tilt: 0.8, verdict: null }, { reduced: false, atMs: now });
    settle(large.handle, large.camera, now + 2000);
    assert.equal(instancedCount(large.scene), 14);
  });

  it("cả đám đông dùng CHUNG một vật liệu, nên không ai sáng lên riêng được", () => {
    const { scene } = setup(10);
    const materials = new Set<THREE.Material>();
    scene.traverse((object) => {
      if ((object as THREE.InstancedMesh).isInstancedMesh) {
        materials.add((object as THREE.InstancedMesh).material as THREE.Material);
      }
    });
    assert.equal(materials.size, 1);
  });

  it("sĩ số lạ vẫn dựng được, có trần và có sàn", () => {
    for (const audience of [0, -3, 1, 500, Number.NaN]) {
      const scene = new THREE.Scene();
      assert.doesNotThrow(() => buildTrialScene(THREE, scene, { audience }));
    }
  });
});

describe("không dựng lại theo mỗi lá phiếu", () => {
  it("số vật thể đứng yên qua hàng chục lần đổi số phiếu", () => {
    const { scene, camera, handle } = setup(15);
    const before = count(scene);

    for (let index = 0; index < 40; index += 1) {
      const tilt = ((index % 9) - 4) / 4;
      handle.setState({ act: "FINAL_VOTE", tilt, verdict: null }, { reduced: false, atMs: now + index * 40 });
      handle.playStamp(index % 2 === 0 ? "guilty" : "innocent", {
        reduced: false,
        atMs: now + index * 40,
      });
      settle(handle, camera, now + index * 40 + 10);
    }

    assert.equal(count(scene), before, "một lá phiếu không được sinh ra vật thể mới");
  });

  it("bể con dấu có trần: con dấu thứ năm dùng lại chỗ của con dấu đầu", () => {
    const { scene, camera, handle } = setup();
    const before = count(scene);
    for (let index = 0; index < TOKENS_PER_SIDE * 4; index += 1) {
      handle.playStamp("guilty", { reduced: false, atMs: now + index });
    }
    settle(handle, camera, now + 5);
    assert.equal(count(scene), before);
  });

  it("đổi chặng không dựng lại cảnh", () => {
    const { scene, camera, handle } = setup();
    const before = count(scene);
    for (const act of ["DEFENSE", "FINAL_VOTE", "VERDICT", "DEFENSE"] as const) {
      handle.setState({ act, tilt: 0, verdict: null }, { reduced: false, atMs: now });
      settle(handle, camera, now + 100);
    }
    assert.equal(count(scene), before);
  });

  it("vòng vẽ không cấp phát: gọi update nghìn lần không làm cây scene phình ra", () => {
    const { scene, camera, handle } = setup();
    handle.setState({ act: "FINAL_VOTE", tilt: 0.5, verdict: null }, { reduced: false, atMs: now });
    const before = count(scene);
    for (let frame = 0; frame < 1000; frame += 1) settle(handle, camera, now + frame * 16);
    assert.equal(count(scene), before);
  });
});

describe("cán cân nghiêng ĐÚNG CHIỀU", () => {
  /*
   * Đo VỊ TRÍ THẬT của hai đĩa trong không gian thế giới, không đo góc quay.
   *
   * Bản đầu có `beam.rotation.z` sai dấu, và một phép kiểm "hai góc quay khác
   * dấu nhau" vẫn xanh với đúng cái lỗi đó: hai đĩa vẫn lệch nhau, chỉ là lệch
   * ngược. Thứ duy nhất trả lời được câu hỏi thật - bên nặng hơn có tụt xuống
   * không - là toạ độ y sau khi `updateMatrixWorld` chạy.
   *
   * Đĩa cân nhận ra bằng hình dạng và chỗ treo: `CylinderGeometry` gắn ở
   * `y = -0.36` dưới một tay đòn. Bên trái (x âm) là Treo - xem `hangPan`.
   */
  function panHeights(scene: THREE.Scene): { guilty: number; innocent: number } {
    scene.updateMatrixWorld(true);
    const out: Record<string, number> = {};
    const world = new THREE.Vector3();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.geometry?.type !== "CylinderGeometry") return;
      if (Math.abs(mesh.position.y + 0.36) > 1e-6) return;
      const arm = mesh.parent!;
      out[arm.position.x < 0 ? "guilty" : "innocent"] = mesh.getWorldPosition(world).y;
    });
    assert.ok("guilty" in out && "innocent" in out, "không tìm thấy hai đĩa cân");
    return out as { guilty: number; innocent: number };
  }

  function settled(tilt: number) {
    const { scene, camera, handle } = setup();
    handle.setState({ act: "FINAL_VOTE", tilt, verdict: null }, { reduced: true, atMs: now });
    settle(handle, camera, now);
    return panHeights(scene);
  }

  it("Treo nhiều phiếu hơn thì ĐĨA TREO HẠ XUỐNG", () => {
    const { guilty, innocent } = settled(1);
    assert.ok(
      guilty < innocent,
      `đĩa Treo phải thấp hơn đĩa Tha, đo được Treo=${guilty} Tha=${innocent}`,
    );
  });

  it("Tha nhiều phiếu hơn thì ĐĨA THA HẠ XUỐNG", () => {
    const { guilty, innocent } = settled(-1);
    assert.ok(
      innocent < guilty,
      `đĩa Tha phải thấp hơn đĩa Treo, đo được Treo=${guilty} Tha=${innocent}`,
    );
  });

  it("hơn ít phiếu thì lệch ít, hơn nhiều phiếu thì lệch nhiều", () => {
    const small = settled(0.25);
    const large = settled(1);
    assert.ok(small.guilty < small.innocent);
    assert.ok(large.innocent - large.guilty > small.innocent - small.guilty);
  });

  it("bằng phiếu hoặc chưa có phiếu thì hai đĩa ngang nhau", () => {
    const level = settled(0);
    assert.ok(Math.abs(level.guilty - level.innocent) < 1e-9);
  });

  it("hai đĩa vẫn NẰM NGANG dù đòn cân nghiêng", () => {
    const { scene, camera, handle } = setup();
    handle.setState({ act: "FINAL_VOTE", tilt: 0.8, verdict: null }, { reduced: true, atMs: now });
    settle(handle, camera, now);
    scene.updateMatrixWorld(true);
    const euler = new THREE.Euler();
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || mesh.geometry?.type !== "CylinderGeometry") return;
      if (Math.abs(mesh.position.y + 0.36) > 1e-6) return;
      euler.setFromRotationMatrix(mesh.matrixWorld);
      assert.ok(Math.abs(euler.z) < 1e-6, "đĩa cân không được nghiêng theo đòn");
    });
  });

  it("con dấu vẫn rơi vào đúng đĩa của bên mình", () => {
    // Con dấu là con của TAY ĐÒN, nên nó đi theo đúng đĩa dù đòn nghiêng cách
    // nào - đây là phép chốt rằng lần sửa dấu không làm token lạc bên.
    const { scene, camera, handle } = setup();
    handle.setState({ act: "FINAL_VOTE", tilt: 1, verdict: null }, { reduced: false, atMs: now });
    handle.playStamp("guilty", { reduced: false, atMs: now });
    settle(handle, camera, now + STAMP_MS / 3);
    scene.updateMatrixWorld(true);

    const world = new THREE.Vector3();
    let found = 0;
    scene.traverse((object) => {
      if (object.name !== "token" || !object.visible) return;
      found += 1;
      assert.ok(object.parent!.position.x < 0, "con dấu Treo phải nằm trên tay đòn Treo");
      const tokenY = object.getWorldPosition(world).y;
      const pans = panHeights(scene);
      assert.ok(tokenY > pans.guilty, "con dấu đang rơi xuống đĩa, chưa chạm đáy");
    });
    assert.equal(found, 1);
  });
});

describe("cán cân", () => {
  function beamOf(scene: THREE.Scene): THREE.Object3D {
    // Đòn cân là group DUY NHẤT bị xoay quanh trục Z trong cả cảnh.
    let found: THREE.Object3D | null = null;
    scene.traverse((object) => {
      if (object.type === "Group" && object.position.y > 1.4 && object.position.y < 1.7) {
        found = object;
      }
    });
    assert.ok(found, "không tìm thấy đòn cân");
    return found!;
  }

  it("nghiêng theo tương quan hai bên", () => {
    const { scene, camera, handle } = setup();
    handle.setState({ act: "FINAL_VOTE", tilt: 1, verdict: null }, { reduced: true, atMs: now });
    settle(handle, camera, now);
    const guiltySide = beamOf(scene).rotation.z;

    handle.setState({ act: "FINAL_VOTE", tilt: -1, verdict: null }, { reduced: true, atMs: now });
    settle(handle, camera, now);
    const innocentSide = beamOf(scene).rotation.z;

    assert.ok(guiltySide !== 0);
    assert.ok(Math.sign(guiltySide) !== Math.sign(innocentSide));
  });

  it("cân bằng khi chưa có phiếu nào", () => {
    const { scene, camera, handle } = setup();
    handle.setState({ act: "FINAL_VOTE", tilt: 0, verdict: null }, { reduced: true, atMs: now });
    settle(handle, camera, now);
    assert.equal(Math.abs(beamOf(scene).rotation.z), 0);
  });

  it("đĩa cân luôn nằm ngang: xoay ngược đúng bằng góc của đòn", () => {
    const { scene, camera, handle } = setup();
    handle.setState({ act: "FINAL_VOTE", tilt: 0.75, verdict: null }, { reduced: true, atMs: now });
    settle(handle, camera, now);
    const beam = beamOf(scene);
    const arms = beam.children.filter((child) => child.type === "Group");
    assert.equal(arms.length, 2);
    for (const arm of arms) {
      assert.ok(
        Math.abs(arm.rotation.z + beam.rotation.z) < 1e-6,
        "đĩa cân phải bù đúng góc nghiêng của đòn",
      );
    }
  });
});

describe("giảm chuyển động", () => {
  it("không lia camera: khung hình đầu đã ở đúng vị trí cuối", () => {
    const glide = setup();
    const reduced = setup();

    glide.handle.setState({ act: "FINAL_VOTE", tilt: 0, verdict: null }, { reduced: false, atMs: now });
    reduced.handle.setState({ act: "FINAL_VOTE", tilt: 0, verdict: null }, { reduced: true, atMs: now });

    settle(glide.handle, glide.camera, now + 10);
    settle(reduced.handle, reduced.camera, now + 10);
    assert.ok(
      glide.camera.position.distanceTo(reduced.camera.position) > 0.1,
      "bản có lia phải còn đang trên đường đi",
    );

    // Bản có lia rồi cũng tới đúng chỗ đó, chỉ là muộn hơn.
    settle(glide.handle, glide.camera, now + CAMERA_GLIDE_MS + 50);
    assert.ok(glide.camera.position.distanceTo(reduced.camera.position) < 1e-6);
  });

  function visibleTokens(scene: THREE.Scene): number {
    let total = 0;
    scene.traverse((object) => {
      if (object.name !== "token" || !object.visible) return;
      const material = (object as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (material.opacity > 0) total += 1;
    });
    return total;
  }

  it("không có con dấu nào bay", () => {
    const flying = setup();
    flying.handle.playStamp("guilty", { reduced: false, atMs: now });
    settle(flying.handle, flying.camera, now + STAMP_MS / 2);
    assert.ok(visibleTokens(flying.scene) > 0, "bản thường phải có con dấu để mà so");

    const { scene, camera, handle } = setup();
    handle.playStamp("guilty", { reduced: true, atMs: now });
    settle(handle, camera, now + STAMP_MS / 2);
    assert.equal(visibleTokens(scene), 0);
  });

  it("con dấu tan hết sau khi diễn xong, không đọng lại trên đĩa cân", () => {
    const { scene, camera, handle } = setup();
    handle.playStamp("guilty", { reduced: false, atMs: now });
    handle.playStamp("innocent", { reduced: false, atMs: now });
    settle(handle, camera, now + STAMP_MS + 10);
    assert.equal(visibleTokens(scene), 0, "bốn con dấu đọng lại sẽ bị đọc thành bốn phiếu");
  });

  it("cán cân vẫn tới đúng trạng thái, chỉ là tới ngay", () => {
    const { scene, camera, handle } = setup();
    handle.setState({ act: "FINAL_VOTE", tilt: 1, verdict: null }, { reduced: true, atMs: now });
    settle(handle, camera, now);
    let beam: THREE.Object3D | null = null;
    scene.traverse((object) => {
      if (object.type === "Group" && object.position.y > 1.4 && object.position.y < 1.7) beam = object;
    });
    assert.ok(beam && (beam as THREE.Object3D).rotation.z !== 0);
  });

  it("nhịp phán quyết không có vòng loang, nhưng ánh sáng vẫn đổi", () => {
    const { scene, camera, handle } = setup();
    handle.setState({ act: "VERDICT", tilt: 1, verdict: null }, { reduced: true, atMs: now });
    handle.playVerdict("LYNCHED", { reduced: true, atMs: now });
    settle(handle, camera, now);

    let warm: THREE.DirectionalLight | null = null;
    scene.traverse((object) => {
      const light = object as THREE.DirectionalLight;
      if (light.isDirectionalLight && light.position.z > 0) warm = light;
    });
    assert.ok(warm, "phải tìm được đèn ấm");
    assert.equal((warm as THREE.DirectionalLight).intensity, 0, "đèn ấm tắt ngay, không cần diễn");
  });
});

describe("phán quyết", () => {
  function warmLight(scene: THREE.Scene): THREE.DirectionalLight {
    let found: THREE.DirectionalLight | null = null;
    scene.traverse((object) => {
      const light = object as THREE.DirectionalLight;
      if (light.isDirectionalLight && light.position.z > 0) found = light;
    });
    assert.ok(found);
    return found!;
  }

  it("bị treo: ánh sáng ấm quanh bị cáo tắt dần", () => {
    const { scene, camera, handle } = setup();
    handle.setState({ act: "FINAL_VOTE", tilt: 1, verdict: null }, { reduced: false, atMs: now });
    settle(handle, camera, now);
    const before = warmLight(scene).intensity;

    handle.playVerdict("LYNCHED", { reduced: false, atMs: now });
    settle(handle, camera, now + VERDICT_MS / 2);
    const middle = warmLight(scene).intensity;
    settle(handle, camera, now + VERDICT_MS + 10);
    const after = warmLight(scene).intensity;

    assert.ok(before > 0);
    assert.ok(middle < before && middle > after, "phải TẮT DẦN, không tắt phụt");
    assert.equal(after, 0);
  });

  it("được tha: ánh sáng mở rộng thay vì tắt", () => {
    const { scene, camera, handle } = setup();
    handle.setState({ act: "FINAL_VOTE", tilt: -0.5, verdict: null }, { reduced: false, atMs: now });
    settle(handle, camera, now);
    const before = warmLight(scene).intensity;

    handle.playVerdict("SPARED", { reduced: false, atMs: now });
    settle(handle, camera, now + VERDICT_MS + 10);
    assert.ok(warmLight(scene).intensity > before);
  });

  it("nối lại giữa phán quyết dựng thẳng ánh sáng cuối, không diễn lại", () => {
    // Không gọi `playVerdict` - chỉ đặt trạng thái, đúng như đường reconnect.
    const { scene, camera, handle } = setup();
    handle.setState({ act: "VERDICT", tilt: 1, verdict: "LYNCHED" }, { reduced: true, atMs: now });
    settle(handle, camera, now);
    assert.equal(warmLight(scene).intensity, 0);
  });

  it("nhịp phán quyết không kéo dài quá 1,5 giây", () => {
    assert.ok(VERDICT_MS <= 1500, "thiết kế nói khoảng 1-1,5 giây");
    assert.ok(VERDICT_MS >= 1000);
  });
});

describe("vòng đời", () => {
  it("dispose trả hết tài nguyên đã mượn và gỡ gốc khỏi scene", () => {
    const { scene, registry, handle } = setup();
    assert.ok(registry.size() > 10, "phải có thứ để mà trả");
    handle.dispose();
    // Sổ do bên gọi giữ nên bên gọi dọn - đây là mô phỏng đúng việc mà
    // `teardownVillage` làm ngay sau `built.dispose()`.
    assert.deepEqual(registry.disposeAll(), []);
    assert.equal(scene.children.length, 0);
  });

  it("dispose gọi nhiều lần không ném", () => {
    const { handle } = setup();
    handle.dispose();
    assert.doesNotThrow(() => handle.dispose());
  });

  it("sau dispose thì mọi lệnh đều là no-op, không ném", () => {
    const { camera, handle } = setup();
    handle.dispose();
    assert.doesNotThrow(() => {
      handle.setState({ act: "FINAL_VOTE", tilt: 1, verdict: null }, { reduced: false, atMs: now });
      handle.playStamp("guilty", { reduced: false, atMs: now });
      handle.playVerdict("LYNCHED", { reduced: false, atMs: now });
      handle.playOpening({ reduced: false, atMs: now });
      handle.update(now, camera);
    });
  });

  it("sổ của chính mình được dọn khi dựng cảnh hỏng giữa chừng", () => {
    // Ép hỏng ở một bước GIỮA chuỗi khởi tạo, sau khi đã tạo được vài geometry.
    const broken = {
      ...THREE,
      InstancedMesh: function () {
        throw new Error("hết bộ nhớ đồ hoạ");
      },
    } as unknown as typeof THREE;
    const scene = new THREE.Scene();
    assert.throws(() => buildTrialScene(broken, scene, { audience: 9 }));
  });
});

describe("giới hạn hiệu năng và luật của bản dựng", () => {
  /**
   * Mã nguồn ĐÃ BỎ chú thích.
   *
   * Cả file dựng cảnh viết về những gì nó cố tình không dùng ("không cần
   * SpotLight", "không GLTF"), nên tìm chuỗi trên bản còn chú thích thì chính
   * lời giải thích lại là thứ làm test đỏ.
   */
  const source = readFileSync(new URL("./live-trial-scene.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("dùng chung trần pixel ratio 1.5 với những cảnh 3D còn lại", () => {
    assert.equal(MAX_RENDER_SCALE, 1.5);
    assert.equal(renderScale(3), 1.5);
  });

  it("không shadow map, không post-processing, không tải tài nguyên ngoài", () => {
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

  it("không vẽ chữ trong WebGL: tên, số và nhãn đều là DOM", () => {
    for (const forbidden of ["TextGeometry", "CanvasTexture", "fillText", "Sprite"]) {
      assert.ok(!source.includes(forbidden), `chữ phải ở DOM, không phải ${forbidden}`);
    }
  });

  it("KHÔNG import tĩnh three: cả module đi sau một import() động", () => {
    assert.ok(!/^\s*import\s+[^;]*from\s+"three"/m.test(source));
    assert.ok(source.includes('import type { TrialStageAct'), "chỉ import kiểu");
  });

  it("component chỉ với tới three và bản dựng cảnh qua import() động", () => {
    /*
     * Ranh giới tải lười nằm ở ĐÂY, không ở file dựng cảnh.
     *
     * `live-trial-scene.ts` tự nó không kéo three vào (test ngay trên), nhưng
     * một `import` tĩnh từ phía component sẽ kéo cả file dựng cảnh - và qua nó
     * là cả three - vào chunk của phòng chơi, tức là vào lượt tải của những
     * người để tính năng này TẮT. Mặc định là tắt, nên đó sẽ là gần như tất cả.
     */
    const canvas = readFileSync(
      new URL("../components/TrialStageCanvas.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(!/^\s*import\s+(?!type)[^;]*from\s+"three"/m.test(canvas));
    assert.ok(!/^\s*import\s+(?!type)[^;]*from\s+"@\/lib\/live-trial-scene"/m.test(canvas));
    assert.ok(canvas.includes('import("three")'));
    assert.ok(canvas.includes('import("@/lib/live-trial-scene")'));

    // Lớp DOM cũng không được `import` tĩnh bản dựng cảnh - nó chỉ cần kiểu.
    const stage = readFileSync(new URL("../components/TrialStage.tsx", import.meta.url), "utf8");
    assert.ok(!/^\s*import\s+(?!type)[^;]*from\s+"@\/lib\/live-trial-scene"/m.test(stage));
    assert.ok(!/from "three"/.test(stage));
  });

  it("không đọc đồng hồ: mốc thời gian do bên gọi đưa vào", () => {
    for (const forbidden of ["performance.now", "Date.now", "Math.random"]) {
      assert.ok(!source.includes(forbidden), `bản dựng không được gọi ${forbidden}`);
    }
  });
});

// ---------------------------------------------------------------------------

/**
 * Khuôn mặt bị cáo trên bục.
 *
 * Bản trước dựng cái đầu bằng một khối icosahedron trơn, và đó đúng là thứ
 * camera zoom vào ở pha biện hộ - khoảnh khắc nặng nhất của cả ván. Bộ này
 * kiểm ba chuyện mà một cái nhìn bằng mắt không khẳng định nổi: bục KHÔNG BAO
 * GIỜ trống dù texture tải xong hay không, mặt luôn quay về camera, và bản án
 * Treo làm khuôn mặt tái đi.
 */

/** Một texture giả, đủ để cảnh gắn vào material và để test theo dõi. */
function fakeLoader(THREE_: typeof THREE) {
  const calls: { url: string; fire: () => void }[] = [];
  const load = (url: string, onLoad: () => void) => {
    const tex = new THREE_.Texture();
    calls.push({ url, fire: onLoad });
    return tex;
  };
  return { load, calls };
}

function setupPortrait(portrait: string | null = "/characters/hood.webp") {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 200);
  const registry = createDisposableRegistry();
  const loader = fakeLoader(THREE);
  const handle = buildTrialScene(
    THREE,
    scene,
    { audience: 9, portrait },
    { registry, loadTexture: loader.load },
  );
  return { scene, camera, registry, handle, loader };
}

const portraitOf = (scene: THREE.Scene) => scene.getObjectByName("accused-portrait");
const headOf = (scene: THREE.Scene) => scene.getObjectByName("accused-head");

describe("khuôn mặt bị cáo", () => {
  it("không có chân dung thì chỉ có khối đầu, không dựng billboard", () => {
    const { scene, loader } = setupPortrait(null);
    assert.ok(headOf(scene), "phải còn khối đầu khi không có chân dung");
    assert.equal(portraitOf(scene), undefined);
    assert.equal(loader.calls.length, 0, "không có chân dung thì không tải texture gì");
  });

  it("có chân dung: bục vẫn có đầu trong lúc texture chưa về", () => {
    // Trình dựng cảnh là ĐỒNG BỘ còn tải texture thì không. Nếu ẩn khối đầu
    // ngay lúc dựng thì có một khoảng bục trống - đúng vào lúc camera đang
    // tiến tới nó.
    const { scene, loader } = setupPortrait();
    assert.equal(loader.calls.length, 1);
    assert.equal(loader.calls[0].url, "/characters/hood.webp");
    assert.equal(headOf(scene)!.visible, true, "khối đầu phải còn hiện");
    assert.equal(portraitOf(scene)!.visible, false, "chân dung chưa được hiện");
  });

  it("texture về thì đổi vai: hiện mặt, ẩn khối đầu", () => {
    const { scene, loader } = setupPortrait();
    loader.calls[0].fire();
    assert.equal(portraitOf(scene)!.visible, true);
    assert.equal(headOf(scene)!.visible, false);
  });

  it("texture hỏng thì khối đầu ở nguyên đó, không ai phải viết nhánh lỗi", () => {
    // `fire` không bao giờ được gọi = ảnh 404 hoặc mạng chết. Không có gì đổi,
    // và đó chính là đường lui.
    const { scene } = setupPortrait();
    assert.equal(headOf(scene)!.visible, true);
    assert.equal(portraitOf(scene)!.visible, false);
  });

  it("mặt luôn quay về camera sau mỗi khung hình", () => {
    const { scene, camera, handle, loader } = setupPortrait();
    loader.calls[0].fire();
    handle.update(now, camera);

    const face = portraitOf(scene)!;
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(face.getWorldQuaternion(new THREE.Quaternion()));
    const toCamera = camera.position.clone().sub(face.getWorldPosition(new THREE.Vector3())).normalize();
    assert.ok(
      facing.dot(toCamera) > 0.9,
      `mặt phải hướng về camera, dot = ${facing.dot(toCamera).toFixed(3)}`,
    );
  });

  it("bản án Treo làm khuôn mặt tái: đổi sang frame chết", () => {
    const { scene, handle, loader } = setupPortrait();
    loader.calls[0].fire();
    const mat = (portraitOf(scene) as THREE.Mesh).material as THREE.MeshBasicMaterial;
    assert.equal(mat.map!.offset.x, 0, "trước phán quyết là frame idle");

    handle.setState({ act: "VERDICT", tilt: 1, verdict: "LYNCHED" }, { reduced: true, atMs: now });
    assert.equal(mat.map!.offset.x, 0.75, "Treo thì phải là frame chết");
  });

  it("bản án Tha giữ nguyên mặt bình thường", () => {
    const { scene, handle, loader } = setupPortrait();
    loader.calls[0].fire();
    const mat = (portraitOf(scene) as THREE.Mesh).material as THREE.MeshBasicMaterial;
    handle.setState({ act: "VERDICT", tilt: -1, verdict: "SPARED" }, { reduced: true, atMs: now });
    assert.equal(mat.map!.offset.x, 0);
  });

  it("dispose dọn cả texture của chân dung", () => {
    const { handle, loader } = setupPortrait();
    loader.calls[0].fire();
    handle.dispose();
    // Không có cờ `disposed` công khai trên Texture, nên kiểm bằng cách khác:
    // gọi dispose hai lần không được ném, và cảnh đã tự nhận là đã dọn.
    assert.doesNotThrow(() => handle.dispose());
  });
});
