# Bot Communication — Phase 6 verification (PR 8)

> `NIGHTFALL_BOT_COMMUNICATION_UPGRADE.md` §23 (speech output validation) và
> §24 (anti-repetition), tức PR 8 của §32.
> Trước đó: `docs/BOT_COMMUNICATION_AUDIT.md`, và
> `bot-communication-phase-1..5-verification.md` (PR 1–7).

## 1. Điểm xuất phát: audit đã ghi cả hai mục là XONG

Phase 0 đánh dấu §23 và §24 là **XONG**. Đọc lại kỹ thì cả hai đều đúng một
NỬA, và nửa còn thiếu ở mỗi bên là một lỗ có thật:

| | đã có | thiếu |
| --- | --- | --- |
| §23 | `claimSurvivesRoundTrip` (lời khai), `echoesRecentOwnLine`, `repeatsRecentOpening` | **lệch mục tiêu** — mô hình tố một người mà lõi chưa từng chốt |
| §24 | phát hiện lặp (vân tay ngữ nghĩa / văn bản / mở đầu) | **đổi chiến thuật** — phát hiện xong chỉ biết IM, không biết chuyển hướng |

## 2. Changed files

| File | Việc |
| --- | --- |
| `apps/server/src/bots/speech-renderer.ts` | +`targetSurvivesRoundTrip` (§23) |
| `conversation/speech-planner.ts` | +`redirectTargets`, nhánh 2b (§24) |
| `config/weights.ts` | +`conversation.redirectCandidates`, +`BOT_WEIGHTS_V28` |
| `config/presets.ts` | đăng ký v28 |
| `apps/server/tests/bot-conversation-renderer.test.ts` | +6 test |
| `tests/bot-speech-redirect.test.ts` | mới — 8 test |

## 3. §23 — cổng lệch mục tiêu

Lỗ hổng: lõi chốt "tố Chi", mô hình viết "tôi nghi Bình". Ba cổng cũ đều cho
qua — không phải lời khai, không nhại câu cũ, không trùng cách mở đầu — nên câu
đó ra thẳng phòng, và mọi BOT khác `analyzeChat` nó thành một cáo buộc nhắm vào
người mà lõi **chưa bao giờ chọn**. Belief của cả bàn dịch theo một nước đi
không seed nào dựng lại được.

Đúng thứ §20 cấm ("Do not change selected intent") và §33 gọi tên ("do NOT ask
LLM to choose votes) — chỉ khác là nó lọt qua đường LỜI NÓI thay vì đường hành
động.

Luật: mọi `ACCUSE`/`DEFEND` mà câu chữ đọc ra phải trỏ đúng `intention.targetId`;
ý định không nhắm ai thì không được đọc ra cáo buộc nào. Chỉ xét memory câu THẬT
SỰ sinh ra — cổng nói "đừng tố nhầm người", không nói "phải tố".

Đặt trong `passesGates`, tức chỉ gác đường NHÀ CUNG CẤP, y như ba cổng kia.
Bảng mẫu có luật riêng (`avoidFingerprints`, cộng một test quét toàn bảng); cho
bảng mẫu đi qua đây thì một lần trượt sẽ không còn đường lui nào. Trượt → hỏi
lại đúng một lần → mẫu câu, đúng §23 ("Fail → safe fallback. Không retry vô hạn").

**1.108 test server PASS** sau khi thêm cổng: nó không chặn nhầm câu hợp lệ nào
đang có.

## 4. §24 — cạn chuyện thì đổi chiến thuật

Trước PR 8, cơ chế chống lặp chỉ biết NÓI KHÔNG: ý đã nói thì ứng viên bị loại,
và khi cả `ACCUSE` lẫn `QUESTION` về mục tiêu phiếu đều cũ thì BOT im. §24 đòi
thứ khác — đổi chiến thuật, ô đầu tiên trong danh sách của nó là "hỏi một người
khác".

Nhánh 2b làm đúng thế, với ba ràng buộc:

1. **Còn dư lượt nói trong vòng** (xem §5 — đây là chỗ suýt hỏng).
2. **Chỉ hỏi người BOT đang thật sự nghi** (`suspicion > 0`). Ranh giới giữa
   "đổi chiến thuật" và "nặn ra một câu để né cơ chế chống lặp".
3. Sắp theo `(nghi giảm dần, id tăng dần)`, cắt theo `redirectCandidates`.

Chú thích sẵn có ở nhánh "Hết ý" từ Phase 4 cảnh báo đúng cái bẫy này: *"Nếu chỗ
này cố nặn ra một câu khác để tránh trùng, chỉ số lặp sẽ đẹp lên trong khi chất
lượng hội thoại tệ đi - và không ai nhìn thấy điều đó trong báo cáo."* §5 dưới
đây là chuyện cảnh báo đó thành hiện thực.

## 5. Bản đầu LÀM HỎNG — chẩn đoán và sửa

Bench bản đầu (chưa có ràng buộc #1), 1.200 ván:

```text
directQuestionResponseRate   55,06%  ->  51,12%   (-3,94 điểm)
NO_TURN                      23,09%  ->  27,48%   (+4,39 điểm)
messagesPerBotPerDay           2,32  ->    2,42
```

Chẩn đoán đọc thẳng ra từ `NO_TURN`: BOT tiêu hạn mức lượt nói của vòng vào câu
hỏi tự phát, nên tới lúc có người hỏi thẳng thì **không còn lượt để đáp**. Chỉ số
lặp thì đẹp lên (`consecutiveSameTargetRate` −1,27 điểm) — đúng nguyên văn cái
bẫy đã được cảnh báo.

Sửa: câu chuyển hướng là thứ RẺ NHẤT BOT có thể nói (nó là cái nói ra khi đã hết
ý), nên nó **không bao giờ được tiêu lượt cuối cùng của vòng**. Chừa lại một
lượt cho việc đáp người khác. Hạn mức 1 nghĩa là không bao giờ chuyển hướng —
đúng ý: bàn chỉ cho mỗi BOT một câu thì câu đó phải để dành cho người đang nói
với nó.

Kết quả sau khi sửa:

```text
directQuestionResponseRate   51,12%  ->  54,68%   (thu lại 3,56 / 3,94 điểm)
NO_TURN                      +4,39đ  ->  +0,21đ   (so v27)
```

## 6. Benchmark — self-play 1.200 ván, paired seeds (`comm-pr8`)

| metric | v21 (default) | v27 | v28 chưa sửa | **v28** |
| --- | --- | --- | --- | --- |
| villageWinRate | 51.83% | 50.75% | 48.75% | **49.75%** |
| silenceRate | 21.78% | 20.22% | 19.94% | 20.12% |
| semanticRepetitionRate | 0.92% | 1.09% | 1.34% | 1.18% |
| speechRepetitionRate | 3.74% | 3.81% | 3.44% | 3.48% |
| consecutiveSameTargetRate | 25.68% | 26.20% | 24.93% | **25.24%** |
| directQuestionResponseRate | 55.67% | 55.06% | 51.12% | 54.68% |
| distinctOpeningRate | 99.72% | 99.65% | 99.56% | 99.63% |
| replyRate | 39.80% | 39.72% | 38.96% | 39.79% |
| villageVoteAccuracy | 49.88% | 49.51% | 49.09% | 49.41% |
| claimAccuracy | 80.80% | 81.38% | 81.32% | 81.67% |
| invariant violations | 0 | 0 | 0 | 0 |
| failedSeeds (replay) | 0 | 0 | 0 | 0 |

`villageWR` v28 − v27 = **−1,00 điểm (z=−0,49)** — nhiễu.

## 7. Đọc kết quả — thẳng thắn

- **§23 là phần đáng giá nhất của PR này, và nó không có chỉ số nào cả.** Một
  cổng chặn hiếm khi hiện ra trong bench: nó chỉ nổ khi nhà cung cấp viết sai,
  mà self-play chạy bằng bảng mẫu nên **không gọi nhà cung cấp lần nào**. Bằng
  chứng duy nhất của nó là 6 test, trong đó có một test dựng đúng kịch bản lệch
  mục tiêu và khẳng định câu bị chặn. Đó là đủ cho một cổng an toàn, nhưng phải
  nói rõ: **bảng ở §6 không đo §23 một chút nào.**
- **§24 đạt đúng mục tiêu đã tuyên bố**: `consecutiveSameTargetRate` 26,20% →
  25,24%. BOT bớt bám một người.
- **Không tuyên bố cải thiện win-rate.** −1,00 điểm, z=−0,49. **v28 KHÔNG đặt
  làm mặc định** (giữ v21).
- **`semanticRepetitionRate` TĂNG 0,09 điểm** dù PR này nói về chống lặp. Không
  mâu thuẫn: nhánh mới sinh thêm ý định `QUESTION`, và chính chúng cũng vào cửa
  sổ chống lặp. Đổi một loại lặp lấy một loại khác, và tổng thì gần như đứng yên.
- **Bài học của §5 quan trọng hơn con số của §6.** Một cơ chế "chống lặp" cải
  thiện đúng chỉ số lặp trong khi phá một chỉ số khác nặng gấp bốn lần là dạng
  hỏng khó thấy nhất — và nó chỉ lộ ra vì `directQuestionOutcomes` tách được
  `NO_TURN` khỏi `DECLINED_*`. Chỉ số gộp sẽ giấu mất chẩn đoán.

## 8. Known limitations

1. §23 không được self-play chạm tới (xem §7). Muốn đo thật thì cần một harness
   chạy nhà cung cấp thật và đếm tỉ lệ trượt từng cổng — chưa có.
2. Không có chỉ số nào đếm **cổng nào chặn bao nhiêu lần** trong ván thật.
   `speech-stats.ts` đã đếm `source` (provider / provider_retry / template)
   nhưng không tách theo lý do trượt.
3. `redirectCandidates = 2` chưa qua quét tham số.
4. Ràng buộc "chừa một lượt" dùng `messagesPerBotPerRound` của LÕI. Server có
   lịch riêng (`discussion-scheduler`), nên hai bên có thể lệch nhau về việc
   "còn mấy lượt" — cùng loại lệch mà `chain-limits.ts` đã ghi nhận cho trần
   chuỗi.
5. §24 mới làm ô ĐẦU trong danh sách của nó ("ask another player"). Bốn ô còn
   lại — `compare two players`, `summarize contradiction`, `redirect`,
   `ask X` theo nghĩa hẹp — chưa có, và ba trong số đó cần speech kind mới.
6. v28 chưa đủ bằng chứng để mặc định.
