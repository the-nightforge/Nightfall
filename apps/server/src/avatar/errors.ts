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
