# Chân dung nhân vật — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay ảnh đại diện bóng đen đơn sắc bằng chân dung có mặt, mắt nháy và miệng mấp máy theo đúng người đang nói — với toàn bộ code lên được `main` trước khi có bất kỳ tấm ảnh nào.

**Architecture:** Một sprite sheet 4 frame cho mỗi nhân vật. Hai hàm thuần trong `lib/character-portrait.ts` quyết định *hiện chế độ nào* và *lấy hình từ đâu*; CSS lo frame nào trong chế độ nào; `CharacterPortrait.tsx` chỉ đọc kết quả rồi gắn class. Chưa có sheet thì rơi về `<Avatar>` SVG hiện tại, nên giao diện ngày đầu giống hệt hôm nay.

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind · `node:test` qua `tsx` · `@happy-dom/global-registrator` cho component test.

**Spec:** `docs/superpowers/specs/2026-09-04-character-portraits-design.md`

## Global Constraints

- Nhánh: `feat/character-portraits`. KHÔNG commit thẳng lên `main` — `main` là cò súng deploy.
- Ngôn ngữ: docstring và tên test viết **tiếng Việt**, theo đúng mọi file đang có trong `apps/web/src/lib/`.
- **Không sửa** `Avatar.tsx`, `avatar.ts`, `avatar-art.ts`, `seat-voice.ts`. Chúng là tầng fallback, phải còn nguyên.
- `lib/character-portrait.ts` KHÔNG được import React, không chạm DOM, không gọi `Date.now()` bên trong — thời gian tiêm từ ngoài.
- Frame order cố định: `["idle", "blink", "talk", "dead"]`, tương ứng offset `0%`, `-25%`, `-50%`, `-75%`.
- Ưu tiên chế độ cứng: `dead` > `talking` > `alive`.
- `prefers-reduced-motion` xử lý **hoàn toàn bằng CSS**, không đọc `matchMedia` trong JS.
- Lệnh test một file: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/lib/<file>.test.ts`
- Lệnh test cả web: `npm test --workspace @masoi/web`
- Lệnh typecheck: `npm run lint --workspace @masoi/web` (chạy `tsc --noEmit`)

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `apps/web/src/lib/character-portrait.ts` | Hai hàm thuần: chế độ hiển thị, và nguồn hình. Không biết React |
| `apps/web/src/lib/character-portrait.test.ts` | Test hai hàm trên |
| `apps/web/src/lib/character-art.ts` | Manifest: danh sách frame, bảng sheet, tra cứu sheet theo `AvatarId` |
| `apps/web/src/lib/character-art.test.ts` | Test manifest + ngân sách dung lượng + ranh giới kiến trúc |
| `apps/web/src/app/characters.css` | Keyframe nháy mắt, mấp máy, ghim frame chết, khối reduced-motion |
| `apps/web/src/components/CharacterPortrait.tsx` | Renderer mỏng: đọc hai hàm, gắn class, rơi về `<Avatar>` khi lỗi |
| `apps/web/src/components/CharacterPortrait.test.tsx` | Mount thật: fallback khi ảnh lỗi, class theo chế độ |
| `apps/web/public/characters/SOURCES.md` | Hợp đồng phong cách — prompt, khung hình, dải màu, ghi công |

---

### Task 1: Model thuần — chế độ và nguồn hình

**Files:**
- Create: `apps/web/src/lib/character-portrait.ts`
- Test: `apps/web/src/lib/character-portrait.test.ts`

**Interfaces:**
- Consumes: không gì (task đầu tiên)
- Produces:
  - `type PortraitMode = "dead" | "talking" | "alive"`
  - `type PortraitSource = "upload" | "sheet" | "svg"`
  - `const BOT_TALK_MS: number` (giá trị `1500`)
  - `portraitMode(input: PortraitModeInput): PortraitMode`
  - `portraitSource(input: PortraitSourceInput): PortraitSource`
  - `interface PortraitModeInput { alive: boolean; speaking: boolean; talkingUntilMs: number | null; nowMs: number }`
  - `interface PortraitSourceInput { isCustom: boolean; hasSheet: boolean; saveData: boolean }`

- [ ] **Step 1: Viết test cho `portraitMode`**

Tạo `apps/web/src/lib/character-portrait.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { portraitMode, portraitSource, BOT_TALK_MS } from "./character-portrait";

const ALIVE = { alive: true, speaking: false, talkingUntilMs: null, nowMs: 1_000 };

describe("portraitMode", () => {
  it("người sống, im lặng thì là mặt bình thường", () => {
    assert.equal(portraitMode(ALIVE), "alive");
  });

  it("đang phát tiếng thì mở miệng", () => {
    assert.equal(portraitMode({ ...ALIVE, speaking: true }), "talking");
  });

  it("người chết thì luôn là mặt chết, kể cả khi caller nói họ đang nói", () => {
    // seatShowsSpeaking đã lọc rồi, nhưng TrialStage gọi useSpeakers() thẳng
    // nên hàng rào thứ hai này là thật chứ không phải phòng thủ thừa.
    assert.equal(portraitMode({ ...ALIVE, alive: false, speaking: true }), "dead");
  });

  it("bot mấp máy khi còn trong cửa sổ sau tin nhắn", () => {
    assert.equal(
      portraitMode({ ...ALIVE, nowMs: 1_000, talkingUntilMs: 1_500 }),
      "talking",
    );
  });

  it("đúng mốc hết cửa sổ là thôi mấp máy", () => {
    // Biên đóng: nowMs === talkingUntilMs nghĩa là cửa sổ đã hết.
    assert.equal(
      portraitMode({ ...ALIVE, nowMs: 1_500, talkingUntilMs: 1_500 }),
      "alive",
    );
  });

  it("quá mốc thì về mặt bình thường", () => {
    assert.equal(
      portraitMode({ ...ALIVE, nowMs: 1_501, talkingUntilMs: 1_500 }),
      "alive",
    );
  });

  it("bot đã chết thì cửa sổ mấp máy cũng không cứu được", () => {
    assert.equal(
      portraitMode({ ...ALIVE, alive: false, nowMs: 1_000, talkingUntilMs: 1_500 }),
      "dead",
    );
  });

  it("cùng nowMs thì luôn ra cùng kết quả", () => {
    const input = { ...ALIVE, talkingUntilMs: 1_200 };
    assert.equal(portraitMode(input), portraitMode(input));
  });

  it("BOT_TALK_MS đủ dài để đọc hết một câu ngắn", () => {
    assert.equal(BOT_TALK_MS, 1_500);
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó HỎNG**

Run: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/lib/character-portrait.test.ts`
Expected: FAIL — `Cannot find module './character-portrait'`

- [ ] **Step 3: Viết `portraitMode` vừa đủ để test xanh**

Tạo `apps/web/src/lib/character-portrait.ts`:

```ts
/**
 * Hai quyết định thuần của một khuôn mặt: hiện chế độ nào, và lấy hình từ đâu.
 *
 * Tách khỏi component vì cùng lý do `seat-voice.ts` đã tách: một bảng ưu tiên
 * nằm trong JSX thì không ai kiểm chứng được nó có bị một trạng thái mới chen
 * ngang hay không. File này KHÔNG import React và KHÔNG đọc Date.now.
 */

/**
 * Ba chế độ, ưu tiên cứng: `dead` > `talking` > `alive`.
 *
 * Cố ý KHÔNG có chế độ thứ tư cho `prefers-reduced-motion`. `globals.css` đã
 * chốt luật đó từ trước: cái không mang tin thì tắt (nhịp thở), cái mang tin
 * thì ở lại và đứng yên (quầng "đang nói"). Miệng đang nói là thông tin thật,
 * nên reduced-motion vẫn ở chế độ `talking`, chỉ ghim frame lại - và việc ghim
 * là của CSS, không phải của hàm này.
 */
export type PortraitMode = "dead" | "talking" | "alive";

export interface PortraitModeInput {
  alive: boolean;
  /** Đang phát tiếng qua LiveKit. Người thật mới có; bot không bao giờ. */
  speaking: boolean;
  /**
   * Mốc hết mấp máy của BOT, tính bằng ms cùng trục với `nowMs`.
   *
   * Bot không có giọng nên `useSpeakers()` không bao giờ nhắc tới chúng. Thiếu
   * đường này thì phòng nhiều bot không có cái miệng nào động đậy.
   */
  talkingUntilMs: number | null;
  /** Tiêm từ ngoài để cùng đầu vào luôn ra cùng kết quả. */
  nowMs: number;
}

/** Cửa sổ mấp máy của bot sau khi dòng chat của nó vừa hiện. */
export const BOT_TALK_MS = 1_500;

export function portraitMode({
  alive,
  speaking,
  talkingUntilMs,
  nowMs,
}: PortraitModeInput): PortraitMode {
  // Không tin caller: `seatShowsSpeaking` đã lọc người chết, nhưng `TrialStage`
  // gọi `useSpeakers()` thẳng chứ không qua bộ lọc đó.
  if (!alive) return "dead";
  if (speaking) return "talking";
  // Biên ĐÓNG ở mốc: đúng `talkingUntilMs` là đã hết, không phải còn.
  if (talkingUntilMs !== null && nowMs < talkingUntilMs) return "talking";
  return "alive";
}
```

- [ ] **Step 4: Chạy test — phần `portraitMode` xanh, `portraitSource` còn hỏng**

Run: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/lib/character-portrait.test.ts`
Expected: các test `portraitMode` PASS; import `portraitSource` báo undefined khi tới Step 5. Nếu chưa có test nào cho `portraitSource` thì toàn bộ PASS.

- [ ] **Step 5: Viết test cho `portraitSource`**

Thêm vào cuối `apps/web/src/lib/character-portrait.test.ts`:

```ts
const SOURCE = { isCustom: false, hasSheet: true, saveData: false };

describe("portraitSource", () => {
  it("có sheet và mạng bình thường thì dùng sheet", () => {
    assert.equal(portraitSource(SOURCE), "sheet");
  });

  it("chưa vẽ sheet thì rơi về SVG - đây là trạng thái ngày đầu", () => {
    assert.equal(portraitSource({ ...SOURCE, hasSheet: false }), "svg");
  });

  it("Save-Data thì không tải sheet, dù đã có", () => {
    // Lý do là BĂNG THÔNG. Khác hẳn prefers-reduced-motion, vốn vẫn tải sheet
    // và chỉ ghim frame - xem playbackMode trong cinematic-settings.ts.
    assert.equal(portraitSource({ ...SOURCE, saveData: true }), "svg");
  });

  it("ảnh người chơi tự tải lên thắng mọi thứ khác", () => {
    assert.equal(portraitSource({ ...SOURCE, isCustom: true }), "upload");
  });

  it("ảnh tự tải lên vẫn thắng cả khi bật Save-Data", () => {
    // Ảnh đó đã ở object storage và là danh tính người chơi tự chọn; đổi nó
    // thành một cái bóng vì tiết kiệm dữ liệu là lấy mất thứ họ vừa đặt vào.
    assert.equal(
      portraitSource({ isCustom: true, hasSheet: false, saveData: true }),
      "upload",
    );
  });
});
```

- [ ] **Step 6: Chạy test để chắc chắn nó HỎNG**

Run: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/lib/character-portrait.test.ts`
Expected: FAIL — `portraitSource is not a function`

- [ ] **Step 7: Viết `portraitSource`**

Thêm vào cuối `apps/web/src/lib/character-portrait.ts`:

```ts
/**
 * Lấy hình ở đâu. Thang rơi nằm ở đây chứ không nằm trong nhánh `if` của
 * component, vì một nhánh `if` trong JSX là một nhánh không ai kiểm được.
 */
export type PortraitSource = "upload" | "sheet" | "svg";

export interface PortraitSourceInput {
  /** Người chơi đã tự tải ảnh lên object storage. */
  isCustom: boolean;
  /** Nhân vật này đã có sprite sheet trong `character-art.ts` chưa. */
  hasSheet: boolean;
  /** `navigator.connection.saveData`. */
  saveData: boolean;
}

export function portraitSource({
  isCustom,
  hasSheet,
  saveData,
}: PortraitSourceInput): PortraitSource {
  // Ảnh tự tải lên là danh tính người chơi tự đặt, không đánh đổi vì bất cứ gì.
  if (isCustom) return "upload";
  // Save-Data là lý do BĂNG THÔNG nên cấm tải file. Đối lập với
  // prefers-reduced-motion, vốn vẫn tải sheet và chỉ ghim frame lại.
  if (saveData) return "svg";
  return hasSheet ? "sheet" : "svg";
}
```

- [ ] **Step 8: Chạy test và typecheck**

Run: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/lib/character-portrait.test.ts`
Expected: PASS, toàn bộ 14 test

Run: `npm run lint --workspace @masoi/web`
Expected: không lỗi

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/character-portrait.ts apps/web/src/lib/character-portrait.test.ts
git commit -m "feat(portrait): model thuần cho chế độ hiển thị và nguồn hình"
```

---

### Task 2: Manifest sheet và các hàng rào

**Files:**
- Create: `apps/web/src/lib/character-art.ts`
- Test: `apps/web/src/lib/character-art.test.ts`

**Interfaces:**
- Consumes: `AVATAR_IDS`, `AvatarId` từ `./avatar-art` (đã có, không sửa)
- Produces:
  - `const PORTRAIT_FRAMES: readonly ["idle", "blink", "talk", "dead"]`
  - `const PORTRAIT_FRAME_COUNT: number` (bằng `4`)
  - `const CHARACTER_SHEETS: Partial<Record<AvatarId, string>>`
  - `sheetFor(avatar: string): string | null`
  - `hasSheet(avatar: string): boolean`

- [ ] **Step 1: Viết test manifest**

Tạo `apps/web/src/lib/character-art.test.ts`:

```ts
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { AVATAR_IDS } from "./avatar-art";
import {
  CHARACTER_SHEETS,
  PORTRAIT_FRAMES,
  PORTRAIT_FRAME_COUNT,
  hasSheet,
  sheetFor,
} from "./character-art";

const PUBLIC_DIR = join(process.cwd(), "public", "characters");
/** Trần mỗi sheet. Vượt là ảnh chưa nén đúng, không phải ảnh đẹp hơn. */
const MAX_SHEET_BYTES = 120 * 1024;
/** Trần tổng cho cả 16 nhân vật. */
const MAX_TOTAL_BYTES = 1_400 * 1024;

describe("manifest chân dung", () => {
  it("bốn frame, đúng thứ tự đã chốt trong spec", () => {
    assert.deepEqual([...PORTRAIT_FRAMES], ["idle", "blink", "talk", "dead"]);
    assert.equal(PORTRAIT_FRAME_COUNT, 4);
  });

  it("mọi khoá trong bảng sheet phải là một AvatarId có thật", () => {
    // Bắt lỗi gõ nhầm tên nhân vật: một khoá lạc sẽ im lặng không bao giờ khớp.
    for (const key of Object.keys(CHARACTER_SHEETS)) {
      assert.ok(
        (AVATAR_IDS as readonly string[]).includes(key),
        `${key} không có trong AVATAR_IDS`,
      );
    }
  });

  it("mọi sheet đã khai báo phải tồn tại thật trong public/", () => {
    for (const [id, path] of Object.entries(CHARACTER_SHEETS)) {
      assert.ok(path, `${id} khai báo sheet rỗng`);
      const file = join(process.cwd(), "public", path.replace(/^\//, ""));
      assert.doesNotThrow(() => statSync(file), `thiếu file cho ${id}: ${path}`);
    }
  });

  it("không có file sheet mồ côi trong public/characters", () => {
    // Chiều ngược lại: file nằm đó mà không ai khai báo thì nó đang chiếm chỗ
    // trong repo mà không bao giờ được tải.
    let files: string[];
    try {
      files = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith(".webp"));
    } catch {
      return; // chưa có thư mục thì chưa có gì mồ côi
    }
    const declared = new Set(
      Object.values(CHARACTER_SHEETS).map((p) => p!.split("/").pop()),
    );
    for (const file of files) {
      assert.ok(declared.has(file), `${file} không được khai báo trong CHARACTER_SHEETS`);
    }
  });

  it("sheetFor trả null cho nhân vật chưa vẽ", () => {
    const undrawn = AVATAR_IDS.find((id) => !(id in CHARACTER_SHEETS));
    if (!undrawn) return; // đã vẽ hết thì bỏ qua
    assert.equal(sheetFor(undrawn), null);
    assert.equal(hasSheet(undrawn), false);
  });

  it("hasSheet trả false cho chuỗi không phải AvatarId", () => {
    // Avatar tự tải lên đi vào đây dưới dạng một URL http.
    assert.equal(hasSheet("https://example.com/a.png"), false);
  });
});

describe("ngân sách dung lượng", () => {
  it("mỗi sheet dưới trần, và tổng dưới trần", () => {
    // Không có test này thì một hôm nào đó một tấm PNG 4MB lọt vào và không ai
    // biết cho tới lúc người chơi 4G kêu.
    let total = 0;
    for (const [id, path] of Object.entries(CHARACTER_SHEETS)) {
      const file = join(process.cwd(), "public", path!.replace(/^\//, ""));
      const size = statSync(file).size;
      assert.ok(size <= MAX_SHEET_BYTES, `${id} nặng ${size}B, trần ${MAX_SHEET_BYTES}B`);
      total += size;
    }
    assert.ok(total <= MAX_TOTAL_BYTES, `tổng ${total}B vượt trần ${MAX_TOTAL_BYTES}B`);
  });
});

describe("ranh giới kiến trúc", () => {
  it("character-portrait.ts không được biết React hay DOM", () => {
    // Cùng mẹo mà live-trial-scene.test.ts dùng để chặn `three` lọt vào file sai.
    const source = readFileSync(join(process.cwd(), "src/lib/character-portrait.ts"), "utf8");
    assert.ok(!/from "react"/.test(source), "model thuần đang import react");
    assert.ok(!/\bdocument\.|\bwindow\./.test(source), "model thuần đang chạm DOM");
    assert.ok(!/Date\.now\(\)/.test(source), "model thuần đang tự đọc đồng hồ");
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó HỎNG**

Run: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/lib/character-art.test.ts`
Expected: FAIL — `Cannot find module './character-art'`

- [ ] **Step 3: Viết manifest**

Tạo `apps/web/src/lib/character-art.ts`:

```ts
import { AVATAR_IDS, type AvatarId } from "./avatar-art";

/**
 * Bảng tra sprite sheet chân dung.
 *
 * Mỗi nhân vật là MỘT file bốn frame nằm ngang, không phải bốn file. Đây đúng
 * là lập luận đã viết trong `avatar-art.ts`: một phòng hiển thị tới 15 ô, tách
 * file là 15 lượt round-trip trên 4G. Phòng đầy = 15 request thay vì 60.
 *
 * Bảng này CỐ Ý bắt đầu rỗng. Toàn bộ lớp chân dung chạy đúng khi chưa có tấm
 * ảnh nào - mọi nhân vật chưa khai báo sẽ rơi về `<Avatar>` SVG. Thêm dần từng
 * dòng khi sheet được vẽ xong, không cần đổi một dòng code nào khác.
 *
 * Hợp đồng phong cách để sinh sheet nằm ở `public/characters/SOURCES.md`.
 */

/** Thứ tự frame trong sheet, trái sang phải. Đổi thứ tự là đổi luôn CSS. */
export const PORTRAIT_FRAMES = ["idle", "blink", "talk", "dead"] as const;

export type PortraitFrame = (typeof PORTRAIT_FRAMES)[number];

export const PORTRAIT_FRAME_COUNT = PORTRAIT_FRAMES.length;

/**
 * Nhân vật đã có sheet. Đường dẫn tính từ gốc `public/`.
 *
 * Ví dụ khi đã vẽ xong: `farmer: "/characters/farmer.webp"`.
 */
export const CHARACTER_SHEETS: Partial<Record<AvatarId, string>> = {};

const IDS: ReadonlySet<string> = new Set(AVATAR_IDS);

/**
 * Đường dẫn sheet của một nhân vật, hoặc null nếu chưa vẽ.
 *
 * Nhận `string` chứ không nhận `AvatarId` vì nơi gọi có thể đang cầm một URL
 * ảnh người chơi tự tải lên - xem `Avatar.tsx`, cùng một trường mang hai loại
 * giá trị. Chuỗi không phải AvatarId thì trả null, không ném.
 */
export function sheetFor(avatar: string): string | null {
  if (!IDS.has(avatar)) return null;
  return CHARACTER_SHEETS[avatar as AvatarId] ?? null;
}

export function hasSheet(avatar: string): boolean {
  return sheetFor(avatar) !== null;
}
```

- [ ] **Step 4: Chạy test và typecheck**

Run: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/lib/character-art.test.ts`
Expected: PASS (các test duyệt file sẽ bỏ qua vì bảng còn rỗng — đúng ý đồ)

Run: `npm run lint --workspace @masoi/web`
Expected: không lỗi

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/character-art.ts apps/web/src/lib/character-art.test.ts
git commit -m "feat(portrait): manifest sheet, ngân sách dung lượng và hàng rào kiến trúc"
```

---

### Task 3: CSS — nháy mắt, mấp máy, và khối reduced-motion

**Files:**
- Create: `apps/web/src/app/characters.css`
- Modify: `apps/web/src/app/layout.tsx:6` (thêm một dòng import ngay sau `import "./cinematics.css";`)

**Interfaces:**
- Consumes: biến CSS `--breath-offset` (đã có, đặt bởi `PlayerSeat.tsx:112`; Task 4 sẽ đặt nó trên chính phần tử chân dung)
- Produces: các class `.character-portrait`, `.character-portrait__sheet`, `.is-alive`, `.is-talking`, `.is-dead`

- [ ] **Step 1: Viết CSS**

Tạo `apps/web/src/app/characters.css`:

```css
/*
 * Chân dung nhân vật: một sprite sheet bốn frame nằm ngang, hoán frame bằng
 * cách trượt ảnh trong một khung tràn-ẩn.
 *
 * Vì sao trượt ảnh chứ không đổi `background-position`: cần `onError` của thẻ
 * <img> để rơi về SVG khi file hỏng, mà `background-image` không báo lỗi gì cả.
 *
 * Không có vòng requestAnimationFrame nào ở đây. Mười lăm ô cùng nháy mắt bằng
 * JS là mười lăm lần setState mỗi vài trăm ms; bằng CSS thì trình duyệt lo.
 */

.character-portrait {
  position: relative;
  overflow: hidden;
}

.character-portrait__sheet {
  /* Bốn frame nằm ngang nên ảnh rộng gấp bốn khung. */
  width: 400%;
  height: 100%;
  max-width: none;
  object-fit: cover;
  will-change: transform;
}

/* Mặt bình thường: frame 0, thỉnh thoảng chớp sang frame 1. */
.character-portrait.is-alive .character-portrait__sheet {
  animation: character-blink 5.4s steps(1, end) infinite;
  /*
   * Lệch pha riêng của từng người, dùng lại đúng con số đã tính cho nhịp thở.
   * Mười lăm khuôn mặt nháy mắt đồng pha đọc ra như cả lưới vừa giật một cái,
   * chứ không phải như mười lăm người đang ngồi.
   */
  animation-delay: calc(var(--breath-offset, 0) * -5.4s);
}

/* Đang nói: đảo qua lại frame 0 và frame 2. */
.character-portrait.is-talking .character-portrait__sheet {
  animation: character-talk 0.28s steps(1, end) infinite;
}

/* Đã chết: frame 3, đứng yên. */
.character-portrait.is-dead .character-portrait__sheet {
  animation: none;
  transform: translateX(-75%);
}

@keyframes character-blink {
  /* Mắt mở gần trọn chu kỳ; cái chớp chỉ chiếm ~4%, tức khoảng 216ms. */
  0%,
  92% {
    transform: translateX(0);
  }
  96% {
    transform: translateX(-25%);
  }
  100% {
    transform: translateX(0);
  }
}

@keyframes character-talk {
  0% {
    transform: translateX(0);
  }
  50% {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  /*
   * Cùng luật đã chốt ở globals.css: cái không mang tin thì tắt, cái MANG TIN
   * thì ở lại và chốt đứng yên.
   *
   * Nháy mắt không mang tin gì - tắt hẳn, về frame 0.
   * "Đang nói" là thông tin thật - ai đang lên tiếng - nên giữ nguyên, chốt ở
   * frame miệng MỞ. Người bật thiết lập này vẫn nhìn lưới là biết ai đang nói.
   */
  .character-portrait.is-alive .character-portrait__sheet {
    animation: none;
    transform: translateX(0);
  }

  .character-portrait.is-talking .character-portrait__sheet {
    animation: none;
    transform: translateX(-50%);
  }
}
```

- [ ] **Step 2: Nối vào layout**

Trong `apps/web/src/app/layout.tsx`, ngay sau dòng `import "./cinematics.css";`, thêm:

```ts
import "./characters.css";
```

- [ ] **Step 3: Kiểm tra build không gãy**

Run: `npm run lint --workspace @masoi/web`
Expected: không lỗi

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/characters.css apps/web/src/app/layout.tsx
git commit -m "feat(portrait): keyframe nháy mắt, mấp máy và khối reduced-motion"
```

---

### Task 4: Component `CharacterPortrait`

**Files:**
- Create: `apps/web/src/components/CharacterPortrait.tsx`
- Test: `apps/web/src/components/CharacterPortrait.test.tsx`

**Interfaces:**
- Consumes: `portraitMode`, `portraitSource`, `PortraitMode` (Task 1); `sheetFor`, `hasSheet` (Task 2); các class CSS (Task 3); `Avatar` từ `./Avatar` (đã có, không sửa)
- Produces: `CharacterPortrait(props: CharacterPortraitProps)` với
  `interface Props { avatar: AvatarId | string; tint: string; alive: boolean; speaking?: boolean; talkingUntilMs?: number | null; breathOffset?: number; className?: string; isCustom?: boolean }`

- [ ] **Step 1: Viết component test**

Tạo `apps/web/src/components/CharacterPortrait.test.tsx`:

```tsx
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

/**
 * Chân dung nhân vật, MOUNT COMPONENT THẬT.
 *
 * Phần luật thuần đã nằm ở `lib/character-portrait.test.ts`. Ở đây chỉ giữ ba
 * thứ chỉ nhìn thấy được trong DOM:
 *
 *   - chưa có sheet thì phải ra đúng cái <svg> cũ, không phải một ô trống;
 *   - ảnh hỏng giữa chừng thì phải rơi về <svg>, không để lại khung rỗng;
 *   - lệch pha nháy mắt phải nằm trên chính phần tử chân dung, vì nhiều nơi gọi
 *     không đặt --breath-offset ở cha.
 */

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface MountOptions {
  avatar?: string;
  alive?: boolean;
  speaking?: boolean;
  isCustom?: boolean;
  breathOffset?: number;
}

async function mountPortrait({
  avatar = "hood",
  alive = true,
  speaking = false,
  isCustom = false,
  breathOffset = 0.5,
}: MountOptions = {}) {
  const React = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { CharacterPortrait } = await import("./CharacterPortrait");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      React.createElement(CharacterPortrait, {
        avatar,
        tint: "rgba(126, 168, 226, 0.16)",
        alive,
        speaking,
        isCustom,
        breathOffset,
      }),
    );
  });

  return {
    host,
    svg: host.querySelector("svg"),
    sheet: host.querySelector(".character-portrait__sheet"),
    shell: host.querySelector(".character-portrait"),
    cleanup: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe("CharacterPortrait", () => {
  it("chưa có sheet thì hiện đúng bóng SVG cũ", async () => {
    // Đây là trạng thái NGÀY ĐẦU: code lên main trước khi có tấm ảnh nào.
    const view = await mountPortrait();
    assert.ok(view.svg, "phải rơi về <svg> khi chưa có sheet");
    assert.equal(view.sheet, null, "không được dựng khung sheet khi chưa có sheet");
    await view.cleanup();
  });

  it("ảnh người chơi tự tải lên vẫn đi đường <img> cũ", async () => {
    const view = await mountPortrait({
      avatar: "https://example.com/me.png",
      isCustom: true,
    });
    const img = view.host.querySelector("img");
    assert.ok(img, "ảnh tự tải lên phải là một <img>");
    assert.equal(view.sheet, null, "ảnh tự tải lên không có sheet để hoán frame");
    await view.cleanup();
  });

});

/**
 * Nhánh CÓ sheet.
 *
 * `CHARACTER_SHEETS` rỗng ở đợt này nên không mount nào chạm tới nhánh sheet -
 * tức là nửa quan trọng hơn của component sẽ không có test nào cho tới khi tấm
 * ảnh đầu tiên xuất hiện. Không chấp nhận được: lúc đó lỗi sẽ lộ ra trên máy
 * người chơi chứ không phải ở đây.
 *
 * Bảng sheet là một object thường và `sheetFor` đọc nó tại thời điểm gọi, nên
 * chèn một dòng rồi xoá đi là đủ - không cần bộ máy mock module, không phải lo
 * alias `@/` phân giải ra đường dẫn nào. `node:test` chạy mỗi file test trong
 * một tiến trình riêng nên mutation này không rò sang `character-art.test.ts`,
 * nhưng vẫn dọn trong `finally` để hai test dưới đây độc lập với nhau.
 */
describe("CharacterPortrait khi đã có sheet", () => {
  const SHEET = "/characters/hood.webp";

  async function withSheet<T>(run: () => Promise<T>): Promise<T> {
    const { CHARACTER_SHEETS } = await import("../lib/character-art");
    CHARACTER_SHEETS.hood = SHEET;
    try {
      return await run();
    } finally {
      delete CHARACTER_SHEETS.hood;
    }
  }

  it("dựng khung sheet và gắn class theo chế độ", async () => {
    await withSheet(async () => {
      const view = await mountPortrait({ speaking: true });
      assert.ok(view.sheet, "phải dựng <img> sheet khi đã có sheet");
      assert.equal(view.sheet!.getAttribute("src"), SHEET);
      assert.ok(
        view.shell!.classList.contains("is-talking"),
        `đang nói phải ra class is-talking, đang là "${view.shell!.className}"`,
      );
      assert.equal(view.svg, null, "có sheet rồi thì không dựng thêm <svg>");
      await view.cleanup();
    });
  });

  it("người chết ra class is-dead dù caller nói họ đang nói", async () => {
    await withSheet(async () => {
      const view = await mountPortrait({ alive: false, speaking: true });
      assert.ok(view.shell!.classList.contains("is-dead"));
      await view.cleanup();
    });
  });

  it("đặt --breath-offset lên chính phần tử chân dung", async () => {
    // PlayerSeat đặt biến này ở nút cha, nhưng RosterPanel và GameOverView thì
    // không. Đặt tại chỗ thì nháy mắt lệch pha ở MỌI nơi gọi.
    await withSheet(async () => {
      const view = await mountPortrait({ breathOffset: 0.5 });
      assert.match(
        view.shell!.getAttribute("style") ?? "",
        /--breath-offset:\s*0\.5/,
        "thiếu lệch pha nháy mắt trên phần tử chân dung",
      );
      await view.cleanup();
    });
  });

  it("ảnh hỏng thì rơi về SVG, không để lại khung rỗng", async () => {
    await withSheet(async () => {
      const { act } = await import("react");
      const view = await mountPortrait();
      assert.ok(view.sheet, "phải bắt đầu bằng nhánh sheet");
      // Một file 404 sẽ 404 lại, nên component không được thử lại.
      await act(async () => {
        view.sheet!.dispatchEvent(new Event("error"));
      });
      // Đọc lại từ host chứ không dùng view.svg: view.svg chụp lúc mount, còn
      // cây DOM đã render lại sau sự kiện lỗi.
      assert.ok(view.host.querySelector("svg"), "sau lỗi ảnh phải hiện <svg>");
      assert.equal(
        view.host.querySelector(".character-portrait__sheet"),
        null,
        "không được giữ lại khung sheet sau khi ảnh hỏng",
      );
      await view.cleanup();
    });
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó HỎNG**

Run: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/components/CharacterPortrait.test.tsx`
Expected: FAIL — `Cannot find module './CharacterPortrait'`

- [ ] **Step 3: Viết component**

Tạo `apps/web/src/components/CharacterPortrait.tsx`:

```tsx
"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { AvatarId } from "@/lib/avatar-art";
import { hasSheet, sheetFor } from "@/lib/character-art";
import { portraitMode, portraitSource } from "@/lib/character-portrait";
import { readNetworkHints } from "@/lib/cinematic-settings";
import { Avatar } from "./Avatar";

/**
 * Khuôn mặt của một người chơi.
 *
 * Chỉ dùng ở những chỗ hình ĐỦ LỚN - ô người chơi, cột Người chơi, sân khấu
 * phiên toà, màn kết ván, phòng chờ. Những chỗ 24px trong nhật ký phiếu vẫn
 * dùng `<Avatar>`: ở cỡ đó khuôn mặt không mang thông tin gì, cái đĩa màu mới
 * mang, và nhồi ảnh 256px xuống 24px chỉ tốn băng thông đổi lấy một vũng nhoè.
 *
 * Component này CỐ Ý mỏng. Hai quyết định dễ sai - hiện chế độ nào, lấy hình ở
 * đâu - nằm ở `lib/character-portrait.ts` và được test ở đó.
 */

interface Props {
  avatar: AvatarId | string;
  tint: string;
  alive: boolean;
  /** Đang phát tiếng qua LiveKit. Nơi gọi nào có `seatShowsSpeaking` thì lọc trước. */
  speaking?: boolean;
  /** Mốc hết mấp máy của bot. Chưa nối dây ở đợt này - xem spec, đợt 4. */
  talkingUntilMs?: number | null;
  /** Độ lệch pha nháy mắt 0..1, lấy từ `breathOffsetFor`. */
  breathOffset?: number;
  className?: string;
  isCustom?: boolean;
}

/**
 * Save-Data của trình duyệt, đọc ĐỒNG BỘ ngay lần render đầu ở client.
 *
 * Không dùng useEffect: mặc định false rồi mới sửa lại nghĩa là ảnh đã bắt đầu
 * tải xong trước khi ta kịp biết người dùng bật tiết kiệm dữ liệu - tức là đúng
 * thứ cờ đó tồn tại để ngăn. `getServerSnapshot` trả false vì phía server không
 * có `navigator`.
 */
const subscribe = () => () => {};
function useSaveData(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => readNetworkHints().saveData,
    () => false,
  );
}

export function CharacterPortrait({
  avatar,
  tint,
  alive,
  speaking = false,
  talkingUntilMs = null,
  breathOffset = 0,
  className = "",
  isCustom,
}: Props) {
  const saveData = useSaveData();
  // Ảnh hỏng thì đi tiếp bằng SVG và KHÔNG thử lại: một file 404 sẽ 404 lại.
  const [broken, setBroken] = useState(false);
  const onError = useCallback(() => setBroken(true), []);

  const isUploaded =
    isCustom === true ||
    (typeof avatar === "string" && /^(https?:|data:image)/.test(avatar));

  const source = portraitSource({
    isCustom: isUploaded,
    hasSheet: !broken && hasSheet(avatar),
    saveData,
  });

  if (source !== "sheet") {
    return (
      <Avatar
        avatar={avatar}
        tint={tint}
        alive={alive}
        className={className}
        isCustom={isUploaded}
      />
    );
  }

  const mode = portraitMode({
    alive,
    speaking,
    talkingUntilMs,
    nowMs: Date.now(),
  });

  return (
    <span
      className={`character-portrait is-${mode} grid place-items-center overflow-hidden rounded-full border border-white/10 transition-colors ${className}`}
      style={
        {
          background: alive ? tint : "rgba(120, 130, 150, 0.10)",
          "--breath-offset": breathOffset,
        } as React.CSSProperties
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sheetFor(avatar)!}
        alt=""
        aria-hidden="true"
        onError={onError}
        className="character-portrait__sheet"
      />
    </span>
  );
}
```

- [ ] **Step 4: Chạy test và typecheck**

Run: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/components/CharacterPortrait.test.tsx`
Expected: PASS, cả 7 test

Run: `npm run lint --workspace @masoi/web`
Expected: không lỗi

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/CharacterPortrait.tsx apps/web/src/components/CharacterPortrait.test.tsx
git commit -m "feat(portrait): component CharacterPortrait với đường lui về Avatar"
```

---

### Task 5: Nối bảy chỗ gọi

**Files:**
- Modify: `apps/web/src/components/PlayerSeat.tsx:226`
- Modify: `apps/web/src/components/RosterPanel.tsx:165`
- Modify: `apps/web/src/components/TrialStage.tsx:296`
- Modify: `apps/web/src/components/TrialPanel.tsx:81`
- Modify: `apps/web/src/components/GameOverView.tsx:265` và `:657`
- Modify: `apps/web/src/components/LobbyPlayerGrid.tsx:71` và `:180`
- Modify: `apps/web/src/components/DefenseVotePanel.tsx:83`

**Interfaces:**
- Consumes: `CharacterPortrait` (Task 4)
- Produces: không gì mới

**KHÔNG đổi:** `OpenVotePanel.tsx` và `VoteHistoryPanel.tsx`. Cả hai gọi ở `h-6 w-6` (24px) và cố ý giữ `<Avatar>` — xem docstring Task 4.

- [ ] **Step 1: Thay ở `PlayerSeat.tsx`**

Đổi import ở đầu file — thêm dòng sau `import { Avatar } from "./Avatar";`:

```ts
import { CharacterPortrait } from "./CharacterPortrait";
```

Tại dòng 226, đổi thẻ `<Avatar` thành `<CharacterPortrait`, giữ nguyên mọi prop đang truyền, và thêm hai prop:

```tsx
speaking={speaking}
breathOffset={breathOffsetFor(player.id)}
```

`speaking` ở đây là biến đã tính sẵn ở dòng 68 qua `seatShowsSpeaking` — dùng lại, không gọi lại.

- [ ] **Step 2: Chạy test ô người chơi để chắc không gãy gì**

Run: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/components/PlayerSeat.test.tsx`
Expected: PASS — chưa có sheet nên `CharacterPortrait` rơi về `<Avatar>`, DOM không đổi

- [ ] **Step 3: Thay ở sáu component còn lại**

Với mỗi file trong danh sách dưới: thêm `import { CharacterPortrait } from "./CharacterPortrait";`, đổi thẻ `<Avatar` thành `<CharacterPortrait` tại đúng dòng đã ghi, giữ nguyên mọi prop hiện có.

| File | Dòng | Prop thêm |
|---|---|---|
| `RosterPanel.tsx` | 165 | `speaking={speaking}` (biến đã có ở dòng 129), `breathOffset` đã truyền sẵn |
| `TrialStage.tsx` | 296 | `speaking={speaking}` (biến đã có ở dòng 201), `breathOffset` đã truyền sẵn |
| `TrialPanel.tsx` | 81 | `breathOffset` đã truyền sẵn, không thêm gì |
| `GameOverView.tsx` | 265, 657 | `breathOffset` đã truyền sẵn, không thêm gì |
| `LobbyPlayerGrid.tsx` | 71, 180 | thêm `breathOffset={breathOffsetFor(player.id)}` và import `breathOffsetFor` từ `@/lib/avatar` |
| `DefenseVotePanel.tsx` | 83 | thêm `breathOffset={breathOffsetFor(voterId)}` và import `breathOffsetFor` từ `@/lib/avatar` |

- [ ] **Step 4: Chạy toàn bộ test web**

Run: `npm test --workspace @masoi/web`
Expected: PASS toàn bộ. Chưa có sheet nên mọi đường rơi về `<Avatar>` và DOM giống hệt trước.

Run: `npm run lint --workspace @masoi/web`
Expected: không lỗi

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/
git commit -m "feat(portrait): nối CharacterPortrait vào bảy chỗ hình lớn"
```

---

### Task 6: Hợp đồng phong cách

**Files:**
- Create: `apps/web/public/characters/SOURCES.md`

**Interfaces:**
- Consumes: `PORTRAIT_FRAMES` (Task 2) — thứ tự frame phải khớp
- Produces: không gì (tài liệu)

- [ ] **Step 1: Viết hợp đồng**

Tạo `apps/web/public/characters/SOURCES.md`:

```markdown
# Chân dung nhân vật — nguồn và hợp đồng phong cách

Theo tiền lệ `public/audio/CREDITS.md`: mọi asset trong thư mục này phải ghi
được nguồn gốc, và phải sinh lại được y hệt sáu tháng sau.

## Định dạng bắt buộc

- Một file `.webp` cho mỗi nhân vật, đặt tên đúng bằng `AvatarId`
  (`farmer.webp`, `viking.webp`, …). Danh sách id nằm ở
  `apps/web/src/lib/avatar-art.ts`.
- **Bốn frame nằm ngang**, mỗi frame vuông 256×256, tổng 1024×256.
- Thứ tự frame là HỢP ĐỒNG với `characters.css` — đổi thứ tự là hỏng hình:

  | # | Tên | Mắt | Miệng |
  |---|---|---|---|
  | 0 | `idle` | mở | ngậm |
  | 1 | `blink` | nhắm | ngậm |
  | 2 | `talk` | mở | mở |
  | 3 | `dead` | nhắm | ngậm, mặt tái |

- Trần dung lượng: 120KB mỗi file, 1.4MB cho cả bộ. Có test chặn
  (`character-art.test.ts`), không phải lời khuyên.
- Không sinh frame "vừa nhắm mắt vừa há miệng": nháy mắt bị chặn trong lúc đang
  nói, nên tổ hợp đó không bao giờ hiện.

## Hai ràng buộc BẮT BUỘC trong prompt

**1. Dải màu hẹp, nền tối trầm. Không đỏ bão hoà, không xanh lá bão hoà.**
Hai màu đó thuộc về tầng trạng thái: đỏ là ô đang bị nhắm, xám là đã chết. Chân
dung rực rỡ sẽ đánh nhau với viền, và lúc phát hiện ra thì 16 tấm đã sinh xong.

**2. Nhận ra được là cùng một người với bóng SVG.**
`farmer` phải ra nông dân, `viking` phải ra viking. Hai hệ hình xuất hiện cạnh
nhau trong cùng một màn — chân dung lớn ở ô người chơi, bóng 24px trong nhật ký
phiếu — nên nếu chúng không khớp thì người xem đọc ra hai người khác nhau.

## Prompt phong cách

> _(điền khi chốt phong cách ở đợt 2 — cùng một prompt cho cả 16 nhân vật, chỉ
> đổi phần mô tả nhân vật)_

## Bảng nhân vật

| id | Mô tả nhân vật trong prompt | Model | Ngày sinh | Ảnh tham chiếu |
|---|---|---|---|---|
| _(điền dần theo đợt 2 và đợt 3)_ | | | | |

## Bản quyền

Ảnh sinh bằng AI cho riêng dự án này. KHÔNG lấy từ game-icons.net — bộ SVG đơn
sắc ở `avatar-art.ts` mới là bộ đó, và phần ghi công của nó nằm ở
`apps/web/src/lib/AVATAR-CREDITS.md`, không trộn vào đây.
```

Lưu ý cho người thực thi: hai chỗ `_(điền…)_` là **có chủ ý** — chúng là chỗ dành cho đợt 2, khi phong cách được chốt trên máy thật. Không tự bịa prompt vào đó.

- [ ] **Step 2: Chạy toàn bộ test web lần cuối**

Run: `npm test --workspace @masoi/web`
Expected: PASS toàn bộ

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/characters/SOURCES.md
git commit -m "docs(portrait): hợp đồng phong cách cho sheet chân dung"
```

---

## Sau kế hoạch này

Đợt 1 kết thúc ở đây: code đầy đủ, test xanh, giao diện giống hệt hôm nay vì
chưa có sheet nào. Merge được vào `main` an toàn.

**Đợt 2 (việc của tác giả, không phải của agent):** sinh 3 sheet theo hợp đồng,
điền vào `CHARACTER_SHEETS`, xem chúng đứng cạnh `live-trial` và
`village-memory` ở cỡ thật. Kiểm ở **cả 390px lẫn màn rộng** — lần duyệt UI
trước chỉ verify ở 390px và trên màn 2559px kết quả là một cột 512px giữa bãi
nền trống. Đây là cửa go/no-go: style hỏng thì vứt 3 tấm, không phải 64.

**Đợt 3:** 13 sheet còn lại, thêm dòng vào `CHARACTER_SHEETS` và bảng trong
`SOURCES.md`. Không đổi code.

**Đợt 4:** nối `talkingUntilMs` cho bot. Việc đầu tiên là **xác minh log chat có
với tới `PlayerSeat` không** — chưa ai kiểm. Đường dây xấu thì báo lại, không
kéo prop xuyên năm tầng component.
