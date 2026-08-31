import sharp from "sharp";

export type ImageKind = "jpeg" | "png" | "webp";

export const AVATAR_SIZE = 256;
export const MAX_AVATAR_OUTPUT_BYTES = 200 * 1024;

/**
 * Trần điểm ảnh đầu vào. Một file PNG 2 KB có thể khai kích thước 30000x30000
 * và làm sharp cấp phát hàng GB - "bom nén". Trần 50 triệu điểm ảnh (khoảng
 * 7000x7000) rộng hơn mọi ảnh máy ảnh thật nhưng chặn được kiểu tấn công đó.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/** Bậc chất lượng WebP, thử từ cao xuống thấp cho tới khi lọt trần dung lượng. */
const QUALITY_LADDER = [82, 70, 58];

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * Nhận dạng ảnh bằng magic bytes.
 *
 * Đây là nơi DUY NHẤT quyết định một file có phải ảnh hay không.
 * `file.mimetype` của multer là chuỗi do client tự khai trong phần header của
 * multipart - đổi nó thành "image/png" chỉ tốn một dòng curl, nên tin nó là
 * không tin gì cả.
 */
export function sniffImageType(buf: Buffer): ImageKind | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // WebP là container RIFF: "RIFF" ở offset 0, độ dài 4 byte, rồi "WEBP".
  // Chỉ kiểm "RIFF" là nhận nhầm cả WAV và AVI.
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "webp";
  }
  return null;
}

/**
 * Chuẩn hoá ảnh thành avatar: tự xoay theo EXIF, crop vuông giữa, thu về 256,
 * encode WebP dưới trần dung lượng.
 *
 * .rotate() phải gọi TRƯỚC .resize(): ảnh chụp dọc bằng điện thoại thường được
 * lưu ngang kèm cờ EXIF, nên crop trước khi xoay là crop nhầm vùng.
 *
 * Thang chất lượng gần như không bao giờ tụt - 256x256 ở q82 thường 15-25 KB.
 * Nhưng "gần như không bao giờ" không phải một đảm bảo, còn trần 200 KB thì là
 * một yêu cầu, nên hết thang là từ chối chứ không nới trần.
 */
export async function processAvatar(
  buf: Buffer,
  opts: { maxBytes?: number } = {},
): Promise<{ data: Buffer; quality: number }> {
  const maxBytes = opts.maxBytes ?? MAX_AVATAR_OUTPUT_BYTES;
  const square = sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" });

  for (const quality of QUALITY_LADDER) {
    const data = await square.clone().webp({ quality }).toBuffer();
    if (data.length <= maxBytes) return { data, quality };
  }

  throw new Error(
    `Không nén được ảnh xuống dưới ${Math.round(maxBytes / 1024)} KB, hãy thử ảnh khác`,
  );
}
