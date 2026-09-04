import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AVATAR_IDS, AVATAR_PATHS } from "./avatar-art";
import {
  CHARACTER_SHEETS,
  PORTRAIT_FRAMES,
  PORTRAIT_FRAME_COUNT,
  hasSheet,
  hasVariants,
  sheetFor,
} from "./character-art";

const PUBLIC_DIR = join(process.cwd(), "public", "characters");
/** Trần theo SOURCES.md. Vượt là ảnh chưa nén đúng, không phải ảnh đẹp hơn. */
const MAX_SHEET_BYTES = 80 * 1024;
const MAX_TOTAL_BYTES = 1_200 * 1024;

function fileOf(src: string): string {
  return join(process.cwd(), "public", src.replace(/^\//, ""));
}

/**
 * Kích thước một file WebP, đọc thẳng từ header.
 *
 * Chỉ hiểu chunk VP8X - đúng loại mà cả 16 sheet đang dùng. Gặp loại khác thì
 * trả null và test bỏ qua, vì thà không kiểm còn hơn báo sai.
 */
function webpSize(path: string): { width: number; height: number } | null {
  const head = readFileSync(path).subarray(0, 30);
  if (head.subarray(0, 4).toString("latin1") !== "RIFF") return null;
  if (head.subarray(8, 12).toString("latin1") !== "WEBP") return null;
  if (head.subarray(12, 16).toString("latin1") !== "VP8X") return null;
  return {
    width: head.readUIntLE(24, 3) + 1,
    height: head.readUIntLE(27, 3) + 1,
  };
}

describe("manifest chân dung", () => {
  it("bốn frame, đúng thứ tự đã chốt trong spec", () => {
    assert.deepEqual([...PORTRAIT_FRAMES], ["idle", "blink", "talk", "dead"]);
    assert.equal(PORTRAIT_FRAME_COUNT, 4);
  });

  it("mọi AvatarId đều có một khuôn mặt", () => {
    // Bắt lỗi "thêm nhân vật thứ 21, quên cả sheet lẫn hình": ô đó sẽ im lặng
    // hiện bóng đen giữa một bàn toàn mặt người.
    //
    // Sheet là TUỲ CHỌN, không bắt buộc: `portraitSource` rơi về `svg` khi
    // thiếu sheet - đúng con đường mà người bật Save-Data vẫn đi mỗi ván. Bốn
    // id thêm ngày 2026-09-04 (wizard/cultist/spy/bandit) đang đi đường đó vì
    // pack art gốc chỉ có 12 khuôn mặt. Cái không được phép thiếu là khuôn mặt.
    for (const id of AVATAR_IDS) {
      assert.ok(hasSheet(id) || AVATAR_PATHS[id], `${id} không có cả sheet lẫn hình SVG`);
    }
  });

  it("mọi khoá trong bảng sheet phải là một AvatarId có thật", () => {
    for (const key of Object.keys(CHARACTER_SHEETS)) {
      assert.ok(
        (AVATAR_IDS as readonly string[]).includes(key),
        `${key} không có trong AVATAR_IDS`,
      );
    }
  });

  it("mọi sheet đã khai báo phải tồn tại thật trong public/", () => {
    for (const [id, sheet] of Object.entries(CHARACTER_SHEETS)) {
      assert.ok(sheet?.src, `${id} khai báo sheet rỗng`);
      assert.doesNotThrow(
        () => statSync(fileOf(sheet!.src)),
        `thiếu file cho ${id}: ${sheet!.src}`,
      );
    }
  });

  it("không có file sheet mồ côi trong public/characters", () => {
    // Chiều ngược lại: file nằm đó mà không ai khai báo thì nó đang chiếm chỗ
    // trong repo mà không bao giờ được tải.
    const files = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith(".webp"));
    const declared = new Set(
      Object.values(CHARACTER_SHEETS).map((sheet) => sheet!.src.split("/").pop()),
    );
    for (const file of files) {
      assert.ok(declared.has(file), `${file} không được khai báo trong CHARACTER_SHEETS`);
    }
  });

  it("mọi sheet phải là bốn frame vuông nằm ngang", () => {
    // Sai kích thước là lỗi asset gây vỡ hình nặng nhất: CSS trượt theo phần
    // trăm nên một file 3 frame sẽ hiện nửa mặt người này ghép nửa mặt người kia.
    for (const [id, sheet] of Object.entries(CHARACTER_SHEETS)) {
      const size = webpSize(fileOf(sheet!.src));
      if (!size) continue;
      assert.equal(
        size.width,
        size.height * PORTRAIT_FRAME_COUNT,
        `${id} là ${size.width}x${size.height}, phải rộng gấp ${PORTRAIT_FRAME_COUNT} lần chiều cao`,
      );
    }
  });

  it("bộ art hiện tại chưa có biến thể biểu cảm", () => {
    // Đo được: frame 1 và 2 lệch frame 0 trung bình 0.7-1.5 trên 255, tức đúng
    // bằng nhiễu nén WebP. Test này là cái chốt lại sự thật đó, để ngày nào có
    // sheet thật thì người sửa buộc phải sửa cả đây - và nhớ ra là CSS sẽ bật.
    for (const id of AVATAR_IDS) {
      assert.equal(hasVariants(id), false, `${id} đang tự nhận có biến thể`);
    }
  });

  it("hasSheet và hasVariants trả false cho chuỗi không phải AvatarId", () => {
    // Avatar tự tải lên đi vào đây dưới dạng một URL http.
    assert.equal(hasSheet("https://example.com/a.png"), false);
    assert.equal(hasVariants("https://example.com/a.png"), false);
    assert.equal(sheetFor("https://example.com/a.png"), null);
  });
});

describe("ngân sách dung lượng", () => {
  it("mỗi sheet dưới trần, và tổng dưới trần", () => {
    // Không có test này thì một hôm nào đó một tấm PNG 4MB lọt vào và không ai
    // biết cho tới lúc người chơi 4G kêu.
    let total = 0;
    for (const [id, sheet] of Object.entries(CHARACTER_SHEETS)) {
      const size = statSync(fileOf(sheet!.src)).size;
      assert.ok(size <= MAX_SHEET_BYTES, `${id} nặng ${size}B, trần ${MAX_SHEET_BYTES}B`);
      total += size;
    }
    assert.ok(total <= MAX_TOTAL_BYTES, `tổng ${total}B vượt trần ${MAX_TOTAL_BYTES}B`);
  });
});

describe("hợp đồng CSS của khung chân dung", () => {
  /**
   * Đọc thân của một luật CSS theo selector chính xác.
   *
   * Thô sơ, và cố ý: file này không có bộ phân tích CSS, còn thêm một phụ
   * thuộc chỉ để đọc một luật thì đắt hơn thứ nó bảo vệ.
   */
  function ruleBody(css: string, selector: string): string | null {
    const at = css.indexOf(`\n${selector} {`);
    if (at === -1) return null;
    const open = css.indexOf("{", at);
    const close = css.indexOf("}", open);
    return close === -1 ? null : css.slice(open + 1, close);
  }

  const css = readFileSync(join(process.cwd(), "src/app/characters.css"), "utf8");

  it("khung phải khai báo display, nếu không cả chân dung biến mất", () => {
    // Khung là một <span>, mặc định `display: inline`, mà hộp inline BỎ QUA
    // width/height. Mọi nơi gọi đều đặt cỡ bằng class, nên thiếu `display` thì
    // khung co lại còn đúng bề dày viền - đo được 2x19px thay vì 66x66.
    //
    // Đây là hồi quy đã xảy ra thật: `grid` từng nằm trên className của
    // component và bị gỡ nhầm cùng `place-items-center`. Chân dung biến mất
    // khỏi toàn bộ ứng dụng mà không một test nào đỏ, vì happy-dom không có
    // layout engine. Test này là thứ đứng thay cho layout engine đó.
    const body = ruleBody(css, ".character-portrait");
    assert.ok(body, "không tìm thấy luật .character-portrait");
    assert.match(
      body!,
      /(^|[;\s])display\s*:/,
      "`.character-portrait` thiếu `display` - khung sẽ là inline và co về 0",
    );
  });

  it("ảnh sheet phải neo trái, không được để bị căn giữa", () => {
    // Ảnh rộng gấp 4 khung. Căn giữa nó thì toạ độ 0% của ảnh không còn khớp
    // mép trái khung, và bốn mốc translateX mất hết ý nghĩa: `is-alive` lộ ra
    // đường nối giữa frame 1 và 2, `is-dead` trôi hẳn ra ngoài mép phải ảnh.
    const body = ruleBody(css, ".character-portrait__sheet");
    assert.ok(body, "không tìm thấy luật .character-portrait__sheet");
    assert.match(body!, /position\s*:\s*absolute/, "ảnh sheet phải neo bằng absolute");
    assert.match(body!, /inset\s*:\s*0 auto 0 0/, "ảnh sheet phải khoá vào mép trái");
  });
});

describe("ranh giới kiến trúc", () => {
  it("character-portrait.ts không được biết React hay DOM", () => {
    // Cùng mẹo mà live-trial-scene.test.ts dùng để chặn `three` lọt vào file sai.
    const source = readFileSync(join(process.cwd(), "src/lib/character-portrait.ts"), "utf8");
    assert.ok(!/from "react"/.test(source), "model thuần đang import react");
    assert.ok(!/\bdocument\.|\bwindow\./.test(source), "model thuần đang chạm DOM");
    assert.ok(!/Date\.now\(\)/.test(source), "model thuần đang tự đọc đồng hồ");
  });
});
