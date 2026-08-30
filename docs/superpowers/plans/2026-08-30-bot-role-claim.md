# BOT AI Phase 5 — Khai vai trong chat và mô hình uy tín của làng: Kế hoạch cài đặt

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho BOT tự nhận vai trong khung chat và cho phe làng một cách phân xử lời khai đó, để thông tin của Tiên Tri truyền được sang người khác thay vì chết cùng người giữ nó.

**Architecture:** Lời khai là một speech act thật, đi ra bằng **chữ** qua đúng khung chat mà người thật dùng, và các BOT khác nạp lại bằng đúng parser tiếng Việt đang có (`chat-analysis`). Câu chữ do LLM viết nhưng bị một cổng hai chiều gác: chạy chính parser đó lên câu vừa nhận, không đọc ngược ra đúng vai đã chốt thì vứt và dùng bảng mẫu. Uy tín của một lời khai **không phải một con số trôi nổi** mà là một chuỗi bằng chứng, mỗi mảnh neo vào một sự kiện công khai có thật (lời khai, cái chết đêm, recap phiếu) và phát ra đúng lúc sự kiện đó xảy ra.

**Tech Stack:** TypeScript, npm workspaces (`@masoi/shared`, `@masoi/game-engine`, `@masoi/server`, `@masoi/web`), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-bot-role-claim-design.md` — đọc kèm. Kế hoạch này lập luận từ spec đó; mọi §N dưới đây trỏ về nó.

## Global Constraints

Mỗi task **ngầm định** mang theo toàn bộ mục này.

- **Nhánh.** Toàn bộ việc này nằm trên nhánh `feat/bot-role-claim`, tách từ `45f9043`. Không bao giờ làm thẳng trên `main` — `main` là cò súng deploy.
- **Lõi engine phải thuần.** Không I/O, không `Date.now()`, không `Math.random()` trong `packages/game-engine/src/bot/**`. RNG duy nhất là `BotRng` được truyền vào.
- **Không có bằng chứng không nguồn.** Mọi `BotEvidence.sourceId` phải nằm trong `state.seenEventIds`, nếu không `validateEvidence` ném. Bằng chứng sinh muộn **neo vào sự kiện mới**, không neo vào message id của lời khai gốc (`seenEventIds` có trần, xem spec A5).
- **Nhà cung cấp chỉ diễn đạt.** LLM không bao giờ chọn mục tiêu, speech act, bằng chứng, hay vai được khai. `BotSpeechIntention.reason` **không bao giờ** vào prompt.
- **Uy tín mù vai thật.** `claim-credibility.ts` không import và không đọc `knowledge.knownRoles` hay `state.knownInformation`.
- **Tái lập.** Preset `1.0.0`, `2.0.0`, `3.0.0` phải tái lập **từng bit**. Mọi nhánh mới thoát ra **trước khi rút bất kỳ số ngẫu nhiên nào** khi `claim.accusationWeight === 0`.
- **Đổi một giá trị trong `BotWeights` là phải đổi `version`.**
- **Lint từ gốc:** `npm run lint` ở thư mục gốc. Chạy `npm run lint --workspace @masoi/game-engine` trực tiếp sẽ bỏ qua `prelint` (build:deps) và báo lỗi giả do `packages/shared/dist` cũ.
- **Mốc test nền tại `45f9043`:** engine 815 / server 510 / web 145 = 1.470, 0 đỏ. Mọi task phải để suite xanh trước khi sang task sau.

---

## Bản đồ file

| File | Trách nhiệm | Task |
| --- | --- | --- |
| `packages/game-engine/src/bot/config/weights.ts` | nhóm `claim`, preset `4.0.0`, kiểm hợp lệ | 1 |
| `packages/game-engine/src/bot/config/presets.ts` | đăng ký `4.0.0` | 1 |
| `packages/game-engine/src/bot/types.ts` | 2 speech kind, `claimedRole`, `myClaim` | 2, 3 |
| `packages/game-engine/src/bot/conversation/templates.ts` | mẫu câu khai / phản bác, đọc ngược được | 2 |
| `packages/game-engine/src/bot/evaluation/selfplay.ts` | nhánh render tối giản cho 2 kind mới | 2 |
| `apps/server/src/bots/prompt.ts` | câu dẫn 2 kind mới; bỏ `roleContext` khỏi bào chữa | 2, 8 |
| `packages/game-engine/src/bot/memory/memory-store.ts` | `myClaim: null` lúc khởi tạo | 3 |
| `packages/game-engine/src/bot/decision/claim-decision.ts` | khai hay không, vai gì, kiểu gì | 3 |
| `packages/game-engine/src/bot/conversation/speech-planner.ts` | nhánh claim; `holdSeerEvidence` đổi điều kiện | 4 |
| `packages/game-engine/src/bot/BotRuntime.ts` | ghi `myClaim`; gọi `claim-credibility` | 4, 6 |
| `apps/server/src/bots/speech-renderer.ts` | cổng `CLAIM_INTEGRITY` | 5 |
| `packages/game-engine/src/bot/analysis/claim-credibility.ts` | **mới** — 4 tín hiệu → bằng chứng | 6 |
| `packages/game-engine/src/bot/evaluation/metrics.ts` | 4 chỉ số claim | 7 |
| `apps/server/src/bots/{types,decide,gemini-brain,openai-compat-brain,fallback-brain}.ts` | pha bào chữa về lõi | 8 |
| `docs/bot-ai-phase-5-verification.md` | **mới** — văn bản kiểm chứng | 9 |

---

### Task 1: Nhóm trọng số `claim` và preset 4.0.0 — cổng tái lập

Đây là **một cái cổng, không phải một bước**. Nó không đổi hành vi nào: nó chỉ thêm một nhóm trọng số bằng 0 ở mọi preset cũ. Nếu test vân tay v1/v3 đỏ ở đây thì mọi số liệu cân bằng lịch sử mất giá trị so sánh, và không được đi tiếp cho tới khi nó xanh.

**Files:**
- Modify: `packages/game-engine/src/bot/config/weights.ts`
- Modify: `packages/game-engine/src/bot/config/presets.ts`
- Test: `packages/game-engine/tests/bot-weights.test.ts`

**Interfaces:**
- Consumes: — (task đầu)
- Produces: `ClaimWeights` interface; `BotWeights.claim: ClaimWeights`; `BOT_WEIGHTS_V4: BotWeights` với `version === "4.0.0"`. Mọi task sau đọc `weights.claim.*`.

- [ ] **Step 1: Tạo nhánh**

```bash
git checkout -b feat/bot-role-claim
git log --oneline -1   # phải là 45f9043 hoặc commit spec ở trên nó
```

- [ ] **Step 2: Viết test thất bại**

Thêm vào cuối `packages/game-engine/tests/bot-weights.test.ts`:

```ts
describe("nhóm trọng số claim", () => {
  it("tắt ở mọi preset cũ, nên v1/v2/v3 không đổi hành vi", () => {
    for (const preset of [BOT_WEIGHTS_V1, BOT_WEIGHTS_V2, BOT_WEIGHTS_V3]) {
      expect(preset.claim.accusationWeight).toBe(0);
      expect(preset.claim.wolfBluffChance).toBe(0);
    }
  });

  it("v4 bật cơ chế lên và mang đúng version", () => {
    expect(BOT_WEIGHTS_V4.version).toBe("4.0.0");
    expect(BOT_WEIGHTS_V4.claim.accusationWeight).toBeGreaterThan(0);
  });

  it("v4 khác v3 ĐÚNG ở nhóm claim và version", () => {
    for (const key of Object.keys(BOT_WEIGHTS_V3) as Array<keyof typeof BOT_WEIGHTS_V3>) {
      if (key === "version" || key === "claim") continue;
      expect(BOT_WEIGHTS_V4[key]).toBe(BOT_WEIGHTS_V3[key]);
    }
  });

  it("validateWeights bắt được hệ số ngoài [0,1]", () => {
    expect(() =>
      validateWeights({ ...BOT_WEIGHTS_V4, claim: { ...BOT_WEIGHTS_V4.claim, underFireFactor: 1.5 } }),
    ).toThrow();
  });
});
```

Sửa dòng import ở đầu file để thêm `BOT_WEIGHTS_V4`.

- [ ] **Step 3: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/bot-weights.test.ts --root packages/game-engine`
Expected: FAIL — `BOT_WEIGHTS_V4` chưa tồn tại (lỗi biên dịch/import).

- [ ] **Step 4: Khai báo `ClaimWeights`**

Thêm vào `weights.ts`, ngay trên `export interface BotWeights`:

```ts
/**
 * Lời khai vai và cách làng phân xử nó.
 *
 * `accusationWeight === 0` TẮT toàn bộ cơ chế, và nó là cổng DUY NHẤT — mọi
 * nhánh mới đều hỏi đúng nó rồi thoát ra trước khi rút số ngẫu nhiên. Tắt bằng
 * một giá trị ngoài miền có ích thay vì bằng một cờ boolean là đúng thói quen
 * đã có ở `deceptionRisk.bussingVoteShare`.
 *
 * Sức nặng ở đây nằm trên thang belief THẬT, nơi p90 ≈ 1.8 (xem
 * `docs/bot-ai-phase-3-verification.md` §4), không phải thang 0–100 trên giấy.
 * Đó chính là lỗi đã giết v1, nên đừng đọc những con số này như phần trăm.
 */
export interface ClaimWeights {
  /** Nghi ngờ dồn lên người bị một lời khai chỉ mặt. `0` TẮT cả cơ chế. */
  accusationWeight: number;
  /** Tin tưởng cộng cho chính người khai, trước khi nhân hệ số thời điểm. */
  claimantTrustWeight: number;
  /** Nhân vào cả hai giá trị trên khi lời khai bật ra lúc người khai đang dẫn phiếu. */
  underFireFactor: number;
  /** Nghi ngờ cộng cho CẢ HAI người cùng khai một vai. */
  collisionPenalty: number;
  /** Nhân thêm cho người khai ĐẾN SAU trong một cú va chạm. `>= 1`. */
  collisionLatePenaltyScale: number;
  /** Người khai vai chức năng chết ngay đêm sau: thưởng tin tưởng. */
  nightConfirmBonus: number;
  /** Người khai còn sống trong khi người khác chết đêm đó: phạt tin tưởng. */
  nightSurvivedPenalty: number;
  /** Khai "X là sói" mà vòng sau không bỏ phiếu X. */
  voteInconsistencyPenalty: number;
  /** Xác suất con Sói được chỉ định dám khai láo, trước khi nhân tính cách. */
  wolfBluffChance: number;
  /** Vòng sớm nhất Sói được khai láo chủ động. */
  wolfBluffFromRound: number;
}
```

Thêm `readonly claim: ClaimWeights;` vào `interface BotWeights`, ngay dưới `conversation`.

- [ ] **Step 5: Tắt nhóm này ở v1 (v2, v3 kế thừa qua spread)**

Thêm vào `BOT_WEIGHTS_V1`, ngay dưới nhóm `conversation`:

```ts
  /**
   * TẮT toàn bộ ở v1. v1 phải tái lập Phase 2 từng bit, và v2/v3 kế thừa nhóm
   * này nguyên vẹn qua spread nên chúng cũng tắt — đó là điều kiện để bảng
   * win-rate của Phase 3 và Phase 4 còn so sánh được với v4.
   *
   * `collisionLatePenaltyScale: 1` chứ không phải `0`: nó là một HỆ SỐ NHÂN,
   * và một hệ số nhân bằng 0 là một giá trị vô nghĩa nằm chờ ai đó bật
   * `collisionPenalty` lên rồi không hiểu vì sao không có gì xảy ra.
   */
  claim: Object.freeze({
    accusationWeight: 0,
    claimantTrustWeight: 0,
    underFireFactor: 0,
    collisionPenalty: 0,
    collisionLatePenaltyScale: 1,
    nightConfirmBonus: 0,
    nightSurvivedPenalty: 0,
    voteInconsistencyPenalty: 0,
    wolfBluffChance: 0,
    wolfBluffFromRound: 0,
  }),
```

- [ ] **Step 6: Thêm preset v4**

Ngay dưới `BOT_WEIGHTS_V3`:

```ts
/**
 * v4 — lời khai vai trong chat.
 *
 * Khác v3 ở ĐÚNG một nhóm: `claim`. Mọi nhóm còn lại dùng chung tham chiếu với
 * v3, nên chênh lệch win-rate giữa hai bản chỉ có đúng một nguyên nhân khả dĩ.
 *
 * Những con số này là GIÁ TRỊ KHỞI ĐẦU, không phải kết quả hiệu chỉnh. Task 7
 * đo `claimAccuracy` và `claimsPerGame` rồi chỉnh lại; đừng coi chúng là đã
 * chốt cho tới khi văn bản kiểm chứng nói vậy.
 *
 * - `accusationWeight: 12` — nặng gấp ba một `ACCUSE` trần (weight 4). Một lời
 *   khai đáng tin PHẢI lấn át tiếng ồn hành vi, nếu không cả cơ chế vô hình.
 * - `underFireFactor: 0.25` — khai lúc đang dẫn phiếu chỉ còn một phần tư sức
 *   nặng. Không về 0: người bị dồn oan vẫn có thể đang nói thật.
 * - `nightConfirmBonus` > `nightSurvivedPenalty` có chủ ý: chết sau khi khai là
 *   bằng chứng mạnh, còn sống sót thì mơ hồ vì Bảo Vệ bẻ gãy nó (spec §6.3).
 */
export const BOT_WEIGHTS_V4: BotWeights = Object.freeze({
  ...BOT_WEIGHTS_V3,
  version: "4.0.0",

  claim: Object.freeze({
    accusationWeight: 12,
    claimantTrustWeight: 6,
    underFireFactor: 0.25,
    collisionPenalty: 7,
    collisionLatePenaltyScale: 1.6,
    nightConfirmBonus: 14,
    nightSurvivedPenalty: 8,
    voteInconsistencyPenalty: 5,
    wolfBluffChance: 0.35,
    wolfBluffFromRound: 2,
  }),
});
```

- [ ] **Step 7: Nối vào bộ kiểm hợp lệ**

Trong `UNIT_INTERVAL_FIELDS`, thêm ở cuối mảng:

```ts
  // Hai cái này được so THẲNG với `rng()` hoặc nhân vào một sức nặng đã chuẩn
  // hoá. Một giá trị 1.5 ở đây không ném ở đâu cả, nó chỉ lặng lẽ làm sai.
  ["claim", "underFireFactor"],
  ["claim", "wolfBluffChance"],
```

Trong `REQUIRED_GROUPS`, thêm `"claim",` ở cuối.

- [ ] **Step 8: Đăng ký preset**

Trong `packages/game-engine/src/bot/config/presets.ts`, thêm `BOT_WEIGHTS_V4` vào import và thêm `"4.0.0": BOT_WEIGHTS_V4,` vào `BOT_WEIGHTS_PRESETS`.

- [ ] **Step 9: Chạy test nhóm, xác nhận xanh**

Run: `npx vitest run tests/bot-weights.test.ts --root packages/game-engine`
Expected: PASS.

- [ ] **Step 10: CỔNG — chạy toàn bộ suite engine**

Run: `npm test`
Expected: engine 815+4 = 819 pass, server 510, web 145. **0 đỏ.**
Nếu bất kỳ test vân tay nào (`wolfWins === 22` trên 24 ván trong `bot-weights.test.ts`) đỏ: **DỪNG LẠI.** Nghĩa là nhóm mới đã lọt vào một đường tính toán của preset cũ. Sửa cho v1/v3 trung tính trước khi đi tiếp.

- [ ] **Step 11: Commit**

```bash
git add packages/game-engine/src/bot/config/weights.ts packages/game-engine/src/bot/config/presets.ts packages/game-engine/tests/bot-weights.test.ts
git commit -m "feat(bot): add the claim weight group, off in every existing preset

Phase 5 needs a tuning surface before it needs behaviour. The group is
declared here and zeroed in v1, which v2 and v3 inherit by spread, so the
Phase 3 and Phase 4 win-rate tables stay comparable to v4.

accusationWeight is the single off switch: every new branch asks it and
returns before drawing a random number."
```

---

### Task 2: Hai speech act và mẫu câu đọc ngược được

Thêm `CLAIM_ROLE` và `COUNTER_CLAIM` vào union. Điều này sẽ **làm đỏ trình biên dịch ở ba chỗ** — `SPEECH_TEMPLATES` (Record đầy đủ), `intentLine()` (`never` check), `renderIntentionText()` (switch). Đó là tính năng, không phải phiền toái: nó chỉ ra đúng mọi chỗ phải bổ sung. Cả ba phải xong trong task này.

Chưa có gì phát ra hai kind này. Task này chỉ bảo đảm rằng **khi** có, câu chữ đọc ngược được.

**Files:**
- Modify: `packages/game-engine/src/bot/types.ts`
- Modify: `packages/game-engine/src/bot/conversation/templates.ts`
- Modify: `packages/game-engine/src/bot/evaluation/selfplay.ts:196-210`
- Modify: `apps/server/src/bots/prompt.ts:196-232`
- Test: `packages/game-engine/tests/bot-claim-speech.test.ts` (mới)

**Interfaces:**
- Consumes: `ClaimWeights` (Task 1) — chưa dùng ở đây.
- Produces: `BotSpeechKind` giờ gồm `"CLAIM_ROLE" | "COUNTER_CLAIM"`; `BotSpeechIntention.claimedRole?: Role`. Task 3, 4, 5 dựa vào cả hai.

- [ ] **Step 1: Viết test thất bại**

Tạo `packages/game-engine/tests/bot-claim-speech.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ROLES, ROLE_META, type Role } from "@masoi/shared";
import { analyzeChat } from "../src/bot/analysis/chat-analysis";
import { renderSpeechTemplate } from "../src/bot/conversation/templates";
import { BOT_SPEECH_TONES, type BotSpeechIntention } from "../src/bot/types";

const PLAYERS = [
  { id: "p1", name: "An", alive: true },
  { id: "p2", name: "Bình", alive: true },
];

function claimIntention(role: Role, kind: "CLAIM_ROLE" | "COUNTER_CLAIM"): BotSpeechIntention {
  return {
    kind,
    targetId: kind === "COUNTER_CLAIM" ? "p2" : undefined,
    claimedRole: role,
    topic: "ROLE_CLAIM",
    confidence: 0.8,
    evidence: [],
    tone: "FIRM",
  };
}

function render(intention: BotSpeechIntention, seq = 0): string {
  return renderSpeechTemplate({
    intention,
    targetName: intention.targetId ? "Bình" : null,
    replyToName: null,
    seedTag: "ROOM",
    botId: "p1",
    round: 1,
    seq,
  });
}

function claimedRoleIn(text: string): Role | undefined {
  const memories = analyzeChat([{ id: "m1", actorId: "p1", text, at: 0 }], PLAYERS);
  const claim = memories.find((memory) => memory.type === "ROLE_CLAIM");
  return claim?.data.role as Role | undefined;
}

describe("mẫu câu khai vai đọc ngược được", () => {
  // Đây là test chặn A4: hai bảng chữ tiếng Việt song song (ROLE_META và
  // ROLE_PHRASES) sẽ trôi lệch, và ngày đó lời khai của vai mới sẽ lặng lẽ
  // không ai đọc được. Quét TOÀN BỘ vai chứ không lấy mẫu.
  for (const role of ROLES) {
    it(`CLAIM_ROLE cho ${ROLE_META[role].name} quay về đúng vai đó`, () => {
      expect(claimedRoleIn(render(claimIntention(role, "CLAIM_ROLE")))).toBe(role);
    });
  }

  it("mọi giọng đều đọc ngược được, không chỉ giọng mặc định", () => {
    for (const tone of BOT_SPEECH_TONES) {
      const text = render({ ...claimIntention("SEER", "CLAIM_ROLE"), tone });
      expect(claimedRoleIn(text)).toBe("SEER");
    }
  });

  it("mọi mẫu trong bể đều đọc ngược được, không chỉ mẫu đầu", () => {
    for (let seq = 0; seq < 12; seq += 1) {
      expect(claimedRoleIn(render(claimIntention("WITCH", "CLAIM_ROLE"), seq))).toBe("WITCH");
    }
  });

  it("COUNTER_CLAIM sinh ra một phản bác nhắm đúng người", () => {
    const text = render(claimIntention("SEER", "COUNTER_CLAIM"));
    const memories = analyzeChat([{ id: "m1", actorId: "p1", text, at: 0 }], PLAYERS);
    const counter = memories.find((memory) => memory.type === "COUNTER_CLAIM");
    expect(counter?.targetId).toBe("p2");
    expect(counter?.data.role).toBe("SEER");
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/bot-claim-speech.test.ts --root packages/game-engine`
Expected: FAIL — `claimedRole` chưa có trên `BotSpeechIntention`, `"CLAIM_ROLE"` chưa thuộc `BotSpeechKind`.

- [ ] **Step 3: Nới union và thêm `claimedRole`**

Trong `types.ts`, thêm vào cuối mảng `BOT_SPEECH_KINDS` (trước `] as const;`):

```ts
  /**
   * Tự nhận vai. Hai kind này là ĐƯỜNG DUY NHẤT để một lời khai của BOT ra
   * khỏi lõi; không có đường nào khác, và cổng ở `speech-renderer` bảo đảm nhà
   * cung cấp không mở thêm được đường thứ hai.
   */
  "CLAIM_ROLE",
  "COUNTER_CLAIM",
```

Thêm vào `interface BotSpeechIntention`, dưới `topic`:

```ts
  /**
   * Vai được nói TO giữa phòng. Bắt buộc với `CLAIM_ROLE`/`COUNTER_CLAIM`, vô
   * nghĩa với mọi kind khác.
   *
   * KHÔNG phải vai thật: một con Sói khai láo mang `claimedRole: "SEER"`. Đây
   * cũng chính là lý do trường này an toàn để đưa vào prompt — nó là thứ sắp
   * được công bố, không phải thứ đang được giấu.
   */
  claimedRole?: Role;
```

`Role` đã được import sẵn ở đầu `types.ts`.

- [ ] **Step 4: Thêm bảng mẫu**

Trong `templates.ts`, thêm hai mục vào `SPEECH_TEMPLATES`. Đặt ngay sau mục `WITHHOLD`:

```ts
  /**
   * Hình dạng của những mẫu này bị PARSER ép, không phải do thẩm mỹ.
   *
   * `parseClause` chỉ nhận vai ở ĐẦU mệnh đề, ngay sau đúng chuỗi `"tôi là "`,
   * và nó GIẾT cả mệnh đề nếu thấy một từ phủ định. Nên câu khai phải là một
   * mệnh đề riêng, mở đầu bằng đúng ba chữ đó, và không được chứa "không",
   * "chưa", "chẳng", "chả" trong cùng mệnh đề. Lời nhấn mạnh phải nằm ở mệnh
   * đề KHÁC, sau một dấu câu.
   *
   * `{role}` do `fill()` thay bằng `ROLE_META[claimedRole].name` — cùng bảng
   * chữ mà giao diện đang hiển thị, nên không có bảng thứ hai để trôi lệch.
   */
  CLAIM_ROLE: {
    NEUTRAL: [
      "Tôi là {role}.",
      "Nói thật, tôi là {role}.",
      "Thôi được rồi. Tôi là {role}.",
      "Tôi là {role}, giờ nói ra đây.",
    ],
    FIRM: [
      "Tôi là {role}.",
      "Tôi là {role}, nghe cho rõ.",
      "Khỏi đoán nữa. Tôi là {role}.",
      "Tôi là {role}. Tin hay tuỳ mọi người.",
    ],
    TENSE: [
      "Tôi là {role}, đủ rồi đấy.",
      "Tôi là {role}. Ép tôi lộ ra thì đây.",
      "Được, tôi là {role}.",
      "Tôi là {role}, hài lòng chưa.",
    ],
    SOFT: [
      "Mình xin nói thật, tôi là {role}.",
      "Tôi là {role}, mình giấu nãy giờ.",
      "Thật ra tôi là {role}.",
      "Tôi là {role}. Mong mọi người nghe mình.",
    ],
    PLAYFUL: [
      "Lộ bài luôn: tôi là {role}.",
      "Tôi là {role} đây, bất ngờ chưa.",
      "Ừ thì tôi là {role}.",
      "Tôi là {role}, khai xong nhẹ cả người.",
    ],
    CURIOUS: [
      "Tôi là {role}. Ai tin tôi nào?",
      "Tôi là {role}, mọi người thấy sao?",
      "Tôi là {role}. Có ai muốn hỏi gì không.",
      "Tôi là {role} — giờ tính thế nào?",
    ],
  },

  /**
   * `parseCounterClaim` so trên CẢ tin nhắn và đòi hai mẩu cùng lúc:
   * `" không thể là "` rồi `"tôi mới là "`. Nó cũng là mẫu DUY NHẤT được phép
   * chứa từ phủ định, vì phủ định chính là nội dung của nó. Đừng đảo thứ tự
   * hai vế và đừng bỏ dấu phẩy.
   */
  COUNTER_CLAIM: {
    NEUTRAL: [
      "{target} không thể là {role}, tôi mới là {role}.",
      "Sai rồi, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} được, tôi mới là {role}.",
      "Nghe này: {target} không thể là {role}, tôi mới là {role}.",
    ],
    FIRM: [
      "{target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} đâu, tôi mới là {role}.",
      "Dừng lại. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role}, rõ chưa.",
    ],
    TENSE: [
      "{target} không thể là {role}, tôi mới là {role}.",
      "Láo. {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} nhé, tôi mới là {role}.",
      "Nó bịa đấy, {target} không thể là {role}, tôi mới là {role}.",
    ],
    SOFT: [
      "Mình tiếc, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} đâu ạ, tôi mới là {role}.",
      "Xin lỗi nhé, {target} không thể là {role}, tôi mới là {role}.",
      "Mình phải nói: {target} không thể là {role}, tôi mới là {role}.",
    ],
    PLAYFUL: [
      "Ơ hay, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role} nha, tôi mới là {role}.",
      "Cướp vai à? {target} không thể là {role}, tôi mới là {role}.",
      "Vui nhỉ. {target} không thể là {role}, tôi mới là {role}.",
    ],
    CURIOUS: [
      "{target} không thể là {role}, tôi mới là {role}. Tin ai đây?",
      "Lạ nhỉ, {target} không thể là {role}, tôi mới là {role}.",
      "{target} không thể là {role}, tôi mới là {role} — sao đây?",
      "{target} không thể là {role}, tôi mới là {role}. Mọi người xử đi.",
    ],
  },
```

- [ ] **Step 5: Dạy `fill()` chỗ trống `{role}`**

Tìm hàm `fill` trong `templates.ts` và thêm phép thay thế thứ tư. Nó **phải** dùng `ROLE_META`, không được có bảng chữ riêng:

```ts
    .replaceAll("{role}", request.intention.claimedRole
      ? ROLE_META[request.intention.claimedRole].name
      : "dân làng")
```

Thêm `import { ROLE_META } from "@masoi/shared";` vào đầu file. Nhánh lui `"dân làng"` không bao giờ chạy khi lõi đúng — `claimedRole` luôn có mặt với hai kind này — nhưng một chuỗi `undefined` lọt ra phòng thì tệ hơn nhiều so với một câu vô hại.

- [ ] **Step 6: Nhánh render tối giản cho self-play**

Trong `selfplay.ts`, thêm vào `switch (speech.kind)` của `renderIntentionText`, ngay trước `default`:

```ts
    case "CLAIM_ROLE":
      return `Tôi là ${speech.claimedRole ?? "dân làng"}.`;
    case "COUNTER_CLAIM":
      return `${target} không thể là ${speech.claimedRole ?? "dân làng"}, tôi mới là ${speech.claimedRole ?? "dân làng"}.`;
```

- [ ] **Step 7: Câu dẫn prompt**

Trong `apps/server/src/bots/prompt.ts`, thêm vào `switch` của `intentLine`, trước `default`:

```ts
    case "CLAIM_ROLE":
      return [
        `Bạn công khai nhận mình là ${roleName(request.intention.claimedRole)}.`,
        "Câu đầu tiên PHẢI là đúng dạng \"Tôi là <vai>.\" rồi mới nói thêm.",
      ].join(" ");
    case "COUNTER_CLAIM":
      return [
        `Bạn phản bác ${who}: họ nhận là ${roleName(request.intention.claimedRole)} nhưng bạn mới là.`,
        `Viết đúng dạng \"<tên> không thể là <vai>, tôi mới là <vai>.\"`,
      ].join(" ");
```

Thêm hàm nhỏ ngay trên `intentLine`:

```ts
/**
 * Tên vai cho prompt. Lấy từ `ROLE_META` chứ không viết tay: prompt và bảng
 * mẫu phải nói cùng một chữ, nếu không cổng ở `speech-renderer` sẽ từ chối
 * đúng những câu mà chính prompt này vừa yêu cầu.
 */
function roleName(role: Role | undefined): string {
  return role ? ROLE_META[role].name : "dân làng";
}
```

Thêm `ROLE_META` và `type Role` vào import từ `@masoi/shared`.

- [ ] **Step 8: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/bot-claim-speech.test.ts --root packages/game-engine`
Expected: PASS — 13 vai × 1 + 3 test khác = 17 test xanh.

- [ ] **Step 9: Chạy toàn bộ suite**

Run: `npm test`
Expected: 0 đỏ. Nếu `bot-speech-planner.test.ts` hay `bot-trace.test.ts` đỏ vì đếm số speech kind, cập nhật con số — đó là tín hiệu đúng.

- [ ] **Step 10: Commit**

```bash
git add packages/game-engine/src packages/game-engine/tests/bot-claim-speech.test.ts apps/server/src/bots/prompt.ts
git commit -m "feat(bot): add CLAIM_ROLE and COUNTER_CLAIM speech acts

Nothing emits them yet. This lands the shape and, more importantly, the
guarantee that a rendered claim survives the trip back through the parser
other bots read it with.

The round-trip test sweeps every role in ROLES rather than sampling, because
the failure it guards against is silent: ROLE_META and the parser's
ROLE_PHRASES are two Vietnamese word lists with nothing holding them
together, so a new role would claim into a void."
```

---

### Task 3: `decideClaim` — ba kiểu khai

Hàm thuần, chưa nối vào planner. Kết thúc task này BOT vẫn chưa khai gì.

**Files:**
- Modify: `packages/game-engine/src/bot/decision/claim-decision.ts`
- Modify: `packages/game-engine/src/bot/types.ts` (thêm `myClaim`)
- Modify: `packages/game-engine/src/bot/memory/memory-store.ts` (khởi tạo `myClaim`)
- Test: `packages/game-engine/tests/bot-claim-decision.test.ts` (mới)

**Interfaces:**
- Consumes: `weights.claim` (Task 1).
- Produces:
  ```ts
  export type ClaimKind = "PROACTIVE" | "UNDER_FIRE" | "COUNTER";
  export interface BotChatClaimIntention {
    role: Role;
    kind: ClaimKind;
    accusedId: string | null;   // người bị lời khai chỉ mặt
    counterTargetId: string | null; // chỉ COUNTER: người đang bị đè lên
    reason: string;
  }
  export function decideChatClaim(
    context: BotDecisionContext,
    state: BotBrainState,
    rng: BotRng,
    weights?: BotWeights,
  ): BotChatClaimIntention | null;
  ```
  Task 4 gọi `decideChatClaim`. **Không đổi** `decideRoleClaim` đang có — Ngày Sự Thật vẫn dùng nó.

- [ ] **Step 1: Thêm `myClaim` vào state**

Trong `types.ts`, thêm vào `interface BotBrainState` dưới `claims`:

```ts
  /**
   * Vai chính BOT này đã công khai nhận, hoặc `null`.
   *
   * Một BOT khai đúng MỘT vai cả ván. Lật claim không bị cấm bằng kiểu — nó bị
   * tính giá ở `claim-credibility` — nhưng lõi thì không bao giờ tự lật, vì
   * một người chơi đổi lời khai giữa ván là đang tự thua.
   *
   * Tách khỏi `claims` (kho lời khai của NGƯỜI KHÁC) vì hai câu hỏi khác nhau:
   * "ai đã khai gì" và "tôi đã cam kết điều gì".
   */
  myClaim: { role: Role; round: number } | null;
```

Trong `memory-store.ts`, thêm `myClaim: null,` vào object trả về của `createBotBrainState`, ngay dưới `claims: [],`.

- [ ] **Step 2: Viết test thất bại**

Tạo `packages/game-engine/tests/bot-claim-decision.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOT_WEIGHTS_V4 } from "../src/bot/config/weights";
import { decideChatClaim } from "../src/bot/decision/claim-decision";
import { createBotBrainState } from "../src/bot/memory/memory-store";
import { createBotPersonality } from "../src/bot/personality/personality";
import { createSeededRng } from "../src/bot/rng";
import type { BotBrainState, BotDecisionContext, BotMemory } from "../src/bot/types";

const IDS = ["p1", "p2", "p3", "p4"];

function stateFor(id: string): BotBrainState {
  return createBotBrainState(id, createBotPersonality(id, createSeededRng(id)), IDS);
}

function contextFor(
  selfId: string,
  selfRole: BotDecisionContext["knowledge"]["selfRole"],
  overrides: Partial<BotDecisionContext["knowledge"]> = {},
): BotDecisionContext {
  return {
    knowledge: {
      botId: selfId,
      round: 2,
      phase: "DAY_DISCUSSION",
      phaseStartedAt: 0,
      phaseEndsAt: null,
      selfRole,
      players: IDS.map((id) => ({ id, name: id.toUpperCase(), alive: true })),
      knownRoles: { [selfId]: selfRole },
      seerResult: null,
      night: null,
      trialAccusedId: null,
      canFinalVote: false,
      hunterShot: null,
      publicVoteHistory: [],
      currentVoteCounts: { players: {}, noElimination: 0 },
      hasVoted: false,
      myVote: null,
      legalVoteChoices: [],
      lastNightDeaths: [],
      activeEventId: null,
      dayOfTruthClaims: {},
      ...overrides,
    },
    visibleChat: [],
  };
}

function seerResultMemory(targetId: string): BotMemory {
  return {
    id: `SEER_RESULT:s1:p1`,
    sourceId: "s1",
    round: 1,
    phase: "NIGHT",
    type: "SEER_RESULT",
    actorId: "p1",
    targetId,
    importance: 10,
    pinned: true,
    data: { isWolf: true },
  };
}

describe("decideChatClaim", () => {
  it("Tiên Tri cầm kết quả trúng Sói thì khai và chỉ đích danh", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    const claim = decideChatClaim(contextFor("p1", "SEER"), state, createSeededRng("a"), BOT_WEIGHTS_V4);
    expect(claim?.kind).toBe("PROACTIVE");
    expect(claim?.role).toBe("SEER");
    expect(claim?.accusedId).toBe("p3");
  });

  it("Tiên Tri chỉ soi ra người sạch thì im — lời khai đó không chỉ được ai", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push({ ...seerResultMemory("p3"), data: { isWolf: false } });
    expect(decideChatClaim(contextFor("p1", "SEER"), state, createSeededRng("a"), BOT_WEIGHTS_V4)).toBeNull();
  });

  it("khai xong thì không khai lại — một BOT một vai cả ván", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    state.myClaim = { role: "SEER", round: 1 };
    expect(decideChatClaim(contextFor("p1", "SEER"), state, createSeededRng("a"), BOT_WEIGHTS_V4)).toBeNull();
  });

  it("Bảo Vệ đang dẫn phiếu thì lôi vai ra làm lá bài cuối", () => {
    const claim = decideChatClaim(
      contextFor("p1", "GUARD", { currentVoteCounts: { players: { p1: 3 }, noElimination: 0 } }),
      stateFor("p1"),
      createSeededRng("a"),
      BOT_WEIGHTS_V4,
    );
    expect(claim?.kind).toBe("UNDER_FIRE");
    expect(claim?.role).toBe("GUARD");
  });

  it("Dân Làng bị dồn thì KHÔNG khai: câu đó không mang tin gì", () => {
    expect(
      decideChatClaim(
        contextFor("p1", "VILLAGER", { currentVoteCounts: { players: { p1: 3 }, noElimination: 0 } }),
        stateFor("p1"),
        createSeededRng("a"),
        BOT_WEIGHTS_V4,
      ),
    ).toBeNull();
  });

  it("nhóm claim tắt thì không ai khai gì, và không rút số ngẫu nhiên nào", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    let draws = 0;
    const counting = () => {
      draws += 1;
      return 0.5;
    };
    const off = { ...BOT_WEIGHTS_V4, claim: { ...BOT_WEIGHTS_V4.claim, accusationWeight: 0 } };
    expect(decideChatClaim(contextFor("p1", "SEER"), state, counting, off)).toBeNull();
    expect(draws).toBe(0);
  });

  it("chỉ con Sói playerId nhỏ nhất được khai láo, và chỉ từ vòng 2", () => {
    const wolves = { p2: "WEREWOLF" as const, p3: "WEREWOLF" as const };
    const early = decideChatClaim(
      contextFor("p2", "WEREWOLF", { round: 1, knownRoles: { p2: "WEREWOLF", p3: "WEREWOLF" } }),
      stateFor("p2"),
      createSeededRng("a"),
      BOT_WEIGHTS_V4,
    );
    expect(early).toBeNull();

    const notChosen = decideChatClaim(
      contextFor("p3", "WEREWOLF", { knownRoles: wolves }),
      stateFor("p3"),
      createSeededRng("a"),
      BOT_WEIGHTS_V4,
    );
    expect(notChosen).toBeNull();
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/bot-claim-decision.test.ts --root packages/game-engine`
Expected: FAIL — `decideChatClaim` chưa tồn tại.

- [ ] **Step 4: Cài đặt**

Thêm vào cuối `packages/game-engine/src/bot/decision/claim-decision.ts`:

```ts
export type ClaimKind = "PROACTIVE" | "UNDER_FIRE" | "COUNTER";

export interface BotChatClaimIntention {
  role: Role;
  kind: ClaimKind;
  /** Người mà lời khai chỉ mặt, hoặc `null` khi lời khai không chỉ ai. */
  accusedId: string | null;
  /** Chỉ `COUNTER`: người đang bị đè lên. */
  counterTargetId: string | null;
  reason: string;
}

/** Vai có kết quả riêng chỉ được đích danh một người. */
const INFORMANT_ROLES = new Set<Role>(["SEER", "APPRENTICE_SEER", "DETECTIVE"]);

/** Vai chức năng mà một con Sói bị dồn có thể nấp sau. Thứ tự là thứ tự ưu tiên. */
const BLUFF_COVERS: readonly Role[] = ["GUARD", "WITCH", "HUNTER", "PRIEST"];

/** Ai đang dẫn phiếu ngay lúc này, hoặc `null` khi chưa ai bị dồn. */
function voteLeader(counts: Record<string, number>): string | null {
  let leader: string | null = null;
  let best = 0;
  // Duyệt theo khoá đã sắp: hoà phiếu không được phụ thuộc thứ tự chèn.
  for (const id of Object.keys(counts).sort()) {
    const votes = counts[id] ?? 0;
    if (votes > best) {
      leader = id;
      best = votes;
    }
  }
  return leader;
}

/** Vai đã có người công khai nhận, kể cả người đã chết. */
function alreadyClaimed(state: BotBrainState): Set<Role> {
  return new Set(state.claims.map((memory) => memory.data.role as Role));
}

/**
 * Lời khai tự phát trong khung chat.
 *
 * Tách khỏi `decideRoleClaim` (Ngày Sự Thật) vì hai câu hỏi khác nhau: sự kiện
 * hỏi "bị bắt khai thì khai gì", còn hàm này hỏi "có đáng mở miệng lúc này
 * không". Nhưng chúng chia sẻ đúng một lý lẽ nền — vai chức năng khai ban ngày
 * là tự xin bị cắn đêm nay — nên hai chỗ không được mâu thuẫn nhau.
 *
 * `null` là kết quả thường gặp nhất và là kết quả đúng: im lặng.
 */
export function decideChatClaim(
  context: BotDecisionContext,
  state: BotBrainState,
  rng: BotRng,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotChatClaimIntention | null {
  // Cổng tái lập. Phải đứng TRƯỚC mọi lượt rút số: v1/v2/v3 đi qua đây và phải
  // ra khỏi hàm mà không đụng vào chuỗi RNG.
  if (weights.claim.accusationWeight <= 0) return null;

  // Một BOT, một vai, cả ván.
  if (state.myClaim !== null) return null;

  const knowledge = context.knowledge;
  const role = knowledge.selfRole;
  const me = state.playerId;
  const isWolf = roleTeam(role) === "wolves";

  // ---- PROACTIVE: phe làng đang cầm một kết quả chỉ đích danh ----
  if (!isWolf && INFORMANT_ROLES.has(role)) {
    const hit = state.knownInformation.seerResults.find(
      (memory) => memory.data.isWolf === true && memory.targetId !== undefined,
    );
    if (hit?.targetId) {
      return {
        role,
        kind: "PROACTIVE",
        accusedId: hit.targetId,
        counterTargetId: null,
        reason: "đang cầm một kết quả soi trúng Sói nên khai để làng dùng được",
      };
    }
  }

  // ---- PROACTIVE: Sói khai láo ----
  if (isWolf && knowledge.round >= weights.claim.wolfBluffFromRound) {
    // Ai trong bầy đứng ra nói dối: con còn sống có id nhỏ nhất. Luật CỤC BỘ -
    // mọi con tự tính ra cùng đáp án mà không cần một kênh đồng bộ nào.
    const alive = new Set(knowledge.players.filter((p) => p.alive).map((p) => p.id));
    const pack = Object.entries(knowledge.knownRoles)
      .filter(([id, known]) => alive.has(id) && roleTeam(known) === "wolves")
      .map(([id]) => id)
      .sort();
    if (pack[0] === me) {
      const dare =
        weights.claim.wolfBluffChance *
        state.personality.deceptionSkill *
        state.personality.riskTolerance;
      if (rng() < dare) {
        return {
          role: "SEER",
          kind: "PROACTIVE",
          // Người nó định treo hôm nay. `selectVote` đã chọn sẵn; lấy lại đây
          // thay vì chọn lần thứ hai để lời nói và lá phiếu không rời nhau.
          accusedId: state.currentTargets[0] ?? null,
          counterTargetId: null,
          reason: "cướp uy tín Tiên Tri trước khi người thật kịp lên tiếng",
        };
      }
    }
  }

  // ---- UNDER_FIRE: sắp bị treo ----
  const underFire =
    knowledge.trialAccusedId === me || voteLeader(knowledge.currentVoteCounts.players) === me;
  if (underFire) {
    if (!isWolf && role !== "VILLAGER") {
      return {
        role,
        kind: "UNDER_FIRE",
        accusedId: null,
        counterTargetId: null,
        reason: "sắp bị treo nên lôi vai thật ra làm lá bài cuối",
      };
    }
    if (isWolf) {
      const taken = alreadyClaimed(state);
      const cover = BLUFF_COVERS.find((candidate) => !taken.has(candidate));
      if (cover) {
        return {
          role: cover,
          kind: "UNDER_FIRE",
          accusedId: null,
          counterTargetId: null,
          reason: "sắp bị treo nên nhận một vai chức năng chưa ai lấy",
        };
      }
    }
  }

  return null;
}
```

Thêm vào import ở đầu file: `BotDecisionContext` đã có; thêm `BotRng`, và `import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";`.

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/bot-claim-decision.test.ts --root packages/game-engine`
Expected: PASS (7 test).

- [ ] **Step 6: Chạy toàn bộ suite**

Run: `npm test`
Expected: 0 đỏ.

- [ ] **Step 7: Commit**

```bash
git add packages/game-engine/src packages/game-engine/tests/bot-claim-decision.test.ts
git commit -m "feat(bot): decide when a bot claims a role in chat

Three occasions, not one: holding a result worth delivering, cornered by the
vote, or contradicting someone. Nothing calls this yet.

Which wolf does the lying is settled by lowest surviving playerId - a local
rule, so every wolf reaches the same answer without a shared channel. The cost
is that the same seat always tells the lie at a given table; the alternative
was a synchronisation channel that does not exist and should not."
```

---

### Task 4: Nối vào planner — BOT bắt đầu khai vai

**Files:**
- Modify: `packages/game-engine/src/bot/conversation/speech-planner.ts`
- Modify: `packages/game-engine/src/bot/BotRuntime.ts` (ghi `myClaim` sau khi nói)
- Test: `packages/game-engine/tests/bot-claim-speech.test.ts` (bổ sung)

**Interfaces:**
- Consumes: `decideChatClaim` (Task 3), `BotSpeechIntention.claimedRole` (Task 2).
- Produces: `planSpeech` giờ có thể trả về `kind: "CLAIM_ROLE" | "COUNTER_CLAIM"`. Task 5, 6, 7 dựa vào.

- [ ] **Step 1: Viết test thất bại**

Thêm vào `bot-claim-speech.test.ts`:

```ts
describe("planner phát ra lời khai", () => {
  it("Tiên Tri cầm kết quả trúng Sói thì nói ra, kèm tên con Sói", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    const speech = planSpeech({
      context: contextFor("p1", "SEER"),
      state,
      vote: { kind: "VOTE", choice: { type: "PLAYER", targetId: "p3" }, confidence: 0.9, evidence: [] },
      style: styleFor(state),
      rng: createSeededRng("a"),
      weights: BOT_WEIGHTS_V4,
    });
    expect(speech?.kind).toBe("CLAIM_ROLE");
    expect(speech?.claimedRole).toBe("SEER");
    expect(speech?.targetId).toBe("p3");
  });

  it("v3 không bao giờ phát ra lời khai nào", () => {
    const state = stateFor("p1");
    state.knownInformation.seerResults.push(seerResultMemory("p3"));
    const speech = planSpeech({
      context: contextFor("p1", "SEER"),
      state,
      vote: { kind: "VOTE", choice: { type: "PLAYER", targetId: "p3" }, confidence: 0.9, evidence: [] },
      style: styleFor(state),
      rng: createSeededRng("a"),
      weights: BOT_WEIGHTS_V3,
    });
    expect(speech?.kind).not.toBe("CLAIM_ROLE");
  });
});
```

Thêm import: `planSpeech`, `BOT_WEIGHTS_V3`, `BOT_WEIGHTS_V4`, `createSeededRng`, `createBotBrainState`, `createBotPersonality`, `deriveSpeechStyle` (đặt tên cục bộ `styleFor`), và tái dùng `stateFor`/`contextFor`/`seerResultMemory` từ Task 3 — **sao chép chúng vào file này**, đừng import chéo giữa hai file test.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/bot-claim-speech.test.ts --root packages/game-engine`
Expected: FAIL — planner chưa bao giờ trả về `CLAIM_ROLE`.

- [ ] **Step 3: Thêm nhánh claim vào `planSpeech`**

Trong `speech-planner.ts`, chèn **ngay trên** khối `// ---- 1. Có ai đang nói với mình không ----`:

```ts
  // ---- 0. Có đáng khai vai lúc này không ----
  //
  // Đứng TRÊN cả hai đường kia: một lời khai là nước đi nặng nhất mà lời nói
  // làm được, và một con Tiên Tri đang cầm bằng chứng mà lại đi đáp một câu
  // khích bác vặt là một con BOT đọc sai tình thế.
  //
  // `decideChatClaim` tự thoát ra trước khi rút số khi nhóm claim tắt, nên
  // cấu hình v1/v2/v3 đi qua đây mà không lệch một bit nào của chuỗi RNG.
  const claim = decideChatClaim(context, state, rng, weights);
  if (claim) {
    const intention = fresh({
      kind: claim.kind === "COUNTER" ? "COUNTER_CLAIM" : "CLAIM_ROLE",
      targetId: claim.counterTargetId ?? claim.accusedId ?? undefined,
      claimedRole: claim.role,
      topic: "ROLE_CLAIM",
      confidence: vote.confidence,
      // Bằng chứng soi đi CÙNG lời khai, không đi trước. Xem `holdSeerEvidence`
      // ngay dưới: trước lúc này nó bị giữ lại có chủ ý.
      evidence: vote.evidence
        .filter((item) => item.kind === "SEER_RESULT_WOLF")
        .slice(0, weights.limits.intentionEvidence)
        .map((item) => ({ ...item })),
      tone: toneFor("ACCUSE", style),
      reason: claim.reason,
    });
    if (intention) return intention;
  }
```

Thêm `import { decideChatClaim } from "../decision/claim-decision";` vào đầu file.

- [ ] **Step 4: Đổi điều kiện `holdSeerEvidence`**

Thay dòng khai báo `holdSeerEvidence` bằng:

```ts
  /**
   * Bằng chứng soi mở khoá theo LỜI KHAI, không theo số vòng.
   *
   * Nói "tôi soi thấy Nam là sói" mà chưa hề nhận mình là Tiên Tri là một câu
   * vô nghĩa: cả làng không biết dựa vào đâu, và bầy Sói thì biết thừa phải cắn
   * ai. Giữ lại tới đúng lúc khai thì cả hai bung ra một lượt, và lời khai
   * thành một khoảnh khắc thay vì một dòng tin rỉ ra dần.
   *
   * Nhánh `else` giữ NGUYÊN luật cũ cho v1/v2/v3. Đổi thẳng sẽ đảo ngược hành
   * vi của chúng: ở đó không BOT nào khai vai bao giờ, nên "chưa khai" luôn
   * đúng và bằng chứng soi sẽ không bao giờ được nói ra — trong khi hôm nay
   * `seerRevealRound = 0` nghĩa là nó LUÔN được nói ra.
   */
  const holdSeerEvidence =
    weights.claim.accusationWeight > 0
      ? state.myClaim === null
      : round < weights.deceptionRisk.seerRevealRound;
```

- [ ] **Step 5: Ghi `myClaim` khi lời khai đã phát ra**

Trong `BotRuntime.ts`, tìm `recordSpeech` (chỗ ghi `speechMemory`) và thêm ngay đầu thân hàm:

```ts
    // Cam kết lời khai vào state ngay khi ý định được ghi nhận, không đợi câu
    // chữ. Nếu đợi, hai checkpoint sát nhau sẽ cùng thấy `myClaim === null` và
    // BOT khai hai lần trong một vòng.
    if (
      (speech.kind === "CLAIM_ROLE" || speech.kind === "COUNTER_CLAIM") &&
      speech.claimedRole &&
      this.state.myClaim === null
    ) {
      this.state.myClaim = { role: speech.claimedRole, round };
    }
```

Nếu `recordSpeech` chưa có tham số `round`, lấy từ `knowledge.round` đã có trong phạm vi.

- [ ] **Step 6: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/bot-claim-speech.test.ts --root packages/game-engine`
Expected: PASS.

- [ ] **Step 7: Chạy toàn bộ suite — chú ý test tái lập**

Run: `npm test`
Expected: 0 đỏ. **Test vân tay v1 (`wolfWins === 22` trên 24 ván) đỏ ở đây nghĩa là nhánh mới đã rút một số ngẫu nhiên ở cấu hình cũ.** Sửa `decideChatClaim` để nó thoát sớm hơn, đừng sửa test.

- [ ] **Step 8: Commit**

```bash
git add packages/game-engine/src packages/game-engine/tests/bot-claim-speech.test.ts
git commit -m "feat(bot): let the planner speak a role claim

The claim branch sits above both existing paths: a Seer holding evidence that
answers the round should not be off replying to a jab.

Seer evidence now unlocks on the claim instead of on a round number. Saying
'I scried Nam as a wolf' without first saying who you are tells the village
nothing and tells the pack everything.

The old round-number rule is kept for v1/v2/v3 rather than replaced. Swapping
it outright inverts them: no bot claims there, so 'has not claimed' is always
true and the evidence would never be spoken at all."
```

---

### Task 5: Cổng `CLAIM_INTEGRITY` ở server

Đóng lỗ A1 **trước** khi Task 6 làm cho claim có sức nặng thật.

**Files:**
- Modify: `apps/server/src/bots/speech-renderer.ts`
- Test: `apps/server/tests/claim-integrity.test.ts` (mới)

**Interfaces:**
- Consumes: `analyzeChat` từ `@masoi/game-engine` (đã export ở `index.ts:16`).
- Produces: cổng nội bộ, không có API mới.

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/server/tests/claim-integrity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderBotSpeech } from "../src/bots/speech-renderer";
import type { BotBrain, SpeechRequest } from "../src/bots/types";

function requestFor(overrides: Partial<SpeechRequest> = {}): SpeechRequest {
  return {
    roomCode: "ROOM",
    round: 2,
    seq: 0,
    speaker: { id: "p1", name: "An" },
    targetName: "Bình",
    replyTo: null,
    intention: {
      kind: "CLAIM_ROLE",
      claimedRole: "SEER",
      targetId: "p2",
      topic: "ROLE_CLAIM",
      confidence: 0.9,
      evidence: [],
      tone: "FIRM",
    },
    evidence: [],
    chatWindow: [],
    recentOwnLines: [],
    avoidOpenings: [],
    style: { verbosity: "NORMAL", harshness: 0.5, warmth: "NEUTRAL", humor: 0.3, inquisitive: 0.5, responsiveness: 0.6, concession: 0.5 },
    styleDescription: "bình thường",
    players: [
      { id: "p1", name: "An", alive: true },
      { id: "p2", name: "Bình", alive: true },
    ],
    ...overrides,
  } as SpeechRequest;
}

function brainSaying(text: string): BotBrain {
  return {
    renderDaySpeech: async () => ({ ok: true, value: { chat: text } }),
  } as unknown as BotBrain;
}

describe("CLAIM_INTEGRITY", () => {
  it("giữ câu của nhà cung cấp khi nó khai đúng vai đã chốt", async () => {
    const result = await renderBotSpeech(requestFor(), brainSaying("Tôi là tiên tri. Bình là sói."));
    expect(result.fromTemplate).toBe(false);
    expect(result.text).toContain("tiên tri");
  });

  it("vứt câu không khai gì, dù nó nghe hay — lời khai không được bốc hơi", async () => {
    const result = await renderBotSpeech(requestFor(), brainSaying("Tin tôi đi, tôi biết Bình là ai."));
    expect(result.fromTemplate).toBe(true);
  });

  it("vứt câu khai NHẦM vai — nhà cung cấp không đổi được nước đi", async () => {
    const result = await renderBotSpeech(requestFor(), brainSaying("Tôi là bảo vệ. Bình là sói."));
    expect(result.fromTemplate).toBe(true);
  });

  it("vứt lời khai mà lõi chưa bao giờ quyết", async () => {
    const accuse = requestFor({
      intention: {
        kind: "ACCUSE",
        targetId: "p2",
        topic: "SUSPICION",
        confidence: 0.7,
        evidence: [],
        tone: "FIRM",
      },
    } as Partial<SpeechRequest>);
    const result = await renderBotSpeech(accuse, brainSaying("Tôi là tiên tri, Bình là sói."));
    expect(result.fromTemplate).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/claim-integrity.test.ts --root apps/server`
Expected: FAIL — hai test cuối trả `fromTemplate: false` vì chưa có cổng nào.

- [ ] **Step 3: Cài đặt cổng**

Trong `speech-renderer.ts`, thêm dưới `echoesRecentOwnLine`:

```ts
/**
 * Câu này có nói ĐÚNG lời khai mà lõi đã chốt không — và chỉ đúng lời khai đó?
 *
 * Gác HAI CHIỀU, vì hỏng theo hai chiều:
 *
 * 1. Ý định có khai mà chữ không khai → lời khai bốc hơi trong im lặng. Người
 *    chơi đọc chat vẫn thấy BOT nói; các BOT khác thì không thấy gì, vì cái
 *    chúng đọc là `chat-analysis` chứ không phải ý định.
 * 2. Ý định không khai mà chữ có khai → nhà cung cấp vừa tự đi một nước cờ.
 *    Nó đặt cả bàn vào một lời khai mà lõi chưa bao giờ quyết, không seed nào
 *    dựng lại được, và `ROLE_CLAIM` thì được GHIM vĩnh viễn vào state.
 *
 * Chiều thứ hai là chiều nguy hiểm hơn, và nó đã mở sẵn từ trước Phase 5.
 *
 * Dùng chính `analyzeChat` chứ không so chuỗi: cổng phải hỏi đúng câu hỏi mà
 * các BOT khác sẽ hỏi. Một cổng có luật riêng sẽ trôi lệch khỏi parser, và nó
 * sẽ trôi lệch âm thầm.
 */
function claimSurvivesRoundTrip(request: SpeechRequest, chat: string): boolean {
  const intended =
    request.intention.kind === "CLAIM_ROLE" || request.intention.kind === "COUNTER_CLAIM"
      ? (request.intention.claimedRole ?? null)
      : null;

  const memories = analyzeChat(
    [{ id: "probe", actorId: request.speaker.id, text: chat, at: 0 }],
    request.players,
  );
  const spoken = memories.find(
    (memory) => memory.type === "ROLE_CLAIM" || memory.type === "COUNTER_CLAIM",
  );

  if (intended === null) return spoken === undefined;
  return spoken !== undefined && spoken.data.role === intended;
}
```

Thêm `analyzeChat` vào import từ `@masoi/game-engine`.

Trong `renderBotSpeech`, đổi điều kiện nhận câu của nhà cung cấp:

```ts
    if (chat && !echoesRecentOwnLine(request, chat) && claimSurvivesRoundTrip(request, chat)) {
      return { text: chat.slice(0, chatMaxLength), fromTemplate: false };
    }
```

- [ ] **Step 4: Bảo đảm `request.players` tồn tại**

Nếu `SpeechRequest` chưa có `players`, thêm vào `apps/server/src/bots/types.ts`:

```ts
  /**
   * Danh sách người chơi mà cổng `CLAIM_INTEGRITY` cần để chạy `analyzeChat`.
   *
   * Chỉ `{ id, name, alive }` — đúng cái parser đòi. Không mang vai, không
   * mang gì khác: đây là dữ liệu cho một phép kiểm ở server, và nó KHÔNG bao
   * giờ đi vào prompt.
   */
  players: Array<{ id: string; name: string; alive: boolean }>;
```

rồi điền nó ở chỗ dựng `SpeechRequest` trong `apps/server/src/game/machine.ts` (tìm nơi gọi `renderBotSpeech`).

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/claim-integrity.test.ts --root apps/server`
Expected: PASS (4 test).

- [ ] **Step 6: Chạy toàn bộ suite**

Run: `npm test`
Expected: 0 đỏ.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src apps/server/tests/claim-integrity.test.ts
git commit -m "feat(server): stop the provider inventing or losing a role claim

Two failures, one gate. A claim intention rendered into prose that never says
the words evaporates: the human reads it, no bot does. And an ACCUSE rendered
as 'I am the seer' is the provider making a move the deterministic core never
decided - pinned permanently into every listening bot, reproducible from no
seed. That second hole predates Phase 5; it was only harmless while nothing
acted on claims.

The gate runs the same analyzeChat other bots read with, so it cannot drift
into asking a different question than the one that matters."
```

---

### Task 6: `claim-credibility.ts` — bốn tín hiệu

Bước làm cơ chế **có tác dụng**. Tới trước task này, BOT khai vai và các BOT khác nhớ, nhưng không ai đổi hành vi.

**Files:**
- Create: `packages/game-engine/src/bot/analysis/claim-credibility.ts`
- Modify: `packages/game-engine/src/bot/BotRuntime.ts`
- Modify: `packages/game-engine/src/index.ts` (export)
- Test: `packages/game-engine/tests/bot-claim-credibility.test.ts` (mới)

**Interfaces:**
- Consumes: `weights.claim` (Task 1), memory `ROLE_CLAIM` sinh bởi `analyzeChat`.
- Produces:
  ```ts
  export interface ClaimSignalInput {
    claims: readonly BotMemory[];        // state.claims
    round: number;
    lastNightDeaths: readonly { playerId: string; name: string }[];
    voteCounts: Record<string, number>;
    publicVoteHistory: readonly DayVoteRecap[];
    seenEventIds: readonly string[];
  }
  export function claimEvidence(input: ClaimSignalInput, weights: BotWeights): BotEvidence[];
  ```

- [ ] **Step 1: Viết test thất bại**

Tạo `packages/game-engine/tests/bot-claim-credibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { claimEvidence } from "../src/bot/analysis/claim-credibility";
import { BOT_WEIGHTS_V4 } from "../src/bot/config/weights";
import type { BotMemory } from "../src/bot/types";

function claim(actorId: string, role: string, round: number, sourceId: string): BotMemory {
  return {
    id: `ROLE_CLAIM:${sourceId}:${actorId}`,
    sourceId,
    round,
    phase: "DAY_DISCUSSION",
    type: "ROLE_CLAIM",
    actorId,
    targetId: "p9",
    importance: 8,
    pinned: true,
    data: { role, underFire: false },
  };
}

const BASE = {
  round: 2,
  lastNightDeaths: [],
  voteCounts: {},
  publicVoteHistory: [],
  seenEventIds: ["m1", "m2", "night-death:2:p1", "night-death:2:p4"],
};

describe("claimEvidence", () => {
  it("S1: một lời khai dồn nghi ngờ lên người nó chỉ mặt", () => {
    const found = claimEvidence({ ...BASE, claims: [claim("p1", "SEER", 1, "m1")] }, BOT_WEIGHTS_V4);
    const accusation = found.find((item) => item.actorId === "p9");
    expect(accusation).toBeDefined();
    expect(accusation!.weight).toBeGreaterThan(0);
  });

  it("S1: khai lúc đang dẫn phiếu thì gần như không được gì", () => {
    const calm = claimEvidence({ ...BASE, claims: [claim("p1", "SEER", 1, "m1")] }, BOT_WEIGHTS_V4);
    const cornered = claimEvidence(
      { ...BASE, claims: [{ ...claim("p1", "SEER", 1, "m1"), data: { role: "SEER", underFire: true } }] },
      BOT_WEIGHTS_V4,
    );
    const weightOn = (list: typeof calm) => list.find((i) => i.actorId === "p9")?.weight ?? 0;
    expect(weightOn(cornered)).toBeLessThan(weightOn(calm));
  });

  it("S2: hai người khai cùng vai thì CẢ HAI bị nghi", () => {
    const found = claimEvidence(
      { ...BASE, claims: [claim("p1", "SEER", 1, "m1"), claim("p2", "SEER", 2, "m2")] },
      BOT_WEIGHTS_V4,
    );
    expect(found.some((item) => item.actorId === "p1" && item.weight > 0)).toBe(true);
    expect(found.some((item) => item.actorId === "p2" && item.weight > 0)).toBe(true);
  });

  it("S3: khai Tiên Tri rồi chết đêm đó → bằng chứng neo vào chính cái chết", () => {
    const found = claimEvidence(
      {
        ...BASE,
        claims: [claim("p1", "SEER", 1, "m1")],
        lastNightDeaths: [{ playerId: "p1", name: "An" }],
      },
      BOT_WEIGHTS_V4,
    );
    const confirm = found.find((item) => item.sourceId === "night-death:2:p1");
    expect(confirm).toBeDefined();
    // Weight ÂM trên thang suspicion = gỡ tội = tin tưởng tăng.
    expect(confirm!.weight).toBeLessThan(0);
  });

  it("S3: khai rồi SỐNG trong khi người khác chết → mất uy tín", () => {
    const found = claimEvidence(
      {
        ...BASE,
        claims: [claim("p1", "SEER", 1, "m1")],
        lastNightDeaths: [{ playerId: "p4", name: "Dung" }],
      },
      BOT_WEIGHTS_V4,
    );
    expect(found.some((item) => item.actorId === "p1" && item.weight > 0)).toBe(true);
  });

  it("S3: đêm không ai chết thì IM LẶNG — Bảo Vệ cũng làm ra cảnh này", () => {
    const quiet = claimEvidence({ ...BASE, claims: [claim("p1", "SEER", 1, "m1")] }, BOT_WEIGHTS_V4);
    expect(quiet.every((item) => !item.sourceId.startsWith("night-death:"))).toBe(true);
  });

  it("mọi sourceId phát ra đều nằm trong seenEventIds", () => {
    const found = claimEvidence(
      {
        ...BASE,
        claims: [claim("p1", "SEER", 1, "m1"), claim("p2", "SEER", 2, "m2")],
        lastNightDeaths: [{ playerId: "p1", name: "An" }],
      },
      BOT_WEIGHTS_V4,
    );
    for (const item of found) expect(BASE.seenEventIds).toContain(item.sourceId);
  });

  it("nhóm claim tắt thì không phát gì", () => {
    const off = { ...BOT_WEIGHTS_V4, claim: { ...BOT_WEIGHTS_V4.claim, accusationWeight: 0 } };
    expect(claimEvidence({ ...BASE, claims: [claim("p1", "SEER", 1, "m1")] }, off)).toEqual([]);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/bot-claim-credibility.test.ts --root packages/game-engine`
Expected: FAIL — module chưa tồn tại.

- [ ] **Step 3: Viết module**

Tạo `packages/game-engine/src/bot/analysis/claim-credibility.ts`:

```ts
import type { DayVoteRecap, Role } from "@masoi/shared";
import { DEFAULT_BOT_WEIGHTS, type BotWeights } from "../config/weights";
import type { BotEvidence, BotMemory } from "../types";

/**
 * Uy tín của một lời khai, dựng từ dữ liệu CÔNG KHAI và chỉ từ đó.
 *
 * Module này KHÔNG import và không nhận `knownRoles`, `knownInformation`, hay
 * bất cứ thứ gì engine đã lọc theo vai. Ranh giới đó là thứ phân biệt một cái
 * làng đoán giỏi với một cái làng ăn gian, và người chơi sẽ CẢM THẤY sự khác
 * biệt kể cả khi không chỉ ra được nó.
 *
 * Uy tín ở đây không phải một con số. `validateEvidence` từ chối mọi bằng
 * chứng không có nguồn thật, nên không có chỗ nào để giữ một điểm trôi nổi rồi
 * nhân ngược vào những bằng chứng cũ - và sửa điểm cũ vốn đã là viết lại lịch
 * sử. Thay vào đó, mỗi tín hiệu là một MẢNH bằng chứng neo vào một sự kiện có
 * thật, phát ra đúng lúc sự kiện đó xảy ra. Làng không chấm điểm lời khai; làng
 * quan sát nó qua thời gian.
 *
 * Quy ước dấu, giống hệt phần còn lại của lõi: `weight > 0` trên thang
 * suspicion là buộc tội, `weight < 0` là gỡ tội - và `applyTrustEvidence` đảo
 * dấu, nên một mảnh gỡ tội tự động làm tin tưởng tăng.
 */

/** Vai mà bầy Sói buộc phải cắn ngay khi nó lộ mặt. */
const POWER_ROLES = new Set<Role>(["SEER", "APPRENTICE_SEER", "DETECTIVE", "WITCH", "GUARD", "HUNTER"]);

export interface ClaimSignalInput {
  claims: readonly BotMemory[];
  round: number;
  lastNightDeaths: readonly { playerId: string; name: string }[];
  voteCounts: Record<string, number>;
  publicVoteHistory: readonly DayVoteRecap[];
  seenEventIds: readonly string[];
}

function evidence(
  kind: "ROLE_CLAIM" | "COUNTER_CLAIM",
  sourceId: string,
  idSuffix: string,
  subjectId: string,
  aboutId: string,
  round: number,
  weight: number,
  confidence: number,
  summary: string,
): BotEvidence {
  return {
    id: `${sourceId}:${kind}:${idSuffix}`,
    kind,
    sourceId,
    // `actorId` là CHỦ THỂ của niềm tin - `updateBelief` khoá bảng theo trường
    // này. Đọc nó như "người đang bị/được nói tới", không phải "người đã làm".
    actorId: subjectId,
    targetId: aboutId,
    weight,
    confidence,
    round,
    summary,
  };
}

export function claimEvidence(
  input: ClaimSignalInput,
  weights: BotWeights = DEFAULT_BOT_WEIGHTS,
): BotEvidence[] {
  const tuning = weights.claim;
  if (tuning.accusationWeight <= 0) return [];

  const seen = new Set(input.seenEventIds);
  const found: BotEvidence[] = [];
  const push = (item: BotEvidence) => {
    // Neo hỏng thì bỏ mảnh đó, đừng để `applyEvidence` ném ở tận chỗ gọi.
    // `seenEventIds` có trần, nên một message id đủ cũ SẼ biến mất.
    if (seen.has(item.sourceId)) found.push(item);
  };

  const roleClaims = input.claims.filter((memory) => memory.type === "ROLE_CLAIM");
  const confidence = weights.evidence.ROLE_CLAIM.confidence;

  // ---- S1: thời điểm ----
  for (const claim of roleClaims) {
    const underFire = claim.data.underFire === true;
    const factor = underFire ? tuning.underFireFactor : 1;

    if (claim.targetId) {
      push(
        evidence(
          "ROLE_CLAIM",
          claim.sourceId,
          "accused",
          claim.targetId,
          claim.actorId,
          claim.round,
          tuning.accusationWeight * factor,
          confidence,
          underFire
            ? "Bị một người đang bị dồn phiếu chỉ mặt khi họ khai vai."
            : "Bị một người tự nhận vai chức năng chỉ đích danh.",
        ),
      );
    }

    push(
      evidence(
        "ROLE_CLAIM",
        claim.sourceId,
        "claimant",
        claim.actorId,
        claim.actorId,
        claim.round,
        -tuning.claimantTrustWeight * factor,
        confidence,
        "Công khai nhận một vai và chịu rủi ro đi kèm.",
      ),
    );
  }

  // ---- S2: va chạm ----
  //
  // Sắp theo (vòng, sourceId) chứ không theo thứ tự chèn: thứ tự chèn phụ thuộc
  // lịch quan sát, mà một chuỗi phụ thuộc lịch thì không replay được.
  const byRole = new Map<string, BotMemory[]>();
  for (const claim of roleClaims) {
    const role = String(claim.data.role);
    byRole.set(role, [...(byRole.get(role) ?? []), claim]);
  }
  for (const [role, group] of byRole) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(
      (a, b) => a.round - b.round || a.sourceId.localeCompare(b.sourceId),
    );
    ordered.forEach((claim, index) => {
      // Người đến sau chịu nặng hơn: phản ứng lại một lời khai rẻ hơn nhiều so
      // với việc đi trước, nên nó cũng đáng tin hơn ít.
      const scale = index === 0 ? 1 : tuning.collisionLatePenaltyScale;
      push(
        evidence(
          "COUNTER_CLAIM",
          // Neo vào lời khai ĐẾN SAU: va chạm chỉ tồn tại từ khoảnh khắc đó.
          ordered.at(-1)!.sourceId,
          `collision:${role}:${claim.actorId}`,
          claim.actorId,
          claim.actorId,
          ordered.at(-1)!.round,
          tuning.collisionPenalty * scale,
          confidence,
          `Có người khác cũng nhận là ${role}, nên ít nhất một trong hai đang nói dối.`,
        ),
      );
    });
  }

  // ---- S3: kiểm chứng bằng đêm ----
  //
  // Không ai chết thì KHÔNG có tín hiệu, và đó là một quyết định chứ không phải
  // một thiếu sót: Bảo Vệ và Phù Thuỷ cũng làm ra đúng cảnh đó.
  if (input.lastNightDeaths.length > 0) {
    const died = new Set(input.lastNightDeaths.map((death) => death.playerId));
    for (const claim of roleClaims) {
      if (!POWER_ROLES.has(claim.data.role as Role)) continue;
      // Chỉ xét lời khai của các vòng TRƯỚC: khai xong đêm chưa qua thì chưa có
      // gì để kiểm.
      if (claim.round >= input.round) continue;

      if (died.has(claim.actorId)) {
        push(
          evidence(
            "ROLE_CLAIM",
            `night-death:${input.round}:${claim.actorId}`,
            "night-confirm",
            claim.actorId,
            claim.actorId,
            input.round,
            -tuning.nightConfirmBonus,
            confidence,
            "Khai vai chức năng rồi bị cắn ngay đêm đó, đúng như bầy Sói phải làm.",
          ),
        );
        continue;
      }

      // Sống, mà có người khác chết. Neo vào cái chết của NGƯỜI KIA - nó là sự
      // kiện có thật vừa xảy ra, và nó chắc chắn còn trong `seenEventIds`.
      const other = input.lastNightDeaths[0]!;
      push(
        evidence(
          "ROLE_CLAIM",
          `night-death:${input.round}:${other.playerId}`,
          `night-survived:${claim.actorId}`,
          claim.actorId,
          claim.actorId,
          input.round,
          tuning.nightSurvivedPenalty,
          confidence,
          "Khai vai chức năng mà đêm qua vẫn sống, trong khi người khác chết thay.",
        ),
      );
    }
  }

  // ---- S4: nhất quán với lịch sử phiếu ----
  for (const recap of input.publicVoteHistory) {
    if (recap.round <= 0) continue;
    for (const claim of roleClaims) {
      if (!claim.targetId || claim.round > recap.round) continue;
      const votedRight = recap.mutations.some(
        (mutation) =>
          mutation.voterId === claim.actorId &&
          mutation.choice.type === "PLAYER" &&
          mutation.choice.targetId === claim.targetId,
      );
      if (votedRight) continue;
      push(
        evidence(
          "ROLE_CLAIM",
          `recap:${recap.round}`,
          `inconsistent:${claim.actorId}`,
          claim.actorId,
          claim.actorId,
          recap.round,
          tuning.voteInconsistencyPenalty,
          confidence,
          "Chỉ mặt một người là Sói rồi lại không bỏ phiếu treo chính người đó.",
        ),
      );
    }
  }

  return found;
}
```

- [ ] **Step 4: Ghi `underFire` lúc nạp lời khai**

Trong `BotRuntime.ts`, tìm chỗ `analyzeChat` sinh memory (`ingestChat`) và, trước khi `remember`, đính cờ thời điểm. Cách gọn nhất là gắn ngay trong vòng lặp ghi memory:

```ts
      // Người khai có đang bị dồn phiếu ngay lúc mở miệng không. Ghi Ở ĐÂY chứ
      // không tính lại sau: bảng phiếu đổi liên tục, và một tín hiệu về THỜI
      // ĐIỂM mà lại đọc trạng thái của tương lai thì không còn là tín hiệu.
      if (memory.type === "ROLE_CLAIM") {
        memory.data.underFire =
          (knowledge.currentVoteCounts.players[memory.actorId] ?? 0) > 0;
      }
```

- [ ] **Step 5: Nối vào `observe`**

Trong `BotRuntime.observe`, ngay **sau** `this.ingestChat(context)`:

```ts
    // Phải chạy SAU `ingestDeaths`, `ingestRecaps` và `ingestChat`: cả ba đẩy
    // `sourceId` vào `seenEventIds`, và `claimEvidence` neo vào đúng những id
    // đó. Đảo thứ tự thì mọi mảnh bằng chứng bị bỏ lặng lẽ.
    for (const item of claimEvidence(
      {
        claims: this.state.claims,
        round: knowledge.round,
        lastNightDeaths: knowledge.lastNightDeaths,
        voteCounts: knowledge.currentVoteCounts.players,
        publicVoteHistory: knowledge.publicVoteHistory,
        seenEventIds: this.state.seenEventIds,
      },
      this.weights,
    )) {
      applyEvidence(this.state, item, this.weights);
      applyTrustEvidence(this.state, item, this.weights);
    }
```

Thêm `import { claimEvidence } from "./analysis/claim-credibility";`.

- [ ] **Step 6: Export**

Trong `packages/game-engine/src/index.ts`, thêm `export * from "./bot/analysis/claim-credibility";` cạnh các export analysis khác.

- [ ] **Step 7: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/bot-claim-credibility.test.ts --root packages/game-engine`
Expected: PASS (8 test).

- [ ] **Step 8: Test bất biến `CLAIM_BLINDNESS`**

Thêm vào `bot-claim-credibility.test.ts`:

```ts
it("CLAIM_BLINDNESS: đảo vai thật không đổi một chữ số nào của uy tín", () => {
  const input = {
    ...BASE,
    claims: [claim("p1", "SEER", 1, "m1"), claim("p2", "SEER", 2, "m2")],
    lastNightDeaths: [{ playerId: "p1", name: "An" }],
  };
  // `claimEvidence` không có tham số nào để nhận vai thật. Đây là test về
  // KIỂU nhiều hơn về giá trị: nếu ai đó thêm một trường vai vào
  // `ClaimSignalInput`, dòng dưới vẫn xanh nhưng review sẽ thấy nó.
  const twice = [claimEvidence(input, BOT_WEIGHTS_V4), claimEvidence(input, BOT_WEIGHTS_V4)];
  expect(twice[0]).toEqual(twice[1]);
  expect(Object.keys(input)).not.toContain("knownRoles");
});
```

- [ ] **Step 9: Chạy toàn bộ suite**

Run: `npm test`
Expected: 0 đỏ. Test vân tay v1/v3 vẫn phải xanh — `claimEvidence` trả mảng rỗng ở đó.

- [ ] **Step 10: Commit**

```bash
git add packages/game-engine/src packages/game-engine/tests/bot-claim-credibility.test.ts
git commit -m "feat(bot): let the village weigh a role claim

evidence.ROLE_CLAIM has carried a weight of 5 since Phase 3 with nothing
emitting it. This emits it, and three more signals besides.

Credibility is not a score. validateEvidence refuses sourceless evidence, so
there is nowhere to keep a floating number and multiply it back into old
evidence - and editing old evidence is rewriting history anyway. Each signal is
a piece anchored to a real public event, emitted when that event happens.

A quiet night emits nothing. A Guard covering the claimed Seer produces exactly
the scene that would otherwise be read as a lie, and the village is not told
who was covered."
```

---

### Task 7: Chỉ số self-play, cân bằng, chi phí

**Files:**
- Modify: `packages/game-engine/src/bot/evaluation/metrics.ts`
- Modify: `packages/game-engine/src/bot/evaluation/selfplay.ts`
- Modify: `packages/game-engine/src/bot/evaluation/invariants.ts`
- Test: `packages/game-engine/tests/bot-claim-metrics.test.ts` (mới)

**Interfaces:**
- Consumes: mọi thứ từ Task 1–6.
- Produces: `SelfPlayMetrics` thêm `claimsPerGame: number | null`, `counterClaimRate: Ratio`, `claimFollowRate: Ratio`, `claimAccuracy: Ratio`.

- [ ] **Step 1: Viết test thất bại**

Tạo `packages/game-engine/tests/bot-claim-metrics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runSelfPlay } from "../src/bot/evaluation/selfplay";
import { BOT_WEIGHTS_V3, BOT_WEIGHTS_V4 } from "../src/bot/config/weights";

describe("chỉ số claim", () => {
  it("v4 có lời khai, v3 tuyệt đối không", () => {
    const v4 = runSelfPlay({ games: 40, seed: "claim-v4", weights: BOT_WEIGHTS_V4 });
    const v3 = runSelfPlay({ games: 40, seed: "claim-v4", weights: BOT_WEIGHTS_V3 });
    expect(v4.overall.claimsPerGame).toBeGreaterThan(0);
    expect(v3.overall.claimsPerGame).toBe(0);
  }, 60_000);

  it("mật độ nằm trong khoảng thiết kế, không thành chợ", () => {
    const report = runSelfPlay({ games: 60, seed: "claim-density", weights: BOT_WEIGHTS_V4 });
    expect(report.overall.claimsPerGame).toBeGreaterThanOrEqual(1);
    expect(report.overall.claimsPerGame).toBeLessThanOrEqual(6);
  }, 60_000);

  it("làng tin claim đúng nhiều hơn claim láo", () => {
    const report = runSelfPlay({ games: 120, seed: "claim-accuracy", weights: BOT_WEIGHTS_V4 });
    expect(report.overall.claimAccuracy.ratio).toBeGreaterThan(0.5);
  }, 60_000);
});
```

Khớp đúng chữ ký `runSelfPlay` hiện có trong `selfplay.ts` — đọc nó trước khi viết, tên tham số có thể khác.

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/bot-claim-metrics.test.ts --root packages/game-engine`
Expected: FAIL — bốn trường chỉ số chưa có.

- [ ] **Step 3: Thêm bốn chỉ số**

Trong `metrics.ts`, thêm vào `SelfPlayMetrics` (dưới khối Phase 4):

```ts
  // ---- Lời khai vai (Phase 5) ----

  /** Số lời khai trung bình mỗi ván. Thiết kế nhắm 2–4 ở bàn 12–14. */
  claimsPerGame: number | null;
  /** Tỉ lệ ván có ít nhất một lời phản bác. Phải `> 0` và `< 1`. */
  counterClaimRate: Ratio;
  /**
   * Phiếu chuyển sang người bị một lời khai chỉ mặt, trong vòng ngay sau đó.
   *
   * `≈ 0` nghĩa là mô hình uy tín chỉ là số chạy ngầm: người chơi sẽ không thấy
   * lời khai thay đổi được điều gì, và đó là hỏng đúng mục tiêu của Phase 5.
   */
  claimFollowRate: Ratio;
  /**
   * Trong những lần làng TIN một lời khai Tiên Tri, bao nhiêu lần người đó là
   * Tiên Tri thật.
   *
   * Chỉ số quan trọng nhất của Phase 5, và là chỉ số duy nhất chỉ tồn tại được
   * ở harness - chỉ đây mới biết vai thật để đối chiếu. Dưới 50% nghĩa là cơ
   * chế đang giúp Sói nhiều hơn giúp làng, tức phần Sói khai láo đã nuốt chửng
   * phần thông tin của làng.
   */
  claimAccuracy: Ratio;
```

Cài đặt phép đếm trong hàm tổng hợp của `metrics.ts` theo đúng khuôn các `Ratio` sẵn có, và ghi sự kiện claim trong `selfplay.ts` ở chỗ đã ghi speech (tìm `chatSequence`).

- [ ] **Step 4: Thêm bất biến `CLAIM_ONCE`**

Trong `invariants.ts`, thêm một bất biến chạy ở mọi mốc chuyển pha:

```ts
/**
 * Không BOT nào để lại hai lời khai khác vai trong một ván.
 *
 * Lật claim không bị cấm bằng kiểu - `claim-credibility` tính giá cho nó - mà
 * bị cấm ở LÕI: một BOT tự lật lời khai của chính mình là một bug, không phải
 * một nước đi.
 */
```

so `state.myClaim` với mọi `ROLE_CLAIM` mà chính BOT đó là `actorId`.

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `npx vitest run tests/bot-claim-metrics.test.ts --root packages/game-engine`
Expected: PASS.

**Nếu `claimAccuracy <= 0.5`:** đây là tín hiệu thiết kế, không phải test hỏng. Hạ `claim.wolfBluffChance` hoặc nâng `claim.collisionPenalty` / `claim.nightSurvivedPenalty` trong `BOT_WEIGHTS_V4` rồi đo lại. Ghi lại từng lần chỉnh và con số đi kèm — Task 9 cần chúng.

- [ ] **Step 6: Đo cân bằng và chi phí**

```bash
npx vitest run tests/bot-claim-metrics.test.ts --root packages/game-engine --reporter=verbose
```

Chạy 300 seed cho v3 và v4, ghi lại: tỉ lệ Dân thắng hai bên, chênh lệch, và **ms mỗi ván** hai bên.

- Dân thắng phải nằm trong **28–68%**.
- Dịch quá ~5 điểm so với v3 thì phải chỉ ra được cơ chế, không đổ cho nhiễu.
- Chi phí mỗi ván tăng thì dùng lại hai cách của Phase 4 §C8: ghi nhớ batch theo phiên bản trọng số, và hạn giờ tường minh cho đúng những test batch đó. **Không nới hạn giờ một cách mù quáng.**

- [ ] **Step 7: Chạy toàn bộ suite**

Run: `npm test`
Expected: 0 đỏ, và tổng thời gian engine không vượt quá ~1,5× mốc 3.78s.

- [ ] **Step 8: Commit**

```bash
git add packages/game-engine
git commit -m "feat(bot): measure the claim mechanic

claimAccuracy is the one to read first: below 50% the mechanic is helping the
wolves more than the village, which is the failure mode the proactive wolf
bluff opens. It only exists in the harness, because only the harness knows the
real roles to check against."
```

---

### Task 8: Pha bào chữa về lõi

Refactor, để cuối vì bảy task trên đứng được mà không có nó.

**Files:**
- Modify: `apps/server/src/bots/prompt.ts:147-179`
- Modify: `apps/server/src/bots/types.ts`, `decide.ts`, `gemini-brain.ts`, `openai-compat-brain.ts`, `fallback-brain.ts`
- Modify: `apps/server/src/game/machine.ts` (chỗ gọi `decideDefense`)
- Test: `apps/server/tests/` — test `decideDefense` hiện có

**Interfaces:**
- Consumes: `decideChatClaim` với `kind: "UNDER_FIRE"` (Task 3), cổng `CLAIM_INTEGRITY` (Task 5).
- Produces: `decideDefense(request: SpeechRequest)` thay cho `decideDefense(view: RoomSnapshot)`.

- [ ] **Step 1: Viết test thất bại**

Test khẳng định prompt bào chữa **không** còn chứa vai thật:

```ts
it("prompt bào chữa không mang vai thật của bị cáo", () => {
  const spec = buildDefensePrompt(requestFor({ /* bị cáo là SEER */ }));
  expect(spec?.system.concat(spec.user)).not.toContain("Tiên Tri");
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `npx vitest run tests/ --root apps/server`
Expected: FAIL — `roleContext(view)` vẫn đang đưa vai thật vào.

- [ ] **Step 3: Đổi chữ ký và bỏ `roleContext`**

`buildDefensePrompt` nhận `SpeechRequest`. Bỏ `roleContext(view)` khỏi mảng `user`. Giữ lại số phiếu và danh sách người cũng bị nhắm — cả hai đã công khai ở pha này.

- [ ] **Step 4: Nối lõi vào chỗ gọi**

Trong `machine.ts`, trước khi gọi `decideDefense`: chạy `runtime.observe(context)`, rồi `decideChatClaim` với `trialAccusedId === botId`. Có claim thì dựng `BotSpeechIntention` `CLAIM_ROLE` và đi qua `renderBotSpeech` như mọi lời nói khác. Không có thì giữ đường bào chữa cũ với ý định `DISAGREE`.

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `npm test`
Expected: 0 đỏ. Test `decideDefense` cũ đỏ vì đổi chữ ký là **tín hiệu đúng** — cập nhật chúng.

- [ ] **Step 6: Commit**

```bash
git add apps/server
git commit -m "refactor(server): put the defence turn behind the deterministic core

It was the only path handing a model roleContext - the accused bot's real role -
and then 300 free characters with nothing checking the output. The most
dramatic moment of the game was also the one place the provider could make a
move, and self-play never exercised it."
```

---

### Task 9: Văn bản kiểm chứng

**Files:**
- Create: `docs/bot-ai-phase-5-verification.md`
- Modify: `README.md` (mục Hạn chế)

- [ ] **Step 1: Viết văn bản**

Theo đúng khuôn bốn doc Phase 1–4. Bắt buộc có:

1. **Audit** — mốc commit, kết quả `npm test` trước/sau.
2. **Từng mục tiêu G1–G6**: đạt hay không, bằng chứng nào.
3. **Bốn chỉ số claim** với con số thật.
4. **Cân bằng** — Dân thắng v3 vs v4 trên 300 seed, chênh lệch, và giải thích cơ chế nếu > 5 điểm.
5. **Chi phí** — ms mỗi ván trước/sau, tổng thời gian suite.
6. **Tái lập** — bằng chứng v1/v3 tái lập từng bit.
7. **Bất biến** — `CLAIM_INTEGRITY`, `CLAIM_BLINDNESS`, `CLAIM_ONCE`, cùng toàn bộ bất biến Phase 4.
8. **Concern còn lại** — kể cả concern gây khó chịu. Ít nhất phải nói tới: Bảo Vệ bẻ gãy S3; parser bỏ sót câu người thật gõ; luật `playerId` nhỏ nhất khiến cùng một ghế luôn là con nói dối; và việc game không lật vai người chết nên làng vĩnh viễn mù hơn một bậc.

- [ ] **Step 2: Cập nhật README**

Xoá dòng *"BOT chưa biết tự nhận vai trong chat…"* khỏi mục Hạn chế, thay bằng mô tả ngắn cơ chế mới **kèm hạn chế còn lại**. Đừng viết như thể đã xong hết.

- [ ] **Step 3: Commit**

```bash
git add docs/bot-ai-phase-5-verification.md README.md
git commit -m "docs(bot): Phase 5 verification"
```

- [ ] **Step 4: Xem một ván thật bằng mắt**

Mục tiêu của Phase 5 là chất lượng trải nghiệm và **nó không có thước đo bằng máy**. Chạy app, mở một phòng nhiều BOT, đọc khung chat một ván trọn vẹn. Câu hỏi phải trả lời được bằng có/không:

- Có ai hô lên mình là Tiên Tri không, và nó đến đúng lúc chứ?
- Có cảnh cãi vai không? Đọc lên có ra một cuộc cãi nhau không?
- Sau một lời khai đáng tin, lá phiếu của làng có nhúc nhích không?
- Có bị thành chợ không?

Không đạt thì quay lại Task 7 chỉnh trọng số. **Đây là cổng cuối, không phải một bước tuỳ chọn.**

---

## Tự rà soát

**Phủ spec:** §5 → Task 3, 4 · §6 → Task 6 · §7 → Task 2, 5 · §8 → Task 8 · §9 → Task 1 · §10 → Task 5, 6, 7 · §11 → mọi task + Task 7, 9 · §12 → Task 7 · §14 → thứ tự task. Không mục nào của spec thiếu task.

**Chỗ kế hoạch cố ý nói "đọc file trước khi viết":** Task 7 Step 1 (chữ ký `runSelfPlay`), Task 7 Step 3 (khuôn `Ratio`), Task 8 Step 4 (chỗ gọi `decideDefense`). Ba chỗ này phụ thuộc code chưa đọc hết ở thời điểm lập kế hoạch, và đoán bừa một chữ ký sẽ tệ hơn là nói thẳng.

**Nhất quán tên:** `decideChatClaim` (mới, chat) và `decideRoleClaim` (đang có, Ngày Sự Thật) là hai hàm khác nhau, cùng file, không cái nào thay cái nào. `claimEvidence` là tên duy nhất của điểm vào ở Task 6. `claim.accusationWeight` là cổng tắt/bật duy nhất, dùng ở Task 3, 4, 6.
