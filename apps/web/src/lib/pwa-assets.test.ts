import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import manifest from "../app/manifest";

/**
 * Manifest và bộ icon, kiểm tra như một cặp.
 *
 * Đây là loại lỗi không có gì trong toolchain bắt được: manifest trỏ tới một
 * đường dẫn, file nằm ở đường dẫn khác, TypeScript hài lòng, build xanh, và
 * chỉ tới lúc bấm "Cài ứng dụng" trên một chiếc điện thoại thật mới thấy
 * Chrome từ chối vì icon 404. Test này đọc chính hai thứ đó và đối chiếu.
 */

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC_DIR = join(WEB_ROOT, "public");

const M = manifest();

/** Đọc kích thước thật từ chunk IHDR - 8 byte chữ ký, 8 byte header chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(bytes.subarray(0, 8).equals(SIGNATURE), "không phải file PNG thật");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR", "chunk đầu phải là IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("web app manifest", () => {
  it("có đủ phần định danh, bằng tiếng Việt", () => {
    assert.equal(M.name, "Ma Sói Online");
    assert.equal(M.short_name, "Ma Sói");
    assert.equal(M.lang, "vi");
    assert.ok(M.description && M.description.length > 20);
  });

  it("start_url và scope phủ cả app", () => {
    assert.equal(M.start_url, "/");
    assert.equal(M.scope, "/");
  });

  it("mở ở chế độ standalone, ưu tiên màn hình dọc", () => {
    assert.equal(M.display, "standalone");
    assert.equal(M.orientation, "portrait");
  });

  it("hai màu nền khớp night-950 của giao diện", () => {
    assert.equal(M.background_color, "#070b14");
    assert.equal(M.theme_color, "#070b14");
  });

  it("short_name đủ ngắn cho nhãn dưới biểu tượng", () => {
    // Android cắt nhãn quanh 12 ký tự; dài hơn là ra "Ma Sói Onli...".
    assert.ok((M.short_name ?? "").length <= 12);
  });
});

describe("icon của manifest", () => {
  const icons = M.icons ?? [];

  it("có icon 192 và 512 dùng chung được", () => {
    for (const size of ["192x192", "512x512"]) {
      const found = icons.filter((i) => i.sizes === size && i.purpose !== "maskable");
      assert.equal(found.length, 1, `thiếu icon any ${size}`);
    }
  });

  it("có đúng một icon maskable 512", () => {
    const maskable = icons.filter((i) => i.purpose === "maskable");
    assert.equal(maskable.length, 1);
    assert.equal(maskable[0].sizes, "512x512");
  });

  it("mọi icon đều tồn tại và đúng kích thước đã khai", () => {
    for (const icon of icons) {
      const rel = icon.src.replace(/^\//, "");
      const bytes = readFileSync(join(PUBLIC_DIR, rel));
      const { width, height } = pngSize(bytes);
      const [w, h] = (icon.sizes ?? "").split("x").map(Number);
      assert.equal(width, w, `${icon.src} rộng ${width}, khai ${w}`);
      assert.equal(height, h, `${icon.src} cao ${height}, khai ${h}`);
      assert.equal(icon.type, "image/png");
    }
  });
});

describe("tài nguyên PWA trong /public", () => {
  it("apple-touch-icon là PNG 180x180 thật", () => {
    // iOS không đọc icons của manifest; thẻ <link rel="apple-touch-icon"> ở
    // layout.tsx là đường duy nhất để iPhone lấy được biểu tượng.
    const bytes = readFileSync(join(PUBLIC_DIR, "icons", "apple-touch-icon.png"));
    assert.deepEqual(pngSize(bytes), { width: 180, height: 180 });
  });

  /*
   * Hành vi của service worker được chứng minh ở `sw-behavior.test.ts`, nơi
   * `sw.js` thật sự được CHẠY trong một worker environment giả. Những phép
   * `source.includes(...)` từng nằm ở đây đã bị bỏ: chúng vẫn xanh khi hằng số
   * còn nguyên nhưng đoạn mã đọc nó đã hỏng. Chỗ này chỉ giữ lại thứ thuộc về
   * file trên đĩa - thứ mà việc chạy mã không nói được.
   */
  it("trang offline tồn tại, là tiếng Việt và không xin gì từ xa", () => {
    const html = readFileSync(join(PUBLIC_DIR, "offline.html"), "utf8");
    assert.ok(html.includes('lang="vi"'));
    assert.ok(html.includes("Đang mất kết nối"));
    // Trang này chạy khi đã mất mạng: một tham chiếu ra ngoài là một ô trống.
    assert.ok(!/(src|href)="https?:/.test(html), "offline.html không được tải gì từ xa");
  });

  it("sw.js là classic script, không phải module", () => {
    // Trình duyệt đăng ký nó bằng `register("/sw.js")` không kèm `type: module`;
    // một câu `import` lọt vào sẽ chỉ gãy trên thiết bị thật, không gãy ở build.
    const sw = readFileSync(join(PUBLIC_DIR, "sw.js"), "utf8");
    assert.doesNotMatch(sw, /^\s*import\s/m, "sw.js không được dùng import");
    assert.doesNotMatch(sw, /^\s*export\s/m, "sw.js không được dùng export");
  });
});
