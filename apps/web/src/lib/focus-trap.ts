/**
 * Bẫy focus tối giản cho hai lớp phủ của game.
 *
 * Không kéo về một thư viện dialog: cả hai chỗ cần đúng ba việc - Tab quay
 * vòng trong lớp phủ, phần còn lại của trang thành `inert`, và focus trả về chỗ
 * cũ khi đóng. Một dependency dialog đầy đủ mang theo portal, scroll-lock và
 * cả hệ thống layer riêng, mà `MobileChatDock` thì đang phải tự giữ nhịp
 * animation của `motion` còn `CinematicOverlay` thì tự tháo sau đúng 900ms.
 *
 * Phần logic thứ tự Tab nằm ở `trapIndex` - thuần, không DOM, và được test.
 */

/**
 * Phần tử tiếp theo nhận focus khi Tab / Shift+Tab bên trong bẫy.
 *
 * `current` là vị trí của phần tử đang focus trong danh sách, hoặc -1 khi focus
 * đang ở NGOÀI bẫy (vừa mở lớp phủ, hoặc trình duyệt vừa trả focus về body sau
 * khi phần tử cũ bị gỡ). Trả về -1 nghĩa là không có gì để focus.
 */
export function trapIndex(count: number, current: number, backwards: boolean): number {
  if (count <= 0) return -1;
  // Focus đang ở ngoài: Tab đưa vào phần tử đầu, Shift+Tab đưa vào phần tử
  // cuối - đúng chiều người dùng vừa ấn, chứ không phải luôn nhảy về đầu.
  if (current < 0) return backwards ? count - 1 : 0;
  return backwards ? (current - 1 + count) % count : (current + 1) % count;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]",
].join(",");

/** Những phần tử trong `root` thật sự nhận được focus lúc này. */
export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.tabIndex < 0 || el.hasAttribute("inert")) return false;
    // getClientRects thay vì offsetParent: lớp phủ dùng `position: fixed`, mà
    // offsetParent của con một phần tử fixed hành xử khác nhau giữa các trình
    // duyệt. Không có hình chữ nhật nào nghĩa là đang display:none hoặc đang bị
    // một tổ tiên ẩn đi - không có cách nào focus vào đó.
    return el.getClientRects().length > 0;
  });
}

/**
 * Đặt `inert` lên toàn bộ trang TRỪ những gốc được giữ lại.
 *
 * Đi từ gốc thứ nhất ngược lên `body`, mỗi tầng tắt các anh em không chứa gốc
 * nào. Nhận NHIỀU gốc vì tấm trượt chat và tấm nền mờ của nó là hai anh em ruột
 * mà cả hai đều phải sống: tấm nền bị inert thì chạm ra ngoài không đóng được
 * tấm trượt nữa.
 *
 * Bỏ qua phần tử đã inert sẵn, và cũng không gỡ chúng lúc dọn: hai lớp phủ có
 * thể chồng nhau (chuyển cảnh nổ khi tấm trượt chat đang mở), và lớp trên tháo
 * ra không được phép mở khoá phần trang mà lớp dưới đang giữ.
 */
export function inertOutside(roots: HTMLElement[]): () => void {
  const base = roots[0];
  if (!base || typeof document === "undefined") return () => {};

  const marked: HTMLElement[] = [];
  let node: HTMLElement | null = base;
  while (node?.parentElement) {
    const parent: HTMLElement = node.parentElement;
    for (const child of Array.from(parent.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.inert) continue;
      if (roots.some((root) => child === root || child.contains(root))) continue;
      child.inert = true;
      marked.push(child);
    }
    node = parent === document.body ? null : parent;
  }

  return () => {
    for (const el of marked) el.inert = false;
  };
}
