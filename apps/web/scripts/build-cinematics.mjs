/**
 * Dựng lại toàn bộ /public/cinematics.
 *
 *   node scripts/build-cinematics.mjs            # cả mười cảnh
 *   node scripts/build-cinematics.mjs nightfall  # chỉ một cảnh
 *   FFMPEG=/duong/dan/ffmpeg node scripts/build-cinematics.mjs
 *
 * Không có clip nào tải về từ đâu cả: mọi khung hình sinh ra từ `cinematic-
 * scenes.mjs` rồi đẩy thẳng qua ống stdin của ffmpeg dưới dạng RGB24. Nhờ vậy
 * câu hỏi giấy phép của cả thư mục chỉ có một câu trả lời - tự dựng cho dự án -
 * và bất kỳ ai cũng dựng lại được y hệt từ chính repo này.
 *
 * ffmpeg là công cụ dựng, KHÔNG phải dependency của web: không có nó thì
 * `npm ci` vẫn chạy, `next build` vẫn chạy, và game vẫn đủ chuyển cảnh bằng bản
 * CSS. Vì vậy nó không nằm trong package.json.
 */

import { spawn } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FPS, HEIGHT, WIDTH, createFrame, toBytes } from "./cinematic-render.mjs";
import { SCENES } from "./cinematic-scenes.mjs";

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "cinematics");

/**
 * Hai bản mã hoá cho mỗi cảnh.
 *
 * `-an` là chỗ gỡ hẳn track tiếng - không phải hạ âm lượng về 0. Mọi âm thanh
 * trong game đi qua audio engine để còn nghe thanh trượt âm lượng và nút tắt
 * tiếng; tiếng nhúng trong clip đi vòng qua tất cả những thứ đó, và lớp phủ
 * phát ở chế độ muted nên nó cũng chỉ tổ nặng file.
 *
 * CRF chứ không phải bitrate cố định: mười cảnh này dài ngắn khác nhau và độ
 * phức tạp cũng khác nhau, ép cùng một bitrate thì cảnh sương mù bị vỡ còn cảnh
 * cửa đóng thì phí chỗ.
 */
const ENCODERS = [
  {
    ext: "webm",
    args: (out) => [
      "-c:v", "libvpx-vp9",
      "-crf", "33",
      "-b:v", "0",
      "-row-mt", "1",
      "-tile-columns", "2",
      "-pix_fmt", "yuv420p",
      "-an",
      out,
    ],
  },
  {
    // Bản lui cho Safari cũ. profile main + yuv420p là mẫu số chung an toàn
    // nhất; high10 hay yuv444 sẽ ra một thẻ <video> im lìm trên iOS đời cũ.
    ext: "mp4",
    args: (out) => [
      "-c:v", "libx264",
      "-profile:v", "main",
      "-preset", "slow",
      "-crf", "26",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-an",
      out,
    ],
  },
];

async function encode(name, scene, encoder) {
  const out = path.join(OUT_DIR, `${name}.${encoder.ext}`);
  const frames = Math.max(1, Math.round((scene.durationMs / 1000) * FPS));

  const ff = spawn(
    FFMPEG,
    [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-f", "rawvideo",
      "-pix_fmt", "rgb24",
      "-s", `${WIDTH}x${HEIGHT}`,
      "-r", String(FPS),
      "-i", "-",
      ...encoder.args(out),
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );

  const done = new Promise((resolve, reject) => {
    ff.on("error", reject);
    ff.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg thoát với mã ${code} khi dựng ${out}`)),
    );
  });

  const buf = createFrame();
  const bytes = Buffer.allocUnsafe(WIDTH * HEIGHT * 3);
  for (let f = 0; f < frames; f += 1) {
    // Chia cho (frames - 1) để khung cuối rơi đúng t = 1: các cảnh đều kết ở
    // một trạng thái đứng yên, và dừng ở t = 0,97 thì khung cuối vẫn đang động.
    scene.draw(buf, frames === 1 ? 1 : f / (frames - 1));
    toBytes(buf, bytes);
    if (!ff.stdin.write(bytes)) {
      await new Promise((resolve) => ff.stdin.once("drain", resolve));
    }
  }
  ff.stdin.end();
  await done;

  const { size } = await stat(out);
  return { file: `${name}.${encoder.ext}`, size };
}

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted : Object.keys(SCENES);
for (const name of names) {
  if (!SCENES[name]) throw new Error(`Không có cảnh nào tên "${name}"`);
}

await mkdir(OUT_DIR, { recursive: true });

const results = [];
for (const name of names) {
  for (const encoder of ENCODERS) {
    const t0 = Date.now();
    const result = await encode(name, SCENES[name], encoder);
    results.push(result);
    console.log(
      `${result.file.padEnd(26)} ${(result.size / 1024).toFixed(0).padStart(6)} KB  ` +
        `${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }
}

const total = results.reduce((sum, r) => sum + r.size, 0);
console.log(`\n${results.length} file, tổng ${(total / 1024 / 1024).toFixed(2)} MB`);
