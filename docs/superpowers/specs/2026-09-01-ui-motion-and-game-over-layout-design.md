# Lớp chuyển động dùng chung + màn kết thúc vừa một màn

Ngày: 2026-09-01
Nhánh: `feat/ui-motion-and-game-over-layout`

## Vấn đề

Hai vấn đề tách bạch, gộp vào một spec vì cùng chạm tầng trình bày của web.

**1. Giao diện lúc ngồi chơi đứng im.**

Repo không thiếu animation - `cinematics.css` có 28 keyframes và cả một hệ
chuyển cảnh điện ảnh. Nhưng toàn bộ nó dồn vào KHOẢNH KHẮC ĐỔI PHA. Giữa hai
lần đổi pha, tức là gần như toàn bộ thời gian người chơi thật sự ngồi trước
màn hình, giao diện không nhúc nhích:

- 34/44 component không import `motion/react`. NightPanel, DayViews, TrialPanel,
  ChatBox, RightMetaPanel - những chỗ ở lâu nhất - đều tĩnh.
- `.card` trong `@layer components` không có `transition`, cũng không có bất kỳ
  trạng thái hover nào.
- `.btn` chỉ có `transition` trần: 150ms mặc định của Tailwind với easing tuyến
  tính, thứ đọc ra là "có làm gì đó" chứ không phải "được thiết kế".
- Không có token thời lượng/easing nào. Mỗi chỗ tự chọn số, nên nhịp giữa các
  màn không khớp nhau.

**2. Màn kết thúc tràn quá một màn hình.**

`GameOverView` xếp dọc một cột: hero thắng/thua -> lưới hai phe -> hồ sơ vụ án
-> nút mở diễn biến -> thẻ chia sẻ 9:16. Chính file đó đã ghi ý định
*"màn kết thúc phải đọc được trong một màn hình"*
(`apps/web/src/components/GameOverView.tsx`), nhưng thẻ chia sẻ 9:16 là khối cao
nhất trong stack mà lại là thứ ít người nhìn nhất - nó chỉ để bấm chia sẻ.

Đích: **1920x1080** (~940px khả dụng sau thanh trình duyệt).

## Ngoài phạm vi

- **Chỉ màn kết thúc** phải vừa một màn. Lobby, các pha trong trận và trang chủ
  giữ nguyên hành vi cuộn - đã xác nhận với người yêu cầu.
- Điện thoại và tablet không đổi bố cục. Mọi thay đổi layout ở đây khoá sau
  breakpoint `lg`.
- Không đụng `cinematics.css`. Hệ chuyển cảnh đã hoàn chỉnh và có spec riêng.
- Không thêm thư viện animation nào. `motion/react` đã có sẵn.

## Phương án đã chọn

### Nửa A - dồn chuyển động vào lớp dùng chung (A1)

Bác bỏ phương án chuyển 34 component sang `m.` từng cái (A2): diff khổng lồ,
easing trôi lệch giữa các file, và bundle phình - trong khi repo VỐN ĐÃ tập
trung style nút/thẻ vào `@layer components`. Sửa ~6 class ở đó phủ hết 44
component mà không đụng file nào.

**A1.1 - Token nhịp.** Thêm biến CSS ở `:root` trong `globals.css`:
`--dur-quick` (120ms, phản hồi bấm), `--dur-base` (200ms, hover/màu),
`--dur-slow` (320ms, vào/ra khối), và `--ease-out-soft`
(`cubic-bezier(0.22, 1, 0.36, 1)` - đúng đường cong `page.tsx` đang dùng cho
chuyển pha, nâng lên thành token thay vì chép lại).

**A1.2 - Micro-interaction, sửa tại chỗ trong `@layer components`.**
`.btn*` đổi `transition` trần thành token, thêm `active:` lún xuống ~1px. Con
trỏ bàn phím (`:focus-visible`) đi cùng đường với hover, không phải một nhánh
riêng.

`.card` KHÔNG nhận hover. Phần lớn thẻ trong app là khung thông tin đứng yên -
bảng phiếu, bảng vai, hồ sơ - và cho chúng nhấc lên khi rê chuột là hứa một cú
bấm không tồn tại. Thẻ bấm được nhận một class riêng `.card-interactive` và chỉ
những chỗ thật sự bấm được mới gắn nó. Đây là lý do bước đầu tiên khi triển khai
là ĐẾM xem có bao nhiêu thẻ bấm được; nếu chỉ một hai chỗ thì class riêng là
thừa và gắn thẳng utility vào chỗ đó.

**A1.3 - Stagger.** Một object `variants` dùng chung, xuất từ
`apps/web/src/lib/motion.ts` (file mới, chỉ chứa token và variants - không có
component). Áp vào các danh sách THẬT: roster, phiếu, lịch sử vote, hồ sơ vụ án.
Không áp cho `<ul>` một phần tử hoặc danh sách đổi liên tục như chat: stagger
trên dòng chat mới sẽ làm tin nhắn tới trễ hơn chính nó.

**A1.4 - Nhấn mạnh khi số liệu đổi.** Một keyframe `value-flash` và một hook
nhỏ `useValueFlash(value)` trong `lib/motion.ts`, gắn vào số phiếu và đồng hồ.
Đây là loại chuyển động DUY NHẤT mang thông tin: nó nói "con số vừa đổi", thứ
mà một con số đứng im không nói được. Timer đã có sẵn trạng thái `danger` đổi
màu - thêm nhịp đập vào đúng trạng thái đó, không tạo trạng thái mới.

**A1.5 - Ambient.** Nối vào `Backdrop` đã có, không dựng lớp mới. Cụ thể: lớp
gradient của phông nền nhận một nhịp thở rất chậm (chu kỳ ~14s) đổi nhẹ độ mờ và
vị trí tâm sáng, dùng lại đúng biến `--sweep-color` theo mood mà `Backdrop` đã
có - nên đêm thở khác ngày mà không cần bảng màu mới.

Biên độ theo đúng chuẩn `avatar-breathe` đã đặt ra trong chính file này:
*"nhỏ tới mức không nhìn thẳng thì không thấy"*. Cụ thể là opacity dao động
trong khoảng ±0.04 và tâm sáng dịch không quá 2% chiều rộng. Chu kỳ dài và biên
độ nhỏ là cách duy nhất để một chuyển động chạy suốt 20 phút không trở thành thứ
gây khó chịu - người yêu cầu đã được cảnh báo về điểm này và vẫn chọn ambient,
nên nó được làm, ở biên độ đó.

**Reduced-motion.** CSS keyframes KHÔNG tự theo `MotionConfig reducedMotion`
của `MotionProvider` - cái đó chỉ chi phối `motion/react`. `globals.css` đang
guard thủ công ở 4 chỗ bằng `@media (prefers-reduced-motion: reduce)`. Mỗi
keyframe và transition mới trong spec này phải có mặt trong một guard như vậy.
Thiếu nó thì phần "tắt hết vẫn chơi đủ" mà `MotionProvider` hứa bị thủng.

### Nửa B - màn kết thúc (B1 + B2 làm lưới an toàn)

**B1 - bố cục lại + giấu bớt.** Hero giữ nguyên, chạy ngang trên cùng. Dưới đó
hai cột từ `lg` theo tỷ lệ `minmax(0,1fr) minmax(0,1fr)`: đội hình hai phe bên
trái, hồ sơ vụ án bên phải. Dưới `lg` vẫn đúng một cột xếp dọc như hiện tại. Thẻ chia sẻ
9:16 chui vào một nút bấm - nó là HÀNH ĐỘNG, không phải thứ để nhìn - đúng cách
"Xem toàn bộ diễn biến" đã làm trong chính file đó.

**B2 - lưới an toàn, chỉ cho đội hình.** Danh sách hai phe nhận
`max-height` + cuộn trong thẻ ở `lg`, theo đúng khuôn cột phải đang dùng
(`lg:h-[calc(100dvh-2rem)]`) và `RosterPanel`
(`lg:max-h-[calc(100dvh-16rem)]`). Bàn 12-15 người là trường hợp duy nhất còn
khả năng tràn sau B1; khoá riêng nó rẻ hơn khoá cả màn.

## Kiểm chứng

Phần layout KHÔNG được tuyên bố xong bằng suy luận. Trước khi báo hoàn thành:

1. Mở app trong trình duyệt ở đúng **1920x1080**.
2. Đo chiều cao thật của `GameOverView` với **bàn 12 người** và hồ sơ vụ án đầy
   đủ - trường hợp cao nhất có thể xảy ra.
3. Xác nhận `document.body.scrollHeight <= window.innerHeight`.

Phần animation kiểm bằng mắt cộng một lần bật `prefers-reduced-motion: reduce`
để xác nhận mọi keyframe mới thật sự tắt.

Test tự động: web dùng `node:test` trên các hàm thuần trong `lib/`, không có hạ
tầng test component. `lib/motion.ts` chứa logic thuần (token, variants, hook so
sánh giá trị) nên phần đáng test nằm đúng ở đó; CSS và bố cục không thêm test
mới, đúng nếp sẵn có của repo.
