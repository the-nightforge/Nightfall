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
