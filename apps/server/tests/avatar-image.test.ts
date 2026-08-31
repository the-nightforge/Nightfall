import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  AVATAR_SIZE,
  MAX_AVATAR_OUTPUT_BYTES,
  processAvatar,
  sniffImageType,
} from "../src/avatar/image";

/** Nhiễu tất định (LCG) - không dùng Math.random để test không đỏ ngẫu nhiên. */
function noise(width: number, height: number): Buffer {
  const px = Buffer.alloc(width * height * 3);
  let seed = 12345;
  for (let i = 0; i < px.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    px[i] = seed & 0xff;
  }
  return px;
}

function noisy(width = 512, height = 512) {
  return sharp(noise(width, height), { raw: { width, height, channels: 3 } });
}

function flat(width = 800, height = 600, color = { r: 200, g: 60, b: 60 }) {
  return sharp({ create: { width, height, channels: 3, background: color } });
}

/** Ảnh dọc 200x400: nửa TRÊN đỏ, nửa DƯỚI xanh dương. */
async function halvesPortrait(): Promise<Buffer> {
  const px = Buffer.alloc(200 * 400 * 3);
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 200; x++) {
      const i = (y * 200 + x) * 3;
      if (y < 200) {
        px[i] = 230;
      } else {
        px[i + 2] = 230;
      }
    }
  }
  return sharp(px, { raw: { width: 200, height: 400, channels: 3 } }).jpeg().toBuffer();
}

async function pixel(webp: Buffer, x: number, y: number) {
  const { data, info } = await sharp(webp).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

describe("sniffImageType", () => {
  it("nhận JPEG thật", async () => {
    expect(sniffImageType(await flat().jpeg().toBuffer())).toBe("jpeg");
  });

  it("nhận PNG thật", async () => {
    expect(sniffImageType(await flat().png().toBuffer())).toBe("png");
  });

  it("nhận WebP thật", async () => {
    expect(sniffImageType(await flat().webp().toBuffer())).toBe("webp");
  });

  it("từ chối GIF - ảnh động ngoài phạm vi", async () => {
    expect(sniffImageType(await flat().gif().toBuffer())).toBeNull();
  });

  it("từ chối file giả mạo: đuôi .png, MIME image/png, ruột là ZIP", () => {
    // PK\x03\x04 - đây là thứ mà việc tin file.mimetype của client sẽ cho lọt.
    expect(sniffImageType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBeNull();
  });

  it("từ chối HTML giả dạng ảnh", () => {
    expect(sniffImageType(Buffer.from("<html><body>xin chao</body></html>"))).toBeNull();
  });

  it("từ chối buffer rỗng và buffer cụt", async () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    const png = await flat().png().toBuffer();
    expect(sniffImageType(png.subarray(0, 4))).toBeNull();
  });

  it("từ chối RIFF không phải WEBP (ví dụ WAV)", () => {
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]);
    expect(sniffImageType(wav)).toBeNull();
  });
});

describe("processAvatar", () => {
  it("ảnh chữ nhật ra WebP vuông 256x256", async () => {
    const { data } = await processAvatar(await flat(800, 600).jpeg().toBuffer());
    const meta = await sharp(data).metadata();

    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(AVATAR_SIZE);
    expect(meta.height).toBe(AVATAR_SIZE);
  });

  it("ảnh nhiễu 512x512 vẫn dưới trần 200 KB ở bậc chất lượng đầu tiên", async () => {
    const { data, quality } = await processAvatar(await noisy().jpeg().toBuffer());

    expect(quality).toBe(82);
    expect(data.length).toBeLessThanOrEqual(MAX_AVATAR_OUTPUT_BYTES);
  });

  it("tụt bậc chất lượng khi trần quá chặt, không bao giờ trả file vượt trần", async () => {
    const source = await noisy().jpeg().toBuffer();
    const first = await processAvatar(source);

    const tight = await processAvatar(source, { maxBytes: first.data.length - 1 });

    expect(tight.quality).toBeLessThan(first.quality);
    expect(tight.data.length).toBeLessThanOrEqual(first.data.length - 1);
  });

  it("hết bậc mà vẫn vượt trần thì TỪ CHỐI chứ không trả file quá lớn", async () => {
    await expect(
      processAvatar(await noisy().jpeg().toBuffer(), { maxBytes: 1 }),
    ).rejects.toThrow(/Không nén được ảnh xuống dưới \d+ KB/);
  });

  it("từ chối GIF dù sharp giải mã được - sniffImageType là chốt chặn thật", async () => {
    await expect(processAvatar(await flat().gif().toBuffer())).rejects.toThrow(
      /Chỉ chấp nhận ảnh JPG, PNG hoặc WebP/,
    );
  });

  it("tự xoay theo EXIF trước khi crop", async () => {
    // Orientation 6 = xoay 90 độ theo chiều kim đồng hồ khi hiển thị. Ảnh dọc
    // đỏ-trên/xanh-dưới sẽ thành ảnh ngang xanh-trái/đỏ-phải. Không .rotate()
    // thì crop giữa vẫn cho đỏ-trên/xanh-dưới, và hai điểm lấy mẫu bên dưới sẽ
    // cùng màu - đó là cách test này bắt lỗi.
    const rotated = await sharp(await halvesPortrait())
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const { data } = await processAvatar(rotated);
    const left = await pixel(data, 64, 128);
    const right = await pixel(data, 192, 128);

    expect(left.b).toBeGreaterThan(left.r);
    expect(right.r).toBeGreaterThan(right.b);
  });

  it("từ chối ảnh hỏng", async () => {
    const png = await flat().png().toBuffer();
    const broken = Buffer.concat([png.subarray(0, 40), Buffer.from("rác rác rác")]);

    await expect(processAvatar(broken)).rejects.toThrow(/Không đọc được ảnh, file có thể đã hỏng/);
  });

  it("từ chối ảnh vượt trần điểm ảnh thay vì làm cạn RAM", async () => {
    // 9000x9000 = 81 triệu điểm ảnh, vượt trần 50 triệu.
    const huge = await sharp({
      create: { width: 9000, height: 9000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await expect(processAvatar(huge)).rejects.toThrow(/Ảnh có kích thước quá lớn/);
  }, 60_000);
});
