# Lớp chuyển động dùng chung + màn kết thúc vừa một màn — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho giao diện lúc-đang-chơi có chuyển động (hiện chỉ lúc đổi pha mới có), và cho màn kết thúc vừa đúng một màn 1920x1080 mà không phải cuộn.

**Architecture:** Chuyển động dồn vào chỗ dùng chung — token CSS trong `:root`, transition trong `@layer components`, keyframes trong `globals.css`, và một module thuần `lib/motion.ts` cho phần tính nhịp stagger. Không component nào bị chuyển sang `m.` chỉ để có animation. Màn kết thúc đổi từ một cột dọc thành hero-ngang + lưới hai cột, thẻ chia sẻ chui vào nút bấm.

**Tech Stack:** Next.js 16, React 19, Tailwind, `motion/react` (đã có, qua `LazyMotion` strict), test web bằng `node:test` chạy qua `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-01-ui-motion-and-game-over-layout-design.md`

## Global Constraints

- **Chỉ màn kết thúc phải vừa một màn.** Lobby, các pha trong trận, trang chủ giữ nguyên hành vi cuộn.
- **Đích đo: 1920x1080.** Không tối ưu cho 768p.
- **Mọi thay đổi layout khoá sau breakpoint `lg`.** Dưới `lg` giao diện không đổi.
- **Mọi keyframe/transition mới PHẢI có mặt trong một khối `@media (prefers-reduced-motion: reduce)`.** `MotionConfig reducedMotion="user"` trong `MotionProvider` chỉ chi phối `motion/react`, KHÔNG chi phối CSS. `globals.css` đang guard thủ công ở 4 chỗ (dòng ~142, ~701, ~736) — theo đúng nếp đó.
- **Không thêm dependency.** Không đụng `cinematics.css`.
- **`.card` KHÔNG nhận hover.** Đã đếm: 35 chỗ dùng `.card`, **0 chỗ bấm được**. Cho chúng nhấc lên khi rê chuột là hứa một cú bấm không tồn tại. `.card-interactive` trong spec vì thế bị bỏ — đây là nhánh dự phòng mà chính spec đã ghi.
- **Biên độ ambient:** opacity dao động trong ±0.04, tâm sáng dịch <= 2% chiều rộng, chu kỳ ~14s.
- **`m.` chứ không `motion.`** — `LazyMotion` đặt `strict`, dùng `motion.div` sẽ ném lỗi lúc chạy.
- Lệnh kiểm: `npm run lint`, `npm run test`, `npm run build --workspace @masoi/web`.

---

### Task 1: Nhịp stagger — module thuần và test của nó

Phần DUY NHẤT của công việc animation có logic đáng test. 15 ghế nhân 60ms là 900ms — danh sách cuối cùng hiện ra sau khi người chơi đã nhìn xong. Hàm này chặn đúng chuyện đó.

**Files:**
- Create: `apps/web/src/lib/motion.ts`
- Test: `apps/web/src/lib/motion.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `STAGGER_TOTAL_MS = 260` — trần tổng thời gian một danh sách hiện xong.
  - `staggerDelay(index: number, count: number): number` — mili-giây trễ của phần tử thứ `index` trong danh sách `count` phần tử.
  - `listItemMotion(index: number, count: number)` — trả `{ initial, animate, transition }` cắm thẳng vào `<m.li>`.

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/web/src/lib/motion.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STAGGER_TOTAL_MS, staggerDelay } from "./motion";

describe("staggerDelay", () => {
  it("phần tử đầu không bao giờ phải chờ", () => {
    assert.equal(staggerDelay(0, 15), 0);
    assert.equal(staggerDelay(0, 1), 0);
  });

  it("danh sách dài không được vượt trần tổng thời gian", () => {
    // 15 ghế x 60ms = 900ms: ô cuối hiện ra sau khi người chơi đã nhìn xong
    // cả bàn. Trần này là lý do hàm tồn tại.
    assert.ok(staggerDelay(14, 15) <= STAGGER_TOTAL_MS);
    assert.ok(staggerDelay(199, 200) <= STAGGER_TOTAL_MS);
  });

  it("danh sách ngắn vẫn tách bạch được từng phần tử", () => {
    const gap = staggerDelay(1, 2) - staggerDelay(0, 2);
    assert.ok(gap > 0 && gap <= 70, `khoang cach ${gap}ms nam ngoai khoang de chiu`);
  });

  it("thứ tự luôn tăng dần", () => {
    for (const count of [2, 5, 15]) {
      for (let i = 1; i < count; i += 1) {
        assert.ok(staggerDelay(i, count) > staggerDelay(i - 1, count));
      }
    }
  });

  it("đầu vào vô lý không làm vỡ", () => {
    assert.equal(staggerDelay(0, 0), 0);
    assert.equal(staggerDelay(-3, 10), 0);
    assert.ok(staggerDelay(99, 10) <= STAGGER_TOTAL_MS);
  });
});
```

- [ ] **Step 2: Chạy để xác nhận nó ĐỎ**

```bash
npx tsx --test apps/web/src/lib/motion.test.ts
```

Kỳ vọng: FAIL — `Cannot find module './motion'`.

- [ ] **Step 3: Viết bản cài đặt tối thiểu**

Tạo `apps/web/src/lib/motion.ts`:

```ts
/**
 * Nhịp cho danh sách hiện ra theo thứ tự.
 *
 * Có trần chứ không phải trễ cố định nhân chỉ số: bàn 15 người với 60ms mỗi ô
 * là 900ms, tức ô cuối cùng hiện ra sau khi mắt đã quét xong cả bàn. Chuyển
 * động lúc đó không còn dẫn dắt nữa mà là bắt chờ.
 */
export const STAGGER_TOTAL_MS = 260;

/** Trễ tối đa giữa hai phần tử liền nhau, cho danh sách ngắn. */
const MAX_GAP_MS = 60;

export function staggerDelay(index: number, count: number): number {
  if (index <= 0 || count <= 1) return 0;
  const position = Math.min(index, count - 1);
  // Danh sách ngắn dùng khoảng cố định cho rõ nhịp; danh sách dài bị ép vào
  // trần nên càng đông càng khít, chứ không càng đông càng lâu.
  const gap = Math.min(MAX_GAP_MS, STAGGER_TOTAL_MS / (count - 1));
  return Math.round(position * gap);
}

/**
 * Props cắm thẳng vào `<m.li>`. Trả cả ba mảnh cùng nhau để mọi danh sách
 * trong app dùng chung một nhịp thay vì mỗi chỗ tự chọn số.
 */
export function listItemMotion(index: number, count: number) {
  return {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    transition: {
      duration: 0.24,
      ease: [0.22, 1, 0.36, 1] as const,
      delay: staggerDelay(index, count) / 1000,
    },
  };
}
```

- [ ] **Step 4: Chạy lại để xác nhận XANH**

```bash
npx tsx --test apps/web/src/lib/motion.test.ts
```

Kỳ vọng: PASS, 5 test.

- [ ] **Step 5: Chạy cả bộ test web và lint**

```bash
npm run test --workspace @masoi/web && npm run lint --workspace @masoi/web
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/motion.ts apps/web/src/lib/motion.test.ts
git commit -m "feat(web): add a capped stagger rhythm for list entrances"
```

---

### Task 2: Token nhịp + phản hồi khi bấm nút

**Files:**
- Modify: `apps/web/src/app/globals.css` (khối `:root` ~dòng 5, `@layer components` ~dòng 228)

**Interfaces:**
- Consumes: không có.
- Produces: biến CSS `--dur-quick`, `--dur-base`, `--dur-slow`, `--ease-out-soft` dùng được ở mọi file CSS sau này.

- [ ] **Step 1: Thêm token vào `:root`**

Thay khối:

```css
:root {
  color-scheme: dark;
}
```

thành:

```css
:root {
  color-scheme: dark;

  /*
   * Nhịp dùng chung.
   *
   * Trước đây mỗi chỗ tự chọn số, nên hai thao tác cạnh nhau trong cùng một
   * khung nhìn chạy hai tốc độ khác nhau mà không vì lý do gì. `--ease-out-soft`
   * chính là đường cong mà chuyển pha trong `room/[code]/page.tsx` đang dùng,
   * nâng lên thành token thay vì để nó bị chép lại lần thứ hai.
   */
  --dur-quick: 120ms;
  --dur-base: 200ms;
  --dur-slow: 320ms;
  --ease-out-soft: cubic-bezier(0.22, 1, 0.36, 1);
}
```

- [ ] **Step 2: Đổi `.btn` sang token và thêm phản hồi khi bấm**

Thay:

```css
  .btn {
    @apply inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold transition
      disabled:opacity-40 disabled:cursor-not-allowed;
  }
```

thành:

```css
  .btn {
    @apply inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-semibold
      disabled:opacity-40 disabled:cursor-not-allowed;
    transition:
      background-color var(--dur-base) var(--ease-out-soft),
      border-color var(--dur-base) var(--ease-out-soft),
      color var(--dur-base) var(--ease-out-soft),
      transform var(--dur-quick) var(--ease-out-soft);
  }

  /*
   * Lún xuống khi bấm.
   *
   * `transition` trần của Tailwind là 150ms tuyến tính cho MỌI thuộc tính -
   * đọc ra là "có làm gì đó" chứ không phải một nút được thiết kế. Tách riêng
   * `transform` ở nhịp nhanh hơn màu vì tay nhanh hơn mắt: cú lún phải kịp
   * ngón tay, còn màu đuổi theo sau cũng được.
   */
  .btn:active:not(:disabled) {
    transform: translateY(1px);
  }
```

- [ ] **Step 3: Guard reduced-motion**

Thêm sau khối `@layer components`:

```css
/* Phản hồi khi bấm là trang trí thuần: tắt hết vẫn bấm được đủ. */
@media (prefers-reduced-motion: reduce) {
  .btn {
    transition: none;
  }

  .btn:active:not(:disabled) {
    transform: none;
  }
}
```

- [ ] **Step 4: Xác nhận build không vỡ**

```bash
npm run build --workspace @masoi/web
```

Kỳ vọng: `Compiled successfully`. Tailwind báo lỗi ngay nếu `@apply` gặp class không tồn tại.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(web): give buttons a designed press response instead of a bare transition"
```

---

### Task 3: Nền thở (ambient)

`.backdrop-vignette` là một `radial-gradient` phủ cả màn, nằm dưới mọi nội dung. Cho tâm sáng của nó trôi rất chậm là cách rẻ nhất để phông nền hết đứng chết — không thêm phần tử DOM, không cần React đụng vào.

**Files:**
- Modify: `apps/web/src/app/globals.css` (`.backdrop-vignette` ~dòng 216)

**Interfaces:**
- Consumes: không (chu kỳ ambient nằm ngoài thang token của Task 2).
- Produces: không có gì cho task sau.

- [ ] **Step 1: Cho vignette thở**

Thay:

```css
.backdrop-vignette {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: radial-gradient(120% 78% at 50% 42%, transparent 42%, rgba(0, 0, 0, 0.62) 100%);
}
```

thành:

```css
/*
 * Nhịp thở của cả phông nền.
 *
 * Biên độ theo đúng chuẩn mà `avatar-breathe` phía trên đã đặt: nhỏ tới mức
 * không nhìn thẳng thì không thấy. Ở đây là 0.04 opacity và tâm sáng dịch 2%
 * chiều rộng, chu kỳ 14 giây.
 *
 * Chu kỳ dài và biên độ nhỏ không phải dè dặt mà là điều kiện để một chuyển
 * động chạy suốt hai mươi phút không trở thành thứ gây khó chịu. Ambient khác
 * mọi animation khác trong app ở chỗ nó KHÔNG BAO GIỜ kết thúc.
 */
.backdrop-vignette {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: radial-gradient(120% 78% at 50% 42%, transparent 42%, rgba(0, 0, 0, 0.62) 100%);
  animation: backdrop-breathe 14s ease-in-out infinite;
}

@keyframes backdrop-breathe {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.96;
    transform: scale(1.015);
  }
}
```

Dùng `transform: scale` chứ không animate vị trí tâm gradient: biến CSS tuỳ biến cần `@property` mới nội suy mượt, còn `transform` thì mọi trình duyệt đều chạy trên compositor và không gây repaint.

- [ ] **Step 2: Guard reduced-motion**

```css
@media (prefers-reduced-motion: reduce) {
  .backdrop-vignette {
    animation: none;
  }
}
```

- [ ] **Step 3: Kiểm bằng mắt**

Mở trang chủ, nhìn phông nền 30 giây. Kỳ vọng: nền có cảm giác "sống" nhưng KHÔNG chỉ ra được chính xác cái gì đang chuyển động. Nếu nhìn phát ra ngay thì biên độ quá to — hạ `opacity` lên `0.98` và `scale` xuống `1.008`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(web): let the backdrop breathe instead of standing still"
```

---

### Task 4: Nhấn mạnh khi số liệu đổi

Loại chuyển động DUY NHẤT ở đây mang thông tin: nó nói "con số vừa đổi", thứ mà một con số đứng im không nói được.

**Files:**
- Modify: `apps/web/src/components/PlayerSeat.tsx:69` (`key="votes"`)
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/Timer.tsx` (`danger` ở dòng 33; `<span>` hiển thị số quanh dòng 64)

**Interfaces:**
- Consumes: không có.
- Produces: class `.timer-danger-pulse`.

**Ghi chú lệch so với spec:** spec dự tính một hook `useValueFlash` và một class
`.value-flash` dùng chung. Khi đọc code thật thì cả hai đều thừa — máy móc đã có
sẵn, chỉ bị hỏng ở một ký tự (xem Step 1). Không dựng class dùng chung cho một
chỗ dùng duy nhất; nếu sau này có chỗ thứ hai cần thì thêm lúc đó.

- [ ] **Step 1: Sửa `key` của huy hiệu số phiếu**

Huy hiệu số phiếu trong `PlayerSeat.tsx` ĐÃ nằm trong `AnimatePresence` với một
`m.span` chạy spring (dòng 66-81). Nhưng `key` của nó là hằng số `"votes"`:

```tsx
          <m.span
            key="votes"
```

Nên React coi 1 phiếu và 5 phiếu là CÙNG một phần tử — animation chỉ chạy lúc
huy hiệu hiện ra (0 -> 1) và lúc biến mất, còn mọi lần đổi 1 -> 2 -> 3 thì con
số nhảy câm lặng. Đổi thành:

```tsx
          <m.span
            key={votes}
```

Đổi `key` là bảo React thay hẳn phần tử, nên `AnimatePresence` chạy lại đúng
spring vốn đã được chỉnh sẵn ở đó. Không thêm CSS, không thêm state, không phải
tự hẹn giờ gỡ class - và hai lần đổi liên tiếp không nuốt mất lần thứ hai.

- [ ] **Step 2: Thêm nhịp đập cho đồng hồ sắp hết giờ**

Trong `globals.css`:

```css
/* Đồng hồ dưới 10 giây: nhịp đập đi kèm màu đỏ vốn đã có. */
.timer-danger-pulse {
  animation: timer-danger-pulse 1s ease-in-out infinite;
}

@keyframes timer-danger-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .timer-danger-pulse {
    animation: none;
  }
}
```

- [ ] **Step 3: Gắn vào đồng hồ**

Trong `Timer.tsx`, phần `<span>` hiển thị số:

```tsx
<span
  className={`absolute inset-0 grid place-items-center font-mono text-[11px] font-bold tabular-nums ${
    endsAt === null ? "text-mist/60" : danger ? "text-blood-400 timer-danger-pulse" : "text-white"
  }`}
>
```

`danger` đã tồn tại (`msLeft <= 10_000`) — dùng lại đúng trạng thái đó, KHÔNG tạo ngưỡng mới.

- [ ] **Step 4: Kiểm lint và build**

```bash
npm run lint --workspace @masoi/web && npm run build --workspace @masoi/web
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/components/PlayerSeat.tsx apps/web/src/components/Timer.tsx
git commit -m "feat(web): make a changing vote count actually animate"
```

---

### Task 5: Danh sách hiện ra theo nhịp

**Files:**
- Modify: `apps/web/src/components/RosterPanel.tsx:77` (`<ul>` người chơi)
- Modify: `apps/web/src/components/CaseFileCard.tsx:43` (`<ol>` bước ngoặt)
- Modify: `apps/web/src/components/NightRecapTimeline.tsx:62` (`<ol>` các đêm)

**Interfaces:**
- Consumes: `listItemMotion(index, count)` từ Task 1.
- Produces: không có gì cho task sau.

KHÔNG áp cho `ChatBox`/`MobileChatDock`: stagger trên dòng chat mới làm tin nhắn tới trễ hơn chính nó.

- [ ] **Step 1: RosterPanel**

File này đã import `motion/react`. Thêm:

```tsx
import { listItemMotion } from "@/lib/motion";
```

Vòng lặp hiện tại (dòng 78) là `snapshot.players.map((player) => {` với thân
hàm dạng khối. Thêm tham số `index`:

```tsx
        {snapshot.players.map((player, index) => {
```

Rồi trong phần `return` của khối đó, đổi thẻ `<li>` ngoài cùng thành `<m.li>` và
trải props vào, GIỮ NGUYÊN `key` cùng mọi `className` đang có:

```tsx
            <m.li
              key={/* key hiện tại của li, không đổi */}
              {...listItemMotion(index, snapshot.players.length)}
              className={/* className hiện tại, không đổi */}
            >
```

`m` đã có trong import từ `"motion/react"` của file này. KHÔNG dùng `motion.li` —
`LazyMotion` đặt `strict`.

- [ ] **Step 2: CaseFileCard**

File này CHƯA import `motion/react`. Thêm cả hai:

```tsx
import { m } from "motion/react";
import { listItemMotion } from "@/lib/motion";
```

Đổi `<li>` trong `<ol className="space-y-2">` (dòng 43-47). Code hiện tại:

```tsx
            <li
              key={`${highlight.type}-${highlight.round}-${highlight.phase}-${index}`}
              className="rounded-lg border border-white/[0.05] bg-night-800/50 px-3 py-2.5"
            >
```

thành:

```tsx
            <m.li
              key={`${highlight.type}-${highlight.round}-${highlight.phase}-${index}`}
              {...listItemMotion(index, file.highlights.length)}
              className="rounded-lg border border-white/[0.05] bg-night-800/50 px-3 py-2.5"
            >
```

Nhớ đóng bằng `</m.li>`. Biến `index` đã có sẵn trong `.map((highlight, index) =>`.

CHỈ đổi `<ol>` ở dòng 43. `<ol>` thứ hai ở dòng 75 là dòng thời gian dày đặc — stagger ở đó biến một bảng tra cứu thành đoạn phim phải ngồi đợi.

- [ ] **Step 3: NightRecapTimeline**

Cùng cách, cho `<ol>` ở dòng 62 (`nights.map`). CHỈ vòng lặp ngoài cùng — không áp cho các `<ul>` lồng bên trong từ dòng 76 trở đi, vì stagger lồng nhau nhân thời gian với nhau.

- [ ] **Step 4: Kiểm lint và build**

```bash
npm run lint --workspace @masoi/web && npm run build --workspace @masoi/web
```

`strict` của `LazyMotion` ném lỗi lúc CHẠY chứ không phải lúc biên dịch, nên nhầm `motion.li` chỉ bị bắt ở bước kiểm bằng mắt trong Task 7.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/RosterPanel.tsx apps/web/src/components/CaseFileCard.tsx apps/web/src/components/NightRecapTimeline.tsx
git commit -m "feat(web): bring lists in on a rhythm instead of all at once"
```

---

### Task 6: Màn kết thúc vừa một màn

**Files:**
- Modify: `apps/web/src/components/GameOverView.tsx` — state ~dòng 49, lưới hai phe dòng 112, `CaseFileCard` dòng 129, `CaseShareCard` dòng 148, `TeamPanel` ~dòng 209

**Interfaces:**
- Consumes: không có.
- Produces: không có gì cho task sau.

- [ ] **Step 1: Đưa hồ sơ vụ án lên cạnh đội hình**

Thay khối từ dòng 112 (`<div className="grid items-start gap-3 lg:grid-cols-2">`) tới hết dòng 129 (`{caseFile && <CaseFileCard file={caseFile} />}`) bằng:

```tsx
      {/*
        * Từ `lg` là hai cột ngang hàng: đội hình bên trái, hồ sơ vụ án bên phải.
        *
        * Bản cũ xếp dọc, nên ở 1080p màn kết thúc luôn tràn quá một màn - trong
        * khi chính file này đã ghi ý định "phải đọc được trong một màn hình".
        * Dưới `lg` vẫn đúng một cột như cũ.
        */}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <TeamPanel
            title="Phe Ma Sói"
            players={wolves}
            avatars={avatars}
            won={wolvesWin}
            accent="wolves"
          />
          <TeamPanel
            title="Phe Dân Làng"
            players={village}
            avatars={avatars}
            won={!wolvesWin}
            accent="village"
          />
        </div>
        {caseFile && <CaseFileCard file={caseFile} />}
      </div>
```

- [ ] **Step 2: Cho thẻ chia sẻ chui vào nút bấm**

Thêm state cạnh `showFullTimeline` (dòng 49):

```tsx
  // Thẻ chia sẻ là HÀNH ĐỘNG, không phải thứ để nhìn: một khung 9:16 cao hơn
  // cả phần còn lại cộng lại, và người ta mở nó đúng một lần lúc muốn khoe.
  const [showShare, setShowShare] = useState(false);
```

Thay dòng 148 bằng:

```tsx
      {caseFile && (
        <>
          <button
            className="btn-secondary min-h-11 w-full"
            onClick={() => setShowShare((open) => !open)}
            aria-expanded={showShare}
            aria-controls="share-card"
          >
            {showShare ? "Ẩn thẻ chia sẻ" : "Tạo thẻ chia sẻ"}
          </button>
          {showShare && (
            <div id="share-card">
              <CaseShareCard file={caseFile} shareOrigin={shareOrigin} />
            </div>
          )}
        </>
      )}
```

- [ ] **Step 3: Lưới an toàn cho bàn đông**

Trong `TeamPanel` (~dòng 209), đổi `<ul className="space-y-1.5">` thành:

```tsx
      {/*
        * Cuộn TRONG thẻ từ `lg`, theo đúng khuôn mà `RosterPanel` đang dùng
        * (`lg:max-h-[calc(100dvh-16rem)]`). Chỉ khoá riêng danh sách đội hình
        * chứ không khoá cả màn: đây là khối duy nhất co giãn theo số người.
        */}
      <ul className="space-y-1.5 lg:max-h-[38vh] lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
```

- [ ] **Step 4: Kiểm lint và build**

```bash
npm run lint --workspace @masoi/web && npm run build --workspace @masoi/web
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/GameOverView.tsx
git commit -m "feat(web): fit the game-over screen into one viewport"
```

---

### Task 7: Đo thật, và xác nhận tắt được

KHÔNG được bỏ qua. Spec ghi rõ: phần layout không được tuyên bố xong bằng suy luận.

**Files:** không sửa file nào, trừ khi phép đo bắt phải sửa.

**Interfaces:**
- Consumes: mọi thứ từ Task 1-6.
- Produces: kết luận đạt / không đạt.

- [ ] **Step 1: Dựng app chạy được**

Cần postgres + redis + server + web:

```bash
docker start masoi-postgres masoi-redis && npm run build:deps
```

Rồi chạy server và web. Tạo phòng, thêm bot cho đủ **12 người**, chơi tới hết ván.

- [ ] **Step 2: Đặt khung nhìn đúng 1920x1080 và đo**

Ở màn kết thúc, bàn 12 người, hồ sơ vụ án đầy đủ:

```js
({
  scrollHeight: document.body.scrollHeight,
  innerHeight: window.innerHeight,
  vuot: document.body.scrollHeight - window.innerHeight,
})
```

Kỳ vọng: `vuot <= 0`. Nếu dương, siết theo thứ tự này và DỪNG ngay khi đạt:
1. Hero (`py-8`, ~dòng 78) xuống `lg:py-5`.
2. `space-y-3` của thẻ bọc ngoài (dòng 56) xuống `lg:space-y-2`.
3. `lg:max-h-[38vh]` của đội hình xuống `lg:max-h-[32vh]`.

- [ ] **Step 3: Xác nhận mọi chuyển động mới tắt được**

Bật `prefers-reduced-motion: reduce` (DevTools > Rendering > Emulate CSS prefers-reduced-motion), tải lại, xác nhận:
- Phông nền đứng yên hoàn toàn.
- Bấm nút không lún.
- Số phiếu đổi không chớp; đồng hồ dưới 10 giây không đập.
- Danh sách vẫn hiện ĐỦ nội dung (`motion/react` tự bỏ animation nhờ `MotionConfig`, nhưng phải mắt thấy là nội dung còn nguyên chứ không biến mất).

Còn mục nào chuyển động là thiếu một khối `@media (prefers-reduced-motion: reduce)` — quay lại đúng task đó.

- [ ] **Step 4: Cổng cuối**

```bash
npm run lint && npm run test && npm run build --workspace @masoi/web
```

Kỳ vọng: lint sạch cả 4 package; toàn bộ test xanh, số test web tăng đúng 5 so với trước Task 1; build thành công.

- [ ] **Step 5: Cập nhật số test trong README**

`README.md` có badge `tests-NNNN%20passing`, một bảng đếm theo package, và một dòng tổng. CẢ BA phải khớp con số thật ở Step 4.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: refresh the test count after the motion work"
```
