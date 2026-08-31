# Avatar trên object storage — thiết kế

Ngày: 2026-09-01
Nhánh: `feat/avatar-object-storage`

## Vấn đề

`Player.avatarUrl` hiện là cột `Text` chứa **data URL base64**. Client crop ảnh
bằng canvas trong [AvatarPicker.tsx](../../../apps/web/src/components/AvatarPicker.tsx),
gửi chuỗi base64 qua sự kiện Socket.IO `room:update-avatar`, và
`roomService.updateAvatar` chấp nhận payload tới 5 MB.

Chuỗi đó rồi được nhét vào `RoomMember.avatarUrl` và đi thẳng vào room snapshot.
Snapshot được phát lại cho **mọi** thành viên ở **mọi** lần thay đổi trạng thái
phòng. Một phòng 12 người mà ai cũng đặt avatar 2 MB thì mỗi lần broadcast là
24 MB nhân số người nhận. Đây là lỗi kiến trúc, không phải chuyện tối ưu.

Ngoài ra server hiện không kiểm gì ngoài tiền tố chuỗi `data:image/`. Định dạng,
kích thước ảnh, tính hợp lệ của dữ liệu và hướng xoay EXIF đều do client quyết —
tức là do người gửi request quyết.

## Mục tiêu

1. Không ghi thêm base64 vào PostgreSQL.
2. Ảnh do server xử lý và server quyết định định dạng cuối: WebP 256×256, dưới 200 KB.
3. Object nằm trên storage S3-compatible, đổi nhà cung cấp không đụng business logic.
4. Xoá/đổi avatar dọn được object cũ, và không ai xoá được object của người khác.
5. Dev chưa cấu hình storage vẫn chạy được đầy đủ, không crash.
6. Data URL cũ vẫn đọc được trong giai đoạn chuyển tiếp.

## Ngoài phạm vi

- Ảnh động (GIF, WebP animated). Bị từ chối.
- Nhiều kích cỡ / responsive srcset. Một cỡ 256×256 là đủ cho mọi chỗ hiện dùng.
- CDN, cache invalidation. Key ngẫu nhiên nên object là bất biến — không cần invalidate.
- Avatar cho bot. Bot dùng avatar mặc định như hiện nay.

## Phương án đã cân nhắc

**P1 — Proxy upload qua backend (đã chọn).** Trình duyệt gửi file gốc lên server,
server kiểm và xử lý rồi mới upload lên bucket.

**P2 — Presigned PUT, trình duyệt upload thẳng lên bucket.** Server không chạm
byte nào. Loại vì như vậy không kiểm được magic bytes, không auto-rotate, không
re-encode và không ép được ngưỡng 200 KB — mất trọn ba mục tiêu chính. Vá bằng
cách server tải object về kiểm lại sau thì mất sạch ưu điểm và còn thêm cửa sổ
object chưa duyệt nằm sẵn trong bucket.

**P3 — Hybrid: client crop bằng canvas rồi presigned upload, server `HEAD` kiểm lại.**
Loại vì `HEAD` chỉ đọc lại đúng cái client đã khai — `Content-Type` do client đặt.
Ảnh giả mạo MIME, EXIF xoay sai và bom nén đều vẫn lọt. Về bản chất vẫn là tin
client, chỉ thêm một lớp trang trí.

Băng thông Render mà P2/P3 tiết kiệm được là thứ quy mô này không thiếu. Cái
chúng đánh đổi lại đúng là những đảm bảo bảo mật vốn là lý do làm việc này.

## Kiến trúc

### Tầng storage — `apps/server/src/storage/`

| File | Trách nhiệm |
|---|---|
| `types.ts` | `interface ObjectStorage` |
| `config.ts` | `resolveObjectStorageConfig(env)` |
| `s3.ts` | Adapter S3-compatible qua `@aws-sdk/client-s3` |
| `memory.ts` | Adapter giả trong bộ nhớ, cho test và cho dev chưa cấu hình |
| `index.ts` | Chọn adapter theo cấu hình, export singleton |

```ts
export interface StoredObject {
  key: string;
  url: string;
}

export interface ObjectStorage {
  readonly configured: boolean;
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}
```

Business logic chỉ đọc `configured`. Nó không biết và không được biết mình đang
nói chuyện với R2, S3 hay MinIO. Đổi nhà cung cấp là đổi biến môi trường.

`resolveObjectStorageConfig` đi theo đúng khuôn `resolveVoiceConfig` sẵn có
trong [config.ts](../../../apps/server/src/config.ts):

- Rỗng cả sáu biến → `{ enabled: false }`, server chạy y như hôm nay.
- Điền một phần → **ném lỗi lúc khởi động**. Người đã điền bốn trong sáu biến rõ
  ràng đang muốn bật storage; im lặng bỏ qua là cách hỏng tệ nhất vì nó không
  log gì cả.
- `OBJECT_STORAGE_PUBLIC_BASE_URL` nằm trong nhóm bắt buộc. Với R2, endpoint ký
  (`<account>.r2.cloudflarestorage.com`) khác endpoint đọc công khai, nên suy ra
  URL công khai từ endpoint sẽ luôn sai.
- `http://` được chấp nhận khi `NODE_ENV !== "production"` (MinIO local) và bị
  chặn ở production.

### Xử lý ảnh — `apps/server/src/avatar/image.ts`

Thuần, không I/O mạng, test được offline.

```ts
export type ImageKind = "jpeg" | "png" | "webp";
export function sniffImageType(buf: Buffer): ImageKind | null;
export async function processAvatar(buf: Buffer): Promise<Buffer>;
```

`sniffImageType` đọc magic bytes:

| Định dạng | Bytes |
|---|---|
| JPEG | `FF D8 FF` |
| PNG | `89 50 4E 47 0D 0A 1A 0A` |
| WebP | `52 49 46 46` tại offset 0 và `57 45 42 50` tại offset 8 |

`file.mimetype` của multer **không được đọc ở bất kỳ đâu**. Nó là chuỗi do client
tự khai.

`processAvatar` dùng `sharp`:

1. `sharp(buf, { limitInputPixels: 50_000_000 })` — ảnh vượt ngưỡng bị từ chối
   thay vì làm cạn RAM và sập tiến trình.
2. `.rotate()` — tự xoay theo EXIF. Gọi trước khi resize.
3. `.resize(256, 256, { fit: "cover", position: "centre" })` — crop vuông giữa ảnh.
4. `.webp({ quality })` với thang giảm dần `[82, 70, 58]`, dừng ở bậc đầu tiên
   cho ra ≤ 200 KB. Hết thang mà vẫn vượt thì ném lỗi.

Thang chất lượng gần như không bao giờ tụt xuống bậc hai — 256×256 ở q82 thường
là 15–25 KB. Nhưng "gần như không bao giờ" không phải một đảm bảo, còn ngưỡng
200 KB thì là một yêu cầu.

Ảnh hỏng làm `sharp` ném lỗi; lỗi đó được đổi thành thông điệp tiếng Việt ở tầng
service, không rò chi tiết thư viện ra client.

### Đặt tên object

```
avatars/<playerId>/<32 hex từ crypto.randomBytes(16)>.webp
```

Tên file người dùng cung cấp không chạm tới key ở bất kỳ đâu. `playerId` trong
đường dẫn chỉ để soi bucket cho dễ; nó **không** tham gia phân quyền. Phân quyền
hoàn toàn đến từ cột `avatarKey` trong DB.

### Schema

Migration `add_player_avatar_key`:

```sql
ALTER TABLE "Player" ADD COLUMN "avatarKey" TEXT;
```

```prisma
model Player {
  id         String   @id @default(cuid())
  nickname   String
  tokenHash  String   @unique
  avatarUrl  String?  @db.Text
  avatarKey  String?
  createdAt  DateTime @default(now())
  lastSeenAt DateTime @default(now())
}
```

`avatarKey` là nguồn sự thật duy nhất cho việc xoá object; `avatarUrl` chỉ để
hiển thị. Server không bao giờ nhận key từ client, nên "xoá object của người
khác bằng URL giả" là bất khả thi về mặt cấu trúc chứ không chỉ được canh gác.
Cách này cũng miễn nhiễm với việc đổi domain công khai sau này — suy key ra từ
URL sẽ hỏng đúng lúc đó và để lại rác vĩnh viễn trong bucket.

`avatarUrl` giữ nguyên `@db.Text` để còn đọc được data URL cũ.

### Service — `apps/server/src/avatar/service.ts`

```ts
export async function setAvatar(playerId: string, file: Buffer): Promise<{ avatarUrl: string }>;
export async function clearAvatar(playerId: string): Promise<void>;
```

Thứ tự thao tác là phần quan trọng nhất của thiết kế này:

1. Sniff + `processAvatar` — chưa chạm gì bền vững.
2. Upload object **mới**.
3. Đổi DB bằng compare-and-swap:
   `updateMany({ where: { id, avatarKey: keyCũ }, data: { avatarUrl, avatarKey } })`.
4. Chỉ khi (3) đổi được đúng một dòng mới xoá object cũ.

Thứ tự này là thứ giữ lời hứa "upload mới thất bại thì không mất avatar cũ".
Storage lỗi ở (2) thì DB chưa hề bị đụng. DB lỗi ở (3) thì object vừa upload
được dọn ngay và avatar cũ nguyên vẹn.

CAS ở (3) là lời giải cho upload đồng thời. Hai request cùng lúc của cùng một
người, nếu chỉ đọc-rồi-ghi thường, sẽ cùng đọc `keyCũ = A`, cùng xoá A, và để
lại một object mồ côi vĩnh viễn. Với CAS, kẻ thua thấy `count === 0`, đọc lại
key hiện tại và thử lại (tối đa 3 lượt); object thua cuộc do chính nó dọn.

Cố ý **không** dùng `withPlayerRoomLock`: đó là khoá trong tiến trình nên nó sai
ngay khi Render chạy nhiều instance, và nó sẽ nối hàng thao tác avatar phía sau
thao tác vào/ra phòng.

Xoá object cũ luôn bọc `catch` + log. Object mồ côi là rác đáng tiếc; ném lỗi ở
bước đó là báo thất bại cho một thao tác đã thành công.

Khi `storage.configured === false`, `setAvatar` ném lỗi có mã 503 rõ ràng.
`clearAvatar` **vẫn thành công** trong trường hợp đó: nó đặt `avatarUrl` và
`avatarKey` về null rồi thôi, vì việc dọn object là thứ tốt-nếu-có chứ không
phải điều kiện để "xoá avatar" là đúng. Người chơi ở môi trường dev chưa cấu
hình storage vẫn phải gỡ được ảnh của mình.

### Endpoint — `apps/server/src/avatar/routes.ts`

| Method | Path | Vào | Ra |
|---|---|---|---|
| `PUT` | `/api/players/me/avatar` | multipart, field `file` | `200 { avatarUrl }` |
| `DELETE` | `/api/players/me/avatar` | — | `204` |

Cả hai đi qua middleware `requirePlayer` — tách ra từ đoạn kiểm Bearer đang nằm
lọt trong `/players/me/matches` của [http.ts](../../../apps/server/src/http.ts),
để chỗ xác thực chỉ còn một bản. Đây là cải thiện có mục tiêu ngay trong vùng
đang sửa, không phải refactor lan man.

Multer dùng `memoryStorage` với `limits: { fileSize: 5MB, files: 1 }`, tức là
ngưỡng 5 MB được chặn ngay ở tầng parser, trước khi có buffer đầy đủ.

| Mã | Khi nào |
|---|---|
| 400 | Không phải JPEG/PNG/WebP, hoặc ảnh hỏng, hoặc thiếu field `file` |
| 401 | Thiếu hoặc sai Bearer token |
| 413 | Quá 5 MB |
| 429 | Quá 5 lần trong 60 giây (`allowAction`) |
| 503 | Storage chưa cấu hình hoặc nhà cung cấp lỗi |

Thân lỗi là `{ error: "<tiếng Việt>" }`, đồng bộ với phần còn lại của API.

### Socket và snapshot

`room:update-avatar` **giữ lại nhưng chỉ còn nhận `null`**:

```ts
export const updateAvatarPayload = z.object({ avatarUrl: z.null() }).strict();
```

Không xoá hẳn sự kiện vì Vercel còn phục vụ bản client đã cache. Client cũ bấm
"Xóa" vẫn phải chạy được; client cũ bấm "Lưu" phải nhận lỗi tiếng Việt rõ ràng
thay vì im lặng hỏng. Handler trong `ws.ts` gọi thẳng `clearAvatar(playerId)` —
không còn đường nào từ socket dẫn tới dữ liệu ảnh.

Sau khi `setAvatar` hoặc `clearAvatar` thành công, service gọi
`roomService.applyAvatar(playerId, avatarUrl)` để cập nhật `RoomMember.avatarUrl`,
`persistRoom` rồi `broadcastRoom` — mọi người trong phòng nhận snapshot mới.
Người chơi không ở phòng nào thì bước này là no-op. Đây là phần còn lại của
`roomService.updateAvatar` cũ sau khi đã bóc hết phần kiểm tra và ghi DB ra
ngoài; nó không còn nhận dữ liệu ảnh, chỉ nhận một URL đã được service duyệt.

Snapshot có thêm một lưới an toàn: khi storage đã bật, giá trị bắt đầu bằng
`data:` bị lọc thành `null`. Kể cả di trú hỏng theo cách chưa lường được, base64
vẫn không lọt vào snapshot phát cho 12 người.

### Di trú data URL cũ

`resolveMemberAvatar(playerId)` — hàm dùng chung cho đúng hai chỗ hiện đang đọc
`prisma.player.findUnique` rồi gán `RoomMember.avatarUrl`: `roomService.create`
và `roomService.join` (nhánh thành viên mới lẫn nhánh vào lại phòng cũ).
`rooms/reconnect.ts` không đọc bản ghi Player nên không cần đụng tới.

- `avatarUrl` là URL https → trả nguyên.
- `avatarUrl` là data URL và storage đã bật → xử lý + upload + CAS ngay tại đó,
  một lần duy nhất cho mỗi người chơi cũ, rồi trả URL mới.
- `avatarUrl` là data URL và storage **chưa** bật → trả nguyên. Đây là điều giữ
  cho môi trường dev chưa cấu hình vẫn chạy đầy đủ.
- Di trú lỗi → log, trả `null`. Người đó vào phòng bình thường với avatar mặc
  định; lần vào phòng sau sẽ thử lại.

### Web

`apps/web/src/lib/avatar-upload.ts` giữ phần thuần, test được bằng `tsx --test`
như các file `lib/*.test.ts` khác:

```ts
export function validateAvatarFile(file: { size: number; type: string }): string | null;
export function avatarUploadErrorMessage(status: number, body: unknown): string;
```

Upload dùng `XMLHttpRequest` vì `fetch` không báo được tiến trình upload.

`AvatarPicker.tsx` viết lại: chọn file → xem trước bằng `URL.createObjectURL`
(không còn encode base64 trong trình duyệt) → "Tải lên" → thanh tiến trình →
thành công thì snapshot tự về qua socket; thất bại thì hiện lỗi kèm nút "Thử lại"
và avatar hiện tại không hề đổi. `fileToCroppedDataUrl` bị xoá — crop giờ là việc
của server.

`Avatar.tsx` đổi `isDataUrl` thành nhận cả `http(s)`.

## Cấu hình

| Biến | Ví dụ (R2) | Ví dụ (MinIO local) |
|---|---|---|
| `OBJECT_STORAGE_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` | `http://localhost:9000` |
| `OBJECT_STORAGE_REGION` | `auto` | `us-east-1` |
| `OBJECT_STORAGE_BUCKET` | `masoi-avatars` | `masoi-avatars` |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | từ R2 API token | `masoi` |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | từ R2 API token | `masoi_dev_password` |
| `OBJECT_STORAGE_PUBLIC_BASE_URL` | `https://pub-<hash>.r2.dev` | `http://localhost:9000/masoi-avatars` |

`docker-compose.yml` thêm service `minio` và một job khởi tạo bucket + đặt quyền
đọc công khai, để `npm run dev:infra` là đủ chạy toàn bộ local.

Không có credential thật trong repo. `.env.example` chỉ chứa khoá rỗng và chú
thích.

## Test

Server (vitest):

- Cấu hình storage: rỗng hết → tắt; điền một phần → ném lỗi; đủ → bật; `http://`
  bị chặn khi production.
- Hợp đồng adapter trên `MemoryObjectStorage`: `put` → `publicUrl` đọc lại được;
  `delete` xoá đúng key.
- Magic bytes: JPEG/PNG/WebP thật (sinh bằng sharp lúc chạy test, không commit
  ảnh nhị phân) được nhận; file giả mạo (đuôi `.png`, MIME `image/png`, ruột là
  ZIP) bị từ chối; GIF bị từ chối; buffer rỗng và buffer cụt bị từ chối.
- `processAvatar`: đọc lại bằng `sharp().metadata()` phải là WebP 256×256; ảnh
  chữ nhật ra vuông; ảnh có EXIF `Orientation=6` ra đúng chiều; kết quả ≤ 200 KB;
  ảnh vượt `limitInputPixels` bị từ chối; ảnh hỏng bị từ chối.
- Service: upload thành công ghi cả `avatarUrl` lẫn `avatarKey` và xoá object cũ;
  storage lỗi lúc `put` → DB không đổi; DB lỗi lúc ghi → object vừa upload bị dọn
  và avatar cũ nguyên vẹn; hai `setAvatar` đồng thời → DB trỏ tới đúng một object,
  object kia bị dọn, không mồ côi; `clearAvatar` xoá object và đặt DB null;
  storage chưa cấu hình → lỗi 503, không crash.
- Route (thêm `supertest` devDependency): thiếu Bearer → 401; token sai → 401;
  file > 5 MB → 413; gọi quá nhanh → 429; upload hợp lệ → 200 kèm `avatarUrl`.
- Di trú: data URL cũ thành URL https khi storage bật; đi qua nguyên khi storage
  tắt; snapshot không còn `data:` khi storage bật.
- `updateAvatarPayload` từ chối mọi chuỗi, chấp nhận `null`.

Web (`tsx --test`): `validateAvatarFile` và `avatarUploadErrorMessage`.

## Dependency mới

`sharp`, `@aws-sdk/client-s3`, `multer`, `@types/multer` (server);
`supertest`, `@types/supertest` (server, dev).

AWS SDK v3 nặng khoảng 10 MB khi cài. Chấp nhận vì đó là đường đi chuẩn và được
R2 tài liệu hoá, thay cho việc tự ký SigV4 bằng tay.

## Rủi ro đã biết

**`sharp` trên Alpine.** [Dockerfile.server](../../../Dockerfile.server) chạy
`node:20.19-alpine`, nên `sharp` phải kéo được prebuilt `@img/sharp-linuxmusl-x64`.
Phải xác nhận bằng một lần `docker build` thật, không đoán. Nếu prebuilt không có,
đường lui là đổi base image sang `node:20.19-slim` (glibc) — tốn thêm dung lượng
image nhưng không đổi thiết kế.

**Object mồ côi.** Tiến trình chết đúng giữa bước (2) và (3) để lại một object
không ai trỏ tới. Chấp nhận: vài KB rác hiếm khi xảy ra, đổi lại không phải dựng
job dọn dẹp. Nếu về sau cần, một job quét bucket đối chiếu `avatarKey` là đủ.

**Thứ tự deploy.** Migration cộng cột nên chạy an toàn trước khi code mới lên
Render. Code cũ bỏ qua cột `avatarKey` mà không sao.
