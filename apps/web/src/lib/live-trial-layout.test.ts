import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

/**
 * Luật bố cục của sân khấu, ghim ở cấp mã nguồn.
 *
 * Bộ test của web chạy bằng `node:test`: không có DOM, không có bộ dựng bố cục,
 * nên không có cách nào tính ra chiều cao thật của một flex item ở đây. Bằng
 * chứng thật cho lần sửa này là phép đo trên trình duyệt trong phòng chơi thật
 * (1440x900, giữa vòng bỏ phiếu xác nhận, 15 người). Cái ở lại trong bộ test là
 * ba bất biến mà nếu ai đó gỡ ra thì lỗi cũ quay lại NGUYÊN VẸN - và quay lại
 * một cách im lặng, vì nó chỉ hiện ra khi cột giữa vừa đủ chật:
 *
 *   1. Thẻ sân khấu KHÔNG được mang `overflow-hidden`. Theo luật flexbox, một
 *      phần tử có `overflow` khác `visible` thì kích thước tối thiểu tự động
 *      của nó là 0 - cột giữa (flex column, cao đúng bằng khung nhìn) sẽ bóp nó
 *      xuống bao nhiêu cũng được, và `overflow-hidden` cắt gọn phần thừa. Đo
 *      được ở bản cũ: thẻ cần 388px, nhận 305px, mất hai con số Treo/Tha và
 *      dòng ngưỡng kết án, mà cột thì không có gì tràn ra để mà cuộn tới.
 *   2. Thẻ phải là `flex flex-col` thì khung 3D bên trong mới co được - đó là
 *      thứ nhường chỗ TRƯỚC khi cột phải cuộn.
 *   3. Khối chữ phải `shrink-0`: nó là thứ cuối cùng được phép nhường chỗ, và
 *      ở đây nghĩa là không bao giờ.
 */

const source = readFileSync(new URL("../components/TrialStage.tsx", import.meta.url), "utf8");

/** Chuỗi `className` ĐẦU TIÊN có chứa `fragment`. */
function classesOf(fragment: string): string {
  for (const match of source.matchAll(/className="([^"]*)"/g)) {
    if (match[1].includes(fragment)) return match[1];
  }
  assert.fail(`không tìm thấy className nào chứa "${fragment}"`);
}

describe("thẻ sân khấu không được tự cắt nội dung", () => {
  const section = classesOf("card flex flex-col");

  it("KHÔNG mang overflow-hidden - đó là thứ cho phép cột giữa bóp nó về 0", () => {
    assert.ok(
      !section.includes("overflow-hidden"),
      `thẻ sân khấu đang có overflow-hidden: "${section}"`,
    );
  });

  it("là một flex column, để khung 3D co lại trước khi cột phải cuộn", () => {
    assert.ok(section.includes("flex"), section);
    assert.ok(section.includes("flex-col"), section);
  });

  it("không dựa vào một chiều cao cố định để né lỗi", () => {
    assert.ok(!/\bh-\[/.test(section), "chiều cao của thẻ phải do nội dung quyết định");
    assert.ok(!/\bmax-h-/.test(section));
  });
});

describe("thứ tự nhường chỗ", () => {
  it("khung 3D co được: có min-h-0 và giữ overflow-hidden của riêng nó", () => {
    const band = classesOf("relative h-[clamp(");
    assert.ok(band.includes("min-h-0"), band);
    assert.ok(band.includes("overflow-hidden"), "góc bo của canvas vẫn phải được cắt");
    assert.ok(!band.includes("shrink-0"), "khung 3D là phần nhường chỗ ĐẦU TIÊN");
  });

  it("khung 3D vẫn co theo chiều cao khung nhìn, không phải một con số chết", () => {
    const band = classesOf("relative h-[clamp(");
    assert.ok(band.includes("vh"), band);
  });

  it("từ lg khung 3D cao hơn hẳn: đó là chỗ duy nhất có chỗ cho một khuôn mặt", () => {
    // Ở màn rộng cột giữa tự cuộn và không có nút nào bị đẩy xuống dưới mép,
    // nên sân khấu được phép lớn. Bản đầu dừng ở trần 224px cho MỌI màn: trên
    // 1440x900 khung rộng 900px mà cao 224px, khuôn mặt bị cáo còn chừng 27px.
    const band = classesOf("relative h-[clamp(");
    const lg = /lg:h-\[clamp\((\d+)px,(\d+)vh,(\d+)px\)\]/.exec(band);
    assert.ok(lg, `thiếu chiều cao riêng cho lg: "${band}"`);
    const sm = /sm:h-\[clamp\((\d+)px,(\d+)vh,(\d+)px\)\]/.exec(band);
    assert.ok(sm, band);
    assert.ok(Number(lg[3]) > Number(sm[3]), "trần ở lg phải cao hơn trần ở sm");
    assert.ok(Number(lg[1]) >= 200, "sàn ở lg phải đủ cho một khuôn mặt đọc được");
  });

  it("khối chữ shrink-0: không bao giờ bị cắt một dòng nào", () => {
    const text = classesOf("shrink-0 space-y-2.5");
    assert.ok(text.includes("shrink-0"), text);
  });

  it("không thu nhỏ chữ để vừa khung", () => {
    // Cỡ chữ của khối nội dung chỉ được nới RA ở màn rộng (`sm:`), không bao
    // giờ bị bóp lại để né một khung chật.
    assert.ok(!/text-\[(?:9|10|11)px\]/.test(source), "không có cỡ chữ dưới 12px");
    assert.ok(!source.includes("user-scalable"), "không được tắt zoom");
  });
});

describe("cột giữa của phòng phải cuộn được", () => {
  const page = readFileSync(
    new URL("../app/room/[code]/page.tsx", import.meta.url),
    "utf8",
  );

  it("cột chứa sân khấu là vùng cuộn từ lg trở lên", () => {
    // Không có vùng cuộn này thì `shrink-0` ở khối chữ chỉ đổi "bị cắt" thành
    // "tràn ra ngoài" - vẫn không đọc được.
    assert.ok(page.includes("lg:overflow-y-auto"), "cột giữa phải tự cuộn");
    assert.ok(page.includes("lg:min-h-0"), "thiếu min-h-0 thì overflow-y-auto không có tác dụng");
  });

  it("sân khấu nằm trong đúng cột đó, không phải một lớp phủ riêng", () => {
    const stageAt = page.indexOf("<TrialStage");
    const columnAt = page.indexOf("lg:overflow-y-auto");
    assert.ok(columnAt !== -1 && stageAt > columnAt, "sân khấu phải ở trong cột giữa");
  });
});
