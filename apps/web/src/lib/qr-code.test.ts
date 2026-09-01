import assert from "node:assert/strict";
import { describe, it } from "node:test";
import jsQR from "jsqr";
import { QR_QUIET_ZONE, encodeQrMatrix, qrSvgPath, qrSvgSize } from "./qr-code";

/**
 * Rọi ma trận QR thành ảnh RGBA rồi đọc lại bằng một bộ giải mã KHÁC.
 *
 * `jsqr` là devDependency, không đi vào bundle. Dùng bộ giải của chính thư viện
 * mã hoá thì bài test chỉ khẳng định thư viện đó tự nhất quán với mình - nó vẫn
 * xanh y nguyên nếu cả hai chiều cùng hiểu sai một kiểu. Một bộ giải độc lập
 * mới trả lời được đúng câu hỏi người dùng quan tâm: điện thoại quét cái này ra
 * cái gì.
 *
 * `scale` 4 px mỗi ô là mức nhỏ nhất mà bộ dò còn bắt được mẫu định vị; vùng
 * yên tĩnh phải có thật, thiếu nó thì ảnh không giải mã được dù dữ liệu đúng.
 */
function decodeMatrix(matrix: boolean[][], scale = 4): string | null {
  const quiet = QR_QUIET_ZONE;
  const modules = matrix.length + quiet * 2;
  const size = modules * scale;
  const data = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / scale) - quiet;
      const col = Math.floor(x / scale) - quiet;
      const dark = row >= 0 && row < matrix.length && col >= 0 && col < matrix.length && matrix[row]![col];
      const value = dark ? 0 : 255;
      const at = (y * size + x) * 4;
      data[at] = value;
      data[at + 1] = value;
      data[at + 2] = value;
      data[at + 3] = 255;
    }
  }

  return jsQR(data, size, size)?.data ?? null;
}

describe("encodeQrMatrix", () => {
  it("mã QR giải ra ĐÚNG link mời", () => {
    const url = "https://masoi.example/?code=ABCDE";
    assert.equal(decodeMatrix(encodeQrMatrix(url)), url);
  });

  it("link localhost kèm cổng cũng giải đúng", () => {
    const url = "http://localhost:3000/?code=ABCDE";
    assert.equal(decodeMatrix(encodeQrMatrix(url)), url);
  });

  it("link dài với path lồng nhau vẫn giải đúng", () => {
    // Chuỗi dài hơn thì thư viện nhảy lên phiên bản QR lớn hơn. Đây là chỗ một
    // bản mã hoá cứng "version 4" sẽ vỡ.
    const url = "https://ma-soi-online-preview.vercel.app/phong/game/?code=ABCDE";
    assert.equal(decodeMatrix(encodeQrMatrix(url)), url);
  });

  it("ma trận vuông và không rỗng", () => {
    const matrix = encodeQrMatrix("https://masoi.example/?code=ABCDE");
    assert.ok(matrix.length >= 21);
    for (const row of matrix) assert.equal(row.length, matrix.length);
  });

  it("cùng một link luôn cho cùng một ma trận", () => {
    // QR có nhiều mặt nạ; thư viện phải chọn tất định, nếu không thì mỗi lần
    // render lại là một hình khác và bài test giải mã ở trên hoá ra may rủi.
    const url = "https://masoi.example/?code=ABCDE";
    assert.deepEqual(encodeQrMatrix(url), encodeQrMatrix(url));
  });

  it("chuỗi rỗng thì không dựng mã", () => {
    assert.throws(() => encodeQrMatrix(""));
  });

  it("QR không chứa gì ngoài đúng link được truyền vào", () => {
    // Yêu cầu "không đưa token/playerId vào QR" được bảo đảm ở đây bằng phép
    // giải mã, chứ không bằng lời hứa: thứ đọc ra phải khớp TỪNG KÝ TỰ với link.
    const url = "https://masoi.example/?code=ABCDE";
    const decoded = decodeMatrix(encodeQrMatrix(url));
    assert.equal(decoded, url);
    assert.ok(!/token|playerId|secret/i.test(decoded ?? ""));
  });
});

describe("qrSvgPath", () => {
  it("kích thước viewBox gồm cả vùng yên tĩnh hai bên", () => {
    const matrix = encodeQrMatrix("https://masoi.example/?code=ABCDE");
    assert.equal(qrSvgSize(matrix), matrix.length + QR_QUIET_ZONE * 2);
  });

  it("mỗi ô tối thành đúng một hình vuông 1x1 trong path", () => {
    const matrix = [
      [true, false],
      [false, true],
    ];
    const path = qrSvgPath(matrix);
    const dark = matrix.flat().filter(Boolean).length;
    assert.equal(path.match(/M/g)?.length, dark);
  });

  it("toạ độ đã dịch đi đúng một vùng yên tĩnh", () => {
    const path = qrSvgPath([[true]]);
    assert.equal(path, `M${QR_QUIET_ZONE} ${QR_QUIET_ZONE}h1v1h-1z`);
  });

  it("ma trận toàn ô sáng cho path rỗng chứ không phải path hỏng", () => {
    assert.equal(qrSvgPath([[false, false], [false, false]]), "");
  });
});
