"use client";

import { useEffect, useRef, useState } from "react";
import { renderScale } from "@/lib/cinematic-webgl";
import type { TrialStageBeat } from "@/lib/live-trial";
import { createStageDirector } from "@/lib/live-trial-director";
import { createFrameLoop } from "@/lib/live-trial-loop";
import type { TrialSceneModel, TrialSceneState } from "@/lib/live-trial-scene";
import { frameLoopRuns } from "@/lib/village-memory-playback";
/*
 * Sổ tài nguyên dùng CHUNG với "Hồi ức Ngôi Làng".
 *
 * Module đó không biết Three.js tồn tại - toàn kiểu cấu trúc - nên `import` nó
 * ở đây không kéo thư viện 3D vào chunk này, và nó đã mang sẵn đúng thứ tự dọn
 * dẹp mà một renderer WebGL cần. Viết bản thứ hai của cùng phép dọn nghĩa là có
 * hai chỗ phải nhớ rằng "huỷ khung hình TRƯỚC khi trả context".
 */
import {
  createDisposableRegistry,
  createVillageResources as createWebglResources,
  teardownVillage as teardownWebgl,
  type VillageTeardownReport,
} from "@/lib/village-memory-resources";

interface Props {
  /**
   * Thông số dựng cảnh, phải ỔN ĐỊNH suốt một phiên toà.
   *
   * Đây là deps của effect dựng scene: một object mới ở mỗi snapshot nghĩa là
   * tháo renderer và xin context mới ở mỗi lá phiếu.
   */
  model: TrialSceneModel;
  state: TrialSceneState;
  /**
   * Khoá phiên toà - `TrialStageView.key`.
   *
   * Cảnh không cần nó để vẽ; nó cần để BIẾT BỎ: một lô nhịp diễn còn đang chờ
   * `three` tải xong mà phiên toà đã sang phiên khác thì lô ấy không được diễn.
   */
  sessionKey: string;
  /** Nhịp diễn của lô hiện tại; mảng RỖNG phải là cùng một mảng rỗng. */
  beats: TrialStageBeat[];
  /** Số thứ tự lô - xem `useLiveTrial`. Báo lại đúng số này khi đã cầm lô. */
  beatsId: number;
  /**
   * Báo đã cầm lô.
   *
   * Gọi ngay khi người điều phối nhận lô, KHÔNG đợi hiệu ứng diễn xong: giữ chờ
   * `three` tải xong cũng đã là nhận trách nhiệm, và lô ấy sẽ được diễn hoặc bị
   * bỏ theo chính sách của người điều phối. Đợi tới lúc diễn xong thì một lần
   * dựng lại sân khấu ở giữa sẽ khiến lô được phát ra lần thứ hai.
   */
  onBeatsTaken: (id: number) => void;
  reduced: boolean;
  /** Không dựng được, hoặc context đã mất. Bên gọi chuyển hẳn sang bản 2D. */
  onFail: () => void;
}

/** Không nuốt lỗi: dọn xong thì nói ra chuyện gì đã hỏng trong lúc dọn. */
function report(result: VillageTeardownReport, cause?: unknown): void {
  if (cause !== undefined) console.error("[phiên toà] cảnh 3D hỏng:", cause);
  for (const error of result.errors) {
    console.error("[phiên toà] lỗi khi trả lại tài nguyên WebGL:", error);
  }
}

/**
 * Vòng đời renderer của sân khấu phiên toà.
 *
 * ĐÚNG MỘT việc: dựng renderer khi được mount, giữ vòng vẽ, trả lại sạch sẽ khi
 * bị tháo. Nội dung cảnh nằm ở `live-trial-scene`, thứ tự nói chuyện với cảnh
 * nằm ở `live-trial-director`, còn mọi chữ - tên bị cáo, số phiếu, ngưỡng, nút
 * bấm - nằm ở lớp DOM trong `TrialStage`.
 *
 * Chỉ được mount khi người chơi đã BẬT tính năng và máy còn đường dựng 3D, nên
 * với thiết lập mặc định (tắt) thì `three` chưa từng được tải.
 *
 * Renderer KHÔNG dùng chung ở cấp module: một phiên toà kéo dài vài chục giây
 * rồi hết, và lời hứa của tính năng này là "hết phiên thì không còn context
 * WebGL nào sống". Một singleton sẽ giữ nguyên bộ nhớ GPU của cả sân khấu suốt
 * phần còn lại của ván.
 *
 * MỌI đường chạy vào cảnh đều đi qua `guard`. Đó không phải phòng thủ thừa:
 * `renderer.render` ném trong một callback của `requestAnimationFrame` thì lỗi
 * đó KHÔNG rơi vào try/catch của lúc khởi tạo - nó thoát ra ngoài, vòng vẽ chết
 * lặng lẽ, và thứ ở lại là một thẻ canvas trong suốt: không có cảnh, cũng không
 * có bản 2D thay thế. Đúng vào lúc người chơi phải bấm Treo hay Tha.
 */
export function TrialStageCanvas({
  model,
  state,
  sessionKey,
  beats,
  beatsId,
  onBeatsTaken,
  reduced,
  onFail,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  /*
   * Người điều phối sống ĐỘC LẬP với vòng đời của cảnh.
   *
   * Nó nhận trạng thái và nhịp diễn từ React ngay cả khi `three` còn đang tải,
   * rồi tự quyết định lô nào còn đáng diễn lúc cảnh sẵn sàng. Nếu nó nằm trong
   * effect dựng cảnh thì đúng khoảng thời gian cần nó nhất - lúc chưa có cảnh -
   * lại là lúc nó chưa tồn tại.
   */
  const directorRef = useRef(createStageDirector());

  /*
   * Trạng thái mới nhất trong một ref, KHÔNG trong deps của effect dựng cảnh.
   *
   * Đây là chỗ dễ hỏng nhất của cả tính năng: cho `state` vào deps thì mỗi lá
   * phiếu là một lần tháo scene, huỷ renderer và xin context mới - đúng điều mà
   * "không tạo lại renderer theo mỗi snapshot hoặc lá phiếu" cấm. Effect dựng
   * cảnh chỉ phụ thuộc `model`.
   */
  const latest = useRef({ state, sessionKey, reduced, beatsId, onBeatsTaken });
  latest.current = { state, sessionKey, reduced, beatsId, onBeatsTaken };

  /**
   * Đường hỏng DUY NHẤT của cả component.
   *
   * Đặt ở ref vì hai nơi rất xa nhau cùng cần nó: vòng vẽ nằm trong effect dựng
   * cảnh, còn effect áp trạng thái thì nằm ngoài. Mặc định là no-op để một lỗi
   * xảy ra trước lúc cảnh dựng xong không gọi vào hư không.
   */
  const crashRef = useRef<(cause: unknown) => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const director = directorRef.current;

    /*
     * Túi tài nguyên có TRƯỚC chuỗi khởi tạo, không phải sau: hỏng ở bước nào
     * thì trả lại được tới bước đó. Xem `village-memory-resources`.
     */
    const resources = createWebglResources();
    /** Chỉ React cleanup mới bật cờ này. `onFail` sau khi tháo là setState vào hư không. */
    let unmounted = false;

    const dismantle = (cause?: unknown): void => {
      // Người điều phối rời tay TRƯỚC khi cảnh bị dispose: effect áp trạng thái
      // bên dưới gọi thẳng vào nó, và `setState` trên một handle đã trả GPU là
      // một lỗi lúc chạy chứ không phải một no-op.
      director.release();
      report(teardownWebgl(resources), cause);
    };
    const fail = () => {
      if (!unmounted) onFail();
    };
    /**
     * Dọn TRỌN VẸN rồi mới rơi về bản 2D. Gọi bao nhiêu lần cũng được:
     * `teardownWebgl` idempotent, còn `onFail` chỉ đẩy một cờ một chiều.
     */
    const crash = (cause: unknown): void => {
      dismantle(cause);
      fail();
    };
    crashRef.current = crash;


    void (async () => {
      try {
        // Hai chunk, nạp song song và CHỈ ở đây: `three` lẫn bản dựng cảnh đều
        // nằm ngoài chunk đầu của phòng chơi.
        const [THREE, sceneModule] = await Promise.all([
          import("three"),
          import("@/lib/live-trial-scene"),
        ]);
        // Người chơi đã đóng sân khấu trong lúc chờ tải: không dựng gì nữa, và
        // không `onFail` - đây không phải một lỗi.
        if (resources.disposed) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
        // Vào túi NGAY, trước cả `setSize`: hàm đó cũng ném được, và lúc đó
        // context đã tồn tại rồi.
        resources.renderer = renderer;
        resources.canvas = renderer.domElement;
        resources.cancelFrame = cancelAnimationFrame;

        // Trần 1.5 - cùng hằng số với cảnh chuyển pha và màn hồi ức.
        renderer.setPixelRatio(renderScale(window.devicePixelRatio));
        renderer.setSize(host.clientWidth, host.clientHeight, false);
        renderer.domElement.style.width = "100%";
        renderer.domElement.style.height = "100%";
        renderer.domElement.style.display = "block";
        host.append(renderer.domElement);

        /*
         * Mất context là chuyện có thật trên điện thoại thiếu bộ nhớ, và ở đây
         * nó rơi đúng vào lúc người chơi đang phải bấm Treo hay Tha. Dọn TRỌN
         * VẸN rồi mới báo lên: `onFail` là một setState, React gộp lô, nên vẫn
         * còn ít nhất một khung hình đã lên lịch - và khung đó sẽ `render()`
         * trên một context đã chết.
         */
        const onLost = (event: Event) => {
          event.preventDefault();
          resources.contextLost = true;
          crash(undefined);
        };
        renderer.domElement.addEventListener("webglcontextlost", onLost);
        resources.detach.push(() =>
          renderer.domElement.removeEventListener("webglcontextlost", onLost),
        );

        const scene = new THREE.Scene();
        // Vào túi TRƯỚC `buildTrialScene`: hàm đó thêm vật thể vào scene dọc
        // đường, nên nếu nó ném giữa chừng thì scene là chỗ còn với tới được.
        resources.scene = scene;
        const camera = new THREE.PerspectiveCamera(
          42,
          Math.max(0.1, host.clientWidth / Math.max(1, host.clientHeight)),
          0.1,
          200,
        );

        // Sổ tài nguyên do PHÍA NÀY giữ: `buildTrialScene` tạo vài chục geometry
        // rồi mới trả handle, nên ném ở giữa thì phần chưa kịp `scene.add`
        // không còn ai cầm.
        const registry = createDisposableRegistry();
        resources.registry = registry;
        /*
         * Hàm tải texture do PHÍA NÀY đưa vào, không phải bản dựng cảnh tự gọi.
         *
         * `live-trial-scene` có một luật đã đặt từ trước: nó không được nhắc tới
         * `TextureLoader`, để việc dựng cảnh còn là một phép đồng bộ thuần chạy
         * được trong `node:test`. Chỗ đúng để tải là đây - nơi đã sở hữu
         * renderer, sổ tài nguyên và cả đường xử lý mất WebGL context.
         *
         * Không truyền `onError`: cảnh đã được dựng sao cho ảnh không về thì
         * khối đầu trơn ở nguyên đó. Im lặng ở đây là đường lui, không phải lỗi
         * bị nuốt.
         */
        const built = sceneModule.buildTrialScene(THREE, scene, model, {
          registry,
          loadTexture: (url, onLoad) => new THREE.TextureLoader().load(url, onLoad),
        });
        resources.built = built;

        /*
         * Vòng vẽ và cái lưới hứng lỗi của nó nằm ở `live-trial-loop` - một
         * module thuần, tiêm được `draw` biết ném, nên đường hỏng khó tái hiện
         * nhất của cả tính năng lại là đường được test kỹ nhất.
         *
         * `resources.frame` vẫn được cập nhật để `teardownWebgl` huỷ đúng khung
         * đang chờ: nó là túi tài nguyên, và huỷ khung là bước ĐẦU TIÊN của
         * phép dọn.
         */
        const loop = createFrameLoop({
          disposed: () => resources.disposed,
          now: () => performance.now(),
          draw: (frameNow) => {
            built.update(frameNow, camera);
            renderer.render(scene, camera);
          },
          requestFrame: (callback) => {
            resources.frame = requestAnimationFrame(callback);
            return resources.frame;
          },
          cancelFrame: (handle) => {
            cancelAnimationFrame(handle);
            resources.frame = 0;
          },
          onFirstPaint: () => setReady(true),
          onCrash: crash,
        });

        // Từ đây cảnh đã sẵn sàng: người điều phối áp trạng thái MỚI NHẤT rồi
        // mới xét lô đang chờ - và bỏ nó nếu nó đã nói về một chặng khác.
        if (!loop.guard(() => director.ready(built, performance.now()))) return;

        // Tab bị ẩn thì DỪNG HẲN vòng vẽ. Trình duyệt đã bóp `rAF` ở tab nền
        // xuống rất thấp, nhưng "rất thấp" không phải là không - và một vòng vẽ
        // còn sống vẫn giữ nguyên bộ nhớ GPU của cả sân khấu.
        const sync = () => {
          if (frameLoopRuns({ mode: "webgl", hidden: document.hidden })) loop.start();
          else loop.stop();
        };
        document.addEventListener("visibilitychange", sync);
        resources.detach.push(() => document.removeEventListener("visibilitychange", sync));

        // ResizeObserver chứ không phải sự kiện `resize` của cửa sổ: trên điện
        // thoại, thanh địa chỉ trượt đi làm ô canvas đổi chiều cao mà cửa sổ thì
        // không báo gì cả. Callback của nó cũng chạy ngoài mọi try/catch của
        // lúc khởi tạo, nên nó cần đúng cái lưới mà vòng vẽ đang dùng.
        const observer = new ResizeObserver(() => {
          loop.guard(() => {
            const width = host.clientWidth;
            const height = host.clientHeight;
            if (width === 0 || height === 0) return;
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
          });
        });
        resources.observer = observer;
        observer.observe(host);

        // Khởi động vòng vẽ SAU CÙNG: mọi thứ nó chạm tới giờ đã nằm trong túi.
        sync();
      } catch (error) {
        // three không tải được, máy từ chối cấp context, hay dựng cảnh hỏng giữa
        // chừng - đều dọn TRỌN VẸN trước, rồi mới rơi về bản 2D. Không thử lại:
        // máy vừa từ chối thì lần hai cũng vậy.
        crash(error);
      }
    })();

    return () => {
      unmounted = true;
      crashRef.current = () => {};
      dismantle();
    };
  }, [model, onFail]);

  // Đổi trạng thái: chỉ đặt lại thông số trên những vật thể đã dựng sẵn. Không
  // dựng lại scene, không đụng tới renderer. Người điều phối tự bỏ qua khi cảnh
  // chưa sẵn sàng hoặc đã bị tháo.
  useEffect(() => {
    try {
      directorRef.current.update(state, sessionKey, { reduced, atMs: performance.now() });
    } catch (error) {
      crashRef.current(error);
    }
  }, [state, sessionKey, reduced]);

  /*
   * Hiệu ứng KHÔNG có `reduced` trong deps.
   *
   * Người chơi gạt công tắc giảm chuyển động giữa phiên toà thì `reduced` đổi,
   * và nếu nó nằm trong deps thì cả lô nhịp diễn của lá phiếu trước sẽ chạy
   * LẠI - một con dấu thứ hai cho một lá phiếu duy nhất.
   */
  useEffect(() => {
    if (beats.length === 0) return;
    const current = latest.current;
    try {
      directorRef.current.play(beats, current.sessionKey, {
        reduced: current.reduced,
        atMs: performance.now(),
      });
    } catch (error) {
      crashRef.current(error);
      return;
    }
    /*
     * Báo đã cầm lô NGAY sau khi trao cho người điều phối.
     *
     * Từ đây lô không còn được phát ra nữa, nên một lần dựng lại sân khấu -
     * xoay ngang điện thoại, gạt công tắc, rơi về 2D rồi quay lại - không kéo
     * theo một màn mở đầu thứ hai. `beatsId` đọc từ ref để lần chạy thứ hai của
     * StrictMode báo đúng số cũ và bị `consumeLiveTrialBeats` bỏ qua.
     */
    current.onBeatsTaken(current.beatsId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats]);

  return (
    <div
      ref={hostRef}
      /*
       * Toàn bộ nội dung đọc được nằm ở lớp DOM ngay bên dưới khung này: tên bị
       * cáo, chặng, số phiếu, ngưỡng và trạng thái quyền nói. Bản dựng 3D không
       * mang một thông tin nào mà chữ không nói - đó vừa là điều kiện để đường
       * lui 2D còn dùng được, vừa là điều kiện để trình đọc màn hình không mất
       * gì cả.
       */
      aria-hidden="true"
      className={`h-full w-full transition-opacity duration-500 ${ready ? "opacity-100" : "opacity-0"}`}
    />
  );
}
