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
- **16 sheet ĐÃ có sẵn** trong `apps/web/public/characters/`, đều `1024×256`, 50–77KB. Không phải sinh, không được sửa file ảnh.
- **Frame 1 và 2 hiện là bản sao của frame 0** (đo được: lệch trung bình 0.7–1.5/255, tức nhiễu nén). Chỉ frame 3 là khác thật. Vì vậy mọi sheet khai báo `variants: false` và CSS KHÔNG chạy animation cho chúng.
- Trần dung lượng theo `SOURCES.md` đang có: **80KB mỗi sheet, 1200KB tổng**.
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
| `apps/web/public/characters/SOURCES.md` | Đã có — bổ sung, KHÔNG ghi đè |
| `apps/web/src/components/AssetCredits.tsx` | Mặt ghi công CC BY trong game |
| `tools/build-character-sheets.py` | Script dựng sheet, chuyển từ thư mục temp vào repo |

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
  - `interface CharacterSheet { src: string; variants: boolean }`
  - `const CHARACTER_SHEETS: Partial<Record<AvatarId, CharacterSheet>>` — **đủ 16 mục**
  - `sheetFor(avatar: string): CharacterSheet | null`
  - `hasSheet(avatar: string): boolean`
  - `hasVariants(avatar: string): boolean`

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
  hasVariants,
  sheetFor,
} from "./character-art";

const PUBLIC_DIR = join(process.cwd(), "public", "characters");
/** Trần theo SOURCES.md. Vượt là ảnh chưa nén đúng, không phải ảnh đẹp hơn. */
const MAX_SHEET_BYTES = 80 * 1024;
const MAX_TOTAL_BYTES = 1_200 * 1024;

function fileOf(src: string): string {
  return join(process.cwd(), "public", src.replace(/^\//, ""));
}

/**
 * Kích thước một file WebP, đọc thẳng từ header.
 *
 * Chỉ hiểu chunk VP8X - đúng loại mà cả 16 sheet đang dùng. Gặp loại khác thì
 * trả null và test bỏ qua, vì thà không kiểm còn hơn báo sai.
 */
function webpSize(path: string): { width: number; height: number } | null {
  const head = readFileSync(path).subarray(0, 30);
  if (head.subarray(0, 4).toString("latin1") !== "RIFF") return null;
  if (head.subarray(8, 12).toString("latin1") !== "WEBP") return null;
  if (head.subarray(12, 16).toString("latin1") !== "VP8X") return null;
  return {
    width: head.readUIntLE(24, 3) + 1,
    height: head.readUIntLE(27, 3) + 1,
  };
}

describe("manifest chân dung", () => {
  it("bốn frame, đúng thứ tự đã chốt trong spec", () => {
    assert.deepEqual([...PORTRAIT_FRAMES], ["idle", "blink", "talk", "dead"]);
    assert.equal(PORTRAIT_FRAME_COUNT, 4);
  });

  it("mọi AvatarId đều có sheet", () => {
    // Bắt lỗi "thêm nhân vật thứ 17, quên sinh sheet": nhân vật thiếu sheet sẽ
    // im lặng hiện bóng đen giữa một bàn toàn mặt người.
    for (const id of AVATAR_IDS) {
      assert.ok(hasSheet(id), `${id} chưa có sheet`);
    }
  });

  it("mọi khoá trong bảng sheet phải là một AvatarId có thật", () => {
    for (const key of Object.keys(CHARACTER_SHEETS)) {
      assert.ok(
        (AVATAR_IDS as readonly string[]).includes(key),
        `${key} không có trong AVATAR_IDS`,
      );
    }
  });

  it("mọi sheet đã khai báo phải tồn tại thật trong public/", () => {
    for (const [id, sheet] of Object.entries(CHARACTER_SHEETS)) {
      assert.ok(sheet?.src, `${id} khai báo sheet rỗng`);
      assert.doesNotThrow(
        () => statSync(fileOf(sheet!.src)),
        `thiếu file cho ${id}: ${sheet!.src}`,
      );
    }
  });

  it("không có file sheet mồ côi trong public/characters", () => {
    // Chiều ngược lại: file nằm đó mà không ai khai báo thì nó đang chiếm chỗ
    // trong repo mà không bao giờ được tải.
    const files = readdirSync(PUBLIC_DIR).filter((f) => f.endsWith(".webp"));
    const declared = new Set(
      Object.values(CHARACTER_SHEETS).map((sheet) => sheet!.src.split("/").pop()),
    );
    for (const file of files) {
      assert.ok(declared.has(file), `${file} không được khai báo trong CHARACTER_SHEETS`);
    }
  });

  it("mọi sheet phải là bốn frame vuông nằm ngang", () => {
    // Sai kích thước là lỗi asset gây vỡ hình nặng nhất: CSS trượt theo phần
    // trăm nên một file 3 frame sẽ hiện nửa mặt người này ghép nửa mặt người kia.
    for (const [id, sheet] of Object.entries(CHARACTER_SHEETS)) {
      const size = webpSize(fileOf(sheet!.src));
      if (!size) continue;
      assert.equal(
        size.width,
        size.height * PORTRAIT_FRAME_COUNT,
        `${id} là ${size.width}x${size.height}, phải rộng gấp ${PORTRAIT_FRAME_COUNT} lần chiều cao`,
      );
    }
  });

  it("bộ art hiện tại chưa có biến thể biểu cảm", () => {
    // Đo được: frame 1 và 2 lệch frame 0 trung bình 0.7-1.5 trên 255, tức đúng
    // bằng nhiễu nén WebP. Test này là cái chốt lại sự thật đó, để ngày nào có
    // sheet thật thì người sửa buộc phải sửa cả đây - và nhớ ra là CSS sẽ bật.
    for (const id of AVATAR_IDS) {
      assert.equal(hasVariants(id), false, `${id} đang tự nhận có biến thể`);
    }
  });

  it("hasSheet và hasVariants trả false cho chuỗi không phải AvatarId", () => {
    // Avatar tự tải lên đi vào đây dưới dạng một URL http.
    assert.equal(hasSheet("https://example.com/a.png"), false);
    assert.equal(hasVariants("https://example.com/a.png"), false);
    assert.equal(sheetFor("https://example.com/a.png"), null);
  });
});

describe("ngân sách dung lượng", () => {
  it("mỗi sheet dưới trần, và tổng dưới trần", () => {
    // Không có test này thì một hôm nào đó một tấm PNG 4MB lọt vào và không ai
    // biết cho tới lúc người chơi 4G kêu.
    let total = 0;
    for (const [id, sheet] of Object.entries(CHARACTER_SHEETS)) {
      const size = statSync(fileOf(sheet!.src)).size;
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
 * Nguồn art và cách dựng lại nằm ở `public/characters/SOURCES.md`.
 */

/** Thứ tự frame trong sheet, trái sang phải. Đổi thứ tự là đổi luôn CSS. */
export const PORTRAIT_FRAMES = ["idle", "blink", "talk", "dead"] as const;

export type PortraitFrame = (typeof PORTRAIT_FRAMES)[number];

export const PORTRAIT_FRAME_COUNT = PORTRAIT_FRAMES.length;

export interface CharacterSheet {
  /** Đường dẫn từ gốc `public/`. */
  src: string;
  /**
   * Frame `blink` và `talk` có KHÁC frame `idle` thật không.
   *
   * Bộ art hiện tại là pack chân dung tĩnh, không có biến thể biểu cảm, nên
   * frame 1 và 2 là bản sao của frame 0 - đo được lệch trung bình 0.7-1.5 trên
   * 255, tức đúng bằng nhiễu nén WebP. Chạy animation để đổi sang một bức ảnh
   * y hệt là đốt pin của mười lăm ô đổi lấy con số không, nên CSS chỉ bật
   * animation khi cờ này bật.
   *
   * Ngày nào có sheet biến thể thật thì đổi `false` thành `true` ở đúng dòng
   * đó - nháy mắt và mấp máy tự sống dậy, không đụng một dòng code nào.
   */
  variants: boolean;
}

export const CHARACTER_SHEETS: Partial<Record<AvatarId, CharacterSheet>> = {
  farmer: { src: "/characters/farmer.webp", variants: false },
  cook: { src: "/characters/cook.webp", variants: false },
  blacksmith: { src: "/characters/blacksmith.webp", variants: false },
  miner: { src: "/characters/miner.webp", variants: false },
  monk: { src: "/characters/monk.webp", variants: false },
  mustache: { src: "/characters/mustache.webp", variants: false },
  jester: { src: "/characters/jester.webp", variants: false },
  ranger: { src: "/characters/ranger.webp", variants: false },
  captain: { src: "/characters/captain.webp", variants: false },
  viking: { src: "/characters/viking.webp", variants: false },
  pilgrim: { src: "/characters/pilgrim.webp", variants: false },
  turban: { src: "/characters/turban.webp", variants: false },
  sombrero: { src: "/characters/sombrero.webp", variants: false },
  cowled: { src: "/characters/cowled.webp", variants: false },
  hood: { src: "/characters/hood.webp", variants: false },
  beard: { src: "/characters/beard.webp", variants: false },
};

const IDS: ReadonlySet<string> = new Set(AVATAR_IDS);

/**
 * Sheet của một nhân vật, hoặc null nếu chưa có.
 *
 * Nhận `string` chứ không nhận `AvatarId` vì nơi gọi có thể đang cầm một URL
 * ảnh người chơi tự tải lên - xem `Avatar.tsx`, cùng một trường mang hai loại
 * giá trị. Chuỗi không phải AvatarId thì trả null, không ném.
 */
export function sheetFor(avatar: string): CharacterSheet | null {
  if (!IDS.has(avatar)) return null;
  return CHARACTER_SHEETS[avatar as AvatarId] ?? null;
}

export function hasSheet(avatar: string): boolean {
  return sheetFor(avatar) !== null;
}

/** Có đáng chạy animation cho nhân vật này không. */
export function hasVariants(avatar: string): boolean {
  return sheetFor(avatar)?.variants === true;
}
```

- [ ] **Step 4: Chạy test và typecheck**

Run: `cd apps/web && npx tsx --experimental-test-module-mocks --test src/lib/character-art.test.ts`
Expected: PASS. 16 sheet có thật nên mọi test duyệt file, kiểm kích thước và ngân sách đều chạy thật.

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

/*
 * Animation CHỈ chạy khi sheet có biến thể thật.
 *
 * Bộ art hiện tại là pack chân dung tĩnh: frame `blink` và `talk` là bản sao
 * của `idle`, lệch nhau đúng bằng nhiễu nén. Cho mười lăm ô chạy animation
 * vĩnh viễn để đổi sang một bức ảnh y hệt là đốt pin đổi lấy con số không -
 * nên `has-variants` là cửa, và `character-art.ts` là nơi mở nó.
 *
 * Trạng thái "đang nói" KHÔNG mất đi khi cửa đóng: nó vẫn được vẽ bằng quầng
 * ngoài khung (`.seat-voice-halo`), chỗ nó vốn thuộc về từ trước.
 */

/* Mặt bình thường: frame 0, thỉnh thoảng chớp sang frame 1. */
.character-portrait.has-variants.is-alive .character-portrait__sheet {
  animation: character-blink 5.4s steps(1, end) infinite;
  /*
   * Lệch pha riêng của từng người, dùng lại đúng con số đã tính cho nhịp thở.
   * Mười lăm khuôn mặt nháy mắt đồng pha đọc ra như cả lưới vừa giật một cái,
   * chứ không phải như mười lăm người đang ngồi.
   */
  animation-delay: calc(var(--breath-offset, 0) * -5.4s);
}

/* Đang nói: đảo qua lại frame 0 và frame 2. */
.character-portrait.has-variants.is-talking .character-portrait__sheet {
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
  .character-portrait.has-variants.is-alive .character-portrait__sheet {
    animation: none;
    transform: translateX(0);
  }

  .character-portrait.has-variants.is-talking .character-portrait__sheet {
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
  it("nhân vật không có trong bảng sheet thì hiện bóng SVG cũ", async () => {
    // Không có AvatarId nào rơi vào đây nữa (cả 16 đều có sheet), nhưng đường
    // lui vẫn phải sống: một id lạ lọt vào từ snapshot cũ không được làm trống ô.
    const view = await mountPortrait({ avatar: "khong-ton-tai" });
    assert.ok(view.svg, "phải rơi về <svg> khi không tra được sheet");
    assert.equal(view.sheet, null, "không được dựng khung sheet khi không có sheet");
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
 * `hood` có sheet thật trong `public/characters/`, nên không cần chèn tay gì cả.
 */
describe("CharacterPortrait khi đã có sheet", () => {
  it("dựng khung sheet và gắn class theo chế độ", async () => {
    const view = await mountPortrait({ speaking: true });
    assert.ok(view.sheet, "phải dựng <img> sheet");
    assert.equal(view.sheet!.getAttribute("src"), "/characters/hood.webp");
    assert.ok(
      view.shell!.classList.contains("is-talking"),
      `đang nói phải ra class is-talking, đang là "${view.shell!.className}"`,
    );
    assert.equal(view.svg, null, "có sheet rồi thì không dựng thêm <svg>");
    await view.cleanup();
  });

  it("người chết ra class is-dead dù caller nói họ đang nói", async () => {
    const view = await mountPortrait({ alive: false, speaking: true });
    assert.ok(view.shell!.classList.contains("is-dead"));
    await view.cleanup();
  });

  it("KHÔNG gắn has-variants khi sheet chưa có biến thể thật", async () => {
    // Đây là cái chặn mười lăm ô chạy animation vĩnh viễn để đổi sang một bức
    // ảnh y hệt. Ngày nào sheet có biến thể thật thì test này phải được sửa
    // cùng lúc với cờ trong character-art.ts - và đó là ý đồ.
    const view = await mountPortrait();
    assert.equal(
      view.shell!.classList.contains("has-variants"),
      false,
      "bộ art hiện tại chưa có biến thể, không được bật animation",
    );
    await view.cleanup();
  });

  it("đặt --breath-offset lên chính phần tử chân dung", async () => {
    // PlayerSeat đặt biến này ở nút cha, nhưng RosterPanel và GameOverView thì
    // không. Đặt tại chỗ thì nháy mắt lệch pha ở MỌI nơi gọi - kể cả sau này,
    // khi has-variants được bật.
    const view = await mountPortrait({ breathOffset: 0.5 });
    assert.match(
      view.shell!.getAttribute("style") ?? "",
      /--breath-offset:\s*0\.5/,
      "thiếu lệch pha nháy mắt trên phần tử chân dung",
    );
    await view.cleanup();
  });

  it("ảnh hỏng thì rơi về SVG, không để lại khung rỗng", async () => {
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
import { hasSheet, hasVariants, sheetFor } from "@/lib/character-art";
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
      className={`character-portrait is-${mode}${
        hasVariants(avatar) ? " has-variants" : ""
      } grid place-items-center overflow-hidden rounded-full border border-white/10 transition-colors ${className}`}
      style={
        {
          background: alive ? tint : "rgba(120, 130, 150, 0.10)",
          "--breath-offset": breathOffset,
        } as React.CSSProperties
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={sheetFor(avatar)!.src}
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
Expected: PASS, cả 7 test (2 nhánh fallback + 5 nhánh sheet)

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

### Task 6: Bổ sung SOURCES.md và cứu script dựng sheet

**Files:**
- Modify: `apps/web/public/characters/SOURCES.md` (**đã tồn tại — bổ sung, KHÔNG ghi đè**)
- Create: `tools/build-character-sheets.py` (chuyển từ `%TEMP%`, không viết lại)

**Interfaces:**
- Consumes: `CHARACTER_SHEETS` (Task 2) — bảng nhân vật trong tài liệu phải khớp
- Produces: không gì (tài liệu và công cụ)

- [ ] **Step 1: Cứu script dựng sheet ra khỏi thư mục temp**

`SOURCES.md` đang trỏ script tới `C:\Users\Admin\AppData\Local\Temp\opencode\build_sheets.py`. Windows dọn `%TEMP%` bất cứ lúc nào, và mất script thì không ai dựng lại được 16 sheet.

Copy nguyên văn file đó sang `tools/build-character-sheets.py`. **Không sửa nội dung, không "cải tiến"** — nó đã chạy ra đúng 16 sheet đang có, và sửa mù một script chưa từng đọc là cách nhanh nhất để mất khả năng tái tạo.

Nếu file không còn ở đó, DỪNG và báo lại — đừng viết một script mới rồi gọi nó là script cũ.

- [ ] **Step 2: Cập nhật đường dẫn script trong SOURCES.md**

Trong mục `## Tai sinh`, đổi đường dẫn temp thành `tools/build-character-sheets.py`.

- [ ] **Step 3: Ghi lại ba sự thật đã đo được**

Thêm vào cuối `apps/web/public/characters/SOURCES.md`:

```markdown
## Đã đo, không phải phỏng đoán

**Frame 1 và 2 KHÔNG khác frame 0.** Đo trên `hood`, `farmer`, `viking`: lệch
trung bình 0.7–1.5 trên 255, max 21–33 — đúng bằng nhiễu nén WebP. Frame 3 thì
khác thật: lệch trung bình 4.9–8.4, max 68–74.

Vì vậy mọi sheet khai báo `variants: false` trong
`apps/web/src/lib/character-art.ts`, và CSS không chạy animation cho chúng.
Ngày nào có sheet biến thể thật, đổi cờ đó thành `true` ở đúng dòng của nhân
vật đó — nháy mắt và mấp máy tự sống dậy, không đụng code.

**Bốn khuôn mặt dùng chung.** `mustache` và `miner` cùng là Caius; `beard` và
`turban` cùng là Eldrin; `pilgrim` và `cook` cùng là Indira; `sombrero` và
`jester` cùng là Soleil. `assignAvatars` không cho trùng AvatarId nhưng KHÔNG
biết bốn cặp này, nên một phòng 15 ghế gần như chắc chắn xếp một cặp cạnh nhau
— hai khuôn mặt gần giống, một cái bị lật. Đây là lý do ưu tiên số một để thay
pack, quan trọng hơn cả chuyện biến thể biểu cảm: chân dung tồn tại để phân biệt
người này với người kia.

**Kích thước là hợp đồng.** 1024×256, 4 frame vuông. `character-art.test.ts`
đọc header WebP và chặn file sai tỉ lệ — CSS trượt theo phần trăm nên một sheet
3 frame sẽ ghép nửa mặt người này với nửa mặt người kia.
```

- [ ] **Step 4: Chạy toàn bộ test web**

Run: `npm test --workspace @masoi/web`
Expected: PASS toàn bộ

- [ ] **Step 5: Commit**

```bash
git add apps/web/public/characters/SOURCES.md tools/build-character-sheets.py
git commit -m "docs(portrait): cứu script dựng sheet khỏi %TEMP%, ghi lại số đo biến thể"
```

---

### Task 7: Ghi công CC BY trong game

**Files:**
- Create: `apps/web/src/components/AssetCredits.tsx`
- Modify: `apps/web/src/app/page.tsx:536` (thêm ngay sau `</main>`)

**Interfaces:**
- Consumes: không gì
- Produces: `AssetCredits()` — component không nhận prop

**Vì sao task này tồn tại:** cả hai bộ art đều là CC BY, và CC BY bắt buộc ghi công **cho người dùng tác phẩm**, không phải ghi trong repo là xong. Hiện game **không có mặt ghi công nào** — `AVATAR-CREDITS.md` và `SOURCES.md` chỉ nằm trong mã nguồn. Nghĩa là nghĩa vụ CC BY 3.0 của bộ SVG game-icons.net đã chưa được đáp ứng từ trước, và pack Studio NIK vừa thêm một nghĩa vụ CC BY 4.0 nữa. Một dòng nhỏ trả nợ cả hai.

- [ ] **Step 1: Viết component**

Tạo `apps/web/src/components/AssetCredits.tsx`:

```tsx
/**
 * Ghi công tài nguyên hình ảnh.
 *
 * Cả hai bộ art đều là CC BY, và giấy phép đó đòi ghi công CHO NGƯỜI DÙNG tác
 * phẩm - một file markdown trong mã nguồn không đáp ứng được. Đây là mặt ghi
 * công duy nhất của game, nên đừng xoá nó, và thay bộ art nào thì sửa đúng
 * dòng của bộ đó.
 *
 * Nguồn đầy đủ: `src/lib/AVATAR-CREDITS.md` và `public/characters/SOURCES.md`.
 */
export function AssetCredits() {
  return (
    <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-[11px] leading-relaxed text-mist/35">
      <p>
        Chân dung nhân vật by{" "}
        <a
          href="https://studio-nik.itch.io"
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-mist/20 underline-offset-2 hover:text-mist/60"
        >
          Studio Nik
        </a>{" "}
        (CC BY 4.0) · Biểu tượng by Lorc, Delapouite và sbed tại{" "}
        <a
          href="https://game-icons.net"
          target="_blank"
          rel="noreferrer noopener"
          className="underline decoration-mist/20 underline-offset-2 hover:text-mist/60"
        >
          game-icons.net
        </a>{" "}
        (CC BY 3.0)
      </p>
    </footer>
  );
}
```

- [ ] **Step 2: Nối vào trang chủ**

Trong `apps/web/src/app/page.tsx`, thêm import ở đầu file:

```ts
import { AssetCredits } from "@/components/AssetCredits";
```

Rồi ngay sau `</main>` (dòng 536), trước `</>`, thêm:

```tsx
<AssetCredits />
```

- [ ] **Step 3: Typecheck và chạy toàn bộ test web**

Run: `npm run lint --workspace @masoi/web`
Expected: không lỗi

Run: `npm test --workspace @masoi/web`
Expected: PASS toàn bộ

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AssetCredits.tsx apps/web/src/app/page.tsx
git commit -m "feat(web): mặt ghi công CC BY cho hai bộ art"
```

---

## Sau kế hoạch này

Hết kế hoạch này thì 16 khuôn mặt thật đã thay xong 16 cái bóng đen, ở cả bảy
mặt hình lớn. Đó là phần thắng lớn nhất của cả thiết kế và nó không phụ thuộc
vào animation.

Ba việc còn lại, xếp theo mức quan trọng — và thứ tự này KHÁC với bản kế hoạch
đầu, vì bộ art thật đã trả lời vài câu hỏi mà lúc đó còn để ngỏ:

**1. Thay bốn khuôn mặt dùng chung.** `mustache`/`miner`, `beard`/`turban`,
`pilgrim`/`cook`, `sombrero`/`jester` — mỗi cặp là một khuôn mặt bị lật hoặc
crop. Một phòng 15 ghế gần như chắc chắn xếp một cặp cạnh nhau. Chân dung tồn
tại để phân biệt người này với người kia, nên đây là lỗi nặng hơn chuyện mặt
đứng yên.

**2. Sheet có biến thể biểu cảm thật.** Có rồi thì đổi `variants: false` thành
`true` ở đúng dòng trong `character-art.ts`, sửa test tương ứng trong
`character-art.test.ts` và `CharacterPortrait.test.tsx` — nháy mắt và mấp máy tự
sống dậy. Không đụng CSS, không đụng component. Đây cũng là lúc lip-sync theo
`useSpeakers()` mới thật sự hoạt động.

**3. Nối `talkingUntilMs` cho bot.** Việc đầu tiên là **xác minh log chat có với
tới `PlayerSeat` không** — chưa ai kiểm. Đường dây xấu thì báo lại, không kéo
prop xuyên năm tầng component. Và việc này chỉ có nghĩa sau khi (2) xong: chưa
có biến thể thì miệng bot mấp máy cũng không thấy gì.

Kiểm giao diện ở **cả 390px lẫn màn rộng** trước khi gọi là xong. Lần duyệt UI
trước chỉ verify ở 390px và trên màn 2559px kết quả là một cột 512px giữa bãi
nền trống.
