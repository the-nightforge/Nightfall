# Thiết kế Voice Chat (LiveKit)

Ngày: 2026-08-30 · Nhánh: `feat/voice-chat` · Bản 2 (sau review độc lập)

> Bản 1 đã qua một lượt review nghiêm ngặt và bị phát hiện 4 lỗi P0 phá đúng bất
> biến mà nó tự nhận bảo vệ. Bản này vá cả 4. Mục 14 ghi lại những gì đã đổi và
> vì sao, để người đọc sau không vô tình khôi phục lại thiết kế cũ.

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
không phải lo rò rỉ qua tầng signaling của SFU.

Hệ quả: **mỗi phòng game dùng đúng một room LiveKit.**

Còn đúng một hành vi phải chặn nghiêm ngặt: **người chết nói với người sống.**
Đó mới là ca gian lận thật. Toàn bộ phần cưỡng chế xoay quanh nó — và bản 1 đã
để hở ba đường vòng qua nó, xem mục 14.

## 3. Ngoài phạm vi

- Voice cho phe Sói ban đêm, voice cho người chết.
- TTS cho bot. Bàn chơi nhắm tới là đa số người thật, bot chỉ lấp chỗ; bot giữ
  nguyên chat text và không chiếm slot voice.
- Turn-based / gậy phát biểu. Ban ngày dùng push-to-talk tự do.
- Video, ghi âm, lọc ồn nâng cao.
- Sửa `resolveChat` hoặc bất cứ thứ gì trong `game-engine`.
- **`DEAD_CAN_SPEAK` vĩnh viễn là text-only.** Event này (`eventManager.ts:129`)
  cho một người chết gửi tin nhắn **ẩn danh** 120 ký tự; hiện chưa cài đặt
  (`engine.ts:405`). Voice không bao giờ ẩn danh được — định tuyến nó qua voice
  sẽ phá chính tiền đề của event.

## 4. Luật quyền

| Pha | Ai được nói |
|---|---|
| `LOBBY`, `GAME_OVER` | tất cả |
| `DAY_DISCUSSION`, `VOTING`, `FINAL_VOTE`, `NIGHT_RESULT`, `ELIMINATION` | người còn sống |
| `DEFENSE` | chỉ bị cáo |
| `NIGHT`, `ROLE_REVEAL`, `HUNTER_SHOT`, `CHECK_WIN` | không ai |

Người chết luôn **nghe được** mọi thứ phát ra trong room, nhưng không bao giờ
nói được khi ván đang chạy.

`SILENT_NIGHT` không cần xử lý riêng — ban đêm vốn đã không ai nói được.

`HUNTER_SHOT`: Thợ Săn đã chết nhưng đang hành động. Text đang chặn họ qua
`isHunterReactionParticipant`; voice giữ nguyên tinh thần đó.

## 5. Grant — ghim toàn bộ, không dựa vào mặc định

**Đây là bản vá P0-1.** LiveKit đặt `canPublishData` mặc định **`true`**, và nếu
không set cả `canPublish` lẫn `canSubscribe` thì **bật cả hai**. Một token chỉ
set `canPublish` sẽ mở sẵn kênh dữ liệu cho mọi người: người chết gõ
`room.localParticipant.publishData(...)` trong DevTools là nhắn thẳng tới toàn
bộ người sống, không qua `resolveChat`, không rate limit, không lưu vết.

Mọi token ký ra **bắt buộc** mang đúng bộ grant này:

```ts
{
  roomJoin: true,
  room: voiceRoomName(env, code),
  canSubscribe: true,
  canPublish: false,          // LUÔN false - xem mục 6
  canPublishData: false,
  canPublishSources: ["microphone"],
  canUpdateOwnMetadata: false,
  hidden: false,
}
```

`canPublishSources` giới hạn ở microphone chặn luôn camera và screen share —
không có nó, `canPublish: true` cho phép publish mọi nguồn.

Adapter phải là **nơi duy nhất** dựng object này, và có test khẳng định từng
trường, để không ai vô tình bỏ sót một dòng khi thêm tính năng sau này.

## 6. Token không bao giờ cấp quyền nói

**Đây là bản vá P0-2**, và là thay đổi quan trọng nhất so với bản 1.

Quyền của participant lấy từ grant trong token **lúc join**. `updateParticipant`
chỉ sửa participant đang sống trong phiên hiện tại. Ngắt kết nối là participant
bị huỷ; nối lại bằng token cũ là một phiên **mới**, quyền lại lấy từ token.

Bản 1 ký token "với quyền tính từ pha hiện tại". Hệ quả: người chơi còn sống lúc
10:00 nhận token có `canPublish: true` — token nằm trong tab, đọc được bằng
DevTools. 10:05 chết. Server thu quyền đúng như thiết kế. Người đó gọi lại
`room.connect(url, tokenCũ)` → phiên mới, quyền theo token → **nói được với
người sống**. Không cần hack, chỉ cần dán lại chuỗi mình đã có.

TTL mặc định của LiveKit là **6 giờ**, dài hơn mọi ván đấu, nên hết hạn không
cứu được.

**Quy tắc:**

1. Token **luôn** ký `canPublish: false`, không ngoại lệ, kể cả cho người đang
   được phép nói.
2. Quyền nói **chỉ** đến từ `updateParticipant`, sau khi đã join.
3. TTL 120 giây — token chỉ đủ để join, không phải để giữ.

Token cũ dùng lại thì vào phòng câm, và server chỉ cấp quyền nói nếu **lúc đó**
người này thật sự được nói.

Điều này khiến quy tắc "client không tin snapshot để mở mic" (mục 8.3) từ tối ưu
hoá trở thành **nền móng bắt buộc**.

## 7. Kiến trúc

### 7.1 Một hàm luật, hai nơi dùng

```ts
// packages/shared/src/voice.ts
export function voiceCanPublish(input: {
  phase: Phase;
  alive: boolean;
  isAccused: boolean;
}): boolean;

export function voiceRoomName(env: string, code: string): string; // "masoi-<env>-<CODE>"
```

Hàm thuần, không chứa bí mật, dùng chung client/server — đúng kiểu
`validateRoomConfig` đã có trong cùng package.

Server dùng nó để **cưỡng chế**. Client dùng **chính nó** để tự tắt mic tức thì.
Một hàm, hai người dùng, không thể lệch nhau, test được độc lập không cần
LiveKit lẫn socket.

Nó quyết định **một** grant duy nhất — `canPublish`. Các grant còn lại ghim cứng
ở mục 5.

**Tên room mang tên môi trường.** `masoi-dev-ABCDE` và `masoi-prod-ABCDE` không
bao giờ đụng nhau, kể cả khi dùng chung một LiveKit project.

**Cố ý không gộp vào `resolveChat`.** Hai thứ khác hình dạng — text trả về kênh
cộng danh sách người nhận, voice chỉ trả về một boolean. Rủi ro trôi khỏi nhau
được chặn bằng test bất biến ở mục 11, không bằng cách gộp code. Đặt comment trỏ
chéo ở cả hai file.

### 7.2 Module mới

| File | Trách nhiệm | Phụ thuộc |
|---|---|---|
| `packages/shared/src/voice.ts` | Luật quyền + đặt tên room | không |
| `apps/server/src/voice/livekit.ts` | Adapter: ký token, tạo/xoá room, đổi quyền, đá participant. Phân loại lỗi | `livekit-server-sdk` — **nơi duy nhất** import |
| `apps/server/src/voice/service.ts` | Phần biết luật chơi: đồng bộ quyền, hàng đợi, tập đã-join | `voice.ts`, `livekit.ts` |
| `apps/web/src/lib/voice-state.ts` | Suy ra trạng thái UI từ snapshot — hàm thuần | `@masoi/shared` |
| `apps/web/src/lib/voice-room.ts` | Vỏ bọc client LiveKit | `livekit-client` |
| `apps/web/src/lib/useVoice.ts` | Hook cho component | hai file trên |

Tách adapter khỏi service để đổi nhà cung cấp sau này chỉ phải viết lại một file
không chứa luật chơi, và để test service bằng bản giả — không cần key thật,
không gọi mạng trong test.

Adapter phải phơi ra **kiểu lỗi phân biệt được** `NotFound` với lỗi thật (mạng,
5xx). Mục 9.2 phụ thuộc vào phân biệt này.

Adapter cũng phải tách hai scheme từ một biến `LIVEKIT_URL`: `wss://` cho trình
duyệt, `https://` cho `RoomServiceClient`. Dùng nhầm scheme là lỗi cấu hình kinh
điển của LiveKit.

Component chỉ thấy hook, không bao giờ thấy SDK.

### 7.3 Sửa vào code sẵn có

- `RoomConfig.voice?: boolean` + `roomConfigSchema` (đang `.strict()`) +
  `DEFAULT_ROOM_CONFIG` (mặc định `false`).
- `RoomSnapshot.voice?: { enabled, canPublish, roomName }` — **optional bắt
  buộc**: web và server deploy rời nhau, client mới chạy với server cũ phải
  không vỡ. Ràng buộc đã ghi trong `snapshot.ts`.
  `canPublish` ở đây dùng cho **đúng hai việc**: tắt mic tức thì khi bị thu
  quyền, và vẽ UI. Nó **không** phải thứ cho phép mở mic — xem mục 8.3.
- `CLIENT_EVENTS.VOICE_TOKEN` + `SERVER_EVENTS.VOICE_TOKEN` + `VOICE_READY`.
- Năm điểm cắm ở mục 8.1.

**Không** thêm state voice vào `Room`.

Ngoại lệ duy nhất, không phải state của ván đấu: `voice/service.ts` giữ, cho mỗi
phòng, **tập người đã join voice** và **quyền đã áp lần gần nhất**. Cả hai chỉ
để tránh gọi thừa và gọi sai; mất chúng là vô hại — hậu quả tối đa là áp lại
quyền một lần. Vì thế chúng nằm trong module voice, không nằm trong `Room` và
không được persist.

## 8. Vòng đời và luồng dữ liệu

### 8.1 Năm điểm cắm — `sync()` KHÔNG phải phễu duy nhất

**Đây là bản vá P0-3.** Bản 1 khẳng định `sync()` là phễu duy nhất. Câu đó đúng
với **chuyển pha** và sai với **thay đổi tư cách người chơi**:

| Luồng | Vị trí | Hành động voice |
|---|---|---|
| Chuyển pha | `game/machine.ts::sync()` | đồng bộ quyền toàn phòng |
| Rời phòng | `rooms/service.ts::leave()` | `removeParticipant` |
| Bị đuổi | `rooms/service.ts::kick()` | `removeParticipant` |
| Host tắt voice | `rooms/service.ts::updateConfig()` | `deleteRoom` |
| Phòng biến mất | `rooms/store.ts::removeRoom()` | `deleteRoom` |

`resetToLobby` đã đi qua `sync()`, nhưng vẫn cần `deleteRoom` tường minh.

**Vì sao rời phòng là ca tệ nhất:** `leave()` đánh dấu người rời là **đã chết**
(`service.ts:142-147`) rồi **xoá họ khỏi `room.members`** (`service.ts:116`). Mà
việc đồng bộ duyệt `room.members`. Người đó vẫn ngồi trong room LiveKit, vẫn giữ
quyền nói của lúc còn sống, và **không bao giờ được duyệt tới nữa** — một cái
mic ma nghe hết mọi bàn bạc và nói được vào đó tới hết ván.

### 8.2 Danh tính và ai có mặt

Participant identity **chính là `playerId`**. Không sinh id thứ hai.

Bot không bao giờ có token và không bao giờ vào room LiveKit.

**Nhiều tab là đánh đổi, không phải quà tặng.** Game hỗ trợ nhiều tab có chủ ý
(`ws.ts:264`), nhưng LiveKit trùng identity thì đá kết nối cũ — mở tab thứ hai
sẽ giết voice ở tab thứ nhất, im lặng. UI phải nói rõ điều này khi phát hiện bị
đá, thay vì để người chơi tưởng mạng hỏng.

### 8.3 Các bước

1. Client thấy `snapshot.voice.enabled` → hiện nút "Bật mic". Người chơi **phải
   tự bấm**: user gesture bắt buộc cho iOS, và là chỗ xin quyền mic.
2. Bấm nút → `voice:token` → server kiểm tra rồi ký token (luôn `canPublish:
   false`, TTL 120s) → client `room.connect()`.
3. Client connect xong → gửi `voice:ready` → **server đồng bộ quyền cho riêng
   người này**. Không có bước này thì dưới mô hình mục 6, người vào voice giữa
   pha sẽ ngồi câm tới lần chuyển pha kế tiếp — có thể là ba phút.
4. Chuyển pha → đồng bộ quyền toàn phòng, chỉ gọi cho người **thực sự đổi
   quyền** và **đã join voice**.
5. Chết giữa ván đi chung đường bước 4.
6. `resetToLobby` / `removeRoom` / host tắt voice → `deleteRoom`.

**Không xoá room ở `GAME_OVER`.** Mục 4 cho tất cả nói ở `GAME_OVER`, và đó là
chủ ý: lúc lật bài xong là lúc đáng nói nhất cả ván.

**Sau `resetToLobby` không tự nối lại voice.** Room đã bị xoá, mọi người bị
ngắt; muốn nói tiếp thì bấm lại nút. Tự nối lại sẽ phát tiếng mà người chơi
không chủ động yêu cầu, và trên iOS còn có thể bị chặn.

### 8.4 Thứ tự thu và cấp quyền

Không await LiveKit trước khi `broadcastRoom`: một lần LiveKit chậm sẽ làm cả
bàn đứng hình chờ đổi pha.

- **Thu quyền:** server gọi LiveKit, *đồng thời* client tự mute ngay khi nhận
  snapshot. Lớp nhanh là client, lớp chắc là server. LiveKit tự unpublish track
  khi `canPublish` bị thu.
- **Cấp quyền:** client **không** tin snapshot. Nó đợi sự kiện đổi quyền từ
  chính LiveKit rồi mới mở được mic. Dưới mục 6 đây là đường **duy nhất** khả
  thi, vì token không bao giờ mang sẵn quyền nói.

### 8.5 Hàng đợi và số hiệu thế hệ

**Đây là bản vá P1-4.** Không await nghĩa là nhiều lời gọi bay song song. Chuyển
pha ở đây có thể cách nhau rất ngắn (`lockWolves` → cửa sổ Phù Thuỷ → `endNight`
ở `machine.ts:102-140`; `ELIMINATION → CHECK_WIN → DAY_DISCUSSION`).

Hai `updateParticipant` cho cùng một identity bay đi cách nhau 200ms, cái sau về
trước: kết quả cuối trên LiveKit là **quyền của pha cũ**, trong khi cache ghi
quyền của pha mới. Hai bên khớp nhau nên **sẽ không bao giờ gọi lại** — người đó
kẹt sai quyền tới khi trạng thái sống/chết đổi. Nếu chiều kẹt là "được nói khi
lẽ ra không", đó là lỗi bảo mật.

Xử lý:

- một **hàng đợi tuần tự cho mỗi phòng** (chuỗi promise), không chạy song song
  hai lượt đồng bộ của cùng phòng;
- **số hiệu thế hệ** tăng mỗi lần đồng bộ; kết quả của thế hệ cũ bị bỏ;
- cache **chỉ ghi sau khi lời gọi thành công**, không ghi lúc phát lệnh.

## 9. Xử lý lỗi

### 9.1 Cưỡng chế không phụ thuộc socket

Việc đồng bộ duyệt **thành viên phòng**, không duyệt socket đang kết nối. Một
người ngắt socket rồi ngồi im trong LiveKit vẫn bị thu quyền đúng lúc chết. Kết
hợp với mục 8.1, tập cần duyệt là **thành viên phòng ∩ đã join voice**, cộng các
lối ra tường minh cho người rời/bị đuổi.

### 9.2 Fail-closed, nhưng phân biệt loại lỗi

**Đây là bản vá P1-2.** Bản 1 nói thu quyền hỏng thì thử lại rồi
`removeParticipant`. Nhưng phần lớn thành viên chưa từng join voice, nên
`updateParticipant` trả `participant does not exist` — leo thang sẽ gọi
`removeParticipant` cho họ, mà trên LiveKit Cloud **điều đó thu hồi token của
họ**. Người chưa từng dùng voice bỗng không vào voice được nữa, không rõ lý do.

| Loại lỗi | Xử lý |
|---|---|
| `NotFound` (chưa join / đã rời) | **No-op thành công.** Không thử lại, không leo thang, không ghi cache |
| Lỗi thật, chiều **thu** quyền | Thử lại một lần; vẫn hỏng thì `removeParticipant` — mất tiếng còn hơn nói khi không được phép |
| Lỗi thật, chiều **cấp** quyền | Không leo thang; lần đồng bộ sau thử lại |

### 9.3 Vòng đời room, và vì sao KHÔNG dọn lúc boot

**Đây là bản vá P0-4.** Bản 1 định `listRooms()` rồi xoá mọi room cùng tiền tố
lúc boot, dựa trên lập luận "một instance nên lúc boot không có ván nào chạy".

Lập luận đó sai trong cửa sổ deploy. Render deploy zero-downtime: instance cũ
tiếp tục nhận toàn bộ traffic trong lúc instance mới khởi động, và SIGTERM chỉ
được gửi **60 giây sau khi instance mới healthy**, cộng 30 giây shutdown — tức
**60–90 giây hai instance cùng sống**. Instance mới boot lên sẽ xoá room của các
ván **đang chạy** trên instance cũ, mà `deleteRoom` ngắt toàn bộ participant.
Ba bàn đang tranh luận mất tiếng giữa chừng, không rõ lý do.

Bỏ hẳn boot cleanup. Nó vốn nhằm tránh "room sống sót với quyền của pha cũ" —
nhưng sau restart phòng về **LOBBY**, mà ở LOBBY ai cũng được nói, nên room sót
lại không vi phạm quyền, nó chỉ là rác. Thay bằng ba lớp:

1. `deleteRoom` tường minh ở các lối ra của mục 8.1;
2. `createRoom` tường minh với **`emptyTimeout`** để room rỗng tự tiêu —
   LiveKit tự tạo room khi người đầu tiên join, và đường tự tạo đó **không** áp
   `emptyTimeout` mình muốn, nên phải tạo tường minh trước khi cấp token đầu
   tiên của phòng;
3. tiền tố mang tên môi trường, để staging không bao giờ chạm production.

### 9.4 Bảng ca biên

| Tình huống | Xử lý |
|---|---|
| Từ chối quyền mic / không có mic | Chế độ **chỉ nghe**. Không bao giờ chặn vào phòng hay bắt đầu ván |
| LiveKit chết giữa ván | Ván chạy tiếp bình thường; text vẫn chạy. Voice không bao giờ nằm trên đường tới hạn |
| Rớt mạng rồi vào lại | Bám `reconnectPlayer` sẵn có. Token ký lại, `voice:ready` lại, quyền tính từ pha hiện tại |
| Bị kick / rời phòng | `removeParticipant` ngay (mục 8.1) |
| Host tắt voice | `deleteRoom`, mọi người rơi về text |
| Hai người cùng phòng vật lý | Hú. `echoCancellation` bật sẵn nhưng không cứu được — cảnh báo trên UI |
| Mở tab thứ hai | Tab cũ bị đá khỏi voice; UI phải nói rõ (mục 8.2) |
| Gọi `voice:token` dồn dập | Dùng lại `allowAction`, cùng kiểu với `chat:send` |

### 9.5 Không cố sửa

Voice làm lộ danh tính qua giọng nói. Đó là đặc tính của thể loại. Một dòng cảnh
báo ở phòng chờ, hết.

## 10. Contract `voice:token`

Helper `handler` trong `ws.ts:109-117` bọc `socket.on(event, async (payload) =>
...)` — **chỉ nhận một tham số**, nên ack callback của Socket.IO bị vứt đi. Trả
kết quả bằng ack sẽ phải sửa helper đang phục vụ 15 handler khác. Chọn đường ít
rủi ro hơn: **thêm server event**.

```
C→S  voice:token   {}
S→C  voice:token   { url: string, token: string, roomName: string }
C→S  voice:ready   {}
S→C  error         { message }
```

Server kiểm tra theo thứ tự: là thành viên phòng → không phải bot →
`config.voice` bật → server có cấu hình LiveKit → rate limit → mới ký token.

`url` trả về là dạng `wss://` cho trình duyệt; `RoomServiceClient` phía server
dùng dạng `https://` của cùng host.

## 11. Kiểm thử

**Hạ tầng:** `packages/shared` có thư mục `tests/` nhưng **không có script
`test`**, và `npm test` ở gốc chỉ gọi engine + server + web — nên
`packages/shared/tests/roles.test.ts` hiện không bao giờ chạy. Logic của `shared`
vì thế được test **từ suite vitest của server**, theo nếp
`apps/server/tests/cursed-schema.test.ts`. (File chết đó là vấn đề có sẵn, báo
riêng, không gộp vào việc này.)

### 11.1 Bất biến phải phát biểu theo khán giả

**Đây là bản vá P1-5**, và là lỗi trong chính phần bản 1 tâm đắc nhất.

Bản 1 viết: *"`voiceCanPublish` đúng thì `resolveChat` cũng phải cho người đó
nói."* Nhưng với người chết, `resolveChat` trả về `{ ok: true, channel: "dead" }`
(`snapshot.ts:52-56`) — tức là "được nói", chỉ là nói với người chết. Nếu ai đó
sửa nhầm và cho người chết `canPublish`, test này vẫn **xanh**. Hàng rào dựng lên
để chặn lỗi nghiêm trọng nhất lại để đúng lỗi đó lọt qua.

Phát biểu đúng:

> `voiceCanPublish(...)` đúng ⟹ `resolveChat(...).channel ∈ {"day", "lobby"}`

Voice phát tới người sống, nên nó chỉ hợp lệ khi kênh text tương ứng cũng tới
người sống. Với người chết, kênh là `dead` → test đỏ ngay.

### 11.2 Danh sách test bắt buộc

**`voice-permission.test.ts`** — bảng vét cạn mọi pha × sống/chết × là-bị-cáo;
cộng bất biến 11.1. Thuần, không LiveKit, không socket.

**`voice-token.test.ts`** — token mang **đúng** bộ grant mục 5, từng trường một;
`canPublish` **luôn** false; TTL 120s; `wss://` và `https://` tách đúng.

**`voice-sync.test.ts`** — service với adapter giả:
- chỉ gọi cho người đổi quyền, và chỉ cho người **đã join voice**;
- không bao giờ gọi cho bot;
- `NotFound` là no-op, **không** leo thang, **không** ghi cache;
- lỗi thật chiều thu quyền mới leo thang `removeParticipant`;
- phản hồi về **sai thứ tự** không để lại quyền sai (mục 8.5);
- cache chỉ ghi sau khi thành công.

**`voice-lifecycle.test.ts`** — năm điểm cắm mục 8.1: rời giữa ván →
`removeParticipant` (ca mic ma); kick; host tắt voice → `deleteRoom`; reset →
`deleteRoom`; `GAME_OVER` → **không** xoá.

**`voice-state.test.ts`** (web, `node:test`) — nhả nút trước khi promise mở mic
xong; `pointercancel` / mất focus / tab ẩn; bị thu quyền giữa lúc đang giữ nút;
mic **chỉ** mở sau sự kiện quyền từ LiveKit.

**Thủ công** — hai trình duyệt, LiveKit thật:
1. người chết bấm mic thì không ai nghe thấy;
2. **dán lại token cũ sau khi chết vẫn không nói được** (ca mục 6);
3. iOS thật: bật tiếng, khoá máy mở lại, chuyển tab.

## 12. Cấu hình

```text
LIVEKIT_URL=wss://<project>.livekit.cloud
LIVEKIT_API_KEY=<key>
LIVEKIT_API_SECRET=<secret>
LIVEKIT_ENV=dev          # vào tên room: masoi-dev-ABCDE
```

Key chỉ nằm ở server. Client không bao giờ thấy secret.

**Thiếu cả bốn** → `voice.enabled` là `false`, công tắc không hiện, mọi thứ chạy
y hệt hôm nay. Đúng nếp `BOT_AI_ENABLED`.

**Có một phần, thiếu một phần** → ném lỗi lúc khởi động. Cố ý đi ngược thói quen
thoái lui im lặng: comment dài trong `config.ts` về `BOT_AI_MAX_CALLS_PER_GAME`
đã kể vì sao im lặng nuốt cấu hình hỏng là cái bẫy.

Phụ thuộc mới: `livekit-server-sdk` (server), `livekit-client` (web).

## 13. UI

- **Phòng chờ:** công tắc voice cho host, chỉ hiện khi server có key. Kèm cảnh
  báo giọng nói lộ danh tính.
- **Cổng vào:** nút "Bật mic" bấm một lần.
- **Trong ván:** push-to-talk giữ để nói; trạng thái *chỉ nghe* rõ ràng khi chết
  hoặc từ chối mic; vòng sáng quanh ghế người đang nói.
- **iOS:** một nút là **chưa đủ**. `Room.canPlaybackAudio` có thể chuyển từ true
  về false giữa phiên, nên phải nghe `RoomEvent.AudioPlaybackStatusChanged` và
  hiện lại nút gọi `room.startAudio()` trong handler click. Đồng thời bám vào cơ
  chế mở khoá đã có (`audio-engine.ts:152-172`, listener `pointerdown` ở dòng
  238) thay vì dựng đường mở khoá thứ hai song song.
- **Bị đá vì mở tab thứ hai:** báo đúng lý do.

Bám trần tham vọng UI đã thống nhất: bố cục, nhịp và màu — không thêm lớp render
mới.

## 14. Những gì bản 2 đã đổi

| # | Bản 1 | Bản 2 | Vì sao |
|---|---|---|---|
| P0-1 | Không nói gì về grant ngoài `canPublish` | Ghim toàn bộ bộ grant (mục 5) | `canPublishData` mặc định `true` → kênh dữ liệu không ai gác |
| P0-2 | Token ký theo quyền của pha | Token **luôn** `canPublish: false`, TTL 120s | Token cũ dùng lại khôi phục quyền gốc → người chết nói được |
| P0-3 | "`sync()` là phễu duy nhất" | Năm điểm cắm (mục 8.1) | `leave`/`kick`/`updateConfig` không đi qua `sync()`; rời giữa ván để lại mic ma vĩnh viễn |
| P0-4 | Dọn room lúc boot | Bỏ hẳn; `deleteRoom` + `emptyTimeout` + tiền tố môi trường | Deploy zero-downtime của Render cho hai instance sống 60–90s |
| P1-1 | `emptyTimeout` không có `createRoom` | Thêm `createRoom` tường minh | Room tự tạo không áp `emptyTimeout` mình muốn |
| P1-2 | Thu quyền hỏng → luôn leo thang | Phân biệt `NotFound` với lỗi thật | Leo thang nhầm sẽ thu hồi token của người chưa từng dùng voice |
| P1-3 | Chỉ đồng bộ lúc chuyển pha | Thêm `voice:ready` | Dưới mục 6, người vào voice giữa pha sẽ ngồi câm tới pha sau |
| P1-4 | Fire-and-forget, không nói gì thêm | Hàng đợi + thế hệ (mục 8.5) | Phản hồi sai thứ tự làm kẹt quyền sai tới hết ván |
| P1-5 | Bất biến "voice ⟹ text ok" | Bất biến theo **khán giả** (mục 11.1) | `resolveChat` trả ok:true cho người chết (kênh `dead`) nên test cũ vô dụng |
| P1-6 | `voice:token` không có contract | Mục 10 | Helper `ws.ts` vứt ack callback nên không trả bằng ack được |

## 15. Ràng buộc toàn cục

**Thu hồi token chỉ có trên LiveKit Cloud.** Bản tự host không thu hồi được
token khi `removeParticipant`, nên đường leo thang fail-closed ở mục 9.2 sẽ mất
tác dụng và TTL ngắn trở thành phòng tuyến duy nhất. Thiết kế này **cam kết
LiveKit Cloud**; chuyển sang tự host là phải thiết kế lại mục 6 và 9.2.

## 16. Các bước

Chia thành 8 task ở implementation plan. Thứ tự có một tính chất đáng giữ: **T1
và T2 chạy và test được trọn vẹn khi chưa có key LiveKit nào** — toàn bộ phần
luật và phần sinh grant, tức hai bản vá P0 quan trọng nhất, được chốt và kiểm
chứng trước khi chạm vào mạng.

## 17. Rủi ro còn lại

- **Chi phí LiveKit.** Một ván 12 người × 20 phút ≈ 240 participant-minutes.
- **Render Free ngủ khi idle.** Media đi thẳng LiveKit, nhưng đổi quyền theo pha
  đi qua Render. Server ngủ giữa ván vốn đã hỏng ván, nên không phải rủi ro mới.
- **iOS Safari** là nơi hay vỡ nhất; phải thử trên máy thật trước khi coi là xong.
- **Suy luận chưa xác minh trực tiếp:** việc rejoin bằng token cũ khôi phục grant
  gốc (mục 6) là suy ra từ cơ chế join-lấy-grant-từ-token, không có câu khẳng
  định trực tiếp trong tài liệu. Bản vá vẫn đáng làm vì nó chặt hơn về mọi mặt và
  gần như không tốn gì. Kiểm thủ công #2 ở mục 11.2 tồn tại để xác nhận.
