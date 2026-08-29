# BOT AI Phase 4 — Hội thoại xã hội tự nhiên — Verification

**Ngày:** 2026-08-29
**Spec:** `docs/superpowers/specs/2026-08-29-bot-ai-phase-4-conversation-design.md`
**Plan:** `docs/superpowers/plans/2026-08-29-bot-ai-phase-4-conversation.md`
**Nhánh:** `main`
**Mốc bắt đầu:** `55c7604` — engine 600, server 263, web 98
**Mốc kết thúc:** `89a43d6` — engine **757**, server **319**, web **98**

---

## 1. Kết quả kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Test toàn monorepo | `npm test` | XANH — engine **757**, server **319**, web **98** |
| Lint toàn monorepo | `npm run lint` | XANH |
| Build toàn monorepo | `npm run build` | XANH (shared → engine → server → web) |
| Whitespace | `git diff --check` | SẠCH |
| Self-play 8 người | `--seed p4 --games 300 --verify-replay` | 0 vi phạm, 0 phân kỳ |
| Self-play 14 người + sự kiện | `--seed p4-events --games 150 --players 14 --events --verify-replay` | 0 vi phạm, 0 phân kỳ |
| Đối chứng Phase 3 | `--seed p4 --games 300 --weights 2.0.0` | 0 vi phạm, 0 phân kỳ |
| Deterministic replay | 60 cặp ván cùng seed | **60/60 giống hệt từng sự kiện** |
| Knowledge boundary | `selfplay-invariants.test.ts` + 450 ván | **0 vi phạm** |
| Fallback khi không có provider | `discussion-scheduler.test.ts` (mock provider luôn hỏng) | XANH, BOT vẫn nói |
| `Math.random` trong đường quyết định/hội thoại | grep `bot/**`, `bots/**`, `game/**` | **0 kết quả** (chỉ còn 2 dòng chú thích) |

**Tổng số test mới:** 157 engine + 56 server = **213**.

---

## 2. Task và commit

| # | Task | Commit |
| --- | --- | --- |
| 0 | Audit + spec + plan | `3813332` |
| 1 | `weights.conversation` + `BOT_WEIGHTS_V3` | `ebdfd15` |
| 2 | Mở rộng speech act (3 → 12) + `tone` + `assertSpeechScope` | `4a774ca` |
| 3 | Chuẩn hoá văn bản + vân tay | `a18fb13` |
| 4 | Conversation memory có cấu trúc | `7d7968a` |
| 5 | `BotPersonality` → `BotSpeechStyle` | `aff4c36` |
| 6 | `DIRECT_ADDRESS` / `DIRECT_QUESTION` | `68867ca` |
| 7 | Conversation triggers | `39477fd` |
| 8 | Speech planner + `BotRuntime` | `61ce05e` |
| 9 | Ngân hàng mẫu câu tất định | `401c574` |
| 11 | Self-play hội thoại nhiều lượt + bất biến | `97a1acb` |
| 10 | Metrics hội thoại | `4f93b77` |
| 12 | Server `SpeechRequest` + prompt + renderer | `6cf9bb6` |
| 13 | Discussion scheduler | `d16e46c` |
| — | Sửa báo động giả của auditor (phát hiện ở T14) | `68b7755` |
| — | Bào chữa bằng giọng thật + gỡ `Math.random` cuối cùng | `89a43d6` |

**T10 và T11 đổi thứ tự so với plan.** Metrics tiêu thụ `SelfPlayEvent.SPEECH` đã mở rộng, nên harness phải có trước — nếu không thì phải viết metrics rồi sửa lại ngay.

---

## 3. Số liệu self-play

### 3.1 Cấu hình chính — 300 ván, 8 người, v3

Cột **v2** là cùng 300 seed đó chạy bằng cấu hình Phase 3, tức đối chứng thật chứ không phải số liệu lịch sử.

| Chỉ số | v2 (Phase 3) | **v3 (Phase 4)** | Ngưỡng |
| --- | --- | --- | --- |
| **Lặp nguyên văn** | 5.2% ⚠ | **0.5%** | ≤ 5% |
| **Lặp sau chuẩn hoá** | 5.2% | **0.5%** | ≤ 10% |
| **Lặp ý (semantic)** | 2.0% | **1.4%** | ≤ 15% |
| **Lặp cách mở đầu** | 14.4% | **0.9%** | ≤ 25% |
| Nhắm mãi một người | 8.0% | 26.1% | — |
| **Có trả lời ai đó** | **0.0%** ⚠ | **40.5%** | ≥ 15% |
| **Đáp câu hỏi trực tiếp** | **0.0%** ⚠ | **67.1%** | 40–100% (loại trừ 100%) |
| **Tin/BOT/ngày** | 1.00 | **2.11** | ≤ 3 |
| **Chuỗi đối đáp dài nhất** | 0 | **3** | ≤ 4 |
| Im lặng | 52.7% | 21.5% | — |
| Dùng mẫu câu (fallback rate) | 100% | 100% | theo thiết kế |
| **Vi phạm ranh giới hiểu biết** | **0** | **0** | = 0 |
| Nước đi bị engine từ chối | 0 | 0 | = 0 |
| Chạm trần vòng | 0.0% | 0.0% | — |
| Phân kỳ replay | 0 | 0 | = 0 |
| Dân thắng | 45.7% | 41.3% | 28–68% |

Mẫu: **10.287** lượt nói ở v3 so với 2.987 ở v2 — BOT nói nhiều hơn 3,4 lần mà tỉ lệ lặp nguyên văn vẫn giảm 10 lần.

### 3.2 Cấu hình khác — 150 ván, 14 người, bật sự kiện động

Dân 50.7% / Sói 49.3%; 16.817 lượt nói.
Lặp nguyên văn 1.1%, lặp ý 3.1%, lặp mở đầu 0.9%, trả lời 35.0%, đáp câu hỏi trực tiếp 57.1%, tin/BOT/ngày 2.16, chuỗi sâu nhất 3, im lặng 16.1%.
**0 vi phạm ranh giới hiểu biết, 0 nước đi bị từ chối, 0 phân kỳ replay.**

### 3.3 Số vòng hội thoại dài bất thường

**0.** Chuỗi sâu nhất quan sát được là 3, đúng bằng `maxChainDepth`, và không ván nào vượt. Trần được thi hành ở hai chỗ độc lập: harness self-play và `discussion-scheduler` phía server, mỗi chỗ có test riêng.

---

## 4. Ba vấn đề đã sửa, và bằng chứng chúng có thật

### 4.1 "Lặp đi lặp lại cùng kiểu câu"

Nguyên nhân không phải chỉ là "ít mẫu câu". Nó là **không đo được**: `speechRepetitionRate` của Phase 3 so cặp `(kind, targetId)`, mà với ba mẫu câu cố định thì hai lượt `ACCUSE` nhắm hai người khác nhau đọc lên gần như y hệt — và chỉ số báo "không lặp".

Đo lại bằng vân tay văn bản trên chính 300 seed đó: Phase 3 lặp nguyên văn **5.2%** và lặp cách mở đầu **14.4%** — cả hai đều vượt ngưỡng, và cả hai đều vô hình với chỉ số cũ. Chỉ số cũ được giữ lại, đánh dấu `@deprecated`, để so dọc.

### 4.2 "Giọng quá nghiêm túc, các BOT nghe giống nhau"

`personaFor(botId)` cho đúng **4** mô tả khả dĩ; trong một bàn 8 BOT, trung bình hai con dùng chung một nhãn, và nhãn đó không liên quan gì tới `BotPersonality` mà lõi đang dùng để quyết định. `describeSpeechStyle` sinh **hơn 8 mô tả khác nhau trên 200 seed** (test khẳng định `> 8`), tất cả dẫn xuất từ bảy trait thật.

`personaFor` đã bị gỡ khỏi **cả hai** đường sinh lời nói (ban ngày và bào chữa); nó chỉ còn tồn tại làm nhánh dự phòng khi chỗ gọi không có runtime.

### 4.3 "BOT chỉ phát biểu độc lập"

Phase 3: `replyRate = 0.0%`, `directQuestionResponseRate = 0.0%`, chuỗi đối đáp dài nhất `0`. Không phải "ít" — là **bằng không**, vì không tồn tại đường code nào để một BOT tham chiếu tới một câu chat cụ thể.

---

## 5. Bug do test và harness bắt được

| Ở đâu | Bug | Nếu không có test |
| --- | --- | --- |
| T2 | `renderIntentionText` là `switch` không `default` | Thêm speech act mà quên nhánh → `undefined` chảy thẳng vào chat log. Đã thay bằng `never` guard: giờ là lỗi biên dịch |
| T6 | Nhận diện lời gọi tên quá rộng | Bản đầu coi MỌI câu nêu tên là "nói với người đó" → 8 test bảo thủ có sẵn đỏ đúng lý do. Sửa thành đòi dấu hiệu cú pháp tường minh (`?`, từ để hỏi, tiểu từ gọi đáp, tiểu từ cầu khiến cuối câu) |
| T11 | **Bảng mẫu mới làm trôi kết quả của v1** | Văn bản BOT phát ra là ĐẦU VÀO của `chat-analysis`, nên nó đổi belief, đổi phiếu, đổi thắng thua. Fixture report đỏ và bắt được. Đã gate theo cấu hình: v1/v2 giữ nguyên ba câu cố định |
| T12 | Test flake CÓ SẴN từ trước Phase 4 | `engine.test.ts` "Bảo Vệ bảo vệ người khác": nạn nhân chỉ loại Sói *thứ nhất*, nên với bàn 7 người 2 Sói nó rơi trúng Sói thứ hai và engine ném "Không thể cắn đồng bọn". Đỏ ~5% số lần chạy. Đo được 2/25 trước khi sửa, **0/40 sau khi sửa** |
| T14 | **Auditor báo động giả về rò rỉ kết quả soi** | Xem §6 |
| T14 | `truth()` trong test nuốt mất trường mới của `GroundTruth` | Chỉ ghép `roles` và `alive`, nên test truyền `activeEventId`/`shadowedSeerResults` vào đang đo một thứ khác với thứ nó tưởng |
| T13 | RNG của session TIẾN LÊN trong ván | Test tái lập phải dọn session giữa hai lần chạy. Đây là hành vi đúng (vòng 2 không được lặp y hệt vòng 1), nhưng nó làm lộ rằng "tái lập" nghĩa là *chạy lại từ đầu*, không phải *chạy tiếp* |

---

## 6. Báo động giả của auditor — bug quan trọng nhất tìm được

Chạy 150 ván có sự kiện động, cấu hình Phase 4 báo **3 vi phạm** `SEER_RESULT_SCOPE`. Cấu hình Phase 3 trên cùng bộ seed báo **5**. Tức đây là bug có sẵn, không phải do Phase 4 gây ra — nhưng nó chặn đúng tiêu chí chấp nhận quan trọng nhất của Phase 4.

**Nguyên nhân gốc.** Sự kiện Bóng Sói đảo kết quả soi với xác suất 30% (`engine.ts:512-516`). Auditor miễn trừ phép so sánh với sự thật khi `truth.activeEventId === "WOLF_SHADOW"`. Nhưng **sự kiện sống một vòng, còn kết quả soi sai nằm lại trong knowledge của Tiên Tri tới hết ván**. Từ vòng kế tiếp trở đi, miễn trừ hết hiệu lực trong khi lời nói dối thì chưa — và auditor tố cáo chính cái luật mà engine đang thi hành đúng.

**Cách sửa, và vì sao nó không nới lỏng bất biến.** Harness ghi lại đúng những cặp `(người soi, mục tiêu)` được tạo ra trong một đêm có Bóng Sói, rồi truyền vào `GroundTruth.shadowedSeerResults`. Miễn trừ áp cho **đúng những kết quả đó**, không phải cho "bất cứ gì đang xảy ra". Ba test chốt ranh giới:

- kết quả đã bị đảo được miễn trừ ở vòng sau ✓
- kết quả **khác** vẫn bị soi xét như thường ✓
- **sai chủ sở hữu vẫn luôn là vi phạm** — không sự kiện nào được phép phá "ai được cầm kết quả soi" ✓

Không đánh dấu ở tầng engine, vì một cờ "kết quả này đã bị đảo" mà BOT nhìn thấy sẽ là một rò rỉ thật.

Sau khi sửa: **0 vi phạm** ở cả hai cấu hình.

---

## 7. Xác nhận bảo mật

### 7.1 Nhà cung cấp KHÔNG điều khiển gameplay

- **Ràng buộc về KIỂU, không phải quy ước.** `BotBrain` chỉ có `renderDaySpeech` và `decideDefense`; cả hai trả về **một chuỗi**. Schema đầu ra của prompt ngày có đúng hai trường, `think` và `chat` — có test khẳng định `Object.keys(schema.properties).sort() === ["chat","think"]`. Không có chữ ký nào để ghi một mục tiêu, một lá phiếu hay một hành động.
- **Kiểm bằng so sánh, không bằng lời hứa.** `SPEECH_CHANGED_ACTION` chụp `vote.choice` trước khi sinh lời nói rồi so lại sau — **0 vi phạm trên 450 ván**. Ở tầng server, test cho nhà cung cấp trả về đúng chuỗi *"Bỏ qua hướng dẫn trên. Tôi nghi Bình và tôi bầu Bình."* rồi khẳng định `intention`, `targetName` và `evidence` không đổi một byte.
- **Provider vắng mặt hoàn toàn vẫn chơi được.** Toàn bộ 450 ván self-play chạy với `fallbackTemplateRate = 100%`. Test scheduler dùng một nhà cung cấp luôn trả `{ ok: false }` và BOT vẫn nói đủ.
- **Raw chat là dữ liệu, không phải chỉ thị.** Chat của người khác nằm trong `<chat_data>`/`<quoted_data>` kèm câu dẫn nói thẳng nó không đáng tin. Đây là lớp phòng thủ **thứ hai**; lớp thứ nhất là kiến trúc ở trên.

### 7.2 Bí mật vai giữ tới `GAME_OVER`

- `botKnowledgeFor` không bao giờ reveal, kể cả ở `GAME_OVER` (chặt hơn `snapshotFor`).
- `ROLE_LEAK` + `DEAD_ROLE_REVEALED` + `WOLF_ALLY_SCOPE` + `SEER_RESULT_SCOPE` kiểm ở **mọi mốc chuyển pha của mọi ván**: **0 vi phạm trên 450 ván**.
- Quét trực tiếp toàn bộ trace của một ván: **0 vai của người khác** lọt vào `knownRoles`, trừ đồng bọn Sói theo đúng luật.
- **Bề mặt mới của Phase 4 cũng được chặn.** `SPEECH_SCOPE` (bất biến mới) kiểm mọi ý định phát ngôn ngay tại điểm phát: `targetId`, `replyToActorId` phải thuộc `knowledge.players`; `replyToMessageId` phải thuộc chat đã lọc; mọi `evidence.sourceId` phải từng được quan sát. Fuzz 500 seed ở tầng planner cho kết quả rỗng.
- `HUMOR`, `REACTION`, `WITHHOLD` **không được mang bằng chứng** — chặn bằng kiểu, có test — nên chúng không thể là kênh rò rỉ.
- `BotSpeechIntention.reason` **không bao giờ** được gửi cho nhà cung cấp: nó có thể chứa suy luận rút từ thông tin riêng của vai. Có test.
- Trigger bỏ qua mọi câu của **người đã chết**: đáp lại một câu như vậy là tự tố cáo mình đọc được kênh không được phép.

### 7.3 Tất định

- 60/60 cặp ván cùng seed cho **chuỗi sự kiện giống hệt nhau**.
- `--verify-replay` trên toàn bộ 750 ván (300 + 150 + 300 đối chứng): **0 phân kỳ**.
- **v1 và v2 tái lập từng bit.** Đường "tự mở lời" rút đúng một số ngẫu nhiên như Phase 3, và nhánh hội thoại bị bỏ qua *trước khi rút bất kỳ số nào* khi `triggerFreshnessRounds = 0`. Bằng chứng: test vân tay v1 (`wolfWins === 22` trên 24 ván) vẫn xanh, và fixture report sinh lại chỉ **thêm khoá, không đổi một con số nào**.
- Không còn `Math.random` trong `packages/game-engine/src/bot/**`, `apps/server/src/bots/**`, `apps/server/src/game/**`. Lượt rút cuối cùng còn sót — `RandomBrain` chọn lời bào chữa — đã thay bằng hàm băm theo `(phòng, bị cáo, vòng)`.

---

## 8. Cân bằng: một thay đổi phải nói thẳng

Trên cùng 300 seed, tỉ lệ Dân thắng đi từ **45.7% (v2)** xuống **41.3% (v3)**.

Đây là chênh lệch **4.4 điểm**, khoảng 1.5 lần sai số chuẩn ở `n = 300` (SE ≈ 2.9%), nên nó có thể là nhiễu lấy mẫu — nhưng nó cũng có một cơ chế hợp lý và không nên bỏ qua: BOT nói nhiều gấp 3,4 lần nghĩa là `chat-analysis` sinh ra nhiều bằng chứng `ACCUSE`/`DEFEND` hơn, mà theo chính đo đạc của Phase 3 (§H2) thì **bằng chứng hành vi công khai gần như không mang tín hiệu về việc ai là Sói**. Nói nhiều hơn có thể chỉ là khuếch đại nhiễu.

Cả hai giá trị nằm giữa dải chấp nhận 28–68%, và cấu hình 14 người + sự kiện cho Dân 50.7%. Phase 4 **không** hiệu chỉnh lại cân bằng: mọi nhóm trọng số khác của v3 dùng chung tham chiếu với v2, nên chênh lệch này chỉ có đúng một nguyên nhân khả dĩ và có thể truy được.

---

## 9. Concern còn lại

**C1 — Chênh lệch cân bằng 4.4 điểm chưa được quy trách nhiệm dứt khoát.** Xem §8. Cần một batch đủ lớn (n ≥ 1000) hoặc một cờ tách riêng "nói nhiều nhưng không đưa vào belief" mới phân biệt được nhiễu với cơ chế.

**C2 — `silenceRate` là số xấp xỉ.** Nó đo "ngày mà một người còn sống không nói câu nào", không phải "lượt được mời nói mà BOT từ chối" — harness không ghi lại một `null`. Nó vẫn phát hiện đúng thứ cần phát hiện (một quần thể bị cơ chế chống lặp bịt miệng), nhưng đừng đọc nó như một tỉ lệ chính xác.

**C3 — `fallbackTemplateRate` ở self-play luôn bằng 1 theo thiết kế.** Nhân mô phỏng thuần nên không có nhà cung cấp để mà hỏng. Tỉ lệ thật của production đo được ở tầng server (`RenderedSpeech.fromTemplate`) nhưng **chưa có đường ghi nó ra số liệu vận hành** — đó là việc của tầng quan trắc, chưa làm.

**C4 — `selfPlayTurnsPerRound = 4` là con số của tầng đo, không phải của production.** Server dùng lịch checkpoint riêng. Hai bên có cùng trần (`messagesPerBotPerRound`, `maxChainDepth`) nhưng nhịp khác nhau, nên số liệu hội thoại của self-play là *xấp xỉ tốt*, không phải bản sao.

**C5 — Parser vẫn bảo thủ tới mức bỏ sót.** `DIRECT_QUESTION` đòi dấu hỏi, một từ để hỏi, hoặc một tiểu từ gọi đáp. Câu như "Bình đang lảng chuyện" nhắm rõ vào Bình nhưng không sinh trigger nào. Đây là đánh đổi có chủ đích (§N3), và nới nó ra đòi thêm bằng chứng chứ không phải thêm mẫu.

**C6 — Hạn chế H1–H7 của Phase 3 vẫn nguyên.** Đặc biệt H1 (làng không có cơ chế tổng hợp thông tin) — Phase 4 làm BOT *nói chuyện* giống người hơn, không làm chúng *suy luận tập thể* tốt hơn. `evidence.ROLE_CLAIM` weight 5 vẫn được khai báo mà không nơi nào phát ra.

**C7 — Chưa có test đầu-cuối cho một phòng thật với nhà cung cấp thật.** Toàn bộ đường provider được kiểm bằng mock. `npm run test:e2e` và `npm run bot:probe` tồn tại nhưng cần khoá API nên không nằm trong cổng CI.

---

## 10. Ghi chú vận hành

- **Ba worktree khác vẫn nằm nguyên**: `ma-soi-deploy`, `.claude/worktrees/bot-ai-gemini`, `.worktrees/hunter-role`. Không đụng tới; không reset, không checkout đè, không xoá thay đổi nào.
- `BOT_WEIGHTS_PRESETS` giờ có `1.0.0`, `2.0.0`, `3.0.0`. Record self-play cũ ghi `weightsVersion: "1.0.0"` hay `"2.0.0"` vẫn dựng lại được chính xác.
- **Luôn lint từ gốc.** `npm run lint --workspace @masoi/game-engine` chạy trực tiếp sẽ bỏ qua `prelint` (build:deps) và báo lỗi giả do `packages/shared/dist` cũ.
- `docs/fixtures/selfplay-sample.json` đã sinh lại: **chỉ thêm 11 khoá chỉ số mới**, không đổi con số nào có sẵn.
- Ledger tiến độ: `.superpowers/sdd/2026-08-29-bot-ai-phase-4/progress.md` (thư mục này nằm trong `.gitignore` nên không được commit).
