# Bot Communication — Phase 2 verification (PR 4)

> `NIGHTFALL_BOT_COMMUNICATION_UPGRADE.md` §13 (question classification) và §14
> (response strategy), tức PR 4 của §32.
> Trước đó: `docs/BOT_COMMUNICATION_AUDIT.md`, `docs/bot-communication-phase-1-verification.md`.
>
> Prompt LLM vẫn KHÔNG bị đụng tới. Phase này chỉ đổi Ý ĐỊNH mà lõi chốt khi bị hỏi.

## 1. Changed files

| File | Việc |
| --- | --- |
| `analysis/chat-analysis.ts` | +`QuestionType` (7 ô), +`classifyQuestion`; `DIRECT_QUESTION` mang nhãn trong `data.questionType` |
| `conversation/question-policy.ts` | mới — `questionImportance`, `chooseResponseStrategy`, `intentionFor` |
| `conversation/triggers.ts` | `ConversationTrigger.questionType` |
| `conversation/speech-planner.ts` | tách `sayableEvidence`; đường trigger đi qua `questionDrafts` |
| `belief/player-assessment.ts` | `credibilityOf` đổi thành `export` |
| `config/weights.ts` | +`conversation.questionIgnoreFloor`, +`BOT_WEIGHTS_V24` |
| `config/presets.ts`, `index.ts` | đăng ký / export |
| `tests/bot-question-policy.test.ts` | mới — 37 test |

## 2. Existing modules reused

- Phát hiện câu hỏi: `chat-analysis::parseDirectAddress` (đã có `?`, từ để hỏi,
  đuôi có/không, lời xin ý kiến, chống phủ định và giả định). Không viết lại.
- Uy tín người hỏi: `player-assessment::credibilityOf` — **một** công thức, giờ
  hai chỗ đọc. Không sao chép.
- Áp lực: `ConversationState.pressureOnMe` của PR 1.
- Bằng chứng: `sayableEvidence` gom luật "đã nói rồi" + "giữ kết quả soi tới
  lúc khai" vào một chỗ, thay vì để đường trả lời tự dựng bản sao thứ hai.

## 3. Question types (§13) — 7 ô, không phải 9

```text
ACCUSATION  ROLE  EVIDENCE  CONSISTENCY  VOTE  TARGET  GENERAL
```

Spec gợi ý thêm `MOTIVE` và `DEFENSE`. **Bỏ có chủ đích**: mọi đường đi của
chúng trùng khít `GENERAL`, và một nhãn không nhánh nào đọc là một nhãn sẽ trôi
lệch khỏi hành vi thật. Thêm lại khi có một nhánh chiến thuật cần tới.

Nhãn được gắn ở TẦNG PARSER, không ở planner: `triggers.ts` và
`question-policy.ts` vẫn không đọc một ký tự raw chat nào.

## 4. Response strategies (§14) — 7 ô, 0 speech kind mới

| Strategy | kind | topic | tone | evidence |
| --- | --- | --- | --- | --- |
| DIRECT_ANSWER | REPLY | theo loại | NEUTRAL/FIRM | — |
| PARTIAL_ANSWER | REPLY | theo loại | SOFT | — |
| ANSWER_WITH_EVIDENCE | REPLY | theo loại | FIRM | 1–3 |
| DEFLECT | REPLY | **PROCESS** | NEUTRAL | — |
| COUNTER_QUESTION | QUESTION | theo loại | CURIOUS | — |
| CHALLENGE_PREMISE | CHALLENGE | theo loại | TENSE/FIRM | — |
| IGNORE | — (im lặng) | — | — | — |

14 speech kind hiện có đã đủ. Một kind mới kéo theo một câu dẫn trong
`prompt.ts`, một nhánh trong `templates.ts` và một cổng trong
`speech-renderer.ts` — giá đó chưa cần trả.

**Hai luật cứng**, có test khoá:

1. Bị hỏi vai mà **chưa khai** thì không bao giờ trả lời thẳng, kể cả khi đang
   bị dồn tối đa và người hỏi rất đáng tin. Lời khai là quyết định của
   `decideChatClaim`; để một câu hỏi moi được nó ra là giao nước đi nặng nhất
   của lời nói cho đối thủ.
2. `IGNORE` là kết quả hợp lệ, không phải lỗi (§28).

## 5. Determinism (§30)

Số lượt rút RNG **không đổi** khi chính sách bật:

- `questionDrafts` thuần, trả tối đa MỘT ứng viên, và lượt rút "có đáp không"
  (`responseProbability`) vẫn nằm đúng chỗ cũ.
- `IGNORE` trả `[]` → vòng lặp bỏ qua trigger đó **mà không rút số**. Chỉ xảy
  ra khi `questionIgnoreFloor > 0`, nên v1..v23 không đổi một bit.
- `sayableEvidence` được gọi sớm hơn trước, nhưng nó thuần.

Bằng chứng: `--verify-replay` 0 failedSeeds ở cả v21/v23/v24, và **4.836 test
PASS / 101 file** (4.799 test cũ vẫn xanh sau khi rút `sayableEvidence` ra).

## 6. Hiệu chỉnh — bảng đầu tiên SAI, và số đo bắt được

Bảng `BASE_IMPORTANCE` đầu tiên chạy 0.35 (GENERAL) → 0.9 (ACCUSATION), ngưỡng
0.45. Trên 1.200 ván:

```text
directQuestionResponseRate  55.79%  ->  4.49%     (-51,3 điểm)
DECLINED_SILENT              2.47%  -> 24.54%
DECLINED_SPOKE_OTHER        18.43%  -> 50.75%
```

Nguyên nhân: phần lớn câu hỏi thật trong ván là `GENERAL` và `TARGET`, và cả
hai rơi dưới ngưỡng ngay với một người hỏi **trung tính**. Tức bot bỏ qua gần
như mọi câu — ngược hẳn ý §28 ("đôi lúc" né, không phải "gần như luôn").

Thang được đặt lại (0.55 → 0.95) sao cho người hỏi trung tính
(credibility 0.5) vượt ngưỡng ở **mọi** loại, và `IGNORE` chỉ dành cho câu vu
vơ từ người đã tự làm mất uy tín. Đây là hiệu chỉnh bằng số đo, không phải bằng
trực giác — và là lý do bảng đó có ghi chú dài trong mã nguồn.

## 7. Benchmark — self-play 1.200 ván, paired seeds (`comm-pr4`)

| | v21 (default) | v23 | v24 | v24 − v21 |
| --- | --- | --- | --- | --- |
| villageWinRate | 53.42% | 52.92% | 55.58% | **+2.17 pt, z=+1.07** |
| directQuestionResponseRate | 55.79% | 55.83% | 55.68% | −0.11 pt |
| silenceRate | 21.01% | 20.39% | 20.26% | −0.75 pt |
| replyRate | 40.43% | 39.79% | 39.90% | −0.53 pt |
| speechRepetitionRate | 3.53% | 3.54% | 3.40% | −0.13 pt |
| semanticRepetitionRate | 0.96% | 0.93% | 0.93% | −0.03 pt |
| exactRepetitionRate | 0.07% | 0.08% | 0.05% | −0.02 pt |
| distinctOpeningRate | 99.76% | 99.71% | 99.71% | −0.05 pt |
| consecutiveSameTargetRate | 25.72% | 26.12% | 25.98% | +0.26 pt |
| villageVoteAccuracy | 51.28% | 51.21% | 51.45% | +0.17 pt |
| claimAccuracy | 81.44% | 78.95% | 77.86% | −3.57 pt |
| casualToneRate | 57.82% | 57.98% | 55.51% | −2.31 pt |
| invariant violations | 0 | 0 | 0 | — |
| failedSeeds (replay) | 0 | 0 | 0 | — |

`directQuestionOutcomes` (v21 → v24): ANSWERED 55.79→55.68,
DECLINED_SILENT 2.47→2.48, DECLINED_SPOKE_OTHER 18.43→19.28, NO_TURN 23.30→22.55.

### Phân bố strategy thật (60 ván, đọc từ trace `reason`)

```text
415  GENERAL     -> DIRECT_ANSWER
 22  TARGET      -> DIRECT_ANSWER
  9  EVIDENCE    -> CHALLENGE_PREMISE
  6  CONSISTENCY -> DIRECT_ANSWER
  5  ROLE        -> CHALLENGE_PREMISE
  5  EVIDENCE    -> ANSWER_WITH_EVIDENCE
  4  EVIDENCE    -> PARTIAL_ANSWER
  4  CONSISTENCY -> ANSWER_WITH_EVIDENCE
  3  TARGET      -> ANSWER_WITH_EVIDENCE
  3  ROLE        -> DIRECT_ANSWER      (chỉ khi ĐÃ khai vai)
  3  ROLE        -> COUNTER_QUESTION
  2  GENERAL     -> DEFLECT
  1  VOTE        -> DIRECT_ANSWER / DEFLECT / ANSWER_WITH_EVIDENCE
  1  ROLE        -> DEFLECT
```

Cả 7 loại câu hỏi và 6/7 strategy đều chạy thật. `IGNORE` không xuất hiện ở đây
vì nó không sinh ý định nào để ghi `reason` — nó đo được qua `DECLINED_SILENT`.

## 8. Đọc kết quả — thẳng thắn

- **Không tuyên bố cải thiện win-rate.** +2.17 điểm với z=+1.07 chưa đạt mức có
  ý nghĩa; PR 1 đã cho thấy đúng chỉ số này lật dấu giữa hai batch. **v24 KHÔNG
  đặt làm mặc định** (giữ v21), đúng kỷ luật v19/v20/v22.
- **Tỉ lệ đáp câu hỏi đứng yên (−0,11 điểm), nhưng CÁCH đáp đổi hẳn.** Đó chính
  là mục tiêu của PR 4: cùng lượng câu trả lời, khác loại câu trả lời. Một chỉ
  số không nhúc nhích ở đây là dấu hiệu tốt, không phải dấu hiệu "không có gì
  xảy ra" — phân bố ở §7 mới là bằng chứng.
- **86% lưu lượng là `GENERAL → DIRECT_ANSWER`.** Đây là tính chất của TẦNG ĐO
  chứ không của chính sách: trong bàn toàn bot, câu hỏi sinh từ
  `SPEECH_TEMPLATES` và bảng `QUESTION` ở đó gần như chỉ có câu dò chung chung
  ("{who} nghĩ sao", "sao {who} im thế"). Bàn có người thật, hoặc câu do LLM
  viết, sẽ cho phân bố giàu hơn — nhưng điều đó **chưa được đo**.
- `claimAccuracy` −3.57 pt là chênh lệch lớn nhất trong bảng. Các ván phân kỳ
  hoàn toàn nên không quy được nhân quả ở n=1.200; nếu v24 được cân nhắc nâng
  mặc định thì đây là chỉ số phải điều tra trước.

## 9. Known limitations

1. Phân loại là thuần cú pháp và **không biết câu hỏi nói về AI**. "An ơi, Bình
   có phải sói ko?" bị gắn `ACCUSATION` dù nó hỏi về Bình, nên An có thể bác
   tiền đề thay vì trả lời về Bình. Vô hại nhưng không đúng.
2. `PRESSURE_FORCES_REPLY` và `BASE_IMPORTANCE` là hằng số module. Chỉ
   `questionIgnoreFloor` là weights.
3. `unansweredQuestions` của PR 1 vẫn chỉ tác động vào `speechUrge`; câu hỏi
   cũ hơn `triggerFreshnessRounds` vẫn không được đáp lại. Cố ý — trả lời câu
   của vòng trước là hành vi lạ ở nhịp ván này.
4. Chưa đụng §8 persuadability, §15 NarrativeMemory, §17 wolf bluff scoring.
5. Chưa có metric riêng cho phân bố strategy trong `evaluation/metrics.ts` —
   §7 phải đọc thủ công từ trace.
6. v24 chưa đủ bằng chứng để mặc định; cần protocol 5×1.000 ván paired seeds.
