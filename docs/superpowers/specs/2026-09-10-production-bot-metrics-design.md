# Đo giao tiếp của bot trên ván thật

Ngày: 2026-09-10

## Mục tiêu

Mọi chỉ số giao tiếp của bot hiện có đều đo trên self-play, mà self-play khác ván thật đúng ở hai chỗ quan trọng nhất:

1. **Câu chữ 100% từ bảng mẫu.** Ở production, câu của bot do nhà cung cấp LLM viết; bảng mẫu chỉ là đường dự phòng. Giọng, độ lặp và tỉ lệ rơi về mẫu của đường LLM **chưa từng được đo trên một ván nào**.
2. **Không có người thật.** Self-play không trả lời được câu hỏi người chơi thấy rõ nhất: *hỏi thẳng một con bot thì nó có đáp không, và nếu không thì vì sao.*

Tính năng này cho mỗi ván thật kết thúc lưu kèm chỉ số giao tiếp của chính nó, tính bằng **đúng định nghĩa self-play đang dùng**, để số của production và số của self-play so thẳng được với nhau, và lọc được theo phiên bản trọng số.

`speech-stats.ts` (bộ đếm trên `/api/health`) không thay được việc này: nó là số của tiến trình, mất khi restart, không gắn với ván nào, và không nói gì về việc bot có đáp người hay không.

## Phạm vi đã thống nhất

- **Chỉ số, không phải biên bản.** Không xuất chat của người chơi thật ra ngoài DB dưới bất kỳ dạng chữ nào.
- **Tổng hợp ngay trong server.** Lúc ván kết thúc, server tự tính và lưu tử số/mẫu số vào một cột Json của `GameResult`. Nội dung chat không bao giờ rời tiến trình server; không dựng thêm quyền admin.
- **Một định nghĩa duy nhất.** Server ghi sự kiện đúng hình dạng self-play và đo bằng chính `collectMetrics`; không viết vòng đếm thứ hai.
- **Tách sổ câu hỏi thành module dùng chung**, để có đủ bảng 7 ngăn cho cả câu hỏi của người thật. Self-play phải giữ nguyên từng bit sau khi tách.
- Không làm A/B preset trên phòng thật. So trước/sau theo `weightsVersion` là giới hạn của bản này.

## Phương án được chọn

Ba phương án đã được cân nhắc:

- **Module đo riêng cho production** — ít việc nhất, nhưng tạo định nghĩa thứ hai cho cùng một chỉ số, sẽ trôi lệch khỏi self-play. Loại.
- **Dùng lại `collectMetrics`, bỏ bảng 7 ngăn của câu hỏi** — đủ để có tỉ lệ đáp, nhưng không nói được *vì sao* bot không đáp người.
- **Dùng lại `collectMetrics` và tách sổ câu hỏi ra module dùng chung** — được chọn. Tốn công nhất vì đụng vào `runSelfPlay`, nhưng cho đủ bảng 7 ngăn và giữ một định nghĩa duy nhất.

Ghi dữ liệu thô rồi đo offline bằng một script có quyền đọc DB production cũng đã được cân nhắc. Nó linh hoạt hơn (tính lại được ván cũ khi thêm chỉ số mới), nhưng buộc chat của người chơi rời server. Không chọn.

## Kiến trúc

```text
 self-play ─┐                                       ┌─ collectMetrics (1 định nghĩa)
            ├─> question-ledger (thuần, dùng chung)  │
 server ────┘         ▲                              │
   discussion-scheduler ──> bot-speech-log ──> [GAME_OVER] bot-metrics ──> GameResult.botMetrics
   service.chat (người) ─┘   (sổ trong phòng,                               ▲
                              qua được restart)          scripts/prod-metrics.ts (chỉ đọc cột này)
```

| Đơn vị | Vị trí | Việc |
| --- | --- | --- |
| `question-ledger.ts` | `packages/game-engine/src/bot/evaluation/` (mới) | Sổ câu hỏi tách khỏi closure `pendingQuestions` của `runSelfPlay`. Thuần, trạng thái là dữ liệu thuần lưu được. |
| `collectMetrics` | `packages/game-engine/src/bot/evaluation/metrics.ts` | Thêm `humanQuestionOutcomes` và `casualToneRateProvider`. Vô hình với self-play. |
| `bot-speech-log.ts` | `apps/server/src/game/` (mới) | Ghi sự kiện ở chỗ bot phát câu, gọi các móc của sổ câu hỏi, mở câu hỏi khi người thật hỏi bot. |
| `bot-metrics.ts` | `apps/server/src/game/` (mới) | Lúc hết ván: dựng `SelfPlayGame` tối thiểu, chạy `collectMetrics`, rút gọn thành `botMetrics`. |
| `prod-metrics.ts` | `apps/server/scripts/` (mới) | Chỉ đọc cột `botMetrics`, lọc, cộng dồn, in báo cáo. |

## Sổ câu hỏi dùng chung

`question-ledger.ts` chuyển nguyên logic `pendingQuestions` / `noteObserved` / `noteSpeechTurn` / `settleQuestions` và hai chỗ trong `emitSpeech` (đánh dấu *bị chặn*; đánh dấu *đã đáp* / *nói chuyện khác* rồi mở câu hỏi mới) ra khỏi `runSelfPlay`. **Cùng điều kiện, cùng thứ tự; chỉ đổi chỗ ở.**

```ts
interface QuestionLedgerState {
  open: PendingQuestion[]; // cùng hình dạng PendingQuestion hiện có, cộng `humanAsker`
}

openQuestion(state, { messageId, askerId, targetId, round, humanAsker? })
noteObserved(state, targetId, visibleMessageIds, memories)   // sau observe
noteSpeechTurn(state, targetId, isInChat)                    // trước decideSpeech
noteBlocked(state, replyToMessageId, targetId, reason)      // câu đáp bị phòng chặn
noteSpoke(state, actorId, replyToMessageId, isInChat)        // sau khi phát
settle(state): QuestionOutcomeEvent[]                        // chốt rồi xoá sổ
```

Trạng thái là object thuần thay cho `Map` trong closure, để server lưu được vào envelope. Thứ tự duyệt phải giữ đúng thứ tự chèn của `Map` hiện tại — nếu đổi, `QUESTION_OUTCOME` đổi thứ tự và ảnh vàng sẽ bắt được.

Sự kiện `QUESTION_OUTCOME` thêm trường tuỳ chọn `humanAsker?: true`. Self-play không bao giờ đặt nó.

## Thay đổi trong `collectMetrics`

- **`humanQuestionOutcomes: Record<QuestionOutcome, Ratio>`** — gom các `QUESTION_OUTCOME` có `humanAsker`. `directQuestionOutcomes` loại chúng ra, nên bảng cũ vẫn chỉ nói về bot hỏi bot.
- **`casualToneRateProvider: Ratio`** — `looksCasual` chỉ trên các câu `fromTemplate === false`. Đây là giọng của chính nhà cung cấp; `casualToneRate` hiện có trộn cả câu bảng mẫu.

Self-play không có người hỏi và mọi câu đều từ bảng mẫu, nên cả hai ra mẫu số 0 (`null`) mà không đổi con số nào khác. Fixture `docs/fixtures/selfplay-sample.json` sinh lại vì có thêm khoá.

## Luồng dữ liệu trên server

1. **Bắt đầu ván** — cùng chỗ đang gọi `resetMatchChat`: đặt `speechLog = []` và `questionLedger = { open: [] }`.
2. **Bot tới lượt** — hàng đợi chung của thảo luận và phiên xử trong `discussion-scheduler.ts`:
   - sau `runtime.observe(context)` → `noteObserved`
   - trước `plan.speak` → `noteSpeechTurn`
   - `judgeChainPosition` chặn → `noteBlocked`, ghi `SPEECH_BLOCKED`
   - sau `pushChat` → `noteSpoke`, ghi `SPEECH`; câu là `QUESTION`/`ASK_EVIDENCE` nhắm vào người khác → `openQuestion`
3. **Người thật chat** — `service.chat()`, kênh `day`, pha `DAY_DISCUSSION` hoặc `DEFENSE`: chạy `analyzeChat` trên đúng câu đó với danh sách người chơi của engine; mỗi `DIRECT_QUESTION` nhắm vào một bot còn sống → `openQuestion({ humanAsker: true })`.
4. **Chốt sổ** — khi và chỉ khi pha đang rời là `DAY_DISCUSSION`. Luật được hiện thực bằng một phép kiểm pha ở **đầu** `beginVoting` và `beginNight`, trước khi engine chuyển pha — không bằng cách liệt kê lối ra, vì danh sách đó dễ bỏ sót. Lý do phải kiểm pha thay vì chốt vô điều kiện: `beginNight` được gọi từ năm chỗ, và chỉ hai đường *bỏ qua thảo luận* (`submitDiscussionSkip`, `reconcileDiscussionSkip`) là rời thảo luận; ba chỗ còn lại (sau cái chết do bị treo trong `continueAfterDeathResult`, sau `finishHunterShot`, bảng step handler) rời phiên xử/bỏ phiếu. Self-play để câu hỏi của phiên xử tới lần chốt hôm sau, và server phải làm y hệt. Không chốt trong `cancelDiscussionScheduler`, vì hàm đó cũng chạy khi khôi phục sau restart (`resume.ts`).
5. **Câu hỏi còn mở khi ván kết thúc** — xử đúng như self-play. Bước đầu tiên của kế hoạch triển khai kiểm self-play có chốt lúc hết ván hay không, rồi làm theo đúng như vậy.
6. **Hết ván** — trong `writeGameResultOnce`: `bot-metrics.ts` dựng `SelfPlayGame` tối thiểu (`events = speechLog`, `roles`, `winner`, `rounds`, `personalWins`; các trường chỉ self-play có thì để rỗng), chạy `collectMetrics`, rút gọn, ghi vào `botMetrics` cùng lệnh `create`.

### Sự kiện `SPEECH` phía server

Dựng đúng các trường `SelfPlayEvent` `SPEECH` mà `collectMetrics` đọc, từ ý định lõi đã chốt và kết quả `renderBotSpeech`: `round`, `actorId`, `messageId` (id tất định `bot-chat:{vòng}:{số}` ở thảo luận, `defense-chat:{vòng}:{số}` ở phiên xử), `speech`, `targetId`, `replyToMessageId`, `chainDepth` (từ `judgeChainPosition`), `tone`, `topic`, `text`, `textFingerprint`, `semanticFingerprint`, `shapeFingerprint` (xoá tên bằng danh sách người chơi của phòng), `evidenceSourceIds`, `fromTemplate` (từ `rendered.fromTemplate`), `claimedRole`.

Chỉ bot sinh sự kiện `SPEECH`. Câu của người thật chỉ đi vào sổ câu hỏi, nên không lẫn vào các tỉ lệ giọng/lặp/nguồn vốn chỉ dành cho bot — `collectMetrics` không phân biệt người với bot.

**Không ghi:** lời thì thầm của ma (`machine.ts`, kênh người chết). Tác giả của nó là hằng số ẩn danh và nó rất hiếm.

## Chỉ số được lưu

| Nhóm | Chỉ số |
| --- | --- |
| Nguồn và giọng | `fromTemplateRate`, `casualToneRate`, `casualToneRateProvider` |
| Lặp | `exactRepetitionRate`, `normalizedRepetitionRate`, `semanticRepetitionRate`, `crossBotRepetitionRate`, `repeatedOpeningRate`, `distinctOpeningRate`, `consecutiveSameTargetRate` |
| Đối đáp | `replyRate`, `directQuestionResponseRate`, `directQuestionOutcomes`, `humanQuestionOutcomes`, `maxDialogueChainLength`, `messagesPerBotPerDay`, `speechBlockedByRoom` |
| Lời khai | `claimsPerGame`, `counterClaimRate` |

Tất cả tính thuần từ `SPEECH`, `QUESTION_OUTCOME` và `SPEECH_BLOCKED`.

**Chưa lưu:** `claimFollowRate`, `claimAccuracy`, `wolfBluffBelievedRate` (đọc sự kiện `VOTE` và vai thật), `silenceRate` (cần danh sách bot còn sống từng vòng). Thêm được sau bằng cách ghi thêm sổ phiếu; khi đó tăng `metricsVersion`.

**Giới hạn cố hữu:** câu hỏi của người thật chỉ vào sổ khi `analyzeChat` nhận ra nó — cùng parser với con bot. Câu nào parser bỏ sót thì vô hình với chỉ số này, nên ngăn `NOT_PARSED` của `humanQuestionOutcomes` luôn bằng 0. Thước cho phần bị bỏ sót vẫn là `humanQuestionSeenRate` trên corpus.

## Mô hình dữ liệu

`schema.prisma`, model `GameResult`:

```prisma
/// Chỉ số giao tiếp của bot trong ván, tính lúc kết thúc. Null với ván ghi
/// trước cột này, ván không có sổ từ đầu, và ván mà việc tính bị lỗi.
botMetrics  Json?
```

Migration: `ALTER TABLE "GameResult" ADD COLUMN "botMetrics" JSONB;`

Hình dạng:

```json
{
  "metricsVersion": 1,
  "weightsVersion": "31.0.0",
  "brain": "gemini",
  "players": 12, "bots": 7, "rounds": 6,
  "truncated": false,
  "recorderErrors": 0,
  "ratios": { "casualToneRateProvider": [30, 36], "crossBotRepetitionRate": [4, 45] },
  "questionOutcomes": {
    "bot":   { "ANSWERED": 5, "NO_TURN": 1 },
    "human": { "ANSWERED": 3, "DECLINED_SPOKE_OTHER": 2 }
  },
  "blocked": { "CHAIN_DEPTH": 0, "REPLIES_PER_MESSAGE": 3 },
  "botDays": [31, 18],
  "maxChain": 3,
  "claims": 4,
  "hadCounterClaim": true
}
```

- `ratios`: mọi chỉ số `Ratio` trong danh sách, dạng `[tử, mẫu]`, kể cả khi bằng `[0, 0]`.
- `questionOutcomes`: số đếm thô của 7 ngăn; mẫu số là tổng các ngăn.
- `botDays`: `[tổng số câu, số cặp (vòng, bot) có nói]` — đủ để tính `messagesPerBotPerDay` sau khi cộng dồn.
- `brain`: `botBrain().name` — tên nhà cung cấp khi chỉ có một, tên ghép `"a->b"` của `FallbackBrain` khi có nhiều, hoặc tên của `randomBrain` khi **không cấu hình nhà cung cấp nào**. Dùng để so khi đổi model hay nhà cung cấp, và để biết ván nào chạy lúc provider đang tắt.
- **Không một chữ nào**: không nội dung, không tên, không id người chơi. Dưới 2 KB mỗi ván.

## Tổng hợp nhiều ván

`scripts/prod-metrics.ts` chỉ `SELECT` cột `botMetrics` (và `createdAt` để lọc), không đọc bảng chat.

- **Cộng tử số và mẫu số** qua các ván, không lấy trung bình các tỉ lệ từng ván — cùng cách báo cáo self-play đang cộng.
- Chỉ cộng các ván cùng `metricsVersion` (mặc định bản mới nhất); báo số ván bị bỏ ra.
- Tuỳ chọn: `--since <ngày>`, `--weights <phiên bản>`, `--min-humans <n>`.
- Báo số ván `truncated`, tổng `recorderErrors`, và số ván theo từng `brain` — trong đó có số ván chạy lúc không có nhà cung cấp nào (xem *Rủi ro về giá trị*).

Phần cộng dồn là một hàm thuần, tách khỏi phần đọc DB.

## Tương thích và persistence

Hai trường mới của `Room`, lưu qua restart theo mẫu `matchChat` (`persistence/serialize.ts` → `persistence/schema.ts` có kiểm `Assignable` hai chiều → `persistence/restore.ts`):

```ts
speechLog?: SelfPlayEvent[] | null;
questionLedger?: QuestionLedgerState | null;
```

- Envelope **không có** các trường này (ván bắt đầu trước khi deploy) khôi phục thành `null`, **không phải** `[]` như `matchChat`. Ván đó lưu `botMetrics = null`: một sổ chỉ có nửa sau của ván cho số sai mà trông như đúng.
- Id câu của bot vốn tất định, nên `replyToMessageId` vẫn nối đúng sau khôi phục.
- Trần sổ: 2.000 sự kiện, bằng `MAX_ARCHIVED_MESSAGES`. Chạm trần thì dừng ghi và đặt `truncated`.

## Xử lý lỗi

| Tình huống | Cách xử lý |
| --- | --- |
| Bộ ghi tự lỗi | Mỗi lời gọi bọc `try/catch` riêng, để một lỗi của bộ ghi không bao giờ làm mất một câu nói. Đếm vào `recorderErrors`. |
| `collectMetrics` hoặc bước rút gọn ném | Bắt lại, `botMetrics = null`, ghi một dòng log JSON theo mẫu `game-result.write-failed`. Dòng kết quả ván vẫn được ghi. |
| Về sảnh (`resetToLobby`) | Bỏ sổ, không tính. |
| Ghi trùng kết quả | Đã có: unique `gameId` và `resultWritten`. |

Chi phí: một lần `analyzeChat` mỗi câu chat của người, một lần `collectMetrics` mỗi ván lúc kết thúc — ngoài luồng chơi, vì `writeGameResultOnce` không được `await`.

## Kiểm thử

**Self-play giữ nguyên từng bit sau khi tách sổ câu hỏi**
- Ảnh vàng: băm toàn bộ ván của mọi preset × ba kiểu bàn (mặc định có trace, bộ bài 12 người có phiên xử, bàn có ghế người), chụp trước khi tách, so sau khi tách. Phép kiểm một lần cho lúc chuyển đổi.
- `collectMetrics` trên cùng batch cho cùng số: JSON cũ bằng JSON mới sau khi bỏ hai khoá mới.
- Các test tái lập và restart hiện có xanh nguyên.

**Server đo đúng thứ self-play đo**
- Test tương đương: một ván self-play, sự kiện đi qua cả `collectMetrics` trực tiếp lẫn bộ dựng `botMetrics`; mọi chỉ số trong danh sách phải bằng nhau.
- `question-ledger`: mỗi ngăn trong 7 ngăn một kịch bản; cờ `humanAsker` đi tới `QUESTION_OUTCOME`; lưu → khôi phục giữa vòng rồi chốt cho ra đúng kết quả như không restart.
- `collectMetrics`: `humanQuestionOutcomes` chỉ đếm câu hỏi của người và `directQuestionOutcomes` không lẫn chúng; `casualToneRateProvider` chỉ đếm câu `fromTemplate === false`.

**Luồng thật trên server** (phòng dựng bằng helper test sẵn có)
- Người thật hỏi bot → mở câu hỏi có cờ; bot đáp → `ANSWERED`; bot không được lượt → `NO_TURN`.
- Chốt chỉ khi rời `DAY_DISCUSSION`; câu hỏi của phiên xử chưa bị chốt ở `beginNight` của ngày thường.
- Bộ ghi ném → câu nói vẫn được phát, `recorderErrors` tăng.
- Restart giữa vòng → kết quả như không restart; envelope không có sổ → `botMetrics = null`.
- Quyền riêng tư: quét JSON `botMetrics` tìm mọi tên và id người chơi của phòng → không thấy cái nào.
- `prod-metrics`: hàm cộng dồn — cộng tử/mẫu, bỏ ván khác `metricsVersion`, lọc `--min-humans`, báo `truncated`.

**Kiểm tay:** test không gọi được nhà cung cấp thật. Sau khi xong, chạy một ván local có bật provider và xác nhận `casualToneRateProvider` có mẫu số khác 0. Nếu không có key để chạy, ghi rõ bước này là chưa kiểm.

## Ngoài phạm vi

- Biên bản ván thật cho người chấm, và mọi hình thức xuất chat của người chơi ra ngoài DB.
- A/B preset trên phòng thật — kể cả bench lại tám ô giao tiếp đã xoá. Tính năng này là điều kiện cần cho việc đó, chưa phải việc đó.
- Tính lại chỉ số cho ván cũ khi thêm chỉ số mới: cái giá của việc tổng hợp trong server.
- Chỉ số đọc lá phiếu và `silenceRate`; lời thì thầm của ma.
- Chính sách thời hạn lưu chat. Hiện `GameResult` và `MatchChatMessage` không có thời hạn nào; đó là một vấn đề riêng, tính năng này không làm nó rộng thêm.

## Rủi ro về giá trị

Tính năng chỉ đáng công khi production có đủ ván có người thật **và** đang bật nhà cung cấp LLM. Nếu một trong hai thiếu, `casualToneRateProvider` và `humanQuestionOutcomes` sẽ có mẫu số rất nhỏ, và bộ đếm của `speech-stats.ts` đã gần đủ. Câu hỏi về lưu lượng thật chưa được trả lời lúc viết spec này — nhưng nó trở thành thứ đo được: báo cáo của `prod-metrics` đếm số ván theo `brain` và theo số ghế người, nên sau vài ngày chạy sẽ biết tính năng có đang đo được gì hay không.
