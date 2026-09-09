# Bot Communication — Phase 1 verification

> `NIGHTFALL_BOT_COMMUNICATION_UPGRADE.md` §35 (First implementation task),
> tương ứng PR 1–3 của §32. Audit gốc: `docs/BOT_COMMUNICATION_AUDIT.md`.
>
> Phạm vi: **quyết định giao tiếp**, không phải chất lượng câu chữ. Prompt LLM
> KHÔNG bị đụng tới trong phase này — đó là điều kiện §35 đặt ra.

## 1. Changed files

| File | Việc |
| --- | --- |
| `docs/BOT_COMMUNICATION_AUDIT.md` | mới — Phase 0 |
| `packages/game-engine/src/bot/conversation/conversation-state.ts` | mới — `ConversationState`, `speechUrge` |
| `packages/game-engine/src/bot/conversation/speech-planner.ts` | cổng tự mở lời đọc `speechUrge` |
| `packages/game-engine/src/bot/config/weights.ts` | +2 trường `ConversationWeights`, +`BOT_WEIGHTS_V23` |
| `packages/game-engine/src/bot/config/presets.ts` | đăng ký v23 |
| `packages/game-engine/src/index.ts` | export module mới |
| `packages/game-engine/tests/bot-conversation-state.test.ts` | mới — 20 test |

## 2. Existing modules reused (không viết lại)

- `analysis/discussion-graph.ts::buildDiscussionGraph` → `PressureEpisode` là
  nguyên liệu duy nhất của áp lực. Không parse lại chat.
- `analysis/chat-analysis.ts` → `DIRECT_QUESTION` memory là nguồn duy nhất của
  danh sách câu nợ.
- `conversation/speech-memory.ts` → `hasReplied`, `speechCountInRound`.
- `belief/player-assessment.ts` → giữ nguyên; §8 CommunicationProfile để lại
  cho PR 6.

## 3. New communication state

`ConversationState` (thuần, DẪN XUẤT — không byte nào vào `BotBrainState`):

```text
pressureOnMe        0..1   §7
pressureTrend       rising | stable | falling
pressureByPlayer    id -> 0..1 (chỉ người > 0)
floor               IGNORED | SAFE | UNDER_PRESSURE | CENTRAL | DOMINANT   §12
unansweredQuestions { messageId, askerId, round, ageInRounds }[]           §6
myMessagesThisRound / myShareOfVoice
```

`speechUrge(conversation, unspokenEvidence, weights) -> 0..1` (§11):

```text
(evidenceValue + selfDefenseNeed + questionDebt + socialOpportunity) / 4
  - (redundancy + overexposure) / 2
```

## 4. New intents

**Không có.** Đúng chủ đích: phase này đổi *khi nào* bot nói, không đổi *nó nói
gì*. 14 speech kind và 8 trigger kind giữ nguyên.

## 5. Determinism (§30)

Cổng tự mở lời đổi từ

```ts
if (rng() > state.personality.talkativeness)
```

thành

```ts
if (rng() > min(1, talkativeness + urgencyBoost * speechUrge(...)))
```

**Số lượt rút RNG không đổi.** `speechUrge` thuần. Với `urgencyBoost = 0`
(v1..v22) biểu thức quy về đúng ngưỡng cũ, nên mọi preset cũ replay từng bit —
`--verify-replay` 0 failedSeeds ở cả hai bản, và 4.799 test cũ vẫn xanh.

`ConversationState` chỉ được dựng khi `urgencyBoost > 0`: bảng không ai đọc là
tiền trả cho không.

## 6. Tests

```text
packages/game-engine  100 file, 4.799 test PASS   (0 mới hỏng)
  bot-conversation-state.test.ts  20 PASS
npm run lint          4 workspace XANH
```

20 test mới phủ: áp lực theo số người tố, người bênh gỡ áp lực, trend
rising/falling/stable, áp lực lên người khác, nợ câu hỏi sống lâu hơn cửa sổ
trigger và hết hạn đúng vòng, đáp rồi thì hết nợ, cửa sổ 0 tắt cơ chế, năm ô
floor, sáu tính chất của `speechUrge` (kể cả trần `[0,1]`), và ba test cổng
SPEAK/WAIT so v21 với v23.

## 7. Benchmark — self-play 1.200 ván, paired seeds (`comm-big`)

| | v21 (default) | v23 | delta |
| --- | --- | --- | --- |
| villageWinRate | 51.33% | 52.75% | **+1.42 pt, z=+0.69** |
| silenceRate | 21.34% | 20.41% | −0.93 pt |
| directQuestionResponseRate | 55.82% | 55.69% | −0.13 pt |
| speechRepetitionRate | 3.42% | 3.46% | +0.04 pt |
| semanticRepetitionRate | 0.93% | 1.02% | +0.09 pt |
| exactRepetitionRate | 0.08% | 0.09% | +0.01 pt |
| distinctOpeningRate | 99.72% | 99.65% | −0.07 pt |
| villageVoteAccuracy | 49.91% | 50.05% | +0.15 pt |
| claimAccuracy | 80.57% | 79.13% | −1.44 pt |
| staleEvidenceRate | 0.17% | 0.08% | −0.09 pt |
| invariant violations | 0 | 0 | — |
| failedSeeds (replay) | 0 | 0 | — |

`directQuestionOutcomes` (v21 → v23): ANSWERED 55.82→55.69,
DECLINED_SILENT 2.39→2.37, DECLINED_SPOKE_OTHER 18.35→18.94, NO_TURN 23.43→22.99.

## 8. Đọc kết quả — thẳng thắn

- **Không tuyên bố cải thiện win-rate.** z=+0.69 là nhiễu. Một batch 400 ván
  chạy trước đó cho **−4.75 pt** theo hướng ngược lại; batch 1.200 ván lật dấu.
  Đó chính là lý do phải chạy batch lớn, và là lý do **v23 KHÔNG được đặt làm
  mặc định** — nó không đạt tiêu chí §40 của `BOT_AI_CONTINUE_UPGRADE` mà v21
  đã đạt. v23 tồn tại làm mốc A/B, đúng kỷ luật của v19/v20/v22.
- **Hiệu ứng đo được và nhất quán là im lặng giảm ~0,9 điểm mà lặp lại không
  tăng** (cả ba chỉ số lặp đổi dưới 0,1 điểm). Đó đúng là thứ §11 đòi: bot nói
  thêm ở những lượt *có lý do*, không nói thêm bừa.
- **`directQuestionResponseRate` gần như đứng yên** (−0,13), trong khi
  `DECLINED_SPOKE_OTHER` nhích lên +0,59. Nghĩa là phần "nói thêm" hiện chảy vào
  đường TỰ MỞ LỜI chứ không vào đường trả lời. Hợp lý — phase này chỉ đụng cổng
  tự mở lời; biến `unansweredQuestions` thành một lựa chọn đáp/né/hỏi-ngược có
  chủ đích là PR 4 (§13, §14). Spec §28 cũng nói rõ: đừng tối ưu chỉ số này lên
  100%.
- `claimAccuracy` −1,44 pt: các ván phân kỳ hoàn toàn từ lượt rút đầu tiên khác
  ngưỡng, nên mọi chỉ số hạ nguồn đều dịch. Không quy nhân quả cho một chỉ số
  đơn lẻ ở n=1.200.

## 9. Known limitations

1. `speechUrge` cho bốn số hạng dương trọng số bằng nhau, một nút vặn chung
   (`urgencyBoost`). Tách trọng số riêng khi có benchmark chỉ ra số hạng nào
   kéo sai — không phải trước đó.
2. Ngưỡng phân loại `FloorStatus` là hằng số module, chưa phải `BotWeights`.
3. `unansweredQuestions` mới chỉ *ảnh hưởng* quyết định nói/không nói. Chưa có
   ANSWER/DEFLECT/COUNTER_QUESTION/IGNORE (§14), chưa phân loại câu hỏi (§13).
4. Chưa đụng §8 persuadability / §15 NarrativeMemory / §17 wolf bluff scoring.
5. Chưa có metric riêng cho pressure/floor trong `evaluation/metrics.ts`.
6. v23 chưa đủ bằng chứng để mặc định. Cần protocol 5×1.000 ván paired seeds
   như v21 đã làm trước khi cân nhắc nâng.
