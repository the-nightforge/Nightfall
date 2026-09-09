# Speech policy học được — thu dữ liệu, và vì sao chưa train

> `NIGHTFALL_BOT_COMMUNICATION_UPGRADE.md` §26, tức PR 10 của §32.
> Trước đó: `bot-communication-phase-1..6-verification.md` (PR 1–8),
> `bot-communication-human-eval.md` (PR 9).

---

## 1. PR này làm nửa đầu, và cố ý dừng ở đó

§26 viết theo đúng thứ tự này:

> *"**Sau khi heuristic communication policy ổn định**, có thể thu: observation,
> conversation state, communication decision, speech, human response, outcome.
> **Sau đó mới học** Speech Policy."*

Điều kiện đứng trước cả hai vế. Nó **chưa đạt**:

| Preset | PR | Nội dung | villageWR so v21 | z |
| --- | --- | --- | --- | --- |
| v23 | 3 | SPEAK vs WAIT | +1.42 pt | +0.69 |
| v24 | 4 | Question strategy | — | — |
| v25 | 5 | Narrative consistency | ±0.00 pt | 0.00 |
| v26 | 6 | Adaptive targeting | +0.83 pt | +0.41 |
| v27 | 7 | Claim/bluff strategy | ±0.00 pt | 0.00 |
| v28 | 8 | Repetition + validator | −2.08 pt | −1.02 |

**Không bản nào vượt tiêu chí §40** để lên `DEFAULT_BOT_WEIGHTS`; mặc định vẫn
là v21. Mọi `|z| < 1.1`, tức sáu PR liền không phân biệt được với nhiễu ở cỡ
mẫu 1.200 ván.

Train một policy trên một heuristic chưa ổn định là **đóng băng nhiễu thành
trọng số**: model sẽ học đúng những lựa chọn mà chính chúng ta chưa chứng minh
được là tốt hơn ngẫu nhiên, rồi từ đó không ai gỡ ra được nữa vì trọng số không
đọc được như một nhánh `if`.

Nên PR 10 giao **hạ tầng thu dữ liệu**, và không giao model. Đó là đọc §26 đúng
như nó viết, không phải bỏ dở.

## 2. Điều kiện mở khoá

Train khi **một** trong hai xảy ra:

1. Một preset trong v23–v28 (hoặc bản kế) đạt §40 — protocol 5×1.000 ván paired
   seeds, hiệu ứng ổn định qua các batch — và được nâng lên `DEFAULT_BOT_WEIGHTS`.
   Lúc đó "heuristic ổn định" có nghĩa cụ thể: có một cấu hình đã được chứng minh.
2. Bài chấm người của PR 9 (`bot-communication-human-eval.md`) chạy trên ≥ 2 người
   chấm và cho một thứ hạng nhất quán giữa các preset. Đây là con đường thứ hai
   vì `villageWinRate` **không đo chất lượng hội thoại** — tám PR vừa rồi cho
   thấy nó gần như mù trước mọi thay đổi ở tầng lời nói.

Con đường (2) đáng chú ý hơn: nếu win-rate mãi không phân biệt được các preset,
thì nó là **sai chỉ số đích** cho tầng giao tiếp, và cố train theo nó sẽ tối ưu
một thứ không liên quan.

## 3. Đã giao gì

| File | Việc |
| --- | --- |
| `learning/speech-dataset.ts` | `SpeechSample`, `gameToSpeechSamples`, `validateSpeechSample` |
| `conversation/conversation-state.ts` | `export pressureOf` — dataset dùng CHUNG công thức với planner |
| `evaluation/selfplay.ts` | sự kiện `SPEECH` mang thêm `topic` |
| `apps/server/scripts/selfplay.ts` | cờ `--speech-dataset <dir>` |
| `tests/bot-speech-dataset.test.ts` | 14 test |

```bash
npm run selfplay -- --weights 28.0.0 --games 600 --seed pr10 --speech-dataset reports/speech
```

### Vì sao KHÔNG dùng lại `trajectory.ts`

§26 nói thẳng: *"Không train gameplay action và dialogue trong một model ngay từ
đầu."*

`BotTrajectory` **đã** sinh line cho quyết định `SPEECH` — nhưng không gian hành
động của nó là không gian GAMEPLAY (chọn một ghế để bỏ phiếu), và chính chú
thích ở `legalActionsFor` đã ghi nhận rằng `SPEECH` không chọn mục tiêu trong
không gian đó. Nhét nhãn "nói gì" vào một không gian "bỏ phiếu ai" là đúng thứ
§26 cấm. Vì vậy: file JSONL RỜI, schema RỜI.

### Áp lực dùng chung một công thức

`pressureOf` được `export` từ PR 1 thay vì chép lại. Dataset dựng
`ACCUSE`/`DEFEND` giả lập từ log rồi đưa qua **chính** `buildDiscussionGraph` mà
planner dùng — những memory thật vốn sinh ra từ đúng các câu chat đó, nên đọc
ngược từ log là đọc lại cùng một sự việc. Không có bước này, model sẽ học một
định nghĩa "áp lực" khác với cái planner đang dùng, và hai tầng nói hai thứ tiếng.

### Ranh giới tri thức

Whitelist khoá cho `conversation` và `decision`, cùng tinh thần `dataset.ts`:
trường hợp nguy hiểm nhất là ai đó THÊM một feature "cho model mạnh hơn" và vô
tình chở theo sự thật ẩn. `validateSpeechSample` chỉ **báo cáo**, không sửa —
một dataset có rò rỉ phải bị từ chối, không được âm thầm xoá trường rồi train
tiếp, vì làm vậy là giấu đi chính con bug đã tạo ra nó.

Có test khẳng định: **đổi toàn bộ bảng vai chỉ đổi `reward`, không đổi một byte
nào của `conversation` hay `decision`.**

## 4. Dataset đo được — 600 ván, v28

```text
24.667 mẫu / 600 ván        mẫu rò rỉ: 0
reward +1: 12.597 (51,1%)   -> cân, không cần cân lại lớp

phân bố nhãn (decision.kind)
  QUESTION      6.372     CHALLENGE     1.118
  REPLY         6.239     REACTION        720
  ACCUSE        3.524     AGREE           597
  CHANGE_MIND   1.958     COUNTER_CLAIM   436
  CLAIM_ROLE    1.669     HUMOR           203
  ASK_EVIDENCE  1.596     DISAGREE        194
                          DEFEND           41

tín hiệu phản hồi
  topic khác null   24.667 (100%)
  có người đáp lại   8.356 (33,9%)
  lái được phiếu    11.824 (47,9%)
  áp lực > 0         5.911 (24,0%)
```

`DEFEND` chỉ 41 mẫu — khớp đúng phát hiện độc lập ở PR 5 và PR 7 (`DEFEND` phát
ra ~0,2 lần mỗi ván). Một nhãn hiếm tới mức đó **không train được**; đó là một
kết luận có sẵn từ dataset trước khi ai kịp viết một dòng code train.

## 5. Hạn chế

1. **"human response" của §26 KHÔNG có người.** Self-play không có người chơi
   thật, nên trường đó là `tableResponse` — số câu đáp lại, và có ai đổi phiếu
   sang mục tiêu không. Tên trường nói rõ điều đó thay vì mượn chữ "human" cho
   một thứ không có người nào tham gia.
2. **`swayedVote` là tín hiệu YẾU.** 47,9% mẫu dương, vì phiếu trong một vòng
   đổi rất nhiều và bất cứ lá nào đổi sang mục tiêu đều tính. Nó chưa phân biệt
   được "câu này thuyết phục" với "cả bàn vốn đã đang dồn về đó". Muốn dùng làm
   reward thì phải trừ đi xu hướng nền trước.
3. **Câu chữ do BẢNG MẪU sinh, không phải LLM.** Trường `text` vì vậy học được
   rất ít — nó là nhãn của tầng diễn đạt, mà tầng đó trong self-play chỉ có vài
   chục mẫu câu. Muốn train phần diễn đạt thì cần log ván THẬT có provider bật.
4. **Chưa có split train/validation/test.** `dataset.ts` đã có `splitOf` theo
   `gameId`; nối vào là việc của bước train, không phải bước thu.
5. **Chưa có encoder.** `observation.ts` mã hoá observation GAMEPLAY thành vector;
   speech observation chưa có bản tương ứng. Cố ý: hình dạng vector phải do bài
   toán train quyết, và bài toán đó chưa mở.
6. `topic` mới được ghi vào sự kiện `SPEECH` từ PR 10, nên mọi bản ghi self-play
   CŨ không có trường này.
