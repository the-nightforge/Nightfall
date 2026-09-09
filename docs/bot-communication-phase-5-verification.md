# Bot Communication — Phase 5 verification (PR 7)

> `NIGHTFALL_BOT_COMMUNICATION_UPGRADE.md` §16 (claim strategy), §17 (wolf
> communication strategy) và §18 (wolf distancing), tức PR 7 của §32.
> Trước đó: `docs/BOT_COMMUNICATION_AUDIT.md`, và các văn bản kiểm chứng
> `bot-communication-phase-1..4-verification.md` (PR 1–6).

## 1. Changed files

| File | Việc |
| --- | --- |
| `decision/wolf-bluff.ts` | mới — `wolfBluffCandidateScore`, `wolfBluffPick`, `wolfDistanceStance` |
| `decision/claim-decision.ts` | ghế khai láo đi qua `wolfBluffPick` |
| `roles/wolf-team-plan.ts` | `claimant` đi qua ĐÚNG hàm đó |
| `conversation/speech-planner.ts` | `claimTone` (§16); `applyDistancing` (§18) |
| `config/weights.ts` | +3 trường `claim.*`, +`BOT_WEIGHTS_V27` |
| `config/presets.ts`, `index.ts` | đăng ký / export |
| `tests/bot-wolf-bluff.test.ts` | mới — 18 test |

## 2. Existing modules reused

- `wolfBluffSeat` (vòng xoay hash của Phase 3) giữ NGUYÊN và trở thành prior,
  đúng như §17 dặn ("giữ hash làm fallback").
- `credibilityOf` (PR 4), `buildCommunicationProfile` (PR 6),
  `incomingHostilityOf` — không viết lại công thức nào.
- `ConversationState.pressureOnMe` (PR 1) là nguồn duy nhất của "bị dồn tới đâu"
  cho §16.
- `state.myClaim`, `claim-credibility` — không đụng tới hệ thống lời khai như
  §33 dặn.

**PR 6 khép lại một món nợ:** `persuadability` được tính từ PR 6 nhưng chưa
nhánh nào đọc. Giờ nó là một trong bốn số hạng của `wolfBluffCandidateScore`.

## 3. Ba cơ chế

**§17 — ghế khai láo có chấm điểm.** Bốn số hạng, mỗi cái một câu hỏi khác:
uy tín (`credibility`), bàn có dễ nghe theo không (`persuadability`), đã bị soi
chưa (`lowSuspicion`), đang gánh bao nhiêu phiếu (`exposureRisk`, trừ đi). Trộn
với vòng xoay:

```text
final = share x score + (1 - share) x (ghế hash được 1 điểm, còn lại 0)
```

§17 liệt kê `narrativeFit` làm số hạng thứ năm; ở codebase này thứ đo được của
"câu chuyện có khớp không" chính là hồ sơ độ chính xác trong ván, và nó đã nằm
trong `credibility` — tách ra chỉ là đếm cùng một thứ hai lần.

**Cả `decideChatClaim` lẫn `planWolfTeam` gọi ĐÚNG một hàm.** Hai đường tính
ghế khai láo là hai đường sẽ trôi lệch, và lúc trôi thì kế hoạch của bầy nói một
đằng còn con Sói mở miệng là một nẻo. Có test khoá.

**§16 — lời khai có sức nặng.** `PROACTIVE` được nói NHẸ khi không ai đụng tới
mình, dứt khoát dần theo áp lực. `COUNTER` và `UNDER_FIRE` luôn ở bậc cao nhất,
không hỏi áp lực: theo định nghĩa cả hai đã là lúc bị dồn.

**§18 — giữ khoảng cách với đồng bọn.** `wolfDistanceStance` trả `DEFEND` /
`SOFT_DISAGREE` / `IGNORE`, và ứng viên `DEFEND` bị loại tương ứng.

Hàm này **không bao giờ tự chọn `BUS` hay `HARD_DISAGREE`**, dù §18 liệt kê
chúng. Buông một đồng bọn là nước đi GAMEPLAY — nó đi qua lá phiếu, và lá phiếu
đã có chủ ở `werewolf.ts` (bussing) cùng `wolf-team-plan.ts`
(`sacrificeCandidate`). Cho tầng LỜI NÓI quyền quyết cùng chuyện đó là dựng bản
sao thứ hai của một luật đã có. Hai ô kia nằm trong union vì §18 gọi tên chúng
và vì consumer của lá phiếu sẽ cần đúng tên gọi ấy.

## 4. Determinism (§30)

Không thêm lượt rút RNG nào — cả ba cơ chế đều thuần, và cả ba quy về hành vi cũ
ở giá trị `0`. `--verify-replay` 0 failedSeeds ở v21/v26/v27;
**engine 4.902 test PASS / 106 file, server 1.102 test PASS / 132 file**, lint
xanh cả 4 workspace.

Một tính chất riêng của PR này, có test: **hai con Sói nghe cùng một ván phải
chốt cùng một ghế.** Không có kênh liên lạc nào giữa các `BotRuntime`, nên bầy
chỉ "thống nhất" khi mọi con tính ra cùng đáp án — vì vậy mọi đầu vào của
`wolfBluffCandidateScore` đều là thứ cả bầy cùng thấy (phiếu do engine cấp, hồ
sơ dựng từ chat ban ngày).

## 5. Hiệu chỉnh — `share = 0.6` là một tính năng nằm im

Bản nháp đầu đặt `wolfBluffScoreShare = 0.6`. Quét 300 ván:

```text
share = 0.60   ->    2/300 ván đổi lời nói
share = 0.75   ->   35/300
share = 0.85   ->   58/300
share = 0.95   ->   94/300
```

Ở `0.6`, prior vòng xoay (nặng 0.4) lớn tới mức một ghế phải đạt điểm > 0.67
mới lật được nó — gần như không bao giờ xảy ra với hồ sơ trung tính. Tức §17,
deliverable chính của PR này, **chạy đúng 0,7% số ván**.

Chốt `0.85`. Ở MỌI mức đã quét, "cùng một ghế khai hai lượt liền" vẫn bằng `0`:
vai trò chống lặp của vòng xoay hoá ra đã được `state.myClaim` gánh sẵn (khai
rồi thì rời khỏi danh sách ứng viên), nên phần việc còn lại của hash là phá hoà
một cách tất định — và nó vẫn làm đúng việc đó.

## 6. Benchmark — self-play 1.200 ván, paired seeds (`comm-pr7`)

| | v21 (default) | v26 | v27 | v27 − v21 | v27 − v26 |
| --- | --- | --- | --- | --- | --- |
| villageWinRate | 52.25% | 52.33% | 52.25% | ±0.00 pt (z=0.00) | −0.08 pt (z=−0.04) |
| silenceRate | 21.42% | 20.84% | 20.85% | −0.57 pt | +0.01 pt |
| directQuestionResponseRate | 55.58% | 55.08% | 55.16% | −0.42 pt | +0.08 pt |
| claimAccuracy | 78.34% | 77.00% | 75.90% | −2.44 pt | **−1.11 pt** |
| claimFollowRate | 48.37% | 47.14% | 47.39% | −0.98 pt | +0.25 pt |
| counterClaimRate | 58.42% | 55.75% | 57.08% | −1.33 pt | +1.33 pt |
| speechRepetitionRate | 3.40% | 3.61% | 3.55% | +0.16 pt | −0.05 pt |
| semanticRepetitionRate | 1.01% | 1.02% | 0.99% | −0.02 pt | −0.04 pt |
| distinctOpeningRate | 99.70% | 99.74% | 99.71% | +0.00 pt | −0.03 pt |
| villageVoteAccuracy | 50.12% | 50.51% | 50.53% | +0.41 pt | +0.03 pt |
| wolfSelfSabotage | 16.95% | 16.86% | 17.00% | +0.05 pt | +0.14 pt |
| invariant violations | 0 | 0 | 0 | — | — |
| failedSeeds (replay) | 0 | 0 | 0 | — | — |

### Cơ chế nào chạy, và chạy bao nhiêu (300 ván, `share = 0.6` lúc đo attribution)

```text
§16 giọng lời khai      219/300 ván đổi lời nói
§18 giữ khoảng cách      11/300
§17 ghế khai láo          2/300   -> đã hiệu chỉnh lên 58/300 ở share = 0.85
```

### Giọng lời khai, 300 ván (§16)

```text
v26  CLAIM_ROLE    FIRM 457   TENSE 402
v27  CLAIM_ROLE    FIRM 300   TENSE 263   SOFT 293   NEUTRAL 3
     COUNTER_CLAIM  (không đổi: 118 FIRM / 86 TENSE)
```

## 7. Đọc kết quả — thẳng thắn

- **Không tuyên bố cải thiện win-rate.** v27 − v21 là ĐÚNG 0,00 điểm; v27 − v26
  là −0,08 (z=−0,04). **v27 KHÔNG đặt làm mặc định** (giữ v21).
- **§16 là cơ chế chạy rộng nhất PR này**: 73% số ván đổi lời nói, và 34,5% lời
  khai chủ động giờ được nói nhẹ thay vì luôn dứt khoát. `COUNTER_CLAIM` không
  đổi một chữ — đúng thiết kế.
- **Bậc giữa gần như không tồn tại**: `NEUTRAL` chỉ 3/859. Dải áp lực
  `[0.2, 0.4)` quá hẹp trong thực tế, nên thang ba bậc của §16 đang chạy như
  thang hai bậc. Không sai, nhưng nên biết trước khi tin vào chữ "PARTIAL".
- **`claimAccuracy` giảm 1,11 điểm so v26** — chênh lệch lớn nhất trong bảng, và
  là chỉ số duy nhất đáng lo. Nó có một giả thuyết CỤ THỂ, khác với "các ván
  phân kỳ": §17 giờ chủ động chọn ghế khai láo có uy tín cao hơn, nên lời nói
  dối của Sói sống lâu hơn trước khi bị bác. Nếu đúng thì đó là §17 đang LÀM
  ĐÚNG VIỆC của nó, và `claimAccuracy` giảm là cái giá phe làng phải trả — nhưng
  **giả thuyết này chưa được kiểm**, và nó phải được kiểm trước khi cân nhắc
  nâng v27 lên mặc định.
- **§18 gần như không chạy**: 11/300 ván. Tiền đề cần một đồng bọn bị tố CÔNG
  KHAI bằng lời trong khi con Sói kia đang có `trust` đủ cao — hiếm trong bàn
  toàn bot, cùng lý do với PR 5.

## 8. Known limitations

1. §17 chỉ được đo qua "bao nhiêu ván đổi lời nói", **chưa có chỉ số nào nói
   ghế được chọn có nói dối TỐT HƠN không**. Đó là chỉ số PR này thiếu nhất.
2. `claimAccuracy` −1,11 pt chưa được truy nguyên (xem §7).
3. Bậc `PARTIAL` của §16 gần như chết (3/859).
4. §18 không sinh `BUS`/`HARD_DISAGREE` — cố ý (xem §3), nhưng nghĩa là §18 mới
   được thực hiện một nửa: nửa LỜI NÓI. Nửa LÁ PHIẾU vẫn nằm ở `werewolf.ts` và
   chưa đọc `wolfDistanceStance`.
5. Ba hằng số ngưỡng (`DEFEND_WHEN_SAFE_BELOW` suy ra bằng nửa
   `wolfDistancePressure`, dải giữa của `softClaimPressureCeiling`) đều là quy
   ước "gấp đôi / một nửa", chưa qua quét tham số.
6. `wolfDistanceStance` chỉ đọc PHIẾU công khai, không đọc `trialAccusedId` —
   một đồng bọn đang bị đưa ra xử mà chưa ai bỏ phiếu thì vẫn bị coi là an toàn.
7. Chưa đụng §28 (metric cho pressure/floor/strategy/style/bluff).
8. v27 chưa đủ bằng chứng để mặc định.
