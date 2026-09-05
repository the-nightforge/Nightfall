# Hồ sơ vụ án — Thiết kế

Trạng thái: **chờ duyệt**. Chưa viết code.
Nhánh khảo sát: `feat/single-theme-music` (cây làm việc sạch, `npm test` xanh — web 281/281 pass, exit code 0).

---

## 1. Khảo sát: dữ liệu thật đang có gì

### 1.1 Snapshot ở `GAME_OVER` (nguồn duy nhất, đã authoritative)

`GameEngine.snapshotFor()` mở khoá đúng ba thứ khi và chỉ khi `phase === "GAME_OVER"`
([engine.ts:1457](../packages/game-engine/src/engine.ts#L1457), [engine.ts:1593-1594](../packages/game-engine/src/engine.ts#L1593-L1594)):

| Trường | Cổng | Nội dung |
|---|---|---|
| `players[].role`, `players[].cursedTurned` | `revealAll = phase === "GAME_OVER"` | Vai CUỐI ván của mọi người |
| `nightHistory: NightRecap[]` | `phase === "GAME_OVER" ? … : []` | Toàn bộ diễn biến đêm |
| `hunterShots: HunterShotRecap[]` | `phase === "GAME_OVER" ? … : []` | Mọi phát bắn Thợ Săn |
| `dayVoteHistory: DayVoteRecap[]` | *không gác pha* | Chỉ chứa vòng ĐÃ CHỐT; vòng đang mở nằm ở `openBallots` |

`NightRecap` mỗi đêm mang: `wolfTarget`, `wolfSecondaryTarget`, `guardTarget`,
`guardianAngelTarget`, `seerChecks[].isWolf`, `detectiveChecks[].sameTeam`,
`priest{target,isWolf}`, `witch{usedHeal,healedTarget,poisonTarget}`,
`deaths[]{player,cause}` với `cause ∈ wolf|poison|priest|priest_backfire`,
và `cursedTurned`.

`DayVoteRecap` mỗi vòng mang: `mutations[]` (`VoteMutation` có
`previousChoice`, `castAt`, `phaseStartedAt`, `phaseEndsAt`, `sequence`),
`finalBallots[]`, `nomination` (`TRIAL{accusedId}` hoặc
`NONE{reason: no-elimination|tie|no-votes}`), và `finalJudgment`
(`{ballots, guilty, innocent, abstain, lynched}` hoặc `null`).

Đây là dữ liệu **có cấu trúc**, không phải chuỗi log. `snapshot.log` chỉ là
10 dòng cuối để hiển thị — thiết kế này không đọc nó.

### 1.2 Cái KHÔNG có

- **`eventHistory`** nằm trong `GameState` nhưng **không đi ra snapshot** — chỉ
  `activeEvent` của pha hiện tại. Không dựng được điểm ngoặt theo sự kiện.
- **Chat trong trận**: ở `GAME_OVER`, `visibleChatLog` trả về đúng kênh `lobby`
  ([snapshot.ts:132](../apps/server/src/rooms/snapshot.ts#L132)). Chat ngày/sói
  không tồn tại ở màn kết thúc. Trùng khớp với yêu cầu "không đưa raw chat vào ảnh".
- **Thời lượng trận trên client**: snapshot không có mốc bắt đầu ván.
- **Số người sống theo từng vòng**: không có sẵn, nhưng **tái dựng được** (xem §4.2).

### 1.3 Vai trò bị đổi giữa ván

Chỉ có **đúng một** phép ghi đè vai trong toàn engine:
`cursedTurned.role = "WEREWOLF"` ([engine.ts:834](../packages/game-engine/src/engine.ts#L834)).
Nên vai lúc chia bài suy ngược được chính xác: `cursedTurned === true ⇒ originRole = "CURSED"`,
còn lại `originRole = role`. Không có đường nào khác làm lệch.

### 1.4 Trọng số phiếu — một cái bẫy

`voteTally()` nhân đôi phiếu **MAYOR**, và sự kiện `HOWL_OF_THE_PACK` cộng thêm
**một phiếu ẩn** cho phe Sói ([engine.ts:976-1000](../packages/game-engine/src/engine.ts#L976-L1000)).
Phiếu ẩn đó **không** nằm trong `finalBallots`.

> **Hệ quả bắt buộc:** không được kiểm phiếu lại từ `finalBallots` rồi tuyên bố
> "lá phiếu này đã quyết định bị cáo". Kết quả tính lại có thể mâu thuẫn với
> `nomination` thật. Điểm ngoặt về phiếu chỉ được khẳng định những gì **đã được
> ghi lại**, không suy luận nhân quả. Xem `LATE_VOTE_SWING` ở §4.3.

---

## 2. Trả lời tám câu hỏi xác minh

**1 · Dữ liệu hiện tại đủ dựng highlight nào?**
15 loại, tất cả chứng minh được bằng trường có cấu trúc — bảng đầy đủ ở §4.3.
Ba loại trong danh sách gợi ý **không** dựng được nguyên trạng: "phiếu phút cuối
làm đổi phán quyết" (nhân quả không chứng minh được vì phiếu ẩn — hạ xuống thành
mệnh đề mô tả), "lật ngược thế trận" (cần timeline tái dựng, để phase 2), và
"ai đó nói dối" (không có dữ liệu claim đối chiếu ở màn kết thúc).

**2 · Dữ liệu nào chỉ ở memory, dữ liệu nào đã vào `GameResult`?**
`GameResult` chỉ có `roomCode, round, winner, playerRoles[{id,name,role,alive}],
durationSec, createdAt` ([schema.prisma:19-27](../apps/server/prisma/schema.prisma#L19-L27),
ghi ở [machine.ts:358-377](../apps/server/src/game/machine.ts#L358-L377)).
`nightHistory`, `dayVoteHistory`, `hunterShots`, `cursedTurned` **chỉ nằm trong
engine state**: RAM + một bản Redis write-through TTL 6 giờ, và bị xoá khi
`resetToLobby`. Lịch sử trận **không** dựng lại được hồ sơ hôm nay.

**3 · Sinh `CaseFile` ở đâu?** → `packages/shared`, chạy trên web. Lý do ở §3.

**4 · Cần migration Prisma trong MVP không?** → **Không.** Hồ sơ dựng tại chỗ từ
snapshot đang có. Migration chỉ cần khi muốn xem lại từ lịch sử (phase 2).

**5 · Chỉ ở màn game over hay cả match history?** → **Chỉ game over.** Không phải
vì ngại phạm vi mà vì dữ liệu nguồn không tồn tại trong `GameResult` (xem câu 2).
Làm match history đồng nghĩa migration + ghi payload recap + đường đọc mới.

**6 · Cách tạo PNG?** → Canvas 2D vẽ tay, **không thêm dependency**. Lúc viết,
repo chưa có CSP nào nên `canvas.toBlob` chạy thoải mái. Từ 2026-09-05 web có CSP
(`apps/web/src/lib/security-headers.ts`) với `img-src`/`media-src` cho `blob:`,
nên ràng buộc vẫn giữ nguyên. Chi tiết §6.

**7 · Có tăng kích thước snapshot / lộ thông tin không?** → **Không, cả hai.**
Thiết kế này **không thêm một trường nào** vào `RoomSnapshot` và không sửa
`buildSnapshot`. Bề mặt rò rỉ đúng bằng bề mặt hôm nay.

**8 · Tài liệu lệch chỗ nào?** Ba chỗ, sẽ sửa kèm:
- `packages/shared/tests/roles.test.ts` **là test vitest nhưng chưa từng chạy** —
  `packages/shared/package.json` không có script `test`, và `npm test` ở root chỉ
  gọi engine + server + web. Một file test chết.
- Bảng Testing trong README ghi web **273** test; thực tế **281**. Và bảng không
  hề liệt kê `@masoi/shared`.
- `apps/web/package.json` khai `@masoi/game-engine` là dependency nhưng **web
  không import nó ở bất kỳ đâu**. (Ghi nhận, không sửa trong phạm vi này.)

---

## 3. Ba phương án kiến trúc

### Phương án A — Pure module trong `packages/shared`, web gọi *(đề xuất)*

```
packages/shared/src/case-file/
  types.ts      CaseFile, CaseHighlight, CaseEvidence…
  build.ts      buildCaseFile(snapshot) → CaseFile | null
  highlights.ts các detector, mỗi cái nhận dữ liệu có cấu trúc
  narrate.ts    title/description tiếng Việt từ dữ liệu
```

- **Ưu**: `shared` đã đúng là chỗ cho luật mà cả hai phía phải đồng ý (README dòng 77
  nói thẳng điều đó — balance, voice, role meta đều ở đây). `CaseFile` chắc chắn
  phải là type của `shared` khi phase 2 đưa nó lên dây. Server tái dùng được nguyên
  vẹn cho public share link / video mà không phải kéo `game-engine`.
  Không đụng vào engine, không đụng vào snapshot.
- **Nhược**: `shared` chưa có test runner → phải thêm `vitest` + script `test` và
  nối vào `npm test` ở root.
- **Bù lại**: chính việc đó **hồi sinh `roles.test.ts` đang chết** (câu 8).

### Phương án B — Tất cả trong `apps/web/src/lib`

- **Ưu**: đúng y hệt convention web hiện tại (`tsx --test src/lib/*.test.ts`),
  không thêm một dòng cấu hình nào.
- **Nhược**: server vĩnh viễn không dùng lại được. Mọi mục tiêu mở rộng người
  dùng nêu ra — public share link, video recap, xem lại từ lịch sử — đều là việc
  của server, và đều bắt đầu bằng việc **chuyển module này đi chỗ khác**.

### Phương án C — Server tính sẵn, nhét `caseFile` vào `RoomSnapshot`

- **Ưu**: tính một lần, sẵn sàng để ghi xuống DB.
- **Nhược**: thêm ~2–4KB vào mọi snapshot broadcast ở `GAME_OVER`; thêm **một
  trường mới phải tự gác pha cho đúng**, tức thêm bề mặt rò rỉ đúng vào lúc đang
  cố không thêm; và MVP không ghi DB nên toàn bộ cái lợi kia chưa thu được đồng nào.

### Chốt: **A**

C là hình dạng đúng cho phase 2 (server tính một lần rồi ghi vào `GameResult`),
nhưng hôm nay nó trả phí mà chưa nhận hàng. A giữ nguyên hợp đồng mạng, giữ
thuật toán ở nơi cả hai phía với tới được, và web chỉ còn đúng việc trình bày.

**Phân chia trách nhiệm**

| Tầng | Việc |
|---|---|
| engine / server | Sự thật. **Không đổi một dòng nào.** |
| `packages/shared` | `buildCaseFile` — pure, deterministic, không IO, không `Date.now()` |
| `apps/web` | Trình bày, vẽ canvas, share/copy/tải, xử lý lỗi |

---

## 4. Thuật toán

### 4.1 Cổng vào

```ts
buildCaseFile(snapshot: RoomSnapshot): CaseFile | null
```

Trả `null` trừ khi `snapshot.phase === "GAME_OVER" && snapshot.winner !== null`.
Đây là **cổng an toàn duy nhất** và nó nằm ngay dòng đầu — không có nhánh nào
dựng được hồ sơ một phần trước khi hết ván. UI không tự kiểm tra pha; nó chỉ
render khi hàm này trả về khác `null`.

Hàm là hàm thuần: cùng snapshot → cùng `CaseFile`, byte-for-byte. Không đọc
`Date.now()`, không random, không `serverNow` (trường đó đổi mỗi lần push).

### 4.2 Tái dựng timeline

Mọi cái chết đều có nguồn có cấu trúc, nên dựng lại được đủ mạch:

| Nguồn | Vòng | Ý nghĩa |
|---|---|---|
| `nightHistory[r].deaths[]` | `r`, pha `night` | chết đêm, kèm `cause` |
| `dayVoteHistory[r].finalJudgment.lynched` | `r`, pha `day` | bị treo — nạn nhân là `nomination.accusedId` |
| `hunterShots[]` | `round`, pha theo `source` | phát bắn |
| `nightHistory[r].cursedTurned` | `r`, pha `night` | đổi phe |

Ghép với roster đầy đủ (`snapshot.players`, đã lộ vai) là ra `CaseTimelineEntry[]`
sắp theo `(round asc, night trước day, thứ tự trong nguồn)`. Timeline này dùng cho
mục "xem toàn bộ diễn biến" và cho highlight `LONE_SURVIVOR`.

`LAST_STAND` (Tử Thủ hoãn chết) hiện chỉ có mặt qua `pendingLastStandVictim` ở pha
đang chơi, không nằm trong `nightHistory` — nên **không** dựng highlight cho nó.

### 4.3 Bảng highlight

`importance` là số cố định theo loại, không phải điểm động — để hai ván giống nhau
xếp hạng giống nhau.

| # | `type` | Điều kiện (chỉ từ dữ liệu có cấu trúc) | imp |
|---|---|---|---|
| 1 | `INNOCENT_LYNCHED` | `finalJudgment.lynched === true` và vai của `accusedId` thuộc phe `village` | 92 |
| 2 | `WOLF_LYNCHED` | `finalJudgment.lynched === true` và vai của `accusedId` thuộc phe `wolves` | 88 |
| 3 | `HUNTER_MISFIRE` | `hunterShots[i].target !== null` và vai target phe `village` | 86 |
| 4 | `HUNTER_REVENGE` | `hunterShots[i].target !== null` và vai target phe `wolves` | 84 |
| 5 | `CURSED_TURNED` | `nightHistory[r].cursedTurned != null` | 82 |
| 6 | `WOLF_ACQUITTED` | `nomination.kind === "TRIAL"`, `finalJudgment.lynched === false`, vai bị cáo phe `wolves` | 80 |
| 7 | `WITCH_SAVE` | `witch.usedHeal && healedTarget` và `healedTarget.id` **không** có trong `deaths[]` đêm đó | 76 |
| 8 | `PRIEST_BACKFIRE` | có `deaths[].cause === "priest_backfire"` | 74 |
| 9 | `BLOODBATH` | `deaths.length >= 2` | 72 |
| 10 | `WITCH_POISON` | `witch.poisonTarget` và có `deaths[].cause === "poison"` | 70 |
| 11 | `PRIEST_STRIKE` | `priest.isWolf === true` và có `deaths[].cause === "priest"` | 68 |
| 12 | `GUARD_SAVE` | `guardTarget?.id === wolfTarget?.id` và người đó không có trong `deaths[]` | 66 |
| 13 | `LATE_VOTE_SWING` | xem dưới | 64 |
| 14 | `SEER_FOUND_WOLF` | `seerChecks[].isWolf === true` | 58 |
| 15 | `LONE_SURVIVOR` | phe thắng còn đúng **1** người sống ở cuối ván | 54 |

**`LATE_VOTE_SWING` — mệnh đề được hạ cấp có chủ đích.**
Fire khi và chỉ khi: `nomination.kind === "TRIAL"`, tồn tại mutation `m` là
**mutation cuối cùng của vòng** (`sequence` lớn nhất), `m.previousChoice !== null`
(tức thật sự ĐỔI chứ không phải bỏ lần đầu), `m.choice` trỏ đúng `accusedId`, và
`m.castAt` rơi vào **25% cuối** cửa sổ `[phaseStartedAt, phaseEndsAt]`.

Câu chữ chỉ nói điều đã ghi lại: *"⟨A⟩ đổi phiếu sang ⟨B⟩ ở những giây cuối, và
⟨B⟩ là người bị đưa ra xét xử."* — **không** nói lá phiếu đó gây ra kết quả. Lý do
ở §1.4: phiếu ẩn của `HOWL_OF_THE_PACK` không có trong `finalBallots`, nên mọi
phép kiểm lại có thể sai. Đây là chỗ duy nhất phải chủ động kể ít hơn.

**Ba cái bẫy phải chặn bằng test:**
- `nomination.kind === "NONE"` (`tie` / `no-elimination` / `no-votes`) **không bao
  giờ** sinh `INNOCENT_LYNCHED`. Không ai chết thì không có ai bị xử oan.
- `finalJudgment.lynched === false` (được tha) cũng vậy.
- `hunterShots[i].target === null` (Thợ Săn không bắn) **không bao giờ** sinh
  `HUNTER_MISFIRE`.

### 4.4 Chọn, chống trùng, sắp xếp

1. Chạy hết detector → danh sách ứng viên, mỗi cái mang một `eventKey`
   (`"lynch:r3"`, `"night-death:r2"`, `"hunter:r4:0"`, `"nomination:r3"`…).
2. **Chống trùng sự kiện**: một `eventKey` chỉ giữ ứng viên `importance` cao nhất.
   Một lần treo cổ không thể vừa là `WOLF_LYNCHED` vừa là `WOLF_ACQUITTED`.
3. **Trần theo loại**: tối đa **2** highlight cùng `type` trong cả hồ sơ, để ván 6
   đêm không trả về năm cái `BLOODBATH` giống hệt nhau.
4. Sắp xếp chọn lọc theo `(importance desc, round asc, phase night→day, type asc)`
   — khoá cuối là chuỗi nên thứ tự **toàn phần**, không phụ thuộc tính ổn định của
   `Array.sort`.
5. Lấy tối đa **5**.
6. **Sắp xếp lại theo thời gian** để hiển thị: `(round asc, night→day, importance desc)`.
   Đọc một câu chuyện thì phải đọc theo thứ tự nó xảy ra.

### 4.5 Fallback

Nếu sau bước trên còn **0** highlight (ván kết thúc quá sớm, không đêm nào có
biến, không vòng treo nào), trả về đúng **một** highlight `QUIET_MATCH` với
`importance: 0` và `fallback: true` trên `CaseFile`:

> *"Một vụ án khép nhanh — ⟨phe⟩ thắng sau ⟨n⟩ vòng mà làng chưa kịp dựng lên một
> phiên toà nào."*

Câu này chỉ dùng `winner` và `rounds`, không bịa thêm gì. UI đọc cờ `fallback` để
không hứa "3 điểm ngoặt" rồi hiện một cái.

### 4.6 `caseId`

Hash FNV-1a 32-bit của chuỗi chính tắc
`roomCode | rounds | winner | (playerId:role) theo thứ tự roster`, in ra Crockford
base32 5 ký tự → `HS-7QK4M`.

- Ổn định qua reconnect (mọi input đều bất biến sau `finishGame`; roster engine cố
  định từ lúc `GameEngine.create`).
- **Không** dùng `serverNow` (đổi mỗi push) hay `Date.now()`.
- **Không phải mã phòng**, nên chia sẻ nó không mời ai vào một phòng đã chết.

---

## 5. Kiểu dữ liệu

```ts
// packages/shared/src/case-file/types.ts
export interface CaseFile {
  /** Phiên bản schema. Hồ sơ ghi xuống DB sau này phải đọc lại được. */
  version: 1;
  caseId: string;
  winner: "wolves" | "village";
  rounds: number;
  cast: CaseFilePlayer[];
  /** 1–5 phần tử. Đúng 1 khi `fallback`. */
  highlights: CaseHighlight[];
  timeline: CaseTimelineEntry[];
  fallback: boolean;
}

export interface CaseFilePlayer {
  id: string;
  name: string;
  /** Vai CUỐI ván. */
  role: Role;
  /** Vai lúc chia bài; chỉ khác `role` với Kẻ Nguyền Rủa đã hoá Sói. */
  originRole: Role;
  team: Team;
  alive: boolean;
  isBot: boolean;
}

export interface CaseHighlight {
  type: CaseHighlightType;
  round: number;
  phase: "night" | "day";
  title: string;
  description: string;
  /** playerId nội bộ. UI tra tên qua `cast`; nội dung chia sẻ KHÔNG bao giờ mang id. */
  participants: string[];
  importance: number;
  /** Số liệu thô đã chứng minh highlight. Test đọc thẳng vào đây thay vì so chuỗi. */
  evidence: CaseEvidence;
}
```

`CaseEvidence` là union phân biệt theo `type`, ví dụ
`{ kind: "lynch"; accusedId: string; guilty: number; innocent: number; abstain: number }`.
Test khẳng định vào `evidence` chứ không vào `description` — đổi câu chữ tiếng Việt
không được làm vỡ test logic.

**`roomCode` cố ý không nằm trong `CaseFile`.** Nó chỉ là input của hash. Không có
đường nào để nó rơi vào nội dung chia sẻ.

---

## 6. Web: trình bày, ảnh, chia sẻ

### 6.1 Một model, hai bộ render

Preview DOM và ảnh PNG **phải không được lệch nội dung**. Nên:

```
buildCaseCardModel(caseFile, { shareOrigin, maxNameChars }) → CaseCardModel
        ├── <CaseShareCardPreview>   render DOM, class Tailwind hiện có
        └── paintCaseCard(ctx, model) render canvas 1080×1920
```

`CaseCardModel` là danh sách block đã cắt chữ, đã chốt câu. Cả hai bộ render chỉ
được vẽ những gì có trong model. Model là pure → test được; và "preview khác ảnh"
trở thành một lỗi không thể xảy ra chứ không phải một lỗi phải nhớ kiểm.

### 6.2 PNG — Canvas 2D, không dependency

- `<canvas width=1080 height=1920>` ngoài màn hình, `paintCaseCard`, rồi `toBlob("image/png")`.
- **Không** `html2canvas`/`dom-to-image`: ~200KB gzip cho một nút bấm, và chúng vẫn
  rasterize sai `backdrop-filter` với gradient nhiều lớp mà giao diện này đang dùng
  — tức trả tiền bundle để nhận một tấm ảnh không giống bản xem trước.
- Bảng màu lấy đúng từ `tailwind.config.ts`: `night-950 #070b14`, `night-800 #111a2e`,
  `blood-500 #dc2640`, `blood-400 #f04760`, `mist #9db2d5`, emerald của Tailwind.
- Font: đọc `getComputedStyle(document.documentElement).getPropertyValue("--font-display")`
  (Playfair Display) và `--font-sans` (Be Vietnam Pro, đã khai subset `vietnamese`),
  `await document.fonts.ready` trước khi vẽ, fallback `Georgia, serif` / `system-ui`.
- **Không vẽ avatar trong MVP**: avatar là component SVG (`avatar-art.ts`) hoặc base64
  do người dùng tải lên; rasterize chúng thêm một đường async có thể hỏng, một bề mặt
  nội dung người dùng, và không mang thêm thông tin nào. Thẻ dùng chữ + bảng màu.
- Text tiếng Việt: đo bằng `ctx.measureText`, tự xuống dòng theo từ, cắt bằng `…`.
  Biệt danh dài bị cắt **ở model**, nên logic và ảnh cắt giống hệt nhau.
- `fillText` không diễn giải markup → không có đường XSS. DOM thì React tự escape;
  **không dùng `innerHTML`/`dangerouslySetInnerHTML` ở bất kỳ đâu.**

### 6.3 Chia sẻ — máy trạng thái thuần + adapter mỏng

```ts
pickShareStrategy(caps: ShareCapabilities): "files" | "text" | "clipboard" | "manual"
```

1. `navigator.canShare?.({ files: [png] })` → chia sẻ **ảnh + text**.
2. `navigator.share` có nhưng không nhận file → chia sẻ **text + url**.
3. Không có Web Share → `navigator.clipboard.writeText(text)`.
4. Clipboard cũng không có / bị chặn → hiện khối text chọn được để copy tay.

`AbortError` (người dùng bấm huỷ) là **`cancelled`, không phải lỗi** — không hiện
toast đỏ cho một hành động cố ý.

Nếu `toBlob` trả `null` hoặc ném (Safari cũ, hết bộ nhớ): rơi xuống nhánh 2, và
**vẫn cho "Sao chép tóm tắt"**. Xuất ảnh hỏng không được làm mất đường chia sẻ.

`pickShareStrategy` và `describeShareOutcome` là hàm thuần → test bằng
`node:test` đúng convention web hiện tại, không cần jsdom.

### 6.4 Nội dung chia sẻ

```
🕯️ Hồ sơ vụ án HS-7QK4M
Phe Dân Làng thắng sau 4 vòng.

• Đêm 2 · Phù Thủy cứu Lan khỏi nanh Sói
• Ngày 3 · Làng treo nhầm Minh — Dân Làng
• Ngày 4 · Thợ Săn Huy bắn trúng Sói Nam

Chơi Ma Sói online: https://<origin>
```

- Chỉ **biệt danh hiển thị**. Không `playerId`, không token, không mã phòng, không IP.
- `shareOrigin` là tham số truyền vào (`window.location.origin`), không hardcode —
  test tiêm origin cố định.
- Có test khẳng định: với mọi `caseId` sinh ra, chuỗi chia sẻ **không chứa** bất kỳ
  `playerId` nào trong `cast`, và không chứa `roomCode`.

### 6.5 UI trong `GameOverView`

Thứ tự mới, hai nút cũ **không đổi vị trí tương đối và không đổi hành vi**:

1. Banner phe thắng *(giữ nguyên)*
2. Hai `TeamPanel` *(giữ nguyên)*
3. **`CaseFileCard`** — mã hồ sơ, kết quả, 3–5 điểm ngoặt
4. **"Xem toàn bộ diễn biến"** — nút mở ra `NightRecapTimeline` + `HunterShotTimeline`
   (hiện đang luôn hiển thị). Đây là thay đổi hành vi **có chủ đích** và đúng yêu cầu
   — mặc định đóng để màn kết thúc không còn là một bức tường chữ.
5. **Preview thẻ chia sẻ** — `aspect-[9/16]`, `w-full max-w-[280px] mx-auto`
6. **"Chia sẻ hồ sơ"** · **"Tải ảnh"** · **"Sao chép tóm tắt"**
7. **"Chơi lại"** / **"Rời phòng"** *(giữ nguyên, vẫn ở cuối)*

**Mobile**: không cuộn ngang (preview theo `%`, không `px` cứng); nút cao `min-h-11`;
biệt danh dài `truncate` ở danh sách và cắt ở model cho thẻ; mô tả dài `break-words`.
**Reduced motion**: `MotionProvider` đã đặt `reducedMotion="user"` toàn cục
([MotionProvider.tsx:25](../apps/web/src/components/MotionProvider.tsx#L25)) nên thẻ
`m.*` tự tuân thủ. Không thêm animation tự chạy; preview là tĩnh.

### 6.6 Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| `buildCaseFile` trả `null` | Không render khu vực hồ sơ. Màn kết thúc y như hôm nay. |
| Server cũ thiếu field optional | Mọi optional đọc qua `?? null` / `?? []`. Không throw. |
| `toBlob` null / throw | Chia sẻ text; nút "Tải ảnh" báo lỗi tiếng Việt; copy vẫn chạy. |
| Người dùng huỷ share sheet | Im lặng. Không phải lỗi. |
| `clipboard` bị chặn | Hiện khối text chọn được. |
| Canvas không dựng được | Ẩn "Tải ảnh", giữ "Chia sẻ" (text) và "Sao chép". |

---

## 7. Privacy

- Hồ sơ **chỉ** dựng khi `phase === "GAME_OVER" && winner !== null`. Một cổng, ở
  dòng đầu của `buildCaseFile`.
- **Không thêm trường nào vào `RoomSnapshot`**; `buildSnapshot` không bị chạm.
  Lọc theo người xem giữ nguyên 100%.
- Vai bí mật vẫn chỉ lộ qua `revealAll` sẵn có của engine — thiết kế này không mở
  thêm đường nào.
- Nội dung chia sẻ: chỉ biệt danh. `playerId` sống trong `participants` để UI tra
  cứu, và có test chặn nó lọt ra chuỗi/ảnh.
- Không chat, không token, không mã phòng, không IP.
- Không `innerHTML`.

---

## 8. Migration

**MVP: không có migration.** Không đụng `schema.prisma`.

Phase 2 (khi muốn xem lại từ lịch sử) sẽ cần: server gọi `buildCaseFile` ngay trong
`onGameOver` — cùng module, nên cùng kết quả — rồi ghi vào một cột `caseFile Json?`
trên `GameResult`. Cột Json nullable nên ván cũ đọc ra `null` và UI ẩn khu vực hồ
sơ, đúng cách `playerRoles` đang xử lý ván thiếu `id`
([http.ts:26-29](../apps/server/src/http.ts#L26-L29)). Đó là lúc phương án C ở §3
trở thành hình dạng đúng.

---

## 9. Testing (TDD sau khi duyệt)

Hạ tầng: thêm `vitest` + script `test` cho `packages/shared`, nối vào `npm test` ở
root. Việc này cũng **làm `roles.test.ts` chạy lần đầu tiên**.

**`packages/shared` (vitest) — logic thuần**
- Cùng snapshot → `CaseFile` bằng nhau tuyệt đối (so `JSON.stringify`), chạy 2 lần.
- Không sinh người / vòng / sự kiện không có trong input.
- Ưu tiên đúng: ván có cả `INNOCENT_LYNCHED` và `SEER_FOUND_WOLF` phải giữ cái trước.
- Không trùng: một lần treo cổ chỉ ra một highlight.
- Trần 2 highlight cùng loại.
- Sắp xếp ổn định theo `(round, phase, importance)`; hoán vị thứ tự detector không đổi kết quả.
- Ván ngắn → đúng một `QUIET_MATCH`, `fallback === true`.
- `nomination.kind === "NONE"` với cả ba `reason` → **không** `INNOCENT_LYNCHED`.
- Được tha (`lynched === false`) → không `INNOCENT_LYNCHED`.
- Thợ Săn `target === null` → không `HUNTER_MISFIRE`.
- `CURSED_TURNED` mô tả đúng chiều đổi phe; `originRole === "CURSED"`, `team === "wolves"`.
- Biệt danh Unicode/tiếng Việt có dấu, emoji, và biệt danh dài — không vỡ, cắt đúng.

**Hợp đồng & bảo mật**
- `buildCaseFile` trả `null` ở mọi pha ≠ `GAME_OVER` (chạy qua cả 11 pha).
- Snapshot thiếu `cursedTurned` / `detectiveChecks` / `priest` / `guardianAngelTarget`
  / `wolfSecondaryTarget` / `openBallots` → không throw, hồ sơ vẫn dựng.
- Chuỗi chia sẻ không chứa `playerId` nào của `cast`, không chứa `roomCode`.
- Hai snapshot của cùng ván (mô phỏng reconnect) → cùng `caseId` và cùng `CaseFile`.
- **Test hồi quy engine/server**: khẳng định `RoomSnapshot` **không** có khoá mới
  và role vẫn không lộ trước `GAME_OVER`.

**`apps/web` (`node:test`) — model & share**
- `buildCaseCardModel` trả 3–5 dòng điểm ngoặt; đúng 1 dòng ở fallback.
- Biệt danh dài bị cắt ở model, và bản gốc vẫn nguyên trong `CaseFile`.
- `pickShareStrategy` cho cả 4 tổ hợp capability.
- `AbortError` → `cancelled`, không phải `error`.
- Ảnh hỏng → vẫn còn đường copy text.
- `paintCaseCard` chạy với một `CanvasRenderingContext2D` giả ghi lại lệnh vẽ:
  khẳng định mọi chuỗi `fillText` đều đến từ model, và **không** chuỗi nào chứa
  `playerId`.

> Ghi chú: `apps/web` **không** có hạ tầng test React (không vitest, không jsdom,
> không testing-library) — script là `tsx --test src/lib/*.test.ts`. Nên phần "UI"
> được test ở tầng model/máy trạng thái thuần thay vì render component. Thêm
> jsdom + testing-library chỉ cho tính năng này là một thay đổi hạ tầng lớn hơn
> chính tính năng. Nếu bạn muốn test render thật, nói và tôi sẽ tách thành một
> đề xuất riêng.

**Regression**: `npm test`, `npm run lint`, `npm run build` — cả ba phải xanh, và
tôi sẽ báo đúng số pass/fail.

---

## 10. Phạm vi

**Có**: hồ sơ ở màn game over, 3–5 điểm ngoặt hoặc fallback, timeline đầy đủ mở
theo yêu cầu, preview thẻ 9:16, tải PNG, Web Share, copy fallback, tiếng Việt toàn bộ.

**Không (đúng như đề bài)**: video, LLM, trang public, tài khoản, leaderboard, refactor ngoài phạm vi.

**Giới hạn đã biết, sẽ nói rõ khi bàn giao**
- Không xem lại được từ lịch sử trận (dữ liệu nguồn không nằm trong `GameResult`).
- Server restart giữa lúc đang ở `GAME_OVER` làm mất màn kết thúc — `loadRoomFromRedis`
  hạ phòng `IN_GAME` về `LOBBY` ([store.ts:176-181](../apps/server/src/rooms/store.ts#L176-L181)).
  Đây là **hành vi có sẵn**, hồ sơ không làm nó tệ hơn và cũng không sửa được nó.
- Không có điểm ngoặt theo sự kiện (`eventHistory` không ra tới snapshot).
- `LATE_VOTE_SWING` cố ý không khẳng định nhân quả (§1.4).
- `durationSec` trong `GameResult` tính từ lúc **tạo phòng**, không phải lúc vào ván
  ([machine.ts:374](../apps/server/src/game/machine.ts#L374)) — nên MVP không đưa
  thời lượng vào hồ sơ.

---

## Chờ duyệt

Nếu đồng ý, tôi viết implementation plan rồi triển khai bằng TDD. Ba điểm đáng
bạn cân nhắc trước khi gật:

1. **Thêm `vitest` vào `packages/shared`** và nối vào `npm test` — hệ quả kèm theo
   là `roles.test.ts` (đang chết) bắt đầu chạy và có thể lộ ra lỗi có sẵn.
2. **`NightRecapTimeline` + `HunterShotTimeline` chuyển sang đóng mặc định**, mở
   bằng nút. Đúng yêu cầu UI nhưng là thay đổi hành vi hiện tại.
3. **`LATE_VOTE_SWING` kể ít hơn** so với "phiếu phút cuối làm đổi phán quyết" bạn
   nêu — vì phiếu ẩn `HOWL_OF_THE_PACK` làm mệnh đề nhân quả không chứng minh được.
