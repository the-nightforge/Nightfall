# Chuyển cảnh 3D bằng WebGL — cảnh thử nghiệm NIGHTFALL

Ngày: 2026-09-02
Nhánh: `feat/cinematic-webgl-nightfall`

## Vấn đề

Hệ chuyển cảnh hiện tại dựng hình bằng CSS: gradient tối dần, một siluet làng
trồi lên từ đáy, một vòng tròn trăng mọc ở góc trên phải. Nó chạy tốt và có
đường lui đầy đủ, nhưng nó là hình PHẲNG. Không có chiều sâu thật giữa trăng,
sương và làng, nên "màn đêm buông xuống" đọc ra như hai lớp giấy trượt qua
nhau chứ không phải một không gian.

Mục tiêu: dựng NIGHTFALL bằng WebGL để có chiều sâu, sương thể tích và ánh
trăng thật, mà KHÔNG phá bất kỳ đường lui nào đang có, và không làm nóng điện
thoại.

Chỉ MỘT cảnh. Đây là cảnh thử nghiệm: dựng toàn bộ cơ cấu (bậc phát lại, vòng
đời context, ngân sách tải, đường lui) rồi đo trên máy thật, trước khi cam kết
làm chín cảnh còn lại.

## Vì sao NIGHTFALL là cảnh đúng để thử

Nó chạy MỖI VÒNG. Nếu một chớp WebGL 1200ms lặp lại mười lần trong một ván làm
nóng máy, tụt pin, hay đơn giản là gây chán, thì cả ý tưởng chết — và ta biết
ngay ở cảnh đầu tiên. Chọn một cảnh chạy một lần mỗi ván (như màn thắng) sẽ
giấu mất đúng câu hỏi đó cho tới khi đã làm xong hết.

## Ngoài phạm vi

- Chín cảnh còn lại. Chúng giữ nguyên đường video/CSS đang chạy.
- Thay thế các clip video có sẵn trong `public/cinematics`.
- Tự hạ bậc theo hiệu năng đo lúc chạy. Xem "Quyết định" bên dưới.
- Bất kỳ 3D nào ngoài lớp chuyển cảnh. Giao diện trong ván không đụng tới.

## Phương án đã chọn

**Một đường WebGL đi song song, rơi về đúng thang phát lại đã có** (phương án
A), thay vì thay thẳng cảnh CSS (B) hay chỉ thêm một lớp trang trí nằm sau (C).

**Sửa lại sau khi đọc `prefetchPlan`:** bản duyệt đầu nói "thêm một bậc `webgl`
vào enum `playbackMode`". Làm vậy sẽ hỏng. `prefetchPlan` mở đầu bằng
`if (inputs.mode !== "video" || inputs.saveData) return empty;` — nên một máy ở
bậc `"webgl"` sẽ ngừng prefetch CẢ CHÍN clip còn lại, và 900ms không đủ để tải
một clip, nghĩa là chín cảnh kia im lặng tụt về CSS. Một enum bậc mô tả "màn này
giàu tới đâu", nhưng WebGL ở đây là khả năng áp cho MỘT CẢNH, không phải cho cả
màn. Hai thứ đó không cùng hình dạng.

Nên `playbackMode` giữ nguyên ba giá trị, và khả năng 3D là một vị từ RIÊNG:
`canUseWebgl(inputs)`. Cảnh có scene 3D thì hỏi vị từ đó; mọi cảnh khác đi
nguyên đường video/CSS cũ, không biết gì về WebGL.

B bị bác vì nó phá ba đường lui mà `playbackMode` đang giữ: máy không có WebGL2
mất hẳn chuyển cảnh, Save-Data mất nghĩa, và `prefers-reduced-motion` phải tự
chắn lại. C bị bác vì trăng và siluet làng CHÍNH LÀ cảnh — để chúng ở CSS thì
không có chiều sâu thật, tức là mất đúng lý do dùng three.js.

### Điểm cắm: canvas nằm CHỒNG LÊN cảnh CSS, không thay nó

Đây là chỗ bản thiết kế được sửa lại sau khi đọc `CinematicOverlay.tsx`. Ý định
ban đầu là "canvas thay lớp hình CSS". Sai. Overlay đang dựng theo thứ tự:

1. `.cine-scene` + `<SceneArt>` — luôn render, là bản CSS
2. `<video>` chồng lên, `opacity-0` cho tới `onCanPlay` rồi mờ dần vào
3. Lớp chữ (`pointer-events-none`)
4. Nút "Bỏ qua"

Video KHÔNG thay cảnh CSS, nó nằm đè lên. Canvas cắm vào đúng vị trí đó, theo
đúng cách: `opacity-0` cho tới khung hình đầu tiên rồi mờ dần vào. Hệ quả là
lưới an toàn có sẵn mà không phải viết gì — WebGL chết giữa chừng thì cảnh CSS
đã nằm sẵn bên dưới, người chơi thấy bản phẳng chứ không thấy màn đen.

### Bậc là của MÁY, lựa chọn là của TỪNG CẢNH

`playbackMode()` trả về khả năng tốt nhất của máy này. Nhưng chỉ NIGHTFALL có
scene 3D, nên overlay phải chọn theo từng cảnh:

- bậc máy là `webgl` VÀ cảnh này có scene 3D VÀ WebGL chưa hỏng → canvas
- ngược lại, bậc cho phép video VÀ clip chưa nằm trong `brokenClips` → video
- ngược lại → chỉ CSS

"Cảnh này có scene 3D" là một tập tường minh các `CinematicKind`, xuất từ module
WebGL — ở bản thử nghiệm nó chứa đúng `NIGHTFALL`. Tường minh chứ không suy ra
từ việc có file hay không: thêm một cảnh 3D về sau là thêm một phần tử vào tập
đó, và trình biên dịch sẽ bắt ngay nếu tên cảnh viết sai.

Nghĩa là trên một máy đủ khoẻ, NIGHTFALL chạy 3D còn chín cảnh kia vẫn chạy
clip như cũ. Và một máy chạy 3D thì KHÔNG tải clip `nightfall.webm` nữa — không
có lý do gì tải hai bản của cùng một cảnh.

### Vòng đời context

Ba điều kiện, thiếu cái nào hỏng đúng chỗ đó:

**Một renderer duy nhất, không tạo lại mỗi lần.** Tạo/huỷ context mỗi lần chuyển
pha là mười tới hai mươi lần một ván; tạo context tốn hàng chục ms và trình
duyệt còn giới hạn số context đồng thời. Dựng lười ở cảnh 3D đầu tiên, giữ lại,
tháo khi overlay tháo.

**`requestAnimationFrame` CHỈ chạy khi đang phát.** Ngoài 1200ms đó, không có
khung hình nào được vẽ. Đây là khác biệt giữa "chớp 1,2 giây mỗi 60–90 giây" và
"một scene 3D chạy suốt ván" — và là toàn bộ lý do việc này khả thi trên điện
thoại.

**DPR chặn ở 1.5**, cụ thể là `Math.min(devicePixelRatio, 1.5)` — chặn TRẦN
chứ không đặt cứng, nên một màn hình DPR 1 vẫn render ở 1 chứ không bị kéo lên.
Một máy 1080×2400 ở DPR 3 là 7,7 triệu pixel mỗi khung; chặn ở 1.5 giảm khoảng
bốn lần chi phí tô. Với hiệu ứng phủ toàn màn thì đây là đòn bẩy lớn nhất, và ở
một cảnh 1,2 giây mắt không phân biệt được.

### Ngân sách tải

three.js không được chạm chunk đầu. `import()` động, nạp ở lần chạy cảnh 3D đầu
tiên — đúng khuôn `MotionProvider` đã dùng cho `domAnimation`, kèm chú thích
giải thích vì sao truyền thẳng là "chẳng lazy gì cả".

Chỉ import những mảnh thật sự dùng (`WebGLRenderer`, `Scene`, `PerspectiveCamera`,
hình học và vật liệu cần cho cảnh), không `import * as THREE`.

Kiểm chứng bằng số, không bằng lời: đo tổng `.next/static/chunks` trước và sau,
và xác nhận chunk chứa three.js là một chunk RIÊNG, không nằm trong đường tải
đầu.

## Quyết định: gate tĩnh, không đo hiệu năng lúc chạy

Cho chạy 3D khi: có WebGL2, không bật Save-Data, không `prefers-reduced-motion`,
không bật công tắc giảm trong game.

Gặp `webglcontextlost`, hoặc dựng renderer ném lỗi → đánh dấu hỏng và rơi về
đường video/CSS cho tới hết phiên. Đây đúng khuôn `brokenClips` đang dùng cho
video hỏng, nên nó không phải một khái niệm mới trong file này.

KHÔNG đo FPS lúc chạy rồi tự hạ bậc. Nghe thì hay, nhưng một cảnh 1,2 giây quá
ngắn để lấy mẫu tin cậy được, và một phép đo sai sẽ tắt 3D trên máy vốn chạy
tốt. Nếu đo trên máy thật cho thấy cần, thêm sau — với dữ liệu, không với linh
cảm.

## Hướng nghệ thuật

Nối tiếp bảng màu đang có, không vẽ lại: nền `#0a1226 → #050914 → #02030a`, ánh
xanh lạnh `rgba(120, 150, 220, …)` ở góc trên phải, siluet làng chiếm khoảng 46%
chiều cao ở đáy.

Phần 3D thêm vào chính là thứ CSS không làm được:
- trăng là một thiên thể có khối, đổ sáng thật lên sương
- sương có chiều sâu, các lớp trôi ở tốc độ khác nhau theo phối cảnh
- siluet làng có vài lớp cách nhau theo trục z, nên khi camera nhích thì có thị sai

Chuyển động camera phải RẤT nhỏ. Đây là chuyển cảnh 1,2 giây xem mười lần một
ván, không phải một đoạn phim mở đầu.

**Cảnh phải trọn vẹn trong `durationMs`, và phải cắt được bất cứ lúc nào.**
Overlay hẹn `setTimeout(finish, playing.durationMs)` và người chơi có thể chạm
bất kỳ đâu hoặc bấm "Bỏ qua" để kết thúc sớm. Nên scene lấy tiến độ từ thời gian
đã trôi chia cho `durationMs`, chứ không tự đếm khung hình hay tự giữ nhịp
riêng: một máy chậm phải thấy CÙNG một cảnh diễn ra ngắn hơn về số khung, không
phải một cảnh bị cắt ngang giữa chừng. Và khi bị cắt, huỷ `rAF` ngay thay vì để
nó chạy nốt.

## Kiểm chứng

**Phần thuần** (`lib/`): gate năng lực và phép tính DPR là hàm thuần, test bằng
`node:test` theo đúng nếp repo. Đây cũng là phần duy nhất đáng test tự động —
web không có hạ tầng test component, và một scene WebGL thì càng không.

**Ngân sách tải**: đo `.next/static/chunks` trước/sau, xác nhận chunk three.js
tách riêng.

**Máy thật** — không tuyên bố bằng suy luận:
1. Chạy trên một điện thoại Android tầm trung, chơi hết một ván đủ dài để
   NIGHTFALL nổ ít nhất năm lần.
2. Xác nhận máy không nóng lên rõ rệt và không có khung hình rơi ở pha ngay sau
   chuyển cảnh.
3. Bật `prefers-reduced-motion` và xác nhận KHÔNG có canvas nào được dựng —
   không phải "canvas dựng rồi ẩn đi".
4. Bật Save-Data và xác nhận rơi về CSS.
5. Ép mất context (`WEBGL_lose_context`) giữa cảnh và xác nhận thấy bản CSS chứ
   không phải màn đen.
