# Bot AI Phase 2 — Verification Report

**Spec:** `docs/superpowers/specs/2026-08-29-bot-ai-phase-2-design.md`
**Plan:** `docs/superpowers/plans/2026-08-29-bot-ai-phase-2.md`

## Commit range

11 commit trên `main`, từ `492bbce` (kết Phase 1):

```
4f16983 test: pin phase one invariants with an adversarial audit
d0b5c99 docs: design and plan deterministic bot AI phase two
fcd880a feat: decay bot beliefs and feed private role information into them
570e8dc feat: give bots a role-filtered view of the night
f0675b2 feat: add per-role bot strategies with a werewolf night plan
2436f48 feat: add seer, guard and witch night strategies
fb385ca feat: decide trial verdicts and hunter shots in the bot core
2efdd75 feat: detect coalitions, influence and isolation
f7ab1d1 feat: adapt bot beliefs to deaths and summarize each round
e80c53b refactor: take every game action away from the bot providers
c4a4719 feat: add a multi-game bot evaluation harness
```

## Kết quả kiểm chứng

Số dưới đây là output thật của lần chạy cuối.

| Lệnh | Kết quả |
| --- | --- |
| `npm test` (cả 3 workspace) | engine **356**, server **253**, web **73** — 0 fail |
| `npm run lint` | PASS cả ba workspace |
| `npm run build` | PASS: shared → engine → server → web |

Thay đổi so với đầu Phase 2: engine 250 → 356 (+106). Server 302 → 253 (−49) do xoá test cho
các đường provider đã bị gỡ hẳn; coverage bảo mật giữ nguyên (`bot-context`,
`chat-visibility`, `day-vote-history-snapshot`, `bot-session`, hai `deterministic-*-scheduling`,
`bot-speech-renderer`, `bot-prompt`).

## Audit Phase 1

Trước khi bắt đầu, tôi audit lại Phase 1 bằng `packages/game-engine/tests/phase-1-invariants.test.ts`
— 17 test đối kháng viết độc lập với test sẵn có. Kết quả: **7/8 tiêu chí đạt**. Khoảng trống
duy nhất là provider vẫn quyết định night/hunter/final vote, đúng phạm vi Phase 1 đã tuyên bố
loại trừ. Đó là nội dung Task 8.

Ghi nhận ngoài phạm vi: `.superpowers/sdd/2026-08-28-bot-ai-phase-1/progress.md` **chưa từng
tồn tại** (thư mục `.superpowers/` nằm trong `.gitignore`), và 80/80 checkbox trong plan Phase 1
vẫn chưa tick dù code đã merge.

## Bất biến — kiểm bằng lệnh

```
rg "Math\.random" packages/game-engine/src/bot        → 0 kết quả
rg "botBrain\(\)\.decide(Night|HunterShot|FinalVote)" apps/server/src → 0 kết quả
```

`BotBrain` còn đúng 3 thành viên: `name`, `renderDaySpeech`, `decideDefense`. Không còn chữ ký
nào trả về một nước đi — đây là ràng buộc về **kiểu**, không phải quy ước.

Bí mật vai, lịch sử phiếu công khai và quyền đổi phiếu của Phase 1 giữ nguyên, khoá bằng
`phase-1-invariants.test.ts` (chạy xanh sau mọi task) và `bot-night-knowledge.test.ts`
(11 test bảo mật cho đường đêm).

## Evaluation

`simulateGame` chạy trọn ván bằng `GameEngine` thật, mọi người chơi là `BotRuntime`.

| Chỉ số | Giá trị (30 seed) |
| --- | --- |
| Làng thắng | 5 |
| Sói thắng | 25 |
| Ván không kết thúc | 0 |
| Số vòng trung bình | 3.97 |
| Nước đi bị engine từ chối | 0 |
| BOT biết vai ngoài phần được phép | 0 |

Cùng seed cho `SimulationResult` bằng nhau từng bit.

## Ba lỗi do harness phát hiện

1. **`NightKnowledge` nói dối về lượt Phù Thuỷ.** Engine từ chối mọi hành động của Phù Thuỷ
   khi `wolvesLocked === false` — kể cả SKIP — nhưng knowledge view vẫn chào `[POISON, SKIP]`.
   Phù Thuỷ bot nộp một nước đi hợp lệ trên giấy và mất trắng lượt đêm.
2. **Harness của chính tôi không tất định**: xáo một mảng vai đã được `GameEngine.create` xáo
   ngẫu nhiên, nên phép xáo có gieo hạt không phải nguồn ngẫu nhiên duy nhất.
3. **Nhãn phe sai**: `Winner` là `"village"`, code đếm `"villagers"`.

## Một giả định trong spec bị bằng chứng bác bỏ

Spec ban đầu chọn **mặc định THA** ở phiên toà. Harness cho kết quả phe làng thua **30/30**:
không ai bị kết án → không có lịch sử phiếu → không sinh bằng chứng → nghi ngờ mãi bằng 0 →
không ai bị kết án. Điều bị bỏ sót là tới được phiên toà nghĩa là đa số làng **đã** chỉ vào
người đó.

Đã đổi sang **mặc định TREO trừ khi có lý do tích cực tin bị cáo vô tội**, và `selectVote`
chỉ cho phe Sói chọn "không treo ai" khi bằng chứng mỏng. Spec đã được cập nhật kèm ghi chú
sửa đổi; 4 test mã hoá giả định cũ đã được viết lại kèm lý do.

## Concern còn lại

- **Làng thắng 17% là thấp** (ván thật với 2 Sói/8 người thường ở 40–60%). Nguyên nhân chính:
  harness chạy với `visibleChat: []`, nên không có claim vai. Tiên Tri soi trúng Sói thì
  suspicion của **riêng** nó lên 100, còn 7 người kia không biết gì. Sửa cần BOT biết claim
  vai và biết đánh giá độ tin cậy của claim — Phase 3.
- **Mọi ngưỡng đều là số tự chọn**, chưa hiệu chỉnh: `BELIEF_DECAY_PER_ROUND = 0.85`,
  `DESPERATION_PRESSURE = 0.3`, `SPARE_TRUST_MARGIN = 15`, các ngưỡng bình thuốc, `ISOLATION_BONUS = 8`.
- **`influenceScore` chưa có consumer** trong `selectVote`; chiến lược Sói dùng
  `incomingHostilityOf` làm proxy.
- **`BotBrainState` không persist**: session sống một ván, không lưu Redis. Server restart giữa
  ván thì BOT mất trí nhớ.
- **`deceptionSkill` vẫn không có consumer** — dành cho bluffing ở Phase 3.
- **CI chưa từng chạy thật.** `.github/workflows/ci.yml` được thêm ở `492bbce` nhưng tôi chỉ
  verify local; khác biệt hay gặp giữa Windows và `ubuntu-latest` là case-sensitivity của
  đường dẫn import.
