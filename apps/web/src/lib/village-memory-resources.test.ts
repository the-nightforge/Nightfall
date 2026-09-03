import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyStepToScene,
  createDisposableRegistry,
  createVillageResources,
  teardownVillage,
  type VillageResources,
} from "./village-memory-resources";

/**
 * Một bộ tài nguyên giả, ghi lại đúng thứ tự các bước dọn.
 *
 * `node:test` không có DOM, không có WebGL và không mount được React - nên phép
 * dọn phải nhận vào những vật thể giả được, và đó chính là lý do
 * `village-memory-resources` chỉ khai báo kiểu CẤU TRÚC thay vì import three.
 */
function fakes() {
  const log: string[] = [];
  return {
    log,
    cancelFrame: (handle: number) => log.push(`cancelFrame:${handle}`),
    detachLost: () => log.push("detach:contextlost"),
    detachVisibility: () => log.push("detach:visibilitychange"),
    observer: { disconnect: () => log.push("observer.disconnect") },
    built: { dispose: () => log.push("built.dispose") },
    canvas: { remove: () => log.push("canvas.remove") },
    renderer: {
      forceContextLoss: () => log.push("renderer.forceContextLoss"),
      dispose: () => log.push("renderer.dispose"),
    },
  };
}

/** Khởi tạo ĐÃ XONG: mọi ô trong túi đều có chủ. */
function fullyBuilt(): { resources: VillageResources; parts: ReturnType<typeof fakes> } {
  const parts = fakes();
  const resources = createVillageResources();
  resources.frame = 42;
  resources.cancelFrame = parts.cancelFrame;
  resources.detach.push(parts.detachLost, parts.detachVisibility);
  resources.observer = parts.observer;
  resources.scene = { clear: () => parts.log.push("scene.clear") };
  resources.built = parts.built;
  resources.canvas = parts.canvas;
  resources.renderer = parts.renderer;
  return { resources, parts };
}

describe("teardownVillage · khởi tạo thành công rồi đóng", () => {
  it("trả lại mọi thứ đã mượn", () => {
    const { resources, parts } = fullyBuilt();
    const result = teardownVillage(resources);

    assert.equal(result.ran, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(parts.log, [
      "cancelFrame:42",
      // Listener gỡ theo thứ tự NGƯỢC với lúc đăng ký.
      "detach:visibilitychange",
      "detach:contextlost",
      "observer.disconnect",
      "built.dispose",
      "canvas.remove",
      "renderer.forceContextLoss",
      "renderer.dispose",
    ]);
  });

  it("dừng vòng vẽ TRƯỚC khi trả bất kỳ tài nguyên GPU nào", () => {
    const { resources, parts } = fullyBuilt();
    teardownVillage(resources);
    const cancelAt = parts.log.indexOf("cancelFrame:42");
    for (const step of ["built.dispose", "renderer.dispose", "renderer.forceContextLoss"]) {
      assert.ok(cancelAt < parts.log.indexOf(step), `${step} chạy trước khi huỷ khung hình`);
    }
  });

  it("forceContextLoss đứng trước dispose", () => {
    const { resources, parts } = fullyBuilt();
    teardownVillage(resources);
    assert.ok(
      parts.log.indexOf("renderer.forceContextLoss") < parts.log.indexOf("renderer.dispose"),
    );
  });

  it("túi rỗng sạch, không giữ tham chiếu nào lại", () => {
    const { resources } = fullyBuilt();
    teardownVillage(resources);
    assert.equal(resources.renderer, null);
    assert.equal(resources.canvas, null);
    assert.equal(resources.built, null);
    assert.equal(resources.scene, null);
    assert.equal(resources.observer, null);
    assert.equal(resources.cancelFrame, null);
    assert.equal(resources.frame, 0);
    assert.deepEqual(resources.detach, []);
    assert.equal(resources.disposed, true);
  });

  it("không có khung nào đang chờ thì không gọi cancelFrame", () => {
    const { resources, parts } = fullyBuilt();
    resources.frame = 0;
    teardownVillage(resources);
    assert.ok(!parts.log.some((entry) => entry.startsWith("cancelFrame")));
  });
});

describe("teardownVillage · gọi hai lần", () => {
  it("lần thứ hai không làm gì cả", () => {
    const { resources, parts } = fullyBuilt();
    const first = teardownVillage(resources);
    const count = parts.log.length;

    const second = teardownVillage(resources);
    assert.equal(first.ran, true);
    assert.equal(second.ran, false);
    assert.deepEqual(second.errors, []);
    assert.equal(parts.log.length, count, "không được dispose lần hai");
  });

  it("context đã chết thì không ép mất lần nữa, nhưng vẫn dispose", () => {
    // `forceContextLoss` trên một context đã bị thu chỉ in ra một cảnh báo lạc
    // đề, đúng vào lúc người đi tìm nguyên nhân cần console sạch nhất.
    const { resources, parts } = fullyBuilt();
    resources.contextLost = true;
    teardownVillage(resources);
    assert.ok(!parts.log.includes("renderer.forceContextLoss"));
    assert.ok(parts.log.includes("renderer.dispose"));
  });

  it("mất context rồi React tháo ngay sau đó cũng chỉ dọn một lần", () => {
    // Máy hết bộ nhớ đồ hoạ đúng lúc người chơi bấm Đóng là chuyện có thật, và
    // lúc đó cả hai đường đều gọi vào đây.
    const { resources, parts } = fullyBuilt();
    teardownVillage(resources); // webglcontextlost
    teardownVillage(resources); // React cleanup
    assert.equal(parts.log.filter((entry) => entry === "renderer.dispose").length, 1);
    assert.equal(parts.log.filter((entry) => entry === "built.dispose").length, 1);
  });
});

describe("teardownVillage · khởi tạo dở dang", () => {
  it("mới có renderer và canvas thì vẫn trả được context", () => {
    // Đúng trạng thái khi `renderer.setSize` ném: context đã tồn tại, chưa có
    // scene, chưa có listener nào.
    const parts = fakes();
    const resources = createVillageResources();
    resources.renderer = parts.renderer;
    resources.canvas = parts.canvas;

    const result = teardownVillage(resources);
    assert.equal(result.ran, true);
    assert.deepEqual(parts.log, [
      "canvas.remove",
      "renderer.forceContextLoss",
      "renderer.dispose",
    ]);
  });

  it("buildVillageScene ném giữa chừng: vét geometry và material đã kịp vào scene", () => {
    const parts = fakes();
    const resources = createVillageResources();
    const geometry = { dispose: () => parts.log.push("geometry.dispose") };
    const shared = { dispose: () => parts.log.push("sharedMaterial.dispose") };
    const extra = { dispose: () => parts.log.push("extraMaterial.dispose") };

    resources.renderer = parts.renderer;
    resources.canvas = parts.canvas;
    // `built` VẮNG MẶT - hàm dựng đã ném trước khi trả về handle.
    resources.built = null;
    resources.scene = {
      clear: () => parts.log.push("scene.clear"),
      traverse: (visit) => {
        visit({ geometry, material: shared });
        // Cả làng dùng CHUNG vật liệu; vét không được dispose nó hai lần.
        visit({ geometry, material: [shared, extra] });
        visit({});
        visit(null);
      },
    };

    const result = teardownVillage(resources);
    assert.equal(result.ran, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(parts.log, [
      "geometry.dispose",
      "sharedMaterial.dispose",
      "extraMaterial.dispose",
      "scene.clear",
      "canvas.remove",
      "renderer.forceContextLoss",
      "renderer.dispose",
    ]);
  });

  it("có handle rồi thì KHÔNG vét scene nữa - handle biết rõ nó tạo những gì", () => {
    const { resources, parts } = fullyBuilt();
    resources.scene = {
      clear: () => parts.log.push("scene.clear"),
      traverse: () => parts.log.push("scene.traverse"),
    };
    teardownVillage(resources);
    assert.ok(!parts.log.includes("scene.traverse"));
    assert.ok(parts.log.includes("built.dispose"));
  });

  it("túi hoàn toàn rỗng - hỏng ngay ở import three - vẫn an toàn", () => {
    const resources = createVillageResources();
    const result = teardownVillage(resources);
    assert.equal(result.ran, true);
    assert.deepEqual(result.errors, []);
  });
});

describe("teardownVillage · lỗi giữa chừng", () => {
  it("một dispose hỏng KHÔNG chặn việc trả context", () => {
    const { resources, parts } = fullyBuilt();
    const boom = new Error("dispose hỏng");
    resources.built = {
      dispose: () => {
        throw boom;
      },
    };

    const result = teardownVillage(resources);
    assert.equal(result.ran, true);
    assert.deepEqual(result.errors, [boom], "lỗi được BÁO chứ không bị nuốt");
    assert.ok(parts.log.includes("renderer.forceContextLoss"));
    assert.ok(parts.log.includes("renderer.dispose"));
  });

  it("gỡ listener hỏng cũng không chặn phần còn lại", () => {
    const { resources, parts } = fullyBuilt();
    resources.detach.length = 0;
    resources.detach.push(() => {
      throw new Error("gỡ listener hỏng");
    });

    const result = teardownVillage(resources);
    assert.equal(result.errors.length, 1);
    assert.ok(parts.log.includes("observer.disconnect"));
    assert.ok(parts.log.includes("renderer.dispose"));
  });
});

describe("createDisposableRegistry", () => {
  it("trả lại mọi thứ đã ghi sổ, đúng thứ tự ghi", () => {
    const log: string[] = [];
    const registry = createDisposableRegistry();
    registry.track({ dispose: () => log.push("geometry") });
    registry.track({ dispose: () => log.push("material") });
    assert.equal(registry.size(), 2);

    assert.deepEqual(registry.disposeAll(), []);
    assert.deepEqual(log, ["geometry", "material"]);
    assert.equal(registry.size(), 0);
  });

  it("trả về chính vật thể được ghi, để dùng ngay trong một biểu thức", () => {
    const registry = createDisposableRegistry();
    const geometry = { dispose: () => {} };
    assert.equal(registry.track(geometry), geometry);
  });

  it("gọi hai lần thì lần sau không dispose lại gì", () => {
    const log: string[] = [];
    const registry = createDisposableRegistry();
    registry.track({ dispose: () => log.push("một") });
    registry.disposeAll();
    registry.disposeAll();
    assert.deepEqual(log, ["một"]);
  });

  it("một dispose hỏng không chặn những cái sau nó", () => {
    const log: string[] = [];
    const boom = new Error("hỏng");
    const registry = createDisposableRegistry();
    registry.track({
      dispose: () => {
        throw boom;
      },
    });
    registry.track({ dispose: () => log.push("vẫn chạy") });

    assert.deepEqual(registry.disposeAll(), [boom]);
    assert.deepEqual(log, ["vẫn chạy"]);
  });
});

describe("teardownVillage · buildVillageScene ném giữa chừng", () => {
  it("dọn cả thứ ĐÃ TẠO mà chưa kịp gắn vào scene", () => {
    /*
     * Đây là lỗ hổng mà sổ tài nguyên dựng ra để bịt, và nó không phải giả
     * tưởng: `buildVillageScene` tạo vài chục geometry trước khi `scene.add`
     * từng cái. Ném ở đúng khoảng giữa "đã tạo" và "đã gắn" thì phép vét scene
     * không thấy gì cả - nó chỉ duyệt được cây scene.
     */
    const parts = fakes();
    const registry = createDisposableRegistry();
    const attached = { dispose: () => parts.log.push("đã-vào-scene.dispose") };
    const orphan = registry.track({ dispose: () => parts.log.push("chưa-vào-scene.dispose") });
    registry.track(attached);

    const resources = createVillageResources();
    resources.renderer = parts.renderer;
    resources.canvas = parts.canvas;
    resources.registry = registry;
    // `built` VẮNG MẶT - hàm dựng đã ném trước khi trả về handle.
    resources.scene = {
      clear: () => parts.log.push("scene.clear"),
      traverse: (visit) => visit({ geometry: attached }),
    };

    const result = teardownVillage(resources);
    assert.equal(result.ran, true);
    assert.deepEqual(result.errors, []);
    assert.ok(parts.log.includes("chưa-vào-scene.dispose"), "geometry mồ côi phải được trả lại");
    // Sổ biết cả hai loại, nên không cần vét scene nữa - và không có gì bị trả
    // lại hai lần.
    assert.equal(parts.log.filter((entry) => entry === "đã-vào-scene.dispose").length, 1);
    assert.ok(parts.log.includes("scene.clear"));
    assert.equal(registry.size(), 0);
    assert.equal(typeof orphan.dispose, "function");
    // Và context vẫn được trả về, đúng như mọi đường dọn khác.
    assert.ok(parts.log.includes("renderer.dispose"));
  });

  it("dựng XONG thì handle tự dọn sổ, teardown không dọn lần nữa", () => {
    const { resources, parts } = fullyBuilt();
    const registry = createDisposableRegistry();
    registry.track({ dispose: () => parts.log.push("geometry.dispose") });
    resources.registry = registry;
    // Đúng như `buildVillageScene().dispose()` làm: nó dọn sổ của chính nó.
    resources.built = {
      dispose: () => {
        parts.log.push("built.dispose");
        registry.disposeAll();
      },
    };

    teardownVillage(resources);
    assert.equal(parts.log.filter((entry) => entry === "geometry.dispose").length, 1);
  });

  it("túi rỗng nhưng có sổ - hỏng ngay ở geometry đầu tiên - vẫn dọn được", () => {
    const log: string[] = [];
    const registry = createDisposableRegistry();
    registry.track({ dispose: () => log.push("một") });
    const resources = createVillageResources();
    resources.registry = registry;

    assert.equal(teardownVillage(resources).ran, true);
    assert.deepEqual(log, ["một"]);
    assert.equal(resources.registry, null);
  });

  it("lỗi trong sổ được BÁO chứ không bị nuốt", () => {
    const boom = new Error("geometry hỏng");
    const registry = createDisposableRegistry();
    registry.track({
      dispose: () => {
        throw boom;
      },
    });
    const parts = fakes();
    const resources = createVillageResources();
    resources.registry = registry;
    resources.renderer = parts.renderer;

    const result = teardownVillage(resources);
    assert.deepEqual(result.errors, [boom]);
    assert.ok(parts.log.includes("renderer.dispose"), "vẫn phải trả context về");
  });
});

describe("applyStepToScene", () => {
  it("đổi bước chỉ gọi setStep - không dựng lại gì", () => {
    const calls: Array<{ step: string; glide: boolean }> = [];
    const handle = {
      setStep(step: string, options: { glide: boolean }) {
        calls.push({ step, glide: options.glide });
      },
    };

    assert.equal(applyStepToScene(handle, "một", { glide: true }), true);
    assert.equal(applyStepToScene(handle, "hai", { glide: true }), true);
    assert.equal(applyStepToScene(handle, "ba", { glide: false }), true);
    assert.deepEqual(calls, [
      { step: "một", glide: true },
      { step: "hai", glide: true },
      { step: "ba", glide: false },
    ]);
  });

  it("cảnh đã bị dọn thì đổi bước KHÔNG chạm vào nó", () => {
    // Sau khi mất context, React còn ít nhất một lần render nữa, và lần đó có
    // thể mang theo một bước mới. `setStep` trên một cảnh đã trả GPU là lỗi
    // lúc chạy, không phải một no-op.
    assert.equal(applyStepToScene(null, "một", { glide: true }), false);
  });
});
