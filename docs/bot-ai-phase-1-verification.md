# Bot AI Phase 1 — Verification Report

Kế hoạch: `docs/superpowers/plans/2026-08-28-bot-ai-phase-1.md`
Thiết kế: `docs/superpowers/specs/2026-08-28-bot-ai-phase-1-design.md`

## Commit range

Nhánh `codex/bot-ai-phase-1`, 16 commit tính từ `main` (`ae94179`):

```
005f73f feat: record reversible nomination votes
d160251 fix: preserve role secrecy after death
075a438 feat: publish completed day vote recaps
6d4cb5f feat: let players change and inspect day votes
feeafe7 test: preserve role secrecy in hunter chat coverage
c23237c feat: add seeded bot brain contracts
5a9c818 feat: add filtered bot knowledge views
4d3e549 test: typecheck game-engine tests so bot contracts are enforced
295882b feat: add structured bot memory and beliefs
7eb6d40 fix: keep a bot's own vote visible after the vote closes
89b4a44 feat: analyze bot vote and social evidence
7826f9a feat: add deterministic bot vote runtime
4785c6b feat: manage deterministic bot sessions
77f8942 fix: harden bot chat parsing, pinned memory and trust updates
1aaa7b5 refactor: restrict day bot providers to speech
a4a81d3 feat: schedule deterministic bot day votes
```

## Kết quả kiểm chứng

Số dưới đây là output thật của lần chạy cuối, không phải ước lượng.

| Lệnh | Kết quả |
| --- | --- |
| `npm test --workspace @masoi/game-engine -- --run` | 8 test file, **233 test pass**, 0 fail |
| `npm test --workspace @masoi/server -- --run` | 45 test file, **302 test pass**, 0 fail |
| `npm test --workspace @masoi/web` | **73 test pass**, 0 fail (16 suite) |
| `npm run lint` | PASS cả ba workspace (`tsc --noEmit`; game-engine typecheck cả tests) |
| `npm run build` | PASS: shared → engine → server → web (`next build` compile 7.1s, 3 route) |

Baseline trước Phase 1 là 391 test (118 game-engine, 273 server). Sau Phase 1:
608 test (233 + 302 + 73).

## Scenario và invariant

`packages/game-engine/src/bot/scenario.ts` chạy runtime thuần trên nhiều seed.
`packages/game-engine/tests/bot-scenario.test.ts` khẳng định:

- **100 seed** (`for (let seed = 0; seed < 100; seed += 1)`) đều giữ mọi belief
  trong khoảng hợp lệ và mọi evidence trong quyết định đều có source ID thật.
- Cùng một seed phát lại ra đúng cùng một kết quả.
- Không phải mọi seed đều ra cùng một personality (nếu không, seed vô nghĩa).
- BOT không bao giờ tự nhận là "biết" vai của người khác chỉ từ diễn biến công khai.

## Ranh giới bảo mật đã xác nhận

**Vai người chết không lộ.** `GameEngine.botKnowledgeFor` chỉ đưa vào `knownRoles`
vai của chính viewer và đồng bọn Sói đã biết; `alive === false` không mở thêm gì.
Có test riêng cho từng nhánh trong `packages/game-engine/tests/bot-knowledge.test.ts`
và `apps/server/tests/bot-context.test.ts`, và recap phiếu công khai được assert
là không chứa chuỗi `WEREWOLF`/`VILLAGER`.

**LLM ban ngày không có trường mục tiêu.**

```
$ rg -n "voteTargetId" apps/server/src/bots/prompt.ts
(không có kết quả)
```

`daySpeechSchema` là `z.object({ think, chat }).strict()`: một phản hồi có thêm
`voteTargetId` bị từ chối thẳng chứ không bị bỏ qua âm thầm
(`apps/server/tests/bot-prompt.test.ts`). `SpeechRequest` cũng không mang
`RoomSnapshot`, bảng vai, hay danh sách mục tiêu hợp lệ — nhà cung cấp không
nhìn thấy lựa chọn nào khác để mà đổi.

**Không có randomness toàn cục trong lõi BOT.**

```
$ rg -n "Math\.random" packages/game-engine/src/bot
(không có kết quả)
```

Trong `apps/server/src/game/machine.ts` còn đúng hai lời gọi `Math.random()`,
cả hai thuộc đường legacy chưa migrate: giãn cách hành động đêm và giãn cách
phiếu xác nhận ở phiên toà. Đường ban ngày (`scheduleDayBots`, `scheduleVoteBots`)
dùng RNG gieo hạt từ `BotSession`.

**Lõi quyết định không chạm state thô.** `vote-decision.ts` và `BotRuntime.ts`
không nhận `GameState` hay `Room`; hai chuỗi đó chỉ xuất hiện trong comment giải
thích chính ràng buộc này.

## Những gì đã đổi về luật chơi

- Phiếu đề cử ban ngày **đổi được tới hết hạn**; chỉ lựa chọn cuối cùng được tính.
  Gửi lại đúng lựa chọn cũ là no-op, không sinh thêm mutation.
- Pha bỏ phiếu **không còn kết thúc sớm** khi mọi người đã bỏ phiếu — kết thúc
  sớm sẽ khoá phiếu ngay lúc người cuối cùng bấm, tức là xoá mất chính quyền đổi
  phiếu vừa thêm.
- Sau khi vòng đề cử chốt, **danh tính phiếu được công khai**: ai bỏ cho ai, và
  toàn bộ chuỗi đổi phiếu kèm thời điểm. Phiếu Treo/Tha được gắn vào recap cùng
  vòng sau khi tuyên án.
- BOT quyết định phiếu ở **ba mốc** trong khung bỏ phiếu (khoảng 12%, 52%, 84%
  khung, có nhiễu gieo hạt), nên nó phản ứng được với diễn biến thay vì chốt một
  lần rồi thôi.

## Phần còn dùng đường legacy

Phase 1 chỉ migrate đường **ban ngày**. Những phần sau vẫn đi qua provider cũ với
`RoomSnapshot` đầy đủ và đường lui `RandomBrain`:

- Hành động đêm (`decideNight`).
- Phản kích Thợ Săn (`decideHunterShot`).
- Lời tự bào chữa của bị cáo (`decideDefense`).
- Phiếu Treo/Tha ở phiên toà (`decideFinalVote`), với `derivedFinalVote` làm
  đường lui. Phiếu xác nhận **chưa** cho đổi, nên `pendingEndFinalVote` vẫn còn.

## Bàn giao cho Phase 2

Phase 2 nên bắt đầu bằng một role strategy interface cho đường đêm và Thợ Săn,
tái dùng `BotRuntime`/`BotBrainState` đã có. Không mở rộng phạm vi Phase 1 nữa:
nó đã đạt acceptance criteria ở trên.
