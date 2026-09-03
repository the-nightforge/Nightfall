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

/**
 * Máy này có WebGL2 không. Hỏi ĐÚNG MỘT LẦN cho cả phiên.
 *
 * Phép thử này tạo một context THẬT, và context là tài nguyên có hạn - trình
 * duyệt chỉ cho chừng 16 cái rồi bắt đầu đá cái CŨ NHẤT, mà cái cũ nhất chính
 * là renderer đang dùng. Gọi lại mỗi lần đổi thiết lập nghĩa là người chơi gạt
 * công tắc vài chục lần là tự tay giết 3D của chính mình. Câu trả lời không đổi
 * trong một phiên, nên nhớ lại là đủ.
 *
 * Ở CẤP MODULE chứ không nằm trong một component: hai nơi hỏi câu này - chuyển
 * cảnh trong ván và màn "Hồi ức Ngôi Làng" - và hai bản nhớ riêng nghĩa là hai
 * context bị đốt thay vì một.
 */
let webgl2Support: boolean | null = null;

export function hasWebgl2(): boolean {
  if (webgl2Support !== null) return webgl2Support;
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    const context = probe.getContext("webgl2");
    // Trả context lại ngay thay vì để trình duyệt tự thu: một context sống lay
    // lắt vẫn tính vào hạn mức.
    context?.getExtension("WEBGL_lose_context")?.loseContext();
    webgl2Support = context !== null;
  } catch {
    webgl2Support = false;
  }
  return webgl2Support;
}
