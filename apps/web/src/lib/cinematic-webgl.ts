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
