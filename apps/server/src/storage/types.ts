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
