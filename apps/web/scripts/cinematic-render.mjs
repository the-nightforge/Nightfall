/**
 * Bút vẽ cho bộ dựng clip chuyển cảnh.
 *
 * Vẽ thẳng ra một khung RGB24 bằng JavaScript thuần, không canvas, không thư
 * viện đồ hoạ. Lý do là giấy phép: mọi khung hình trong /public/cinematics phải
 * truy được về đúng repo này, và cách chắc chắn nhất để không có một pixel nào
 * đến từ nơi khác là không tải một pixel nào về cả.
 *
 * Hai hình khối duy nhất không sinh ra từ công thức - dãy nhà và dấu đầu sói -
 * dùng lại NGUYÊN đường path SVG của `VillageSilhouette.tsx` và `WolfMark.tsx`,
 * nên clip và bản dựng CSS là cùng một ngôi làng chứ không phải hai bản vẽ hao
 * hao nhau.
 */

export const WIDTH = 1280;
export const HEIGHT = 720;
export const FPS = 30;

/**
 * Vùng an toàn giữa khung, theo tỉ lệ bề rộng.
 *
 * Lớp phủ dùng `object-cover`. Trên màn dọc 390x844 một khung 16:9 bị phóng
 * theo CHIỀU CAO rồi cắt hai bên, và phần còn thấy được chỉ là khoảng 26% bề
 * rộng ở giữa. Nghĩa là mặt trăng đặt ở 78% bề rộng - đúng chỗ bản CSS đặt nó -
 * sẽ không bao giờ xuất hiện trên điện thoại. Mọi tiêu điểm trong các cảnh dưới
 * đây nằm trong dải này.
 */
export const SAFE_X = [0.37, 0.63];

export function createFrame() {
  return new Float32Array(WIDTH * HEIGHT * 3);
}

export function hex(value) {
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** Nhịp vào-ra mềm; dùng khắp nơi để không cảnh nào bắt đầu bằng một cú giật. */
export const ease = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - (1 - t) * (1 - t);
export const easeIn = (t) => t * t;

/** Nền dọc. `stops` là [vị trí 0..1, màu] đã sắp xếp tăng dần. */
export function verticalGradient(buf, stops) {
  for (let y = 0; y < HEIGHT; y += 1) {
    const p = y / (HEIGHT - 1);
    let i = 0;
    while (i < stops.length - 2 && stops[i + 1][0] < p) i += 1;
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    const k = p1 === p0 ? 0 : clamp((p - p0) / (p1 - p0), 0, 1);
    const r = lerp(c0[0], c1[0], k);
    const g = lerp(c0[1], c1[1], k);
    const b = lerp(c0[2], c1[2], k);
    for (let x = 0; x < WIDTH; x += 1) {
      const o = (y * WIDTH + x) * 3;
      buf[o] = r;
      buf[o + 1] = g;
      buf[o + 2] = b;
    }
  }
}

/**
 * Quầng sáng hình elip, cộng thêm vào nền.
 *
 * Cộng chứ không phủ: đây là ánh sáng - trăng, mặt trời, vệt nổ - và ánh sáng
 * chồng lên nhau thì sáng thêm chứ không che nhau. Phủ alpha sẽ làm quầng trăng
 * xoá mất dãy nhà nằm dưới nó.
 */
export function glow(buf, { cx, cy, rx, ry, color, strength, power = 2 }) {
  const x0 = Math.max(0, Math.floor((cx - rx) * WIDTH));
  const x1 = Math.min(WIDTH, Math.ceil((cx + rx) * WIDTH));
  const y0 = Math.max(0, Math.floor((cy - ry) * HEIGHT));
  const y1 = Math.min(HEIGHT, Math.ceil((cy + ry) * HEIGHT));
  for (let y = y0; y < y1; y += 1) {
    const dy = (y / HEIGHT - cy) / ry;
    for (let x = x0; x < x1; x += 1) {
      const dx = (x / WIDTH - cx) / rx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= 1) continue;
      const a = strength * Math.pow(1 - d, power);
      const o = (y * WIDTH + x) * 3;
      buf[o] += color[0] * a;
      buf[o + 1] += color[1] * a;
      buf[o + 2] += color[2] * a;
    }
  }
}

/** Đĩa đặc có viền mềm: mặt trăng, mặt trời. */
export function disc(buf, { cx, cy, r, color, softness = 0.12, alpha = 1 }) {
  const rx = r;
  const ry = (r * WIDTH) / HEIGHT;
  const x0 = Math.max(0, Math.floor((cx - rx * 1.2) * WIDTH));
  const x1 = Math.min(WIDTH, Math.ceil((cx + rx * 1.2) * WIDTH));
  const y0 = Math.max(0, Math.floor((cy - ry * 1.2) * HEIGHT));
  const y1 = Math.min(HEIGHT, Math.ceil((cy + ry * 1.2) * HEIGHT));
  for (let y = y0; y < y1; y += 1) {
    const dy = y / HEIGHT - cy;
    for (let x = x0; x < x1; x += 1) {
      const dx = (x / WIDTH - cx) * (WIDTH / HEIGHT);
      const d = Math.sqrt(dx * dx + dy * dy) / ry;
      if (d >= 1 + softness) continue;
      const a = alpha * clamp((1 + softness - d) / (softness * 2), 0, 1);
      const o = (y * WIDTH + x) * 3;
      buf[o] = lerp(buf[o], color[0], a);
      buf[o + 1] = lerp(buf[o + 1], color[1], a);
      buf[o + 2] = lerp(buf[o + 2], color[2], a);
    }
  }
}

/** Tia sáng toả từ một điểm. `count` tia, quay theo `spin`. */
export function rays(buf, { cx, cy, count, spin, color, strength, length = 0.9 }) {
  for (let y = 0; y < HEIGHT; y += 1) {
    const dy = y / HEIGHT - cy;
    for (let x = 0; x < WIDTH; x += 1) {
      const dx = (x / WIDTH - cx) * (WIDTH / HEIGHT);
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > length) continue;
      const ang = Math.atan2(dy, dx) + spin;
      // Nâng luỹ thừa để tia mảnh và tách bạch, không thành một cái quạt xám.
      const wedge = Math.pow(Math.max(0, Math.cos(ang * count)), 8);
      const fade = Math.pow(1 - d / length, 1.6) * (1 - Math.exp(-d * 14));
      const a = strength * wedge * fade;
      if (a <= 0.002) continue;
      const o = (y * WIDTH + x) * 3;
      buf[o] += color[0] * a;
      buf[o + 1] += color[1] * a;
      buf[o + 2] += color[2] * a;
    }
  }
}

/** Vòng sáng mảnh đang lan ra. */
export function ring(buf, { cx, cy, r, thickness, color, strength }) {
  for (let y = 0; y < HEIGHT; y += 1) {
    const dy = y / HEIGHT - cy;
    for (let x = 0; x < WIDTH; x += 1) {
      const dx = (x / WIDTH - cx) * (WIDTH / HEIGHT);
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = strength * Math.exp(-((d - r) * (d - r)) / (2 * thickness * thickness));
      if (a <= 0.002) continue;
      const o = (y * WIDTH + x) * 3;
      buf[o] += color[0] * a;
      buf[o + 1] += color[1] * a;
      buf[o + 2] += color[2] * a;
    }
  }
}

/**
 * Vệt sáng theo một đoạn thẳng, mềm dần ra hai bên và nhạt dần về hai đầu.
 *
 * Đây là vuốt móng của cảnh Sói. Vẽ bằng khoảng cách tới đoạn thẳng chứ không
 * bằng một hình chữ nhật xoay: cần đúng cái viền mềm đó, còn một hình chữ nhật
 * sắc cạnh nghiêng 40 độ thì trông ra một thanh trượt giao diện.
 */
export function streak(buf, { x0, y0, x1, y1, width, color, strength }) {
  const ax = x0 * WIDTH;
  const ay = y0 * HEIGHT;
  const bx = x1 * WIDTH;
  const by = y1 * HEIGHT;
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const w = width * HEIGHT;
  const pad = w * 2.5;
  const lo = Math.max(0, Math.floor(Math.min(ay, by) - pad));
  const hi = Math.min(HEIGHT, Math.ceil(Math.max(ay, by) + pad));
  const left = Math.max(0, Math.floor(Math.min(ax, bx) - pad));
  const right = Math.min(WIDTH, Math.ceil(Math.max(ax, bx) + pad));

  for (let y = lo; y < hi; y += 1) {
    for (let x = left; x < right; x += 1) {
      const t = len2 === 0 ? 0 : clamp(((x - ax) * vx + (y - ay) * vy) / len2, 0, 1);
      const px = ax + vx * t - x;
      const py = ay + vy * t - y;
      const d = Math.sqrt(px * px + py * py);
      if (d > pad) continue;
      // Nhạt về hai đầu để vệt có hướng, như một nhát vuốt chứ không phải một
      // que sáng nằm im.
      const along = Math.sin(Math.PI * t);
      const a = strength * Math.exp(-(d * d) / (2 * w * w)) * along * along;
      if (a <= 0.002) continue;
      const o = (y * WIDTH + x) * 3;
      buf[o] += color[0] * a;
      buf[o + 1] += color[1] * a;
      buf[o + 2] += color[2] * a;
    }
  }
}

/** Tối bốn góc. Luôn là lớp cuối, để nó ăn cả những gì vừa vẽ lên. */
export function vignette(buf, strength, radius = 0.72) {
  for (let y = 0; y < HEIGHT; y += 1) {
    const dy = y / HEIGHT - 0.5;
    for (let x = 0; x < WIDTH; x += 1) {
      const dx = (x / WIDTH - 0.5) * (WIDTH / HEIGHT);
      const d = Math.sqrt(dx * dx + dy * dy);
      const k = 1 - strength * clamp((d - radius) / (0.75 - radius + 0.001), 0, 1);
      const o = (y * WIDTH + x) * 3;
      buf[o] *= k;
      buf[o + 1] *= k;
      buf[o + 2] *= k;
    }
  }
}

export function brightness(buf, k) {
  for (let i = 0; i < buf.length; i += 1) buf[i] *= k;
}

function hash(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = ease(x - xi);
  const yf = ease(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

/** Sương / khói, trôi theo `driftX`. Hai tầng tần số để không ra một tấm vải phẳng. */
export function mist(buf, { scale, driftX, driftY, color, strength, seed = 1, bias = 0.45 }) {
  for (let y = 0; y < HEIGHT; y += 1) {
    const ny = (y / HEIGHT) * scale + driftY;
    for (let x = 0; x < WIDTH; x += 1) {
      const nx = (x / WIDTH) * scale * (WIDTH / HEIGHT) + driftX;
      const n = valueNoise(nx, ny, seed) * 0.65 + valueNoise(nx * 2.3, ny * 2.3, seed + 7) * 0.35;
      const a = strength * Math.max(0, n - bias) * 2;
      if (a <= 0.002) continue;
      const o = (y * WIDTH + x) * 3;
      buf[o] += color[0] * a;
      buf[o + 1] += color[1] * a;
      buf[o + 2] += color[2] * a;
    }
  }
}

/**
 * Hạt nhiễu rất nhẹ.
 *
 * Không phải để cho "có chất phim": cả mười cảnh đều là dải chuyển màu lớn, và
 * dải chuyển màu ở bitrate 8 bit luôn bị vỡ thành từng khoanh. Một chút nhiễu
 * phá vỡ ranh giới khoanh màu và bộ mã hoá giữ lại được độ mượt.
 */
export function grain(buf, amount, seed) {
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const n = (hash(x, y, seed) - 0.5) * amount;
      const o = (y * WIDTH + x) * 3;
      buf[o] += n;
      buf[o + 1] += n;
      buf[o + 2] += n;
    }
  }
}

/* --- Đường path SVG ------------------------------------------------------ */

/**
 * Đọc `d` của một path SVG thành các đường gấp khúc.
 *
 * Chỉ hiểu đúng những lệnh mà hai file SVG trong repo dùng: M/m L/l H/h V/v
 * C/c Z/z. Cố tình KHÔNG viết cho đủ bộ - một bộ đọc path đầy đủ là vài trăm
 * dòng phải tự bảo trì, còn ở đây thêm một lệnh lạ thì nên là lỗi ồn ào chứ
 * không phải một hình vẽ sai âm thầm.
 */
export function parsePath(d) {
  const tokens = d.match(/[MmLlHhVvCcZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const rings = [];
  let ring = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let cmd = "";
  let i = 0;

  const num = () => Number(tokens[i++]);
  const push = () => ring?.push([x, y]);
  const open = () => {
    ring = [];
    rings.push(ring);
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (/[MmLlHhVvCcZz]/.test(token)) {
      cmd = token;
      i += 1;
    }
    switch (cmd) {
      case "M":
      case "m": {
        const nx = num();
        const ny = num();
        x = cmd === "M" ? nx : x + nx;
        y = cmd === "M" ? ny : y + ny;
        startX = x;
        startY = y;
        open();
        push();
        // Toạ độ tiếp theo sau M là một L ngầm, theo đúng đặc tả SVG.
        cmd = cmd === "M" ? "L" : "l";
        break;
      }
      case "L":
      case "l": {
        const nx = num();
        const ny = num();
        x = cmd === "L" ? nx : x + nx;
        y = cmd === "L" ? ny : y + ny;
        push();
        break;
      }
      case "H":
      case "h": {
        const nx = num();
        x = cmd === "H" ? nx : x + nx;
        push();
        break;
      }
      case "V":
      case "v": {
        const ny = num();
        y = cmd === "V" ? ny : y + ny;
        push();
        break;
      }
      case "C":
      case "c": {
        const rel = cmd === "c";
        const x1 = (rel ? x : 0) + num();
        const y1 = (rel ? y : 0) + num();
        const x2 = (rel ? x : 0) + num();
        const y2 = (rel ? y : 0) + num();
        const x3 = (rel ? x : 0) + num();
        const y3 = (rel ? y : 0) + num();
        const x0 = x;
        const y0 = y;
        // 20 đoạn: đường cong duy nhất trong repo là má con sói, dài chưa tới
        // một phần ba khung - ở độ phân giải này mắt không thấy được cạnh gãy.
        for (let s = 1; s <= 20; s += 1) {
          const t = s / 20;
          const u = 1 - t;
          x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
          y = u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3;
          push();
        }
        break;
      }
      case "Z":
      case "z": {
        x = startX;
        y = startY;
        push();
        ring = null;
        i += 0;
        break;
      }
      default:
        throw new Error(`Lệnh path chưa hỗ trợ: ${token}`);
    }
  }
  return rings.filter((r) => r.length > 2);
}

/**
 * Tô một path theo luật even-odd, có khử răng cưa.
 *
 * even-odd chứ không phải nonzero: dấu đầu sói dựa vào đúng luật này để hai mắt
 * và cái mõm là LỖ thủng chứ không phải hình đè lên - xem ghi chú trong
 * `WolfMark.tsx`. Khử răng cưa bằng 4 dòng quét con trên mỗi hàng pixel, cộng
 * độ phủ theo phần lẻ ở hai đầu mỗi đoạn.
 */
export function fillPath(buf, rings, { scale, tx, ty, color, alpha }) {
  const SUB = 4;
  const coverage = new Float32Array(WIDTH);
  const edges = [];
  let minY = Infinity;
  let maxY = -Infinity;

  for (const r of rings) {
    for (let k = 0; k < r.length; k += 1) {
      const [ax, ay] = r[k];
      const [bx, by] = r[(k + 1) % r.length];
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
  const yEnd = Math.min(HEIGHT, Math.ceil(maxY) + 1);
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
        const xa = clamp(xs[k], 0, WIDTH);
        const xb = clamp(xs[k + 1], 0, WIDTH);
        if (xb <= xa) continue;
        const ia = Math.floor(xa);
        const ib = Math.floor(xb);
        if (ia === ib) {
          coverage[ia] += (xb - xa) / SUB;
          continue;
        }
        coverage[ia] += (ia + 1 - xa) / SUB;
        for (let px = ia + 1; px < ib; px += 1) coverage[px] += 1 / SUB;
        if (ib < WIDTH) coverage[ib] += (xb - ib) / SUB;
      }
    }
    for (let x = 0; x < WIDTH; x += 1) {
      const a = coverage[x] * alpha;
      if (a <= 0.002) continue;
      const o = (y * WIDTH + x) * 3;
      buf[o] = lerp(buf[o], color[0], Math.min(1, a));
      buf[o + 1] = lerp(buf[o + 1], color[1], Math.min(1, a));
      buf[o + 2] = lerp(buf[o + 2], color[2], Math.min(1, a));
    }
  }
}

/** Hình đa giác dựng tại chỗ, toạ độ theo tỉ lệ khung (0..1). */
export function polygon(buf, points, { color, alpha }) {
  fillPath(buf, [points.map(([x, y]) => [x * WIDTH, y * HEIGHT])], {
    scale: 1,
    tx: 0,
    ty: 0,
    color,
    alpha,
  });
}

export function toBytes(buf, out) {
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i];
    out[i] = v <= 0 ? 0 : v >= 255 ? 255 : v + 0.5;
  }
  return out;
}
