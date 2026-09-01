import { encodeQR } from "@paulmillr/qr";

/**
 * Vùng yên tĩnh quanh mã, tính bằng số ô.
 *
 * Bốn ô là mức tối thiểu trong đặc tả QR, và nó không phải chuyện thẩm mỹ: dán
 * mã sát mép một tấm nền tối thì bộ dò trên điện thoại không tách được ba mẫu
 * định vị ra khỏi nền, và mã đúng dữ liệu vẫn không quét được.
 */
export const QR_QUIET_ZONE = 4;

/**
 * Ma trận ô tối/sáng của mã QR cho một chuỗi.
 *
 * Vì sao dùng `@paulmillr/qr` chứ không tự viết: phần sinh mã QR là Reed-Solomon
 * cộng tám mặt nạ cộng bảng phiên bản - chừng ba trăm dòng mà sai một chỗ thì
 * mã vẫn hiện ra đẹp đẽ và chỉ hỏng lúc người ta giơ điện thoại lên. Thư viện
 * này không có dependency nào, tự mang kiểu TypeScript, và phần GIẢI mã nằm ở
 * một entry riêng (`@paulmillr/qr/decode.js`) nên bundle của trang chỉ mang
 * phần sinh mã.
 *
 * `border: 0` để ma trận chỉ chứa đúng các ô dữ liệu. Vùng yên tĩnh do
 * `qrSvgPath` tự chừa ra, nên chỉ có một chỗ duy nhất biết con số đó.
 *
 * `ecc: "medium"` - mức 15% khôi phục. Cao hơn thì mã dày ô hơn và trên màn
 * điện thoại mỗi ô nhỏ lại; mã này hiện trên màn hình sạch sẽ chứ không in ra
 * giấy rồi dán lên tường, nên không cần chịu đựng vết bẩn.
 *
 * Ném khi chuỗi rỗng - không có gì để mã hoá thì không có mã nào để vẽ, và một
 * ma trận rỗng lặng lẽ sẽ thành một ô vuông trắng mà không ai hiểu vì sao.
 */
export function encodeQrMatrix(text: string): boolean[][] {
  if (!text) throw new Error("Không có nội dung để dựng mã QR");
  return encodeQR(text, "raw", { ecc: "medium", border: 0 });
}

/** Cạnh của viewBox SVG, tính bằng ô: ma trận cộng vùng yên tĩnh hai bên. */
export function qrSvgSize(matrix: boolean[][]): number {
  return matrix.length + QR_QUIET_ZONE * 2;
}

/**
 * Toàn bộ ô tối gộp thành MỘT thuộc tính `d` của một thẻ `<path>`.
 *
 * Một path thay vì vài trăm thẻ `<rect>`: mã cỡ vừa có hơn 400 ô tối, và mỗi ô
 * một phần tử DOM là hơn 400 nút cho một thứ không ai tương tác được. Trình
 * duyệt cũng vẽ một path nhanh hơn hẳn.
 *
 * Toạ độ tính bằng ô, không phải pixel - SVG co giãn theo `viewBox`, nên cùng
 * chuỗi `d` này vừa khít cả ô 160px trên điện thoại lẫn 280px trên desktop mà
 * không phải dựng lại.
 */
export function qrSvgPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  for (let row = 0; row < matrix.length; row++) {
    for (let col = 0; col < matrix[row]!.length; col++) {
      if (!matrix[row]![col]) continue;
      parts.push(`M${col + QR_QUIET_ZONE} ${row + QR_QUIET_ZONE}h1v1h-1z`);
    }
  }
  return parts.join("");
}
