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
