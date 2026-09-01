# Vận hành: khôi phục ván sau khi backend restart

Tài liệu này dành cho người trực deploy. Thiết kế đầy đủ nằm ở
[`superpowers/specs/2026-09-01-game-state-recovery-design.md`](superpowers/specs/2026-09-01-game-state-recovery-design.md).

## Hợp đồng một câu

Ván đang chơi sống sót qua việc process chết. Người chơi nối lại vào cùng room
code sẽ trở lại đúng vòng, đúng pha, đúng phiếu, đúng bot và đúng đồng hồ. Không
pha nào và không side effect nào chạy hai lần.

## Khoá Redis

| Khoá | Nội dung | TTL |
|---|---|---|
| `room:{CODE}` | Snapshot phòng (envelope có version) | 6h; còn 1h sau `GAME_OVER` |
| `room:{CODE}:quarantine:{ts}` | Bản snapshot không đọc được, giữ để mổ xẻ | 24h |
| `player-room:{playerId}` | Người chơi đang ở phòng nào | 7 ngày |
| `sess:{tokenHash}` | Phiên đăng nhập | 7 ngày |

Xem nhanh một phòng:

```bash
redis-cli --raw GET room:ABCDE | head -c 400
redis-cli --raw KEYS 'room:*:quarantine:*'
```

## `persistenceVersion`

Envelope hiện ở **version 1**. Snapshot mang số khác sẽ bị **cách ly**, không
bao giờ bị đoán nghĩa.

Khi nào phải tăng số này:

- Đổi hình dạng dữ liệu theo kiểu không đọc ngược được.
- Thêm một trường **bắt buộc** vào `RoomConfig` hoặc `GameState`.

Khi nào **không** cần tăng: thêm trường optional, hoặc thêm trường mà
`GameEngine` đã lấp mặc định trong constructor.

Tăng version nghĩa là mọi ván đang chạy sẽ không khôi phục được, nên hãy deploy
việc đó vào lúc vắng người.

Lưới an toàn ở mức compile: `apps/server/src/persistence/schema.ts` có các phép
kiểm tra gán hai chiều giữa schema Zod và type của engine. Thêm field vào
`GameState` hoặc `BotBrainState` mà quên schema thì `npm run lint` hỏng ngay,
không phải chờ tới lúc một ván thật không khôi phục được.

## Đọc log

Log có cấu trúc, mỗi dòng là một JSON:

```json
{"event":"snapshot.invalid","roomCode":"ABCDE","reason":"room.engineState.phase: custom","bytes":48213,"quarantinedUntilSeconds":86400}
{"event":"game-result.write-failed","roomCode":"ABCDE","gameId":"..."}
```

- `snapshot.invalid` — một snapshot bị cách ly. `reason` là tối đa ba issue đầu
  của Zod, đủ để lần ra nguyên nhân mà không đổ nội dung ván vào log. Bản gốc
  nằm ở khoá quarantine tương ứng trong 24h.
- `game-result.write-failed` — DB từ chối ghi kết quả vì lý do KHÔNG phải trùng
  khoá. Ván vẫn kết thúc bình thường; lần khôi phục kế tiếp sẽ thử ghi lại.

Dọn quarantine sớm (chúng tự hết hạn sau 24h):

```bash
redis-cli --raw KEYS 'room:*:quarantine:*' | xargs -r redis-cli DEL
```

## Hành xử khi hỏng

| Tình huống | Người chơi thấy gì | Server làm gì |
|---|---|---|
| Redis chết lúc đang chơi | Không thấy gì | Ván chạy tiếp trên RAM; snapshot ngừng được cập nhật |
| Redis chết lúc nối lại | "Máy chủ chưa đọc được dữ liệu phòng, thử lại sau ít giây" | KHÔNG tạo phòng mới, KHÔNG xoá `player-room` |
| Snapshot hỏng / sai version | "Ván trước không khôi phục được sau khi máy chủ khởi động lại" | Cách ly khoá, dọn mapping của người chơi |
| Hạn chót đã trôi qua, pha thao tác | Được thêm 10 giây | Dời `phaseEndsAt`, hẹn lại bước |
| Hạn chót đã trôi qua, pha chuyển tiếp | Vào thẳng pha kế tiếp | Chạy bù đúng một lần |

## Checklist deploy

1. `npm run db:migrate` — migration `20260901120000_add_game_id_to_game_result`
   thêm cột `gameId` unique. Cột nullable nên dữ liệu cũ không bị đụng, và
   migration chạy được trên bảng đang có dữ liệu.
2. Deploy server. Ván đang chạy sẽ tự khôi phục khi người chơi nối lại.
3. Kiểm nhanh: `redis-cli --raw KEYS 'room:*'` phải còn phòng; log không có
   `snapshot.invalid`.
4. Nếu thấy `snapshot.invalid` hàng loạt ngay sau deploy: gần như chắc chắn là
   hình dạng dữ liệu đã đổi mà version chưa tăng. Rollback server trước, rồi mới
   điều tra bằng khoá quarantine.

## Kiểm thử

```bash
npm test                     # gồm restart-recovery và restart-bot-determinism
npm run dev:infra            # Postgres + Redis
npm run test:e2e:recovery    # tự bật server, SIGKILL, bật lại, nối lại, so sánh
```

`test:e2e:recovery` tự khởi động server ở cổng 4155 và tự giết nó bằng SIGKILL.
Đặt `RECOVERY_VERBOSE=1` để thấy log của server con.

## Giới hạn còn lại

- **Một instance.** Không có khoá phân tán. `opSeq` compare-and-set chỉ giảm
  thiệt hại khi có hai lời ghi chen nhau, nó không giải quyết được hai process
  cùng chạy một phòng.
- **Redis chết đúng lúc process chết ⇒ mất ván.** Persistence là best-effort
  lúc chạy, đây là đánh đổi có chủ đích để một lần Redis chậm không làm cả bàn
  đứng hình.
- **Phòng chỉ thức dậy khi có người truy cập** (lazy). Ván chỉ còn bot sẽ đứng
  yên tới khi có người quay lại, hoặc tới khi TTL hết.
- **Lời thoại LLM không được phát lại.** Sau khôi phục bot nói câu mới; chỉ
  *quyết định* của nó là tất định.
- **Lượt bào chữa của bot bị bỏ** nếu restart rơi đúng vào pha `DEFENSE`: lời
  gọi nhà cung cấp đã chết cùng process, và gọi lại thì rủi ro nói hai lần.
