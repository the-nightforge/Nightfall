# Chân dung nhân vật — khuôn mặt thay cho bóng đen

Ngày: 2026-09-04
Nhánh: `feat/character-portraits`

## Vấn đề

Ảnh đại diện hiện tại là SVG **một path đơn sắc** lấy từ game-icons.net —
`farmer`, `cook`, `viking`, `hood`… Chúng là bóng đen: không mắt, không miệng,
không đổi theo bất cứ điều gì xảy ra trong ván. Mười lăm ô người chơi là mười
lăm cái bóng đứng yên.

Lớp dựng hình thì ngược lại, đã rất dày: 31 keyframe CSS, hệ chuyển cảnh có
đường WebGL, và hai sân khấu 3D thật (`village-memory`, `live-trial`). Nghĩa là
khoảng trống KHÔNG nằm ở kỹ thuật render. Nó nằm ở chỗ không có khuôn mặt nào
để render.

Mục tiêu: người chơi nhìn vào bàn và thấy **người ngồi ở đó** — mặt có phản
ứng, mắt nháy, miệng mấp máy đúng lúc người ấy đang nói.

Và có một lợi thế cần khai thác: `useSpeakers()` đã trả về ai đang phát tiếng
qua LiveKit. Miệng mấp máy ở đây không phải trang trí — nó là **thông tin thật**,
nhìn lưới là biết ai đang nói. Một game chỉ có bot không làm được điều đó.

## Ngoài phạm vi

- **Chân dung trong hai sân khấu 3D.** `live-trial` và `village-memory` giữ
  nguyên. Đưa mặt lên billboard là đợt sau, sau khi đã nhìn thấy chân dung 2D
  đứng cạnh cảnh 3D ở cỡ thật.
- **Chân dung theo VAI.** Vai là bí mật. `role-art.ts` ghi rõ icon đúng-theo-vai
  chỉ an toàn ở màn cấu hình phòng vì chỗ đó công khai. Chân dung là danh tính
  người chơi, không bao giờ là vai.
- **Lip-sync theo âm vị.** Miệng chỉ có ngậm và mở. Đọc âm vị cần phân tích
  luồng audio của từng remote track; giá trị thêm không đáng.
- **Sinh ảnh.** 16 sheet là việc của tác giả, không phải của agent. Thiết kế
  này cố ý chạy đúng khi CHƯA có tấm nào.
- **Đổi `Avatar`, `avatar.ts`, `avatar-art.ts`, `seat-voice.ts`.** Bốn file này
  không sửa; chúng thành tầng fallback nguyên vẹn.

## Nền tảng đã có, không xây lại

Ba thứ tưởng phải thiết kế, hoá ra đã tồn tại:

1. **Trạng thái vốn đã không nằm trên mặt.** `seatFrame({selected, dead, isMe})`
   sở hữu bảng màu viền và thứ tự ưu tiên của nó; trạng thái "đang nói" vẽ bằng
   quầng NGOÀI khung (`.seat-voice-halo`) nên không chen vào bảng ấy. Vì vậy
   chân dung có màu **không** đánh nhau với tầng trạng thái — nỗi lo ban đầu
   không có thật.
2. **`--breath-offset`** đã là biến CSS trên từng ô, đã dùng chung cho nhịp thở
   và pha quầng sáng, với lý do đã viết sẵn: ba người cùng nói mà đồng pha thì
   đọc ra như hiệu ứng của cả lưới. Nháy mắt dùng lại đúng con số đó.
3. **`assignAvatars` không lưu ở server** — client tự hash `playerId`. Đổi nguồn
   art là chuyện thuần client, không migration snapshot.

## Phương án đã chọn

**Chân dung AI sinh sẵn theo biến thể trạng thái, hoán frame** — không phải cắt
lớp mắt/miệng bằng tay, không phải rig xương, không phải vector phân lớp.

Vector phân lớp bị bác vì nó cho ra đồ hoạ phẳng, đúng thứ đang có. Cắt lớp thủ
công bị bác vì 16 nhân vật × 2 bộ phận là công việc hậu kỳ lặp lại mà kết quả
vẫn thua sinh thẳng. Mua asset pack bị bác vì pack hiếm khi có đúng 16 nhân vật
*và* đúng bộ biểu cảm, mà thiếu một cái là kẹt — tác giả không vẽ bù được.

### Một sprite sheet cho mỗi nhân vật

Bốn frame một hàng ngang, 4×256px:

| Frame | Tên | Mắt | Miệng |
|---|---|---|---|
| 0 | `idle` | mở | ngậm |
| 1 | `blink` | nhắm | ngậm |
| 2 | `talk` | mở | mở |
| 3 | `dead` | nhắm | ngậm, mặt tái |

Một file cho mỗi nhân vật chứ không phải một file cho mỗi frame, theo đúng lập
luận đã viết trong `avatar-art.ts`: một phòng hiển thị tới 15 ô, tách file là 15
lượt round-trip trên 4G. Phòng đầy = 15 request thay vì 60.

**Bốn frame, không phải năm.** Không sinh "vừa nhắm mắt vừa há miệng": nháy mắt
bị chặn trong lúc đang nói. Tiết kiệm 16 ảnh và không ai nhận ra.

Ngân sách: ~40–80KB mỗi sheet, trần tổng ~1.2MB cho cả 16. So với `public/`
đang 2.1MB là chấp nhận được, và chỉ tải sheet của nhân vật thật sự có mặt.

### Hợp đồng phong cách nằm trong repo

`public/characters/SOURCES.md`, theo tiền lệ `public/audio/CREDITS.md` và
`music-sources.json`: prompt phong cách cố định, khung hình, hướng sáng, dải
màu, model đã dùng, và ảnh tham chiếu của từng nhân vật. Sáu tháng sau cần nhân
vật thứ 17 thì mở file này ra sinh lại đúng style, không phải đoán.

Hai ràng buộc BẮT BUỘC trong prompt, không phải khuyến nghị:

- **Dải màu hẹp, nền tối trầm, không đỏ bão hoà, không xanh lá bão hoà.** Hai
  màu đó thuộc về tầng trạng thái.
- **Nhận ra được là cùng một người với cái bóng SVG.** `farmer` vẫn phải ra nông
  dân, `viking` vẫn phải ra viking — xem "Hai cỡ, hai hệ hình" bên dưới, hai hệ
  sẽ xuất hiện cạnh nhau trong cùng một màn.

### Hai cỡ, hai hệ hình

`<Avatar>` đang được gọi ở 16 chỗ với cỡ chênh nhau rất xa: `h-6 w-6` (24px)
trong `VoteHistoryPanel` và `OpenVotePanel`, cho tới chân dung lớn ở
`GameOverView` và `TrialStage`.

Nhồi 256px xuống 24px vừa tốn băng thông vừa ra một vũng nhoè. Nên:

- **`Avatar` giữ nguyên** — SVG đơn sắc, dùng cho mọi chỗ nhỏ. Ở 24px khuôn mặt
  không mang thông tin gì; cái đĩa màu mới mang.
- **`CharacterPortrait` là component mới**, chỉ dùng ở bảy chỗ hình đủ lớn:
  `PlayerSeat`, `RosterPanel`, `TrialStage`, `TrialPanel`, `GameOverView`,
  `LobbyPlayerGrid`, `DefenseVotePanel`.

## Kiến trúc

Nguyên tắc: **cái gì sai được thì không được nằm trong JSX.** Web chạy
`node:test` trên `src/lib/*.test.ts`, không có DOM, không mount được component —
đúng lý do `live-trial.ts` và `village-memory.ts` đã tách model ra khỏi renderer.

### `lib/character-portrait.ts` — model thuần

Không import React, không chạm DOM, không đọc `Date.now` bên trong.

```ts
export type PortraitMode = "dead" | "still" | "talking" | "alive";

export function portraitMode(inputs: {
  alive: boolean;
  speaking: boolean;              // đã qua seatShowsSpeaking ở nơi có nó
  animated: boolean;              // false khi prefers-reduced-motion
  talkingUntilMs: number | null;  // cho bot, xem dưới
  nowMs: number;                  // tiêm từ ngoài
}): PortraitMode;

export function portraitSource(inputs: {
  isCustom: boolean;
  hasSheet: boolean;
  saveData: boolean;
}): "upload" | "sheet" | "svg";
```

Ưu tiên cứng: `dead` > `still` > `talking` > `alive`.

Model **không tin caller**: người chết thì dù truyền `speaking: true` vẫn ra
`dead`. `seatShowsSpeaking` đã lọc rồi, nhưng `TrialStage` gọi `useSpeakers()`
thẳng chứ không qua bộ lọc đó, nên hàng rào thứ hai là cần thật.

`portraitSource` tồn tại vì thang rơi nếu để trong nhánh `if` của component thì
không test được. Tách ra thì cả hai quyết định dễ sai — *hiện frame nào* và *lấy
hình từ đâu* — đều là hàm thuần.

### `components/CharacterPortrait.tsx` — renderer mỏng

Đọc kết quả hai hàm trên rồi gắn class. Model chỉ chọn **chế độ**; frame nào
trong chế độ là việc của CSS:

- Nháy mắt: keyframe `steps()` với `animation-delay` lấy từ `--breath-offset`.
- Mấp máy: keyframe chạy khi có class `.talking`.
- `dead`: frame 3 đứng yên.

Không có vòng `requestAnimationFrame` nào cho 15 ô, không có state React đổi mỗi
frame.

### Bot — `talkingUntilMs`

Bot không có giọng nên `useSpeakers()` không bao giờ nhắc tới chúng. Chỉ nối
voice thì trong phòng nhiều bot sẽ không có cái miệng nào động đậy, hỏng đúng
mục tiêu. Cách giải: bot mấp máy trong ~1500ms sau khi dòng chat của nó vừa
hiện.

**Đường lấy dữ liệu chưa được xác minh.** Chưa biết log chat có với tới
`PlayerSeat` không, hay phải kéo prop xuyên nhiều tầng. Model nhận sẵn đầu vào
vì thêm lúc này là miễn phí và test được ngay, nhưng việc nối dây là **đợt 4** và
phải kiểm tra trước. Nếu đường dây xấu thì báo lại chứ không kéo prop xuyên năm
tầng component.

### Thang rơi

Dùng lại lối lập luận ba đầu vào của `playbackMode()` trong `cinematic-settings.ts`
— ba lý do khác nhau nên ba cách xử lý khác nhau:

| Tình huống | Kết quả | Vì sao |
|---|---|---|
| Chưa có sheet | `<Avatar>` SVG | Trạng thái ngày đầu, và nó phải đẹp |
| `<img>` lỗi / decode fail | `<Avatar>` SVG | Không để ô trống |
| Save-Data bật | `<Avatar>` SVG | Lý do là **băng thông** — không tải file |
| `prefers-reduced-motion` | **Vẫn tải sheet**, frame `idle` đứng yên | Lý do là **sức khoẻ**, không phải băng thông. Mặt vẫn có, chỉ không nháy |
| Ảnh người chơi tự tải lên | Đường `<img>` hiện tại | Không có biến thể, chế độ luôn `still` |

Save-Data và `prefers-reduced-motion` ra hai kết quả **khác nhau**, đúng như
`playbackMode` đã tách chúng. Người say chuyển động vẫn xứng đáng thấy khuôn mặt.

## Test

1. **`character-portrait.test.ts`** — bảng ưu tiên quét đủ tổ hợp; người chết
   vẫn ra `dead` kể cả khi caller truyền `speaking: true`; biên cửa sổ
   `talkingUntilMs` (trước / đúng mốc / sau); cùng `nowMs` luôn ra cùng kết quả;
   `portraitSource` đủ năm nhánh của bảng trên.
2. **Manifest** — mọi `AvatarId` có đúng một sheet, đúng 4 frame, không id thừa,
   không sheet mồ côi. Bắt lỗi "thêm nhân vật thứ 17, quên sinh sheet".
3. **Ngân sách dung lượng** — duyệt `public/characters/`, chặn trần mỗi sheet và
   trần tổng. Không có nó thì một hôm nào đó một tấm PNG 4MB lọt vào và không ai
   biết cho tới lúc người chơi 4G kêu.
4. **Ranh giới kiến trúc** — khẳng định `character-portrait.ts` không import
   React và không chạm DOM, đúng bằng mẹo `live-trial-scene.test.ts:572` đang
   dùng để chặn `three` lọt vào file sai.

## Thứ tự triển khai

**Đợt 1 — code đầy đủ, không một tấm ảnh nào.** Model, manifest, component, CSS,
nối bảy call site. Chưa có sheet nên mọi đường rơi về SVG: giao diện giống hệt
hôm nay, test xanh, merge được ngay.

Đây là điều kiện quan trọng nhất của cả kế hoạch — nó tách rủi ro kỹ thuật khỏi
rủi ro mỹ thuật, và không bao giờ để lại một nhánh dở dang chờ ảnh.

**Đợt 2 — ba sheet, cửa go/no-go.** Sinh đúng 3 nhân vật theo hợp đồng, xem
chúng đứng cạnh `live-trial` và `village-memory` ở cỡ thật, trên máy thật. Style
hỏng thì vứt 3 tấm, không phải 64.

Kiểm ở **cả 390px lẫn màn rộng**. Lần duyệt UI trước chỉ verify ở 390px và kết
quả trên màn 2559px là một cột 512px giữa bãi nền trống.

**Đợt 3 — 13 sheet còn lại.** Thuần cơ khí, không quyết định gì thêm.

**Đợt 4 — nối miệng cho bot.** Sau khi xác minh đường dữ liệu chat. Tách riêng
vì nó là đường dây dữ liệu chứ không phải mỹ thuật; đường dây xấu thì ba đợt
trên vẫn đã có giá trị.

Mỗi đợt tự đứng được và ship riêng được.

## File

**Mới:** `apps/web/src/lib/character-portrait.ts`,
`apps/web/src/lib/character-portrait.test.ts`,
`apps/web/src/lib/character-art.ts` (manifest),
`apps/web/src/lib/character-art.test.ts`,
`apps/web/src/components/CharacterPortrait.tsx`,
`apps/web/src/app/characters.css`,
`apps/web/public/characters/` (sheet + `SOURCES.md`).

**Sửa:** `PlayerSeat.tsx`, `RosterPanel.tsx`, `TrialStage.tsx`, `TrialPanel.tsx`,
`GameOverView.tsx`, `LobbyPlayerGrid.tsx`, `DefenseVotePanel.tsx`.

**Không đổi:** `Avatar.tsx`, `avatar.ts`, `avatar-art.ts`, `seat-voice.ts`.

## Rủi ro đã biết

- **Trượt phong cách giữa 16 nhân vật.** Giảm bằng hợp đồng cố định + ảnh tham
  chiếu, và bằng cửa go/no-go ở đợt 2. Không loại bỏ được hoàn toàn.
- **Ảnh vẽ đứng cạnh hình 3D procedural có thể vênh.** Chính là câu hỏi mà đợt 2
  tồn tại để trả lời, trước khi sinh 13 tấm còn lại.
- **Hai hệ hình cùng màn** (chân dung lớn và bóng SVG 24px). Chấp nhận có ý
  thức; ràng buộc "nhận ra được là cùng một người" trong `SOURCES.md` là thứ giữ
  cho nó không đọc ra như hai người khác nhau.
