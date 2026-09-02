"use client";

import { useEffect, useRef, useState } from "react";
import type { CinematicKind } from "@/lib/cinematic-transition";
import { renderScale } from "@/lib/cinematic-webgl";

type ThreeModule = typeof import("three");
type Scene3D = import("three").Scene;
type Renderer3D = import("three").WebGLRenderer;

/**
 * MỘT renderer cho cả phiên.
 *
 * Component này bị remount mỗi lần đổi cảnh, nhưng context WebGL thì không được
 * đi theo. Tạo context tốn hàng chục ms, trình duyệt chỉ cấp vài context đồng
 * thời, và `renderer.dispose()` KHÔNG thật sự trả context lại ở mọi trình duyệt.
 * Dựng lại mỗi cảnh nghĩa là mười lần một ván - đủ để chạm trần rồi
 * `getContext` bắt đầu trả null giữa ván.
 */
let sharedRenderer: Renderer3D | null = null;

function getRenderer(THREE: ThreeModule): Renderer3D {
  if (!sharedRenderer) {
    sharedRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
  }
  return sharedRenderer;
}

/**
 * Vứt hẳn renderer. CHỈ gọi khi context đã mất - lúc đó nó không cứu được nữa.
 *
 * `forceContextLoss()` trước `dispose()`: dispose một mình để lại context sống
 * trong một số trình duyệt, và đó đúng là thứ đang làm hết quota.
 */
function destroyRenderer(): void {
  if (!sharedRenderer) return;
  sharedRenderer.forceContextLoss();
  sharedRenderer.dispose();
  sharedRenderer = null;
}

interface Props {
  kind: CinematicKind;
  /** Cảnh phải trọn vẹn trong khoảng này. Overlay tự gọi finish khi hết. */
  durationMs: number;
  /** Dựng hỏng hoặc mất context. Bên gọi rơi vĩnh viễn về đường video/CSS. */
  onFail: () => void;
}

/**
 * Lớp 3D nằm CHỒNG LÊN cảnh CSS, không thay nó.
 *
 * Giống hệt cách `<video>` đang làm trong cùng overlay: mờ 0 cho tới khung hình
 * đầu tiên rồi hiện dần vào. Nhờ vậy lưới an toàn có sẵn mà không phải viết gì -
 * WebGL chết giữa chừng thì cảnh CSS vẫn đang nằm bên dưới, người chơi thấy bản
 * phẳng chứ không thấy màn đen.
 */
export function CinematicCanvas({ kind, durationMs, onFail }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let painted = false;
    let frame = 0;
    let cleanup: (() => void) | undefined;

    /*
     * `import()` động, không import tĩnh ở đầu file.
     *
     * Đúng lý do mà `MotionProvider` lazy-load `domAnimation`: import tĩnh sẽ
     * gói ~600KB three.js vào chunk đầu của MỌI người, kể cả người không bao
     * giờ thấy một cảnh 3D nào.
     */
    void (async () => {
      try {
        const THREE = await import("three");
        if (disposed) return;

        // Renderer ở CẤP MODULE, không dựng lại mỗi cảnh. Component này bị
        // remount mỗi lần đổi cảnh (key theo lần phát), nhưng context thì
        // không được đi theo: tạo context tốn hàng chục ms, và
        // `renderer.dispose()` KHÔNG thật sự trả context ở mọi trình duyệt -
        // lặp mười lần một ván là chạm trần context rồi `getContext` trả null.
        const renderer = getRenderer(THREE);
        renderer.setPixelRatio(renderScale(window.devicePixelRatio));
        renderer.setSize(host.clientWidth, host.clientHeight);
        host.append(renderer.domElement);

        // Mất context là chuyện có thật trên điện thoại khi máy thiếu bộ nhớ.
        // Báo lên để bên gọi thôi hẳn, chứ không thử lại vô ích.
        const onLost = (event: Event) => {
          event.preventDefault();
          // Dừng vòng vẽ TRƯỚC khi huỷ renderer: `onFail` của bên gọi là một
          // setState, mà React gộp lô state - nên vẫn còn ít nhất một khung
          // hình được lên lịch, và khung đó sẽ gọi render() trên một renderer
          // đã dispose rồi ném lỗi. Mất context vốn đã là lúc máy đang thiếu
          // bộ nhớ; không nên chồng thêm một lỗi nữa lên đó.
          disposed = true;
          cancelAnimationFrame(frame);
          destroyRenderer();
          onFail();
        };
        renderer.domElement.addEventListener("webglcontextlost", onLost);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
          50,
          host.clientWidth / host.clientHeight,
          0.1,
          100,
        );
        camera.position.set(0, 0, 6);

        const built = buildNightfall(THREE, scene);

        const started = performance.now();
        const tick = () => {
          if (disposed) return;
          // Tiến độ theo THỜI GIAN, không theo số khung đã vẽ: máy chậm phải
          // thấy cùng một cảnh với ít khung hơn, chứ không phải một cảnh chạy
          // chậm lại rồi bị overlay cắt ngang giữa chừng.
          const t = Math.min(1, (performance.now() - started) / durationMs);
          built.update(t, camera);
          renderer.render(scene, camera);
          // Cờ cục bộ, KHÔNG đọc state `ready`: cho `ready` vào deps của effect
          // thì lần setReady đầu tiên sẽ chạy lại effect, tháo scene rồi dựng
          // lại, vẽ tiếp, và lặp vô tận.
          if (!painted) {
            painted = true;
            setReady(true);
          }
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);

        const onResize = () => {
          renderer.setSize(host.clientWidth, host.clientHeight);
          camera.aspect = host.clientWidth / host.clientHeight;
          camera.updateProjectionMatrix();
        };
        window.addEventListener("resize", onResize);

        cleanup = () => {
          cancelAnimationFrame(frame);
          window.removeEventListener("resize", onResize);
          renderer.domElement.removeEventListener("webglcontextlost", onLost);
          // Trả GPU memory của SCENE. Renderer thì giữ lại - nó dùng chung cho
          // mọi cảnh trong phiên, và huỷ nó là tự chuốc lấy đúng cái trần
          // context mà singleton này sinh ra để tránh.
          built.dispose();
          scene.clear();
          renderer.domElement.remove();
        };
      } catch {
        // three.js không tải được, hoặc máy từ chối cấp context. Không có gì
        // để cứu - báo lên và để cảnh CSS bên dưới làm nốt việc.
        if (!disposed) onFail();
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cleanup?.();
    };
    // `ready` KHÔNG được nằm trong deps - xem chú thích ở chỗ setReady. `onFail`
    // phải ổn định (bên gọi bọc trong useCallback), nếu không thì mỗi lần cha
    // render lại là một lần tháo/dựng lại scene.
  }, [kind, durationMs, onFail]);

  return (
    <div
      ref={hostRef}
      aria-hidden="true"
      className={`absolute inset-0 transition-opacity duration-300 ${
        ready ? "opacity-100" : "opacity-0"
      }`}
    />
  );
}

interface BuiltScene {
  update(t: number, camera: import("three").PerspectiveCamera): void;
  dispose(): void;
}

/**
 * Màn đêm buông xuống.
 *
 * Nối tiếp bảng màu của `.cine-nightfall` chứ không vẽ lại: nền xanh đen, ánh
 * lạnh ở góc trên phải, siluet làng ở đáy. Phần 3D thêm vào đúng thứ CSS không
 * làm được - trăng có khối và đổ sáng thật, sương có chiều sâu, và làng tách
 * thành mấy lớp theo trục z nên camera nhích một chút là có thị sai.
 *
 * Camera chỉ nhích rất nhẹ: đây là đoạn chuyển cảnh 1,2 giây xem mười lần một
 * ván, không phải một đoạn phim mở đầu.
 */
function buildNightfall(THREE: ThreeModule, scene: Scene3D): BuiltScene {
  const disposables: { dispose(): void }[] = [];

  const moonLight = new THREE.PointLight(0x7896dc, 40, 40);
  moonLight.position.set(3.2, 3.0, 1.5);
  scene.add(moonLight);
  scene.add(new THREE.AmbientLight(0x0a1226, 2));

  const moonGeo = new THREE.SphereGeometry(0.75, 32, 24);
  const moonMat = new THREE.MeshStandardMaterial({
    color: 0xdfe8ff,
    emissive: 0x9db2d5,
    emissiveIntensity: 0.8,
    roughness: 1,
  });
  const moon = new THREE.Mesh(moonGeo, moonMat);
  moon.position.set(3.2, 2.2, 0);
  scene.add(moon);
  disposables.push(moonGeo, moonMat);

  // Ba lớp sương ở ba độ sâu khác nhau. Trôi ngang ở tốc độ khác nhau, nên
  // phối cảnh tự sinh ra cảm giác dày chứ không phải một tấm phẳng mờ.
  const fogLayers = [-1, -3, -6].map((z, index) => {
    const geo = new THREE.PlaneGeometry(26, 7);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x78a0dc,
      transparent: true,
      opacity: 0.05 + index * 0.03,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, -1.2 - index * 0.35, z);
    scene.add(mesh);
    disposables.push(geo, mat);
    return mesh;
  });

  // Siluet làng: mấy khối hộp ở hai độ sâu. Đen tuyền - nó là bóng, không phải
  // vật thể được chiếu sáng.
  const houseMat = new THREE.MeshBasicMaterial({ color: 0x02030a });
  disposables.push(houseMat);
  // Chiều cao gốc của từng nhà, giữ lại vì `update` cần nó để bù vị trí khi
  // scale: scale.y giãn quanh GỐC của khối, nên không bù thì nhà co giãn quanh
  // tâm và đáy nhà rời khỏi đường chân trời.
  const houseHeights = [-4.5, -3, -1.6, 0.2, 1.8, 3.4, 4.8].map(
    (_x, index) => 1.1 + ((index * 37) % 9) / 10,
  );
  const houses = [-4.5, -3, -1.6, 0.2, 1.8, 3.4, 4.8].map((x, index) => {
    const geo = new THREE.BoxGeometry(1.1, houseHeights[index], 1);
    const mesh = new THREE.Mesh(geo, houseMat);
    mesh.position.set(x, -2.6 + houseHeights[index] / 2, index % 2 === 0 ? -0.5 : -2.2);
    scene.add(mesh);
    disposables.push(geo);
    return mesh;
  });

  return {
    update(t, camera) {
      // Trăng mọc: đi lên và sáng dần trong nửa đầu cảnh.
      moon.position.y = 1.5 + t * 1.2;
      moonLight.intensity = 40 * Math.min(1, t * 2);

      // Sương trôi ngang, lớp gần nhanh hơn lớp xa.
      fogLayers.forEach((layer, index) => {
        layer.position.x = -t * (1.6 - index * 0.4);
      });

      // Làng trồi lên từ đáy, giống `cine-village-rise` của bản CSS.
      const rise = 1 - Math.pow(1 - t, 3);
      // scale.y quanh gốc của khối, nên phải bù lại vị trí để đáy nhà đứng
      // yên trên đường chân trời thay vì nhà co giãn quanh tâm nó.
      houses.forEach((house, index) => {
        const full = houseHeights[index];
        house.scale.y = 0.55 + rise * 0.45;
        house.position.y = -2.6 + (full * house.scale.y) / 2;
      });

      // Camera nhích RẤT nhẹ để sinh thị sai giữa các lớp. 0.25 đơn vị trên cả
      // cảnh - đủ để thấy chiều sâu, không đủ để thành một cú lia máy.
      camera.position.x = -0.25 * rise;
      camera.lookAt(0, 0, 0);
    },
    dispose() {
      for (const item of disposables) item.dispose();
    },
  };
}
