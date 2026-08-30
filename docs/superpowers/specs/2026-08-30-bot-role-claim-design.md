# BOT AI Phase 5 — Khai vai trong chat và mô hình uy tín của làng

**Ngày:** 2026-08-30
**Trạng thái:** Đã duyệt qua đối thoại (5/5 phần thiết kế duyệt từng phần)
**Nhánh nền:** `fix/roster-player-bar` @ `8d63dbe`
**Tiền đề:** Phase 1–4 hoàn tất và xanh. Việc đang dở về *Ngày Sự Thật* nằm trong working tree (chưa commit); thiết kế này xây thẳng lên trên nó.

---

## 0. Audit — trạng thái thật trước khi sửa

Kiểm tra trên `C:\Users\Admin\ma-soi-online`. Không reset, không checkout đè, không đụng worktree khác.

| Lệnh | Kết quả |
| --- | --- |
| `git branch --show-current` | `fix/roster-player-bar` |
| `git log --oneline -1` | `8d63dbe` merge `origin/main` vào `fix/roster-player-bar` |
| `git status --short` | **25 file đã sửa + 3 file chưa theo dõi**, chưa commit — xem §0.3 |
| `npm test` | **XANH** — engine 815 (42 file, 3.88s), server 510 (59 file, 1.82s), web 145. Tổng 1.470, 0 đỏ. |

Đã đọc toàn bộ trong audit: `bot/types.ts`, `bot/BotRuntime.ts`, `bot/config/weights.ts`, `bot/analysis/chat-analysis.ts`, `bot/analysis/social-analysis.ts`, `bot/belief/belief-state.ts`, `bot/belief/evidence.ts`, `bot/memory/memory-store.ts`, `bot/conversation/{triggers,speech-planner,templates}.ts`, `bot/decision/{vote-decision,claim-decision}.ts`, `bot/roles/werewolf.ts`, `bot/knowledge.ts`, `apps/server/src/bots/{prompt,speech-renderer,context}.ts`, `apps/server/src/game/machine.ts`, `packages/shared/src/{roles,snapshot}.ts`, và `docs/bot-ai-phase-{2,4}-verification.md`.

### 0.1 Xác nhận cáo buộc gốc

Cáo buộc (README §Hạn chế): *"BOT chưa biết tự nhận vai trong chat, nên phe làng chưa truyền được thông tin của Tiên Tri cho nhau."*

| # | Mắt xích | Xác nhận tại | Trạng thái |
| --- | --- | --- | --- |
| 1 | Parser **đã** hiểu câu tự nhận vai | `chat-analysis.ts:260-263` — `afterMarker(clause, "tôi là ")` → `ROLE_CLAIM` | có sẵn, chạy được |
| 2 | Parser **đã** hiểu câu phản bác | `chat-analysis.ts:236-250` — đòi cả `" không thể là "` lẫn `"tôi mới là "` | có sẵn, chạy được |
| 3 | Móc treo hội thoại **đã** có | `triggers.ts:145` `ROLE_CLAIM_HEARD`, `:142` `COUNTER_CLAIM_ON_ME` | có sẵn |
| 4 | Sói **đã** biết dùng claim | `werewolf.ts:32-42` — ai tự nhận vai chức năng thì bị cắn trước | có sẵn |
| 5 | **Không có speech act nào để khai vai** | `types.ts:110-123` — 12 kind, không kind nào tự nhận vai | **mắt xích đứt #1** |
| 6 | **`ROLE_CLAIM` không sinh bằng chứng nào** | `BotRuntime.ts:766-865` — chỉ `ACCUSE`, `DEFEND`, `COUNTER_CLAIM` có nhánh phát evidence | **mắt xích đứt #2** |
| 7 | Trọng số cho nó thì đã khai báo sẵn | `weights.ts:582` `ROLE_CLAIM: { weight: 5, confidence: 0.5 }` | khai báo mà không nơi nào phát ra |

Văn bản của chính repo đã ghi nhận: `docs/bot-ai-phase-4-verification.md` §C6 — *"`evidence.ROLE_CLAIM` weight 5 vẫn được khai báo mà không nơi nào phát ra"*, và §H1 *"làng không có cơ chế tổng hợp thông tin"*.

Tóm lại: **hai đầu đường ống đã xây xong, chỉ thiếu khúc giữa.** BOT đọc được lời khai của người khác nhưng không nói được lời khai của mình, và khi nghe được thì cũng không làm gì với nó.

### 0.2 Ràng buộc của game làm chuyện phân xử khó hơn ma sói ngoài đời

| Ràng buộc | Nguồn | Hệ quả |
| --- | --- | --- |
| **Không lật vai người chết** | `snapshot.ts:34` — `role` chỉ lộ khi hết ván hoặc viewer đã chết | Không có cơ chế "phong thánh": treo trúng Sói không xác nhận được lời khai nào |
| **Không biết thành phần vai của ván** | `BotKnowledgeView` (`types.ts:348-395`) không có trường nào cho số lượng vai | Làng không làm được phép trừ "chỉ có 1 Tiên Tri mà 2 người khai" |
| **Bằng chứng bắt buộc có nguồn thật** | `evidence.ts:12-19` `validateEvidence` | Không thể giữ một điểm uy tín trôi nổi rồi nhân ngược vào bằng chứng cũ |

Ràng buộc thứ ba định hình toàn bộ §6.

### 0.3 Phát hiện thêm trong audit (không nằm trong yêu cầu)

- **A1 — LLM có thể tự đi một nước cờ, ngay hôm nay.** `speech-renderer.ts:71-85`: chuỗi `chat` nhà cung cấp trả về đi thẳng ra phòng, không ai kiểm nội dung. Một ý định `ACCUSE` mà mô hình viết thành *"tôi là tiên tri, Nam là sói"* sẽ được `chat-analysis` của mọi BOT khác đọc thành `ROLE_CLAIM` ghim vĩnh viễn — **một lời khai mà lõi deterministic chưa bao giờ quyết, và không seed nào dựng lại được.** Hôm nay vô hại vì chưa có cơ chế nào ăn theo claim. Phase 5 biến nó thành lỗ hổng thật.
- **A2 — Pha bào chữa là đường duy nhất LLM thấy vai thật.** `prompt.ts:147-179` `buildDefensePrompt` nhét `roleContext(view)` vào prompt rồi cho mô hình viết tự do 300 ký tự, không qua lõi, không có trong self-play. Vừa là bề mặt rò rỉ vừa là khoảnh khắc khai vai tự nhiên nhất của cả ván.
- **A3 — `holdSeerEvidence` là luật đã viết mà chưa từng chạy.** `speech-planner.ts:236` khoá bằng chứng soi theo `deceptionRisk.seerRevealRound`, nhưng cả hai preset đều đặt giá trị đó bằng `0` (`weights.ts:662`, `:826`). Nghĩa là một con Tiên Tri hôm nay **có thể** buột ra "tôi soi thấy Nam là sói" mà chưa hề nhận mình là Tiên Tri — câu đó vô nghĩa với cả làng.
- **A4 — Hai bảng chữ tiếng Việt cho tên vai, song song, không ai ràng buộc.** `ROLE_META[role].name` (`shared/src/roles.ts:30`) và `ROLE_PHRASES` (`chat-analysis.ts:31-50`). Hôm nay khớp nhau, nhưng không có gì giữ chúng khớp. Thêm một vai mới là đủ để lời khai của vai đó lặng lẽ không ai đọc được.
- **A5 — `seenEventIds` là hàng đợi có trần** (`memory-store.ts:88-91`, `limits.seenEvents`). Bằng chứng neo vào `sourceId` cũ có thể bị `validateEvidence` từ chối ở cuối ván dài. Mọi bằng chứng sinh muộn phải neo vào **sự kiện mới**, không neo vào message id của lời khai gốc.

---

## 1. Vấn đề

Phe làng không có kênh nào để truyền thông tin. Tiên Tri soi trúng Sói thì **suspicion của riêng nó** lên 100; những người còn lại không biết gì (`docs/bot-ai-phase-2-verification.md` §102-104). Cả ván trôi qua với một người biết sự thật và không có cách nào nói ra.

Đây không phải lỗi phát ngôn. Đây là **lỗ hổng trong mô hình trò chơi**: ma sói là trò chơi thông tin, và phe làng chỉ thắng bằng cách gộp mảnh thông tin của từng người lại. Bỏ mất cơ chế gộp thì mọi vai chức năng của làng chỉ còn giá trị cho chính người giữ nó.

## 2. Mục tiêu

**Mục tiêu chính là chất lượng trải nghiệm, không phải win-rate.** Người chơi đọc khung chat phải thấy một ván ma sói: có người hô lên mình là Tiên Tri, có kẻ nhảy vào phản, và cả bàn phải chọn tin ai.

- **G1.** BOT khai vai được trong chat, và các BOT khác đọc được lời khai đó.
- **G2.** Sói khai láo được — chủ động, không chỉ khi bị dồn.
- **G3.** Làng phân xử được claim bằng bốn tín hiệu công khai: thời điểm, va chạm, kiểm chứng đêm, nhất quán phiếu.
- **G4.** Mật độ 2–4 lời khai một ván ở bàn 12–14 người. Mỗi BOT khai tối đa **một** vai cả ván.
- **G5.** Lời khai của BOT và lời khai của người thật là **cùng một thứ** — cùng đi qua parser, cùng sinh ra phản ứng.
- **G6.** Nhà cung cấp không tạo ra được và không xoá được một lời khai.

## 3. Không làm (Non-goals)

- **N1.** Không hứa win-rate của làng tăng. Chỉ hứa nó không rơi ra khỏi dải 28–68%, và mọi dịch chuyển quá ~5 điểm phải quy được trách nhiệm về một cơ chế.
- **N2.** Không đổi luật lật vai người chết. Nó sẽ làm cơ chế này mạnh lên nhiều, nhưng đó là một quyết định game design riêng.
- **N3.** Không cho Dân Làng khai "tôi chỉ là dân thường". Câu đó không kiểm chứng được, không mang tin, chỉ làm loãng.
- **N4.** Không đoán ngữ nghĩa trong parser. Nới mẫu thì nới từng mẫu, mỗi mẫu một test.
- **N5.** Không vá chỗ Bảo Vệ làm hỏng tín hiệu kiểm chứng đêm (§6.3). Đó là suy luận sai *đúng cách*.
- **N6.** Không thêm bảng điểm belief thứ ba. Uy tín là cách **đọc** `trust` đã có.

---

## 4. Kiến trúc

```
BotRuntime.decideSpeech
  └─ planSpeech()                     ← thêm một nhánh, đặt TRÊN "tự mở lời"
       └─ decideClaim()               [decision/claim-decision.ts — mở rộng]
            → { role, kind: PROACTIVE | UNDER_FIRE | COUNTER, accusedId?, reason }
  → BotSpeechIntention { kind: "CLAIM_ROLE" | "COUNTER_CLAIM", claimedRole, targetId? }
       │
       ▼  tầng server
  renderBotSpeech → LLM viết câu
       └─ CỔNG CLAIM_INTEGRITY: chạy analyzeChat lên chính câu vừa nhận (hai chiều)
            ├─ đạt   → thả ra phòng
            └─ trượt → vứt, dùng bảng mẫu (mẫu được test là luôn đọc ngược được)
       │
       ▼
  Một tin nhắn chat CÔNG KHAI — người đọc bằng mắt, BOT đọc bằng parser
       │
       ▼  mọi BOT khác, ở checkpoint kế
  observe → ingestChat → analyzeChat → memory ROLE_CLAIM / COUNTER_CLAIM
       │
       ▼  ← MẮT XÍCH ĐANG THIẾU
  claim-credibility.ts   phát bằng chứng từ dữ liệu CÔNG KHAI
       │
       ▼
  applyEvidence / applyTrustEvidence
       │
       ▼
  vote-decision  ·  werewolf.threatScore (đã đọc state.claims sẵn)
```

### 4.1 Bốn ranh giới

1. **`decideClaim` là nơi duy nhất quyết định khai vai gì.** Ngày Sự Thật gọi nó; claim trong chat gọi nó; pha bào chữa gọi nó. Một bộ luật, không có bản sao thứ hai để trôi lệch.
2. **Uy tín là hàm thuần của dữ liệu công khai.** Đầu vào chỉ gồm memory claim, `publicVoteHistory`, `lastNightDeaths`, `currentVoteCounts`. **Không bao giờ đọc `knownRoles`.** Có bất biến kiểm (§10).
3. **Prompt ban ngày không biết vai thật.** `buildDaySpeechPrompt` hiện không chứa `roleContext` và sẽ tiếp tục không chứa. LLM chỉ nhận `claimedRole` — đúng cái sắp được nói to giữa phòng.
4. **Pha bào chữa được kéo về lõi** (§8), đóng luôn A2.

### 4.2 File

| File | Việc | Trạng thái |
| --- | --- | --- |
| `bot/decision/claim-decision.ts` | khai hay không, vai gì, kiểu gì | **mở rộng** (đang dở trong working tree) |
| `bot/analysis/claim-credibility.ts` | phát bằng chứng từ tín hiệu công khai | **mới** |
| `bot/conversation/templates.ts` | mẫu câu khai / phản bác, đọc ngược được | sửa |
| `bot/types.ts` | 2 speech kind, `claimedRole`, `myClaim` | sửa |
| `bot/config/weights.ts` | nhóm `claim`, preset `4.0.0` | sửa |
| `apps/server/src/bots/speech-renderer.ts` | cổng `CLAIM_INTEGRITY` | sửa |
| `apps/server/src/bots/prompt.ts` | câu dẫn 2 kind mới; bỏ `roleContext` khỏi bào chữa | sửa |

---

## 5. `decideClaim` — khi nào một BOT khai vai

Trả lời ba câu: **có khai không**, **khai vai gì**, **khai kiểu gì**.

### 5.1 `PROACTIVE` — tôi đang cầm tin, và tin này chỉ có giá trị khi nói ra

**Phía làng.** Điều kiện: đang giữ một kết quả riêng **chỉ đích danh một con Sói** (`SEER`, `APPRENTICE_SEER`, `DETECTIVE`). Soi ra người sạch **không đủ** — nó không chỉ được ai cả. Lời khai đi kèm luôn tên con Sói; một lời khai không mang tin thì chỉ tự biến mình thành mục tiêu cắn.

**Phía Sói (G2).** Đúng **một** con trong bầy được khai láo là Tiên Tri và bịa một kết quả.

- *Ai được khai:* con Sói còn sống có `playerId` nhỏ nhất. Luật cục bộ — mọi con trong bầy tự tính ra cùng đáp án, không cần trạng thái chung, không cần kênh đồng bộ.
- *Bịa tên ai:* **chính người nó đang định bỏ phiếu treo hôm nay.** Không có bộ máy mới; `selectVote` đã chọn sẵn.
- *Cổng:* chỉ từ vòng 2, và qua một cổng xác suất theo `deceptionSkill × riskTolerance`. Không phải ván nào Sói cũng dám.
- *Bằng chứng:* danh sách **rỗng**. Sói không có kết quả soi để mang. Khác biệt này có thật và nó tự lộ ra trong câu chữ.

### 5.2 `UNDER_FIRE` — tôi sắp bị treo, đây là lá bài cuối

Điều kiện: đang dẫn `currentVoteCounts`, hoặc chính là `trialAccusedId`.

- Chỉ **vai chức năng** được khai ở đây. Dân Làng bị dồn vẫn cãi bằng `DISAGREE`/`DEFEND` như cũ (N3).
- Sói bị dồn khai một vai chức năng **chưa ai nhận** — đọc thẳng từ `state.claims`. Nước đi tuyệt vọng, và §6 tính giá cho nó.

### 5.3 `COUNTER` — nó nói láo, và tôi là người biết

Tiên Tri thật đè lên Tiên Tri giả; Sói bị chỉ mặt đè ngược lại. Móc treo đã có: `ROLE_CLAIM_HEARD`, `COUNTER_CLAIM_ON_ME`.

### 5.4 Luật giữ mật độ (G4)

- **Một BOT, một vai, cả ván.** Thêm `myClaim: { role: Role; round: number } | null` vào `BotBrainState`; đã đặt thì không đổi. Lật claim không bị cấm bằng kiểu — §6 tính giá.
- **Khai xong thì thôi.** Không có speech act "nhắc lại lời khai". Khai xong, BOT quay về `ACCUSE` bình thường — nhưng từ lúc đó **được phép** nêu bằng chứng soi.

### 5.5 Bằng chứng soi mở khoá theo lời khai, không theo số vòng

Đổi `holdSeerEvidence` (`speech-planner.ts:236`, xem A3): thay điều kiện "vòng < `seerRevealRound`" bằng **"chưa khai vai"**.

Chưa khai thì Tiên Tri **vẫn bỏ phiếu đúng con Sói**, nhưng phải nói một lý do khác. Lúc nó quyết khai, vai và kết quả cùng bung ra một lượt. Rẻ — chỉ đổi điều kiện của một bộ lọc đã tồn tại — nhưng nó biến lời khai thành một **khoảnh khắc** thay vì một dòng thông tin rỉ ra dần.

> **Cạm bẫy tái lập — đọc kỹ chỗ này.** Đổi thẳng điều kiện sẽ **làm hỏng preset `3.0.0`**. Ở v3 trọng số nhóm `claim` bằng 0 nên không BOT nào khai vai bao giờ; điều kiện mới "chưa khai vai" khi đó luôn đúng, tức bằng chứng soi **không bao giờ** được nói ra — trong khi v3 hiện tại `seerRevealRound = 0` nên nó **luôn** được nói ra. Đảo ngược hoàn toàn hành vi, và §11.4 sẽ đỏ.
>
> Điều kiện đúng: `holdSeerEvidence = (nhóm claim đang bật) ? chưa khai vai : vòng < seerRevealRound`. Với v3 vế phải giữ nguyên từng bit; luật mới chỉ sống ở v4. Đây là cùng thủ pháp mà Phase 4 dùng cho `triggerFreshnessRounds = 0`.

---

## 6. `claim-credibility.ts` — làng phân xử thế nào

Luật `validateEvidence` (§0.2) giết chết cách làm hiển nhiên: giữ một điểm `credibility` trôi nổi rồi nhân ngược vào bằng chứng cũ. Không sự kiện nào neo nó, và sửa điểm cũ là viết lại lịch sử.

Nên lật ngược:

> **Uy tín không phải một con số. Nó là một chuỗi bằng chứng, mỗi mảnh neo vào một sự kiện công khai có thật, phát ra đúng lúc sự kiện đó xảy ra.**

Làng không chấm điểm lời khai. Làng **quan sát nó qua thời gian**, và mỗi lần thực tế nói thêm một câu thì niềm tin dịch một nấc.

### 6.1 Bốn tín hiệu, bốn cái neo

| Tín hiệu | Neo vào | Phát lúc | Đổi cái gì |
| --- | --- | --- | --- |
| **S1 Thời điểm** | message id của chính lời khai | ngay khi nghe | nghi ngờ người bị chỉ tên ↑ · tin tưởng người khai ↑ — **cả hai nhân hệ số thời điểm**; khai lúc đang dẫn phiếu thì gần như không được gì |
| **S2 Va chạm** | message id của lời khai **đến sau** | khi claim thứ hai trùng vai | nghi ngờ **cả hai** ↑ (người đến sau nặng hơn) · tin tưởng cả hai ↓ |
| **S3 Kiểm chứng đêm** | `night-death:<vòng>:<id>` | sáng hôm sau | **chết** → tin tưởng ↑ mạnh, nghi ngờ người nó chỉ ↑ mạnh · **sống mà người khác chết** → tin tưởng ↓, và nghi ngờ nó đã gieo được gỡ bớt bằng evidence weight âm · **không ai chết** → **không tín hiệu** |
| **S4 Nhất quán phiếu** | `recap:<vòng>` | khi recap về | khai "X là sói" mà không bỏ phiếu X → nghi ngờ chính người khai ↑ |

Cả bốn cái neo đã nằm sẵn trong `seenEventIds`: `remember()` đẩy mọi `sourceId` vào đó (`memory-store.ts:88`), và `ingestDeaths` / `ingestRecaps` chạy trước `ingestChat` trong `observe()`. Không cần kênh sự kiện mới.

**Neo vào sự kiện mới, không neo vào lời khai gốc** — hệ quả trực tiếp của A5.

**S1 cộng thêm vào `ACCUSE`, không thay thế nó.** Câu *"Tôi là Tiên Tri. Nam là sói."* tách thành hai mệnh đề, và mệnh đề thứ hai vẫn sinh một `ACCUSE` bình thường qua đường đã có (`BotRuntime.ts:770-800`). S1 phát **thêm** một mảnh nữa. Đó là chủ ý, không phải đếm hai lần: chênh lệch giữa "một người bất kỳ chỉ tay vào Nam" và "một người tự nhận Tiên Tri chỉ tay vào Nam" **chính là** mảnh S1 — nó là toàn bộ giá trị của cơ chế này. Hiệu chỉnh sức nặng phải nhìn tổng `ACCUSE + S1`, không nhìn riêng S1.

### 6.2 Không có bảng điểm thứ ba (N6)

Khi cần **đọc** uy tín để ra quyết định — Tiên Tri thật đang cân nhắc có nên đè lên thằng giả, con Sói đang tính lời khai của làng đã ăn chưa — thì đọc thẳng `state.trust[người khai]` cộng với các memory claim. Không accumulator mới, không thêm gì phải lưu, không thêm bảng phải giữ đồng bộ.

### 6.3 Ba chỗ cố ý để làng sai

**Bảo Vệ bẻ gãy S3.** Tiên Tri khai vai, Bảo Vệ che đúng nó, đêm đó người khác chết → làng kết luận nhầm là nó khai láo. **Không vá** (N5): đó là suy luận sai mà người thật mắc suốt, và vá nó thì phải hé cho làng biết đêm qua ai được che — tức ăn gian. Bù lại giữ hình phạt S3 ở mức vừa, không phải án tử.

**Không có phong thánh.** Treo trúng Sói vẫn không xác nhận được ai (§0.2). Làng ở đây vĩnh viễn mù hơn làng ngoài đời một bậc.

**Hoà thì hoà thật.** Hai người khai cùng vai, thời điểm như nhau, đêm không ai chết, phiếu đều nhất quán → uy tín bằng nhau, làng quay về xét hành vi như trước khi có claim. **Không** có luật ngầm nào để làng đoán trúng trong tình huống đó.

---

## 7. Phát ngôn và cổng `CLAIM_INTEGRITY`

### 7.1 Hai speech act mới

`BOT_SPEECH_KINDS` 12 → 14: `CLAIM_ROLE`, `COUNTER_CLAIM`. `SPEECH_TEMPLATES` là `Record<BotSpeechKind, …>` và `intentLine()` kết thúc bằng `const unreachable: never`, nên **trình biên dịch tự chỉ ra đủ mọi chỗ phải bổ sung**.

Thêm `claimedRole?: Role` vào `BotSpeechIntention`. **Không** thuộc `EVIDENCE_FREE_KINDS`: lời khai của Tiên Tri thật phải mang bằng chứng soi.

`NEEDS_SOMEONE` trong `speech-renderer.ts`: `COUNTER_CLAIM` cần người để nhắm; `CLAIM_ROLE` **không** — một Bảo Vệ bị dồn khai vai mà không chỉ ai là câu hợp lệ.

### 7.2 Mẫu câu phải đọc ngược được

Parser chỉ nhận vai **ở đầu mệnh đề**, sau đúng mẫu `"tôi là "`, và **giết cả mệnh đề nếu có từ phủ định**. Hình dạng bị ép:

```
CLAIM_ROLE     "Tôi là {vai}. {tên} là sói."   → parser sinh ROLE_CLAIM + ACCUSE
CLAIM_ROLE     "Tôi là {vai}."                  → khi không có ai để chỉ
COUNTER_CLAIM  "{tên} không thể là {vai}, tôi mới là {vai}."
```

`{vai}` lấy từ **`ROLE_META[role].name`** — đúng bảng giao diện đang hiển thị. Chặn A4 bằng một test quét toàn bộ `ROLES`: với **mọi** vai, câu mẫu dựng từ `ROLE_META` phải được `analyzeChat` đọc ngược ra đúng vai đó. Thêm vai mà quên bảng phiên dịch thì CI đỏ ngay hôm đó.

### 7.3 Cổng hai chiều

Đặt cạnh `echoesRecentOwnLine` (`speech-renderer.ts:129`), chạy chính `analyzeChat` lên câu LLM vừa trả về:

- **Ý định có khai → chữ phải khai.** Không đọc ngược ra đúng vai đã chốt thì vứt, dùng bảng mẫu. Bịt lỗi "lời khai bốc hơi trong im lặng".
- **Ý định không khai → chữ không được khai.** Bịt A1.

> **Bất biến `CLAIM_INTEGRITY` — nhà cung cấp không tạo ra được một lời khai, và không xoá được một lời khai.**

Cùng dòng họ với `SPEECH_SCOPE` của Phase 4, và cùng thủ pháp mà `echoesRecentOwnLine` đã dùng: kiểm đầu ra của nhà cung cấp bằng chính luật của lõi, trượt thì rơi về bảng mẫu.

---

## 8. Pha bào chữa về lõi

`decideDefense(view: RoomSnapshot)` → nhận `SpeechRequest` như mọi đường nói khác.

- Lõi chạy `decideClaim` kiểu `UNDER_FIRE`. Có gì để khai → `CLAIM_ROLE`; không có → rơi về `DISAGREE`/`REPLY`, chỉ khác là prompt biết đây là lượt bào chữa.
- **`roleContext` rời khỏi prompt bào chữa** (đóng A2).
- Pha bào chữa lần đầu có mặt trong self-play, nên được đo và replay như mọi pha khác.

Đây là phần **refactor** chứ không phải phần thêm mới, và nó phình phạm vi. Nêu rõ để đánh đổi được thấy: để nguyên thì pha kịch tính nhất của ván vẫn là đường duy nhất LLM tự do đi nước cờ.

---

## 9. Trọng số

`BotWeights` lên **`4.0.0`** với nhóm mới `claim` (~8 hằng số: sức nặng lời khai, hệ số thời điểm, phạt va chạm, thưởng/phạt kiểm chứng đêm, ngưỡng tin, cổng xác suất Sói khai láo).

Preset `3.0.0` giữ nguyên và **cả nhóm mới đặt về 0** ở đó. Nhánh claim thoát ra **trước khi rút bất kỳ số ngẫu nhiên nào** khi trọng số bằng 0 — đúng thủ pháp `triggerFreshnessRounds = 0` của Phase 4.

---

## 10. Bất biến

Chạy ở mọi mốc chuyển pha của mọi ván, như Phase 4.

| Tên | Nội dung |
| --- | --- |
| **`CLAIM_INTEGRITY`** | LLM không tạo ra và không xoá được một lời khai. Kiểm hai chiều tại điểm phát. |
| **`CLAIM_BLINDNESS`** | `claim-credibility.ts` không import và không chạm `knownRoles`. Kiểm bằng test: cho một BOT ăn cùng một bàn claim với vai thật bị đảo lung tung → uy tín tính ra **không đổi một chữ số**. |
| **`CLAIM_ONCE`** | Không BOT nào để lại hai `ROLE_CLAIM` khác vai trong một ván. |

Toàn bộ bất biến Phase 4 (`ROLE_LEAK`, `SPEECH_SCOPE`, `DEAD_ROLE_REVEALED`, `WOLF_ALLY_SCOPE`, `SEER_RESULT_SCOPE`) giữ nguyên và chạy nguyên.

---

## 11. Kiểm thử

### 11.1 Lớp máy đo được — bốn chỉ số mới trong self-play report

| Chỉ số | Ngưỡng chờ đợi | Bắt cái gì |
| --- | --- | --- |
| `claimsPerGame` | 2–4 ở bàn 12–14 | đúng mật độ G4 — dưới thì cơ chế chết yểu, trên thì thành chợ |
| `counterClaimRate` | `> 0` và `< 1` | có cãi vai thật, nhưng không phải ván nào cũng cãi |
| `claimFollowRate` | `> 0`, báo cáo kèm đối chứng v3 (bằng 0 theo định nghĩa) | tỉ lệ lá phiếu chuyển sang người bị một lời khai đáng tin chỉ mặt, trong vòng ngay sau lời khai. `≈ 0` nghĩa là cả §6 chỉ là số chạy ngầm, người chơi không thấy gì |
| **`claimAccuracy`** | **> 50%** | trong những lần làng *tin* một lời khai Tiên Tri, bao nhiêu lần người đó là Tiên Tri thật |

`claimAccuracy` là chỉ số nhìn trước tiên. Dưới 50% nghĩa là cơ chế đang **giúp Sói nhiều hơn giúp làng** — G2 đã nuốt G1. Nó chỉ tồn tại được trong harness, vì chỉ ở đó mới biết vai thật để đối chiếu.

### 11.2 Lớp phải nhìn bằng mắt

Mục tiêu là chất lượng trải nghiệm, và nó không có thước đo bằng máy. Harness in transcript đầy đủ vài ván có claim; chạy app thật xem một ván. Không con số nào thay được việc này.

### 11.3 Đơn vị

- `claim-decision`: ba kiểu khai, luật chọn con Sói khai láo, `CLAIM_ONCE`, cổng vòng 2.
- `claim-credibility`: mỗi tín hiệu S1–S4 một test, kèm trường hợp **không ai chết đêm** (phải im lặng, không phạt).
- Vòng lặp chữ: quét toàn bộ `ROLES` (§7.2).
- Cổng: LLM trả câu không khai khi ý định có khai → rơi về mẫu; LLM trả câu có khai khi ý định không khai → rơi về mẫu.
- Kịch bản (`bot/scenario.ts`): "Tiên Tri khai → Sói phản bác → đêm Tiên Tri chết → làng treo đúng người nó chỉ".

### 11.4 Tái lập

Preset `3.0.0` phải **tái lập từng bit**. Bằng chứng phải đưa ra: test vân tay v1 (`wolfWins === 22` trên 24 ván) vẫn xanh, và fixture report sinh lại **chỉ thêm khoá, không đổi một con số nào**.

---

## 12. Cân bằng và chi phí

**Cân bằng.** Chạy 300 seed v3 (đối chứng) và 300 seed v4. Dải chấp nhận: **28–68%** tỉ lệ Dân thắng. Không hứa con số tăng (N1); hứa nó không rơi khỏi dải, và dịch quá ~5 điểm thì phải chỉ ra cơ chế, không đổ cho nhiễu.

**Chi phí.** `docs/bot-ai-phase-4-verification.md` §C8: self-play đã từng làm đỏ CI vì chậm (2.6ms → 8.5ms mỗi ván từ v1 lên v3). Claim làm BOT nói thêm, mỗi câu đều qua `chat-analysis`. Đo chi phí mỗi ván trước/sau, và dùng lại đúng hai cách đã có tác dụng — ghi nhớ batch theo phiên bản trọng số, hạn giờ tường minh cho hai test batch — **không nới hạn giờ một cách mù quáng**.

Mốc nền để so: engine 815 test / 3.88s, server 510 test / 1.82s (đo ngày 2026-08-30, có việc dở Ngày Sự Thật trong tree).

---

## 13. Rủi ro và giả định

| # | Rủi ro | Xử lý |
| --- | --- | --- |
| R1 | Sói khai láo nuốt chửng lợi ích của làng | `claimAccuracy` là cổng. Dưới 50% thì hạ cổng xác suất Sói khai láo, hoặc nâng phạt S2/S3. |
| R2 | Parser bảo thủ bỏ sót câu người thật gõ ("tui tiên tri nè", "seer đây") | Chấp nhận có bỏ sót. Nới từng mẫu, mỗi mẫu một test (N4). Không đoán ngữ nghĩa. |
| R3 | Chat thành chợ, lời khai mất sức nặng | `claimsPerGame` là cổng. Vượt 4 thì siết cổng xác suất và điều kiện `PROACTIVE`. |
| R4 | Refactor pha bào chữa làm hỏng đường đang chạy | Test server hiện có cho `decideDefense` phải xanh lại sau khi đổi chữ ký; đỏ ở đó là tín hiệu đúng, không phải hỏng. |
| R5 | Self-play vượt hạn giờ CI | §12. Đo trước/sau, không nới hạn mù. |

**Giả định:** việc dở về Ngày Sự Thật trong working tree được giữ nguyên và sẽ hợp nhất; `decideClaim` dùng chung cho cả hai kênh (§4.1 ranh giới 1). Nếu việc đó bị bỏ, `claim-decision.ts` vẫn đứng độc lập được — chỉ mất một chỗ gọi.

---

## 14. Thứ tự triển khai

1. **Nền kiểu + trọng số.** 2 speech kind, `claimedRole`, `myClaim`, nhóm `claim`, preset `4.0.0` (nhóm mới = 0 ở `3.0.0`). Test tái lập v1/v3 phải xanh **trước khi đi tiếp** — đây là cổng, không phải bước.
2. **Mẫu câu + vòng lặp chữ.** Test quét toàn bộ `ROLES`. Chưa ai phát ra lời khai, nhưng đường đọc ngược đã được bảo đảm.
3. **`decideClaim` mở rộng** + nhánh trong `planSpeech` + `holdSeerEvidence` đổi điều kiện. Lúc này BOT khai được, các BOT khác nhớ được — nhưng chưa ai làm gì với nó.
4. **Cổng `CLAIM_INTEGRITY`** ở server. Đóng A1 **trước khi** cơ chế ăn theo claim được bật.
5. **`claim-credibility.ts`** — bốn tín hiệu. Đây là bước làm cơ chế *có tác dụng*.
6. **Chỉ số self-play** + đo cân bằng + đo chi phí.
7. **Pha bào chữa về lõi.** Để cuối vì nó là refactor và nó phình phạm vi; sáu bước trên đứng được mà không có nó.
8. **`docs/bot-ai-phase-5-verification.md`** — đo cái gì, ra số bao nhiêu, và concern nào còn lại, kể cả concern gây khó chịu.

Mỗi bước phải để suite xanh trước khi sang bước sau.
