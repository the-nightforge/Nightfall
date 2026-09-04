/**
 * Bộ sinh icon PWA.
 *
 * Vẽ thẳng ra pixel rồi tự đóng gói PNG bằng `zlib` của Node - không sharp,
 * không canvas, không một thư viện đồ hoạ nào. Cùng một lý do với
 * `cinematic-render.mjs`: mọi pixel nằm trong /public phải truy được về đúng
 * repo này, và cách chắc chắn nhất để không có pixel nào đến từ nơi khác là
 * không tải pixel nào về cả.
 *
 * Dấu đầu sói dùng lại `parsePath` của bộ dựng clip, nên icon trên màn hình
 * chính và nhận diện trong trang là cùng một con sói, không phải hai bản vẽ
 * hao hao nhau.
 *
 * Chạy: npm run icons --workspace @masoi/web
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePath } from "./cinematic-render.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "..", "public", "icons");

/**
 * `d` của `src/components/WolfMark.tsx`, chép nguyên văn.
 *
 * Chép chứ không import: file kia là TSX trong cây Next, còn script này chạy
 * bằng `node` trần. Sửa dấu ở đó thì phải sửa cả ở đây - không có test nào
 * bắt được việc này, nên ghi rõ ràng tại đây.
 */
const WOLF_PATH = `M12 8 L32 30 C40 26 60 26 68 30 L88 8 L84 40 C90 52 86 66 76 74 L50 95 L24 74 C14 66 10 52 16 40 Z
   M30 46 L42 50 L38 58 L28 52 Z
   M70 46 L58 50 L62 58 L72 52 Z
   M50 70 L43 78 L50 83 L57 78 Z`;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* --- Vẽ ------------------------------------------------------------------ */

/**
 * Tô path theo luật even-odd, khử răng cưa bằng 4 dòng quét con mỗi hàng.
 *
 * Bản rút gọn của `fillPath` trong `cinematic-render.mjs`. Không gọi lại hàm
 * đó được vì nó khoá cứng vào khung 1280x720 của bộ dựng clip, còn ở đây khung
 * là hình vuông và đổi cỡ theo từng icon. `color` là một HÀM theo (x, y) để
 * dấu sói có dải chuyển màu dọc thay vì một mảng đỏ phẳng.
 */
function fillPath(buf, size, rings, { scale, tx, ty, color, alpha = 1 }) {
  const SUB = 4;
  const coverage = new Float32Array(size);
  const edges = [];
  let minY = Infinity;
  let maxY = -Infinity;

  for (const ring of rings) {
    for (let k = 0; k < ring.length; k += 1) {
      const [ax, ay] = ring[k];
      const [bx, by] = ring[(k + 1) % ring.length];
      const x0 = ax * scale + tx;
      const y0 = ay * scale + ty;
      const x1 = bx * scale + tx;
      const y1 = by * scale + ty;
      if (y0 === y1) continue;
      edges.push([x0, y0, x1, y1]);
      minY = Math.min(minY, y0, y1);
      maxY = Math.max(maxY, y0, y1);
    }
  }
  if (edges.length === 0) return;

  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(size, Math.ceil(maxY) + 1);
  const xs = [];

  for (let y = yStart; y < yEnd; y += 1) {
    coverage.fill(0);
    for (let s = 0; s < SUB; s += 1) {
      const sy = y + (s + 0.5) / SUB;
      xs.length = 0;
      for (const [x0, y0, x1, y1] of edges) {
        if (sy < Math.min(y0, y1) || sy >= Math.max(y0, y1)) continue;
        xs.push(x0 + ((sy - y0) / (y1 - y0)) * (x1 - x0));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = clamp(xs[k], 0, size);
        const xb = clamp(xs[k + 1], 0, size);
        if (xb <= xa) continue;
        const ia = Math.floor(xa);
        const ib = Math.floor(xb);
        if (ia === ib) {
          coverage[ia] += (xb - xa) / SUB;
          continue;
        }
        coverage[ia] += (ia + 1 - xa) / SUB;
        for (let px = ia + 1; px < ib; px += 1) coverage[px] += 1 / SUB;
        if (ib < size) coverage[ib] += (xb - ib) / SUB;
      }
    }
    for (let x = 0; x < size; x += 1) {
      const a = Math.min(1, coverage[x] * alpha);
      if (a <= 0.002) continue;
      const c = color(x, y);
      const o = (y * size + x) * 3;
      buf[o] = lerp(buf[o], c[0], a);
      buf[o + 1] = lerp(buf[o + 1], c[1], a);
      buf[o + 2] = lerp(buf[o + 2], c[2], a);
    }
  }
}

/** Quầng sáng tròn, tắt dần theo bình phương khoảng cách tới tâm. */
function glow(buf, size, { cx, cy, radius, color, strength }) {
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(size, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(size, Math.ceil(cy + radius));
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const dx = (x + 0.5 - cx) / radius;
      const dy = (y + 0.5 - cy) / radius;
      const d = Math.hypot(dx, dy);
      if (d >= 1) continue;
      const a = (1 - d) * (1 - d) * strength;
      const o = (y * size + x) * 3;
      buf[o] = lerp(buf[o], color[0], a);
      buf[o + 1] = lerp(buf[o + 1], color[1], a);
      buf[o + 2] = lerp(buf[o + 2], color[2], a);
    }
  }
}

/* --- Bố cục icon --------------------------------------------------------- */

const NIGHT_TOP = [17, 26, 46]; // #111a2e - night-800
const NIGHT_BOT = [7, 11, 20]; // #070b14 - night-950, cũng là theme_color
const BLOOD_HI = [244, 92, 116];
const BLOOD_LO = [176, 26, 48];
const MOON = [198, 219, 255];
const EMBER = [120, 20, 36];

const RINGS = parsePath(WOLF_PATH);

/**
 * Dựng một icon vuông, trả về khung RGB dạng số thực.
 *
 * `wolfRatio` là bề rộng dấu sói so với cạnh khung. Với bản maskable nó phải
 * nhỏ hơn hẳn: Android cắt icon theo một hình bất kỳ và chỉ bảo đảm giữ lại
 * hình tròn giữa khung có ĐƯỜNG KÍNH bằng 80% cạnh. Dấu sói là hình vuông, nên
 * thứ phải lọt vào vòng tròn đó là đường chéo của nó chứ không phải bề rộng.
 */
function renderIcon(size, { wolfRatio, moon = true }) {
  const buf = new Float32Array(size * size * 3);

  // Nền: chuyển màu dọc night-800 -> night-950. Mũ 0.85 để nửa trên sáng lâu
  // hơn một chút, giống hướng sáng của trang chủ.
  for (let y = 0; y < size; y += 1) {
    const c = mix(NIGHT_TOP, NIGHT_BOT, Math.pow(y / (size - 1), 0.85));
    for (let x = 0; x < size; x += 1) {
      const o = (y * size + x) * 3;
      buf[o] = c[0];
      buf[o + 1] = c[1];
      buf[o + 2] = c[2];
    }
  }

  // Trăng lệch phải trên - cùng hướng nguồn sáng với trang chủ. Bản maskable
  // bỏ hẳn: góc là phần đầu tiên bị mặt nạ cắt, đặt tiêu điểm ở đó là phí.
  if (moon) {
    glow(buf, size, {
      cx: size * 0.79,
      cy: size * 0.2,
      radius: size * 0.42,
      color: MOON,
      strength: 0.16,
    });
  }

  // Quầng đỏ sau đầu sói: ở 32px trên thanh tab, đây là thứ giữ cho dấu không
  // bệt vào nền tối thành một ô đen.
  glow(buf, size, {
    cx: size * 0.5,
    cy: size * 0.54,
    radius: size * 0.44,
    color: EMBER,
    strength: 0.55,
  });

  const w = size * wolfRatio;
  // Nhích lên 1.5% cạnh: khối nặng của dấu nằm ở nửa trên, canh giữa hình học
  // thì mắt đọc ra là bị tụt xuống.
  const ty = (size - w) / 2 - size * 0.015;
  fillPath(buf, size, RINGS, {
    scale: w / 100,
    tx: (size - w) / 2,
    ty,
    color: (_x, y) => mix(BLOOD_HI, BLOOD_LO, clamp((y - ty) / w, 0, 1)),
  });

  return buf;
}

/* --- Đóng gói PNG -------------------------------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * PNG 8-bit truecolour (colour type 2), KHÔNG kênh alpha.
 *
 * Bỏ alpha là chủ ý: cả bốn icon đều phủ kín khung, và iOS ghép
 * apple-touch-icon lên nền đen chứ không hiểu trong suốt - một icon có alpha là
 * một icon có viền đen trên iPhone.
 *
 * Mỗi hàng thử cả 5 bộ lọc PNG rồi chọn bộ có tổng trị tuyệt đối nhỏ nhất,
 * đúng cách libpng làm. Với nền chuyển màu dọc, bộ lọc Up cho gần như toàn số
 * 0 và bản 512 rơi từ ~786KB thô xuống còn vài chục KB.
 */
function encodePng(buf, size) {
  const stride = size * 3;
  const raw = Buffer.alloc(size * (stride + 1));
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));

  for (let y = 0; y < size; y += 1) {
    for (let i = 0; i < stride; i += 1) {
      line[i] = clamp(Math.round(buf[y * stride + i]), 0, 255);
    }
    for (let i = 0; i < stride; i += 1) {
      const a = i >= 3 ? line[i - 3] : 0;
      const b = prev[i];
      const c = i >= 3 ? prev[i - 3] : 0;
      cand[0][i] = line[i];
      cand[1][i] = (line[i] - a) & 0xff;
      cand[2][i] = (line[i] - b) & 0xff;
      cand[3][i] = (line[i] - ((a + b) >> 1)) & 0xff;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      cand[4][i] = (line[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
    }
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f += 1) {
      let score = 0;
      for (let i = 0; i < stride; i += 1) score += cand[f][i] < 128 ? cand[f][i] : 256 - cand[f][i];
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    cand[best].copy(raw, y * (stride + 1) + 1);
    line.copy(prev);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  // 10..12 = compression 0, filter 0, interlace 0 - đều là mặc định.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* --- Chạy ---------------------------------------------------------------- */

/*
 * Mỗi cỡ được VẼ LẠI ở đúng độ phân giải của nó, không thu nhỏ từ bản 512. Ở
 * 192px và nhất là 180px, một bản thu nhỏ làm nhoè mất hai con mắt của dấu sói -
 * chúng là lỗ thủng chỉ rộng vài pixel.
 */
const TARGETS = [
  ["icon-192.png", 192, { wolfRatio: 0.62 }],
  ["icon-512.png", 512, { wolfRatio: 0.62 }],
  // 0.5 cạnh -> đường chéo 0.707 * 0.5 = 0.354 cạnh, tức bán kính 0.177 quanh
  // tâm; vùng an toàn maskable là bán kính 0.4. Còn thừa chỗ cho cả quầng đỏ.
  ["icon-maskable-512.png", 512, { wolfRatio: 0.5, moon: false }],
  ["apple-touch-icon.png", 180, { wolfRatio: 0.6 }],
];

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, size, opts] of TARGETS) {
  const png = encodePng(renderIcon(size, opts), size);
  writeFileSync(join(OUT_DIR, name), png);
  console.log(`${name.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}
