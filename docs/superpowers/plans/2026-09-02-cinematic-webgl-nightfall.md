# Chuyển cảnh 3D NIGHTFALL bằng WebGL — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng cảnh chuyển pha NIGHTFALL bằng three.js để có chiều sâu thật, không phá bất kỳ đường lui nào đang có, và không làm nóng điện thoại.

**Architecture:** three.js nạp bằng `import()` động nên không chạm chunk đầu. Canvas nằm CHỒNG LÊN cảnh CSS đang có (đúng cách `<video>` đang làm), nên cảnh CSS là lưới an toàn miễn phí. `playbackMode()` giữ nguyên ba giá trị; khả năng 3D là một vị từ riêng `canUseWebgl()`. Một renderer duy nhất, `requestAnimationFrame` chỉ chạy trong 1200ms của cảnh.

**Tech Stack:** Next.js 16, React 19, three.js `0.185.1` + `@types/three` `0.185.4`, test web bằng `node:test` qua `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-02-cinematic-webgl-nightfall-design.md`

## Global Constraints

- **three.js KHÔNG được nằm trong chunk đầu.** Nạp bằng `import()` động trong component, theo đúng khuôn `MotionProvider.tsx` dùng cho `domAnimation`. Phải chứng minh bằng số đo `.next/static/chunks`, không bằng lời.
- **Import theo tên, không `import * as THREE`.** Chỉ những lớp thật sự dùng.
- **`playbackMode()` giữ NGUYÊN ba giá trị** `"video" | "css" | "none"`. Không thêm bậc thứ tư — `prefetchPlan` có `if (inputs.mode !== "video") return empty`, nên một bậc mới sẽ ngừng prefetch cả chín clip còn lại.
- **DPR:** `Math.min(devicePixelRatio, 1.5)` — chặn trần, không đặt cứng.
- **`requestAnimationFrame` chỉ chạy khi đang phát.** Ngoài 1200ms đó không vẽ khung nào. Đây là toàn bộ lý do việc này khả thi trên điện thoại.
- **Một renderer duy nhất**, dựng lười ở cảnh 3D đầu tiên, tháo khi overlay tháo. KHÔNG tạo/huỷ context mỗi lần chuyển pha.
- **Tiến độ lấy từ thời gian đã trôi chia `durationMs`**, không đếm khung hình. Máy chậm phải thấy cùng một cảnh với ít khung hơn.
- **Chỉ NIGHTFALL.** Chín cảnh còn lại giữ nguyên đường video/CSS, không biết gì về WebGL.
- Comment tiếng Việt, giải thích VÌ SAO. Không đụng `cinematics.css`.
- Lệnh kiểm: `npm run lint`, `npm run test`, `npm run build --workspace @masoi/web`.

---

### Task 1: Vị từ năng lực và tỉ lệ render — module thuần + test

Phần duy nhất của việc này có logic đáng test tự động. Web không có hạ tầng test component, và một scene WebGL thì càng không.

**Files:**
- Create: `apps/web/src/lib/cinematic-webgl.ts`
- Test: `apps/web/src/lib/cinematic-webgl.test.ts`

**Interfaces:**
- Consumes: `CinematicKind` từ `@/lib/cinematic-transition`; `PlaybackInputs` từ `@/lib/cinematic-settings`.
- Produces:
  - `WEBGL_KINDS: ReadonlySet<CinematicKind>` — các cảnh CÓ scene 3D. Bản thử nghiệm chứa đúng `"NIGHTFALL"`.
  - `hasWebglScene(kind: CinematicKind): boolean`
  - `canUseWebgl(inputs: WebglInputs): boolean`
  - `interface WebglInputs { mode: "video" | "css" | "none"; saveData: boolean; webgl2: boolean }`
  - `renderScale(devicePixelRatio: number): number`
  - `MAX_RENDER_SCALE = 1.5`

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/web/src/lib/cinematic-webgl.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_RENDER_SCALE,
  canUseWebgl,
  hasWebglScene,
  renderScale,
} from "./cinematic-webgl";

describe("hasWebglScene", () => {
  it("chỉ NIGHTFALL có scene 3D ở bản thử nghiệm", () => {
    assert.equal(hasWebglScene("NIGHTFALL"), true);
    assert.equal(hasWebglScene("DAWN"), false);
    assert.equal(hasWebglScene("WOLVES_WIN"), false);
  });
});

describe("renderScale", () => {
  it("chặn TRẦN chứ không đặt cứng", () => {
    // Màn thường DPR 1 phải render ở 1, không bị kéo lên 1.5.
    assert.equal(renderScale(1), 1);
    assert.equal(renderScale(1.25), 1.25);
  });

  it("điện thoại DPR cao bị chặn lại", () => {
    // 1080x2400 ở DPR 3 là 7,7 triệu pixel mỗi khung; chặn ở 1.5 giảm ~4 lần.
    assert.equal(renderScale(3), MAX_RENDER_SCALE);
    assert.equal(renderScale(2), MAX_RENDER_SCALE);
  });

  it("giá trị vô lý không làm vỡ", () => {
    assert.equal(renderScale(0), 1);
    assert.equal(renderScale(-2), 1);
    assert.equal(renderScale(Number.NaN), 1);
  });
});

describe("canUseWebgl", () => {
  const ok = { mode: "video" as const, saveData: false, webgl2: true };

  it("máy đủ điều kiện thì cho chạy", () => {
    assert.equal(canUseWebgl(ok), true);
  });

  it("không có WebGL2 thì không", () => {
    assert.equal(canUseWebgl({ ...ok, webgl2: false }), false);
  });

  it("Save-Data thì không - người dùng đã nói là đừng tải hộ", () => {
    assert.equal(canUseWebgl({ ...ok, saveData: true }), false);
  });

  it('mode "none" thì không: đó là reduced-motion hoặc công tắc trong game', () => {
    assert.equal(canUseWebgl({ ...ok, mode: "none" }), false);
  });

  it('mode "css" thì không: máy đã bị hạ bậc vì một lý do nào đó', () => {
    assert.equal(canUseWebgl({ ...ok, mode: "css" }), false);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận nó ĐỎ**

```bash
npx tsx --test apps/web/src/lib/cinematic-webgl.test.ts
```

Kỳ vọng: FAIL — `Cannot find module './cinematic-webgl'`.

- [ ] **Step 3: Viết bản cài đặt tối thiểu**

Tạo `apps/web/src/lib/cinematic-webgl.ts`:

```ts
import type { CinematicKind } from "./cinematic-transition";

/**
 * Những cảnh CÓ bản dựng 3D.
 *
 * Tường minh chứ không suy ra từ việc có file hay không: thêm một cảnh 3D về
 * sau là thêm một phần tử vào đây, và `CinematicKind` khiến trình biên dịch bắt
 * ngay nếu tên cảnh viết sai.
 */
export const WEBGL_KINDS: ReadonlySet<CinematicKind> = new Set<CinematicKind>(["NIGHTFALL"]);

export function hasWebglScene(kind: CinematicKind): boolean {
  return WEBGL_KINDS.has(kind);
}

/**
 * Trần tỉ lệ render.
 *
 * Một máy 1080x2400 ở DPR 3 là 7,7 triệu pixel mỗi khung. Với hiệu ứng phủ toàn
 * màn thì đây là đòn bẩy lớn nhất, và ở một cảnh 1,2 giây mắt không phân biệt
 * được. Là TRẦN chứ không phải giá trị đặt cứng: màn DPR 1 vẫn render ở 1.
 */
export const MAX_RENDER_SCALE = 1.5;

export function renderScale(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  return Math.min(devicePixelRatio, MAX_RENDER_SCALE);
}

export interface WebglInputs {
  /** Kết quả `playbackMode()`. KHÔNG mở rộng enum đó - xem chú thích dưới. */
  mode: "video" | "css" | "none";
  saveData: boolean;
  webgl2: boolean;
}

/**
 * Máy này có được dựng cảnh 3D không.
 *
 * Là một vị từ RIÊNG chứ không phải một bậc thứ tư trong `playbackMode`, vì hai
 * thứ không cùng hình dạng: bậc mô tả "cả màn giàu tới đâu", còn cái này là khả
 * năng áp cho MỘT cảnh. Nhét nó vào enum kia sẽ hỏng thật: `prefetchPlan` mở
 * đầu bằng `if (inputs.mode !== "video") return empty`, nên một bậc mới sẽ
 * ngừng prefetch cả chín clip còn lại, và 900ms không đủ tải một clip.
 *
 * Đi ké quyết định của `playbackMode` thay vì đọc lại `prefers-reduced-motion`:
 * hàm kia đã cân ba lý do khác nhau và ghi rõ vì sao chúng không gộp được. Chỉ
 * `"video"` mới đủ điều kiện - `"css"` nghĩa là máy đã bị hạ bậc vì một lý do
 * nào đó, và một cảnh 3D còn nặng hơn một clip.
 */
export function canUseWebgl(inputs: WebglInputs): boolean {
  return inputs.mode === "video" && !inputs.saveData && inputs.webgl2;
}
```

- [ ] **Step 4: Chạy lại để xác nhận XANH**

```bash
npx tsx --test apps/web/src/lib/cinematic-webgl.test.ts
```

Kỳ vọng: PASS, 9 test.

- [ ] **Step 5: Cả bộ test web + lint**

```bash
npm run test --workspace @masoi/web && npm run lint --workspace @masoi/web
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/cinematic-webgl.ts apps/web/src/lib/cinematic-webgl.test.ts
git commit -m "feat(web): add the capability gate for 3D cinematic scenes"
```

---

### Task 2: Đừng tải clip của cảnh sẽ chạy 3D

Một máy dựng NIGHTFALL bằng WebGL không có lý do gì tải `nightfall.webm`. Nhưng chín clip còn lại VẪN phải prefetch như cũ — đó chính là chỗ mà việc thêm một bậc enum sẽ hỏng.

**Files:**
- Modify: `apps/web/src/lib/cinematic-transition.ts` (`PrefetchInputs` ~dòng 275, `prefetchPlan` ~dòng 309)
- Test: `apps/web/src/lib/cinematic-transition.test.ts` (thêm vào cuối)

**Interfaces:**
- Consumes: `hasWebglScene` từ Task 1.
- Produces: `PrefetchInputs` có thêm trường `webgl?: boolean`.

- [ ] **Step 1: Viết test đỏ**

Thêm vào cuối `apps/web/src/lib/cinematic-transition.test.ts`:

```ts
describe("prefetchPlan khi máy dựng được cảnh 3D", () => {
  const base = {
    phase: "NIGHT" as const,
    mode: "video" as const,
    saveData: false,
    effectiveType: "4g",
  };

  it("bỏ clip của cảnh có bản 3D, GIỮ mọi clip còn lại", () => {
    const withWebgl = prefetchPlan({ ...base, webgl: true });
    const without = prefetchPlan({ ...base, webgl: false });

    assert.ok(!withWebgl.now.includes("nightfall"));
    // Đây là hồi quy đáng sợ nhất: nếu cờ webgl vô tình tắt cả prefetch thì
    // chín cảnh kia im lặng tụt về CSS, và không có gì báo.
    assert.ok(withWebgl.now.length > 0 || without.now.length === 0);
    for (const clip of without.now) {
      if (clip !== "nightfall") assert.ok(withWebgl.now.includes(clip));
    }
    assert.deepEqual(withWebgl.idle, without.idle);
  });

  it("không truyền cờ thì hành vi y như cũ", () => {
    assert.deepEqual(prefetchPlan(base), prefetchPlan({ ...base, webgl: false }));
  });
});
```

Kiểm tra đầu file test đã import `prefetchPlan` chưa; nếu chưa, thêm vào import sẵn có từ `./cinematic-transition`.

- [ ] **Step 2: Chạy để xác nhận nó ĐỎ**

```bash
npx tsx --test apps/web/src/lib/cinematic-transition.test.ts
```

Kỳ vọng: FAIL — object literal có `webgl` mà `PrefetchInputs` không khai.

- [ ] **Step 3: Cài đặt**

Trong `apps/web/src/lib/cinematic-transition.ts`, thêm trường vào `PrefetchInputs`:

```ts
  /**
   * Máy này sẽ dựng cảnh 3D cho những kind có bản WebGL.
   *
   * Không tải clip của một cảnh sẽ không dùng tới clip. Là OPTIONAL để mọi chỗ
   * gọi cũ giữ nguyên hành vi.
   */
  webgl?: boolean;
```

và trong `prefetchPlan`, ngay sau khi tính `now`:

```ts
  const now = nextClips(inputs.phase).filter(
    (clip) => !(inputs.webgl === true && WEBGL_CLIPS.has(clip)),
  );
```

Thêm gần `EVENT_CLIPS`:

```ts
/**
 * Clip của những cảnh đã có bản 3D.
 *
 * Suy ra từ `WEBGL_KINDS` chứ không chép tay tên file: thêm một cảnh 3D thì
 * danh sách này tự đúng theo.
 */
const WEBGL_CLIPS = new Set<string>(
  [...WEBGL_KINDS].map((kind) => KIND_META[kind].clip),
);
```

và import ở đầu file:

```ts
import { WEBGL_KINDS } from "./cinematic-webgl";
```

- [ ] **Step 4: Kiểm không có vòng lặp import**

`cinematic-webgl.ts` chỉ `import type { CinematicKind }` từ `cinematic-transition.ts`. Import kiểu bị xoá lúc biên dịch nên không tạo vòng lặp lúc chạy. Xác nhận:

```bash
npx tsx --test apps/web/src/lib/cinematic-transition.test.ts
npx tsx --test apps/web/src/lib/cinematic-webgl.test.ts
```

Cả hai phải PASS. Nếu thấy lỗi kiểu `Cannot access before initialization`, đó là vòng lặp thật — đổi `import { WEBGL_KINDS }` thành một hằng cục bộ trong `cinematic-transition.ts` và ghi chú lý do.

- [ ] **Step 5: Lint + cả bộ test**

```bash
npm run lint --workspace @masoi/web && npm run test --workspace @masoi/web
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/cinematic-transition.ts apps/web/src/lib/cinematic-transition.test.ts
git commit -m "feat(web): stop prefetching a clip the device will render in 3D"
```

---

### Task 3: Cảnh NIGHTFALL 3D và vòng đời context

Task nặng nhất. Không có test tự động — không có hạ tầng test component, và một scene WebGL thì càng không. Task 5 đo trên máy thật.

**Files:**
- Modify: `apps/web/package.json` (thêm dependency)
- Create: `apps/web/src/components/CinematicCanvas.tsx`

**Interfaces:**
- Consumes: `renderScale` từ Task 1.
- Produces: `<CinematicCanvas kind={CinematicKind} durationMs={number} onFail={() => void} />` — dùng ở Task 4.

- [ ] **Step 1: Cài three.js**

```bash
npm install three@0.185.1 --workspace @masoi/web
npm install -D @types/three@0.185.4 --workspace @masoi/web
```

- [ ] **Step 2: Ghi lại kích thước bundle TRƯỚC khi dùng**

```bash
npm run build --workspace @masoi/web
find apps/web/.next/static/chunks -name "*.js" -printf "%s\n" | awk '{s+=$1} END {printf "%.0f KB\n", s/1024}'
```

Ghi con số này vào report. Task 5 so lại — cài dependency mà không import thì con số phải KHÔNG đổi.

- [ ] **Step 3: Viết component**

Tạo `apps/web/src/components/CinematicCanvas.tsx`:

```tsx
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
          if (!ready) setReady(true);
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
    // kind nằm trong deps để đổi cảnh là dựng lại scene; durationMs và onFail
    // ổn định trong một lần phát.
  }, [kind, durationMs, onFail, ready]);

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
```

- [ ] **Step 4: Viết cảnh**

Vẫn trong `CinematicCanvas.tsx`, dưới component:

```tsx
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
```

- [ ] **Step 5: Lint và build**

```bash
npm run lint --workspace @masoi/web && npm run build --workspace @masoi/web
```

Kỳ vọng: cả hai pass. Component chưa được dùng ở đâu nên bundle chưa đổi — Task 5 đo.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json package-lock.json apps/web/src/components/CinematicCanvas.tsx
git commit -m "feat(web): build the NIGHTFALL scene in three.js"
```

---

### Task 4: Cắm vào overlay

**Files:**
- Modify: `apps/web/src/components/CinematicOverlay.tsx` — `brokenClips` ~dòng 43, state ~dòng 50-58, effect prefetch ~dòng 140, `useVideo` ~dòng 184, chỗ render `<video>` ~dòng 215

**Interfaces:**
- Consumes: `canUseWebgl`, `hasWebglScene` (Task 1); `CinematicCanvas` (Task 3); `PrefetchInputs.webgl` (Task 2).
- Produces: không có gì cho task sau.

- [ ] **Step 1: Thêm state năng lực**

Cạnh `const brokenClips = new Set<string>();` (~dòng 43), thêm:

```tsx
/*
 * WebGL đã hỏng trong phiên này chưa.
 *
 * Ở cấp module đúng như `brokenClips`: mất context một lần là máy này không nên
 * bị thử lại ở mọi cảnh sau nữa, kể cả khi overlay tháo rồi dựng lại.
 */
let webglBroken = false;
```

Trong component, cạnh `const [mode, setMode] = useState(...)`:

```tsx
  const [webgl, setWebgl] = useState(false);
```

Trong effect đọc thiết lập (hàm `apply`, ~dòng 70), thêm ngay sau `setMode(...)`:

```tsx
      const inputs = readPlaybackInputs();
      setMode(playbackMode(inputs));
      setWebgl(
        !webglBroken &&
          canUseWebgl({
            mode: playbackMode(inputs),
            saveData: readNetworkHints().saveData,
            webgl2: hasWebgl2(),
          }),
      );
```

Giữ nguyên `setNetwork(readNetworkHints())` phía dưới.

Thêm helper ở cuối file:

```tsx
/**
 * Máy này có WebGL2 không.
 *
 * Thử tạo context trên một canvas rời rồi bỏ đi ngay: đây là cách duy nhất
 * biết chắc, vì `window.WebGL2RenderingContext` tồn tại kể cả trên máy mà
 * driver từ chối cấp context thật.
 */
function hasWebgl2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Truyền cờ vào prefetch**

Trong effect prefetch (~dòng 140), đổi:

```tsx
    const plan = prefetchPlan({
      phase: snapshot.phase,
      mode,
      saveData: network.saveData,
      effectiveType: network.effectiveType,
    });
```

thành:

```tsx
    const plan = prefetchPlan({
      phase: snapshot.phase,
      mode,
      saveData: network.saveData,
      effectiveType: network.effectiveType,
      webgl,
    });
```

và thêm `webgl` vào mảng deps ở cuối effect đó: `}, [mode, network, snapshot, webgl]);`

- [ ] **Step 3: Chọn lớp hình theo từng cảnh**

Đổi dòng `const useVideo = ...` (~dòng 184) thành:

```tsx
  // Thứ tự quyết định: 3D nếu cảnh này có bản 3D và máy dựng được; nếu không
  // thì clip; nếu không nữa thì chỉ còn cảnh CSS bên dưới. Một cảnh KHÔNG bao
  // giờ chạy cả canvas lẫn video - không có lý do gì tải hai bản của một cảnh.
  const useWebgl = webgl && !webglBroken && hasWebglScene(playing.kind);
  const useVideo = !useWebgl && mode === "video" && !brokenClips.has(playing.clip);
```

- [ ] **Step 4: Render canvas**

Ngay TRƯỚC khối `{useVideo && (` (~dòng 215), thêm:

```tsx
      {useWebgl && (
        <CinematicCanvas
          // key theo khoá lần phát: mỗi cảnh dựng lại scene từ đầu, đúng cách
          // thẻ <video> bên dưới đang làm.
          key={playing.key}
          kind={playing.kind}
          durationMs={playing.durationMs}
          onFail={() => {
            webglBroken = true;
            setWebgl(false);
          }}
        />
      )}
```

Thêm import ở đầu file:

```tsx
import { CinematicCanvas } from "./CinematicCanvas";
import { canUseWebgl, hasWebglScene } from "@/lib/cinematic-webgl";
```

và `readNetworkHints` phải nằm trong import sẵn có từ `@/lib/cinematic-settings` — kiểm và thêm nếu thiếu.

- [ ] **Step 5: Lint, test, build**

```bash
npm run lint --workspace @masoi/web && npm run test --workspace @masoi/web && npm run build --workspace @masoi/web
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/CinematicOverlay.tsx
git commit -m "feat(web): render NIGHTFALL in 3D where the device allows it"
```

---

### Task 5: Đo thật — bundle và máy thật

KHÔNG được bỏ qua và KHÔNG được tuyên bố bằng suy luận. Spec ghi rõ điều đó.

**Files:** không sửa gì, trừ khi phép đo bắt phải sửa.

- [ ] **Step 1: Chứng minh three.js không nằm trong đường tải đầu**

```bash
npm run build --workspace @masoi/web
find apps/web/.next/static/chunks -name "*.js" -printf "%s %p\n" | sort -rn | head -10
```

So với con số ghi ở Task 3 Step 2. Yêu cầu: có một chunk MỚI cỡ vài trăm KB (three.js), và nó KHÔNG phải chunk mà `/room/[code]` tải lúc đầu. Xác nhận bằng cách grep tên chunk trong output build, hoặc kiểm rằng tổng của các chunk vào thẳng route không tăng đáng kể. Ghi cả hai con số vào report.

- [ ] **Step 2: Dựng app chạy được**

Docker cần cho postgres + redis:

```bash
docker start masoi-postgres masoi-redis
npm run build:deps
```

Nếu Docker không chạy được, DỪNG và báo — Task này không thay thế được bằng suy luận. Nói rõ là chưa đo, đừng đoán.

- [ ] **Step 3: Đo trên máy thật**

Trên một điện thoại Android tầm trung, cùng mạng LAN, mở phòng và chơi đủ dài để NIGHTFALL nổ **ít nhất năm lần**. Xác nhận:
- máy không nóng lên rõ rệt
- pha ngay SAU chuyển cảnh không rơi khung (cuộn danh sách, bấm nút vẫn mượt)
- cảnh kết thúc đúng lúc chữ biến mất, không kéo dài quá

- [ ] **Step 4: Bốn đường lui**

1. Bật `prefers-reduced-motion`. Xác nhận KHÔNG có phần tử canvas nào trong DOM — không phải "có nhưng ẩn". Kiểm bằng `document.querySelector("canvas")` lúc cảnh đang chạy.
2. Bật Save-Data (Chrome > Settings > Lite mode, hoặc DevTools override). Xác nhận rơi về CSS.
3. Ép mất context giữa cảnh:
   ```js
   document.querySelector("canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()
   ```
   Xác nhận thấy cảnh CSS chứ không phải màn đen, và cảnh SAU đó cũng không thử dựng canvas nữa.
4. Xác nhận `nightfall.webm` KHÔNG xuất hiện trong tab Network khi máy đang chạy 3D, còn các clip khác thì vẫn có.

- [ ] **Step 5: Cổng cuối**

```bash
npm run lint && npm run test && npm run build --workspace @masoi/web
```

- [ ] **Step 6: Cập nhật README**

`README.md` có badge `tests-NNNN%20passing`, bảng đếm theo package và dòng tổng. Cả ba phải khớp số thật ở Step 5 (Task 1 thêm 9 test, Task 2 thêm 2).

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "docs: refresh the test count after the WebGL cinematic work"
```
