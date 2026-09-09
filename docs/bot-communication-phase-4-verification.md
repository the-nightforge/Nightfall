# Bot Communication — Phase 4 verification (PR 6)

> `NIGHTFALL_BOT_COMMUNICATION_UPGRADE.md` §8 (communication profile) và §9
> (persuadability), tức PR 6 của §32.
> Trước đó: `docs/BOT_COMMUNICATION_AUDIT.md`,
> `docs/bot-communication-phase-1-verification.md` (PR 1–3),
> `docs/bot-communication-phase-2-verification.md` (PR 4),
> `docs/bot-communication-phase-3-verification.md` (PR 5).

## 1. Changed files

| File | Việc |
| --- | --- |
| `belief/communication-profile.ts` | mới — `CommunicationProfile`, `PersuasionStyle`, `buildCommunicationProfile` |
| `conversation/speech-planner.ts` | `reorderForListener`; kiểu người nghe vào `reason` cho trace |
| `config/weights.ts` | +`conversation.persuasionMinSamples`, +`BOT_WEIGHTS_V26` |
| `config/presets.ts`, `index.ts` | đăng ký / export |
| `apps/server/src/bots/types.ts` | +`SpeechRequest.listener` |
| `apps/server/src/game/machine.ts` | +`listenerFor`, điền vào `SpeechRequest` |
| `apps/server/src/bots/prompt.ts` | +`listenerLines` |
| `tests/bot-communication-profile.test.ts` | mới — 16 test |
| `apps/server/tests/bot-conversation-prompt.test.ts` | +3 test |

## 2. Existing modules reused

Bốn trường đầu của `CommunicationProfile` dùng lại nguyên công thức đã có:
`state.trust/suspicion`, `credibilityOf` (export từ PR 4), `incomingHostilityOf`.
Cùng số mà `PlayerAssessment` đọc, nên hai bảng không bao giờ nói hai chuyện
khác nhau về cùng một người.

`aggression` đọc thẳng `PlayerProfile.aggroRate` — đã có sẵn, đã decay đúng, đã
chuẩn hoá theo vòng. `analyticalStyle` đọc nhãn `questionType` mà **PR 4** gắn
lúc parse; không có PR 4 thì chiều này phải đoán từ raw text, và đó là ranh giới
không được bước qua.

**KHÔNG gọi `projectRoleBeliefs`.** Bảng xác suất vai là thứ đắt nhất trong lớp
belief và không chiều nào ở đây cần tới nó — đó là lý do file này không đơn giản
mở rộng `assessPlayer`.

## 3. Bốn chiều mới + kiểu thuyết phục

```text
aggression       PlayerProfile.aggroRate
followMajority   tỉ lệ phiếu rơi đúng mục tiêu đông phiếu nhất (publicVoteHistory)
analyticalStyle  tỉ lệ câu hỏi loại EVIDENCE/CONSISTENCY trên tổng lượt nói
relationship     SocialEdge hai chiều với chính BOT, -1..1
persuadability   heuristic §9: (followMajority + (1 - aggression)) / 2
```

Chốt một trong bốn ô của §9, lấy ô cao điểm nhất (hoà thì theo thứ tự cố định):

```text
EVIDENCE    <- analyticalStyle
CHALLENGE   <- aggression
CONSENSUS   <- followMajority
CONSISTENCY <- mức thù địch hướng về BOT
```

`CONSISTENCY` chấm bằng thù địch chứ không bằng một chiều "hoài nghi" riêng:
người đang không tin mình thì một lời khẳng định nữa không mua được gì, còn một
chỗ không khớp thì họ tự kiểm được.

## 4. Cái lever — ĐẢO THỨ TỰ, không SINH thêm

```text
EVIDENCE    -> ASK_EVIDENCE, REPLY
CHALLENGE   -> CHALLENGE, DISAGREE
CONSENSUS   -> AGREE, REPLY
CONSISTENCY -> DISAGREE, ASK_EVIDENCE
```

`reorderForListener` chỉ đẩy lên đầu những kind **vốn đã có** trong danh sách
của trigger. `candidatesFor` vẫn là nơi duy nhất quyết định cái gì hợp lệ để đáp
một trigger — người nghe không được phép mở ra một nước đi mà tình huống không
cho phép. Có test khoá điều này.

Ổn định: phần không được ưu tiên giữ nguyên thứ tự tương đối, tức vẫn theo tính
cách của chính BOT. **Người nghe quyết định cái gì lên đầu, tính cách quyết định
phần còn lại.**

Prompt nhận `listener` để chọn CÁCH DIỄN ĐẠT, kèm ranh giới viết thẳng trong
prompt: "Đừng đổi mục tiêu, lập trường hay bằng chứng."

## 5. Determinism (§30)

Không thêm lượt rút RNG nào. Hồ sơ thuần (có test: gọi hai lần cho cùng kết
quả, và không đụng tới `state`); việc đảo thứ tự nằm trong phần chọn ứng viên,
phía trước lượt rút vốn có. Với `persuasionMinSamples = 0` (v1..v25)
`persuasionOf` thoát ra trước khi dựng bất cứ thứ gì.

`reason` mang kiểu người nghe là ghi chú **nội bộ**: nó không tham gia
`speechSemanticFingerprint` và không bao giờ được gửi cho nhà cung cấp.

Bằng chứng: `--verify-replay` 0 failedSeeds ở v21/v25/v26;
**engine 4.884 test PASS / 105 file, server 1.102 test PASS / 132 file**, lint
xanh cả 4 workspace.

## 6. Benchmark — self-play 1.200 ván, paired seeds (`comm-pr6`)

| | v21 (default) | v25 | v26 | v26 − v21 | v26 − v25 |
| --- | --- | --- | --- | --- | --- |
| villageWinRate | 53.17% | 54.17% | 54.00% | +0.83 pt (z=+0.41) | −0.17 pt (z=−0.08) |
| silenceRate | 21.70% | 20.14% | 20.18% | −1.52 pt | +0.04 pt |
| directQuestionResponseRate | 55.58% | 55.40% | 54.94% | −0.64 pt | −0.46 pt |
| replyRate | 40.19% | 39.96% | 39.90% | −0.30 pt | −0.06 pt |
| speechRepetitionRate | 3.40% | 3.36% | 3.53% | +0.13 pt | +0.17 pt |
| semanticRepetitionRate | 0.90% | 0.93% | 0.93% | +0.03 pt | −0.00 pt |
| exactRepetitionRate | 0.06% | 0.08% | 0.08% | +0.02 pt | +0.00 pt |
| distinctOpeningRate | 99.75% | 99.72% | 99.70% | −0.05 pt | −0.02 pt |
| villageVoteAccuracy | 50.94% | 50.77% | 50.75% | −0.19 pt | −0.02 pt |
| claimAccuracy | 80.71% | 81.58% | 81.36% | +0.65 pt | −0.22 pt |
| invariant violations | 0 | 0 | 0 | — | — |
| failedSeeds (replay) | 0 | 0 | 0 | — | — |

### Cơ chế có CHẠY không — đo trực tiếp trên trace, 200 ván

```text
lượt đáp trigger có kiểu người nghe áp dụng     930 / 2.120  (43,9%)
  CONSENSUS                                     677  (72,8%)
  EVIDENCE                                      189  (20,3%)
  CONSISTENCY                                    62  ( 6,7%)
  CHALLENGE                                       2  ( 0,2%)
ván đi khác đường so v25                         96 / 200
```

Thay đổi trong tập speech kind (200 ván, v25 → v26): `ASK_EVIDENCE` 770 → 796,
`CHALLENGE` 566 → 514, `REPLY` 1.960 → 2.039, `AGREE` 316 → 299,
`REACTION` 307 → 277.

## 7. Đọc kết quả — thẳng thắn

- **Cơ chế chạy rộng**: 43,9% số lượt đáp trigger được người nghe định hình, và
  96/200 ván đi khác đường. Khác hẳn PR 5, đây không phải một nhánh nằm im.
- **Không tuyên bố cải thiện win-rate.** v26 − v25 là −0,17 điểm (z=−0,08), tức
  nhiễu; v26 − v21 là +0,83 điểm (z=+0,41), cũng nhiễu, và phần lớn đến từ PR
  3–5 chứ không từ PR 6. **v26 KHÔNG đặt làm mặc định** (giữ v21).
- **Phân bố kiểu bị `CONSENSUS` áp đảo (72,8%), và `CHALLENGE` gần như không bao
  giờ thắng (0,2%).** Đây KHÔNG phải lỗi công thức: trong bàn toàn bot, các bot
  thật sự hội tụ phiếu vào cùng một mục tiêu, nên `followMajority` cao là một
  cách đọc ĐÚNG hành vi của chúng — trong khi `aggroRate` là một tỉ lệ có decay,
  hiếm khi vượt được. Nhưng hệ quả là **nhánh "người nghe hung hăng" của §9
  hiện chưa được benchmark chạm tới**; nó chỉ có unit test đứng sau.
- **`directQuestionResponseRate` giảm 0,46 điểm so v25.** Nhỏ, nhưng đúng hướng
  cần theo dõi: đảo thứ tự ứng viên có thể đẩy một ứng viên vừa bị cơ chế chống
  lặp loại lên đầu, và lượt đó thành im lặng. Chưa đủ lớn để kết luận ở n=1.200.
- **Prompt (`listener`) không được self-play chạm tới chút nào** — harness dùng
  bảng mẫu, không gọi LLM. Nó chỉ có 3 test dựng prompt đứng sau.

## 8. Known limitations

1. Phân bố kiểu lệch nặng về `CONSENSUS` (xem §7). Muốn bốn ô cân nhau thì phải
   chuẩn hoá mỗi chiều theo độ tản THẬT của nó thay vì so bốn số thô — nhưng đó
   là hiệu chỉnh cần một chỉ số đích, và hiện chưa có chỉ số nào đo được "nói
   đúng kiểu người nghe".
2. `persuadability` được tính và đưa vào hồ sơ (§8 đòi) nhưng **chưa nhánh nào
   đọc nó**. Nó là chiều duy nhất trong hồ sơ chưa có consumer.
3. `PREFERRED_FOR` và cách chấm bốn ô là hằng số module, không phải `BotWeights`.
   Chỉ `persuasionMinSamples` là weights.
4. `persuasionMinSamples = 4` chưa qua quét tham số. Ở vòng 1 chưa ai đủ mẫu,
   nên PR 6 không tác động gì tới vòng đầu — đúng ý đồ, nhưng chưa được đo.
5. `aggression` chỉ nhúc nhích sau khi một vòng KHÉP LẠI
   (`BotRuntime.recordAggression` đọc memory của vòng trước), nên nó luôn trễ
   một vòng so với ba chiều còn lại.
6. Chưa đụng §17 wolf bluff scoring, §28 metric cho pressure/floor/strategy/style.
7. v26 chưa đủ bằng chứng để mặc định.
