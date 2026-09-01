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
