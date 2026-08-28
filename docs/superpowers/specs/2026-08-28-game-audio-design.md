# Âm thanh và nhạc nền

Ngày: 2026-08-28

## Mục tiêu

Thêm nhạc nền đổi theo pha và một bộ hiệu ứng ngắn cho client web, để ván đấu có không khí và để người chơi biết tới lượt mình mà không phải dán mắt vào màn hình. Toàn bộ tính năng nằm trong `apps/web`; server và engine không đổi một dòng nào.

## Quy tắc sản phẩm

- Ba track nhạc nền loop, đổi theo pha, chuyển bằng crossfade 600ms.
- Sáu hiệu ứng ngắn gắn với sáu khoảnh khắc trong ván.
- Người chơi có một nút loa tổng và hai thanh âm lượng riêng cho nhạc và hiệu ứng. Nhiều người muốn tắt nhạc nhưng vẫn giữ tiếng báo tới lượt, nên hai lớp này phải chỉnh độc lập.
- Thiết lập lưu trong `localStorage`, sống qua các ván và các phòng.
- Mặc định: nhạc 40%, hiệu ứng 80%, không tắt tiếng.
- Trang chủ không có nhạc. Chỉ trong phòng mới có.
- Thiếu file âm thanh thì im lặng, không hiện lỗi, không chặn game. Nhờ vậy code merge được trước khi có đủ asset.
- Hiệu ứng `turn` và `ballot` chỉ dựa vào snapshot riêng của người xem nên máy người khác không phát. Không có tiếng nào để lộ thông tin mà người nghe chưa được biết.

## Các phương án đã cân nhắc

### 1. `<audio>` thuần cộng một module singleton — chọn

Ba thẻ `HTMLAudioElement` cho ba track, crossfade bằng cách nhích `.volume` theo một `setInterval` ngắn; hiệu ứng phát bằng `new Audio(src)` mỗi lần gọi nên chồng tiếng được. Hai thanh âm lượng chỉ là hai hệ số nhân.

Không thêm dependency, nhạc được stream chứ không nạp hết vào bộ nhớ, và lượng code đủ nhỏ để đọc hết trong một lần. Crossfade từng nấc về lý thuyết không mượt bằng gain ramp thật, nhưng ở 600ms thì không nghe ra khác biệt.

### 2. Web Audio API, tự dựng audio engine

Một `AudioContext`, hai `GainNode` làm hai bus, decode file thành `AudioBuffer`, crossfade bằng `linearRampToValueAtTime`. Mô hình hai bus khớp đúng với hai thanh âm lượng và chuyển cảnh mượt chuẩn.

Loại vì cái giá không tương xứng: `AudioBuffer` giữ PCM đã giải nén, một loop hai phút thành hàng chục MB thường trú trên máy người chơi mobile. Đây là công cụ đúng cho một game cần trộn âm thật, còn bài toán ở đây là ba track đổi theo pha và vài tiếng ngắn.

### 3. Dùng thư viện howler.js

Ít code nhất và đã xử lý sẵn mọi quirk autoplay của iOS. Loại vì client hiện chỉ có Next, React và socket.io-client; thêm một dependency nữa cho một tính năng phụ là cái giá dài hạn không đáng, trong khi phần howler giải quyết hộ chỉ gói gọn trong vài chục dòng.

## Kiến trúc

Tách phần thuần logic khỏi phần chạm DOM, cùng cách repo đã tách `game-engine` khỏi server: chỗ nào quyết định được thì test được, chỗ chạm DOM mỏng tới mức không còn gì để test.

| File | Vai trò | Thuần |
| --- | --- | --- |
| `lib/audio-settings.ts` | Đọc ghi thiết lập vào `localStorage`, kẹp giá trị | có |
| `lib/audio-track.ts` | `trackFor(phase)` | có |
| `lib/audio-cues.ts` | `cuesFor(prev, next)` | có |
| `lib/audio-engine.ts` | Giữ ba `<audio>`, crossfade, phát hiệu ứng, mở khoá autoplay | không |
| `lib/useGameAudio.ts` | Hook nối snapshot với engine | không |
| `components/SoundControl.tsx` | Nút loa và popover hai thanh trượt | không |

Ba module thuần nằm thẳng trong `src/lib/` chứ không nhét vào thư mục con, vì script test là `tsx --test src/lib/*.test.ts` với glob phẳng.

`audio-engine` là module singleton giữ state ngoài React, đúng khuôn `lib/socket.ts`. Không dựng React context: thứ duy nhất cần chia sẻ là một object mệnh lệnh, không phải state để render.

### Luồng dữ liệu

`useRoomSocket` đã giữ snapshot. `useGameAudio(snapshot)` được gọi một lần trong `app/room/[code]/page.tsx`, giữ snapshot trước trong một ref, và mỗi lần snapshot đổi thì chạy hai nhánh:

```
snapshot mới ─┬─ trackFor(phase)     → engine.setTrack()
              └─ cuesFor(prev, next) → engine.playCue() cho từng tiếng
```

Client không có luồng sự kiện game — server chỉ gửi snapshot — nên mọi sự kiện phải suy ra bằng cách so hai snapshot liên tiếp. Đặt việc đó vào một hàm thuần khiến phần dễ sai nhất của tính năng test được bằng object thường, không cần DOM.

## Giao diện các module

```ts
// audio-track.ts
export type Track = "night" | "day" | "vote";
export function trackFor(phase: Phase): Track | null;

// audio-cues.ts
export type Cue = "howl" | "turn" | "death" | "ballot" | "win" | "lose";
export function cuesFor(prev: RoomSnapshot | null, next: RoomSnapshot): Cue[];

// audio-settings.ts
export interface AudioSettings {
  musicVolume: number; // 0..1
  sfxVolume: number;   // 0..1
  muted: boolean;
}
export const DEFAULT_SETTINGS: AudioSettings; // 0.4 / 0.8 / false
export function loadSettings(): AudioSettings;
export function saveSettings(settings: AudioSettings): void;

// audio-engine.ts
export const audioEngine: {
  unlock(): void;                        // gọi bên trong handler của cử chỉ
  setTrack(track: Track | null): void;
  playCue(cue: Cue): void;
  applySettings(settings: AudioSettings): void;
  stop(): void;
};
```

Khoá `localStorage` là `masoi.audio`, cùng tiền tố với `masoi.identity`.

### Giao diện

`SoundControl` đặt trong header của `app/room/[code]/page.tsx`, cạnh mã phòng. Bấm nút loa mở popover chứa hai `input[type=range]`. Mỗi lần đổi, component ghi bằng `saveSettings` rồi gọi `audioEngine.applySettings` ngay để nghe thấy kết quả trong lúc kéo. `useGameAudio` gọi `applySettings(loadSettings())` một lần lúc mount để engine khởi động đúng mức âm đã lưu.

Nút loa hiển thị trạng thái tắt tiếng, và cũng phản ánh việc chưa mở khoá autoplay: trước cú chạm đầu tiên, nút hiện dạng mờ kèm nhắc "chạm để bật tiếng".

## Ánh xạ pha sang nhạc

| Pha | Track |
| --- | --- |
| `NIGHT` | `night` |
| `LOBBY`, `ROLE_REVEAL`, `NIGHT_RESULT`, `DAY_DISCUSSION` | `day` |
| `VOTING`, `ELIMINATION`, `CHECK_WIN` | `vote` |
| `GAME_OVER` | không có nhạc |

Gộp `NIGHT_RESULT` vào track ngày và `ELIMINATION` vào track bỏ phiếu là có chủ ý: hai pha đó chỉ dài 8 giây, cho chúng track riêng thì nhạc giật liên tục. `GAME_OVER` tắt hẳn nhạc để tiếng `win` hoặc `lose` vang một mình.

## Hiệu ứng và cạnh kích hoạt

Gọi `changed` là điều kiện `prev.round !== next.round || prev.phase !== next.phase`. Mọi tiếng đều định nghĩa theo cạnh chứ không theo trạng thái.

| Tiếng | Điều kiện |
| --- | --- |
| `howl` | `changed` và `next.phase === "NIGHT"` |
| `turn` | `prev.night?.canAct !== true` và `next.night?.canAct === true` |
| `death` | `changed` và (`next.phase === "NIGHT_RESULT"` với `lastNightDeaths` không rỗng, hoặc `next.phase === "ELIMINATION"` với `lastEliminated !== null`) |
| `ballot` | `prev.hasVoted === false` và `next.hasVoted === true` |
| `win` | `changed`, `next.phase === "GAME_OVER"`, và `next.winner` trùng phe của `next.you.role` |
| `lose` | `changed`, `next.phase === "GAME_OVER"`, và `next.winner` khác phe của `next.you.role` |

`cuesFor` trả mảng theo đúng thứ tự bảng trên để test khẳng định được. Nếu `next.you?.role` không có thì không phát `win` lẫn `lose`.

`turn` tự động đúng với Phù Thuỷ mà không cần luật riêng: `canAct` của cô ta lật sang `true` đúng lúc bầy Sói chốt phiếu, tức là đúng lúc tới lượt.

Hai tiếng bị loại khỏi phạm vi: tiếng mỗi khi có người bỏ phiếu (phòng 15 người sẽ thành tiếng ồn) và tiếng riêng cho kết cục hoà phiếu (một file cho một tình huống hiếm).

## Hợp đồng file

Đặt trong `apps/web/public/audio/`. Tổng dung lượng nên dưới 6MB vì người chơi mobile phải tải.

| Đường dẫn | Yêu cầu |
| --- | --- |
| `music/night.mp3` | loop 60–120s, u ám, chậm |
| `music/day.mp3` | loop 60–120s, căng thẳng vừa, dùng cho cả phòng chờ |
| `music/vote.mp3` | loop 60–120s, dồn dập |
| `sfx/howl.mp3` | dưới 2s |
| `sfx/turn.mp3` | dưới 1s, nhẹ, vì nghe nhiều lần mỗi ván |
| `sfx/death.mp3` | dưới 2s |
| `sfx/ballot.mp3` | dưới 1s |
| `sfx/win.mp3` | dưới 3s |
| `sfx/lose.mp3` | dưới 3s |

Hai ràng buộc khi chọn nhạc. Thứ nhất, ba file nhạc nên cùng bộ để không lệch tông khi chuyển pha, và phải trộn sẵn cho nhỏ hơn hiệu ứng rõ rệt. Thứ hai, bộ mã hoá mp3 chèn một khoảng lặng ở đầu file nên chỗ nối vòng lặp luôn hở một vết nhỏ; chọn nhạc ambient không có nhịp trống rõ thì tai không bắt được vết đó. Đổi sang `.ogg` sẽ loop chuẩn nhưng Safari cũ không đọc được, nên không dùng.

## Chặn autoplay

Engine khởi động ở trạng thái khoá: `setTrack` chỉ ghi nhớ track cần phát chứ không gọi `play()`. Một listener `pointerdown` và `keydown` gắn một lần lên `document` mở khoá ở cú chạm đầu tiên bất kỳ, rồi phát track đang chờ. Không cần nút "bật tiếng" riêng.

Trên iOS, lệnh `play()` đầu tiên phải nằm ngay trong stack đồng bộ của handler; đặt nó sau một `await` thì Safari vẫn chặn. `play()` trả về promise có thể reject, luôn nuốt bằng `.catch(() => {})` để lỗi audio không nổi lên React.

## Kết nối lại

Đây là chỗ dễ hỏng nhất. Mỗi lần resync, client nhận lại snapshot đầy đủ; nếu diff theo trạng thái thì tiếng `death` của đêm đã qua sẽ phát lại. Hai quy tắc chặn:

1. `cuesFor(null, next)` luôn trả rỗng. Snapshot đầu tiên sau khi vào phòng hoặc nối lại không phát gì.
2. Mọi tiếng theo cạnh như bảng trên. Nhận lại đúng snapshot cũ thì không có cạnh nào.

Hook giữ snapshot trước trong ref xuyên qua lần rớt mạng, nên người rớt rồi vào lại giữa pha sẽ không nghe lại gì. Người rớt qua hẳn một pha sẽ nghe tiếng của pha mới, đúng như mong đợi.

## Xử lý lỗi

- File thiếu hoặc 404: `<audio>` bắn `onerror`, engine đánh dấu track đó không dùng được và không thử lại. `playCue` với file thiếu là no-op.
- `localStorage` ném lỗi (Safari chế độ riêng tư): `loadSettings` trả mặc định, `saveSettings` nuốt lỗi.
- Đổi track khi lần crossfade trước chưa xong: huỷ interval cũ, chỉ giữ đúng một slot timer.
- Rời phòng: fade out rồi `stop()`.
- Tab chạy nền bị trình duyệt bóp timer nên crossfade kéo dài hơn. Không xử lý; kết quả cuối vẫn đúng.

## Kiểm thử

Chạy bằng script sẵn có `tsx --test src/lib/*.test.ts`.

- `audio-track.test.ts` — mọi pha ánh xạ đúng track, `GAME_OVER` trả `null`.
- `audio-cues.test.ts` — phần nặng nhất. `prev` null trả rỗng; mỗi tiếng bắn đúng một lần trên đúng cạnh; lặp lại cùng một snapshot không bắn gì; resync giữa pha không bắn gì; `win` và `lose` chọn đúng theo phe của người xem; không có role thì không phát tiếng kết cục.
- `audio-settings.test.ts` — kẹp giá trị ngoài `[0,1]`, ghi rồi đọc lại khớp, `localStorage` ném lỗi thì trả mặc định chứ không vỡ.

`audio-engine.ts` cố ý không có unit test: mọi thứ quyết định được đã rút ra ba module thuần, phần còn lại chỉ là gọi `<audio>`, test nó sẽ là test cái mock của chính mình. Kiểm bằng tay khi chạy game.

## Ngoài phạm vi

Nhạc riêng theo vai trò, tiếng đếm ngược cuối pha, tiếng báo tin nhắn chat, cho người chơi tự chọn nhạc, và tải nhạc từ CDN ngoài.
