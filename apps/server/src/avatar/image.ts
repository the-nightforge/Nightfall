import sharp from "sharp";

export type ImageKind = "jpeg" | "png" | "webp";

export const AVATAR_SIZE = 256;
export const MAX_AVATAR_OUTPUT_BYTES = 200 * 1024;

/**
 * Lỗi tiếng Việt dành cho người dùng cuối, ném ra từ mọi nhánh thất bại của
 * module này. Tầng gọi (service, HTTP handler) sẽ bọc lỗi của processAvatar
 * thành một câu chung, nhưng chỉ module này biết chính xác cái gì hỏng (sai
 * định dạng, ảnh quá lớn, file hỏng, hay nén không nổi) - nên thông điệp cụ
 * thể phải sống ở đây. instanceof AvatarImageError là cách tầng gọi phân biệt
 * câu tiếng Việt này với lỗi thô của libvips.
 */
export class AvatarImageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AvatarImageError";
  }
}

/**
 * Trần điểm ảnh đầu vào. Một file PNG 2 KB có thể khai kích thước 30000x30000
 * và làm sharp cấp phát hàng GB - "bom nén".
 *
 * 25 triệu điểm ảnh (khoảng 5000x5000) đã rộng gấp bốn lần một ảnh 6 megapixel
 * từ điện thoại - không camera thật nào ra ảnh gần tới ngưỡng này. Con số ban
 * đầu là 50 triệu, nhưng "shrink-on-load" của sharp (thứ khiến JPEG lớn giải mã
 * rẻ vì libjpeg tự thu nhỏ NGAY khi decode) không áp dụng cho PNG - libvips
 * luôn giải mã trọn vẹn raster PNG trước khi resize. Một PNG đặc màu 7000x7000
 * (đúng mức trần cũ) nén dưới xa trần 5MB của multer nhưng giải mã ra khoảng
 * 196MB RGBA; rate limit theo từng người chơi không chặn được hai chục tài
 * khoản miễn phí cùng gửi song song. Hạ xuống 25 triệu giảm một nửa mức tệ
 * nhất đó trong khi vẫn còn dư sức cho mọi ảnh thật.
 */
const MAX_INPUT_PIXELS = 25_000_000;

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
  // Chỉ kiểm "RIFF" là nhận nhầm cả WAV và AVI. Hàm này không phân biệt WebP
  // tĩnh với WebP động (VP8X hoạt hình) - không phải lỗ hổng như GIF, vì
  // processAvatar gọi sharp với mặc định pages: 1, luôn chỉ lấy khung đầu.
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
 */
export async function processAvatar(
  buf: Buffer,
  opts: { maxBytes?: number } = {},
): Promise<{ data: Buffer; quality: number }> {
  const maxBytes = opts.maxBytes ?? MAX_AVATAR_OUTPUT_BYTES;

  // sharp cài trong repo còn giải mã được cả tiff/gif/svg/heif/raw, rộng hơn
  // nhiều so với "chỉ JPEG, PNG, WebP" mà module này hứa. Nếu không tự kiểm
  // lại bằng sniffImageType ở đây thì lời hứa đó chỉ đúng khi MỌI caller
  // tương lai nhớ gọi sniffImageType trước - một giả định không nên đặt ra.
  // Không kiểm thì GIF lọt qua thành avatar tĩnh (sai spec), còn SVG chạm tới
  // librsvg - một trình phân tích XML - trước khi kịp đếm điểm ảnh.
  if (sniffImageType(buf) === null) {
    throw new AvatarImageError("Chỉ chấp nhận ảnh JPG, PNG hoặc WebP");
  }

  const square = sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" });

  for (const quality of QUALITY_LADDER) {
    let data: Buffer;
    try {
      data = await square.clone().webp({ quality }).toBuffer();
    } catch (err) {
      // libvips báo hai lỗi khác hẳn nhau bằng chuỗi tiếng Anh của riêng nó:
      // "Input image exceeds pixel limit" khi header khai kích thước vượt
      // MAX_INPUT_PIXELS, còn lại là các kiểu buffer không giải mã được (ví
      // dụ "Input buffer has corrupt header"). Bắt theo chuỗi phụ này để trả
      // đúng câu tiếng Việt cho từng trường hợp - người upload ảnh 9000x9000
      // không nên nghe rằng file của họ "có thể đã hỏng".
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("exceeds pixel limit")) {
        throw new AvatarImageError("Ảnh có kích thước quá lớn, hãy thử ảnh nhỏ hơn", {
          cause: err,
        });
      }
      throw new AvatarImageError("Không đọc được ảnh, file có thể đã hỏng", { cause: err });
    }
    if (data.length <= maxBytes) return { data, quality };
  }

  // Thang chất lượng gần như không bao giờ tụt hết - 256x256 ở q82 thường
  // 15-25 KB. Nhưng "gần như không bao giờ" không phải một đảm bảo, còn trần
  // 200 KB thì là một yêu cầu, nên hết thang là từ chối chứ không nới trần.
  // Math.max(1, ...) vì maxBytes nhỏ (test dùng maxBytes: 1) sẽ làm Math.round
  // ra 0, và "dưới 0 KB" là một câu vô nghĩa với người đọc.
  const capKb = Math.max(1, Math.round(maxBytes / 1024));
  throw new AvatarImageError(`Không nén được ảnh xuống dưới ${capKb} KB, hãy thử ảnh khác`);
}
