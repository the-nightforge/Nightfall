/**
 * Chụp ảnh các màn hình chính vào docs/screens/ để review UI.
 *
 * Lái Edge qua CDP: tạo phòng, thêm 7 bot, bắt đầu, rồi chụp mỗi khi nhãn pha
 * đổi. Không thêm dependency nào - Node 22 đã có WebSocket sẵn.
 *
 * Chạy: node tools/capture-screens.mjs   (web ở :3000, server ở :4100)
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = Number(process.env.CDP_PORT ?? 9223);
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
// Khung chụp và thư mục ra, đổi bằng biến môi trường: bản điện thoại và bản
// web là cùng một kịch bản, chỉ khác kích thước khung.
const OUT = process.env.OUT ?? "docs/screens/mobile";
const VIEW = {
  width: Number(process.env.W ?? 390),
  height: Number(process.env.H ?? 844),
  deviceScaleFactor: Number(process.env.DSF ?? 2),
  mobile: process.env.MOBILE !== "0",
};
const PROFILE = join(tmpdir(), `masoi-shots-${Date.now()}`);

mkdirSync(OUT, { recursive: true });

const edge = spawn(EDGE, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  "--headless=new",
  "--hide-scrollbars",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=Translate,PrivacySandboxSettings4",
  // Không có ba cờ này thì tab bị coi là chạy nền: rAF bị bóp, AnimatePresence
  // không chạy xong hoạt ảnh thoát, và banner pha đứng lại ở pha CŨ - ảnh chụp
  // ra sẽ là một màn hình chưa từng tồn tại.
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  `--window-size=${process.env.W ?? 390},${process.env.H ?? 844}`,
  "about:blank",
], { stdio: "ignore" });

async function targetWs() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(500);
  }
  throw new Error("Edge không mở cổng debug");
}

const ws = new WebSocket(await targetWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let seq = 0;
const waiting = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  const p = waiting.get(msg.id);
  if (!p) return;
  waiting.delete(msg.id);
  msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    waiting.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + expression);
  return r.result.value;
};

/** Bấm nút đầu tiên có chữ khớp. Trả về true nếu bấm được. */
const clickText = (text) =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('button,a')]
      .find((b) => b.offsetParent !== null && !b.disabled && b.textContent.includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`);

const waitFor = async (expr, timeoutMs = 30000, label = expr) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(expr)) return true;
    await sleep(400);
  }
  throw new Error(`Hết giờ chờ: ${label}`);
};

let n = 0;
async function shot(name, { fullPage = true } = {}) {
  await hideDevBadge();
  await evaluate(`window.scrollTo(0, 0)`);
  await send("Page.bringToFront").catch(() => {});
  const r = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: fullPage,
    optimizeForSpeed: false,
  });
  const file = `${OUT}/${String(++n).padStart(2, "0")}-${name}.png`;
  writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log("shot", file);
  return file;
}

/** Ẩn huy hiệu dev của Next.js - nó không thuộc UI của game. */
const hideDevBadge = () =>
  evaluate(`(() => {
    let el = document.getElementById('masoi-shot-css');
    if (!el) {
      el = document.createElement('style');
      el.id = 'masoi-shot-css';
      el.textContent = 'nextjs-portal{display:none!important}';
      document.head.appendChild(el);
    }
    return true;
  })()`);

const slug = {
  "Xem vai trò": "xem-vai-tro",
  "Ban đêm": "ban-dem",
  "Trời sáng": "troi-sang",
  "Thảo luận": "thao-luan",
  "Bỏ phiếu sơ bộ": "bo-phieu-so-bo",
  "Biện hộ": "bien-ho",
  "Bỏ phiếu xác nhận": "bo-phieu-xac-nhan",
  "Kết thúc": "ket-qua",
};

/**
 * Pha hiện tại đọc từ dòng aria-live của PhaseBanner, KHÔNG từ thẻ <h2>.
 *
 * <h2> nằm trong AnimatePresence nên nó chỉ đổi khi hoạt ảnh thoát chạy xong;
 * dòng sr-only thì đổi ngay cùng snapshot.
 */
const phaseLabel = () =>
  evaluate(`(() => {
    const known = ${JSON.stringify(Object.keys(slug))};
    return [...document.querySelectorAll('p.sr-only[aria-live="polite"]')]
      .map((el) => el.textContent.trim().split(',')[0].trim())
      .find((t) => known.includes(t)) ?? null;
  })()`);

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", VIEW);

// ---- Trang chủ ----
await send("Page.navigate", { url: BASE });
await waitFor(`!!document.querySelector('input')`, 30000, "trang chủ tải xong");
await hideDevBadge();
await sleep(2500);
await shot("trang-chu");

// ---- Tạo phòng ----
await evaluate(`(() => {
  const el = document.querySelector('input');
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, 'Người Kể Chuyện');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await sleep(300);
if (!(await clickText("Tạo phòng mới"))) throw new Error("Không thấy nút Tạo phòng mới");
await waitFor(`location.pathname.startsWith('/room/')`, 45000, "vào phòng");
await waitFor(`document.body.innerText.includes('Bắt đầu trò chơi')`, 45000, "sảnh chờ hiện");
await hideDevBadge();
await sleep(1500);

// ---- Thêm bot cho đủ 8 ghế ----
for (let i = 0; i < 7; i++) {
  await clickText("Thêm bot để chơi thử");
  await sleep(900);
}
await waitFor(
  `!!document.querySelector('button.btn-cta') && !document.querySelector('button.btn-cta').disabled`,
  30000,
  "đủ người để bắt đầu",
);
await sleep(1500);
await shot("phong-cho");

// ---- Bảng luật và vai trò ----
if (await clickText("Luật và vai trò")) {
  await sleep(1200);
  await shot("phong-cho-luat-va-vai-tro", { fullPage: false });
  await evaluate(`document.querySelector('[aria-label="Đóng"]')?.click() ?? true`);
  await sleep(800);
}

// ---- Vào ván ----
await evaluate(`document.querySelector('button.btn-cta').click()`);

const seen = new Set();
const deadline = Date.now() + 20 * 60_000;
let last = null;
while (Date.now() < deadline) {
  const label = await phaseLabel();
  if (label && label !== last) {
    last = label;
    const key = slug[label];
    if (key && !seen.has(key)) {
      // Chờ lớp phủ chuyển cảnh chạy xong rồi mới chụp, và chỉ chụp nếu pha
      // chưa đổi tiếp - pha ngắn thì bỏ qua còn hơn chụp nhầm.
      await sleep(label === "Kết thúc" ? 7000 : 4500);
      if ((await phaseLabel()) === label) {
        seen.add(key);
        // Trong ván thì chụp đúng khung màn hình - đó là thứ người chơi thấy,
        // và thanh cố định chỉ đứng đúng chỗ ở khung đó.
        await shot(key, { fullPage: false });
        if (key === "ket-qua") await shot("ket-qua-full", { fullPage: true });
      }
    }
  }
  if (last === "Kết thúc" && seen.has("ket-qua")) break;
  await sleep(1200);
}

console.log("xong:", [...seen].join(", "));
ws.close();
edge.kill();
