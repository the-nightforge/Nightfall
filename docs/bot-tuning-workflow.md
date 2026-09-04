# Tuning BOT có mắt: selfplay → trace → weights → so report

Trước công cụ này, một vòng tuning là: chạy `npm run selfplay`, thấy "Dân bỏ
phiếu trúng Sói 49.6%", rồi đoán xem trọng số nào đã đẩy con số đó. Trace bù vào
đúng khoảng trống ấy — nó không nói batch chạy thế nào, nó nói **một** con bot
đã cộng điểm ra sao ở **một** lá phiếu cụ thể.

## Vòng lặp

**1. Chạy batch, thu trace vài ván đầu.**

```bash
npm run selfplay -- --seed tune --games 500 --players 8 --traces reports/traces --out reports/before.json
```

`--traces` là thứ duy nhất bật trace. Không có nó thì `runSelfPlay` không dựng
collector, không bọc RNG, không cấp phát một object trace nào — ràng buộc 1 của
[`trace.ts`](../packages/game-engine/src/bot/trace/trace.ts).

Trần mặc định là **5 ván đầu** (`--trace-games <n>` để đổi). Trần tồn tại vì
trace là thứ duy nhất trong batch lớn theo số *quyết định* chứ không theo số
*ván*: đo trên máy này, 300 ván 8 người ghi trace toàn bộ ra **82 MB** JSONL và
chậm hơn ~7%; với trần mặc định thì 12.4 ms/ván, nằm gọn trong nhiễu của
12.2–12.5 ms/ván khi tắt.

Mỗi ván ra một file, tên file mang seed — nên từ một file trace luôn chạy lại
được đúng ván đã sinh ra nó.

**2. Đọc ván trông sai.**

```bash
npm run trace-view -- reports/traces/tune-3.jsonl --bot p4
```

Timeline nhóm theo bot. Dưới đây là một khối thật, lấy nguyên văn từ file mẫu
(`npm run trace-view -- docs/fixtures/trace-sample.jsonl --bot p1`):

```
[v1 NIGHT] NIGHT → KILL p2
  belief: p3 nghi 0.0 tin +100.0
  #1 p2  41.8  ← chọn
       threat +40.0 · jitter +1.8
  #2 p4  41.3 (kém 0.6)
       threat +40.0 · jitter +1.3
  hơn nhau ở: jitter +0.6
  còn lại: p6 38.9 · p5 38.8
  rng: 4 lần rút
```

Đọc được ngay hai điều mà một dòng report không bao giờ nói: con Sói này nhận ra
đồng bọn (`p3 ... tin +100.0`) nên p3 không có trong bảng; và nó chọn p2 thay vì
p4 **chỉ vì jitter** — `threat` của hai người bằng nhau chằn chặn. Nếu ván này
trông sai, chỗ cần sửa là `threat`, không phải chỗ khác.

Dòng đáng đọc nhất là **`hơn nhau ở:`** — hiệu từng số hạng giữa người được chọn
và người đứng nhì. "p2 được 41.8 điểm" không phải một lời giải thích; "p2 hơn p4
đúng 0.6 điểm jitter" thì đã là một chỗ để sửa. Ngoài ra:

- `belief:` — quan sát vừa rồi đẩy nghi ngờ/tin tưởng của ai, đi bao xa.
- `↳ vì:` — lý do bot **mở miệng**; `↳ bỏ cuộc:` — lý do nó im hoặc bỏ lượt.
- `⚠ chọn X dù không dẫn đầu bảng` — có một luật **ngoài** bảng điểm đã can
  thiệp, nên đừng đi sửa trọng số của bảng.

Mỗi dòng file là một JSON độc lập, nên `jq` vẫn dùng được cho câu hỏi hẹp:

```bash
jq -c 'select(.botId=="p4" and .decision=="VOTE") | .candidates[0]' reports/traces/tune-3.jsonl
```

**3. Sửa trọng số** trong
[`config/weights.ts`](../packages/game-engine/src/bot/config/weights.ts) — tên
số hạng trong trace là tên trong bảng, nên không phải dịch qua lại.

**4. Chạy lại đúng seed đó và so report.**

```bash
npm run selfplay -- --seed tune --games 500 --players 8 --out reports/after.json
diff <(jq .metrics reports/before.json) <(jq .metrics reports/after.json)
```

Cùng `seedBase` cho cùng tập ván, nên chênh lệch giữa hai report là chênh lệch
của trọng số chứ không phải của may rủi. `--traces` không làm ván chạy khác đi
(`wrapRngForTrace` bọc dòng số mà không tiêu thêm số nào — có test khẳng định),
nên bước 1 và bước 4 so được với nhau.

## Ranh giới

- **Production trả chi phí bằng không.** `BotRuntimeOptions.trace` bỏ trống là
  tắt, và tắt nghĩa là không có wrapper, không có probe, không có object nào.
  `apps/server` không truyền sink.
- **Trace ⊆ knowledge view của chính bot đó.** `knowledgeSnapshot` chép thẳng từ
  `BotKnowledgeView` mà engine đã lọc. Sói **được** thấy đồng bọn trong trace của
  nó — đó là cách duy nhất trace giải thích được vì sao nó không bầu đồng bọn.
- **JSONL nội bộ, không dịch vụ ngoài.** Không dependency mới. Một dòng = một
  `BotDecisionTrace`, đọc được bằng `jq`, `grep`, hay một ô notebook.

Ngoại lệ duy nhất của phép khứ hồi qua đĩa: `-0` đọc lại thành `0`. JSON không có
cách nào viết `-0`. Vô hại (`-0 === 0`, và `sumTerms` bắt đầu từ `0` nên tổng
không đổi), nhưng nó là lý do test dùng một hàm chuẩn hoá thay vì `toEqual` trần.

## File mẫu

[`docs/fixtures/trace-sample.jsonl`](fixtures/trace-sample.jsonl) — 46 quyết
định, 6 bot, 2 vòng, đủ cả bốn loại quyết định. Dữ liệu THẬT do `--traces` sinh
ra, không phải file dựng tay: nếu định dạng trôi lệch thì
`apps/server/tests/trace-view.test.ts` đỏ trước khi ai kịp mở nó ra đọc.

Dựng lại nguyên xi (ra `doc-l-0.jsonl`, đổi tên thành `trace-sample.jsonl`):

```bash
npm run selfplay -- --seed doc-l --games 1 --players 6 --traces <thư mục tạm>
```
