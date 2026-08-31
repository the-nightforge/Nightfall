# Avatar trên object storage — kế hoạch triển khai

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay data URL base64 trong `Player.avatarUrl` bằng object WebP 256×256 nằm trên storage S3-compatible, upload qua endpoint HTTP riêng do server kiểm và xử lý.

**Architecture:** Trình duyệt gửi file gốc lên `PUT /api/players/me/avatar`. Server kiểm magic bytes, dùng `sharp` auto-rotate + crop vuông + resize 256 + encode WebP, upload lên bucket qua một abstraction `ObjectStorage`, rồi đổi DB bằng compare-and-swap trên cột `avatarKey` mới trước khi xoá object cũ. Snapshot chỉ mang URL.

**Tech Stack:** TypeScript, Express 4, Prisma 5 + PostgreSQL, Socket.IO 4, vitest (server + shared), `tsx --test` (web), Next 16 + React 19, `sharp`, `@aws-sdk/client-s3`, `multer`, `supertest`.

**Spec:** [docs/superpowers/specs/2026-09-01-avatar-object-storage-design.md](../specs/2026-09-01-avatar-object-storage-design.md)

## Global Constraints

- Nhánh làm việc: `feat/avatar-object-storage`. Không commit thẳng lên `main` — push lên `main` là nút deploy Vercel + Render.
- Mọi thông điệp lỗi tới người dùng phải bằng **tiếng Việt**. Comment code bằng tiếng Việt và giải thích **vì sao**, theo phong cách sẵn có trong `apps/server/src/config.ts`.
- Ảnh vào tối đa **5 MB** = `5 * 1024 * 1024` = `5242880` bytes.
- Ảnh ra: **WebP 256×256**, tối đa **200 KB** = `200 * 1024` = `204800` bytes.
- Chỉ nhận **JPEG, PNG, WebP**, xác định bằng **magic bytes**. `file.mimetype` do client khai không được đọc ở bất kỳ chỗ nào trong server.
- Tên file người dùng cung cấp không được dùng để dựng key. Key ngẫu nhiên: `avatars/<playerId>/<32 hex>.webp`.
- Không có credential thật trong repo. `.env.example` chỉ có khoá rỗng và chú thích.
- Test server và shared: vitest, file `apps/server/tests/*.test.ts` và `packages/shared/tests/*.test.ts`.
- Test web: `node:test` chạy qua `tsx --test`, file `apps/web/src/lib/*.test.ts`.
- Chạy `npm run build:deps` trước khi test server lần đầu (script `pretest` đã tự làm khi gọi `npm test` ở gốc).
- Mỗi task kết thúc bằng đúng một commit.

---

### Task 1: Cấu hình object storage

**Files:**
- Create: `apps/server/src/storage/config.ts`
- Modify: `apps/server/src/config.ts` (thêm `objectStorage` vào object `config`)
- Test: `apps/server/tests/storage-config.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces:
  ```ts
  export interface ObjectStorageSettings {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicBaseUrl: string;
  }
  export type ObjectStorageConfigResult =
    | { enabled: false }
    | ({ enabled: true } & ObjectStorageSettings);
  export function resolveObjectStorageConfig(env: NodeJS.ProcessEnv): ObjectStorageConfigResult;
  ```
  `config.objectStorage: ObjectStorageConfigResult`.

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/server/tests/storage-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveObjectStorageConfig } from "../src/storage/config";

const FULL: NodeJS.ProcessEnv = {
  OBJECT_STORAGE_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  OBJECT_STORAGE_REGION: "auto",
  OBJECT_STORAGE_BUCKET: "masoi-avatars",
  OBJECT_STORAGE_ACCESS_KEY_ID: "key",
  OBJECT_STORAGE_SECRET_ACCESS_KEY: "secret",
  OBJECT_STORAGE_PUBLIC_BASE_URL: "https://pub-abc.r2.dev",
};

describe("resolveObjectStorageConfig", () => {
  it("không đặt biến nào thì storage tắt", () => {
    expect(resolveObjectStorageConfig({})).toEqual({ enabled: false });
  });

  it("copy .env.example (sáu khoá rỗng) cũng là tắt, không phải hỏng một nửa", () => {
    const blank: NodeJS.ProcessEnv = {
      OBJECT_STORAGE_ENDPOINT: "",
      OBJECT_STORAGE_REGION: "",
      OBJECT_STORAGE_BUCKET: "",
      OBJECT_STORAGE_ACCESS_KEY_ID: "",
      OBJECT_STORAGE_SECRET_ACCESS_KEY: "",
      OBJECT_STORAGE_PUBLIC_BASE_URL: "",
    };
    expect(resolveObjectStorageConfig(blank)).toEqual({ enabled: false });
  });

  it("đủ sáu biến thì bật", () => {
    expect(resolveObjectStorageConfig(FULL)).toEqual({
      enabled: true,
      endpoint: "https://acct.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "masoi-avatars",
      accessKeyId: "key",
      secretAccessKey: "secret",
      publicBaseUrl: "https://pub-abc.r2.dev",
    });
  });

  it("thiếu public base URL thì ném lỗi thay vì âm thầm tắt", () => {
    const { OBJECT_STORAGE_PUBLIC_BASE_URL: _drop, ...rest } = FULL;
    expect(() => resolveObjectStorageConfig(rest)).toThrow(/OBJECT_STORAGE/);
  });

  it("thiếu bucket thì ném lỗi", () => {
    const { OBJECT_STORAGE_BUCKET: _drop, ...rest } = FULL;
    expect(() => resolveObjectStorageConfig(rest)).toThrow(/OBJECT_STORAGE/);
  });

  it("cắt dấu / thừa ở cuối public base URL", () => {
    const cfg = resolveObjectStorageConfig({
      ...FULL,
      OBJECT_STORAGE_PUBLIC_BASE_URL: "http://localhost:9000/masoi-avatars/",
      NODE_ENV: "development",
    });
    expect(cfg).toMatchObject({ publicBaseUrl: "http://localhost:9000/masoi-avatars" });
  });

  it("http:// chạy được ở dev (MinIO)", () => {
    const cfg = resolveObjectStorageConfig({
      ...FULL,
      OBJECT_STORAGE_ENDPOINT: "http://localhost:9000",
      OBJECT_STORAGE_PUBLIC_BASE_URL: "http://localhost:9000/masoi-avatars",
      NODE_ENV: "development",
    });
    expect(cfg.enabled).toBe(true);
  });

  it("http:// bị chặn ở production - avatarUrl phải là HTTPS", () => {
    expect(() =>
      resolveObjectStorageConfig({
        ...FULL,
        OBJECT_STORAGE_PUBLIC_BASE_URL: "http://cdn.example.com",
        NODE_ENV: "production",
      }),
    ).toThrow(/HTTPS/);
  });

  it("URL rác bị chặn ngay lúc khởi động", () => {
    expect(() =>
      resolveObjectStorageConfig({ ...FULL, OBJECT_STORAGE_ENDPOINT: "không-phải-url" }),
    ).toThrow(/OBJECT_STORAGE_ENDPOINT/);
  });
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npm run test --workspace @masoi/server -- storage-config`
Expected: FAIL — `Cannot find module '../src/storage/config'`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

Tạo `apps/server/src/storage/config.ts`:

```ts
export interface ObjectStorageSettings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

export type ObjectStorageConfigResult =
  | { enabled: false }
  | ({ enabled: true } & ObjectStorageSettings);

const KEYS = [
  "OBJECT_STORAGE_ENDPOINT",
  "OBJECT_STORAGE_REGION",
  "OBJECT_STORAGE_BUCKET",
  "OBJECT_STORAGE_ACCESS_KEY_ID",
  "OBJECT_STORAGE_SECRET_ACCESS_KEY",
  "OBJECT_STORAGE_PUBLIC_BASE_URL",
] as const;

function assertUrl(key: string, raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw new Error(`${key} phải là URL hợp lệ, đang là "${raw}"`);
  }
}

/**
 * Đi theo đúng khuôn resolveVoiceConfig trong ../config.ts: rỗng cả sáu khoá
 * thì tính năng tắt và server chạy y như cũ; điền một phần thì NÉM LỖI lúc
 * khởi động.
 *
 * Người đã điền bốn trong sáu khoá rõ ràng đang MUỐN bật storage. Im lặng bỏ
 * qua là cách hỏng tệ nhất vì nó không log gì - avatar sẽ hỏng ở production mà
 * không ai biết vì sao.
 *
 * Chuỗi rỗng tính như chưa đặt: .env.example khai sẵn sáu khoá rỗng, nên copy
 * template về mà nổ là hỏng đường vào của người mới.
 */
export function resolveObjectStorageConfig(env: NodeJS.ProcessEnv): ObjectStorageConfigResult {
  const values = KEYS.map((key) => env[key]?.trim() ?? "");
  const filled = values.filter((v) => v !== "").length;
  if (filled === 0) return { enabled: false };

  const missing = KEYS.filter((_, i) => values[i] === "");
  if (missing.length > 0) {
    throw new Error(
      `Cấu hình object storage thiếu một nửa: còn trống ${missing.join(", ")}. ` +
        "Bỏ trống cả sáu khoá để tắt hẳn tính năng ảnh đại diện tải lên.",
    );
  }

  const [endpoint, region, bucket, accessKeyId, secretAccessKey, rawPublic] = values;
  assertUrl("OBJECT_STORAGE_ENDPOINT", endpoint);

  // Cắt dấu / cuối một lần ở đây để publicUrl() không phải đoán, và để
  // ".../bucket/" với ".../bucket" không sinh ra hai URL khác nhau cho cùng
  // một object.
  const publicBaseUrl = rawPublic.replace(/\/+$/, "");
  const publicUrl = assertUrl("OBJECT_STORAGE_PUBLIC_BASE_URL", publicBaseUrl);

  // http:// cần cho MinIO local nhưng không được phép ở production: URL này đi
  // thẳng vào Player.avatarUrl và vào thẻ <img> của một trang chạy trên HTTPS,
  // nên trình duyệt sẽ chặn nội dung hỗn hợp và avatar biến mất.
  if (publicUrl.protocol !== "https:" && env.NODE_ENV === "production") {
    throw new Error("OBJECT_STORAGE_PUBLIC_BASE_URL phải dùng HTTPS ở production");
  }

  return { enabled: true, endpoint, region, bucket, accessKeyId, secretAccessKey, publicBaseUrl };
}
```

- [ ] **Step 4: Chạy test cho chắc là xanh**

Run: `npm run test --workspace @masoi/server -- storage-config`
Expected: PASS, 9 test.

- [ ] **Step 5: Gắn vào config chung**

Trong `apps/server/src/config.ts`, thêm import ở đầu file:

```ts
import { resolveObjectStorageConfig } from "./storage/config";
```

và thêm một dòng vào object `config` (ngay sau `voice: resolveVoiceConfig(process.env),`):

```ts
  objectStorage: resolveObjectStorageConfig(process.env),
```

- [ ] **Step 6: Lint**

Run: `npm run lint --workspace @masoi/server`
Expected: không lỗi.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/storage/config.ts apps/server/src/config.ts apps/server/tests/storage-config.test.ts
git commit -m "feat(storage): resolver cấu hình object storage S3-compatible"
```

---

### Task 2: Interface ObjectStorage và adapter giả trong bộ nhớ

**Files:**
- Create: `apps/server/src/storage/types.ts`
- Create: `apps/server/src/storage/memory.ts`
- Test: `apps/server/tests/storage-memory.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces:
  ```ts
  // types.ts
  export interface StoredObject { key: string; url: string }
  export interface ObjectStorage {
    readonly configured: boolean;
    put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
    delete(key: string): Promise<void>;
    publicUrl(key: string): string;
  }
  export class StorageNotConfiguredError extends Error {}

  // memory.ts
  export interface MemoryObjectStorage extends ObjectStorage {
    readonly objects: Map<string, { body: Buffer; contentType: string }>;
    failNextPut(message?: string): void;
    failNextDelete(message?: string): void;
  }
  export function createMemoryStorage(publicBaseUrl?: string): MemoryObjectStorage;
  ```

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/server/tests/storage-memory.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryStorage, type MemoryObjectStorage } from "../src/storage/memory";

let storage: MemoryObjectStorage;

beforeEach(() => {
  storage = createMemoryStorage("https://cdn.test/masoi");
});

describe("MemoryObjectStorage", () => {
  it("tự nhận là đã cấu hình - test không cần mạng", () => {
    expect(storage.configured).toBe(true);
  });

  it("put lưu byte và trả URL công khai đọc lại được", async () => {
    const body = Buffer.from("xin chao");
    const stored = await storage.put("avatars/p1/abc.webp", body, "image/webp");

    expect(stored).toEqual({
      key: "avatars/p1/abc.webp",
      url: "https://cdn.test/masoi/avatars/p1/abc.webp",
    });
    expect(storage.objects.get("avatars/p1/abc.webp")).toEqual({
      body,
      contentType: "image/webp",
    });
  });

  it("publicUrl ghép base với key, không thêm dấu / thừa", () => {
    expect(storage.publicUrl("avatars/p1/abc.webp")).toBe(
      "https://cdn.test/masoi/avatars/p1/abc.webp",
    );
  });

  it("delete xoá đúng key", async () => {
    await storage.put("a", Buffer.from("1"), "image/webp");
    await storage.put("b", Buffer.from("2"), "image/webp");
    await storage.delete("a");

    expect(storage.objects.has("a")).toBe(false);
    expect(storage.objects.has("b")).toBe(true);
  });

  it("xoá key không tồn tại không ném lỗi - dọn rác phải luôn an toàn khi chạy lại", async () => {
    await expect(storage.delete("không-có")).resolves.toBeUndefined();
  });

  it("failNextPut chỉ làm hỏng đúng một lần", async () => {
    storage.failNextPut("R2 sập");
    await expect(storage.put("a", Buffer.from("1"), "image/webp")).rejects.toThrow("R2 sập");
    expect(storage.objects.size).toBe(0);

    await expect(storage.put("a", Buffer.from("1"), "image/webp")).resolves.toMatchObject({
      key: "a",
    });
  });

  it("failNextDelete chỉ làm hỏng đúng một lần", async () => {
    await storage.put("a", Buffer.from("1"), "image/webp");
    storage.failNextDelete();
    await expect(storage.delete("a")).rejects.toThrow();
    expect(storage.objects.has("a")).toBe(true);

    await expect(storage.delete("a")).resolves.toBeUndefined();
    expect(storage.objects.has("a")).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npm run test --workspace @masoi/server -- storage-memory`
Expected: FAIL — `Cannot find module '../src/storage/memory'`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

Tạo `apps/server/src/storage/types.ts`:

```ts
export interface StoredObject {
  /** Khoá trong bucket. Đây là thứ được lưu vào Player.avatarKey. */
  key: string;
  /** URL công khai để hiển thị. Đây là thứ được lưu vào Player.avatarUrl. */
  url: string;
}

/**
 * Hợp đồng duy nhất mà business logic được biết về nơi lưu file.
 *
 * Không có phương thức nào để lộ ra đây là R2, S3 hay MinIO - đổi nhà cung cấp
 * là đổi biến môi trường, không phải sửa code. `configured` là công tắc duy
 * nhất tầng trên được phép hỏi.
 */
export interface ObjectStorage {
  readonly configured: boolean;
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

/** Ném khi gọi put/delete lúc chưa cấu hình storage. */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super("Object storage chưa được cấu hình");
    this.name = "StorageNotConfiguredError";
  }
}
```

Tạo `apps/server/src/storage/memory.ts`:

```ts
import type { ObjectStorage, StoredObject } from "./types";

export interface MemoryObjectStorage extends ObjectStorage {
  readonly objects: Map<string, { body: Buffer; contentType: string }>;
  /** Làm hỏng đúng lần put kế tiếp. Dùng để test đường thất bại của storage. */
  failNextPut(message?: string): void;
  /** Làm hỏng đúng lần delete kế tiếp. */
  failNextDelete(message?: string): void;
}

/**
 * Adapter giả cho test, và cho bất kỳ chỗ nào muốn chạy toàn bộ luồng avatar
 * mà không cần mạng.
 *
 * `configured` là true: nó KHÔNG phải trạng thái "chưa cấu hình" - trạng thái
 * đó là disabledStorage trong ./index.ts. Trộn hai thứ vào một object sẽ khiến
 * test không phân biệt được "storage tắt" với "storage bật nhưng lỗi".
 */
export function createMemoryStorage(publicBaseUrl = "https://cdn.test/masoi"): MemoryObjectStorage {
  const base = publicBaseUrl.replace(/\/+$/, "");
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  let putError: string | null = null;
  let deleteError: string | null = null;

  return {
    configured: true,
    objects,
    failNextPut(message = "Storage lỗi (giả lập)") {
      putError = message;
    },
    failNextDelete(message = "Storage lỗi (giả lập)") {
      deleteError = message;
    },
    publicUrl(key: string): string {
      return `${base}/${key}`;
    },
    async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
      if (putError !== null) {
        const message = putError;
        putError = null;
        throw new Error(message);
      }
      objects.set(key, { body, contentType });
      return { key, url: `${base}/${key}` };
    },
    async delete(key: string): Promise<void> {
      if (deleteError !== null) {
        const message = deleteError;
        deleteError = null;
        throw new Error(message);
      }
      objects.delete(key);
    },
  };
}
```

- [ ] **Step 4: Chạy test cho chắc là xanh**

Run: `npm run test --workspace @masoi/server -- storage-memory`
Expected: PASS, 7 test.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/storage/types.ts apps/server/src/storage/memory.ts apps/server/tests/storage-memory.test.ts
git commit -m "feat(storage): interface ObjectStorage và adapter giả trong bộ nhớ"
```

---

### Task 3: Adapter S3-compatible và singleton

**Files:**
- Create: `apps/server/src/storage/s3.ts`
- Create: `apps/server/src/storage/index.ts`
- Modify: `apps/server/package.json` (thêm `@aws-sdk/client-s3`)
- Modify: `apps/server/src/index.ts` (khởi tạo storage lúc boot)
- Test: `apps/server/tests/storage-registry.test.ts`

**Interfaces:**
- Consumes: `ObjectStorage`, `StorageNotConfiguredError` (Task 2); `ObjectStorageConfigResult`, `ObjectStorageSettings` (Task 1); `createMemoryStorage` (Task 2, dùng trong test).
- Produces:
  ```ts
  // s3.ts
  export function createS3Storage(cfg: ObjectStorageSettings): ObjectStorage;
  // index.ts
  export function objectStorage(): ObjectStorage;
  export function setObjectStorage(storage: ObjectStorage): void;
  export function resetObjectStorage(): void;
  export function initObjectStorage(cfg: ObjectStorageConfigResult): void;
  ```

- [ ] **Step 1: Cài dependency**

```bash
npm install @aws-sdk/client-s3 --workspace @masoi/server
```

- [ ] **Step 2: Viết test đỏ**

Tạo `apps/server/tests/storage-registry.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryStorage } from "../src/storage/memory";
import { StorageNotConfiguredError } from "../src/storage/types";
import {
  initObjectStorage,
  objectStorage,
  resetObjectStorage,
  setObjectStorage,
} from "../src/storage";

afterEach(() => {
  resetObjectStorage();
});

describe("Sổ đăng ký object storage", () => {
  it("mặc định là chưa cấu hình", () => {
    expect(objectStorage().configured).toBe(false);
  });

  it("chưa cấu hình thì put ném StorageNotConfiguredError chứ không sập process", async () => {
    await expect(
      objectStorage().put("a", Buffer.from("1"), "image/webp"),
    ).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("chưa cấu hình thì delete im lặng bỏ qua - dọn rác không được làm hỏng luồng gọi", async () => {
    await expect(objectStorage().delete("a")).resolves.toBeUndefined();
  });

  it("setObjectStorage đổi được adapter đang dùng", () => {
    setObjectStorage(createMemoryStorage());
    expect(objectStorage().configured).toBe(true);
  });

  it("initObjectStorage với cấu hình tắt thì giữ nguyên trạng thái chưa cấu hình", () => {
    initObjectStorage({ enabled: false });
    expect(objectStorage().configured).toBe(false);
  });

  it("initObjectStorage với cấu hình đủ thì bật adapter S3", () => {
    initObjectStorage({
      enabled: true,
      endpoint: "https://acct.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "masoi-avatars",
      accessKeyId: "key",
      secretAccessKey: "secret",
      publicBaseUrl: "https://pub-abc.r2.dev",
    });
    expect(objectStorage().configured).toBe(true);
    expect(objectStorage().publicUrl("avatars/p1/a.webp")).toBe(
      "https://pub-abc.r2.dev/avatars/p1/a.webp",
    );
  });
});
```

- [ ] **Step 3: Chạy test cho chắc là đỏ**

Run: `npm run test --workspace @masoi/server -- storage-registry`
Expected: FAIL — `Cannot find module '../src/storage'`.

- [ ] **Step 4: Viết adapter S3**

Tạo `apps/server/src/storage/s3.ts`:

```ts
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ObjectStorageSettings } from "./config";
import type { ObjectStorage, StoredObject } from "./types";

/**
 * Adapter S3-compatible dùng chung cho Cloudflare R2, AWS S3 và MinIO.
 *
 * forcePathStyle: MinIO mặc định chỉ hiểu dạng đường dẫn
 * (http://host/bucket/key), còn R2 và S3 thì chấp nhận cả hai. Chọn dạng chạy
 * được ở cả ba thay vì phải thêm một biến môi trường nữa chỉ để chọn kiểu URL.
 *
 * CacheControl một năm: key sinh ngẫu nhiên nên mỗi object là bất biến - đổi
 * ảnh là sinh key mới, không bao giờ ghi đè. Nhờ vậy không cần invalidate CDN.
 */
export function createS3Storage(cfg: ObjectStorageSettings): ObjectStorage {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });

  const publicUrl = (key: string): string => `${cfg.publicBaseUrl}/${key}`;

  return {
    configured: true,
    publicUrl,
    async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
      await client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      return { key, url: publicUrl(key) };
    },
    async delete(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
  };
}
```

- [ ] **Step 5: Viết sổ đăng ký**

Tạo `apps/server/src/storage/index.ts`:

```ts
import type { ObjectStorageConfigResult } from "./config";
import { createS3Storage } from "./s3";
import { StorageNotConfiguredError, type ObjectStorage } from "./types";

export type { ObjectStorage, StoredObject } from "./types";
export { StorageNotConfiguredError } from "./types";

/**
 * Trạng thái "chưa cấu hình".
 *
 * put NÉM còn delete IM LẶNG, và sự bất đối xứng đó là có chủ đích: upload
 * phải báo lỗi rõ ràng để client hiện được thông điệp tiếng Việt, còn dọn
 * object cũ là việc tốt-nếu-có - để nó ném thì "xoá avatar" ở môi trường dev
 * chưa cấu hình sẽ thất bại dù DB đã sạch.
 */
function disabledStorage(): ObjectStorage {
  return {
    configured: false,
    publicUrl: (key: string) => key,
    async put() {
      throw new StorageNotConfiguredError();
    },
    async delete() {
      /* không có gì để dọn */
    },
  };
}

let current: ObjectStorage = disabledStorage();

/**
 * Adapter đang dùng. Theo đúng nếp setVoiceAdmin/setIo sẵn có: nguồn sự thật
 * là "đã gắn adapter nào", không có cờ bật/tắt thứ hai để lệch nhau.
 */
export function objectStorage(): ObjectStorage {
  return current;
}

export function setObjectStorage(storage: ObjectStorage): void {
  current = storage;
}

/** Dùng cho test: trả về trạng thái chưa cấu hình. */
export function resetObjectStorage(): void {
  current = disabledStorage();
}

export function initObjectStorage(cfg: ObjectStorageConfigResult): void {
  current = cfg.enabled ? createS3Storage(cfg) : disabledStorage();
}
```

- [ ] **Step 6: Chạy test cho chắc là xanh**

Run: `npm run test --workspace @masoi/server -- storage-registry`
Expected: PASS, 6 test.

- [ ] **Step 7: Gắn vào lúc khởi động**

Trong `apps/server/src/index.ts`, thêm import:

```ts
import { initObjectStorage } from "./storage";
```

và ngay dưới dòng `console.log(...Voice chat...)`, thêm:

```ts
  initObjectStorage(config.objectStorage);
  console.log(
    `[server] Object storage: ${
      config.objectStorage.enabled ? `bật (${config.objectStorage.bucket})` : "tắt - avatar tải lên bị vô hiệu"
    }`,
  );
```

Không log endpoint, key hay secret — chỉ tên bucket, giống cách log voice chỉ nêu env.

- [ ] **Step 8: Lint**

Run: `npm run lint --workspace @masoi/server`
Expected: không lỗi.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/storage/s3.ts apps/server/src/storage/index.ts apps/server/src/index.ts apps/server/package.json package-lock.json apps/server/tests/storage-registry.test.ts
git commit -m "feat(storage): adapter S3-compatible và sổ đăng ký adapter"
```

---

### Task 4: Migration cột Player.avatarKey

**Files:**
- Modify: `apps/server/prisma/schema.prisma`
- Create: `apps/server/prisma/migrations/20260901000000_add_player_avatar_key/migration.sql`

**Interfaces:**
- Consumes: không có.
- Produces: trường `avatarKey: string | null` trên model Prisma `Player`, dùng bởi Task 6 và Task 8.

- [ ] **Step 1: Thêm cột vào schema**

Trong `apps/server/prisma/schema.prisma`, đổi model `Player` thành:

```prisma
model Player {
  id           String   @id @default(cuid())
  nickname     String
  tokenHash    String   @unique
  avatarUrl    String?  @db.Text
  /// Khoá của object avatar trong bucket. Nguồn sự thật DUY NHẤT cho việc xoá:
  /// server không bao giờ nhận khoá từ client, nên không ai xoá được object của
  /// người khác bằng một URL giả. avatarUrl chỉ để hiển thị.
  avatarKey    String?
  createdAt    DateTime @default(now())
  lastSeenAt   DateTime @default(now())
}
```

`avatarUrl` giữ nguyên `@db.Text` để còn đọc được data URL cũ trong giai đoạn chuyển tiếp.

- [ ] **Step 2: Viết migration bằng tay**

Tạo `apps/server/prisma/migrations/20260901000000_add_player_avatar_key/migration.sql`:

```sql
-- Cộng thêm cột, không phá gì: chạy được trên Neon TRƯỚC khi code mới lên
-- Render, và code cũ bỏ qua cột này mà không sao.
ALTER TABLE "Player" ADD COLUMN "avatarKey" TEXT;
```

Viết tay thay vì `prisma migrate dev` để không phụ thuộc vào việc có DB đang chạy. Nếu bạn có `npm run dev:infra` đang chạy thì `npx prisma migrate dev --name add_player_avatar_key --schema apps/server/prisma/schema.prisma` cho ra đúng file này.

- [ ] **Step 3: Kiểm schema và sinh lại client**

Run:
```bash
npx prisma validate --schema apps/server/prisma/schema.prisma
npm run db:generate --workspace @masoi/server
```
Expected: `The schema at ... is valid` rồi `Generated Prisma Client`.

- [ ] **Step 4: Kiểm migration khớp schema**

Run:
```bash
npx prisma migrate diff --from-migrations apps/server/prisma/migrations --to-schema-datamodel apps/server/prisma/schema.prisma --shadow-database-url "postgresql://masoi:masoi_dev_password@localhost:5433/masoi_shadow" --exit-code
```
Expected: exit code 0 và `No difference detected`.

Nếu chưa có Postgres chạy thì bỏ qua bước này và chạy `npm run dev:infra` trước; đây là bước kiểm tra, không phải bước tạo.

- [ ] **Step 5: Lint**

Run: `npm run lint --workspace @masoi/server`
Expected: không lỗi (client mới đã có `avatarKey`).

- [ ] **Step 6: Commit**

```bash
git add apps/server/prisma/schema.prisma apps/server/prisma/migrations
git commit -m "feat(db): thêm cột Player.avatarKey làm nguồn sự thật cho việc xoá object"
```

---

### Task 5: Kiểm magic bytes và xử lý ảnh

**Files:**
- Create: `apps/server/src/avatar/image.ts`
- Modify: `apps/server/package.json` (thêm `sharp`)
- Test: `apps/server/tests/avatar-image.test.ts`

**Interfaces:**
- Consumes: không có.
- Produces:
  ```ts
  export type ImageKind = "jpeg" | "png" | "webp";
  export const MAX_AVATAR_OUTPUT_BYTES: number;   // 204800
  export const AVATAR_SIZE: number;               // 256
  export function sniffImageType(buf: Buffer): ImageKind | null;
  export function processAvatar(
    buf: Buffer,
    opts?: { maxBytes?: number },
  ): Promise<{ data: Buffer; quality: number }>;
  ```

- [ ] **Step 1: Cài dependency**

```bash
npm install sharp --workspace @masoi/server
```

- [ ] **Step 2: Viết test đỏ**

Tạo `apps/server/tests/avatar-image.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  AVATAR_SIZE,
  MAX_AVATAR_OUTPUT_BYTES,
  processAvatar,
  sniffImageType,
} from "../src/avatar/image";

/** Nhiễu tất định (LCG) - không dùng Math.random để test không đỏ ngẫu nhiên. */
function noise(width: number, height: number): Buffer {
  const px = Buffer.alloc(width * height * 3);
  let seed = 12345;
  for (let i = 0; i < px.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    px[i] = seed & 0xff;
  }
  return px;
}

function noisy(width = 512, height = 512) {
  return sharp(noise(width, height), { raw: { width, height, channels: 3 } });
}

function flat(width = 800, height = 600, color = { r: 200, g: 60, b: 60 }) {
  return sharp({ create: { width, height, channels: 3, background: color } });
}

/** Ảnh dọc 200x400: nửa TRÊN đỏ, nửa DƯỚI xanh dương. */
async function halvesPortrait(): Promise<Buffer> {
  const px = Buffer.alloc(200 * 400 * 3);
  for (let y = 0; y < 400; y++) {
    for (let x = 0; x < 200; x++) {
      const i = (y * 200 + x) * 3;
      if (y < 200) {
        px[i] = 230;
      } else {
        px[i + 2] = 230;
      }
    }
  }
  return sharp(px, { raw: { width: 200, height: 400, channels: 3 } }).jpeg().toBuffer();
}

async function pixel(webp: Buffer, x: number, y: number) {
  const { data, info } = await sharp(webp).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2] };
}

describe("sniffImageType", () => {
  it("nhận JPEG thật", async () => {
    expect(sniffImageType(await flat().jpeg().toBuffer())).toBe("jpeg");
  });

  it("nhận PNG thật", async () => {
    expect(sniffImageType(await flat().png().toBuffer())).toBe("png");
  });

  it("nhận WebP thật", async () => {
    expect(sniffImageType(await flat().webp().toBuffer())).toBe("webp");
  });

  it("từ chối GIF - ảnh động ngoài phạm vi", async () => {
    expect(sniffImageType(await flat().gif().toBuffer())).toBeNull();
  });

  it("từ chối file giả mạo: đuôi .png, MIME image/png, ruột là ZIP", () => {
    // PK\x03\x04 - đây là thứ mà việc tin file.mimetype của client sẽ cho lọt.
    expect(sniffImageType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]))).toBeNull();
  });

  it("từ chối HTML giả dạng ảnh", () => {
    expect(sniffImageType(Buffer.from("<html><body>xin chao</body></html>"))).toBeNull();
  });

  it("từ chối buffer rỗng và buffer cụt", async () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    const png = await flat().png().toBuffer();
    expect(sniffImageType(png.subarray(0, 4))).toBeNull();
  });

  it("từ chối RIFF không phải WEBP (ví dụ WAV)", () => {
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]);
    expect(sniffImageType(wav)).toBeNull();
  });
});

describe("processAvatar", () => {
  it("ảnh chữ nhật ra WebP vuông 256x256", async () => {
    const { data } = await processAvatar(await flat(800, 600).jpeg().toBuffer());
    const meta = await sharp(data).metadata();

    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(AVATAR_SIZE);
    expect(meta.height).toBe(AVATAR_SIZE);
  });

  it("ảnh nhiễu 512x512 vẫn dưới trần 200 KB ở bậc chất lượng đầu tiên", async () => {
    const { data, quality } = await processAvatar(await noisy().jpeg().toBuffer());

    expect(quality).toBe(82);
    expect(data.length).toBeLessThanOrEqual(MAX_AVATAR_OUTPUT_BYTES);
  });

  it("tụt bậc chất lượng khi trần quá chặt, không bao giờ trả file vượt trần", async () => {
    const source = await noisy().jpeg().toBuffer();
    const first = await processAvatar(source);

    const tight = await processAvatar(source, { maxBytes: first.data.length - 1 });

    expect(tight.quality).toBeLessThan(first.quality);
    expect(tight.data.length).toBeLessThanOrEqual(first.data.length - 1);
  });

  it("hết bậc mà vẫn vượt trần thì TỪ CHỐI chứ không trả file quá lớn", async () => {
    await expect(
      processAvatar(await noisy().jpeg().toBuffer(), { maxBytes: 1 }),
    ).rejects.toThrow();
  });

  it("tự xoay theo EXIF trước khi crop", async () => {
    // Orientation 6 = xoay 90 độ theo chiều kim đồng hồ khi hiển thị. Ảnh dọc
    // đỏ-trên/xanh-dưới sẽ thành ảnh ngang xanh-trái/đỏ-phải. Không .rotate()
    // thì crop giữa vẫn cho đỏ-trên/xanh-dưới, và hai điểm lấy mẫu bên dưới sẽ
    // cùng màu - đó là cách test này bắt lỗi.
    const rotated = await sharp(await halvesPortrait())
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const { data } = await processAvatar(rotated);
    const left = await pixel(data, 64, 128);
    const right = await pixel(data, 192, 128);

    expect(left.b).toBeGreaterThan(left.r);
    expect(right.r).toBeGreaterThan(right.b);
  });

  it("từ chối ảnh hỏng", async () => {
    const png = await flat().png().toBuffer();
    const broken = Buffer.concat([png.subarray(0, 40), Buffer.from("rác rác rác")]);

    await expect(processAvatar(broken)).rejects.toThrow();
  });

  it("từ chối ảnh vượt trần điểm ảnh thay vì làm cạn RAM", async () => {
    // 9000x9000 = 81 triệu điểm ảnh, vượt trần 50 triệu.
    const huge = await sharp({
      create: { width: 9000, height: 9000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();

    await expect(processAvatar(huge)).rejects.toThrow();
  }, 60_000);
});
```

- [ ] **Step 3: Chạy test cho chắc là đỏ**

Run: `npm run test --workspace @masoi/server -- avatar-image`
Expected: FAIL — `Cannot find module '../src/avatar/image'`.

- [ ] **Step 4: Viết cài đặt tối thiểu**

Tạo `apps/server/src/avatar/image.ts`:

```ts
import sharp from "sharp";

export type ImageKind = "jpeg" | "png" | "webp";

export const AVATAR_SIZE = 256;
export const MAX_AVATAR_OUTPUT_BYTES = 200 * 1024;

/**
 * Trần điểm ảnh đầu vào. Một file PNG 2 KB có thể khai kích thước 30000x30000
 * và làm sharp cấp phát hàng GB - "bom nén". Trần 50 triệu điểm ảnh (khoảng
 * 7000x7000) rộng hơn mọi ảnh máy ảnh thật nhưng chặn được kiểu tấn công đó.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/** Bậc chất lượng WebP, thử từ cao xuống thấp cho tới khi lọt trần dung lượng. */
const QUALITY_LADDER = [82, 70, 58];

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

/**
 * Nhận dạng ảnh bằng magic bytes.
 *
 * Đây là nơi DUY NHẤT quyết định một file có phải ảnh hay không.
 * `file.mimetype` của multer là chuỗi do client tự khai trong phần header của
 * multipart - đổi nó thành "image/png" chỉ tốn một dòng curl, nên tin nó là
 * không tin gì cả.
 */
export function sniffImageType(buf: Buffer): ImageKind | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // WebP là container RIFF: "RIFF" ở offset 0, độ dài 4 byte, rồi "WEBP".
  // Chỉ kiểm "RIFF" là nhận nhầm cả WAV và AVI.
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "webp";
  }
  return null;
}

/**
 * Chuẩn hoá ảnh thành avatar: tự xoay theo EXIF, crop vuông giữa, thu về 256,
 * encode WebP dưới trần dung lượng.
 *
 * .rotate() phải gọi TRƯỚC .resize(): ảnh chụp dọc bằng điện thoại thường được
 * lưu ngang kèm cờ EXIF, nên crop trước khi xoay là crop nhầm vùng.
 *
 * Thang chất lượng gần như không bao giờ tụt - 256x256 ở q82 thường 15-25 KB.
 * Nhưng "gần như không bao giờ" không phải một đảm bảo, còn trần 200 KB thì là
 * một yêu cầu, nên hết thang là từ chối chứ không nới trần.
 */
export async function processAvatar(
  buf: Buffer,
  opts: { maxBytes?: number } = {},
): Promise<{ data: Buffer; quality: number }> {
  const maxBytes = opts.maxBytes ?? MAX_AVATAR_OUTPUT_BYTES;
  const square = sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" });

  for (const quality of QUALITY_LADDER) {
    const data = await square.clone().webp({ quality }).toBuffer();
    if (data.length <= maxBytes) return { data, quality };
  }

  throw new Error(
    `Không nén được ảnh xuống dưới ${Math.round(maxBytes / 1024)} KB, hãy thử ảnh khác`,
  );
}
```

- [ ] **Step 5: Chạy test cho chắc là xanh**

Run: `npm run test --workspace @masoi/server -- avatar-image`
Expected: PASS, 16 test.

- [ ] **Step 6: Lint**

Run: `npm run lint --workspace @masoi/server`
Expected: không lỗi.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/avatar/image.ts apps/server/tests/avatar-image.test.ts apps/server/package.json package-lock.json
git commit -m "feat(avatar): kiểm magic bytes và chuẩn hoá ảnh thành WebP 256x256"
```

---

### Task 6: Phát lại snapshot khi avatar đổi

**Files:**
- Create: `apps/server/src/rooms/apply-avatar.ts`
- Test: `apps/server/tests/avatar-apply.test.ts`

**Interfaces:**
- Consumes: `getRoom`, `persistRoom` từ `../rooms/store`; `broadcastRoom` từ `../rooms/broadcast`; `getRoomSyncByPlayer` từ `../rooms/index-helpers`.
- Produces: `export async function applyAvatarToRoom(playerId: string, avatarUrl: string | null): Promise<void>;`

Đặt ở file riêng chứ không nhét vào `rooms/service.ts` để tránh vòng import: Task 8 sẽ cho `rooms/service.ts` import từ `avatar/`, mà `avatar/service.ts` cần gọi ngược lại hàm này. `apply-avatar.ts` chỉ phụ thuộc `store` + `broadcast` + `index-helpers`, không phụ thuộc `service`, nên vòng không khép lại.

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/server/tests/avatar-apply.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  persist: vi.fn(async () => undefined),
  broadcast: vi.fn(),
}));

vi.mock("../src/redis", () => ({
  redis: { get: async () => null, set: async () => "OK", del: async () => 1 },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

vi.mock("../src/rooms/broadcast", () => ({ broadcastRoom: spies.broadcast }));

import { applyAvatarToRoom } from "../src/rooms/apply-avatar";
import { createRoom, getRoom, removeRoom, type RoomMember } from "../src/rooms/store";

function member(playerId: string): RoomMember {
  return {
    playerId,
    name: playerId,
    ready: false,
    connected: true,
    disconnectedAt: null,
    isBot: false,
    avatarUrl: null,
  };
}

afterEach(() => {
  removeRoom("AVATR");
  spies.broadcast.mockClear();
});

describe("applyAvatarToRoom", () => {
  it("cập nhật member rồi phát lại snapshot cho cả phòng", async () => {
    createRoom("AVATR", member("p1"));

    await applyAvatarToRoom("p1", "https://cdn.test/a.webp");

    expect(getRoom("AVATR")!.members[0].avatarUrl).toBe("https://cdn.test/a.webp");
    expect(spies.broadcast).toHaveBeenCalledWith("AVATR");
  });

  it("xoá avatar đặt member về null và vẫn phát lại", async () => {
    const host = member("p1");
    host.avatarUrl = "https://cdn.test/a.webp";
    createRoom("AVATR", host);

    await applyAvatarToRoom("p1", null);

    expect(getRoom("AVATR")!.members[0].avatarUrl).toBeNull();
    expect(spies.broadcast).toHaveBeenCalledWith("AVATR");
  });

  it("người chơi không ở phòng nào thì không làm gì, không ném lỗi", async () => {
    await expect(applyAvatarToRoom("ngoài-phòng", "https://cdn.test/a.webp")).resolves.toBeUndefined();
    expect(spies.broadcast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npm run test --workspace @masoi/server -- avatar-apply`
Expected: FAIL — `Cannot find module '../src/rooms/apply-avatar'`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

Tạo `apps/server/src/rooms/apply-avatar.ts`:

```ts
import { broadcastRoom } from "./broadcast";
import { getRoomSyncByPlayer } from "./index-helpers";
import { getRoom, persistRoom } from "./store";

/**
 * Đẩy avatar mới vào phòng người chơi đang ở, rồi phát lại snapshot.
 *
 * Nhận URL đã được tầng avatar duyệt, KHÔNG nhận dữ liệu ảnh - đó là điều giữ
 * cho snapshot chỉ mang chuỗi ngắn.
 *
 * Ở file riêng chứ không nằm trong service.ts để tránh vòng import: service.ts
 * cần gọi tầng avatar (di trú data URL cũ), còn tầng avatar cần gọi hàm này.
 */
export async function applyAvatarToRoom(playerId: string, avatarUrl: string | null): Promise<void> {
  const roomCode = getRoomSyncByPlayer(playerId);
  if (!roomCode) return;
  const room = getRoom(roomCode);
  if (!room) return;
  const member = room.members.find((m) => m.playerId === playerId);
  if (!member) return;

  member.avatarUrl = avatarUrl;
  await persistRoom(room);
  broadcastRoom(room.code);
}
```

- [ ] **Step 4: Chạy test cho chắc là xanh**

Run: `npm run test --workspace @masoi/server -- avatar-apply`
Expected: PASS, 3 test.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/rooms/apply-avatar.ts apps/server/tests/avatar-apply.test.ts
git commit -m "feat(rooms): tách việc phát lại snapshot khi avatar đổi ra file riêng"
```

---

### Task 7: Service avatar — lưu, đổi, xoá

**Files:**
- Create: `apps/server/src/avatar/errors.ts`
- Create: `apps/server/src/avatar/service.ts`
- Test: `apps/server/tests/avatar-service.test.ts`

**Interfaces:**
- Consumes: `sniffImageType`, `processAvatar` (Task 5); `objectStorage` (Task 3); `applyAvatarToRoom` (Task 6); `prisma.player.findUnique` / `prisma.player.updateMany` với cột `avatarKey` (Task 4).
- Produces:
  ```ts
  // errors.ts
  export class AvatarError extends Error { readonly status: number; constructor(message: string, status: number); }
  // service.ts
  export const MAX_AVATAR_UPLOAD_BYTES: number;   // 5242880
  export function avatarObjectKey(playerId: string): string;
  export function storeAvatar(playerId: string, file: Buffer): Promise<string>;
  export function setAvatar(playerId: string, file: Buffer): Promise<{ avatarUrl: string }>;
  export function clearAvatar(playerId: string): Promise<void>;
  ```

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/server/tests/avatar-service.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

interface Row {
  id: string;
  avatarUrl: string | null;
  avatarKey: string | null;
}

const db = vi.hoisted(() => ({
  players: new Map<string, { id: string; avatarUrl: string | null; avatarKey: string | null }>(),
  failUpdate: false,
}));

vi.mock("../src/db", () => ({
  prisma: {
    player: {
      findUnique: async ({ where }: { where: { id: string } }) => db.players.get(where.id) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; avatarKey?: string | null };
        data: { avatarUrl: string | null; avatarKey: string | null };
      }) => {
        if (db.failUpdate) throw new Error("DB sập");
        const row = db.players.get(where.id);
        if (!row) return { count: 0 };
        if (where.avatarKey !== undefined && row.avatarKey !== where.avatarKey) {
          return { count: 0 };
        }
        row.avatarUrl = data.avatarUrl;
        row.avatarKey = data.avatarKey;
        return { count: 1 };
      },
    },
  },
}));

const applied = vi.hoisted(() => ({ fn: vi.fn(async () => undefined) }));
vi.mock("../src/rooms/apply-avatar", () => ({ applyAvatarToRoom: applied.fn }));

import { AvatarError } from "../src/avatar/errors";
import { avatarObjectKey, clearAvatar, setAvatar } from "../src/avatar/service";
import { createMemoryStorage, type MemoryObjectStorage } from "../src/storage/memory";
import { resetObjectStorage, setObjectStorage } from "../src/storage";

let storage: MemoryObjectStorage;

async function jpeg(color = { r: 200, g: 60, b: 60 }): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

function row(id: string): Row {
  return db.players.get(id)!;
}

beforeEach(() => {
  db.players.clear();
  db.failUpdate = false;
  db.players.set("p1", { id: "p1", avatarUrl: null, avatarKey: null });
  db.players.set("p2", { id: "p2", avatarUrl: null, avatarKey: null });
  storage = createMemoryStorage("https://cdn.test/masoi");
  setObjectStorage(storage);
  applied.fn.mockClear();
});

afterEach(() => {
  resetObjectStorage();
});

describe("avatarObjectKey", () => {
  it("không đoán được và không dùng tên file người dùng", () => {
    const a = avatarObjectKey("p1");
    const b = avatarObjectKey("p1");

    expect(a).toMatch(/^avatars\/p1\/[0-9a-f]{32}\.webp$/);
    expect(a).not.toBe(b);
  });
});

describe("setAvatar", () => {
  it("upload thành công thì DB lưu URL object và khoá object, không lưu base64", async () => {
    const { avatarUrl } = await setAvatar("p1", await jpeg());

    expect(avatarUrl).toMatch(/^https:\/\/cdn\.test\/masoi\/avatars\/p1\/[0-9a-f]{32}\.webp$/);
    expect(row("p1").avatarUrl).toBe(avatarUrl);
    expect(row("p1").avatarKey).toMatch(/^avatars\/p1\//);
    expect(row("p1").avatarUrl!.startsWith("data:")).toBe(false);
    expect(storage.objects.size).toBe(1);
  });

  it("object lưu ra là WebP 256x256", async () => {
    await setAvatar("p1", await jpeg());
    const stored = [...storage.objects.values()][0];
    const meta = await sharp(stored.body).metadata();

    expect(stored.contentType).toBe("image/webp");
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it("phát lại snapshot cho cả phòng sau khi upload", async () => {
    const { avatarUrl } = await setAvatar("p1", await jpeg());
    expect(applied.fn).toHaveBeenCalledWith("p1", avatarUrl);
  });

  it("đổi ảnh thì dọn object cũ và chỉ còn đúng một object", async () => {
    await setAvatar("p1", await jpeg({ r: 200, g: 60, b: 60 }));
    const firstKey = row("p1").avatarKey;

    await setAvatar("p1", await jpeg({ r: 60, g: 60, b: 200 }));

    expect(storage.objects.has(firstKey!)).toBe(false);
    expect(storage.objects.size).toBe(1);
    expect(storage.objects.has(row("p1").avatarKey!)).toBe(true);
  });

  it("file giả mạo MIME bị từ chối với mã 400", async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

    await expect(setAvatar("p1", zip)).rejects.toMatchObject({ status: 400 });
    expect(row("p1").avatarUrl).toBeNull();
    expect(storage.objects.size).toBe(0);
  });

  it("ảnh hỏng bị từ chối với mã 400 và không để lại object", async () => {
    const png = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    const broken = Buffer.concat([png.subarray(0, 40), Buffer.from("rác")]);

    await expect(setAvatar("p1", broken)).rejects.toMatchObject({ status: 400 });
    expect(storage.objects.size).toBe(0);
  });

  it("storage lỗi thì DB không đổi - avatar cũ còn nguyên", async () => {
    await setAvatar("p1", await jpeg());
    const before = { ...row("p1") };

    storage.failNextPut();
    await expect(setAvatar("p1", await jpeg())).rejects.toMatchObject({ status: 503 });

    expect(row("p1")).toEqual(before);
    expect(storage.objects.has(before.avatarKey!)).toBe(true);
  });

  it("DB lỗi thì object vừa upload bị dọn và avatar cũ còn nguyên", async () => {
    await setAvatar("p1", await jpeg());
    const before = { ...row("p1") };

    db.failUpdate = true;
    await expect(setAvatar("p1", await jpeg())).rejects.toThrow();
    db.failUpdate = false;

    expect(row("p1")).toEqual(before);
    expect(storage.objects.size).toBe(1);
    expect(storage.objects.has(before.avatarKey!)).toBe(true);
  });

  it("hai upload đồng thời để lại đúng một object, không có object mồ côi", async () => {
    await Promise.all([
      setAvatar("p1", await jpeg({ r: 200, g: 60, b: 60 })),
      setAvatar("p1", await jpeg({ r: 60, g: 200, b: 60 })),
    ]);

    expect(storage.objects.size).toBe(1);
    expect(storage.objects.has(row("p1").avatarKey!)).toBe(true);
    expect(row("p1").avatarUrl).toBe(storage.publicUrl(row("p1").avatarKey!));
  });

  it("storage chưa cấu hình thì báo 503 chứ không sập", async () => {
    resetObjectStorage();

    await expect(setAvatar("p1", await jpeg())).rejects.toMatchObject({ status: 503 });
    expect(row("p1").avatarUrl).toBeNull();
  });
});

describe("clearAvatar", () => {
  it("xoá object của chính mình và đặt DB về null", async () => {
    await setAvatar("p1", await jpeg());

    await clearAvatar("p1");

    expect(row("p1").avatarUrl).toBeNull();
    expect(row("p1").avatarKey).toBeNull();
    expect(storage.objects.size).toBe(0);
    expect(applied.fn).toHaveBeenCalledWith("p1", null);
  });

  it("KHÔNG bao giờ đụng tới object của người khác", async () => {
    await setAvatar("p1", await jpeg());
    await setAvatar("p2", await jpeg());
    const otherKey = row("p2").avatarKey!;

    await clearAvatar("p1");

    expect(storage.objects.has(otherKey)).toBe(true);
    expect(row("p2").avatarUrl).not.toBeNull();
  });

  it("storage chưa cấu hình vẫn xoá được - DB sạch là đủ để coi là thành công", async () => {
    db.players.set("p1", { id: "p1", avatarUrl: "data:image/webp;base64,AAA", avatarKey: null });
    resetObjectStorage();

    await expect(clearAvatar("p1")).resolves.toBeUndefined();
    expect(row("p1").avatarUrl).toBeNull();
  });

  it("xoá data URL cũ (không có avatarKey) chạy được", async () => {
    db.players.set("p1", { id: "p1", avatarUrl: "data:image/webp;base64,AAA", avatarKey: null });

    await clearAvatar("p1");

    expect(row("p1").avatarUrl).toBeNull();
  });
});

describe("AvatarError", () => {
  it("mang mã HTTP để route khỏi phải đoán", () => {
    const err = new AvatarError("Ảnh quá lớn", 413);
    expect(err.status).toBe(413);
    expect(err.message).toBe("Ảnh quá lớn");
  });
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npm run test --workspace @masoi/server -- avatar-service`
Expected: FAIL — `Cannot find module '../src/avatar/errors'`.

- [ ] **Step 3: Viết lớp lỗi**

Tạo `apps/server/src/avatar/errors.ts`:

```ts
/**
 * Lỗi tầng avatar, mang sẵn mã HTTP.
 *
 * Route không được phép đoán mã từ nội dung thông điệp: cùng một câu tiếng Việt
 * có thể là 400 (ảnh sai) hay 503 (storage sập) tuỳ chỗ ném, và đoán sai thì
 * client retry nhầm hoặc bỏ cuộc nhầm.
 */
export class AvatarError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AvatarError";
    this.status = status;
  }
}
```

- [ ] **Step 4: Viết service**

Tạo `apps/server/src/avatar/service.ts`:

```ts
import crypto from "crypto";
import { prisma } from "../db";
import { applyAvatarToRoom } from "../rooms/apply-avatar";
import { objectStorage } from "../storage";
import type { StoredObject } from "../storage/types";
import { AvatarError } from "./errors";
import { processAvatar, sniffImageType } from "./image";

export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Số lượt thử compare-and-swap trước khi bỏ cuộc. */
const SWAP_ATTEMPTS = 3;

/**
 * Khoá object: ngẫu nhiên 16 byte, không lấy gì từ tên file người dùng gửi lên.
 *
 * playerId nằm trong đường dẫn chỉ để soi bucket cho dễ. Nó KHÔNG tham gia phân
 * quyền - phân quyền hoàn toàn đến từ cột avatarKey trong DB, nên kể cả khi ai
 * đó đoán đúng đường dẫn của người khác cũng không có API nào nhận vào.
 */
export function avatarObjectKey(playerId: string): string {
  return `avatars/${playerId}/${crypto.randomBytes(16).toString("hex")}.webp`;
}

/**
 * Đổi avatar trong DB bằng compare-and-swap, rồi dọn object cũ.
 *
 * CAS chứ không phải đọc-rồi-ghi: hai upload đồng thời của cùng một người sẽ
 * cùng đọc avatarKey cũ là A, cùng xoá A, và để lại MỘT OBJECT MỒ CÔI vĩnh viễn
 * trong bucket. Với CAS, kẻ thua thấy count === 0, đọc lại khoá hiện tại rồi
 * thử lại, và object thua cuộc do chính nó dọn.
 *
 * KHÔNG dùng withPlayerRoomLock: đó là khoá trong tiến trình nên nó sai ngay
 * khi Render chạy nhiều instance, và nó sẽ nối hàng thao tác avatar phía sau
 * thao tác vào/ra phòng.
 *
 * Xoá object cũ luôn bọc catch: object mồ côi là rác đáng tiếc, còn ném lỗi ở
 * bước này là báo thất bại cho một thao tác đã thành công.
 */
async function swapAvatar(playerId: string, next: StoredObject | null): Promise<void> {
  for (let attempt = 0; attempt < SWAP_ATTEMPTS; attempt++) {
    const current = await prisma.player.findUnique({
      where: { id: playerId },
      select: { avatarKey: true },
    });
    if (!current) throw new AvatarError("Phiên đăng nhập không hợp lệ", 401);

    const { count } = await prisma.player.updateMany({
      where: { id: playerId, avatarKey: current.avatarKey },
      data: { avatarUrl: next?.url ?? null, avatarKey: next?.key ?? null },
    });

    if (count === 1) {
      if (current.avatarKey && current.avatarKey !== next?.key) {
        await objectStorage()
          .delete(current.avatarKey)
          .catch((err) => console.error("[avatar] Không dọn được object cũ:", err));
      }
      return;
    }
  }

  throw new AvatarError("Ảnh đại diện vừa được đổi ở nơi khác, thử lại giúp nhé", 409);
}

/**
 * Kiểm, xử lý, upload và ghi DB. KHÔNG phát lại snapshot - phần đó nằm ở
 * setAvatar, để việc di trú data URL cũ (chạy ngay trước khi dựng RoomMember)
 * dùng lại được hàm này mà không phát một snapshot thừa.
 */
export async function storeAvatar(playerId: string, file: Buffer): Promise<string> {
  const storage = objectStorage();
  if (!storage.configured) {
    throw new AvatarError("Máy chủ chưa bật tính năng ảnh đại diện", 503);
  }

  if (file.length > MAX_AVATAR_UPLOAD_BYTES) {
    throw new AvatarError("Ảnh quá lớn, tối đa 5MB", 413);
  }
  if (!sniffImageType(file)) {
    throw new AvatarError("Chỉ chấp nhận ảnh JPG, PNG hoặc WebP", 400);
  }

  let processed: { data: Buffer };
  try {
    processed = await processAvatar(file);
  } catch (err) {
    // Không rò chi tiết của sharp ra client: nó không giúp người chơi làm gì và
    // lại kể về thư viện đang chạy trên server.
    console.error("[avatar] Xử lý ảnh thất bại:", err);
    throw new AvatarError("Không đọc được ảnh này, hãy thử ảnh khác", 400);
  }

  let stored: StoredObject;
  try {
    stored = await storage.put(avatarObjectKey(playerId), processed.data, "image/webp");
  } catch (err) {
    console.error("[avatar] Upload lên object storage thất bại:", err);
    throw new AvatarError("Không lưu được ảnh lúc này, thử lại sau ít phút", 503);
  }

  try {
    await swapAvatar(playerId, stored);
  } catch (err) {
    // Ghi DB hỏng thì object vừa lên là rác - dọn ngay. Thứ tự upload-trước,
    // ghi-DB-sau chính là thứ giữ cho avatar CŨ còn nguyên ở nhánh này.
    await storage
      .delete(stored.key)
      .catch((cleanupErr) => console.error("[avatar] Không dọn được object mới:", cleanupErr));
    throw err;
  }

  return stored.url;
}

export async function setAvatar(playerId: string, file: Buffer): Promise<{ avatarUrl: string }> {
  const avatarUrl = await storeAvatar(playerId, file);
  await applyAvatarToRoom(playerId, avatarUrl);
  return { avatarUrl };
}

/**
 * Xoá avatar. Chạy được cả khi storage chưa cấu hình: dọn object là việc
 * tốt-nếu-có, còn "avatar đã bị gỡ" là chuyện của DB. Ở môi trường dev chưa cấu
 * hình storage, người chơi vẫn phải gỡ được ảnh của mình.
 */
export async function clearAvatar(playerId: string): Promise<void> {
  await swapAvatar(playerId, null);
  await applyAvatarToRoom(playerId, null);
}
```

- [ ] **Step 5: Chạy test cho chắc là xanh**

Run: `npm run test --workspace @masoi/server -- avatar-service`
Expected: PASS, 16 test.

- [ ] **Step 6: Lint**

Run: `npm run lint --workspace @masoi/server`
Expected: không lỗi.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/avatar/errors.ts apps/server/src/avatar/service.ts apps/server/tests/avatar-service.test.ts
git commit -m "feat(avatar): service lưu/đổi/xoá avatar với compare-and-swap trên avatarKey"
```

---

### Task 8: Chặn data URL mới qua socket và chặn base64 lọt vào snapshot

**Files:**
- Modify: `packages/shared/src/schemas.ts:138`
- Modify: `apps/server/src/ws.ts:165-169`
- Modify: `apps/server/src/rooms/service.ts:235-257` (xoá `updateAvatar`)
- Modify: `apps/server/src/rooms/snapshot.ts:182,197,211`
- Create: `packages/shared/tests/avatar-payload.test.ts`
- Test: `apps/server/tests/avatar-snapshot.test.ts`

**Interfaces:**
- Consumes: `clearAvatar` (Task 7); `objectStorage` (Task 3).
- Produces: `updateAvatarPayload` chỉ nhận `{ avatarUrl: null }`; helper nội bộ `safeAvatarUrl` trong `snapshot.ts`.

- [ ] **Step 1: Viết test đỏ cho schema**

Tạo `packages/shared/tests/avatar-payload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { updateAvatarPayload } from "../src/schemas";

describe("updateAvatarPayload", () => {
  it("chấp nhận null - client cũ vẫn bấm Xóa được", () => {
    expect(updateAvatarPayload.parse({ avatarUrl: null })).toEqual({ avatarUrl: null });
  });

  it("từ chối data URL - không còn đường tạo dữ liệu base64 mới", () => {
    expect(() => updateAvatarPayload.parse({ avatarUrl: "data:image/webp;base64,AAAA" })).toThrow();
  });

  it("từ chối cả URL https - ảnh chỉ đi qua endpoint upload, không qua socket", () => {
    expect(() => updateAvatarPayload.parse({ avatarUrl: "https://cdn.test/a.webp" })).toThrow();
  });
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npm run test --workspace @masoi/shared -- avatar-payload`
Expected: FAIL — cả ba trường hợp chuỗi đều được nhận.

- [ ] **Step 3: Siết schema**

Trong `packages/shared/src/schemas.ts`, thay dòng 138:

```ts
export const updateAvatarPayload = z.object({ avatarUrl: z.string().nullable() }).strict();
```

bằng:

```ts
/**
 * Chỉ còn nhận null, tức là "xoá ảnh". Ảnh đi lên qua PUT /api/players/me/avatar.
 *
 * Không xoá hẳn sự kiện vì Vercel còn phục vụ bản client đã cache: client cũ
 * bấm "Xóa" vẫn phải chạy được, còn client cũ bấm "Lưu" thì phải nhận lỗi rõ
 * ràng thay vì im lặng hỏng.
 */
export const updateAvatarPayload = z.object({ avatarUrl: z.null() }).strict();
```

- [ ] **Step 4: Chạy test cho chắc là xanh**

Run: `npm run test --workspace @masoi/shared -- avatar-payload`
Expected: PASS, 3 test.

- [ ] **Step 5: Viết test đỏ cho snapshot**

Tạo `apps/server/tests/avatar-snapshot.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/redis", () => ({
  redis: { get: async () => null, set: async () => "OK", del: async () => 1 },
  getPlayerRoom: async () => null,
  updateSessionRoom: async () => undefined,
}));

import { buildSnapshot } from "../src/rooms/snapshot";
import { createRoom, removeRoom, type RoomMember } from "../src/rooms/store";
import { createMemoryStorage } from "../src/storage/memory";
import { resetObjectStorage, setObjectStorage } from "../src/storage";

const DATA_URL = "data:image/webp;base64,UklGRhwAAABXRUJQ";

function member(playerId: string, avatarUrl: string | null): RoomMember {
  return {
    playerId,
    name: playerId,
    ready: false,
    connected: true,
    disconnectedAt: null,
    isBot: false,
    avatarUrl,
  };
}

beforeEach(() => {
  resetObjectStorage();
});

afterEach(() => {
  removeRoom("SNAPS");
  resetObjectStorage();
});

describe("Snapshot không mang base64 khi storage đã bật", () => {
  it("data URL bị lọc khỏi cả you lẫn players", () => {
    setObjectStorage(createMemoryStorage());
    const room = createRoom("SNAPS", member("p1", DATA_URL));
    room.members.push(member("p2", DATA_URL));

    const snapshot = buildSnapshot(room, "p1");

    expect(snapshot.you?.avatarUrl ?? null).toBeNull();
    expect(snapshot.players.map((p) => p.avatarUrl ?? null)).toEqual([null, null]);
  });

  it("URL https đi qua nguyên vẹn", () => {
    setObjectStorage(createMemoryStorage());
    const room = createRoom("SNAPS", member("p1", "https://cdn.test/masoi/a.webp"));

    const snapshot = buildSnapshot(room, "p1");

    expect(snapshot.you?.avatarUrl).toBe("https://cdn.test/masoi/a.webp");
  });

  it("storage CHƯA cấu hình thì data URL cũ vẫn hiện - dev không mất avatar", () => {
    const room = createRoom("SNAPS", member("p1", DATA_URL));

    const snapshot = buildSnapshot(room, "p1");

    expect(snapshot.you?.avatarUrl).toBe(DATA_URL);
  });
});
```

- [ ] **Step 6: Chạy test cho chắc là đỏ**

Run: `npm run test --workspace @masoi/server -- avatar-snapshot`
Expected: FAIL ở test đầu — data URL vẫn lọt vào snapshot.

- [ ] **Step 7: Thêm lưới an toàn vào snapshot**

Trong `apps/server/src/rooms/snapshot.ts`, thêm import ở đầu file:

```ts
import { objectStorage } from "../storage";
```

và thêm hàm helper ngay dưới phần import:

```ts
/**
 * Lưới an toàn cuối cùng cho việc "snapshot chỉ chứa URL ngắn".
 *
 * Data URL cũ vẫn còn trong DB của những người đã đặt avatar trước khi có object
 * storage. Khi storage đã bật, việc di trú đã chạy ở lúc vào phòng - nên bất kỳ
 * data URL nào còn sót lại tới đây đều là dấu hiệu di trú hỏng, và đẩy vài MB
 * base64 cho 12 người là cái giá quá đắt để hiển thị một cái ảnh. Hiện avatar
 * mặc định thay vì làm nghẽn cả phòng.
 *
 * Khi storage CHƯA bật (dev), để nguyên: ở đó chưa có đường nào tạo URL object,
 * nên lọc đi chỉ tổ làm mất avatar mà không đổi lại được gì.
 */
function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (value.startsWith("data:")) return objectStorage().configured ? null : value;
  return value;
}
```

Rồi thay cả ba chỗ đọc avatar (dòng 182, 197 và 211 của bản gốc):

```ts
          avatarUrl: (member as any)?.avatarUrl ?? null,
```
→
```ts
          avatarUrl: safeAvatarUrl((member as any)?.avatarUrl),
```

```ts
            avatarUrl: (member as any)?.avatarUrl ?? null,
```
→
```ts
            avatarUrl: safeAvatarUrl((member as any)?.avatarUrl),
```

```ts
        avatarUrl: (m as any)?.avatarUrl ?? null,
```
→
```ts
        avatarUrl: safeAvatarUrl((m as any)?.avatarUrl),
```

- [ ] **Step 8: Chạy test cho chắc là xanh**

Run: `npm run test --workspace @masoi/server -- avatar-snapshot`
Expected: PASS, 3 test.

- [ ] **Step 9: Nối socket vào clearAvatar và xoá updateAvatar cũ**

Trong `apps/server/src/rooms/service.ts`, xoá toàn bộ method `updateAvatar` (từ `async updateAvatar(playerId: string, avatarUrl: string | null): Promise<void> {` tới dấu `},` đóng của nó, bản gốc dòng 235-257). Đây là chỗ duy nhất còn nhận data URL.

Trong `apps/server/src/ws.ts`, thêm import:

```ts
import { clearAvatar } from "./avatar/service";
```

và thay handler (bản gốc dòng 165-169):

```ts
    handler(CLIENT_EVENTS.ROOM_UPDATE_AVATAR, async (payload) => {
      const { avatarUrl } = updateAvatarPayload.parse(payload);
      if (!allowAction(`avatar:${playerId}`, 5, 10_000)) throw new RoomError("Thao tác quá nhanh");
      await roomService.updateAvatar(playerId, avatarUrl);
    });
```

bằng:

```ts
    /*
     * Chỉ còn đường XOÁ. Ảnh đi lên qua PUT /api/players/me/avatar, nơi có
     * kiểm magic bytes và xử lý ảnh - gửi vài MB base64 qua socket thì snapshot
     * của cả phòng phình theo, đó chính là lỗi mà endpoint kia sinh ra để sửa.
     * Giữ sự kiện lại vì client cũ đã cache trên Vercel vẫn phải bấm Xóa được.
     */
    handler(CLIENT_EVENTS.ROOM_UPDATE_AVATAR, async (payload) => {
      updateAvatarPayload.parse(payload);
      if (!allowAction(`avatar:${playerId}`, 5, 10_000)) throw new RoomError("Thao tác quá nhanh");
      await clearAvatar(playerId);
    });
```

- [ ] **Step 10: Chạy toàn bộ test server + shared và lint**

Run:
```bash
npm run test --workspace @masoi/shared
npm run test --workspace @masoi/server
npm run lint --workspace @masoi/shared
npm run lint --workspace @masoi/server
```
Expected: tất cả xanh. Nếu có test cũ đỏ vì `roomService.updateAvatar` không còn, sửa test đó sang `clearAvatar`.

- [ ] **Step 11: Commit**

```bash
git add packages/shared/src/schemas.ts packages/shared/tests/avatar-payload.test.ts apps/server/src/ws.ts apps/server/src/rooms/service.ts apps/server/src/rooms/snapshot.ts apps/server/tests/avatar-snapshot.test.ts
git commit -m "feat(avatar): chặn data URL mới qua socket và chặn base64 lọt vào snapshot"
```

---

### Task 9: Di trú data URL cũ khi vào phòng

**Files:**
- Create: `apps/server/src/avatar/legacy.ts`
- Modify: `apps/server/src/rooms/service.ts` (`create` và `join`)
- Test: `apps/server/tests/avatar-legacy.test.ts`

**Interfaces:**
- Consumes: `storeAvatar` (Task 7); `objectStorage` (Task 3).
- Produces:
  ```ts
  export interface PlayerAvatarRecord { id: string; avatarUrl: string | null }
  export function resolveMemberAvatar(player: PlayerAvatarRecord | null): Promise<string | null>;
  ```

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/server/tests/avatar-legacy.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const db = vi.hoisted(() => ({
  players: new Map<string, { id: string; avatarUrl: string | null; avatarKey: string | null }>(),
}));

vi.mock("../src/db", () => ({
  prisma: {
    player: {
      findUnique: async ({ where }: { where: { id: string } }) => db.players.get(where.id) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; avatarKey?: string | null };
        data: { avatarUrl: string | null; avatarKey: string | null };
      }) => {
        const row = db.players.get(where.id);
        if (!row) return { count: 0 };
        if (where.avatarKey !== undefined && row.avatarKey !== where.avatarKey) return { count: 0 };
        row.avatarUrl = data.avatarUrl;
        row.avatarKey = data.avatarKey;
        return { count: 1 };
      },
    },
  },
}));

vi.mock("../src/rooms/apply-avatar", () => ({ applyAvatarToRoom: async () => undefined }));

import { resolveMemberAvatar } from "../src/avatar/legacy";
import { createMemoryStorage, type MemoryObjectStorage } from "../src/storage/memory";
import { resetObjectStorage, setObjectStorage } from "../src/storage";

let storage: MemoryObjectStorage;

async function dataUrl(): Promise<string> {
  const png = await sharp({
    create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeEach(() => {
  db.players.clear();
  storage = createMemoryStorage("https://cdn.test/masoi");
  setObjectStorage(storage);
});

afterEach(() => {
  resetObjectStorage();
});

describe("resolveMemberAvatar", () => {
  it("không có bản ghi thì trả null", async () => {
    expect(await resolveMemberAvatar(null)).toBeNull();
  });

  it("URL https đi qua nguyên, không upload lại", async () => {
    const record = { id: "p1", avatarUrl: "https://cdn.test/masoi/a.webp" };

    expect(await resolveMemberAvatar(record)).toBe("https://cdn.test/masoi/a.webp");
    expect(storage.objects.size).toBe(0);
  });

  it("data URL cũ được di trú thành URL object và ghi lại vào DB", async () => {
    const legacy = await dataUrl();
    db.players.set("p1", { id: "p1", avatarUrl: legacy, avatarKey: null });

    const url = await resolveMemberAvatar({ id: "p1", avatarUrl: legacy });

    expect(url).toMatch(/^https:\/\/cdn\.test\/masoi\/avatars\/p1\/[0-9a-f]{32}\.webp$/);
    expect(db.players.get("p1")!.avatarUrl).toBe(url);
    expect(db.players.get("p1")!.avatarKey).toMatch(/^avatars\/p1\//);
    expect(storage.objects.size).toBe(1);
  });

  it("di trú xong thì lần sau không upload thêm lần nữa", async () => {
    const legacy = await dataUrl();
    db.players.set("p1", { id: "p1", avatarUrl: legacy, avatarKey: null });

    const first = await resolveMemberAvatar({ id: "p1", avatarUrl: legacy });
    const second = await resolveMemberAvatar({ id: "p1", avatarUrl: first });

    expect(second).toBe(first);
    expect(storage.objects.size).toBe(1);
  });

  it("storage CHƯA cấu hình thì data URL đi qua nguyên - dev vẫn chạy đủ", async () => {
    resetObjectStorage();
    const legacy = await dataUrl();

    expect(await resolveMemberAvatar({ id: "p1", avatarUrl: legacy })).toBe(legacy);
  });

  it("di trú hỏng thì trả null và KHÔNG chặn người chơi vào phòng", async () => {
    db.players.set("p1", { id: "p1", avatarUrl: "x", avatarKey: null });
    storage.failNextPut();
    const legacy = await dataUrl();

    await expect(resolveMemberAvatar({ id: "p1", avatarUrl: legacy })).resolves.toBeNull();
  });

  it("data URL rác (không giải mã được thành ảnh) trả null chứ không ném", async () => {
    db.players.set("p1", { id: "p1", avatarUrl: "x", avatarKey: null });

    await expect(
      resolveMemberAvatar({ id: "p1", avatarUrl: "data:image/png;base64,khôngphảiảnh" }),
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npm run test --workspace @masoi/server -- avatar-legacy`
Expected: FAIL — `Cannot find module '../src/avatar/legacy'`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

Tạo `apps/server/src/avatar/legacy.ts`:

```ts
import { objectStorage } from "../storage";
import { storeAvatar } from "./service";

export interface PlayerAvatarRecord {
  id: string;
  avatarUrl: string | null;
}

/** Tách phần base64 khỏi "data:image/png;base64,xxxx". */
function decodeDataUrl(value: string): Buffer | null {
  const comma = value.indexOf(",");
  if (comma < 0) return null;
  if (!value.slice(0, comma).includes(";base64")) return null;
  const buf = Buffer.from(value.slice(comma + 1), "base64");
  return buf.length > 0 ? buf : null;
}

/**
 * Giá trị avatar để gán cho RoomMember, kèm di trú ngầm cho dữ liệu cũ.
 *
 * Đây là chỗ đúng để di trú vì nó nằm trên đường mọi người chơi đều đi qua khi
 * vào phòng, và vì member được dựng NGAY SAU đó - nên snapshot đầu tiên đã sạch
 * base64 chứ không phải chờ tới lần đổi ảnh kế tiếp.
 *
 * Storage chưa cấu hình thì trả nguyên data URL: ở dev chưa có đường nào tạo
 * URL object, lọc đi chỉ tổ làm mất avatar.
 *
 * Di trú hỏng thì trả null và KHÔNG ném: một cái ảnh không upload lại được
 * không đáng để chặn người ta vào phòng. Lần vào phòng sau sẽ thử lại.
 */
export async function resolveMemberAvatar(player: PlayerAvatarRecord | null): Promise<string | null> {
  const url = player?.avatarUrl ?? null;
  if (!url || !player) return null;
  if (!url.startsWith("data:")) return url;
  if (!objectStorage().configured) return url;

  const decoded = decodeDataUrl(url);
  if (!decoded) {
    console.error(`[avatar] Data URL cũ của ${player.id} không giải mã được, bỏ qua`);
    return null;
  }

  try {
    return await storeAvatar(player.id, decoded);
  } catch (err) {
    console.error(`[avatar] Di trú avatar cũ của ${player.id} thất bại:`, err);
    return null;
  }
}
```

- [ ] **Step 4: Chạy test cho chắc là xanh**

Run: `npm run test --workspace @masoi/server -- avatar-legacy`
Expected: PASS, 7 test.

- [ ] **Step 5: Nối vào create và join**

Trong `apps/server/src/rooms/service.ts`, thêm import:

```ts
import { resolveMemberAvatar } from "../avatar/legacy";
```

Trong `create`, thay:

```ts
      const playerRecord = await prisma.player.findUnique({ where: { id: playerId } });
      const member: RoomMember = {
        playerId,
        name,
        ready: false,
        connected: true,
        disconnectedAt: null,
        isBot: false,
        avatarUrl: (playerRecord as any)?.avatarUrl ?? null,
      };
```

bằng:

```ts
      const playerRecord = await prisma.player.findUnique({ where: { id: playerId } });
      const member: RoomMember = {
        playerId,
        name,
        ready: false,
        connected: true,
        disconnectedAt: null,
        isBot: false,
        avatarUrl: await resolveMemberAvatar(playerRecord),
      };
```

Trong `join`, thay:

```ts
      const player = await prisma.player.findUnique({ where: { id: playerId } });
      if (existing) {
        existing.connected = true;
        existing.disconnectedAt = null;
        existing.name = name;
        (existing as any).avatarUrl = (player as any)?.avatarUrl ?? (existing as any).avatarUrl ?? null;
      } else {
```

bằng:

```ts
      const player = await prisma.player.findUnique({ where: { id: playerId } });
      const avatarUrl = await resolveMemberAvatar(player);
      if (existing) {
        existing.connected = true;
        existing.disconnectedAt = null;
        existing.name = name;
        existing.avatarUrl = avatarUrl ?? existing.avatarUrl ?? null;
      } else {
```

và trong nhánh `else`, thay:

```ts
          avatarUrl: (player as any)?.avatarUrl ?? null,
```

bằng:

```ts
          avatarUrl,
```

- [ ] **Step 6: Chạy toàn bộ test server và lint**

Run:
```bash
npm run test --workspace @masoi/server
npm run lint --workspace @masoi/server
```
Expected: tất cả xanh.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/avatar/legacy.ts apps/server/src/rooms/service.ts apps/server/tests/avatar-legacy.test.ts
git commit -m "feat(avatar): di trú ngầm data URL cũ lên object storage khi vào phòng"
```

---

### Task 10: Endpoint HTTP upload và xoá avatar

**Files:**
- Create: `apps/server/src/auth.ts`
- Create: `apps/server/src/avatar/routes.ts`
- Modify: `apps/server/src/http.ts` (dùng `requirePlayer`, gắn `avatarRouter`)
- Modify: `apps/server/package.json` (`multer`, `@types/multer`, `supertest`, `@types/supertest`)
- Test: `apps/server/tests/avatar-routes.test.ts`

**Interfaces:**
- Consumes: `setAvatar`, `clearAvatar`, `MAX_AVATAR_UPLOAD_BYTES` (Task 7); `AvatarError` (Task 7); `allowAction` từ `../rate-limit`.
- Produces:
  ```ts
  // auth.ts
  export interface PlayerRequest extends Request { player?: { id: string } }
  export function requirePlayer(req: Request, res: Response, next: NextFunction): Promise<void>;
  // avatar/routes.ts
  export const avatarRouter: Router;
  ```

- [ ] **Step 1: Cài dependency**

```bash
npm install multer --workspace @masoi/server
npm install -D @types/multer supertest @types/supertest --workspace @masoi/server
```

- [ ] **Step 2: Viết test đỏ**

Tạo `apps/server/tests/avatar-routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import sharp from "sharp";

const db = vi.hoisted(() => ({
  players: new Map<string, { id: string; avatarUrl: string | null; avatarKey: string | null }>(),
  tokenHashes: new Map<string, string>(),
}));

vi.mock("../src/db", () => ({
  prisma: {
    player: {
      findUnique: async ({ where }: { where: { id?: string; tokenHash?: string } }) => {
        if (where.tokenHash) {
          const id = db.tokenHashes.get(where.tokenHash);
          return id ? db.players.get(id) ?? null : null;
        }
        return db.players.get(where.id!) ?? null;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; avatarKey?: string | null };
        data: { avatarUrl: string | null; avatarKey: string | null };
      }) => {
        const row = db.players.get(where.id);
        if (!row) return { count: 0 };
        if (where.avatarKey !== undefined && row.avatarKey !== where.avatarKey) return { count: 0 };
        row.avatarUrl = data.avatarUrl;
        row.avatarKey = data.avatarKey;
        return { count: 1 };
      },
    },
  },
}));

vi.mock("../src/rooms/apply-avatar", () => ({ applyAvatarToRoom: async () => undefined }));

import { avatarRouter } from "../src/avatar/routes";
import { resetRateLimit } from "../src/rate-limit";
import { sha256 } from "../src/util";
import { createMemoryStorage, type MemoryObjectStorage } from "../src/storage/memory";
import { resetObjectStorage, setObjectStorage } from "../src/storage";

const TOKEN = "token-hop-le-dai-hon-16-ky-tu";

let storage: MemoryObjectStorage;

function app() {
  const instance = express();
  instance.use("/api", avatarRouter);
  return instance;
}

async function jpeg(width = 400, height = 300): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 60 } } })
    .jpeg()
    .toBuffer();
}

beforeEach(() => {
  db.players.clear();
  db.tokenHashes.clear();
  db.players.set("p1", { id: "p1", avatarUrl: null, avatarKey: null });
  db.tokenHashes.set(sha256(TOKEN), "p1");
  storage = createMemoryStorage("https://cdn.test/masoi");
  setObjectStorage(storage);
  resetRateLimit();
});

afterEach(() => {
  resetObjectStorage();
  resetRateLimit();
});

describe("PUT /api/players/me/avatar", () => {
  it("thiếu Bearer token thì 401", async () => {
    const res = await request(app())
      .put("/api/players/me/avatar")
      .attach("file", await jpeg(), "a.jpg");

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/xác thực/i);
  });

  it("token sai thì 401", async () => {
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", "Bearer token-sai-nhung-du-dai-16")
      .attach("file", await jpeg(), "a.jpg");

    expect(res.status).toBe(401);
  });

  it("upload hợp lệ thì 200 và trả về URL object", async () => {
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", await jpeg(), "ảnh của tôi.jpg");

    expect(res.status).toBe(200);
    expect(res.body.avatarUrl).toMatch(
      /^https:\/\/cdn\.test\/masoi\/avatars\/p1\/[0-9a-f]{32}\.webp$/,
    );
    // Tên file người dùng không được lọt vào khoá object.
    expect(res.body.avatarUrl).not.toContain("ảnh");
    expect(db.players.get("p1")!.avatarUrl).toBe(res.body.avatarUrl);
  });

  it("thiếu field file thì 400", async () => {
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .field("khác", "1");

    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it("file giả mạo MIME thì 400 và không có object nào được tạo", async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", zip, { filename: "a.png", contentType: "image/png" });

    expect(res.status).toBe(400);
    expect(storage.objects.size).toBe(0);
  });

  it("file quá 5MB thì 413", async () => {
    const tooBig = Buffer.alloc(5 * 1024 * 1024 + 1024, 0x41);
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", tooBig, "to.jpg");

    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/5MB/);
  });

  it("gọi quá nhanh thì 429", async () => {
    const file = await jpeg();
    for (let i = 0; i < 5; i++) {
      await request(app())
        .put("/api/players/me/avatar")
        .set("authorization", `Bearer ${TOKEN}`)
        .attach("file", file, "a.jpg");
    }

    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", file, "a.jpg");

    expect(res.status).toBe(429);
  });

  it("storage chưa cấu hình thì 503 chứ không 500", async () => {
    resetObjectStorage();
    const res = await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", await jpeg(), "a.jpg");

    expect(res.status).toBe(503);
  });
});

describe("DELETE /api/players/me/avatar", () => {
  it("xoá thành công thì 204 và object bị dọn", async () => {
    await request(app())
      .put("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`)
      .attach("file", await jpeg(), "a.jpg");

    const res = await request(app())
      .delete("/api/players/me/avatar")
      .set("authorization", `Bearer ${TOKEN}`);

    expect(res.status).toBe(204);
    expect(db.players.get("p1")!.avatarUrl).toBeNull();
    expect(storage.objects.size).toBe(0);
  });

  it("thiếu Bearer token thì 401", async () => {
    const res = await request(app()).delete("/api/players/me/avatar");
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 3: Chạy test cho chắc là đỏ**

Run: `npm run test --workspace @masoi/server -- avatar-routes`
Expected: FAIL — `Cannot find module '../src/avatar/routes'`.

- [ ] **Step 4: Tách middleware xác thực**

Tạo `apps/server/src/auth.ts`:

```ts
import type { NextFunction, Request, Response } from "express";
import { prisma } from "./db";
import { sha256 } from "./util";

export interface PlayerRequest extends Request {
  player?: { id: string };
}

/**
 * Xác thực Bearer token và gắn `req.player`.
 *
 * Tách ra khỏi /players/me/matches vì giờ có nhiều hơn một endpoint cần nó, và
 * hai bản sao của cùng một đoạn kiểm token là hai chỗ để quên sửa.
 *
 * Token gốc chỉ client giữ; DB chỉ có SHA-256 của nó.
 */
export async function requirePlayer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Thiếu thông tin xác thực" });
    return;
  }

  try {
    const player = await prisma.player.findUnique({ where: { tokenHash: sha256(token) } });
    if (!player) {
      res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });
      return;
    }
    (req as PlayerRequest).player = { id: player.id };
    next();
  } catch (err) {
    console.error("[api] Xác thực thất bại:", err);
    res.status(500).json({ error: "Không thể xác thực lúc này" });
  }
}
```

- [ ] **Step 5: Viết route**

Tạo `apps/server/src/avatar/routes.ts`:

```ts
import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { requirePlayer, type PlayerRequest } from "../auth";
import { allowAction } from "../rate-limit";
import { AvatarError } from "./errors";
import { MAX_AVATAR_UPLOAD_BYTES, clearAvatar, setAvatar } from "./service";

export const avatarRouter = Router();

/**
 * memoryStorage: ảnh chỉ sống trong RAM đủ lâu để sharp xử lý rồi đi thẳng lên
 * bucket - không có file tạm nào trên đĩa Render để mà quên dọn.
 *
 * Trần 5MB đặt ngay ở tầng parser: multer ngắt luồng khi vượt, nên một request
 * 500MB không bao giờ được cấp phát đủ bộ nhớ để trở thành vấn đề.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_UPLOAD_BYTES, files: 1 },
});

function uploadSingleFile(req: Request, res: Response, next: NextFunction): void {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "Ảnh quá lớn, tối đa 5MB" });
        return;
      }
      res.status(400).json({ error: "Không đọc được file tải lên" });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}

/** Đổi avatar là thao tác nặng (giải mã + resize), nên khoá chặt hơn chat. */
function rateLimitAvatar(req: Request, res: Response, next: NextFunction): void {
  const playerId = (req as PlayerRequest).player!.id;
  if (!allowAction(`avatar:${playerId}`, 5, 60_000)) {
    res.status(429).json({ error: "Bạn đổi ảnh quá nhanh, chờ một chút rồi thử lại" });
    return;
  }
  next();
}

function fail(res: Response, err: unknown, fallback: string): void {
  if (err instanceof AvatarError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error("[api] Thao tác avatar thất bại:", err);
  res.status(500).json({ error: fallback });
}

avatarRouter.put(
  "/players/me/avatar",
  requirePlayer,
  rateLimitAvatar,
  uploadSingleFile,
  async (req, res) => {
    // req.file có kiểu nhờ @types/multer bổ sung vào Express.Request.
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Thiếu file ảnh" });
      return;
    }

    try {
      const { avatarUrl } = await setAvatar((req as PlayerRequest).player!.id, file.buffer);
      res.json({ avatarUrl });
    } catch (err) {
      fail(res, err, "Không đổi được ảnh đại diện lúc này");
    }
  },
);

avatarRouter.delete("/players/me/avatar", requirePlayer, rateLimitAvatar, async (req, res) => {
  try {
    await clearAvatar((req as PlayerRequest).player!.id);
    res.status(204).end();
  } catch (err) {
    fail(res, err, "Không xoá được ảnh đại diện lúc này");
  }
});
```

- [ ] **Step 6: Gắn router và dùng lại middleware trong http.ts**

Trong `apps/server/src/http.ts`:

Thêm import:
```ts
import { avatarRouter } from "./avatar/routes";
import { requirePlayer, type PlayerRequest } from "./auth";
```

Gắn router ngay sau dòng `export const apiRouter = Router();`:
```ts
apiRouter.use(avatarRouter);
```

Rồi thay handler `/players/me/matches` để dùng middleware chung. Thay:

```ts
apiRouter.get("/players/me/matches", async (req, res) => {
  const auth = req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Thiếu thông tin xác thực" });
    return;
  }

  try {
    const player = await prisma.player.findUnique({ where: { tokenHash: sha256(token) } });
    if (!player) {
      res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });
      return;
    }

    const rows = await prisma.$queryRaw<GameResultRow[]>`
```

bằng:

```ts
apiRouter.get("/players/me/matches", requirePlayer, async (req, res) => {
  const player = (req as PlayerRequest).player!;

  try {
    const rows = await prisma.$queryRaw<GameResultRow[]>`
```

Phần còn lại của handler giữ nguyên (`player.id` vẫn dùng được).

Nếu `sha256` không còn được dùng ở đâu trong `http.ts` thì bỏ khỏi dòng import `./util`, giữ lại `newToken`.

- [ ] **Step 7: Chạy test cho chắc là xanh**

Run: `npm run test --workspace @masoi/server -- avatar-routes`
Expected: PASS, 10 test.

- [ ] **Step 8: Chạy toàn bộ test server và lint**

Run:
```bash
npm run test --workspace @masoi/server
npm run lint --workspace @masoi/server
```
Expected: tất cả xanh.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/auth.ts apps/server/src/avatar/routes.ts apps/server/src/http.ts apps/server/tests/avatar-routes.test.ts apps/server/package.json package-lock.json
git commit -m "feat(api): PUT và DELETE /api/players/me/avatar với multipart và xác thực Bearer"
```

---

### Task 11: Thư viện upload phía web

**Files:**
- Create: `apps/web/src/lib/avatar-upload.ts`
- Test: `apps/web/src/lib/avatar-upload.test.ts`

**Interfaces:**
- Consumes: `Identity` từ `./identity`.
- Produces:
  ```ts
  export const MAX_AVATAR_BYTES: number;              // 5242880
  export const AVATAR_ACCEPT: string;                 // "image/jpeg,image/png,image/webp"
  export function validateAvatarFile(file: { size: number; type: string }): string | null;
  export function avatarUploadErrorMessage(status: number, body: unknown): string;
  export function uploadAvatar(
    file: File,
    identity: Identity,
    onProgress: (percent: number) => void,
  ): Promise<string>;
  export function deleteAvatar(identity: Identity): Promise<void>;
  ```

- [ ] **Step 1: Viết test đỏ**

Tạo `apps/web/src/lib/avatar-upload.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  MAX_AVATAR_BYTES,
  avatarUploadErrorMessage,
  validateAvatarFile,
} from "./avatar-upload";

test("file hợp lệ không có lỗi", () => {
  assert.equal(validateAvatarFile({ size: 100_000, type: "image/jpeg" }), null);
  assert.equal(validateAvatarFile({ size: 100_000, type: "image/png" }), null);
  assert.equal(validateAvatarFile({ size: 100_000, type: "image/webp" }), null);
});

test("file rỗng bị chặn", () => {
  assert.match(validateAvatarFile({ size: 0, type: "image/jpeg" }) ?? "", /rỗng/);
});

test("file quá 5MB bị chặn ngay ở trình duyệt, khỏi tốn công tải lên", () => {
  const message = validateAvatarFile({ size: MAX_AVATAR_BYTES + 1, type: "image/jpeg" });
  assert.match(message ?? "", /5MB/);
});

test("GIF bị chặn", () => {
  assert.match(validateAvatarFile({ size: 1000, type: "image/gif" }) ?? "", /JPG, PNG/);
});

test("thông điệp lỗi từ server được ưu tiên vì nó cụ thể hơn", () => {
  assert.equal(
    avatarUploadErrorMessage(400, { error: "Không đọc được ảnh này, hãy thử ảnh khác" }),
    "Không đọc được ảnh này, hãy thử ảnh khác",
  );
});

test("mất mạng (status 0) có thông điệp riêng", () => {
  assert.match(avatarUploadErrorMessage(0, null), /kết nối/);
});

test("mỗi mã lỗi có câu tiếng Việt riêng", () => {
  assert.match(avatarUploadErrorMessage(401, null), /phiên/i);
  assert.match(avatarUploadErrorMessage(413, null), /5MB/);
  assert.match(avatarUploadErrorMessage(429, null), /nhanh/);
  assert.match(avatarUploadErrorMessage(503, null), /thử lại/);
});

test("mã lạ vẫn ra câu tiếng Việt kèm mã để còn báo lỗi được", () => {
  assert.match(avatarUploadErrorMessage(418, null), /418/);
});
```

- [ ] **Step 2: Chạy test cho chắc là đỏ**

Run: `npx tsx --test apps/web/src/lib/avatar-upload.test.ts`
Expected: FAIL — không tìm thấy module `./avatar-upload`.

- [ ] **Step 3: Viết cài đặt tối thiểu**

Tạo `apps/web/src/lib/avatar-upload.ts`:

```ts
import type { Identity } from "./identity";

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:4000";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * Kiểm sơ bộ ở trình duyệt.
 *
 * Đây CHỈ là tiện ích: nó tiết kiệm cho người dùng một lần tải 5MB lên rồi mới
 * biết sai. Server không tin gì trong này - nó tự đọc magic bytes, vì `file.type`
 * là thứ đổi được bằng một dòng curl.
 */
export function validateAvatarFile(file: { size: number; type: string }): string | null {
  if (file.size === 0) return "File rỗng, hãy chọn ảnh khác";
  if (file.size > MAX_AVATAR_BYTES) return "Ảnh quá lớn, tối đa 5MB";
  if (!ACCEPTED_TYPES.includes(file.type)) return "Chỉ chấp nhận ảnh JPG, PNG hoặc WebP";
  return null;
}

/**
 * Thông điệp lỗi tiếng Việt.
 *
 * Ưu tiên câu server gửi về: nó biết cụ thể hơn ("Không nén được ảnh xuống dưới
 * 200 KB" hữu ích hơn nhiều so với "lỗi 400"). Bảng dưới chỉ để lấp chỗ trống
 * khi phản hồi không phải JSON - ví dụ proxy chen ngang trả HTML.
 */
export function avatarUploadErrorMessage(status: number, body: unknown): string {
  const fromServer =
    typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
      ? (body as { error: string }).error
      : null;
  if (fromServer) return fromServer;

  switch (status) {
    case 0:
      return "Mất kết nối tới máy chủ, kiểm tra mạng rồi thử lại";
    case 401:
      return "Phiên đăng nhập đã hết hạn, tải lại trang giúp nhé";
    case 413:
      return "Ảnh quá lớn, tối đa 5MB";
    case 429:
      return "Bạn đổi ảnh quá nhanh, chờ một chút rồi thử lại";
    case 503:
      return "Máy chủ chưa sẵn sàng nhận ảnh, thử lại sau ít phút";
    default:
      return `Tải ảnh thất bại (lỗi ${status})`;
  }
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * XMLHttpRequest chứ không phải fetch: fetch không có sự kiện tiến trình cho
 * phần TẢI LÊN, mà đó đúng là phần lâu nhất khi gửi một tấm ảnh 5MB qua 4G.
 */
export function uploadAvatar(
  file: File,
  identity: Identity,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${SERVER_URL}/api/players/me/avatar`);
    xhr.setRequestHeader("authorization", `Bearer ${identity.token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error(avatarUploadErrorMessage(0, null)));
    xhr.onload = () => {
      const body = parseBody(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) {
        const url = (body as { avatarUrl?: unknown } | null)?.avatarUrl;
        if (typeof url === "string") {
          resolve(url);
          return;
        }
        reject(new Error("Máy chủ trả về dữ liệu không hợp lệ"));
        return;
      }
      reject(new Error(avatarUploadErrorMessage(xhr.status, body)));
    };

    xhr.send(form);
  });
}

export async function deleteAvatar(identity: Identity): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_URL}/api/players/me/avatar`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${identity.token}` },
    });
  } catch {
    throw new Error(avatarUploadErrorMessage(0, null));
  }

  if (!res.ok) {
    throw new Error(avatarUploadErrorMessage(res.status, await res.json().catch(() => null)));
  }
}
```

- [ ] **Step 4: Chạy test cho chắc là xanh**

Run: `npx tsx --test apps/web/src/lib/avatar-upload.test.ts`
Expected: PASS, 9 test.

- [ ] **Step 5: Lint**

Run: `npm run lint --workspace @masoi/web`
Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/avatar-upload.ts apps/web/src/lib/avatar-upload.test.ts
git commit -m "feat(web): thư viện tải avatar lên với tiến trình và lỗi tiếng Việt"
```

---

### Task 12: Giao diện chọn và tải avatar

**Files:**
- Modify: `apps/web/src/components/AvatarPicker.tsx` (viết lại)
- Modify: `apps/web/src/components/Avatar.tsx` (nhận URL http(s))
- Modify: `apps/web/src/components/RosterPanel.tsx` (bỏ prop `onUpdateAvatar`)
- Modify: `apps/web/src/app/room/[code]/page.tsx:207` (bỏ wiring `onUpdateAvatar`)

**Interfaces:**
- Consumes: `uploadAvatar`, `deleteAvatar`, `validateAvatarFile`, `AVATAR_ACCEPT` (Task 11); `getIdentity` từ `@/lib/identity`.
- Produces: `AvatarPicker` với props `{ currentUrl?: string | null; onDone?: () => void }`.

- [ ] **Step 1: Viết lại AvatarPicker**

Thay toàn bộ nội dung `apps/web/src/components/AvatarPicker.tsx` bằng:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { getIdentity } from "@/lib/identity";
import {
  AVATAR_ACCEPT,
  deleteAvatar,
  uploadAvatar,
  validateAvatarFile,
} from "@/lib/avatar-upload";

interface Props {
  currentUrl?: string | null;
  /** Gọi khi thao tác xong, để chỗ đặt picker tự đóng lại. */
  onDone?: () => void;
}

/**
 * Chọn ảnh, xem trước, tải lên.
 *
 * Không crop và không encode gì ở đây nữa: server tự xoay theo EXIF, crop vuông,
 * thu về 256 và encode WebP. Trình duyệt chỉ còn hiển thị - preview dùng
 * createObjectURL chứ không phải data URL, nên không có chuỗi base64 nào được
 * dựng trong bộ nhớ tab.
 *
 * Ảnh hiện tại KHÔNG bị đụng cho tới khi server trả về thành công, nên một lần
 * tải hỏng giữa chừng không làm mất avatar đang có.
 */
export function AvatarPicker({ currentUrl, onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Thu hồi object URL khi đổi ảnh hoặc rời component: mỗi createObjectURL giữ
  // nguyên tấm ảnh trong bộ nhớ tab cho tới khi được revoke.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const pick = (picked: File) => {
    const message = validateAvatarFile(picked);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setProgress(null);
  };

  const handleUpload = async () => {
    const identity = getIdentity();
    if (!file || !identity) return;

    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      await uploadAvatar(file, identity, setProgress);
      reset();
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tải ảnh thất bại");
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    const identity = getIdentity();
    if (!identity) return;

    setBusy(true);
    setError(null);
    try {
      await deleteAvatar(identity);
      reset();
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xoá ảnh thất bại");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={AVATAR_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) pick(picked);
          e.target.value = "";
        }}
      />
      <div className="flex gap-1.5">
        <button
          type="button"
          className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white hover:bg-white/15 disabled:opacity-50"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          📷 Chọn ảnh
        </button>
        {currentUrl && !file && (
          <button
            type="button"
            className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-mist/70 hover:bg-white/5 disabled:opacity-50"
            onClick={handleRemove}
            disabled={busy}
          >
            {busy ? "Đang xoá..." : "Xóa"}
          </button>
        )}
      </div>

      {previewUrl && (
        <div className="rounded-xl border border-white/10 bg-night-800 p-3">
          <p className="mb-1 text-xs text-mist/60">Xem trước — máy chủ sẽ cắt vuông 256×256:</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewUrl}
            alt="Ảnh vừa chọn"
            className="mx-auto h-24 w-24 rounded-full object-cover ring-1 ring-white/10"
          />

          {progress !== null && (
            <div className="mt-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-white/70 transition-[width] duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-center text-[11px] text-mist/60">Đang tải lên {progress}%</p>
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="btn-primary flex-1 text-xs"
              onClick={handleUpload}
              disabled={busy}
            >
              {busy ? "Đang tải..." : error ? "Thử lại" : "Tải lên"}
            </button>
            <button
              type="button"
              className="btn-secondary flex-1 text-xs"
              onClick={reset}
              disabled={busy}
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-blood-400">{error}</p>}
      <p className="text-[11px] text-mist/60">JPG/PNG/WebP &lt;5MB, máy chủ tự cắt vuông 256px.</p>
    </div>
  );
}
```

- [ ] **Step 2: Cho Avatar nhận URL http(s)**

Trong `apps/web/src/components/Avatar.tsx`, thay:

```tsx
  /** Nếu là base64 data URL thì render ảnh thay vì SVG */
  isCustom?: boolean;
```
bằng:
```tsx
  /** Nếu là ảnh người chơi tự tải lên thì render <img> thay vì SVG */
  isCustom?: boolean;
```

và thay:

```tsx
  const isDataUrl = typeof avatar === "string" && avatar.startsWith("data:image");
  const isCustomUrl = isCustom || isDataUrl;
```

bằng:

```tsx
  // http(s) là ảnh trên object storage; data: là avatar cũ chưa kịp di trú và
  // vẫn phải hiện được trong giai đoạn chuyển tiếp.
  const isUploaded =
    typeof avatar === "string" && /^(https?:|data:image)/.test(avatar);
  const isCustomUrl = isCustom || isUploaded;
```

- [ ] **Step 3: Bỏ đường socket khỏi RosterPanel**

Trong `apps/web/src/components/RosterPanel.tsx`:

Xoá dòng trong `interface Props`:
```ts
  onUpdateAvatar?: (avatarUrl: string | null) => void;
```

Đổi chữ ký hàm:
```tsx
export function RosterPanel({ snapshot, lobby, onUpdateAvatar }: Props) {
```
→
```tsx
export function RosterPanel({ snapshot, lobby }: Props) {
```

Thay khối picker:
```tsx
      {onUpdateAvatar && snapshot.you && (
```
→
```tsx
      {snapshot.you && (
```

và thay phần dùng `AvatarPicker`:
```tsx
              <AvatarPicker
                currentUrl={(snapshot.you as any)?.avatarUrl ?? null}
                onSave={(url) => {
                  onUpdateAvatar(url);
                  setShowPicker(false);
                }}
              />
```
→
```tsx
              <AvatarPicker
                currentUrl={snapshot.you?.avatarUrl ?? null}
                onDone={() => setShowPicker(false)}
              />
```

- [ ] **Step 4: Bỏ wiring ở trang phòng**

Trong `apps/web/src/app/room/[code]/page.tsx`, xoá dòng 207:

```tsx
                onUpdateAvatar={(avatarUrl) => room.emit("room:update-avatar", { avatarUrl })}
```

- [ ] **Step 5: Lint và build web**

Run:
```bash
npm run lint --workspace @masoi/web
npm run build:web
```
Expected: cả hai xanh.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/AvatarPicker.tsx apps/web/src/components/Avatar.tsx apps/web/src/components/RosterPanel.tsx "apps/web/src/app/room/[code]/page.tsx"
git commit -m "feat(web): tải avatar qua HTTP với tiến trình, preview và nút thử lại"
```

---

### Task 13: MinIO local, biến môi trường và tài liệu

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `apps/server/.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: tên sáu biến từ Task 1.
- Produces: không có mã.

- [ ] **Step 1: Thêm MinIO vào docker-compose**

Trong `docker-compose.yml`, thêm hai service vào trước khối `volumes:`:

```yaml
  minio:
    image: minio/minio:RELEASE.2025-04-22T22-12-26Z
    container_name: masoi-minio
    restart: unless-stopped
    command: ["server", "/data", "--console-address", ":9001"]
    environment:
      MINIO_ROOT_USER: masoi
      MINIO_ROOT_PASSWORD: masoi_dev_password
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - masoi_miniodata:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 5s
      timeout: 5s
      retries: 10

  # Tạo bucket và mở quyền đọc công khai. Chạy một lần rồi thoát - avatar phải
  # đọc được từ thẻ <img> mà không cần chữ ký, y như bucket public trên R2.
  minio-init:
    image: minio/mc:RELEASE.2025-04-16T18-13-26Z
    container_name: masoi-minio-init
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 masoi masoi_dev_password &&
      mc mb --ignore-existing local/masoi-avatars &&
      mc anonymous set download local/masoi-avatars
      "
```

và thêm volume vào khối `volumes:` ở cuối file:

```yaml
  masoi_miniodata:
```

- [ ] **Step 2: Thêm biến vào .env.example ở gốc**

Thêm vào cuối `.env.example`:

```
# Object storage cho ảnh đại diện (S3-compatible: Cloudflare R2, AWS S3, MinIO).
# Bỏ trống CẢ SÁU khoá để tắt hẳn - lúc đó ảnh tải lên bị vô hiệu, avatar mặc
# định vẫn chạy bình thường. Điền một phần thì server ném lỗi lúc khởi động,
# thay vì âm thầm tắt tính năng mà không log gì.
#
# Giá trị dưới đây khớp với service minio trong docker-compose.yml, nên
# `npm run dev:infra` là đủ để chạy local.
OBJECT_STORAGE_ENDPOINT=http://localhost:9000
OBJECT_STORAGE_REGION=us-east-1
OBJECT_STORAGE_BUCKET=masoi-avatars
OBJECT_STORAGE_ACCESS_KEY_ID=masoi
OBJECT_STORAGE_SECRET_ACCESS_KEY=masoi_dev_password
# URL công khai để trình duyệt tải ảnh. KHÁC endpoint ký ở trên khi dùng R2.
# Bắt buộc HTTPS khi NODE_ENV=production.
OBJECT_STORAGE_PUBLIC_BASE_URL=http://localhost:9000/masoi-avatars
```

- [ ] **Step 3: Thêm biến vào apps/server/.env.example**

Thêm vào cuối `apps/server/.env.example` (file này không dấu, giữ nguyên phong cách):

```
# Object storage cho anh dai dien (S3-compatible: Cloudflare R2, AWS S3, MinIO).
# Bo trong CA SAU khoa de tat han. Dien mot phan thi server nem loi luc khoi dong.
# OBJECT_STORAGE_PUBLIC_BASE_URL phai la HTTPS khi NODE_ENV=production.
OBJECT_STORAGE_ENDPOINT=
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY_ID=
OBJECT_STORAGE_SECRET_ACCESS_KEY=
OBJECT_STORAGE_PUBLIC_BASE_URL=
```

- [ ] **Step 4: Cập nhật README — mục Configuration**

Trong `README.md`, thêm một tiểu mục ngay sau `### Voice chat (optional)`:

```markdown
### Object storage for avatars (optional)

Player avatars are uploaded to any S3-compatible bucket — Cloudflare R2, AWS S3
or MinIO. Leave **all six** variables empty to disable uploads; the game runs
normally on the built-in default avatars. Filling in only *some* of them throws
at startup rather than silently disabling the feature.

| Variable | Purpose |
| --- | --- |
| `OBJECT_STORAGE_ENDPOINT` | S3 API endpoint used for signing |
| `OBJECT_STORAGE_REGION` | `auto` for R2, a real region for S3, anything for MinIO |
| `OBJECT_STORAGE_BUCKET` | Bucket that holds the avatars |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | Access key |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | Secret key |
| `OBJECT_STORAGE_PUBLIC_BASE_URL` | Public read URL — **not** the signing endpoint. Must be HTTPS in production. |

Uploads go to `PUT /api/players/me/avatar`. The server sniffs magic bytes
(JPEG/PNG/WebP only — the client-declared MIME type is ignored), auto-rotates
by EXIF, crops to a centred square, resizes to 256×256 and encodes WebP under
200 KB. Object keys are random, so a user's filename never reaches the bucket.

#### Cloudflare R2

1. Cloudflare dashboard → **R2** → **Create bucket**, name it `masoi-avatars`.
2. In the bucket's **Settings**, enable **Public Development URL** (or attach a
   custom domain). Copy the `https://pub-<hash>.r2.dev` URL — that is
   `OBJECT_STORAGE_PUBLIC_BASE_URL`.
3. **R2** → **Manage API Tokens** → **Create API Token**, permission
   *Object Read & Write*, scoped to that bucket. Copy the access key ID and
   secret.
4. The token page also shows the S3 endpoint
   `https://<account-id>.r2.cloudflarestorage.com` — that is
   `OBJECT_STORAGE_ENDPOINT`. Set `OBJECT_STORAGE_REGION=auto`.
5. Paste all six values into Render's environment variables and redeploy.

The public URL and the endpoint are different hosts. Using the endpoint as the
public base URL produces avatars that 401 in the browser.

#### MinIO for local development

`npm run dev:infra` already starts MinIO and creates the bucket with public
read access. Copy the object storage block from `.env.example` as-is — it
matches the compose file. The MinIO console is at <http://localhost:9001>
(`masoi` / `masoi_dev_password`).

`http://` public URLs are accepted only when `NODE_ENV` is not `production`.
```

- [ ] **Step 5: Cập nhật README — mục API reference**

Trong `README.md`, bảng ở tiểu mục `### REST` có năm cột
`| Method | Path | Body | Response | Notes |`. Thêm hai dòng ngay sau dòng
`POST /api/players`:

```markdown
| `PUT` | `/api/players/me/avatar` | `multipart/form-data`, field `file` | `{ avatarUrl }` | Bearer auth. ≤ 5 MB. Format is decided by magic bytes (JPEG/PNG/WebP), never by the client-declared MIME type. The server auto-rotates by EXIF, crops to a centred square, resizes to 256×256 and encodes WebP under 200 KB. `503` when object storage is not configured. |
| `DELETE` | `/api/players/me/avatar` | — | `204` | Bearer auth. Clears the avatar and deletes the stored object. Succeeds even when object storage is not configured — the database is the source of truth for "has an avatar". |
```

Bảng ở tiểu mục `### Socket.IO` có ba cột `| Event | Payload | Rules |`. Thay
dòng 310:

```markdown
| `room:update-avatar` | `{ avatarUrl }` | Member; `data:image/*`, ≤ 5 MB |
```

bằng:

```markdown
| `room:update-avatar` | `{ avatarUrl: null }` | Member; removal only. Uploads go through `PUT /api/players/me/avatar` — sending image data over Socket.IO is what bloated every room snapshot. Kept so older cached clients can still remove an avatar. |
```

- [ ] **Step 6: Kiểm MinIO chạy thật**

Run:
```bash
docker compose up -d minio minio-init
docker compose logs minio-init
```
Expected: log có `Bucket created successfully` (hoặc bỏ qua vì đã tồn tại) và `Access permission for 'local/masoi-avatars' is set to 'download'`.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example apps/server/.env.example README.md
git commit -m "docs(avatar): MinIO local, biến môi trường object storage và hướng dẫn R2"
```

---

### Task 14: Xác minh toàn hệ thống

**Files:** không sửa file nào trừ khi có lỗi phát hiện ra.

**Interfaces:**
- Consumes: mọi thứ ở Task 1–13.
- Produces: không có.

- [ ] **Step 1: Chạy toàn bộ test**

Run: `npm test`
Expected: shared, game-engine, server và web đều xanh.

- [ ] **Step 2: Lint toàn bộ**

Run: `npm run lint`
Expected: không lỗi.

- [ ] **Step 3: Build toàn bộ**

Run: `npm run build`
Expected: bốn workspace build xong.

- [ ] **Step 4: Xác minh sharp chạy trên Alpine**

Đây là rủi ro duy nhất mà test không bắt được: image runner là `node:20.19-alpine`, nên `sharp` phải kéo được prebuilt `@img/sharp-linuxmusl-x64`.

Run:
```bash
docker build -f Dockerfile.server -t masoi-server-avatar-check .
docker run --rm --entrypoint node masoi-server-avatar-check -e "require('sharp'); console.log('sharp OK trên alpine')"
```
Expected: in ra `sharp OK trên alpine`.

Nếu bước này hỏng vì thiếu prebuilt musl, đường lui đã ghi trong spec: đổi cả hai `FROM node:20.19-alpine` trong `Dockerfile.server` thành `node:20.19-slim`, đổi `apk add --no-cache openssl` thành `apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*`, rồi chạy lại. Commit riêng nếu phải làm.

- [ ] **Step 5: Thử tay đủ một vòng**

Chạy `npm run dev:infra`, `npm run dev:server`, `npm run dev:web` với block object storage của `.env.example`, rồi kiểm bằng mắt:

1. Tạo phòng, mở "📷 Đổi ảnh đại diện", chọn một ảnh JPEG lớn (>2 MB) chụp dọc bằng điện thoại. Thanh tiến trình chạy, ảnh hiện đúng chiều và vuông.
2. Mở <http://localhost:9001>, vào bucket `masoi-avatars` — có đúng một object, đuôi `.webp`, dưới 200 KB, tên không dính tên file gốc.
3. Đổi ảnh lần nữa — bucket vẫn chỉ có đúng một object.
4. Mở tab thứ hai vào cùng phòng bằng người chơi khác: avatar hiện ngay mà không cần tải lại trang.
5. Bấm "Xóa" — object biến mất khỏi bucket, avatar về mặc định.
6. Đổi tên một file `.zip` thành `.png` rồi thử tải lên — hiện lỗi tiếng Việt, bucket không có thêm object nào.
7. Tắt storage (xoá sáu biến, khởi động lại server) — server vẫn lên, phòng vẫn chạy, thử tải ảnh thì báo lỗi tiếng Việt rõ ràng thay vì treo.

- [ ] **Step 6: Kiểm không còn credential thật trong repo**

Run: `git diff main...HEAD -- . ':!package-lock.json' | grep -inE "secret|token|password|key" | grep -v "masoi_dev_password"`
Expected: chỉ còn tên biến, chú thích và placeholder rỗng — không có giá trị thật nào. `masoi_dev_password` là mật khẩu dev của docker-compose, đã có sẵn trong repo từ trước.

- [ ] **Step 7: Commit sửa lỗi nếu có**

Nếu Step 1–6 phát hiện lỗi thì sửa và commit riêng. Nếu tất cả xanh thì không có gì để commit ở task này.
