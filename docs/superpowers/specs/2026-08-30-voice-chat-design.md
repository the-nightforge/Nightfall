# Thiết kế Voice Chat (LiveKit)

Ngày: 2026-08-30 · Nhánh: `feat/voice-chat`

## 1. Mục tiêu

Cho người chơi nói chuyện bằng giọng nói trong lúc tranh luận ban ngày, mà không
làm yếu đi bảo mật thông tin bí mật vốn là toàn bộ giá trị của Ma Sói.

Giá trị nằm ở chỗ voice cho phép nghe được sự lúng túng, giọng đuối lý, nhịp trả
lời — những thứ text không mang được. Đó là lý do phạm vi tập trung vào ban ngày
chứ không rải đều mọi pha.

## 2. Quyết định phạm vi: voice chỉ có ban ngày

Đây là quyết định gốc, mọi thứ còn lại là hệ quả.

Phe Sói vẫn bàn nhau bằng **text** ban đêm. Người chết vẫn bàn với nhau bằng
**text** kênh `dead`.

**Vì sao:** ban ngày không có kênh nào mang thông tin bí mật. Ai chết là công
khai, ai bị cáo là công khai. Nên "ai được nói" không hé lộ vai của ai. Bỏ voice
ban đêm là bỏ hẳn bề mặt rò rỉ nguy hiểm nhất — không cần room riêng cho Sói,
không phải lo rò rỉ qua tầng signaling của SFU, không cần chứng minh phe Dân
không nhận được sự kiện nào của phe Sói.

Hệ quả: **mỗi phòng game dùng đúng một room LiveKit.**

Còn đúng một hành vi phải chặn nghiêm ngặt: **người chết nói với người sống.**
Đó mới là ca gian lận thật — người chết biết vai và có thể mách. Toàn bộ phần
cưỡng chế xoay quanh nó.

## 3. Ngoài phạm vi

- Voice cho phe Sói ban đêm, voice cho người chết.
- TTS cho bot. Bàn chơi nhắm tới là đa số người thật, bot chỉ lấp chỗ; bot giữ
  nguyên chat text và không chiếm slot voice.
- Turn-based / gậy phát biểu. Ban ngày dùng push-to-talk tự do; nếu thực tế thấy
  loạn thì mở lại sau.
- Video, ghi âm, lọc ồn nâng cao.
- Sửa `resolveChat` hoặc bất cứ thứ gì trong `game-engine`. Voice không được
  phép ảnh hưởng kết quả ván đấu.

## 4. Luật quyền

| Pha | Ai được nói |
|---|---|
| `LOBBY`, `GAME_OVER` | tất cả |
| `DAY_DISCUSSION`, `VOTING`, `FINAL_VOTE`, `NIGHT_RESULT`, `ELIMINATION` | người còn sống |
| `DEFENSE` | chỉ bị cáo |
| `NIGHT`, `ROLE_REVEAL`, `HUNTER_SHOT`, `CHECK_WIN` | không ai |

Người chết luôn **nghe được** mọi thứ phát ra trong room (nhất quán với text:
người chết đã theo dõi được cả trận), nhưng không bao giờ nói được khi ván đang
chạy.

`SILENT_NIGHT` không cần xử lý riêng — ban đêm vốn đã không ai nói được.

`HUNTER_SHOT`: Thợ Săn đã chết nhưng đang hành động. Text đang chặn họ qua
`isHunterReactionParticipant`; voice giữ nguyên tinh thần đó bằng cách không cho
ai nói trong pha này.

## 5. Kiến trúc

### 5.1 Một hàm luật, hai nơi dùng

```ts
// packages/shared/src/voice.ts
export function voiceCanPublish(input: {
  phase: Phase;
  alive: boolean;
  isAccused: boolean;
}): boolean;

export function voiceRoomName(code: string): string; // "masoi-<CODE>"
```

Tiền tố `masoi-` không phải trang trí: mục 7.3 dọn rác lúc boot bằng cách xoá
theo đúng tiền tố này.

Hàm thuần, không chứa bí mật, dùng chung client/server — đúng kiểu
`validateRoomConfig` đã có sẵn trong cùng package.

Server dùng nó để **cưỡng chế**. Client dùng **chính nó** để tự tắt mic tức thì.
Một hàm, hai người dùng, không thể lệch nhau, và test được độc lập không cần
LiveKit lẫn socket.

**Cố ý không gộp vào `resolveChat`.** Hai thứ khác hình dạng — text trả về kênh
cộng danh sách người nhận, voice chỉ trả về một boolean — và voice cố ý là tập
con hẹp hơn. Gộp lại sẽ làm `resolveChat` phình ra phục vụ hai mục đích. Rủi ro
trôi khỏi nhau được chặn bằng test bất biến ở mục 8, không bằng cách gộp code.
Đặt comment trỏ chéo ở cả hai file.

### 5.2 Module mới

| File | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `packages/shared/src/voice.ts` | Luật quyền + đặt tên room | không |
| `apps/server/src/voice/livekit.ts` | Vỏ mỏng bọc SDK: ký token, đổi quyền, xoá room, liệt kê room | `livekit-server-sdk` — **nơi duy nhất** import |
| `apps/server/src/voice/service.ts` | Phần biết luật chơi: `syncVoicePermissions(room)` | `voice.ts`, `livekit.ts` |
| `apps/web/src/lib/voice-state.ts` | Suy ra trạng thái UI từ snapshot — hàm thuần | `@masoi/shared` |
| `apps/web/src/lib/voice-room.ts` | Vỏ bọc client LiveKit | `livekit-client` |
| `apps/web/src/lib/useVoice.ts` | Hook cho component | hai file trên |

Tách `livekit.ts` khỏi `service.ts` để đổi nhà cung cấp sau này chỉ phải viết
lại một file không chứa luật chơi, và để test `service.ts` bằng bản giả — không
cần key thật, không gọi mạng trong test.

Component chỉ thấy hook, không bao giờ thấy SDK.

### 5.3 Sửa vào code sẵn có

- `RoomConfig.voice?: boolean` + `roomConfigSchema` (đang là `.strict()`) +
  `DEFAULT_ROOM_CONFIG` (mặc định `false`).
- `RoomSnapshot.voice?: { enabled: boolean; canPublish: boolean; roomName: string }`
  — **optional bắt buộc**: web và server deploy rời nhau, client mới chạy với
  server cũ phải không vỡ. Ràng buộc này đã được ghi trong `snapshot.ts`.
  `canPublish` ở đây dùng cho **hai việc và chỉ hai việc**: tắt mic tức thì khi
  bị thu quyền, và vẽ trạng thái UI. Nó **không** phải thứ cho phép mở mic —
  theo mục 6.3, việc mở mic chờ tín hiệu từ chính LiveKit.
- `sync()` trong `game/machine.ts` gọi thêm đúng một dòng. Đó là phễu duy nhất
  mọi chuyển pha đi qua, nên không phải rải lời gọi khắp ~20 hàm chuyển pha.
- Event socket mới: `voice:token`.

**Không** thêm state voice vào `Room`. Nguồn sự thật là pha + sống/chết, đều đã
có sẵn trong engine.

Ngoại lệ duy nhất, và nó không phải state của ván đấu: `voice/service.ts` giữ
một `Map<roomCode, Map<playerId, boolean>>` ghi lại **quyền đã áp lần gần nhất**.
Nó tồn tại chỉ để khỏi gọi LiveKit cho người không đổi quyền. Mất nó là vô hại —
hậu quả tối đa là áp lại quyền cho mọi người một lần, vẫn ra kết quả đúng. Vì
thế nó nằm trong module voice, không nằm trong `Room` và không được persist.

## 6. Luồng dữ liệu

### 6.1 Danh tính

Participant identity trong LiveKit **chính là `playerId`**. Không sinh id thứ
hai, không cần bảng ánh xạ.

Bot không bao giờ có token và không bao giờ vào room LiveKit.

Game cho phép một người mở nhiều tab, nhưng LiveKit trùng identity thì đá kết
nối cũ — nên mỗi người chơi luôn chỉ có đúng một mic. Đây là hành vi mong muốn,
có sẵn, không phải làm gì thêm.

### 6.2 Các bước

1. Client thấy `snapshot.voice.enabled` → hiện nút "Bật mic". Người chơi **phải
   tự bấm**: đó là user gesture bắt buộc để iOS Safari cho phát tiếng, đồng thời
   là chỗ xin quyền mic. Không có đường nào tự động vào voice.
2. Bấm nút → `voice:token` qua socket (đã có auth `playerId` + `token`) → server
   ký token với quyền tính từ pha hiện tại → client connect.
3. Chuyển pha → `sync(room)` → `syncVoicePermissions(room)`: với mỗi thành viên,
   tính `voiceCanPublish`, so với quyền đang giữ, **chỉ gọi `updateParticipant`
   cho người thực sự đổi quyền**. Chuyển pha không ai đổi trạng thái sống/chết
   thì thường là 0 lời gọi.
4. Chết giữa ván đi chung đường trên — cái chết luôn xảy ra tại một chuyển pha.
5. `resetToLobby` → xoá room LiveKit.

**Không xoá room ở `GAME_OVER`.** Bảng ở mục 4 cho tất cả nói ở `GAME_OVER`, và
đó là chủ ý: lúc lật bài xong là lúc đáng nói nhất cả ván. Room chỉ bị xoá khi
phòng thực sự quay về lobby.

### 6.3 Thứ tự thu và cấp quyền

Không await LiveKit trước khi `broadcastRoom`: một lần LiveKit chậm sẽ làm cả
bàn đứng hình chờ đổi pha. Thay vào đó hai chiều xử lý khác nhau:

- **Thu quyền** (ngày → đêm, sống → chết): server gọi LiveKit, *đồng thời* client
  tự mute ngay khi nhận snapshot. Hai lớp độc lập — lớp nhanh là client, lớp
  chắc là server.
- **Cấp quyền** (đêm → ngày): client **không** tin snapshot. Nó đợi sự kiện đổi
  quyền từ chính LiveKit rồi mới mở được mic. Nhờ vậy không có cửa sổ client
  tưởng mình nói được trong khi LiveKit còn từ chối.

Kết quả: luồng game không bao giờ phụ thuộc độ trễ của LiveKit — quan trọng vì
server nằm trên Render Free.

## 7. Xử lý lỗi

### 7.1 Cưỡng chế không phụ thuộc socket

`syncVoicePermissions` duyệt **`room.members`**, không duyệt danh sách socket
đang kết nối. Một người ngắt socket rồi ngồi im trong LiveKit **vẫn bị thu quyền
đúng lúc chết**. Đây là tính chất khiến mô hình thực sự an toàn chứ không chỉ
trông có vẻ an toàn.

### 7.2 Fail-closed

`updateParticipant` hỏng thì người đó giữ nguyên quyền cũ. Nếu quyền cũ là "được
nói" còn quyền mới là "không", đó đúng là ca rò rỉ. Nên khi **thu quyền** mà gọi
hỏng: thử lại một lần, vẫn hỏng thì `removeParticipant` — đá khỏi room voice.
Mất tiếng thì khó chịu, nói được khi không được phép thì hỏng ván.

Chiều **cấp quyền** hỏng không cần leo thang: hậu quả chỉ là chưa nói được, lần
`sync` kế tiếp thử lại.

### 7.3 Dọn rác sau khi server restart

State phòng nằm trong RAM; server restart là ván về lobby, nhưng room LiveKit
vẫn sống và mọi người vẫn nghe nhau với quyền của pha cũ.

Xử lý: lúc boot, `listRooms()` rồi xoá mọi room mang tiền tố của mình. Server
chạy **một instance** (ràng buộc đã ghi trong README) nên lúc boot chắc chắn
không có ván nào đang chạy — không có rủi ro xoá nhầm phòng của instance khác.

Đặt thêm `emptyTimeout` phía LiveKit để room tự tiêu nếu cả hai đường trên cùng
trượt.

### 7.4 Bảng ca biên

| Tình huống | Xử lý |
|---|---|
| Từ chối quyền mic / không có mic | Chế độ **chỉ nghe**. Không bao giờ chặn vào phòng hay bắt đầu ván; text là đường lui đầy đủ |
| LiveKit chết giữa ván | Ván chạy tiếp bình thường; UI báo mất tiếng, text vẫn chạy. Voice không bao giờ nằm trên đường tới hạn của trận đấu |
| Rớt mạng rồi vào lại | Bám `reconnectPlayer` sẵn có. Token ký lại, quyền tính từ pha hiện tại — không khôi phục quyền cũ |
| Bị kick / rời phòng | `removeParticipant` ngay, không đợi hết pha |
| Host tắt voice trong phòng chờ | Xoá room LiveKit, mọi người rơi về text |
| Hai người ngồi cùng phòng vật lý | Hú. `echoCancellation` bật sẵn nhưng không cứu được ca này — cảnh báo trên UI, không cố sửa bằng code |
| Gọi `voice:token` dồn dập | Dùng lại `allowAction`, cùng kiểu rate limit với `chat:send` |

### 7.5 Không cố sửa

Voice làm lộ danh tính qua giọng nói. Đó là đặc tính của thể loại, không phải
lỗi. Một dòng cảnh báo ở phòng chờ khi bật voice, hết.

## 8. Kiểm thử

**Lưu ý về hạ tầng test:** `packages/shared` có thư mục `tests/` nhưng **không
có script `test`**, và `npm test` ở gốc chỉ gọi engine + server + web — nên
`packages/shared/tests/roles.test.ts` hiện không bao giờ chạy. Vì thế logic của
`shared` được test **từ suite vitest của server**, theo nếp
`apps/server/tests/cursed-schema.test.ts` đã có. Đặt test cạnh file chết kia sẽ
tạo ảo giác đã kiểm chứng phần quan trọng nhất.

(File chết đó là vấn đề có sẵn, báo riêng, không gộp vào việc này.)

**`apps/server/tests/voice-permission.test.ts`** — bảng vét cạn: mọi pha ×
sống/chết × là-bị-cáo/không. Thuần, không LiveKit, không socket. Tính đúng đắn
thực sự nằm ở đây.

**Test bất biến chéo** — với mọi tổ hợp, `voiceCanPublish` đúng thì `resolveChat`
cũng phải cho người đó nói. Voice **không bao giờ được rộng hơn text**. Đây là
hàng rào chặn đúng rủi ro còn lại của quyết định không gộp code ở mục 5.1: ai đó
sửa luật chat mà quên voice, hoặc ngược lại, sẽ thấy test đỏ.

**`apps/server/tests/voice-sync.test.ts`** — `syncVoicePermissions` với
`livekit.ts` giả:

- chỉ gọi cho người đổi quyền, không gọi cho người không đổi;
- không bao giờ gọi cho bot;
- thu quyền thất bại thì leo thang sang `removeParticipant`;
- duyệt `members` chứ không phải socket đang kết nối.

**`apps/web/src/lib/voice-state.test.ts`** — chạy bằng `node:test` như các lib
khác. Buộc phần suy ra trạng thái UI từ snapshot phải là hàm thuần tách khỏi
SDK. Web ở repo này không có test component, nên logic không tách ra được là
logic không kiểm chứng được.

**Thủ công** — hai trình duyệt, LiveKit thật, kiểm đúng một điều: người chết bấm
mic thì không ai nghe thấy.

## 9. Cấu hình

```text
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
```

Key chỉ nằm ở server. Client không bao giờ thấy secret — nó chỉ nhận token JWT
do server ký theo pha và vai.

**Thiếu cả ba** → `voice.enabled` là `false`, công tắc trong phòng chờ không
hiện, mọi thứ chạy y hệt hôm nay. Đúng nếp `BOT_AI_ENABLED`.

**Có một phần, thiếu một phần** → ném lỗi lúc khởi động. Đây là chỗ cố ý đi
ngược thói quen thoái lui im lặng: comment dài trong `config.ts` về
`BOT_AI_MAX_CALLS_PER_GAME` đã kể đúng câu chuyện vì sao im lặng nuốt cấu hình
hỏng là cái bẫy — tính năng tắt ngấm ngầm, không log, không báo lỗi.

Phụ thuộc mới: `livekit-server-sdk` (server), `livekit-client` (web).

## 10. UI

- **Phòng chờ:** công tắc voice cho host, chỉ hiện khi server có key. Kèm dòng
  cảnh báo giọng nói lộ danh tính.
- **Cổng vào:** nút "Bật mic" bấm một lần — user gesture cho iOS, và là chỗ xin
  quyền mic.
- **Trong ván:** nút push-to-talk giữ để nói; trạng thái *chỉ nghe* hiện rõ khi
  chết hoặc khi từ chối mic; vòng sáng quanh ghế người đang nói ở `PlayerSeat`.

Bám trần tham vọng UI đã thống nhất cho dự án: bố cục, nhịp và màu — không thêm
lớp render mới.

## 11. Các bước

1. Luật + schema + trường snapshot trong `shared`. **Chạy và test được trọn vẹn
   khi chưa có key LiveKit nào** — toàn bộ phần dễ sai nhất được chốt trước khi
   chạm vào mạng.
2. Module server: `livekit.ts`, `service.ts`, event `voice:token`, cắm vào
   `sync()`.
3. Web: hook + nút bật mic + push-to-talk.
4. Chỉ báo ở ghế + công tắc phòng chờ + cảnh báo.
5. Dọn room lúc boot và lúc phòng quay về lobby.

## 12. Rủi ro đã biết

- **Chi phí LiveKit.** Một ván 12 người × 20 phút ≈ 240 participant-minutes. Free
  tier đủ cho bản dùng thử; nếu dùng nhiều lên thì phải xem lại.
- **Render Free ngủ khi idle.** Media đi thẳng LiveKit không qua Render, nhưng
  việc đổi quyền theo pha thì đi qua Render. Server ngủ giữa ván đã là hỏng ván
  sẵn, nên đây không phải rủi ro mới do voice tạo ra.
- **iOS Safari** là nơi hay vỡ nhất; nút "Bật mic" là cách chặn, nhưng phải thử
  thật trên máy iOS trước khi coi là xong.
