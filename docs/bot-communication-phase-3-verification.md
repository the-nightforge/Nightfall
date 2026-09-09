# Bot Communication — Phase 3 verification (PR 5)

> `NIGHTFALL_BOT_COMMUNICATION_UPGRADE.md` §15 (narrative consistency), tức PR 5
> của §32.
> Trước đó: `docs/BOT_COMMUNICATION_AUDIT.md`,
> `docs/bot-communication-phase-1-verification.md` (PR 1–3),
> `docs/bot-communication-phase-2-verification.md` (PR 4).

## 1. Changed files

| File | Việc |
| --- | --- |
| `conversation/narrative.ts` | mới — `NarrativePosition`, `buildNarrative`, `liveStanceOn`, `contradictsNarrative`, `stanceOfKind` |
| `conversation/speech-planner.ts` | quay xe -> `CHANGE_MIND`; loại ứng viên tự mâu thuẫn |
| `config/weights.ts` | +`conversation.narrativeMemoryRounds`, +`BOT_WEIGHTS_V25` |
| `config/presets.ts`, `index.ts` | đăng ký / export |
| `apps/server/src/bots/types.ts` | +`SpeechRequest.priorStance` |
| `apps/server/src/game/machine.ts` | +`priorStanceOn`, điền vào `SpeechRequest` |
| `apps/server/src/bots/prompt.ts` | +`priorStanceLines` |
| `tests/bot-narrative.test.ts` | mới — 18 test |
| `apps/server/tests/bot-conversation-prompt.test.ts` | +4 test |

## 2. Trí nhớ về LỜI NÓI, không phải về niềm tin

Quyết định thiết kế quan trọng nhất của PR này: `narrative.ts` chỉ đọc
`speechMemory` (lượt nói đã PHÁT) và `previousVotes` (phiếu đã bỏ).

`suspicion`/`trust` **không** tham gia. Chúng đổi liên tục và đổi trong im lặng
— đó là chuyện riêng của BOT, và đổi ý trong đầu không phải một sự bất nhất.
Cái cả bàn nhớ, và cái §15 nói tới, là những gì BOT đã **nói ra**.

DẪN XUẤT, không lưu trữ: không thêm một byte nào vào `BotBrainState`, cùng
nguyên tắc với `conversation-state.ts` của PR 1.

## 3. Lập trường công khai — danh sách HẸP

```text
ACCUSE / CHANGE_MIND / COUNTER_CLAIM  -> suspect
DEFEND                                -> trust
phiếu bầu một NGƯỜI                    -> suspect
```

`AGREE` và `CHALLENGE` bị loại có chủ đích, vì một lập trường ghi SAI còn tệ hơn
một lập trường thiếu — nó bịt miệng BOT ở một lượt hoàn toàn hợp lệ:

- `AGREE` mơ hồ theo mục tiêu: đồng tình ở `SHARED_SUSPICION` là đồng tình
  NGHI, còn ở `ROLE_CLAIM_HEARD` là đồng tình TIN. Cùng kind, hai lập trường
  ngược nhau.
- `CHALLENGE` không nói gì về phe. Từ PR 4, `CHALLENGE_PREMISE` nhắm vào NGƯỜI
  HỎI — bẻ lại một câu hỏi không có nghĩa là tố người đó là Sói.

Trong một vòng, **phiếu là tiếng nói cuối** (chốt ở cuối vòng thảo luận). Đổi
lập trường thì mạch cũ khép lại: `createdAtRound` tính từ đầu mạch MỚI, và sức
nặng đếm lại — giữ số cũ sẽ nói dối rằng BOT đã nói điều này suốt từ vòng đó.

## 4. Ba cơ chế

1. **Quay xe phải nói ra.** Tố một người mình đã công khai bênh (còn trong
   `narrativeMemoryRounds` vòng) → `CHANGE_MIND`, **bất kể tính cách**. Nhánh
   `currentTheory` cũ hỏi `style.concession >= 0.5`, nghĩa là một con BOT bướng
   bỉnh quay xe hoàn toàn trong im lặng. Bướng bỉnh quyết định bạn đổi ý bao
   nhiêu LẦN, không cho phép bạn vờ như chưa từng nghĩ khác.
2. **Không bênh người mình vừa tố.** Ứng viên nào đảo ngược một lập trường còn
   hiệu lực thì bị loại, và BOT rơi xuống ứng viên kế — thường là `DISAGREE`,
   thứ không nêu lập trường nào. Xuống nhẹ nhàng: BOT vẫn phản đối lời tố mà
   không chính thức lật lập trường.
3. **Prompt biết BOT đã nói gì.** `SpeechRequest.priorStance` mang lập trường
   cũ về đúng người đang được nói tới, và prompt cấm thẳng việc viết như thể
   chưa từng nghĩ khác.

Cơ chế 3 tồn tại vì **lõi chọn được ý định, nhưng lõi không viết câu**. Lỗi mà
§15 nêu đích danh — "Tôi tin A từ đầu" — là một lỗi CÂU CHỮ, và chỉ một dòng
trong prompt mới chặn được. Không phải dữ liệu ẩn: cả bàn đã nghe những câu đó
và thấy những lá phiếu đó, nên nó không đi qua `untrusted()`.

## 5. Determinism (§30)

Không thêm lượt rút RNG nào. `buildNarrative` thuần; cả hai nhánh nằm trong
phần chọn ỨNG VIÊN, phía trước lượt rút vốn có. Với
`narrativeMemoryRounds = 0` (v1..v24) `narrative` là `null` và mọi nhánh mới
bị bỏ qua trước khi chạm tới bất cứ thứ gì.

Bằng chứng: `--verify-replay` 0 failedSeeds ở v21/v24/v25;
**engine 4.865 test PASS / 104 file, server 1.099 test PASS / 132 file**, lint
xanh cả 4 workspace.

> Số file test nhảy so với văn bản PR 4 (101 → 104) vì nhánh đã tiến: PR 1 và
> PR 4 được commit ngoài phiên này (`fe49422`, `24072bf`) và `main` được merge
> vào (`f1225e4`). Benchmark dưới đây chạy lại toàn bộ trên cây hiện tại.

## 6. Benchmark — self-play 1.200 ván, paired seeds (`comm-pr5`)

| | v21 (default) | v24 | v25 | v25 − v21 |
| --- | --- | --- | --- | --- |
| villageWinRate | 55.17% | 55.33% | 55.17% | **±0.00 pt, z=0.00** |
| silenceRate | 21.59% | 20.24% | 20.24% | −1.35 pt |
| directQuestionResponseRate | 55.71% | 55.23% | 55.19% | −0.52 pt |
| replyRate | 39.97% | 39.65% | 39.62% | −0.35 pt |
| voteChangeRate | 27.56% | 27.69% | 27.68% | +0.12 pt |
| speechRepetitionRate | 3.72% | 3.74% | 3.74% | +0.02 pt |
| semanticRepetitionRate | 0.90% | 1.01% | 1.01% | +0.11 pt |
| exactRepetitionRate | 0.07% | 0.06% | 0.06% | −0.01 pt |
| distinctOpeningRate | 99.74% | 99.67% | 99.68% | −0.06 pt |
| villageVoteAccuracy | 50.47% | 50.61% | 50.58% | +0.10 pt |
| claimAccuracy | 80.92% | 80.00% | 79.95% | −0.97 pt |
| invariant violations | 0 | 0 | 0 | — |
| failedSeeds (replay) | 0 | 0 | 0 | — |

### Cơ chế có CHẠY không — đo trực tiếp trên trace, 200 ván

```text
CHANGE_MIND do quay xe ("đã công khai bênh ... từ vòng N")   0 lần
CHANGE_MIND do currentTheory (nhánh cũ)                    789 lần
DEFEND phát ra, v24                                         62 lần
DEFEND phát ra, v25                                         41 lần   (-34%)
ván có trace khác nhau giữa v24 và v25                      17/200
```

## 7. Đọc kết quả — thẳng thắn

- **Cơ chế 2 (chốt chặn) chạy thật và đo được**: `DEFEND` giảm 34%, 8,5% số ván
  đi khác đường. Đó là những lượt mà trước v25 BOT bênh đúng người nó vừa tố
  hoặc vừa bỏ phiếu treo.
- **Cơ chế 1 (quay xe → `CHANGE_MIND`) KHÔNG hề chạy trong self-play: 0 lần trên
  200 ván.** Không phải lỗi — unit test chứng minh đường đi hoạt động — mà là
  vì tiền đề gần như không bao giờ xảy ra ở bàn toàn bot: `DEFEND` chỉ phát ra
  ~0,2 lần mỗi ván (nó đòi `trust` vượt ngưỡng, thứ bot hiếm khi xây được), và
  người được bênh còn phải trở thành mục tiêu phiếu trong vòng 3 vòng sau đó.
  **Nghĩa là phần trung tâm của §15 hiện chỉ được bảo chứng bằng unit test,
  không bằng benchmark.**
- **Cơ chế 3 (prompt) không được self-play chạm tới chút nào** — harness dùng
  bảng mẫu, không gọi LLM. Nó chỉ có 4 test dựng prompt đứng sau.
- **villageWinRate đứng yên tuyệt đối (z=0.00).** Với hai cơ chế gần như không
  nổ, đó đúng là kết quả phải kỳ vọng. Nó nói PR 5 **không tốn gì**, không nói
  PR 5 có ích. **v25 KHÔNG đặt làm mặc định** (giữ v21).
- Chênh lệch v25 − v21 ở các chỉ số hội thoại gần như toàn bộ đến từ PR 3/PR 4
  (v23/v24), không từ PR 5: cột v24 và v25 trùng nhau tới chữ số thứ ba ở mọi
  dòng trừ `distinctOpeningRate` và `villageVoteAccuracy`.

## 8. Known limitations

1. **Hướng NGHI → TIN không có ý định nào diễn đạt được.** `CHANGE_MIND` gắn
   chặt với hướng ngược lại: cả `intentLine` trong `prompt.ts` lẫn bảng
   `SPEECH_TEMPLATES.CHANGE_MIND` đều viết "giờ tôi nghi {target}". Vì vậy
   hướng này chỉ được LOẠI (im lặng về lập trường), không được nói thành lời —
   trong khi ví dụ của chính §15 ("nghi A ở vòng 2, A được xác minh tốt ở vòng
   3") lại đúng hướng đó. Chữa được bằng cách cho `templates.ts` tra thêm
   `topic` cho riêng `CHANGE_MIND`, cộng một nhánh trong `intentLine`; đó là
   một PR riêng, không phải một dòng.
2. Cơ chế 1 và 3 chưa có bằng chứng từ benchmark (xem §7). Muốn đo cơ chế 1 thì
   phải dựng một kịch bản ép buộc (§29 "scenario tests"), không thể trông vào
   self-play ngẫu nhiên.
3. Cửa sổ `speechMemory` (`memoryWindow = 12`) là trần trên thật sự: một lập
   trường nêu từ quá lâu rơi khỏi cửa sổ và BOT "quên mình đã nói", trong khi
   cả bàn vẫn nhớ. Nới `memoryWindow` nếu đo được; đừng dựng mảng lưu trữ thứ hai.
4. `narrativeMemoryRounds = 3` chưa qua quét tham số. 2 hay 5 có thể tốt hơn.
5. Chưa đụng §8 persuadability, §17 wolf bluff scoring, §28 metric cho
   pressure/floor/strategy.
6. v25 chưa đủ bằng chứng để mặc định.
