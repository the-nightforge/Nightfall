/**
 * Vòng đời tài nguyên WebGL của "Hồi ức Ngôi Làng".
 *
 * Tách khỏi component vì hai lý do, và lý do thứ hai mới là lý do thật:
 *
 *   1. Bộ test của web chạy bằng `node:test`, không có DOM và không mount được
 *      React. Muốn khẳng định "đóng dialog thì không còn context nào sống" thì
 *      phép dọn phải là một hàm thuần nhận vào những vật thể giả được.
 *   2. Bản đầu gán hàm dọn ở CUỐI chuỗi khởi tạo. Nghĩa là nó chỉ tồn tại khi
 *      mọi bước đã thành công - đúng trường hợp không cần tới nó nhất. Một lỗi
 *      ở `buildVillageScene`, `observer.observe` hay `renderer.setSize` thì
 *      `cleanup` vẫn là `undefined`, và cái rơi lại là một `WebGLRenderer` với
 *      context của nó, một `<canvas>` còn trong DOM, hai listener và một
 *      `ResizeObserver` - trên đúng cái máy vừa chứng minh là nó đang thiếu tài
 *      nguyên đồ hoạ.
 *
 * Cách chữa là đảo ngược thứ tự: cái túi tài nguyên có TRƯỚC, mỗi bước khởi tạo
 * bỏ thành quả của mình vào đó ngay khi có, và `teardownVillage` dọn đúng những
 * gì đang có trong túi. Khởi tạo dở tới đâu thì dọn được tới đó.
 *
 * KHÔNG `import` three ở đây, kể cả `import type`: file này được nạp tĩnh cùng
 * `VillageMemoryCanvas`, còn three thì nằm sau một `import()` động. Các kiểu ở
 * dưới là kiểu CẤU TRÚC, vừa đủ để nhận đúng vật thể của three mà không kéo
 * theo thư viện - và vừa đủ để test dựng ra bản giả bằng vài dòng.
 */

export interface DisposableLike {
  dispose(): void;
}

export interface RendererLike {
  forceContextLoss(): void;
  dispose(): void;
}

export interface CanvasLike {
  remove(): void;
}

export interface ObserverLike {
  disconnect(): void;
}

export interface SceneLike {
  clear?(): void;
  /**
   * `unknown` chứ không phải một kiểu hình-dạng-Mesh.
   *
   * `Object3D` của three KHÔNG có `geometry` hay `material` - chỉ `Mesh` mới
   * có - nên một tham số hình dạng-Mesh khiến `Scene` không gán được vào kiểu
   * này. Nhận `unknown` rồi tự lọc trong `salvageScene` mới đúng với việc đang
   * làm: duyệt một cây hỗn hợp và trả lại những gì có thể trả.
   */
  traverse?(visit: (object: unknown) => void): void;
}

/** Vừa đủ hình dạng của một `Mesh`: cái gì có thể phải trả lại cho GPU. */
interface DisposableHolder {
  geometry?: DisposableLike | null;
  material?: DisposableLike | DisposableLike[] | null;
}

function asHolder(value: unknown): DisposableHolder | null {
  return typeof value === "object" && value !== null ? (value as DisposableHolder) : null;
}

/**
 * Sổ ghi những gì đã mượn của GPU, và cách trả lại tất cả một lượt.
 *
 * Sống ở đây chứ không nằm trong `buildVillageScene` vì đúng cái lỗ hổng mà nó
 * dựng ra để bịt: hàm dựng cảnh tạo vài chục geometry rồi mới trả về handle, nên
 * nếu nó ném ở GIỮA thì một sổ cục bộ mất theo stack. Phép vét scene bên dưới
 * chỉ với tới được những gì đã kịp `scene.add`; một `BufferGeometry` vừa tạo
 * xong ở dòng trước đó thì không ai còn cầm.
 *
 * Bên gọi giữ sổ thì cả hai loại đều dọn được - kể cả khi lỗi rơi vào đúng
 * khoảng giữa "đã tạo" và "đã gắn vào cảnh".
 *
 * `disposeAll` gọi bao nhiêu lần cũng được và KHÔNG ném: nó chạy trên đường dọn
 * dẹp, nơi mọi thứ khác đã hỏng sẵn rồi.
 */
export interface DisposableRegistry {
  track<T extends DisposableLike>(item: T): T;
  /** Còn bao nhiêu thứ chưa trả. Để test khẳng định được, không phải để hiển thị. */
  size(): number;
  /** Trả hết. Trả về lỗi của từng bước, theo đúng thứ tự gặp phải. */
  disposeAll(): unknown[];
}

export function createDisposableRegistry(): DisposableRegistry {
  const items: DisposableLike[] = [];
  return {
    // Hàm mũi tên và không đọc `this`: `buildVillageScene` rút riêng `track` ra
    // dùng như một hàm tự do, và một phương thức thường sẽ mất `this` ở đó.
    track: <T extends DisposableLike>(item: T): T => {
      items.push(item);
      return item;
    },
    size: () => items.length,
    disposeAll: () => {
      const errors: unknown[] = [];
      // Dọn sạch danh sách TRƯỚC khi gọi `dispose`: một `dispose` có thể ném,
      // và lần gọi thứ hai không được thử lại những gì đã trả.
      const pending = items.slice();
      items.length = 0;
      for (const item of pending) {
        try {
          item.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      return errors;
    },
  };
}

/**
 * Túi tài nguyên của MỘT lần mở dialog.
 *
 * Mọi ô đều `null`/rỗng lúc đầu và được điền dần trong lúc khởi tạo. `disposed`
 * là cờ MỘT CHIỀU: bật lên rồi thì `teardownVillage` không làm gì nữa, và vòng
 * vẽ cũng đọc nó để tự dừng.
 */
export interface VillageResources {
  /** Handle của `requestAnimationFrame`; `0` nghĩa là không có khung nào chờ. */
  frame: number;
  /**
   * Hàm huỷ khung, tiêm vào chứ không gọi thẳng `cancelAnimationFrame`.
   *
   * Không phải để cho "thuần" một cách hình thức: `node:test` không có
   * `cancelAnimationFrame`, nên một lời gọi toàn cục ở đây sẽ khiến chính cái
   * bước quan trọng nhất - dừng vòng vẽ trước khi trả GPU - là bước duy nhất
   * không test được.
   */
  cancelFrame: ((handle: number) => void) | null;
  /** Thunk gỡ listener, theo đúng thứ tự đăng ký. Dọn theo thứ tự ngược lại. */
  detach: Array<() => void>;
  observer: ObserverLike | null;
  /** Handle của `buildVillageScene`, chỉ có khi hàm đó đã chạy XONG. */
  built: DisposableLike | null;
  /** Scene thô. Còn đây khi `built` vắng mặt tức là dựng cảnh đã hỏng giữa chừng. */
  scene: SceneLike | null;
  /**
   * Sổ tài nguyên truyền cho `buildVillageScene`.
   *
   * Đây là đường duy nhất với tới được thứ đã tạo mà CHƯA gắn vào scene - loại
   * mà `salvageScene` không thấy. Dựng xong thì `built.dispose()` tự dọn sổ này,
   * nên lời gọi ở đây chỉ là lưới cuối cùng, và nó không dọn hai lần.
   */
  registry: DisposableRegistry | null;
  canvas: CanvasLike | null;
  renderer: RendererLike | null;
  /**
   * Context đã mất TRƯỚC khi dọn - tức là trình duyệt đã thu nó rồi.
   *
   * Khi đó `forceContextLoss()` không còn gì để ép: three tra
   * `WEBGL_lose_context` trên một context đã chết, không thấy, rồi in cảnh báo
   * ra console. Ngay giữa lúc máy đang thiếu bộ nhớ đồ hoạ thì một dòng cảnh
   * báo lạc đề là thứ cuối cùng người đi tìm nguyên nhân cần thấy.
   */
  contextLost: boolean;
  disposed: boolean;
}

export function createVillageResources(): VillageResources {
  return {
    frame: 0,
    cancelFrame: null,
    detach: [],
    observer: null,
    built: null,
    scene: null,
    registry: null,
    canvas: null,
    renderer: null,
    contextLost: false,
    disposed: false,
  };
}

export interface VillageTeardownReport {
  /** `false` nghĩa là đã dọn từ trước - không phải là đã thất bại. */
  ran: boolean;
  /**
   * Lỗi của từng bước dọn, nếu có.
   *
   * KHÔNG nuốt: bên gọi in chúng ra. Nhưng cũng không ném: một `dispose()` hỏng
   * không được phép chặn những bước sau nó, mà bước sau nó chính là chỗ trả
   * context WebGL về.
   */
  errors: unknown[];
}

/**
 * Trả lại mọi thứ đã mượn. Gọi bao nhiêu lần cũng được.
 *
 * Thứ tự KHÔNG tuỳ tiện:
 *
 *   1. Dừng vòng vẽ trước tiên. Mọi bước sau đều lấy đi thứ mà khung hình kế
 *      tiếp đang cần, nên còn một khung đã lên lịch là còn một lần `render()`
 *      trên tài nguyên đã trả.
 *   2. Gỡ listener và observer, để không có gì gọi ngược lại vào giữa chừng.
 *   3. Trả geometry/material - qua handle nếu dựng xong, qua phép vét scene và
 *      sổ tài nguyên nếu dựng hỏng giữa chừng.
 *   4. Gỡ canvas khỏi DOM.
 *   5. `forceContextLoss()` rồi mới `dispose()` - chỉ `dispose()` thì một số
 *      trình duyệt vẫn giữ context sống, và cả tính năng này hứa điều ngược lại.
 *
 * Tính idempotent không phải để cho đẹp: mất context và React unmount hoàn toàn
 * có thể xảy ra sát nhau - máy hết bộ nhớ đồ hoạ đúng lúc người chơi bấm Đóng -
 * và lúc đó cả hai đường đều gọi vào đây.
 */
export function teardownVillage(resources: VillageResources): VillageTeardownReport {
  if (resources.disposed) return { ran: false, errors: [] };
  // Bật cờ TRƯỚC bất kỳ thao tác nào: một `dispose()` có thể bắn sự kiện, và
  // sự kiện đó có thể gọi ngược vào đây.
  resources.disposed = true;

  const errors: unknown[] = [];
  const attempt = (task: () => void) => {
    try {
      task();
    } catch (error) {
      errors.push(error);
    }
  };

  const cancel = resources.cancelFrame;
  const frame = resources.frame;
  resources.frame = 0;
  resources.cancelFrame = null;
  if (frame !== 0 && cancel) attempt(() => cancel(frame));

  const detachers = resources.detach.slice().reverse();
  resources.detach.length = 0;
  for (const detach of detachers) attempt(detach);

  const observer = resources.observer;
  resources.observer = null;
  if (observer) attempt(() => observer.disconnect());

  const built = resources.built;
  const scene = resources.scene;
  resources.built = null;
  resources.scene = null;
  const registry = resources.registry;
  resources.registry = null;
  if (built) {
    // Đường thường: handle biết chính xác nó đã tạo những gì, và nó dọn luôn sổ
    // của mình. Lời gọi sổ ngay sau đó là lưới cuối, và nó không trả lại thứ gì
    // hai lần - `disposeAll` xoá danh sách trước khi gọi `dispose`.
    attempt(() => built.dispose());
    if (registry) for (const error of registry.disposeAll()) errors.push(error);
  } else if (registry) {
    /*
     * Dựng cảnh ném giữa chừng, và bên gọi có giữ sổ.
     *
     * Sổ biết NHIỀU HƠN cây scene: nó cầm cả những geometry vừa tạo xong mà
     * chưa kịp `scene.add`. Nên khi có sổ thì không vét scene nữa - vét thêm chỉ
     * dẫn tới `dispose` hai lần trên cùng một vật thể, và những gì có trong
     * scene thì sổ đã cầm sẵn.
     */
    for (const error of registry.disposeAll()) errors.push(error);
    if (scene) attempt(() => scene.clear?.());
  } else if (scene) {
    // Không có sổ - bên gọi tự dựng cảnh theo cách của mình. Còn với tới được
    // gì thì trả lại nấy.
    salvageScene(scene, errors);
  }

  const canvas = resources.canvas;
  resources.canvas = null;
  if (canvas) attempt(() => canvas.remove());

  const renderer = resources.renderer;
  const alreadyLost = resources.contextLost;
  resources.renderer = null;
  if (renderer) {
    // Context còn sống thì phải ÉP mất: chỉ `dispose()` thì một số trình duyệt
    // vẫn giữ nó, và cả tính năng này hứa điều ngược lại. Context đã chết rồi
    // thì bỏ qua - xem `contextLost`.
    if (!alreadyLost) attempt(() => renderer.forceContextLoss());
    attempt(() => renderer.dispose());
  }

  return { ran: true, errors };
}

/**
 * Vét geometry và material của một scene dựng dở.
 *
 * Dedupe bằng `Set` vì cả ngôi làng dùng chung vài geometry và material - đó là
 * chủ ý của bản dựng, và ở đây nó có nghĩa là cùng một vật thể sẽ gặp lại chục
 * lần khi duyệt cây.
 */
function salvageScene(scene: SceneLike, errors: unknown[]): void {
  const seen = new Set<DisposableLike>();
  const drop = (item: DisposableLike | null | undefined) => {
    if (!item || seen.has(item)) return;
    seen.add(item);
    try {
      item.dispose();
    } catch (error) {
      errors.push(error);
    }
  };

  if (typeof scene.traverse === "function") {
    try {
      scene.traverse((object) => {
        const holder = asHolder(object);
        if (!holder) return;
        drop(holder.geometry);
        const material = holder.material;
        if (Array.isArray(material)) for (const item of material) drop(item);
        else drop(material);
      });
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    scene.clear?.();
  } catch (error) {
    errors.push(error);
  }
}

export interface SteppableScene<TStep, TOptions> {
  setStep(step: TStep, options: TOptions): void;
}

/**
 * Đưa một bước vào cảnh đã dựng sẵn.
 *
 * Tồn tại để trả lời một câu duy nhất bằng `false`: cảnh đã bị dọn thì đổi bước
 * KHÔNG được chạm vào nó. Sau khi mất context, React vẫn còn ít nhất một lần
 * render nữa trước khi component bị tháo, và lần đó có thể mang theo một bước
 * mới - `setStep` trên một handle đã dispose là gọi vào geometry đã trả về GPU.
 *
 * Cũng là chỗ ghim bằng test cái quy tắc "đổi bước KHÔNG dựng lại renderer":
 * đường đổi bước chỉ có đúng một lời gọi, và nó là `setStep`.
 */
export function applyStepToScene<TStep, TOptions>(
  handle: SteppableScene<TStep, TOptions> | null,
  step: TStep,
  options: TOptions,
): boolean {
  if (!handle) return false;
  handle.setStep(step, options);
  return true;
}
