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
