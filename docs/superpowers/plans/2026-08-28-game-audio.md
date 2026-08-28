# Game Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm ba track nhạc nền đổi theo pha và sáu hiệu ứng ngắn cho client web, kèm nút loa với hai thanh âm lượng riêng cho nhạc và hiệu ứng.

**Architecture:** Ba module thuần (`audio-track`, `audio-cues`, `audio-settings`) giữ toàn bộ phần quyết định được và có test; một module singleton `audio-engine` là nơi duy nhất chạm `HTMLAudioElement`. Hook `useGameAudio` nối snapshot của `useRoomSocket` vào engine: mỗi snapshot mới cho ra một track cần phát và một danh sách tiếng cần bật. Server và `packages/*` không đổi.

**Tech Stack:** TypeScript, React 19, Next.js 16, `node:test` chạy qua `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-28-game-audio-design.md`

## Global Constraints

- Không thêm dependency nào vào `apps/web`.
- Ba module thuần phải nằm thẳng trong `apps/web/src/lib/`, không nhét vào thư mục con: script test là `tsx --test src/lib/*.test.ts` với glob phẳng.
- Thiếu file âm thanh thì im lặng, không hiện lỗi, không chặn game.
- Mặc định: `musicVolume` 0.4, `sfxVolume` 0.8, `muted` false.
- Khoá `localStorage` là `masoi.audio`.
- Crossfade 600ms, chia 20 nấc.
- Mọi lời gọi `play()` phải nuốt lỗi bằng `.catch(() => undefined)`; lỗi audio không bao giờ nổi lên React.
- Lệnh `play()` đầu tiên phải nằm trong stack đồng bộ của cử chỉ người dùng, không được đặt sau `await`.
- Viết test thất bại trước phần implementation ở Task 1–3. Task 4–6 không có unit test theo đúng spec; kiểm bằng `npm run lint` và chạy tay.
- Mọi file mới trong `apps/web/src` bắt đầu bằng `"use client";` trừ file test.

---

## File map

- `apps/web/src/lib/audio-track.ts`: ánh xạ pha sang track nhạc.
- `apps/web/src/lib/audio-cues.ts`: so hai snapshot ra danh sách hiệu ứng cần phát.
- `apps/web/src/lib/audio-settings.ts`: đọc ghi thiết lập âm lượng vào `localStorage`.
- `apps/web/src/lib/audio-engine.ts`: singleton giữ ba `<audio>`, crossfade, phát hiệu ứng, mở khoá autoplay.
- `apps/web/src/lib/useGameAudio.ts`: hook nối snapshot với engine.
- `apps/web/src/components/SoundControl.tsx`: nút loa và popover hai thanh trượt.
- `apps/web/src/app/room/[code]/page.tsx`: gọi hook và gắn nút loa vào header.
- `apps/web/public/audio/README.md`: hợp đồng file cho người bỏ nhạc vào.

---

### Task 1: Ánh xạ pha sang track nhạc

**Files:**
- Create: `apps/web/src/lib/audio-track.ts`
- Test: `apps/web/src/lib/audio-track.test.ts`

**Interfaces:**
- Consumes: `Phase` và `PHASES` từ `@masoi/shared`.
- Produces: `export type Track = "night" | "day" | "vote"` và `export function trackFor(phase: Phase): Track | null`.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/src/lib/audio-track.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PHASES } from "@masoi/shared";
import { trackFor, type Track } from "./audio-track";

describe("trackFor", () => {
  it("ban đêm có track riêng", () => {
    assert.equal(trackFor("NIGHT"), "night");
  });

  it("phòng chờ và các pha ban ngày dùng chung track ngày", () => {
    for (const phase of ["LOBBY", "ROLE_REVEAL", "NIGHT_RESULT", "DAY_DISCUSSION"] as const) {
      assert.equal(trackFor(phase), "day", phase);
    }
  });

  it("các pha quanh bỏ phiếu dùng chung track bỏ phiếu", () => {
    for (const phase of ["VOTING", "ELIMINATION", "CHECK_WIN"] as const) {
      assert.equal(trackFor(phase), "vote", phase);
    }
  });

  it("kết thúc ván thì tắt nhạc để tiếng win/lose vang một mình", () => {
    assert.equal(trackFor("GAME_OVER"), null);
  });

  it("không sót pha nào", () => {
    const allowed: (Track | null)[] = ["night", "day", "vote", null];
    for (const phase of PHASES) {
      assert.ok(allowed.includes(trackFor(phase)), phase);
    }
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó đỏ**

Run: `npm run test --workspace @masoi/web`
Expected: FAIL, không tìm thấy module `./audio-track`.

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `apps/web/src/lib/audio-track.ts`:

```ts
"use client";

import type { Phase } from "@masoi/shared";

export type Track = "night" | "day" | "vote";

/**
 * Record<Phase, ...> chứ không phải object thường: thêm pha mới vào PHASES mà
 * quên khai báo ở đây là lỗi biên dịch, thay vì một pha im lặng không nhạc.
 *
 * NIGHT_RESULT và ELIMINATION cố ý dùng chung track với pha liền kề. Hai pha đó
 * chỉ dài 8 giây, cho chúng track riêng thì nhạc giật liên tục.
 */
const TRACK_BY_PHASE: Record<Phase, Track | null> = {
  LOBBY: "day",
  ROLE_REVEAL: "day",
  NIGHT: "night",
  NIGHT_RESULT: "day",
  DAY_DISCUSSION: "day",
  VOTING: "vote",
  ELIMINATION: "vote",
  CHECK_WIN: "vote",
  GAME_OVER: null,
};

export function trackFor(phase: Phase): Track | null {
  return TRACK_BY_PHASE[phase] ?? null;
}
```

- [ ] **Step 4: Chạy lại test**

Run: `npm run test --workspace @masoi/web`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/audio-track.ts apps/web/src/lib/audio-track.test.ts
git commit -m "feat: map game phases to background music tracks"
```

---

### Task 2: Suy ra hiệu ứng từ hai snapshot liên tiếp

Đây là phần dễ sai nhất của tính năng. Client không có luồng sự kiện game — server chỉ gửi snapshot — nên mọi tiếng phải suy ra bằng cách so hai snapshot. Nếu xét theo trạng thái thay vì theo cạnh, mỗi lần rớt mạng vào lại sẽ phát lại tiếng của việc đã xảy ra từ lâu.

**Files:**
- Create: `apps/web/src/lib/audio-cues.ts`
- Test: `apps/web/src/lib/audio-cues.test.ts`

**Interfaces:**
- Consumes: `RoomSnapshot`, `roleTeam`, `DEFAULT_ROOM_CONFIG` từ `@masoi/shared`.
- Produces: `export type Cue = "howl" | "turn" | "death" | "ballot" | "win" | "lose"` và `export function cuesFor(prev: RoomSnapshot | null, next: RoomSnapshot): Cue[]`.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/web/src/lib/audio-cues.test.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ROOM_CONFIG, type RoomSnapshot } from "@masoi/shared";
import { cuesFor } from "./audio-cues";

function snapshot(over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABCDE",
    hostId: "me",
    phase: "DAY_DISCUSSION",
    config: { ...DEFAULT_ROOM_CONFIG },
    round: 1,
    phaseEndsAt: null,
    you: { id: "me", name: "Tôi", ready: true, connected: true, role: "VILLAGER", alive: true },
    players: [],
    night: null,
    hasVoted: false,
    myVote: null,
    noEliminationVoteCount: 0,
    discussionSkip: null,
    votesRevealed: false,
    nightHistory: [],
    lastNightDeaths: [],
    lastEliminated: null,
    winner: null,
    chatLog: [],
    log: [],
    ...over,
  };
}

describe("cuesFor", () => {
  it("snapshot đầu tiên không phát gì: vào phòng hay nối lại đều im lặng", () => {
    assert.deepEqual(cuesFor(null, snapshot({ phase: "NIGHT", round: 1 })), []);
  });

  it("nhận lại đúng snapshot cũ thì không phát gì", () => {
    const view = snapshot({ phase: "NIGHT_RESULT", lastNightDeaths: [{ playerId: "a", name: "A" }] });
    assert.deepEqual(cuesFor(view, view), []);
  });

  it("hú khi trời vào đêm", () => {
    const before = snapshot({ phase: "DAY_DISCUSSION", round: 1 });
    const after = snapshot({ phase: "NIGHT", round: 2 });
    assert.deepEqual(cuesFor(before, after), ["howl"]);
  });

  it("báo khi tới lượt hành động của chính mình", () => {
    const before = snapshot({ phase: "NIGHT", round: 2, night: { canAct: false, acted: false } });
    const after = snapshot({ phase: "NIGHT", round: 2, night: { canAct: true, acted: false } });
    assert.deepEqual(cuesFor(before, after), ["turn"]);
  });

  it("có người chết trong đêm", () => {
    const before = snapshot({ phase: "NIGHT", round: 2 });
    const after = snapshot({
      phase: "NIGHT_RESULT",
      round: 2,
      lastNightDeaths: [{ playerId: "a", name: "A" }],
    });
    assert.deepEqual(cuesFor(before, after), ["death"]);
  });

  it("đêm bình yên thì không có tiếng chết", () => {
    const before = snapshot({ phase: "NIGHT", round: 2 });
    const after = snapshot({ phase: "NIGHT_RESULT", round: 2, lastNightDeaths: [] });
    assert.deepEqual(cuesFor(before, after), []);
  });

  it("có người bị treo cổ", () => {
    const before = snapshot({ phase: "VOTING", round: 2 });
    const after = snapshot({
      phase: "ELIMINATION",
      round: 2,
      lastEliminated: { playerId: "a", name: "A" },
    });
    assert.deepEqual(cuesFor(before, after), ["death"]);
  });

  it("hoà phiếu không treo ai thì im lặng", () => {
    const before = snapshot({ phase: "VOTING", round: 2 });
    const after = snapshot({ phase: "ELIMINATION", round: 2, lastEliminated: null });
    assert.deepEqual(cuesFor(before, after), []);
  });

  it("xác nhận khi chính mình vừa bỏ phiếu", () => {
    const before = snapshot({ phase: "VOTING", hasVoted: false });
    const after = snapshot({ phase: "VOTING", hasVoted: true });
    assert.deepEqual(cuesFor(before, after), ["ballot"]);
  });

  it("thắng khi phe mình thắng", () => {
    const before = snapshot({ phase: "ELIMINATION", round: 3 });
    const after = snapshot({ phase: "GAME_OVER", round: 3, winner: "village" });
    assert.deepEqual(cuesFor(before, after), ["win"]);
  });

  it("thua khi phe kia thắng", () => {
    const before = snapshot({ phase: "ELIMINATION", round: 3 });
    const after = snapshot({ phase: "GAME_OVER", round: 3, winner: "wolves" });
    assert.deepEqual(cuesFor(before, after), ["lose"]);
  });

  it("sói thắng thì chính sói nghe tiếng thắng", () => {
    const wolf = { id: "me", name: "Tôi", ready: true, connected: true, role: "WEREWOLF" as const, alive: true };
    const before = snapshot({ phase: "ELIMINATION", round: 3, you: wolf });
    const after = snapshot({ phase: "GAME_OVER", round: 3, winner: "wolves", you: wolf });
    assert.deepEqual(cuesFor(before, after), ["win"]);
  });

  it("không biết vai của mình thì không phát tiếng kết cục", () => {
    const nobody = { id: "me", name: "Tôi", ready: true, connected: true, alive: true };
    const before = snapshot({ phase: "ELIMINATION", round: 3, you: nobody });
    const after = snapshot({ phase: "GAME_OVER", round: 3, winner: "village", you: nobody });
    assert.deepEqual(cuesFor(before, after), []);
  });

  it("nối lại giữa pha kết quả đêm không phát lại tiếng chết", () => {
    const view = snapshot({
      phase: "NIGHT_RESULT",
      round: 2,
      lastNightDeaths: [{ playerId: "a", name: "A" }],
    });
    const resync = snapshot({
      phase: "NIGHT_RESULT",
      round: 2,
      lastNightDeaths: [{ playerId: "a", name: "A" }],
    });
    assert.deepEqual(cuesFor(view, resync), []);
  });

  it("cùng một pha ở vòng sau vẫn là cạnh mới", () => {
    const before = snapshot({ phase: "NIGHT", round: 2 });
    const after = snapshot({ phase: "NIGHT", round: 3 });
    assert.deepEqual(cuesFor(before, after), ["howl"]);
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó đỏ**

Run: `npm run test --workspace @masoi/web`
Expected: FAIL, không tìm thấy module `./audio-cues`.

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `apps/web/src/lib/audio-cues.ts`:

```ts
"use client";

import { roleTeam, type RoomSnapshot } from "@masoi/shared";

export type Cue = "howl" | "turn" | "death" | "ballot" | "win" | "lose";

/**
 * Tiếng cần phát khi snapshot đổi.
 *
 * Mọi tiếng định nghĩa theo CẠNH giữa hai snapshot chứ không theo trạng thái
 * của snapshot mới. Server chỉ gửi snapshot, không có luồng sự kiện, nên xét
 * theo trạng thái sẽ khiến mỗi lần resync sau khi rớt mạng phát lại tiếng của
 * việc đã xảy ra từ lâu.
 *
 * Thứ tự trả về cố định theo thứ tự khai báo bên dưới để test khẳng định được.
 */
export function cuesFor(prev: RoomSnapshot | null, next: RoomSnapshot): Cue[] {
  // Chưa có snapshot trước thì không có cạnh nào để so.
  if (!prev) return [];

  const cues: Cue[] = [];
  const changed = prev.round !== next.round || prev.phase !== next.phase;

  if (changed && next.phase === "NIGHT") cues.push("howl");
  // canAct của Phù Thuỷ lật sang true đúng lúc bầy Sói chốt phiếu, nên luật
  // chung này tự đúng với lượt đi sau của cô ta mà không cần nhánh riêng.
  if (prev.night?.canAct !== true && next.night?.canAct === true) cues.push("turn");
  if (changed && diedThisPhase(next)) cues.push("death");
  if (!prev.hasVoted && next.hasVoted) cues.push("ballot");

  const role = next.you?.role;
  if (changed && next.phase === "GAME_OVER" && next.winner && role) {
    cues.push(roleTeam(role) === next.winner ? "win" : "lose");
  }

  return cues;
}

function diedThisPhase(view: RoomSnapshot): boolean {
  if (view.phase === "NIGHT_RESULT") return view.lastNightDeaths.length > 0;
  if (view.phase === "ELIMINATION") return view.lastEliminated !== null;
  return false;
}
```

- [ ] **Step 4: Chạy lại test**

Run: `npm run test --workspace @masoi/web`
Expected: PASS toàn bộ, gồm cả các test của Task 1.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/audio-cues.ts apps/web/src/lib/audio-cues.test.ts
git commit -m "feat: derive sound cues from consecutive snapshots"
```

---

### Task 3: Thiết lập âm lượng lưu trong localStorage

**Files:**
- Create: `apps/web/src/lib/audio-settings.ts`
- Test: `apps/web/src/lib/audio-settings.test.ts`

**Interfaces:**
- Produces: `AudioSettings` (`{ musicVolume: number; sfxVolume: number; muted: boolean }`), `DEFAULT_SETTINGS`, `loadSettings(): AudioSettings`, `saveSettings(settings: AudioSettings): void`.

- [ ] **Step 1: Viết test thất bại**

Node không có `localStorage`, nên test tự dựng một cái giả và gắn vào `globalThis`. Tạo `apps/web/src/lib/audio-settings.test.ts`:

```ts
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./audio-settings";

function useStorage(store: Map<string, string>, failing = false) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => {
        if (failing) throw new Error("bị chặn");
        return store.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (failing) throw new Error("bị chặn");
        store.set(key, value);
      },
    },
  });
}

describe("audio settings", () => {
  beforeEach(() => useStorage(new Map()));

  it("chưa lưu gì thì trả mặc định", () => {
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  });

  it("mặc định là nhạc nhỏ hơn hiệu ứng rõ rệt", () => {
    assert.equal(DEFAULT_SETTINGS.musicVolume, 0.4);
    assert.equal(DEFAULT_SETTINGS.sfxVolume, 0.8);
    assert.equal(DEFAULT_SETTINGS.muted, false);
  });

  it("ghi rồi đọc lại khớp", () => {
    saveSettings({ musicVolume: 0.1, sfxVolume: 0.9, muted: true });
    assert.deepEqual(loadSettings(), { musicVolume: 0.1, sfxVolume: 0.9, muted: true });
  });

  it("dùng đúng khoá masoi.audio", () => {
    const store = new Map<string, string>();
    useStorage(store);
    saveSettings({ musicVolume: 0.5, sfxVolume: 0.5, muted: false });
    assert.ok(store.has("masoi.audio"));
  });

  it("kẹp giá trị ra ngoài khoảng 0..1", () => {
    const store = new Map<string, string>();
    store.set("masoi.audio", JSON.stringify({ musicVolume: 5, sfxVolume: -3, muted: false }));
    useStorage(store);
    assert.deepEqual(loadSettings(), { musicVolume: 1, sfxVolume: 0, muted: false });
  });

  it("giá trị hỏng thì quay về mặc định của riêng trường đó", () => {
    const store = new Map<string, string>();
    store.set("masoi.audio", JSON.stringify({ musicVolume: "to lên", muted: true }));
    useStorage(store);
    assert.deepEqual(loadSettings(), {
      musicVolume: DEFAULT_SETTINGS.musicVolume,
      sfxVolume: DEFAULT_SETTINGS.sfxVolume,
      muted: true,
    });
  });

  it("JSON hỏng thì trả mặc định chứ không ném", () => {
    const store = new Map<string, string>();
    store.set("masoi.audio", "{ không phải json");
    useStorage(store);
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
  });

  it("localStorage bị chặn thì đọc trả mặc định và ghi không ném", () => {
    useStorage(new Map(), true);
    assert.deepEqual(loadSettings(), DEFAULT_SETTINGS);
    assert.doesNotThrow(() => saveSettings(DEFAULT_SETTINGS));
  });
});
```

- [ ] **Step 2: Chạy test để chắc chắn nó đỏ**

Run: `npm run test --workspace @masoi/web`
Expected: FAIL, không tìm thấy module `./audio-settings`.

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `apps/web/src/lib/audio-settings.ts`:

```ts
"use client";

const KEY = "masoi.audio";

export interface AudioSettings {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
}

/** Nhạc thấp hơn hiệu ứng rõ rệt để tiếng báo lượt không bị nhạc nuốt. */
export const DEFAULT_SETTINGS: AudioSettings = {
  musicVolume: 0.4,
  sfxVolume: 0.8,
  muted: false,
};

function clamp(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

export function loadSettings(): AudioSettings {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    return {
      musicVolume: clamp(parsed.musicVolume, DEFAULT_SETTINGS.musicVolume),
      sfxVolume: clamp(parsed.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
      muted: parsed.muted === true,
    };
  } catch {
    // Safari chế độ riêng tư ném ngay ở getItem; mất thiết lập còn hơn vỡ trang.
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AudioSettings): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* không lưu được thì thôi, phiên này vẫn nghe đúng âm lượng */
  }
}
```

- [ ] **Step 4: Chạy lại test**

Run: `npm run test --workspace @masoi/web`
Expected: PASS toàn bộ.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/audio-settings.ts apps/web/src/lib/audio-settings.test.ts
git commit -m "feat: persist audio volume settings"
```

---

### Task 4: Engine phát nhạc và hiệu ứng

Không có unit test, đúng như spec: mọi thứ quyết định được đã nằm ở Task 1–3, phần còn lại chỉ là gọi `HTMLAudioElement` nên test nó sẽ là test cái mock của chính mình.

**Files:**
- Create: `apps/web/src/lib/audio-engine.ts`
- Create: `apps/web/public/audio/README.md`

**Interfaces:**
- Consumes: `Track` từ `./audio-track`, `Cue` từ `./audio-cues`, `AudioSettings` và `DEFAULT_SETTINGS` từ `./audio-settings`.
- Produces: `audioEngine` với `unlock()`, `isUnlocked()`, `onUnlock(listener: () => void): () => void`, `setTrack(track: Track | null)`, `playCue(cue: Cue)`, `applySettings(settings: AudioSettings)`, `stop()`; và `installUnlockListener(): () => void`.

- [ ] **Step 1: Viết hợp đồng file cho asset**

Tạo `apps/web/public/audio/README.md`:

```markdown
# File âm thanh

Bỏ file vào đúng đường dẫn dưới đây. Thiếu file nào thì phần đó im lặng, game vẫn chạy bình thường.

| Đường dẫn | Yêu cầu |
| --- | --- |
| `music/night.mp3` | loop 60–120s, u ám, chậm |
| `music/day.mp3` | loop 60–120s, căng thẳng vừa, dùng cho cả phòng chờ |
| `music/vote.mp3` | loop 60–120s, dồn dập |
| `sfx/howl.mp3` | dưới 2s, sói hú |
| `sfx/turn.mp3` | dưới 1s, nhẹ, nghe nhiều lần mỗi ván |
| `sfx/death.mp3` | dưới 2s |
| `sfx/ballot.mp3` | dưới 1s |
| `sfx/win.mp3` | dưới 3s |
| `sfx/lose.mp3` | dưới 3s |

Chỉ dùng file có giấy phép cho phép dùng thương mại (CC0 hoặc royalty-free).

Ba file nhạc nên cùng một bộ để không lệch tông khi chuyển pha, và phải trộn sẵn
cho nhỏ hơn hiệu ứng rõ rệt. Chọn nhạc ambient không có nhịp trống rõ: bộ mã hoá
mp3 chèn một khoảng lặng ở đầu file nên chỗ nối vòng lặp luôn hở một vết nhỏ, và
nhạc không nhịp sẽ giấu được vết đó.

Tổng dung lượng nên dưới 6MB vì người chơi mobile phải tải.
```

- [ ] **Step 2: Viết engine**

Tạo `apps/web/src/lib/audio-engine.ts`:

```ts
"use client";

import type { Cue } from "./audio-cues";
import type { Track } from "./audio-track";
import { DEFAULT_SETTINGS, type AudioSettings } from "./audio-settings";

const MUSIC_SRC: Record<Track, string> = {
  night: "/audio/music/night.mp3",
  day: "/audio/music/day.mp3",
  vote: "/audio/music/vote.mp3",
};

const SFX_SRC: Record<Cue, string> = {
  howl: "/audio/sfx/howl.mp3",
  turn: "/audio/sfx/turn.mp3",
  death: "/audio/sfx/death.mp3",
  ballot: "/audio/sfx/ballot.mp3",
  win: "/audio/sfx/win.mp3",
  lose: "/audio/sfx/lose.mp3",
};

const FADE_MS = 600;
const FADE_STEPS = 20;

let settings: AudioSettings = DEFAULT_SETTINGS;
let unlocked = false;
/** Track đang phát. */
let current: Track | null = null;
/** Track muốn phát; khác current khi trình duyệt còn chặn autoplay. */
let wanted: Track | null = null;
let fadeTimer: ReturnType<typeof setInterval> | null = null;

const elements = new Map<Track, HTMLAudioElement>();
const broken = new Set<string>();
const unlockListeners = new Set<() => void>();

function musicTarget(): number {
  return settings.muted ? 0 : settings.musicVolume;
}

/** null khi file thiếu hoặc hỏng: gọi lại cũng vô ích nên không thử lại. */
function element(track: Track): HTMLAudioElement | null {
  const src = MUSIC_SRC[track];
  if (broken.has(src)) return null;

  const existing = elements.get(track);
  if (existing) return existing;

  const el = new Audio(src);
  el.loop = true;
  el.volume = 0;
  el.addEventListener("error", () => broken.add(src));
  elements.set(track, el);
  return el;
}

function fadeTo(track: Track | null): void {
  if (fadeTimer) clearInterval(fadeTimer);
  const from = current !== null ? element(current) : null;
  const to = track !== null ? element(track) : null;
  current = track;

  if (to && to !== from) {
    to.volume = 0;
    // play() gọi đồng bộ ngay tại đây: nếu fadeTo chạy trong stack của một cử
    // chỉ người dùng thì iOS mới cho phát. Đặt sau await là Safari chặn.
    void to.play().catch(() => undefined);
  }

  let step = 0;
  fadeTimer = setInterval(() => {
    step += 1;
    const ratio = Math.min(1, step / FADE_STEPS);
    if (from && from !== to) from.volume = musicTarget() * (1 - ratio);
    if (to) to.volume = musicTarget() * ratio;
    if (ratio < 1) return;

    if (fadeTimer) clearInterval(fadeTimer);
    fadeTimer = null;
    if (from && from !== to) {
      from.pause();
      from.currentTime = 0;
    }
  }, FADE_MS / FADE_STEPS);
}

export const audioEngine = {
  /** Gọi bên trong handler của cử chỉ người dùng, không bao giờ sau await. */
  unlock(): void {
    if (unlocked) return;
    unlocked = true;
    if (wanted !== null) fadeTo(wanted);
    for (const listener of unlockListeners) listener();
  },

  isUnlocked(): boolean {
    return unlocked;
  },

  onUnlock(listener: () => void): () => void {
    unlockListeners.add(listener);
    return () => unlockListeners.delete(listener);
  },

  setTrack(track: Track | null): void {
    wanted = track;
    // Chưa có cử chỉ nào thì chỉ ghi nhớ; unlock() sẽ phát track đang chờ.
    if (!unlocked || track === current) return;
    fadeTo(track);
  },

  playCue(cue: Cue): void {
    if (!unlocked || settings.muted || settings.sfxVolume === 0) return;
    const src = SFX_SRC[cue];
    if (broken.has(src)) return;

    // Mỗi lần một element mới để hai tiếng chồng nhau được.
    const el = new Audio(src);
    el.volume = settings.sfxVolume;
    el.addEventListener("error", () => broken.add(src));
    void el.play().catch(() => undefined);
  },

  applySettings(next: AudioSettings): void {
    settings = next;
    const el = current !== null ? element(current) : null;
    if (!el) return;

    if (settings.muted) {
      el.pause();
      return;
    }
    // Đang crossfade thì để interval tự đưa volume tới đích, đừng giẫm lên.
    if (!fadeTimer) el.volume = musicTarget();
    if (unlocked) void el.play().catch(() => undefined);
  },

  stop(): void {
    if (fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
    for (const el of elements.values()) {
      el.pause();
      el.currentTime = 0;
    }
    current = null;
    wanted = null;
  },
};

/**
 * Mở khoá ở cú chạm đầu tiên bất kỳ trên trang, nhờ vậy không cần bắt người
 * chơi bấm thêm một nút "bật tiếng" riêng. Trả về hàm gỡ listener.
 */
export function installUnlockListener(): () => void {
  if (typeof document === "undefined") return () => undefined;

  const remove = (): void => {
    document.removeEventListener("pointerdown", onGesture);
    document.removeEventListener("keydown", onGesture);
  };
  function onGesture(): void {
    audioEngine.unlock();
    remove();
  }

  document.addEventListener("pointerdown", onGesture);
  document.addEventListener("keydown", onGesture);
  return remove;
}
```

- [ ] **Step 3: Kiểm biên dịch**

Run: `npm run lint --workspace @masoi/web`
Expected: không có output, tức `tsc --noEmit` sạch.

- [ ] **Step 4: Kiểm build production**

Engine chạy ở client nhưng module vẫn bị Next nạp lúc build, nên phải chắc chắn không có lời gọi DOM nào ở mức module.

Run: `npm run build --workspace @masoi/web`
Expected: `Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/audio-engine.ts apps/web/public/audio/README.md
git commit -m "feat: add audio playback engine"
```

---

### Task 5: Nối snapshot vào engine

**Files:**
- Create: `apps/web/src/lib/useGameAudio.ts`
- Modify: `apps/web/src/app/room/[code]/page.tsx`

**Interfaces:**
- Consumes: `audioEngine`, `installUnlockListener` từ `./audio-engine`; `cuesFor`; `trackFor`; `loadSettings`.
- Produces: `export function useGameAudio(snapshot: RoomSnapshot | null): void`.

- [ ] **Step 1: Viết hook**

Tạo `apps/web/src/lib/useGameAudio.ts`:

```ts
"use client";

import { useEffect, useRef } from "react";
import type { RoomSnapshot } from "@masoi/shared";
import { cuesFor } from "./audio-cues";
import { audioEngine, installUnlockListener } from "./audio-engine";
import { loadSettings } from "./audio-settings";
import { trackFor } from "./audio-track";

/**
 * Nối snapshot của phòng vào engine âm thanh.
 *
 * Giữ snapshot trước trong ref chứ không phải state: nó chỉ là đầu vào để so
 * cạnh, đổi nó không cần render lại. Ref cũng sống xuyên qua lần rớt mạng, nhờ
 * vậy resync giữa pha không sinh cạnh nào và không phát lại tiếng cũ.
 */
export function useGameAudio(snapshot: RoomSnapshot | null): void {
  const previous = useRef<RoomSnapshot | null>(null);

  useEffect(() => {
    audioEngine.applySettings(loadSettings());
    const removeUnlock = installUnlockListener();
    return () => {
      removeUnlock();
      audioEngine.stop();
      previous.current = null;
    };
  }, []);

  useEffect(() => {
    if (!snapshot) return;
    audioEngine.setTrack(trackFor(snapshot.phase));
    for (const cue of cuesFor(previous.current, snapshot)) {
      audioEngine.playCue(cue);
    }
    previous.current = snapshot;
  }, [snapshot]);
}
```

- [ ] **Step 2: Gọi hook trong trang phòng**

Trong `apps/web/src/app/room/[code]/page.tsx`, thêm import:

```tsx
import { useGameAudio } from "@/lib/useGameAudio";
```

Rồi gọi hook ngay sau dòng `const snapshot = room.snapshot;`:

```tsx
  const snapshot = room.snapshot;
  useGameAudio(snapshot);
```

- [ ] **Step 3: Kiểm biên dịch**

Run: `npm run lint --workspace @masoi/web`
Expected: không có output.

- [ ] **Step 4: Chạy tay để nghe thử**

Cần server chạy được (`npm run dev:infra` rồi `npm run dev:server`), và `npm run dev:web`.

Nếu chưa có file nhạc nào trong `public/audio/` thì bước này chỉ xác nhận **không có lỗi nào trong console** và game chạy bình thường — đó chính là hành vi đúng khi thiếu asset. Có file rồi thì kiểm: vào phòng thấy nhạc ngày, sang đêm thì đổi sang nhạc đêm kèm tiếng hú, và tải lại trang giữa pha thì không nghe lại tiếng cũ.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/useGameAudio.ts "apps/web/src/app/room/[code]/page.tsx"
git commit -m "feat: play music and cues from room snapshots"
```

---

### Task 6: Nút loa và hai thanh âm lượng

**Files:**
- Create: `apps/web/src/components/SoundControl.tsx`
- Modify: `apps/web/src/app/room/[code]/page.tsx`

**Interfaces:**
- Consumes: `audioEngine` từ `@/lib/audio-engine`; `AudioSettings`, `DEFAULT_SETTINGS`, `loadSettings`, `saveSettings` từ `@/lib/audio-settings`.
- Produces: `export function SoundControl(): JSX.Element`.

- [ ] **Step 1: Viết component**

Tạo `apps/web/src/components/SoundControl.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { audioEngine } from "@/lib/audio-engine";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AudioSettings,
} from "@/lib/audio-settings";

export function SoundControl() {
  // Khởi tạo bằng mặc định chứ không đọc localStorage ngay: server render
  // không có localStorage, đọc ở đây sẽ lệch giữa server và client.
  const [settings, setSettings] = useState<AudioSettings>(DEFAULT_SETTINGS);
  const [unlocked, setUnlocked] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
    setUnlocked(audioEngine.isUnlocked());
    return audioEngine.onUnlock(() => setUnlocked(true));
  }, []);

  function update(patch: Partial<AudioSettings>): void {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    audioEngine.applySettings(next);
  }

  return (
    <div className="relative">
      <button
        className={`rounded-lg border border-night-600 bg-night-800 px-2 py-1 text-sm ${
          unlocked ? "text-mist" : "text-mist/40"
        }`}
        onClick={() => setOpen((value) => !value)}
        title={unlocked ? "Âm thanh" : "Chạm vào màn hình để bật tiếng"}
      >
        {settings.muted ? "🔇" : "🔊"}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-56 rounded-xl border border-night-600 bg-night-900 p-3 shadow-lg">
          <button
            className="mb-2 w-full rounded-lg bg-night-800 px-2 py-1 text-xs text-mist"
            onClick={() => update({ muted: !settings.muted })}
          >
            {settings.muted ? "Bật tiếng" : "Tắt tiếng"}
          </button>

          <label className="block text-xs text-mist/70">
            Nhạc nền
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.musicVolume}
              onChange={(event) => update({ musicVolume: Number(event.target.value) })}
              className="mt-1 w-full"
            />
          </label>

          <label className="mt-2 block text-xs text-mist/70">
            Hiệu ứng
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.sfxVolume}
              onChange={(event) => update({ sfxVolume: Number(event.target.value) })}
              className="mt-1 w-full"
            />
          </label>

          {!unlocked && (
            <p className="mt-2 text-[10px] text-mist/50">
              Trình duyệt chặn tiếng cho tới khi bạn chạm vào trang.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Gắn vào header phòng**

Trong `apps/web/src/app/room/[code]/page.tsx`, thêm import:

```tsx
import { SoundControl } from "@/components/SoundControl";
```

Rồi đặt nút ngay trước khối `{!room.connected && (` trong header:

```tsx
          <SoundControl />
          {!room.connected && (
```

- [ ] **Step 3: Kiểm biên dịch và build**

Run: `npm run lint --workspace @masoi/web && npm run build --workspace @masoi/web`
Expected: `tsc` sạch và `Compiled successfully`.

- [ ] **Step 4: Chạy tay để kiểm điều khiển**

Vào một phòng và kiểm bốn việc: kéo thanh nhạc thì âm lượng đổi ngay trong lúc kéo; bấm tắt tiếng thì nhạc im nhưng hiệu ứng cũng im; tải lại trang thì mức âm lượng giữ nguyên; và trước cú chạm đầu tiên nút loa hiện mờ.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/SoundControl.tsx "apps/web/src/app/room/[code]/page.tsx"
git commit -m "feat: add sound control with separate music and sfx volume"
```

---

## Kiểm cuối trước khi kết thúc

- [ ] `npm run test --workspace @masoi/web` xanh.
- [ ] `npm run lint` xanh cả web lẫn server.
- [ ] `npm run build` xanh.
- [ ] Không có dependency mới nào trong `apps/web/package.json`.
