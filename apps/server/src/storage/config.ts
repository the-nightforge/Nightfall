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
