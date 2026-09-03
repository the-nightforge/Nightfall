"use client";

import { useEffect, useRef, useState } from "react";
import { renderScale } from "@/lib/cinematic-webgl";
import type { VillageMemoryModel, VillageStep } from "@/lib/village-memory";
import { cameraGlide, frameLoopRuns } from "@/lib/village-memory-playback";
import {
  applyStepToScene,
  createDisposableRegistry,
  createVillageResources,
  teardownVillage,
  type VillageTeardownReport,
} from "@/lib/village-memory-resources";
import type { VillageSceneHandle } from "@/lib/village-memory-webgl";

interface Props {
  model: VillageMemoryModel;
  /** Bước đang chiếu; `null` là cảnh mở đầu nhìn toàn cảnh. */
  step: VillageStep | null;
  /**
   * Người xem đã bật giảm chuyển động.
   *
   * Truyền thẳng cờ NGUYÊN NHÂN xuống chứ không chỉ truyền "có lia camera
   * không": bản dựng cảnh phải tắt nhiều thứ khác nữa - sương trôi, đèn nhấp
   * nháy, cây đung đưa, nhịp đập của vành sắc vai, rung máy - và suy ngược một
   * cờ ra từ cờ kia (`reduced = !glide`) là một mối buộc ngầm sẽ đứt ngay lần
   * đầu có ai đó muốn tắt riêng cú lia.
   */
  reduced: boolean;
  /**
   * Không dựng được, hoặc context đã mất. Bên gọi chuyển hẳn sang bản 2D và
   * KHÔNG dựng lại component này - xem `rendererState`.
   */
  onFail: () => void;
}

/** Không nuốt lỗi: dọn xong thì nói ra chuyện gì đã hỏng trong lúc dọn. */
function report(result: VillageTeardownReport, cause?: unknown): void {
  if (cause !== undefined) console.error("[hồi ức] dựng cảnh 3D thất bại:", cause);
  for (const error of result.errors) {
    console.error("[hồi ức] lỗi khi trả lại tài nguyên WebGL:", error);
  }
}

/**
 * Vòng đời renderer của "Hồi ức Ngôi Làng".
 *
 * Chỉ có ĐÚNG MỘT việc: dựng renderer khi được mount, giữ vòng vẽ, và trả lại
 * sạch sẽ khi bị tháo. Nội dung cảnh nằm ở `village-memory-webgl`, nút bấm và
 * chữ nằm ở `VillageMemoryExperience`, còn phép dọn nằm ở
 * `village-memory-resources` - nơi nó test được mà không cần DOM.
 *
 * KHÁC hẳn `CinematicCanvas` ở một điểm, và đó là điểm quan trọng nhất:
 * renderer ở đây KHÔNG dùng chung ở cấp module. Cảnh chuyển pha bị dựng lại
 * mười lần một ván nên nó phải giữ context lại; còn màn hồi ức mở nhiều nhất
 * vài lần, và lời hứa của nó là "đóng dialog thì không còn context WebGL nào
 * sống". Một singleton ở đây sẽ giữ nguyên bộ nhớ GPU của cả ngôi làng trên
 * màn kết thúc ván cho tới khi người chơi rời trang.
 *
 * Component này chỉ được mount khi dialog đang mở VÀ máy còn đường dựng 3D, nên
 * ở màn GAME_OVER chưa ai bấm nút thì `three` chưa từng được tải.
 */
export function VillageMemoryCanvas({ model, step, reduced, onFail }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<VillageSceneHandle | null>(null);
  const [ready, setReady] = useState(false);

  /*
   * Bước hiện tại trong một ref, KHÔNG trong deps của effect dựng cảnh.
   *
   * Đây là chỗ dễ hỏng nhất của cả tính năng: cho `step` vào deps thì mỗi lần
   * bấm "Tiếp" là một lần tháo scene, huỷ renderer và tạo context mới - đúng
   * điều mà "không tạo renderer mới khi đổi bước" cấm. Effect dựng cảnh chỉ
   * phụ thuộc `model`, còn đổi bước đi qua effect thứ hai bên dưới.
   */
  const latest = useRef({ step, reduced });
  latest.current = { step, reduced };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /*
     * Túi tài nguyên có TRƯỚC chuỗi khởi tạo, không phải sau.
     *
     * Bản đầu gán hàm dọn ở cuối chuỗi, nên nó chỉ tồn tại khi mọi bước đã
     * thành công - đúng trường hợp không cần tới nó nhất. Giờ mỗi bước bỏ thành
     * quả của mình vào túi ngay khi có, và `teardownVillage` dọn đúng những gì
     * đang có: hỏng ở bước nào thì trả lại được tới bước đó.
     */
    const resources = createVillageResources();
    /** Chỉ React cleanup mới bật cờ này. `onFail` sau khi tháo là setState vào hư không. */
    let unmounted = false;

    const dismantle = (cause?: unknown): void => {
      // Handle phải rời tay TRƯỚC khi cảnh bị dispose: effect đổi bước bên dưới
      // đọc chính ref này, và `setStep` trên một cảnh đã trả GPU là một lỗi lúc
      // chạy chứ không phải một no-op.
      sceneRef.current = null;
      report(teardownVillage(resources), cause);
    };
    const fail = () => {
      if (!unmounted) onFail();
    };

    void (async () => {
      try {
        // Hai chunk, nạp song song và chỉ nạp ở đây: `three` và bản dựng cảnh
        // đều nằm ngoài chunk đầu của trang.
        const [THREE, webgl] = await Promise.all([
          import("three"),
          import("@/lib/village-memory-webgl"),
        ]);
        if (resources.disposed) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
        // Vào túi NGAY, trước cả `setSize` - hàm đó cũng ném được, và lúc đó
        // context đã tồn tại rồi.
        resources.renderer = renderer;
        resources.canvas = renderer.domElement;
        resources.cancelFrame = cancelAnimationFrame;

        // Trần 1.5 - cùng hằng số mà cảnh chuyển pha dùng. Một điện thoại DPR 3
        // render cảnh này ở độ phân giải gốc là bốn lần số pixel cần thiết.
        renderer.setPixelRatio(renderScale(window.devicePixelRatio));
        renderer.setSize(host.clientWidth, host.clientHeight, false);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.display = "block";
        host.append(renderer.domElement);

        /*
         * Mất context là chuyện có thật trên điện thoại thiếu bộ nhớ.
         *
         * Dọn TRỌN VẸN rồi mới báo lên. `onFail` là một setState, React gộp lô,
         * nên vẫn còn ít nhất một khung hình đã lên lịch - và khung đó sẽ gọi
         * `render()` trên một context đã chết. `teardownVillage` huỷ khung đó
         * trước tiên, và vì nó idempotent nên React cleanup chạy ngay sau cũng
         * không dispose lần hai.
         */
        const onLost = (event: Event) => {
          event.preventDefault();
          // Trình duyệt đã thu context rồi; `forceContextLoss` lúc này chỉ in
          // ra một cảnh báo lạc đề. Xem `VillageResources.contextLost`.
          resources.contextLost = true;
          dismantle();
          fail();
        };
        renderer.domElement.addEventListener("webglcontextlost", onLost);
        resources.detach.push(() =>
          renderer.domElement.removeEventListener("webglcontextlost", onLost),
        );

        const scene = new THREE.Scene();
        // Vào túi TRƯỚC `buildVillageScene`: hàm đó thêm vật thể vào scene dọc
        // đường, nên nếu nó ném giữa chừng thì scene là chỗ duy nhất còn với
        // tới được những geometry đã kịp tạo.
        resources.scene = scene;
        const camera = new THREE.PerspectiveCamera(
          42,
          Math.max(0.1, host.clientWidth / Math.max(1, host.clientHeight)),
          0.1,
          200,
        );
        /*
         * Sổ tài nguyên do PHÍA NÀY giữ, không phải do hàm dựng cảnh tự giữ.
         *
         * `buildVillageScene` tạo vài chục geometry rồi mới trả về handle. Ném ở
         * giữa - hết bộ nhớ đồ hoạ, hay một hằng số của three đổi tên sau khi
         * nâng phiên bản - thì phép vét scene chỉ với tới được những gì đã kịp
         * `scene.add`, còn phần vừa tạo xong thì không ai cầm. Sổ này cầm cả hai
         * loại, và `teardownVillage` dọn nốt.
         */
        const registry = createDisposableRegistry();
        resources.registry = registry;
        const built = webgl.buildVillageScene(THREE, scene, model, { registry });
        resources.built = built;
        sceneRef.current = built;
        built.setStep(latest.current.step, {
          // Khung hình ĐẦU TIÊN không bao giờ lia: không có cảnh nào để lia đi
          // khỏi, và một cú lia từ hư không là một cú giật.
          glide: false,
          reduced: latest.current.reduced,
          atMs: performance.now(),
        });

        let painted = false;
        const tick = () => {
          if (resources.disposed) return;
          const now = performance.now();
          built.update(now, camera);
          renderer.render(scene, camera);
          if (!painted) {
            painted = true;
            setReady(true);
          }
          resources.frame = requestAnimationFrame(tick);
        };

        const start = () => {
          if (resources.disposed || resources.frame !== 0) return;
          resources.frame = requestAnimationFrame(tick);
        };
        const stop = () => {
          if (resources.frame === 0) return;
          cancelAnimationFrame(resources.frame);
          resources.frame = 0;
        };

        // Tab bị ẩn thì DỪNG HẲN vòng vẽ. Trình duyệt đã bóp `rAF` ở tab nền
        // xuống rất thấp, nhưng "rất thấp" không phải là không - và một vòng vẽ
        // còn sống vẫn giữ nguyên bộ nhớ GPU của cả ngôi làng.
        //
        // Điều kiện đi qua `frameLoopRuns` chứ không viết thẳng `!document.hidden`:
        // đó là hàm có test, và ở đây là chỗ DUY NHẤT nó được thi hành.
        const sync = () => {
          // Component này chỉ tồn tại khi renderer đã dựng được, nên `mode` ở
          // đây luôn là "webgl"; cửa còn lại đã gác ở `rendererState`.
          if (frameLoopRuns({ mode: "webgl", hidden: document.hidden })) start();
          else stop();
        };
        document.addEventListener("visibilitychange", sync);
        resources.detach.push(() => document.removeEventListener("visibilitychange", sync));

        // ResizeObserver chứ không phải sự kiện `resize` của cửa sổ: trên điện
        // thoại, thanh địa chỉ trượt đi làm ô canvas đổi chiều cao mà cửa sổ
        // thì không báo gì cả.
        const observer = new ResizeObserver(() => {
          const width = host.clientWidth;
          const height = host.clientHeight;
          if (width === 0 || height === 0) return;
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        });
        resources.observer = observer;
        observer.observe(host);

        // Khởi động vòng vẽ SAU CÙNG: mọi thứ nó chạm tới giờ đã nằm trong túi,
        // nên không còn khoảng nào mà một khung hình chạy trước phép dọn.
        sync();
      } catch (error) {
        // three.js không tải được, máy từ chối cấp context, hay dựng cảnh hỏng
        // giữa chừng - đều dọn TRỌN VẸN trước, rồi mới rơi về bản 2D. Không thử
        // lại: máy vừa từ chối thì lần hai cũng vậy.
        dismantle(error);
        fail();
      }
    })();

    return () => {
      unmounted = true;
      dismantle();
    };
  }, [model, onFail]);

  // Đổi bước: chỉ đặt lại thông số trên những vật thể đã dựng sẵn. Không dựng
  // lại scene, không đụng tới renderer. `applyStepToScene` trả `false` khi cảnh
  // đã bị dọn - sau khi mất context, React còn ít nhất một lần render nữa, và
  // lần đó có thể mang theo một bước mới.
  useEffect(() => {
    applyStepToScene(sceneRef.current, step, {
      glide: cameraGlide(reduced),
      reduced,
      atMs: performance.now(),
    });
  }, [step, reduced]);

  return (
    <div
      ref={hostRef}
      // Toàn bộ nội dung đọc được nằm ở lớp phủ DOM bên dưới khung này - tên,
      // vai và trạng thái từng căn nhà ở `VillageRoster`. Bản dựng 3D không
      // mang thông tin nào mà chữ không nói.
      aria-hidden="true"
      className={`h-full w-full transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
    />
  );
}
